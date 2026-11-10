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
import {describe, expect, it} from "vitest";
import {settingsFile, settingsFolder} from "./settings.ts";

// The one reader of the person's settings folder, shared by keybindings.toml and, later,
// fabrika.toml's theme (plan for ticket 174, "one reader of ~/.fabrika/"). Today's version. Each
// test reads a temp folder of its own, never the person's real one.
//
//   no file                   {_tag: "none"}
//   a file that decodes       {_tag: "read", value}
//   a file that does not      {_tag: "refused", line, why}
//   a save, in place or by a rename over it   the next answer, with no restart
//
// Which folder (p11): an owner's start reads ~/.fabrika; a start on a home of its own (a test or
// an agent, FABRIKA_HOME set) reads that home.

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** A made-up decoder: a file that starts with `bad` is refused on line 1, any other is its text. */
const decode = (text: string) => {
	const said = text.trim();
	return said.startsWith("bad") ? Result.fail({line: 1, why: said}) : Result.succeed(said);
};

type Answer = {readonly _tag: string} & Record<string, unknown>;

/** Every answer the reader gives for `name` in `folder`, as they come, until the test's end. */
const watching = (folder: string, name: string) =>
	Effect.gen(function* () {
		const got: Answer[] = [];
		yield* settingsFile(folder, name, decode).pipe(
			Stream.runForEach((answer) => Effect.sync(() => got.push(answer))),
			Effect.forkScoped,
		);
		return got;
	});

/** Wait for `check` to hold, a few seconds at most. */
const until = (what: string, check: () => boolean) =>
	Effect.gen(function* () {
		for (let i = 0; i < 2000; i += 1) {
			if (check()) {
				return;
			}

			yield* Effect.sleep("5 millis");
		}

		return yield* Effect.die(`waited for ${what}`);
	});

const folder = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	return {fs, dir: yield* fs.makeTempDirectoryScoped({prefix: "fs-"})};
});

const last = (got: readonly Answer[]) => got.at(-1);

describe("the settings folder", () => {
	it("is ~/.fabrika for the owner's start, and the home for a start on a home of its own (p11)", () => {
		expect(settingsFolder({kind: "owner"}, "/home/someone")).toBe(
			join("/home/someone", ".fabrika"),
		);
		expect(settingsFolder({kind: "quiet", home: "/tmp/fh-1"}, "/home/someone")).toBe("/tmp/fh-1");
		expect(settingsFolder({kind: "foreground", home: "/tmp/fh-2"}, "/home/someone")).toBe(
			"/tmp/fh-2",
		);
	});
});

