import {lstatSync, readFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
	Effect,
	FileSystem,
	Layer,
	type Path,
	PlatformError,
	Result,
	type Scope,
	Stream,
} from "effect";
import {parse} from "smol-toml";
import {describe, expect, it} from "vitest";
import {decodeKeys, defaults, type Does, type Keys} from "../desk/keymap.ts";
import {Edit, KeybindingManager, type Snapshot} from "./keybindings.ts";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const go = <A, E>(test: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

const FROM = {how: "pressed" as const, window: "window-1", said: 100};
const bind = (does: Does, keys: readonly string[]) => Edit.cases.bind.make({does, keys});
const row = (keys: Keys, does: string) => keys.rows.find((r) => r.does === does);
const pause = Effect.sleep("150 millis");

const until = (what: string, check: () => boolean) =>
	Effect.gen(function* () {
		for (let i = 0; i < 1000; i += 1) {
			if (check()) {
				return;
			}

			yield* Effect.sleep("5 millis");
		}

		return yield* Effect.die(`waited for ${what}`);
	});

// The real service on real files. Only the two OS failures are injected.
const opened = (text = "") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = yield* fs.makeTempDirectoryScoped({prefix: "kb-"});
		const file = join(dir, "keybindings.toml");
		yield* fs.writeFileString(file, text);
		const faults = {read: false, write: false};
		const denied = (method: string) =>
			PlatformError.systemError({
				_tag: "PermissionDenied",
				module: "FileSystem",
				method,
				description: "test denies the operation",
			});
		const disk = FileSystem.FileSystem.of({
			...fs,
			readFileString: (...args) =>
				faults.read ? Effect.fail(denied("readFileString")) : fs.readFileString(...args),
			rename: (...args) => (faults.write ? Effect.fail(denied("rename")) : fs.rename(...args)),
		});
		const create: Effect.Effect<
			KeybindingManager,
			unknown,
			FileSystem.FileSystem | Path.Path | Scope.Scope
		> = KeybindingManager.make({folder: dir, mac: true, by: "owner"});
		const manager = yield* create.pipe(Effect.provideService(FileSystem.FileSystem, disk));
		const current: Effect.Effect<Snapshot> = manager.current;
		const changes: Stream.Stream<Snapshot> = manager.changes;
		const seen: Snapshot[] = [];
		yield* changes.pipe(
			Stream.runForEach((snapshot: Snapshot) =>
				Effect.sync(() => {
					seen.push(snapshot);
				}),
			),
			Effect.forkScoped,
		);
		yield* until("the first snapshot", () => seen.length > 0);
		const edit = (request: typeof Edit.Type, from = FROM): Effect.Effect<Snapshot, unknown> =>
			manager.edit(request, from);
		return {fs, file, dir, manager, current, edit, seen, faults};
	});

