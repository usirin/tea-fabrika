// Ticket 907, slice A1. `fabrika/no-cause-squash` refuses every use of Effect's `Cause.squash` in
// next/'s product code (docs/direction/effect-code-guidelines.md, E2). Law 2 runs generated files in
// process through oxlint's RuleTester: an import spelling, some uses and some neighbors that must
// pass, one per line. Law 3 is one real oxlint run with the repo's config, since only the config
// says which paths are tests.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noCauseSquash } from "./no-cause-squash.ts";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const CODE = "fabrika(no-cause-squash)";
const REFUSED = /turns a typed failure into one unknown value/;

/**
 * How a file reaches Effect's `squash`: the import line, the module as the file writes it (`null`
 * when `squash` itself is imported by name), and the name a shadowing parameter takes.
 */
type Spelling = {
  readonly header: string;
  readonly module: string | null;
  readonly local: string;
};

const SPELLINGS: ReadonlyArray<(alias: string) => Spelling> = [
  // Case 1: the named import from the barrel.
  () => ({ header: 'import { Cause } from "effect";', module: "Cause", local: "Cause" }),
  // Case 2: the module as a namespace, under its own name and under another.
  () => ({ header: 'import * as Cause from "effect/Cause";', module: "Cause", local: "Cause" }),
  (alias) => ({ header: `import * as ${alias} from "effect/Cause";`, module: alias, local: alias }),
  // Case 4: a renamed import.
  (alias) => ({ header: `import { Cause as ${alias} } from "effect";`, module: alias, local: alias }),
  // The barrel as a namespace.
  (alias) => ({ header: `import * as ${alias} from "effect";`, module: `${alias}.Cause`, local: alias }),
  // Case 3: `squash` by name, under its own name and under another. It fires once, at the import.
  () => ({ header: 'import { squash } from "effect/Cause";', module: null, local: "squash" }),
  (alias) => ({ header: `import { squash as ${alias} } from "effect/Cause";`, module: null, local: alias }),
];

/** A use of `squash` on the module, numbered so two on one file declare two names. All fire. */
const USES: ReadonlyArray<(module: string, i: number) => string> = [
  (m, i) => `const u${i} = ${m}.squash(x);`,
  (m, i) => `const u${i} = ${m}.squash;`,
  // Case 5: a reference with no call.
  (m, i) => `const u${i} = xs.map(${m}.squash);`,
  // Case 6: the member as a string.
  (m, i) => `const u${i} = ${m}["squash"](x);`,
  (m, i) => `const u${i} = ${m}?.squash(x);`,
  (m, i) => `const { squash: u${i} } = ${m};`,
  (m, i) => `export const u${i} = (cause: unknown) => f(${m}.squash(cause));`,
];

/** Lines that name `squash` or `Cause` and use nothing of Effect's. None fires, in any file. */
const NEIGHBORS: ReadonlyArray<(spelling: Spelling, i: number) => string> = [
  // Case 7: another object's `squash`, and a `Cause` that is not Effect's.
  (_, i) => `const n${i} = git.squash(x);`,
  (_, i) => `const n${i} = Mine.squash(x);`,
  (_, i) => `const n${i} = mine(x);`,
  (s, i) => `const n${i} = (${s.local}: { squash: (u: unknown) => unknown }) => ${s.local}.squash(x);`,
  (s, i) => `function n${i}(${s.local}: (u: unknown) => unknown) { return ${s.local}(x); }`,
  (s, i) => `const n${i} = () => { const ${s.local} = { squash: (u: unknown) => u }; return ${s.local}.squash(x); };`,
  // Case 8: a comment, a string and a type position.
  (s) => `// ${s.module ?? "Cause"}.squash(x) is what the rule refuses`,
  (s, i) => `const n${i} = "${s.module ?? "Cause"}.squash(x)";`,
  (s, i) => `type N${i} = typeof ${s.module === null ? s.local : `${s.module}.squash`};`,
  // The module's other members.
  (s, i) => `const n${i} = ${s.module === null ? "0" : `${s.module}.findErrorOption`};`,
  (s, i) => `const n${i} = ${s.module === null ? "0" : `${s.module}.squashed`};`,
];

