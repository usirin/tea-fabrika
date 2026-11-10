import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";
import {type Finding, fingerprint, outside, settle} from "./ledger.ts";

const options = {seed: 119120, numRuns: 200};

const finding = fc.record({
	file: fc.constantFrom(".agents/a.ts", ".agents/skills/b/scripts/b.mjs", "next/c.ts", "d.ts"),
	rule: fc.constantFrom("fabrika(no-promises)", "fabrika(no-of)"),
	code: fc.constantFrom("x", "await y;", "const z = 1;"),
});

const count = (xs: readonly Finding[], x: Finding) =>
	xs.filter((y) => y.file === x.file && y.rule === x.rule && y.code === x.code).length;

describe("agents-ledger.json, 0033", () => {
	it("each finding is waived or blocks, never both, and order is kept", () => {
		fc.assert(
			fc.property(fc.array(finding), fc.array(finding), (entries, findings) => {
				const {waived, blocks} = settle(entries, findings);
				expect(waived.length + blocks.length).toBe(findings.length);
				expect(findings.filter((f) => waived.includes(f))).toEqual(waived);
				expect(findings.filter((f) => blocks.includes(f))).toEqual(blocks);
			}),
			options,
		);
	});

	it("one entry covers one finding: a second equal line needs a second entry", () => {
		fc.assert(
			fc.property(fc.array(finding), fc.array(finding), (entries, findings) => {
				const {waived} = settle(entries, findings);
				for (const f of waived) expect(count(waived, f)).toBeLessThanOrEqual(count(entries, f));
			}),
			options,
		);
	});

	it("the ledger only shrinks: kept entries are ledger entries a finding matched, in order", () => {
		fc.assert(
			fc.property(fc.array(finding), fc.array(finding), (entries, findings) => {
				const {kept, waived} = settle(entries, findings);
				expect(entries.filter((e) => kept.includes(e))).toEqual(kept);
				expect(kept.length).toBe(waived.length);
				// Settling again on what was kept changes nothing.
				expect(settle(kept, findings).kept).toEqual(kept);
			}),
			options,
		);
	});

	it("only `.agents/` findings can be waived; an entry anywhere else is refused", () => {
		fc.assert(
			fc.property(fc.array(finding), fc.array(finding), (entries, findings) => {
				const {waived, blocks} = settle(entries, findings);
				for (const f of waived) expect(f.file.startsWith(".agents/")).toBe(true);
				for (const f of findings.filter((f) => !f.file.startsWith(".agents/")))
					expect(blocks).toContain(f);
				expect(outside(entries)).toEqual(entries.filter((e) => !e.file.startsWith(".agents/")));
			}),
			options,
		);
	});

	it("scenario: a line that moves keeps its entry, a line that changes loses it", () => {
		const entry = {file: ".agents/a.ts", rule: "fabrika(no-promises)", code: "await y;"};
		const moved = {...entry, code: fingerprint("\t\t  await   y;  ")};
		const changed = {...entry, code: fingerprint("await y2;")};
		expect(settle([entry], [moved]).blocks).toEqual([]);
		expect(settle([entry], [changed]).blocks).toEqual([changed]);
		expect(settle([entry], [changed]).kept).toEqual([]);
	});
});

describe("`.agents/` code is held to next/'s rules, 0033", () => {
	const script = ".agents/skills/x/scripts/a.ts";
	const test = ".agents/skills/x/scripts/a.test.ts";
	const body = [
		'import {readFileSync} from "node:fs";',
		"export const a = async () => readFileSync(await Promise.resolve(''));",
		"export const fooOf = 1;",
	].join("\n");

	it("scenario: the rules fire in a script and the test rules stay off in its test", async () => {
		const fires = await plant({[script]: body, [test]: body});
		expect(fires("fabrika(no-node-imports)", script)).toEqual([1]);
		expect(fires("fabrika(no-node-filesystem)", script)).toEqual([1]);
		expect(fires("fabrika(no-promises)", script).length).toBeGreaterThan(0);
		expect(fires("fabrika(no-of)", script)).toEqual([3]);
		expect(fires("fabrika(no-promises)", test)).toEqual([]);
		expect(fires("fabrika(no-of)", test)).toEqual([3]);
	});
});
