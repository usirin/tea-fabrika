import {readFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, FileSystem, Layer, PlatformError, Result, Schema} from "effect";
import {parse} from "smol-toml";
import {describe, expect, it} from "vitest";
import {beta, installed, packs} from "../../../../fixtures/keybindings/programs.ts";
import {Edit, KeybindingManager} from "./keybindings.ts";

const FROM = {how: "pressed" as const, window: "window-1", said: 100};
type Target = {readonly program: string; readonly word: string; readonly mode: string | null};
const select = {program: "alpha", word: "exit", mode: "select"};
const search = {...select, mode: "search"};
const request = Schema.decodeUnknownSync(Edit);
const bind = (target: Target, keys: readonly string[]) => request({_tag: "bind", target, keys});
const reset = (target: Target) => request({_tag: "reset", target});
const run = (test: ReturnType<typeof scenario>) =>
	Effect.runPromise(
		test.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	);
const scenario = (
	check: (h: Effect.Success<ReturnType<typeof opened>>) => Effect.Effect<void, unknown>,
) =>
	Effect.gen(function* () {
		yield* check(yield* opened());
	});
const opened = () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = yield* fs.makeTempDirectoryScoped({prefix: "kp2-"});
		const file = join(dir, "keybindings.toml");
		const original = readFileSync(
			new URL("../../../../fixtures/keybindings/modes.toml", import.meta.url),
			"utf8",
		);
		yield* fs.writeFileString(file, original);
		const faults = {rename: false};
		const disk = FileSystem.FileSystem.of({
			...fs,
			rename: (...args) =>
				faults.rename
					? Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method: "rename",
								description: "test denies rename",
							}),
						)
					: fs.rename(...args),
		});
		const manager = yield* KeybindingManager.make({
			folder: dir,
			mac: false,
			by: "owner",
			programs: packs,
			client: installed,
		}).pipe(Effect.provideService(FileSystem.FileSystem, disk));
		return {fs, file, original, faults, manager};
	});

describe("today's scoped key saves on real files", () => {
	it("P7: Add, Unbind and Reset touch exactly one mode row", async () => {
		await run(
			scenario((h) =>
				Effect.gen(function* () {
					yield* h.manager.edit(bind(select, ["escape", "ctrl+g", "ctrl+x"]), FROM);
					let text = yield* h.fs.readFileString(h.file);
					expect(parse(text)).toHaveProperty("mode.alpha.select.keys.exit", [
						"escape",
						"ctrl+g",
						"ctrl+x",
					]);
					// Unbind a non-exit row. Emptying an exit has its own no-trap law.
					yield* h.manager.edit(bind({...select, word: "accept"}, []), FROM);
					expect(parse(yield* h.fs.readFileString(h.file))).toHaveProperty(
						"mode.alpha.select.keys.accept",
						[],
					);
					yield* h.manager.edit(reset(select), FROM);
					text = yield* h.fs.readFileString(h.file);
					expect(parse(text)).not.toHaveProperty("mode.alpha.select.keys.exit");
					expect(parse(text)).toHaveProperty("mode.alpha.search.keys", {exit: "escape", find: "n"});
				}),
			),
		);
	});
	it("P8: two mode sections change in one save and one Undo restores both", async () => {
		await run(
			scenario((h) =>
				Effect.gen(function* () {
					const applied = yield* h.manager.edit(
						request({
							_tag: "batch",
							edits: [
								{_tag: "bind", target: select, keys: ["escape", "ctrl+x"]},
								{_tag: "bind", target: search, keys: ["escape", "ctrl+x"]},
							],
						}),
						FROM,
					);
					expect(applied.changes).toHaveLength(1);
					const written = parse(yield* h.fs.readFileString(h.file));
					for (const mode of ["select", "search"])
						expect(written).toHaveProperty(`mode.alpha.${mode}.keys.exit`, ["escape", "ctrl+x"]);
					yield* h.manager.edit(Edit.cases.undo.make({version: applied.version}), FROM);
					expect(yield* h.fs.readFileString(h.file)).toBe(h.original);
				}),
			),
		);
	});
	it("P9: assigning a focused key displaces its local loser and leaves the other pack alone", async () => {
		await run(
			scenario((h) =>
				Effect.gen(function* () {
					const saved = yield* h.manager.edit(
						bind({program: "alpha", word: "previous", mode: null}, ["j"]),
						FROM,
					);
					const text = parse(yield* h.fs.readFileString(h.file));
					expect(text).toHaveProperty("alpha.previous", ["j"]);
					expect(text).toHaveProperty("alpha.next", []);
					expect(text).toHaveProperty("beta.next", "j");
					expect(saved.changes.at(-1)?.displaced).toEqual([
						expect.objectContaining({target: {program: "alpha", word: "next", mode: null}}),
					]);
				}),
			),
		);
	});
	it("P27: mode patches preserve unrelated bytes and a failed rename activates nothing", async () => {
		await run(
			scenario((h) =>
				Effect.gen(function* () {
					const before = yield* h.manager.current;
					expect(before.keys.file._tag).toBe("read");
					h.faults.rename = true;
					const failure = yield* h.manager
						.edit(bind(search, ["escape", "ctrl+x"]), FROM)
						.pipe(Effect.result);
					expect(Result.isFailure(failure)).toBe(true);
					expect(yield* h.fs.readFileString(h.file)).toBe(h.original);
					expect((yield* h.manager.current).keys).toEqual(before.keys);
					expect((yield* h.manager.current).version).toBe(before.version);
					h.faults.rename = false;
					yield* h.manager.edit(bind(select, ["escape", "ctrl+x"]), FROM);
					const written = yield* h.fs.readFileString(h.file);
					expect(written).toBe(
						h.original.replace('exit = ["escape", "ctrl+g"]', 'exit = ["escape", "ctrl+x"]'),
					);
				}),
			),
		);
	});
	it("P28: a catalog change cancels Undo even if the file digest did not change", async () => {
		await run(
			scenario((h) =>
				Effect.gen(function* () {
					const changed = yield* h.manager.edit(bind(select, ["escape", "ctrl+x"]), FROM);
					const bytes = yield* h.fs.readFileString(h.file);
					yield* h.manager.catalog([{program: beta, origin: {pack: "pack-b"}}]);
					const current = yield* h.manager.current;
					expect(current.version).toBe(changed.version);
					expect(current.catalog).not.toBe(changed.catalog);
					const undone = yield* h.manager
						.edit(Edit.cases.undo.make({version: changed.version}), FROM)
						.pipe(Effect.result);
					expect(Result.isFailure(undone)).toBe(true);
					if (Result.isFailure(undone))
						expect(String(undone.failure)).toMatch(/catalog|unloaded|changed/i);
					expect(yield* h.fs.readFileString(h.file)).toBe(bytes);
					expect(
						(yield* h.manager.current).keys.rows.some((r) => r.target?.program === "alpha"),
					).toBe(false);
				}),
			),
		);
	});
});