/** Imports that look like Effect's and are not, on every file. None fires. */
const OTHERS = [
  'import { Cause as Mine, squash as mine } from "./mine.ts";',
  'import type { squash as Squash } from "effect/Cause";',
];

const piece = fc.oneof(
  fc.record({ fires: fc.constant(true), form: fc.nat({ max: USES.length - 1 }) }),
  fc.record({ fires: fc.constant(false), form: fc.nat({ max: NEIGHBORS.length - 1 }) }),
);

const generated = fc.record({
  spelling: fc.constantFrom(...SPELLINGS),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((w) => `K${w}`),
  pieces: fc.array(piece, { minLength: 1, maxLength: 6 }),
});

it("law 2: reports exactly the uses of Effect's squash, through every import spelling and use form", () => {
  fc.assert(
    fc.property(generated, ({ spelling, alias, pieces }) => {
      const at = spelling(alias);
      const { module } = at;
      // With `squash` imported by name, the import is the one use, and a call of it adds no report.
      const lines: ReadonlyArray<readonly [string, boolean]> = [
        [at.header, module === null],
        ...OTHERS.map((line) => [line, false] as const),
        ...pieces.map(({ fires, form }, i): readonly [string, boolean] =>
          fires
            ? module === null
              ? [`const u${i} = ${at.local}(x);`, false]
              : [USES[form]!(module, i), true]
            : [NEIGHBORS[form]!(at, i), false],
        ),
      ];
      const filename = "next/packages/libfabrika/src/runtime/Case.ts";
      const errors = lines.flatMap(([, fires], i) => (fires ? [{ line: i + 1, message: REFUSED }] : []));
      // The same file with every firing line taken out.
      const valid = lines.flatMap(([line, fires]) => (fires ? [] : [line])).join("\n");

      tester.run("no-cause-squash", noCauseSquash, {
        valid: [{ code: valid, filename }],
        invalid: errors.length === 0 ? [] : [{ code: lines.map(([line]) => line).join("\n"), filename, errors }],
      });
    }),
    { seed: 119120, numRuns: 100 },
  );
});

const BODY = [
  'import { Cause } from "effect";',
  "export const a = (cause: Cause.Cause<unknown>) => Cause.squash(cause);",
  "// oxlint-disable-next-line fabrika/no-cause-squash -- edge: names whatever failed, for a span",
  "export const b = (cause: Cause.Cause<unknown>) => Cause.squash(cause);",
  "// oxlint-disable-next-line fabrika/no-cause-squash -- edge: this line squashes nothing",
  "export const c = 1;",
].join("\n");

const HELD = [
  "next/packages/libfabrika/src/runtime/Plant.ts",
  "next/packages/libfabrika/src/ledger/internal/plant.ts",
  "next/apps/fabrika/src/Plant.ts",
  "next/apps/fabrika/src/window/Plant.tsx",
  "next/programs/counter/src/Plant.ts",
  ".agents/skills/x/scripts/plant.ts",
];

const LEFT_OUT = [
  "next/packages/libfabrika/src/runtime/Plant.test.ts",
  "next/apps/fabrika/src/window/Plant.test.tsx",
  "next/packages/libfabrika/src/processes/PlantTest.ts",
  "next/packages/libfabrika/src/processes/plant.test-support.ts",
  ".agents/skills/x/scripts/plant.test.ts",
  "packages/fabrika/src/plant.ts",
];

it("scenario: one real lint run per path kind, since only the real config holds which paths are tests", async () => {
  const linted = await plant(Object.fromEntries([...HELD, ...LEFT_OUT].map((path) => [path, BODY])));

  // Product code: the bare call fires, and the call under its edge comment passes.
  for (const path of HELD) {
    expect([path, linted(CODE, path)]).toEqual([path, [2]]);
  }

  // An edge comment over a line with no squash is an unused directive, which oxlint reports with no
  // rule code (`reportUnusedDisableDirectives`).
  for (const path of HELD) {
    expect([path, linted("", path)]).toEqual([path, [5]]);
  }

  // Tests, shared suites, test support and today's version: nothing fires.
  for (const path of LEFT_OUT) {
    expect([path, linted(CODE, path)]).toEqual([path, []]);
  }
});
