import {readFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {fabrika, fabrikaLight} from "@kampus/fabrika-design";
import {Effect, FileSystem, Layer, Logger, type Path, Result, Stream} from "effect";
import fc from "fast-check";
import {stringify} from "smol-toml";
import {describe, expect, it} from "vitest";

// Today's app, T343 review 2, class 1: the host's theme loader (T12, T14, T25) and `theme-check`.
// Contract for build, in host/themes.ts and themes/check.ts:
//
//   appliedTheme(folder) : Stream<Loaded, never, FileSystem | Path>
//     Loaded = {name, source: "builtin" | "file", value: Theme, version,
//               report: {name, changes, failures, diagnostics}}
//   themeCheck(folder)   : Effect<Report, never, FileSystem | Path>   // the same report, writes nothing
//
// It reads `theme`, `theme-fix` and `theme-contrast` from fabrika.toml and themes/<name>.toml
// through settings.ts's one reader, decodes, and checks with the shared checker at the measured
// cap and repair version (tokens/repair.toml). A file that does not decode, or a pick with no
// file, keeps fabrika and says why. Load never writes a file. Diagnostics and logs name files as
// a person knows them, never the folder's path, unrelated settings or a theme's text.
// Plants: ignore theme-fix; miss a rename save; keep a stale theme after deletion; save the
// repaired result; print the folder path or an unrelated setting.

interface Report {
	readonly name: string;
	readonly changes: readonly unknown[];
	readonly failures: readonly unknown[];
	readonly diagnostics: readonly {readonly file: string}[];
}
interface Loaded {
	readonly name: string;
	readonly source: "builtin" | "file";
	readonly value: {
		readonly look: string;
		readonly colors: Readonly<Record<string, string>>;
		readonly terminal: unknown;
	};
	readonly version: string;
	readonly report: Report;
}
interface HostThemes {
	readonly appliedTheme: (
		folder: string,
	) => Stream.Stream<Loaded, never, FileSystem.FileSystem | Path.Path>;
}
interface ThemeCheck {
	readonly themeCheck: (
		folder: string,
	) => Effect.Effect<Report, never, FileSystem.FileSystem | Path.Path>;
}
type Theme = {readonly look: string; readonly colors: object; readonly terminal: object};
interface Checker {
	readonly check: (
		theme: Theme,
		pairs: unknown,
		policy: {fix: "nudge" | "off"; contrast: number},
		version: {version: string; cap: number},
	) => {shown: Loaded["value"]; changes: readonly unknown[]; failures: readonly unknown[]};
}
interface Decoder {
	readonly decodeTheme: (text: string, file?: string) => Result.Result<Theme, unknown>;
}
interface Contract {
	readonly pairs: unknown;
}

// Modules build has not made are loaded by path, so their absence is a runtime red.
const built = <T>(path: string): Promise<T> =>
	import(/* @vite-ignore */ new URL(path, import.meta.url).pathname) as Promise<T>;
const DESIGN = "../../../../packages/fabrika-design/src/";

const repair = readFileSync(new URL(`${DESIGN}../tokens/repair.toml`, import.meta.url), "utf8");
const VERSION = {
	version: /^version = "([^"]+)"$/m.exec(repair)?.[1] ?? "",
	cap: Number(/^cap = ([\d.]+)$/m.exec(repair)?.[1]),
};

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const until = (what: string, ok: () => boolean) =>
	Effect.gen(function* () {
		for (let i = 0; i < 600; i += 1) {
			if (ok()) return;
			yield* Effect.sleep("5 millis");
		}
		return yield* Effect.die(`waited for ${what}`);
	});

type Op =
	| {
			readonly _tag: "settings";
			readonly pick: string;
			readonly fix: "nudge" | "off";
			readonly contrast: number;
	  }
	| {readonly _tag: "theme"; readonly text: string; readonly rename: boolean}
	| {readonly _tag: "broken"}
	| {readonly _tag: "remove"};

