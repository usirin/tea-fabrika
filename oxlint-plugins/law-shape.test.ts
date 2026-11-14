// The edge cases, listed before the rule was written (0040), each a line of the generated file below:
// - `describe` is not a test: only the tests inside it are read.
// - `it.each(rows)(...)`, `it.for(rows)(...)` and `test.skip.each(rows)(...)` are tests: a hand-written
//   table of cases is what 0093 replaces, unless its title is labeled.
// - `it.skip`, `it.only`, `it.fails` and `it.skipIf(c)(...)` are read like `it`. `it.todo` is not
//   read, with a body or without. `it.layer(L)(...)` is a group, so only the tests in it are read.
// - A helper that wraps `it` is read at its own `it`: a property there passes, and a title that is
//   the helper's parameter is not judged.
// - A property inside a labeled example passes, and fires nothing twice.
// - A template title is judged by its text before the first `${}`, and not judged when that text
//   could still become a label.
// - A shared suite file (`SinkTest.ts`, 0062) is read, and a test file that only calls
//   `SinkTest.suite(...)` holds no test.
// - A body that calls a function this file declares is read through it; an imported helper is not.
// - `fast-check` under any local name, and `@demlik/tea/pbt`'s runners named or through a namespace.
// - The shared runner, `property` from a `Testing.test-support.ts` module, named, renamed or through
//   a namespace. A `property` from any other module, another name from that module, a type-only
//   import, and a local `property` that calls no `assert` still fire.
// - Not tests: `/x/.test(s)`, `it(title)` with no body.
// - A label is one of four lowercase words at the start of the title, with text after its colon.
//   One ticket or law id may stand before it (`T652 scenario: ...`): letters, digits and dots, then
//   a space. Two tokens before it, an id with another sign, an id glued to the label, or a label
//   only in a comment still fire.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "fabrika(law-shape)";
const runs = { seed: 119120, numRuns: 4 };
const LABELS = ["vector", "format", "pinned", "scenario"] as const;

// Source text has no domain Schema: titles are plain words, none of them a label.
const words = fc
  .array(fc.constantFrom("the", "window", "keeps", "a", "press", "row", "law", "once"), {
    minLength: 1,
    maxLength: 5,
  })
  .map((w) => w.join(" "));

const alias = fc.constantFrom("fc", "check", "F");

// A ticket or law id as titles write them: `T652`, `K2`, `p68b`, `R3.1`.
const id = fc.stringMatching(/^[A-Za-z0-9.]{1,6}$/);

interface Spelling {
  readonly a: string;
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly reason: string;
}

