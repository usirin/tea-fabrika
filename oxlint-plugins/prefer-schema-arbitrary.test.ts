// Each generated case runs in process through oxlint's RuleTester; one oxlint run per property over
// every case's file then proves the repo's own .oxlintrc.json wires the rule for next/ tests. The
// last property is the config's and lint.ts's own law, so it stays on oxlint and lint.ts.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { preferSchemaArbitrary } from "./prefer-schema-arbitrary.ts";

const root = resolve(import.meta.dirname, "..");
const oxlint = join(root, "node_modules/.bin/oxlint");
const config = join(root, ".oxlintrc.json");
const code = "fabrika(prefer-schema-arbitrary)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: root });

const constructors = [
  "record",
  "string",
  "stringMatching",
  "integer",
  "nat",
  "float",
  "double",
  "bigInt",
  "boolean",
  "array",
  "uniqueArray",
  "tuple",
  "oneof",
  "option",
  "constant",
  "constantFrom",
  "dictionary",
  "jsonValue",
  "uint8Array",
] as const;

const options = { seed: 119120, numRuns: 4 };
const name = fc.stringMatching(/^[a-z]{3,8}$/).map((s) => `random_${s}`);

interface Diagnostic {
  code: string;
  filename: string;
  message: string;
  labels: { span: { line: number } }[];
}

