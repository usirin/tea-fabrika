// `no-promises` (exam item 1): every Promise shape fires in next/, and the Effect ones pass.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const CODE = "fabrika(no-promises)";
const FIRES = "next/packages/libfabrika/src/app/fires.ts";
const PASSES = "next/packages/libfabrika/src/app/passes.ts";

const fires = [
	'import {Effect, Stream} from "effect";', // 1
	"declare const p: Promise<number>;", // 2
	"export const a = async () => 1;", // 3
	"export async function b() { return 1; }", // 4
	"export const c = function* () { return 1; };", // 5: passes, a generator
	"export const d = async function () { await p; };", // 6: twice, async and await
	"export const e = new Promise<number>(() => undefined);", // 7
	"export const f = Promise.resolve(1);", // 8
	"export const g = Promise.all([p]);", // 9
	"export const h = p.then((x) => x);", // 10
	"export const i = p.catch(() => 0);", // 11
	"export const j = Effect.promise(() => p);", // 12
	'export const k = import("./passes.ts");', // 13
	"export const l = async () => { for await (const x of [p]) void x; };", // 14: twice
	"export const m = Stream.make(1);", // 15: passes
].join("\n");

const passes = [
	'import {Effect, Option} from "effect";',
	'import * as Stream from "effect/Stream";',
	"declare const thing: Effect.Effect<number, Error>;",
	"export const a = Effect.catch(thing, () => Effect.succeed(0));",
	"export const b = thing.pipe(Effect.catch(() => Effect.succeed(0)));",
	"export const c = Stream.catch(Stream.make(1), () => Stream.make(2));",
	"export const d = Option.some(1);",
	"export const e = Effect.gen(function* () { return yield* thing; });",
	"export const f = Effect.tryPromise({try: () => fetch('x'), catch: () => new Error('x')});",
].join("\n");

describe("no-promises", () => {
	const all = plant({
		[FIRES]: fires,
		[PASSES]: passes,
		"next/packages/libfabrika/src/app/fires.test.ts": "export const t = async () => await 1;",
		"packages/today/src/old.ts": "export const t = async () => 1;",
	});

	it("fires on every Promise shape", () => {
		expect(all(CODE, FIRES)).toEqual([3, 4, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14]);
	});

	it("passes Effect's own catch, a generator and a module named Stream", () => {
		expect(all(CODE, PASSES)).toEqual([]);
	});

	it("leaves tests and today's code alone", () => {
		expect(all(CODE, "next/packages/libfabrika/src/app/fires.test.ts")).toEqual([]);
		expect(all(CODE, "packages/today/src/old.ts")).toEqual([]);
	});
});