/** One test per line, and whether the rule fires on it. */
const cases: readonly ((s: Spelling) => readonly [string, boolean])[] = [
  ({ title }) => [`it("${title}", () => {});`, true],
  ({ label, reason }) => [`it("${label}: ${reason}", () => {});`, false],
  ({ label, reason }) => [`test("${label}: ${reason}", () => {});`, false],
  ({ label, reason }) => [`it("${label.toUpperCase()}: ${reason}", () => {});`, true],
  ({ label }) => [`it("${label}:", () => {});`, true],
  ({ id, label, reason }) => [`it("${id} ${label}: ${reason}", () => {});`, false],
  ({ id, label, reason }) => [`it.each([1])("${id} ${label}: ${reason} %s", (n) => {});`, false],
  ({ id, label, reason }) => [`it("${id} ${id} ${label}: ${reason}", () => {});`, true],
  ({ id, label, reason }) => [`it("${id}-x ${label}: ${reason}", () => {});`, true],
  ({ id, label, reason }) => [`it("${id}${label}: ${reason}", () => {});`, true],
  ({ title, label, reason }) => [`it("the ${title} ${label}: ${reason}", () => {});`, true],
  ({ title, label, reason }) => [`/* ${label}: ${reason} */ it("the ${title}", () => {});`, true],
  ({ a, title }) => [`it.prop("${title}", [${a}.nat()], ([n]) => n >= 0);`, false],
  ({ a, title }) => [`it.effect.prop("${title}", { n: ${a}.nat() }, ({ n }) => Effect.void);`, false],
  ({ a, title }) => [`it("${title}", () => { ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0)); });`, false],
  ({ a, title }) => [
    `it("${title}", async () => { await ${a}.assert(${a}.asyncProperty(${a}.nat(), async (n) => n >= 0)); });`,
    false,
  ],
  ({ title }) => [`it("${title}", () => invariant(m, opts));`, false],
  ({ title }) => [`it("${title}", () => Pbt.propertyTrace(m, opts));`, false],
  ({ title }) => [`it("${title}", () => deeper());`, false],
  ({ title }) => [`it("${title}", local);`, false],
  ({ title }) => [`it("${title}", () => plain());`, true],
  ({ title }) => [`it("${title}", () => helper());`, true],
  ({ title }) => [`it("${title}", () => other.assert(x));`, true],
  ({ a, title }) => [
    `it.effect("${title}", () => Effect.sync(() => ${a}.assert(${a}.property(${a}.nat(), () => true))));`,
    false,
  ],
  ({ title }) => [`it.effect("${title}", () => Effect.void);`, true],
  ({ title }) => [`it.skip("${title}", () => {});`, true],
  ({ title }) => [`it.only("${title}", () => {});`, true],
  ({ title }) => [`it.fails("${title}", () => {});`, true],
  ({ title }) => [`it.skipIf(true)("${title}", () => {});`, true],
  ({ title }) => [`it.each([1, 2])("${title} %s", (n) => {});`, true],
  ({ label, reason }) => [`it.each([1, 2])("${label}: ${reason} %s", (n) => {});`, false],
  ({ title }) => [`test.skip.each([1])("${title}", () => {});`, true],
  ({ title }) => [`it.for([1])("${title}", () => {});`, true],
  ({ title }) => [`it.todo("${title}");`, false],
  ({ title }) => [`it.todo("${title}", () => {});`, false],
  ({ title, label, reason }) => [
    `it.layer(L)("${title}", (it) => { it.effect("${label}: ${reason}", () => Effect.void); });`,
    false,
  ],
  ({ title, label, reason }) => [
    `it.layer(L)("${label}: ${reason}", (it) => { it.effect("${title}", () => Effect.void); });`,
    true,
  ],
  ({ title }) => [`describe("${title}", () => { it("${title}", () => {}); });`, true],
  ({ a, label, reason }) => [
    `it("${label}: ${reason}", () => { ${a}.assert(${a}.property(${a}.nat(), () => true)); });`,
    false,
  ],
  ({ label }) => [`it(\`${label}: \${x}\`, () => {});`, false],
  ({ title }) => [`it(\`the ${title} \${x}\`, () => {});`, true],
  ({ id }) => [`it(\`${id} \${x}\`, () => {});`, false],
  ({ id, label }) => [`it(\`${id} ${label}: \${x}\`, () => {});`, false],
  ({ id, label, reason }) => [`it(\`${id} ${label}: ${reason}\`, () => {});`, false],
  ({ title }) => [`it(\`\${x} ${title}\`, () => {});`, false],
  ({ label, reason }) => [`it(\`${label}: ${reason}\`, () => {});`, false],
  ({ title }) => [`/x/.test("${title}");`, false],
  ({ title }) => [`it("${title}");`, false],
];

const preamble = (a: string, star: boolean) => [
  star ? `import * as ${a} from "fast-check";` : `import ${a} from "fast-check";`,
  'import { propertyInvariant as invariant } from "@demlik/tea/pbt";',
  'import * as Pbt from "@demlik/tea/pbt";',
  'import { describe, it, test } from "vitest";',
  'import { helper } from "./helper.ts";',
  `const local = () => ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0));`,
  "const deeper = () => local();",
  "const plain = () => 1;",
  `const law = (name: string) => it(name, () => ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0)));`,
  "const example = (name: string) => it(name, () => {});",
];

it("fires on exactly the tests that are neither a property nor labeled, in any order and spelling", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        a: alias,
        id,
        star: fc.boolean(),
        title: words,
        reason: words,
        label: fc.constantFrom(...LABELS),
        order: fc.shuffledSubarray(
          cases.map((_, i) => i),
          { minLength: cases.length },
        ),
      }),
      async ({ a, id, star, title, reason, label, order }) => {
        const head = preamble(a, star);
        const lines = order.flatMap((i) => {
          const make = cases[i];
          return make === undefined ? [] : [make({ a, id, title, label, reason })];
        });
        const text = [...head, ...lines.map(([line]) => line)].join("\n");
        const expected = lines.flatMap(([, fires], i) => (fires ? [head.length + i + 1] : []));
        const path = "next/packages/libfabrika/src/thing.test.ts";
        const result = await plant({ [path]: text });
        expect(result(CODE, path), text).toEqual(expected);
      },
    ),
    runs,
  );
});