const lint = (files: Record<string, string>, runner = false, args: string[] = []) => {
  const dir = realpathSync(mkdtempSync(join(runner ? join(root, "next") : tmpdir(), ".schema-lint-")));

  try {
    spawnSync("git", ["init", "-q", dir]);

    if (!runner) {
      copyFileSync(config, join(dir, ".oxlintrc.json"));
      symlinkSync(join(root, "oxlint-plugins"), join(dir, "oxlint-plugins"));
    }

    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }

    const ran = spawnSync(
      runner ? process.execPath : oxlint,
      runner
        ? [join(root, "oxlint-plugins/lint.ts"), ...args, ...Object.keys(files)]
        : [
            `--config=${join(dir, ".oxlintrc.json")}`,
            "--disable-nested-config",
            "--no-ignore",
            "--format=json",
            ...args,
            ...Object.keys(files),
          ],
      { cwd: dir, encoding: "utf8", timeout: 10_000 },
    );
    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();

    if (runner) {
      return { ran, hits: [] as Diagnostic[] };
    }

    const report = JSON.parse(ran.stdout) as { diagnostics: Diagnostic[] };
    expect(
      report.diagnostics.filter((d) => d.code.includes("parse")),
      ran.stderr,
    ).toEqual([]);
    return { ran, hits: report.diagnostics.filter((d) => d.code === code) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** One report a case expects: its line where the law names one, and what its message holds. */
type Hit = { readonly line?: number; readonly message: RegExp };

/** One generated case: a next/ test file's text, and the reports the rule gives it, in line order. */
type Case = { readonly text: string; readonly hits: readonly Hit[] };

/** Every report the rule gives has this, so a law that names no message still says it is the rule's. */
const ADVICE = /has a matching Schema/;

/** The cases of one property, each checked in process as it is drawn, then all linted by `cli`. */
const cases = () => {
  const all: Case[] = [];

  /** In process, RuleTester: the case's file gives exactly these reports. */
  const want = (text: string, hits: readonly Hit[] = []) => {
    const filename = "next/unit.test.ts";
    tester.run("prefer-schema-arbitrary", preferSchemaArbitrary, {
      valid: hits.length === 0 ? [{ code: text, filename }] : [],
      invalid: hits.length === 0 ? [] : [{ code: text, filename, errors: hits.map((hit) => ({ ...hit })) }],
    });
    all.push({ text, hits });
  };

  /** One oxlint run over every case's file, through the repo's own config: the same reports. */
  const cli = () => {
    const files = all.map((_, i) => `next/case${i}.test.ts`);
    const { hits } = lint(Object.fromEntries(all.map(({ text }, i) => [files[i]!, text])));
    const found = files.map((file) =>
      hits
        .filter((d) => d.filename === file)
        .map((d) => ({ line: d.labels[0]!.span.line, message: d.message }))
        .sort((a, b) => a.line - b.line),
    );
    expect(found).toEqual(
      all.map(({ hits }) =>
        hits.map((hit) => ({ line: hit.line ?? expect.any(Number), message: expect.stringMatching(hit.message) })),
      ),
    );
  };

  return { want, cli };
};

/** `n` reports, anywhere, each the rule's own. */
const reports = (n: number): readonly Hit[] => Array.from({ length: n }, () => ({ message: ADVICE }));

const imports = (alias: string) =>
  `import ${alias} from 'fast-check';\nimport {Schema} from 'effect';\nconst S = Schema.Struct({x: Schema.String});\n`;

describe("T325 K20 prefer-schema-arbitrary, today's tooling for next tests", () => {
  // R4 finding 11. Syntax probes have no domain Schema. Plant: treat any nested maker as evidence.
  it("R4 requires the generated value to flow through the maker", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(fc.record({ alias: name, field: name }), ({ alias, field }) => {
        const prefix = imports(alias);

        for (const callback of [
          `n => ({count: n, ${field}: S.make({x: 'fixed'})})`,
          `n => { const unrelated = S.make({x: 'fixed'}); return n; }`,
          `n => S.make({x: 'fixed'})`,
          `n => ({count: n, ${field}: S.make})`,
        ]) {
          want(`${prefix}export const g = ${alias}.integer().map(${callback});`);
        }

        for (const callback of ["S.make", "n => S.make(n)", "n => { return S.make(n); }", "n => S.make({x: n})"]) {
          want(`${prefix}export const g = ${alias}.string().map(${callback});`, reports(1));
        }

        const assembled = `${prefix}
${alias}.assert(${alias}.property(${alias}.string(), value => Schema.is(S)({x: value})));
${alias}.assert(${alias}.property(${alias}.record({x: ${alias}.string()}), fields => {
  const value = {...fields, unused: true}; return Schema.is(S)(value);
}));
${alias}.assert(${alias}.property(${alias}.array(${alias}.record({x: ${alias}.string()})), rows => rows.map(S.make)));`;
        want(assembled);
      }),
      options,
    );
    cli();
  });

  // R4 finding 12. Plant: report an inner maker as well as its enclosing typed generator.
  it("R4 reports only the outer matching constructor", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(fc.record({ alias: name, depth: fc.integer({ min: 1, max: 3 }) }), ({ alias, depth }) => {
        let expr = `${alias}.string().map(Schema.String.make)`;

        for (let i = 0; i < depth; i++) {
          expr = `${alias}.record({x: ${expr}})`;
        }

        want(`${imports(alias)}export const g: ${alias}.Arbitrary<typeof S.Type> = ${expr};`, [{ message: /with S,/ }]);
      }),
      options,
    );
    cli();
  });

  // R4 finding 13. Plant: refuse qualified schemas or only recognize variable declarations.
  it("R4 recognizes qualified schema types and local Schema classes on all evidence paths", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(fc.record({ alias: name, schemaName: name.map((n) => `S_${n}`) }), ({ alias, schemaName }) => {
        const prefix = `import ${alias} from 'fast-check';\nimport {Schema} from 'effect';\nimport * as data from './data.ts';\nclass ${schemaName} extends Schema.Class<${schemaName}>('${schemaName}')({x: Schema.String}) {}\n`;
        const lines = [
          `export const a: ${alias}.Arbitrary<typeof Schema.String.Type> = ${alias}.string();`,
          `export const b: ${alias}.Arbitrary<typeof data.S.Type> = ${alias}.record({x: ${alias}.string()});`,
          `export const c: ${alias}.Arbitrary<typeof ${schemaName}.Type> = ${alias}.record({x: ${alias}.string()});`,
          `export const d = ${alias}.record({x: ${alias}.string()}).map(${schemaName}.make);`,
          `const g = ${alias}.record({x: ${alias}.string()}); ${alias}.assert(${alias}.property(g, value => Schema.is(${schemaName})(value)));`,
        ];
        want(
          prefix + lines.join("\n"),
          lines.map((_, i) => ({ line: i + 5, message: ADVICE })),
        );
      }),
      options,
    );
    cli();
  });

  // Plant: drop schema evidence matching, or flag only record. All named data constructors
  // are tried under every generated import alias. No property runner is itself a diagnostic.
  it("reports each outer data generator once when a type or maker names its schema", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(
        fc.record({
          alias: name,
          evidence: fc.constantFrom("type", "make", "case"),
          named: fc.boolean(),
        }),
        ({ alias, evidence, named }) => {
          const prefix = named
            ? `import {record as ${alias}} from 'fast-check';\nimport {Schema} from 'effect';\nconst S = Schema.Struct({x: Schema.String});\n`
            : imports(alias);
          const data = named
            ? [`${alias}({x: ${alias}({})})`]
            : constructors.map((ctor) => `${alias}.${ctor}(${ctor === "record" ? `{x: ${alias}.string()}` : ""})`);
          const lines = data.map((expr, i) =>
            evidence === "type"
              ? `export const g${i}: ${named ? "import('fast-check')" : alias}.Arbitrary<typeof S.Type> = ${expr};`
              : `export const g${i} = ${expr}.map(S.${evidence === "case" ? "cases.x." : ""}make);`,
          );
          // Import-type annotations have no namespace binding; use the maker for named imports.
          const body =
            named && evidence === "type" ? data.map((expr, i) => `export const g${i} = ${expr}.map(S.make);`) : lines;
          // Each message holds the schema's name, S, and the nearby reason that excuses one.
          want(
            prefix + body.join("\n"),
            body.map((_, i) => ({ line: i + 4, message: /^(?=[^]*S)(?=[^]*nearby reason)/ })),
          );
        },
      ),
      options,
    );
    cli();
  });

  // Plants: ignore a simple binding alias; confuse a callback value with a different binding.
  it("follows generated bindings into explicit Effect checks and respects scope shadows", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(
        fc.record({
          alias: name,
          check: fc.constantFrom("is", "decodeUnknownSync", "decodeUnknownEffect"),
          schemaAlias: fc.boolean(),
        }),
        ({ alias, check, schemaAlias }) => {
          const target = schemaAlias ? "T" : "S";
          const text = `${imports(alias)}const T = S;\nconst g = ${alias}.record({x: ${alias}.string()});\nconst h = g;\n${alias}.assert(${alias}.property(h, (value) => Schema.${check}(${target})(value)));\nfunction shadow(${alias}: any) { return ${alias}.record({x: ${alias}.string()}).map(S.make); }\nexport {shadow};\n`;
          want(text, [{ line: 5, message: new RegExp(target) }]);
          const shadowSchema = `${imports(alias)}function local(S: any) { return ${alias}.string().map(S.make); }\nexport {local};`;
          want(shadowSchema);
        },
      ),
      options,
    );
    cli();
  });

  // Plants: infer a schema from its capitalized name or record keys; ignore a nearby reason.
  it("leaves guesses, property runners and justified edge or unsupported data alone", () => {
    const { want, cli } = cases();
    fc.assert(
      fc.property(
        fc.record({
          alias: name,
          reason: fc.constantFrom(
            "edge cases -- generate invalid fields to test refusal",
            "unsupported Effect -- this schema refinement exhausts discards",
          ),
        }),
        ({ alias, reason }) => {
          const text = `${imports(alias)}import {Similar} from './data.ts';\nimport {Redacted} from 'effect';\nexport const arbitraryS = ${alias}.record({x: ${alias}.string()});\nexport const unrelated = ${alias}.constant(Similar);\nexport const secret = ${alias}.string().map(Redacted.make);\n${alias}.assert(${alias}.property(arbitraryS, (value) => value.x.length >= 0));\n// fast-check: ${reason}\nexport const justified: ${alias}.Arbitrary<typeof S.Type> = ${alias}.record({x: ${alias}.string()});\n`;
          want(text);
        },
      ),
      options,
    );
    cli();
  });

  // T930 L8. Plant: leave the next/ tests override at "warn". Exercise lint.ts's real exit, including
  // a different warn: a fire in a folder at zero blocks (0523).
  it("T930 L8 applies only to next tests and blocks in a clean folder, beside another warning too", () => {
    fc.assert(
      fc.property(fc.record({ alias: name, ext: fc.constantFrom("ts", "tsx") }), ({ alias, ext }) => {
        const text = `${imports(alias)}export const data: ${alias}.Arbitrary<typeof S.Type> = ${alias}.record({x: ${alias}.string()});\n`;
        const { hits } = lint({
          [`next/unit.test.${ext}`]: text,
          "next/unit.ts": text,
          "packages/unit.test.ts": text,
        });
        expect(hits).toHaveLength(1);
        const blocked = lint({ [`next/unit.test.${ext}`]: text }, true).ran;
        expect(blocked.stdout).toContain(code);
        expect(blocked.stdout).toContain("1 blocking, 0 advice");
        expect(blocked.status, blocked.stdout + blocked.stderr).toBe(1);
        const warned = lint({ [`next/unit.test.${ext}`]: `${text}\ndebugger;\n` }, true, ["--warn=no-debugger"]).ran;
        expect(warned.stdout).toContain("no-debugger");
        expect(warned.stdout).toContain("2 blocking, 0 advice");
        expect(warned.status).toBe(1);
      }),
      options,
    );
  });
});