describe("today's KeybindingManager", () => {
	it("K2: replace, add, empty and reset save different rows; Reset deletes the assignment", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened();
				const changed = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"]));
				expect(row(changed.keys, "tezgah.zoom")?.keys).toEqual([{_tag: "after_prefix", key: "m"}]);
				const added = yield* h.edit(bind("tezgah.zoom", ["<prefix>m", "<prefix>enter"]));
				expect(row(added.keys, "tezgah.zoom")?.keys).toHaveLength(2);
				const unbound = yield* h.edit(bind("tezgah.zoom", []));
				expect(row(unbound.keys, "tezgah.zoom")).toMatchObject({keys: [], source: "yours"});
				expect(parse(yield* h.fs.readFileString(h.file))).toMatchObject({tezgah: {zoom: []}});
				const reset = yield* h.edit(Edit.cases.reset.make({does: "tezgah.zoom"}));
				expect(row(reset.keys, "tezgah.zoom")).toEqual(row(defaults, "tezgah.zoom"));
				expect(parse(yield* h.fs.readFileString(h.file))).not.toHaveProperty("tezgah.zoom");
			}),
		);
	});

	it("K8: a new editor claim moves only that key and reports the losing user and default commands", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('tezgah.fold = ["<prefix>m", "<prefix>enter", "cmd+o"]\n');
				const applied = yield* h.edit(bind("tezgah.zoom", ["<prefix>m", "<prefix>h"]));
				expect(row(applied.keys, "tezgah.fold")?.keys).toEqual([
					{_tag: "after_prefix", key: "<enter>"},
					{_tag: "alone", key: "<m-o>"},
				]);
				expect(row(applied.keys, 'tezgah."focus --to left"')?.keys).toEqual([
					{_tag: "after_prefix", key: "<arrowleft>"},
				]);
				expect(applied.changes.at(-1)?.displaced).toEqual(
					expect.arrayContaining([
						expect.objectContaining({does: "tezgah.fold", key: {_tag: "after_prefix", key: "m"}}),
						expect.objectContaining({
							does: 'tezgah."focus --to left"',
							key: {_tag: "after_prefix", key: "h"},
						}),
					]),
				);
				expect(Result.isSuccess(decodeKeys(yield* h.fs.readFileString(h.file), true))).toBe(true);
			}),
		);
	});

	it("K10: single-line, multiline and table-relative edits preserve every unrelated byte and dotted words", async () => {
		const original = readFileSync(
			new URL("../../../../fixtures/keybindings/source.toml", import.meta.url),
			"utf8",
		);
		await go(
			Effect.gen(function* () {
				const h = yield* opened(original);
				yield* h.edit(bind("tezgah.zoom", ["<prefix>u"]));
				const saved = yield* h.fs.readFileString(h.file);
				expect(saved).toContain(
					'# A hand-written file. These comments and untouched rows must survive a save.\nprefix = "ctrl+a" # keep this note\nignore = ["cmd+w"]\n',
				);
				expect(saved).toContain(
					'tezgah."split --to down" = \'<prefix>_\' # quoted dotted word\n\n[palette] # keep this header\nopen = "cmd+p" # keep this row\n',
				);
				expect(saved).toContain("# zoom note");
				expect(parse(saved)).toMatchObject({
					tezgah: {zoom: ["<prefix>u"], "split --to down": "<prefix>_"},
					palette: {open: "cmd+p"},
				});
				yield* h.edit(bind('tezgah."split --to down"', ["<prefix>v"]));
				yield* h.edit(bind("palette.open", ["cmd+o"]));
				yield* h.edit(bind("tezgah.close", ["<prefix>c"]));
				const final = yield* h.fs.readFileString(h.file);
				expect(final).toContain("tezgah.close =");
				expect(final).not.toContain("[tezgah]");
				expect(final).toContain("# keep this header");
				expect(final).toContain("# keep this row");
				expect(Result.isSuccess(decodeKeys(final, true))).toBe(true);
				expect(parse(final)).toMatchObject({
					tezgah: {"split --to down": ["<prefix>v"], close: ["<prefix>c"]},
					palette: {open: ["cmd+o"]},
				});
			}),
		);
	});

	it("K10: editing an existing assignment preserves the absence of a final newline", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('prefix = "ctrl+a"');
				yield* h.edit(Edit.cases.prefix.make({key: "ctrl+d"}));
				expect(yield* h.fs.readFileString(h.file)).toBe('prefix = "ctrl+d"');
			}),
		);
	});

	it("K11: failed re-read or rename reports failure, keeps bytes and last good keys, and publishes no success", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('prefix = "ctrl+a"\n');
				const good = yield* h.current;
				const bytes = yield* h.fs.readFileString(h.file);

				for (const failure of ["read", "write"] as const) {
					h.faults[failure] = true;
					const result = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"])).pipe(Effect.result);
					expect(Result.isFailure(result)).toBe(true);

					if (Result.isFailure(result)) {
						expect(String(result.failure)).toMatch(/read|write|rename|denied/i);
					}

					h.faults[failure] = false;
					yield* pause;
					expect(yield* h.fs.readFileString(h.file)).toBe(bytes);
					expect((yield* h.current).keys.rows).toEqual(good.keys.rows);
					expect((yield* h.current).version).toBe(good.version);
					expect(h.seen.every((snapshot: Snapshot) => snapshot.version === good.version)).toBe(
						true,
					);
				}
			}),
		);
	});

	it("K13: hand saves and editor saves follow completed-write order and both observed changes remain", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened();
				const first = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"]));
				// A hand save uses an actual rename, after the editor completed.
				yield* h.fs.writeFileString(
					join(h.dir, "hand.tmp"),
					'tezgah.zoom = "<prefix>u"\ntezgah.fold = [] # hand note\n',
				);
				yield* h.fs.rename(join(h.dir, "hand.tmp"), h.file);
				yield* until("the hand save observed", () =>
					h.seen.some((s: Snapshot) => row(s.keys, "tezgah.zoom")?.keys[0]?.key === "u"),
				);
				const last = yield* h.edit(bind("tezgah.zoom", ["<prefix>v"]));
				expect(row(last.keys, "tezgah.zoom")?.keys[0]?.key).toBe("v");
				expect(row(last.keys, "tezgah.fold")?.keys).toEqual([]);
				expect(yield* h.fs.readFileString(h.file)).toContain("# hand note");
				expect(last.changes.map((change: {how: string}) => change.how)).toEqual([
					"pressed",
					"file",
					"pressed",
				]);
				expect(last.changes[0]?.version).toBe(first.version);
			}),
		);
	});

	it("K12: two subscribers receive the same applied version once, including after the watcher echo", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened();
				const second: Snapshot[] = [];
				const stream: Stream.Stream<Snapshot> = h.manager.changes;
				yield* stream.pipe(
					Stream.runForEach((snapshot: Snapshot) =>
						Effect.sync(() => {
							second.push(snapshot);
						}),
					),
					Effect.forkScoped,
				);
				yield* until("second subscriber ready", () => second.length > 0);
				const applied = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"]));
				yield* until(
					"both subscribers applied",
					() =>
						h.seen.at(-1)?.version === applied.version &&
						second.at(-1)?.version === applied.version,
				);
				yield* pause;
				expect(h.seen.filter((s: Snapshot) => s.version === applied.version)).toEqual([applied]);
				expect(second.filter((s: Snapshot) => s.version === applied.version)).toEqual([applied]);
				expect((yield* h.current).changes).toHaveLength(1);
			}),
		);
	});

	it("K13: re-reads a completed hand save even before its watcher notification", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('tezgah.zoom = "<prefix>m"\n');
				yield* h.fs.writeFileString(
					h.file,
					'tezgah.zoom = "<prefix>m"\ntezgah.fold = [] # just saved\n',
				);
				const applied = yield* h.edit(bind("tezgah.zoom", ["<prefix>v"]));
				expect(row(applied.keys, "tezgah.fold")?.keys).toEqual([]);
				expect(yield* h.fs.readFileString(h.file)).toContain("# just saved");
			}),
		);
	});

	it("K14: Undo restores changed rows including a clash loser, and refuses a newer file version", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('tezgah.fold = ["<prefix>m", "<prefix>enter"]\n# keep\n');
				const changed = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"]));
				const undone = yield* h.edit(Edit.cases.undo.make({version: changed.version}));
				expect(row(undone.keys, "tezgah.zoom")?.source).toBe("default");
				expect(row(undone.keys, "tezgah.fold")?.keys).toEqual([
					{_tag: "after_prefix", key: "m"},
					{_tag: "after_prefix", key: "<enter>"},
				]);
				const another = yield* h.edit(bind("tezgah.zoom", ["<prefix>u"]));
				const newer = `${yield* h.fs.readFileString(h.file)}\ntezgah.close = [] # newer\n`;
				yield* h.fs.writeFileString(h.file, newer);
				const stale = yield* h
					.edit(Edit.cases.undo.make({version: another.version}))
					.pipe(Effect.result);
				expect(Result.isFailure(stale)).toBe(true);

				if (Result.isFailure(stale)) {
					expect(String(stale.failure)).toMatch(/newer|changed|version/i);
				}

				expect(yield* h.fs.readFileString(h.file)).toBe(newer);
			}),
		);
	});

	it("K19: source and clocks are retained, file-writer unknowns stay null, and client clocks never order edits", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened();
				const future = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"]), {
					...FROM,
					said: 9_999_999_999_999,
				});
				const past = yield* h.edit(bind("tezgah.zoom", ["<prefix>u"]), {
					...FROM,
					window: "window-2",
					said: -500,
				});
				expect(row(past.keys, "tezgah.zoom")?.keys[0]?.key).toBe("u");
				expect(future.changes.at(-1)).toMatchObject({
					by: "owner",
					said: 9_999_999_999_999,
					window: "window-1",
					how: "pressed",
					version: future.version,
					at: expect.any(Number),
					before: expect.anything(),
					after: expect.anything(),
					displaced: [],
				});
				expect(past.changes.at(-1)?.said).toBe(-500);
				yield* h.fs.writeFileString(h.file, 'tezgah.zoom = "<prefix>v"\n');
				yield* until("file record", () => h.seen.at(-1)?.changes.at(-1)?.how === "file");
				const file = h.seen.at(-1)?.changes.at(-1);
				expect(file).toMatchObject({
					by: null,
					said: null,
					window: null,
					how: "file",
					at: expect.any(Number),
					modified: expect.any(Number),
				});
				expect(file?.at).toBeGreaterThanOrEqual(past.changes.at(-1)?.at ?? 0);
			}),
		);
	});
	it("K10: a new row goes into its own table, as a [tezgah] header or an inline table holds it", async () => {
		await go(
			Effect.gen(function* () {
				const header = yield* opened(
					'# mine\n[tezgah]\nzoom = "<prefix>m" # keep\n\n[palette]\nopen = "cmd+p"\n',
				);
				yield* header.edit(bind("tezgah.close", ["<prefix>c"]));
				yield* header.edit(bind('tezgah."split --to down"', ["<prefix>v"]));
				const tabled = yield* header.fs.readFileString(header.file);
				expect(tabled).toBe(
					'# mine\n[tezgah]\nzoom = "<prefix>m" # keep\nclose = ["<prefix>c"]\n"split --to down" = ["<prefix>v"]\n\n[palette]\nopen = "cmd+p"\n',
				);
				expect(Result.isSuccess(decodeKeys(tabled, true))).toBe(true);

				const inline = yield* opened('tezgah = { zoom = "<prefix>m" }\n');
				yield* inline.edit(bind("tezgah.close", ["<prefix>c"]));
				yield* inline.edit(bind("tezgah.zoom", ["<prefix>u"]));
				const written = yield* inline.fs.readFileString(inline.file);
				expect(written).toBe('tezgah = { zoom = ["<prefix>u"], close = ["<prefix>c"] }\n');
				const reset = yield* inline.edit(Edit.cases.reset.make({does: "tezgah.zoom"}));
				expect(row(reset.keys, "tezgah.zoom")).toEqual(row(defaults, "tezgah.zoom"));
				expect(parse(yield* inline.fs.readFileString(inline.file))).toEqual({
					tezgah: {close: ["<prefix>c"]},
				});
			}),
		);
	});

	it("a save writes through a symlinked keybindings.toml and keeps the file's mode", async () => {
		await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const dir = yield* fs.makeTempDirectoryScoped({prefix: "kb-"});
				yield* fs.makeDirectory(join(dir, "dotfiles"));
				const real = join(dir, "dotfiles", "keys.toml");
				yield* fs.writeFileString(real, "# linked\n");
				yield* fs.chmod(real, 0o640);
				const link = join(dir, "keybindings.toml");
				yield* fs.symlink(real, link);
				const manager = yield* KeybindingManager.make({folder: dir, mac: true, by: "owner"});
				yield* manager.edit(bind("tezgah.zoom", ["<prefix>m"]), FROM);
				expect(lstatSync(link).isSymbolicLink()).toBe(true);
				expect(yield* fs.readFileString(real)).toBe('# linked\ntezgah.zoom = ["<prefix>m"]\n');
				expect((yield* fs.stat(real)).mode & 0o777).toBe(0o640);
				expect(yield* fs.readDirectory(join(dir, "dotfiles"))).toEqual(["keys.toml"]);
			}),
		);
	});

	it("each snapshot carries only the newest changes, and Undo still works past the cap", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened();
				let last: Snapshot | null = null;

				for (let i = 0; i < 25; i += 1) {
					last = yield* h.edit(bind("tezgah.zoom", [i % 2 === 0 ? "<prefix>m" : "<prefix>u"]));
				}

				expect(last?.changes).toHaveLength(20);
				expect(last?.changes.at(-1)?.version).toBe(last?.version);
				const undone = yield* h.edit(Edit.cases.undo.make({version: last?.version ?? ""}));
				expect(row(undone.keys, "tezgah.zoom")?.keys[0]?.key).toBe("u");
			}),
		);
	});
	it("K11: a failed save names keybindings.toml, never the machine's path to it", async () => {
		await go(
			Effect.gen(function* () {
				const h = yield* opened('prefix = "ctrl+a"\n');
				yield* h.fs.remove(h.file);
				yield* h.fs.makeDirectory(h.file);
				const result = yield* h.edit(bind("tezgah.zoom", ["<prefix>m"])).pipe(Effect.result);
				expect(Result.isFailure(result)).toBe(true);
				const why = Result.isFailure(result) ? String(result.failure) : "";
				expect(why).toContain("save of keybindings.toml failed:");
				expect(why).not.toContain(h.dir);
				expect(why).not.toMatch(/\/(?:var|tmp|Users|home)\//);
			}),
		);
	});
});
