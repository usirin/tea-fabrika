import * as fc from "fast-check";
// The React Compiler check (exam item 13, C1 and C5): every skip and purity finding fails, and the
// one way out is `"use no memo"` with a ledger row.
import {describe, expect, it} from "vitest";
import type {Row} from "./compiler.ts";

const at = async (file: string, text: string, ledger: readonly Row[] = []) => {
	const {check} = await import("./compiler.ts");
	return check(new Map([[file, text]]), ledger).map((f) => `${f.fn}:${f.line} ${f.why}`);
};

const CLEAN = [
	'import {useId} from "react";',
	"export const Tip = (props: {readonly text: string}) => {",
	"\tconst id = useId();",
	"\treturn <b id={id}>{props.text}</b>;",
	"};",
].join("\n");

const REF_IN_RENDER = [
	'import {useRef} from "react";',
	"export const Tip = () => {",
	"\tconst r = useRef(1);",
	"\treturn <b>{r.current}</b>;",
	"};",
].join("\n");

const NAMED = [
	'import {useRef} from "react";',
	"export const Tip = () => {",
	'\t"use no memo";',
	"\tconst r = useRef(1);",
	"\treturn <b>{r.current}</b>;",
	"};",
].join("\n");

const ROW: Row = {file: "next/a.tsx", fn: "Tip", why: "a planted row"};

describe("the compile step's check", () => {
	it("passes a view that compiles", async () => {
		expect(await at("next/a.tsx", CLEAN)).toEqual([]);
	});

	it("fails a skipped function, with its reason and line", async () => {
		expect(await at("next/a.tsx", REF_IN_RENDER)).toEqual([
			"Tip:4 Cannot access refs during render",
		]);
	});

	it('passes a function named with "use no memo" and a ledger row', async () => {
		expect(await at("next/a.tsx", NAMED, [ROW])).toEqual([]);
	});

	it('fails "use no memo" with no row', async () => {
		expect(await at("next/a.tsx", NAMED)).toEqual([
			expect.stringMatching(/^Tip:5 Cannot access refs/),
			expect.stringMatching(/^Tip:2 "use no memo" with no row/),
		]);
	});

	it("fails a stale row: no directive now, or no file", async () => {
		expect(await at("next/a.tsx", CLEAN, [ROW])).toEqual([
			expect.stringMatching(/^Tip:0 a stale row in compiler-ledger.json: this function/),
		]);
		expect(await at("next/a.tsx", CLEAN, [{...ROW, file: "next/gone.tsx"}])).toEqual([
			expect.stringMatching(/^Tip:0 a stale row in compiler-ledger.json: its file is gone/),
		]);
	});

	it("fails a clock read in render", async () => {
		const text = ["export const Clock = () => <b>{Date.now()}</b>;"].join("\n");
		expect(await at("next/a.tsx", text)).toEqual([
			expect.stringMatching(/^Clock:1 Cannot call impure function during render/),
		]);
	});

	it("counts lines in characters, not bytes, past non-ASCII text", async () => {
		const text = ["// Görünüm: çok satırlı bir açıklama ✨", REF_IN_RENDER].join("\n");
		expect(await at("next/a.tsx", text)).toEqual(["Tip:5 Cannot access refs during render"]);
	});

	it("compiles a dropped store value with no word, so one-store-hook must hold it", async () => {
		const text = [
			"declare const useModel: (s: unknown) => number;",
			"declare const store: unknown;",
			"declare const shown: {readonly count: number};",
			"export const Frozen = () => {",
			"\tuseModel(store);",
			"\treturn <b>{shown.count}</b>;",
			"};",
		].join("\n");
		expect(await at("next/a.tsx", text)).toEqual([]);
	});
	it("retains strict findings under generated source prefixes and changed files", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 0, max: 12}),
				fc.constantFrom("Counter", "Other", "Display"),
				async (lines, name) => {
					const {check, compile} = await import("./compiler.ts");
					const file = `next/${name}.tsx`;
					const prefix = "// non-ASCII é\n".repeat(lines);
					const good = `${prefix}${CLEAN.replaceAll("Tip", name)}`;
					const bad = `${prefix}${REF_IN_RENDER.replaceAll("Tip", name)}`;
					expect(check(new Map([[file, good]]), [])).toEqual([]);
					expect(check(new Map([[file, bad]]), [])).toEqual([
						expect.objectContaining({file, fn: name, line: lines + 4}),
					]);
					expect(compile(file, bad).errors.length).toBeGreaterThan(0);
				},
			),
			{seed: 119120, numRuns: 24},
		);
	});
});
