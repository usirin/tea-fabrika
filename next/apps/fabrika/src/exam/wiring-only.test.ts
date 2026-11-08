// An app entry only wires (Tier 1, P19; docs/direction/where-each-piece-lives.md): `wiring-only`
// refuses a schema, a machine, a Cmd, a service, a branch and a hand-written plist in
// `next/apps/fabrika/src/entry/`, and lets plain composition, other app files and tests pass.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const RULE = "fabrika(wiring-only)";
const ENTRY = "next/apps/fabrika/src/entry/electron-main.ts";
const CLEAN = "next/apps/fabrika/src/entry/electron.tsx";
const OUTSIDE = "next/apps/fabrika/src/build.ts";
const TEST = "next/apps/fabrika/src/entry/electron-main.test.ts";

const planted = [
	'import {Cmd, Machine} from "@demlik/tea/effect";', // 1
	'import {Context, Effect, Schema} from "effect";', // 2
	"declare const home: string;", // 3
	"export const Options = Schema.Struct({home: Schema.String});", // 4: a schema
	'export class Down extends Schema.TaggedError<Down>()("Down", {}) {}', // 5: a Schema class
	'export class Mine extends Context.Service<Mine, {}>()("Mine") {}', // 6: a service of its own
	"export const desk = Machine.make({} as never);", // 7: a machine
	'export const go = Cmd.make("go", {} as never);', // 8: a Cmd
	"export const pick = (n: number) => {", // 9
	"\tif (n > 0) return 1;", // 10: a branch
	"\tswitch (n) { default: return 2; }", // 11: a branch
	"};", // 12
	'export const which = home === "" ? "a" : "b";', // 13: a branch
	'export const plist = "<plist version=\\"1.0\\"><dict><key>Label</key></dict></plist>";', // 14
	// oxlint-disable-next-line no-template-curly-in-string -- planted source text, a template on purpose
	"export const job = `<key>Label</key><string>${home}</string>`;", // 15
	"export const run = Effect.void;", // 16
].join("\n");

const clean = [
	'import {desktopApp} from "@kampus/libfabrika/electron";',
	'import {Effect} from "effect";',
	"declare const home: string;",
	"export const main = desktopApp({home, pages: {}, localBrain: {}, window: {}} as never).pipe(Effect.scoped);",
	'export const port = Number(process.env["FABRIKA_PORT"] ?? "4387");',
].join("\n");

describe("wiring-only", () => {
	const all = plant({[ENTRY]: planted, [CLEAN]: clean, [OUTSIDE]: planted, [TEST]: planted});

	it("fires on each schema, maker, branch and plist in an entry", () => {
		expect(all(RULE, ENTRY)).toEqual([4, 5, 6, 7, 8, 10, 11, 13, 14, 15]);
	});

	it("passes plain composition, app files outside entry/ and tests", () => {
		expect(all(RULE, CLEAN)).toEqual([]);
		expect(all(RULE, OUTSIDE)).toEqual([]);
		expect(all(RULE, TEST)).toEqual([]);
	});
});
