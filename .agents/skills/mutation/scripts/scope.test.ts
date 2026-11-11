import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inScope, pick, PRODUCT, related } from "./scope.ts";

const options = { seed: 119120, numRuns: 200 };

// Script paths are built from their stems, so the script-reads lint does not take this file for a
// reader of the scripts it names: they are data here, never read.
const skill = (name: string, stem: string, end = ".ts") => `.agents/skills/${name}/scripts/${stem}${end}`;
const lead = (stem: string, end = ".ts") => skill("lead", stem, end);
const LANE = ["chain", "drive"].flatMap((stem) => [lead(stem), lead(stem, ".test.ts")]);

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);

const ending = fc.constantFrom(
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".test.ts",
  ".test.tsx",
  ".d.ts",
  ".md",
  ".sh",
  ".py",
  ".json",
);

const file = fc.tuple(segment, ending).map(([name, end]) => `${name}${end}`);

/** Code outside `.agents/`: the folders that hold code today, any depth, any file. */
const product = fc
  .tuple(
    fc.constantFrom("apps", "packages", "programs", "next", "scripts", "oxlint-plugins", ".github", "fixtures", "docs"),
    fc.array(segment, { maxLength: 3 }),
    file,
  )
  .map(([top, folders, name]) => [top, ...folders, name].join("/"));

/** Lead tooling that is not lane code: any skill's files, and the lead's other scripts. */
const otherLead = fc.oneof(
  fc.tuple(segment, file).map(([name, file]) => `.agents/skills/${name === "lead" ? "leads" : name}/scripts/${file}`),
  file.map((name) => lead("", name)).filter((path) => !LANE.includes(path)),
  fc.constantFrom(
    ".agents/skills/lead/SKILL.md",
    lead("mutbox"),
    lead("gc"),
    lead("lane"),
    lead("agents"),
    skill("mutation", "sample"),
    lead("flow"),
    lead("flowers/a"),
    lead("chain", ".tsx"),
    lead("chain", ".cleanup.test.ts"),
    ".agents/tsconfig.json",
  ),
);

/** Lane code: the chain and drive scripts and the flow runner's folder, with their tests. */
const lane = fc.oneof(
  fc.constantFrom(...LANE),
  fc
    .tuple(fc.array(segment, { maxLength: 2 }), file)
    .map(([folders, name]) => [".agents/skills/lead/scripts/flow", ...folders, name].join("/")),
);

const leadCode = fc.oneof(lane, otherLead);
const anyPath = fc.oneof(product, lane, otherLead);

// The `range` step before 0089, read as git reads its pathspecs: `*` crosses `/`. For each changed
// product file its two test names, and each changed test, sorted and unique.
const before = (changed: ReadonlyArray<string>) => {
  const code = (path: string) =>
    /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path) && !path.includes(".test.") && !/\.d\.[mc]?ts$/.test(path);
  const tests = changed.flatMap((path) =>
    code(path)
      ? [".test.ts", ".test.tsx"].map((end) => `${path.slice(0, path.lastIndexOf("."))}${end}`)
      : /\.test\.tsx?$/.test(path)
        ? [path]
        : [],
  );
  return [...new Set(tests)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

describe("the mutation run's file pick (0089)", () => {
  it("property: product code is picked as before 0089, whatever lead tooling sits beside it", () => {
    fc.assert(
      fc.property(fc.array(product, { maxLength: 12 }), fc.array(otherLead, { maxLength: 6 }), (code, lead) => {
        expect(pick(code)).toEqual(code);
        expect(related(code)).toEqual(before(code));
        expect(related([...lead, ...code, ...lead])).toEqual(before(code));
      }),
      options,
    );
  });

  it("property: lane code is in, and its tests are picked as product code's are", () => {
    fc.assert(
      fc.property(
        fc.array(lane, { minLength: 1, maxLength: 8 }),
        fc.array(fc.oneof(product, otherLead), { maxLength: 8 }),
        (ours, rest) => {
          const changed = [...rest, ...ours];
          expect(pick(changed).filter((path) => path.startsWith(".agents/"))).toEqual(
            changed.filter((path) => path.startsWith(".agents/") && ours.includes(path)),
          );

          for (const test of before(ours)) {
            expect(related(changed)).toContain(test);
          }
        },
      ),
      options,
    );
  });

  it("property: every other lead script, shell helper and skill text is out, and so are its tests", () => {
    fc.assert(
      fc.property(fc.array(otherLead, { maxLength: 12 }), (lead) => {
        expect(pick(lead)).toEqual([]);
        expect(related(lead)).toEqual([]);
      }),
      options,
    );
  });

  it("property: a lead `.ts` file's `name.test.ts` is in exactly when the file is", () => {
    fc.assert(
      fc.property(
        leadCode.filter((path) => path.endsWith(".ts")),
        (path) => {
          const code = before([path]).filter((test) => test.endsWith(".test.ts") && test !== path);

          for (const test of code) {
            expect(inScope(test), test).toBe(inScope(path));
          }
        },
      ),
      options,
    );
  });

  it("property: the pick keeps order and never adds a path", () => {
    fc.assert(
      fc.property(fc.array(anyPath, { maxLength: 16 }), (changed) => {
        const kept = pick(changed);
        expect(kept).toEqual(changed.filter((path) => kept.includes(path)));
        expect(related(changed)).toEqual(related(kept));
      }),
      options,
    );
  });

  it.each([
    // vector: `.agents/` counts only at the top of the repo.
    [`apps/x/${lead("gc")}`, true],
    // vector: the flow runner is a folder; files named like it beside it are out.
    [lead("flow/machine"), true],
    [lead("flow/flows/land-decision"), true],
    [lead("flow"), false],
    [lead("flowers/a"), false],
    // vector: the chain and drive scripts only in the lead skill, by their exact names.
    [skill("mutation", "chain"), false],
    [lead("chain", ".cleanup.test.ts"), false],
    [lead("drive", ".tsx"), false],
    // vector: 0089's out list by name.
    [lead("mutbox"), false],
    [lead("gc"), false],
    [lead("lane"), false],
    [lead("agents"), false],
    [skill("mutation", "sample"), false],
    [lead("box", ".sh"), false],
    [".agents/skills/lead/SKILL.md", false],
  ])("%s in scope: %s", (path, expected) => {
    expect(inScope(path)).toBe(expected);
  });

  it("pinned: the sample script's pathspec is the list it held before 0089 moved it here", () => {
    expect(PRODUCT).toEqual([
      "*.ts",
      "*.tsx",
      "*.mts",
      "*.cts",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
      ":!*.test.*",
      ":!*.d.ts",
      ":!*.d.mts",
      ":!*.d.cts",
    ]);
  });
});