describe("T12/T14/T25 the host loads the selected theme from settings and its file", () => {
	it("gives the latest choice after any saves, never writes, and keeps private data out", async () => {
		const {decodable, name} = await import("../../../../fixtures/themes/laws.ts");
		const {appliedTheme} = await built<HostThemes>("./themes.ts");
		const {themeCheck} = await built<ThemeCheck>("../themes/check.ts");
		const {check} = await built<Checker>(`${DESIGN}build/contrast.ts`);
		const {decodeTheme} = await built<Decoder>(`${DESIGN}theme.ts`);
		const {pairs} = await built<Contract>(`${DESIGN}theme-contract.ts`);
		const op: fc.Arbitrary<Op> = fc.oneof(
			fc.record({
				_tag: fc.constant("settings" as const),
				pick: fc.constantFrom("fabrika", "fabrika-light", "mine"),
				fix: fc.constantFrom("nudge" as const, "off" as const),
				contrast: fc.constantFrom(4.5, 7, 21),
			}),
			fc.record({
				_tag: fc.constant("theme" as const),
				text: decodable.map((t) => stringify({...t, name: "mine"})),
				rename: fc.boolean(),
			}),
			fc.constant({_tag: "broken" as const}),
			fc.constant({_tag: "remove" as const}),
		);
		await fc.assert(
			fc.asyncProperty(fc.array(op, {minLength: 1, maxLength: 6}), name, async (ops, word) => {
				const secret = `invented-secret-${word}`;
				const logs: string[] = [];
				const logger = Logger.make((o) => {
					logs.push(Logger.formatSimple.log(o));
				});
				await Effect.runPromise(
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						const dir = yield* fs.makeTempDirectoryScoped({prefix: "fh-"});
						yield* fs.makeDirectory(join(dir, "themes"), {recursive: true});
						const got: Loaded[] = [];
						yield* appliedTheme(dir).pipe(
							Stream.runForEach((loaded) => Effect.sync(() => got.push(loaded))),
							Effect.forkScoped,
						);
						let settings = {pick: "fabrika", fix: "nudge" as "nudge" | "off", contrast: 4.5};
						let file: string | null = null;
						const mine = join(dir, "themes", "mine.toml");
						for (const o of ops) {
							if (o._tag === "settings") {
								settings = o;
								yield* fs.writeFileString(
									join(dir, "fabrika.toml"),
									`theme = "${o.pick}"\ntheme-fix = "${o.fix}"\ntheme-contrast = ${o.contrast}\nunrelated = "${secret}"\n`,
								);
							} else if (o._tag === "theme") {
								file = o.text;
								if (o.rename) {
									yield* fs.writeFileString(`${mine}.tmp`, o.text);
									yield* fs.rename(`${mine}.tmp`, mine);
								} else yield* fs.writeFileString(mine, o.text);
							} else if (o._tag === "broken") {
								file = `format = 1\nname = "mine"\nsecret = "${secret}"\n[colors`;
								yield* fs.writeFileString(mine, file);
							} else {
								file = null;
								yield* fs.remove(mine, {force: true});
							}
							const decoded =
								settings.pick === "mine" && file !== null
									? decodeTheme(file, "mine.toml")
									: undefined;
							const want =
								settings.pick === "fabrika-light"
									? {source: "builtin", value: fabrikaLight, changes: [], failures: []}
									: settings.pick === "mine" && decoded !== undefined && Result.isSuccess(decoded)
										? (() => {
												const c = check(decoded.success, pairs, settings, VERSION);
												return {
													source: "file",
													value: c.shown,
													changes: c.changes,
													failures: c.failures,
												};
											})()
										: {source: "builtin", value: fabrika, changes: [], failures: []};
							const refused =
								settings.pick === "mine" && (decoded === undefined || Result.isFailure(decoded));
							const matches = (l: Loaded | undefined) =>
								l !== undefined &&
								l.source === want.source &&
								l.version === VERSION.version &&
								JSON.stringify(l.value.colors) === JSON.stringify(want.value.colors) &&
								JSON.stringify(l.value.terminal) === JSON.stringify(want.value.terminal) &&
								JSON.stringify(l.report.changes) === JSON.stringify(want.changes) &&
								JSON.stringify(l.report.failures) === JSON.stringify(want.failures) &&
								l.report.diagnostics.some((d) => d.file === "mine.toml") === refused;
							yield* until(`the loaded theme after ${o._tag}`, () => matches(got.at(-1)));
						}
						// T12: loading never wrote a file; the person's bytes are as written.
						const listed = (yield* fs.readDirectory(join(dir, "themes"))).sort();
						expect(listed).toEqual(file === null ? [] : ["mine.toml"]);
						expect(file === null ? null : yield* fs.readFileString(mine)).toBe(file);
						// theme-check prints the same report and writes nothing.
						const report = yield* themeCheck(dir);
						expect(JSON.stringify(report)).toBe(JSON.stringify(got.at(-1)?.report));
						expect((yield* fs.readDirectory(join(dir, "themes"))).sort()).toEqual(listed);
						// T25: no folder path, unrelated setting or theme text in any output.
						const outputs = JSON.stringify([got, report, logs]);
						for (const value of [dir, secret, ...(file === null ? [] : [file])])
							for (const form of [value, encodeURI(value), encodeURIComponent(value)])
								expect(outputs.includes(form)).toBe(false);
					}).pipe(
						Effect.scoped,
						Effect.provide(Layer.mergeAll(platform, Logger.layer([logger]))),
					) as Effect.Effect<void, unknown, never>,
				);
			}),
			{seed: 119120, numRuns: 8},
		);
	}, 120_000);
});