describe("a settings file", () => {
	it("K11: permission failure is reported as refused, never as a missing file", async () => {
		const got = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				const broken = FileSystem.FileSystem.of({
					...fs,
					readFileString: () =>
						Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method: "readFileString",
								description: "test denies the read",
								pathOrDescriptor: join(dir, "keybindings.toml"),
							}),
						),
				});
				return yield* settingsFile(dir, "keybindings.toml", decode).pipe(
					Stream.take(1),
					Stream.runCollect,
					Effect.provideService(FileSystem.FileSystem, broken),
				);
			}),
		);
		expect(got).toEqual([
			expect.objectContaining({
				_tag: "refused",
				// No path from this machine. The screen already names the file and line before it.
				why: "it could not be read: permission denied",
			}),
		]);
	});
	it("answers none when there is no file, and when there is no folder", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {dir} = yield* folder;
				const here = yield* watching(dir, "keybindings.toml");
				const nowhere = yield* watching(join(dir, "missing"), "keybindings.toml");
				yield* until("both answers", () => here.length > 0 && nowhere.length > 0);
				return {here: here[0], nowhere: nowhere[0]};
			}),
		);
		expect(seen).toEqual({here: {_tag: "none"}, nowhere: {_tag: "none"}});
	});

	it("answers what the file decodes to, or why it does not, with its line", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				yield* fs.writeFileString(join(dir, "good.toml"), "ctrl+a\n");
				yield* fs.writeFileString(join(dir, "bad.toml"), "bad: tezgah.zom is not a command\n");
				const good = yield* watching(dir, "good.toml");
				const bad = yield* watching(dir, "bad.toml");
				yield* until("both answers", () => good.length > 0 && bad.length > 0);
				return {good: good[0], bad: bad[0]};
			}),
		);
		expect(seen).toEqual({
			good: {_tag: "read", value: "ctrl+a"},
			bad: {_tag: "refused", line: 1, why: "bad: tezgah.zom is not a command"},
		});
	});

	it("reads the file again on each save: written in place, renamed over, refused, removed", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				const path = join(dir, "keybindings.toml");
				const got = yield* watching(dir, "keybindings.toml");
				yield* until("the first answer", () => got.length > 0);
				const steps: (Answer | undefined)[] = [last(got)];
				yield* fs.writeFileString(path, "one");
				yield* until("one", () => last(got)?.value === "one");
				steps.push(last(got));
				// An editor saves by writing a new file and renaming it over the old one.
				yield* fs.writeFileString(join(dir, ".keybindings.toml.swp"), "two");
				yield* fs.rename(join(dir, ".keybindings.toml.swp"), path);
				yield* until("two", () => last(got)?.value === "two");
				steps.push(last(got));
				yield* fs.writeFileString(path, "bad again");
				yield* until("the refusal", () => last(got)?._tag === "refused");
				steps.push(last(got));
				yield* fs.remove(path);
				yield* until("none again", () => last(got)?._tag === "none");
				steps.push(last(got));
				return steps;
			}),
		);
		expect(seen).toEqual([
			{_tag: "none"},
			{_tag: "read", value: "one"},
			{_tag: "read", value: "two"},
			{_tag: "refused", line: 1, why: "bad again"},
			{_tag: "none"},
		]);
	});

	it("reads each file apart: a bad file beside it changes nothing in its answers", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				yield* fs.writeFileString(join(dir, "keybindings.toml"), "ctrl+a");
				const keys = yield* watching(dir, "keybindings.toml");
				const theme = yield* watching(dir, "fabrika.toml");
				yield* until("both answers", () => keys.length > 0 && theme.length > 0);
				yield* fs.writeFileString(join(dir, "fabrika.toml"), "bad theme");
				yield* until("the theme's refusal", () => last(theme)?._tag === "refused");
				// A moment for a stray answer to come, if one would.
				yield* Effect.sleep("100 millis");
				return keys.map((a) => a._tag);
			}),
		);
		expect(seen.every((tag) => tag === "read")).toBe(true);
	});
});

describe("a settings file, when the folder cannot be watched", () => {
	/** The machine's FileSystem, with a watch that fails before it is ready. */
	const watchFails = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return FileSystem.FileSystem.of({
			...fs,
			watch: () =>
				Stream.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "FileSystem",
						method: "watch",
						description: "a watch that never starts",
					}),
				),
		});
	});

	it("still answers once from the file, and does not wait on the watch", async () => {
		const got = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				yield* fs.writeFileString(join(dir, "keybindings.toml"), "ctrl+a");
				const broken = yield* watchFails;
				return yield* settingsFile(dir, "keybindings.toml", decode).pipe(
					Stream.runCollect,
					Effect.provideService(FileSystem.FileSystem, broken),
					Effect.timeout("3 seconds"),
				);
			}),
		);
		expect(got).toEqual([{_tag: "read", value: "ctrl+a"}]);
	});

	it("answers once from the file when the folder is under a file, and ends", async () => {
		const got = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				// A file where the folder should be: no folder can be made there.
				yield* fs.writeFileString(join(dir, "not-a-folder"), "");
				return yield* settingsFile(join(dir, "not-a-folder"), "keybindings.toml", decode).pipe(
					Stream.runCollect,
					Effect.timeout("3 seconds"),
				);
			}),
		);
		expect(got).toEqual([{_tag: "none"}]);
	});
});

describe("a settings file, saved with the same text", () => {
	it("answers once, not again for each save", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {fs, dir} = yield* folder;
				const path = join(dir, "keybindings.toml");
				const got = yield* watching(dir, "keybindings.toml");
				yield* until("the first answer", () => got.length > 0);
				yield* fs.writeFileString(path, "one");
				yield* until("one", () => last(got)?.value === "one");
				// The same text saved again, then a new one, so the test knows the second was heard.
				yield* fs.writeFileString(path, "one");
				yield* Effect.sleep("200 millis");
				yield* fs.writeFileString(path, "two");
				yield* until("two", () => last(got)?.value === "two");
				return [...got];
			}),
		);
		expect(seen).toEqual([
			{_tag: "none"},
			{_tag: "read", value: "one"},
			{_tag: "read", value: "two"},
		]);
	});
});