/** Where a law's `property` comes from, the call that names it, and whether the law fires. */
const sources: readonly (readonly [string, string, boolean])[] = [
  ['import { property } from "../Testing.test-support.ts";', "property", false],
  ['import { property } from "./Testing.test-support.ts";', "property", false],
  ['import { property as shared } from "../../src/Testing.test-support.ts";', "shared", false],
  ['import * as Testing from "../Testing.test-support.ts";', "Testing.property", false],
  ["const property = () => fc.assert(fc.property(fc.nat(), () => true));", "property", false],
  ['import { property } from "../Testing.ts";', "property", true],
  ['import { property } from "../MyTesting.test-support.ts";', "property", true],
  ['import { property } from "./helper.ts";', "property", true],
  ['import { property } from "fast-check";', "property", true],
  ['import { property } from "@demlik/tea/pbt";', "property", true],
  ['import * as Testing from "../Testing.ts";', "Testing.property", true],
  ['import { other as property } from "../Testing.test-support.ts";', "property", true],
  ['import type { property } from "../Testing.test-support.ts";', "property", true],
  ["const property = (a: unknown, law: unknown, p: unknown) => 1;", "property", true],
];

it("counts the shared runner, property from Testing.test-support.ts, as a property, and no other property", async () => {
  await fc.assert(
    fc.asyncProperty(fc.record({ title: words, nested: fc.boolean() }), async ({ title, nested }) => {
      const files = sources.map(([source, call, fires], i) => {
        const run = `${call}(fc.nat(), () => Effect.void, { numRuns: 1 })`;
        const body = nested ? `Effect.gen(function* () { yield* ${run}; })` : run;
        const text = [
          'import { it } from "@effect/vitest";',
          'import { Effect } from "effect";',
          'import * as fc from "fast-check";',
          source,
          `it.effect("${title}", () => ${body});`,
        ].join("\n");
        return { source, path: `next/packages/libfabrika/src/processes/Shared${i}Test.ts`, text, fires };
      });
      const result = await plant(Object.fromEntries(files.map(({ path, text }) => [path, text])));
      const fired = Object.fromEntries(files.map(({ source, path }) => [source, result(CODE, path)]));
      const expected = Object.fromEntries(files.map(({ source, fires }) => [source, fires ? [5] : []]));
      expect(fired, files[0]?.text).toEqual(expected);
    }),
    { ...runs, numRuns: 2 },
  );
});

it("reads next/ and .agents/ tests and shared suites, and leaves today's tests and product files alone", async () => {
  await fc.assert(
    fc.asyncProperty(fc.record({ title: words, label: fc.constantFrom(...LABELS) }), async ({ title, label }) => {
      const text = [
        'import { describe, it } from "vitest";',
        `it("${label}: kept", () => {});`,
        `export const suite = (sql: unknown) => describe("s", () => { it("${title}", () => {}); });`,
      ].join("\n");
      const read = ["next/a.test.ts", "next/a.test.tsx", "next/a/SinkTest.ts", ".agents/skills/x/a.test.ts"];
      const left = ["next/a.ts", "packages/a.test.ts", "apps/a.test.ts", "programs/a.test.ts", "docs/a.test.ts"];
      const caller = "next/a/sink.test.ts";
      const result = await plant({
        ...Object.fromEntries([...read, ...left].map((path) => [path, text])),
        [caller]: 'import * as SinkTest from "./SinkTest.ts";\nSinkTest.suite(nodeSql);\n',
      });

      for (const path of read) {
        expect(result(CODE, path), path).toEqual([3]);
      }

      for (const path of [...left, caller]) {
        expect(result(CODE, path), path).toEqual([]);
      }
    }),
    { ...runs, numRuns: 2 },
  );
});

// scenario: `pnpm lint`'s own runner prints the advice, names both shapes, and exits 0 on it, so the
// rule advises and never blocks until its false alarms are counted (0093).
it("scenario: lint.ts prints the advice with both shapes and does not fail on it", () => {
  const root = resolve(import.meta.dirname, "..");
  const dir = realpathSync(mkdtempSync(join(root, "next", ".law-shape-")));

  try {
    spawnSync("git", ["init", "-q", dir]);
    const file = join(dir, "next/unit.test.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'import { it } from "vitest";\n\nit("adds one", () => {});\n');
    const ran = spawnSync(process.execPath, [join(root, "oxlint-plugins/lint.ts"), "next/unit.test.ts"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(ran.stdout).toContain(`${CODE} Advice, does not block:`);
    expect(ran.stdout).toContain("it.prop");
    expect(ran.stdout).toContain("vector:, format:, pinned:, scenario:");
    expect(ran.stdout).toContain("0 blocking, 1 advice");
    expect(ran.status, ran.stdout + ran.stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
