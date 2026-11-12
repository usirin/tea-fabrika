import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { type Finding, fingerprint, LEDGERS, outside, settle } from "./ledger.ts";

const options = { seed: 119120, numRuns: 200 };

const finding = fc.record({
  file: fc.constantFrom(".agents/a.ts", ".agents/skills/b/scripts/b.mjs", "next/c.ts", "d.ts"),
  rule: fc.constantFrom("fabrika(no-promises)", "fabrika(no-of)"),
  code: fc.constantFrom("x", "await y;", "const z = 1;"),
});

const count = (xs: readonly Finding[], x: Finding) =>
  xs.filter((y) => y.file === x.file && y.rule === x.rule && y.code === x.code).length;

const root = fc.constantFrom(...LEDGERS.map((ledger) => ledger.root));

describe("agents-ledger.json and next-ledger.json, 0033", () => {
  it("each finding is waived or blocks, never both, and order is kept", () => {
    fc.assert(
      fc.property(fc.array(finding), fc.array(finding), root, (entries, findings, at) => {
        const { waived, blocks } = settle(entries, findings, at);
        expect(waived.length + blocks.length).toBe(findings.length);
        expect(findings.filter((f) => waived.includes(f))).toEqual(waived);
        expect(findings.filter((f) => blocks.includes(f))).toEqual(blocks);
      }),
      options,
    );
  });

  it("one entry covers one finding: a second equal line needs a second entry", () => {
    fc.assert(
      fc.property(fc.array(finding), fc.array(finding), root, (entries, findings, at) => {
        const { waived } = settle(entries, findings, at);

        for (const f of waived) {
          expect(count(waived, f)).toBeLessThanOrEqual(count(entries, f));
        }
      }),
      options,
    );
  });

  it("the ledger only shrinks: kept entries are ledger entries a finding matched, in order", () => {
    fc.assert(
      fc.property(fc.array(finding), fc.array(finding), root, (entries, findings, at) => {
        const { kept, waived } = settle(entries, findings, at);
        expect(entries.filter((e) => kept.includes(e))).toEqual(kept);
        expect(kept.length).toBe(waived.length);
        // Settling again on what was kept changes nothing.
        expect(settle(kept, findings, at).kept).toEqual(kept);
      }),
      options,
    );
  });

  it("only findings in the ledger's own folder can be waived; an entry anywhere else is refused", () => {
    fc.assert(
      fc.property(fc.array(finding), fc.array(finding), root, (entries, findings, at) => {
        const { waived, blocks } = settle(entries, findings, at);

        for (const f of waived) {
          expect(f.file.startsWith(at)).toBe(true);
        }

        for (const f of findings.filter((f) => !f.file.startsWith(at))) {
          expect(blocks).toContain(f);
        }

        expect(outside(entries, at)).toEqual(entries.filter((e) => !e.file.startsWith(at)));
      }),
      options,
    );
  });

  // pinned: one ledger per folder, and no folder holds another, so a finding meets at most one.
  it("pinned: .agents/ and next/ each have one ledger", () => {
    expect(LEDGERS).toEqual([
      { file: "agents-ledger.json", root: ".agents/" },
      { file: "next-ledger.json", root: "next/" },
    ]);
  });

  it("scenario: a line that moves keeps its entry, a line that changes loses it", () => {
    const entry = { file: ".agents/a.ts", rule: "fabrika(no-promises)", code: "await y;" };
    const moved = { ...entry, code: fingerprint("\t\t  await   y;  ") };
    const changed = { ...entry, code: fingerprint("await y2;") };
    expect(settle([entry], [moved], ".agents/").blocks).toEqual([]);
    expect(settle([entry], [changed], ".agents/").blocks).toEqual([changed]);
    expect(settle([entry], [changed], ".agents/").kept).toEqual([]);
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

  // scenario: one script and its test, since the config is what is under test. Only next/'s tests
  // may turn an edge rule off (edge-comment.test.ts), so `no-promises` fires in an `.agents/` test.
  it("scenario: the rules fire in a script, and its test keeps the edge rules on", async () => {
    const fires = await plant({ [script]: body, [test]: body });
    expect(fires("fabrika(no-node-imports)", script)).toEqual([1]);
    expect(fires("fabrika(no-node-filesystem)", script)).toEqual([1]);
    expect(fires("fabrika(no-promises)", script).length).toBeGreaterThan(0);
    expect(fires("fabrika(no-of)", script)).toEqual([3]);
    expect(fires("fabrika(no-promises)", test).length).toBeGreaterThan(0);
    expect(fires("fabrika(no-node-imports)", test)).toEqual([]);
    expect(fires("fabrika(no-of)", test)).toEqual([3]);
  });
});
