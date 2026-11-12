// `padding-line-between-statements` against generated files: where it fires, and what its fix
// writes. The planted files sit beside this one, so the repository's own .oxlintrc.json runs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { afterAll, expect, it } from "vitest";
import { paddingLineBetweenStatements } from "./padding-line-between-statements.ts";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const CODE = "fabrika(padding-line-between-statements)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });

const plant = mkdtempSync(join(import.meta.dirname, ".plant-"));
afterAll(() => rmSync(plant, { recursive: true, force: true }));

/** One top-level piece. `pair` pieces are a value and its same-name type, which stay together. */
type Kind = "import" | "one" | "many" | "pair" | "overloads";

/** The text of piece `n`, and whether its first and its last statement are one line each. */
const piece = (kind: Kind, n: number): { readonly text: string; readonly first: boolean; readonly last: boolean } => {
  switch (kind) {
    case "import":
      return { text: `import {a${n}} from "./m${n}.ts";`, first: true, last: true };
    case "one":
      return { text: `export const v${n} = ${n};`, first: true, last: true };
    case "many":
      return { text: `export const v${n} = {\n\ta: ${n},\n};`, first: false, last: false };
    case "pair":
      return {
        text: `export const S${n} = {\n\ta: ${n},\n};\nexport type S${n} = typeof S${n};`,
        first: false,
        last: true,
      };
    case "overloads":
      return {
        text: `export function f${n}(a: string): string;\nexport function f${n}(a: number): number;\nexport function f${n}(a: unknown) {\n\treturn a;\n}`,
        first: true,
        last: false,
      };
  }
};

type Report = {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly filename: string;
    readonly labels: readonly { readonly span: { readonly line: number } }[];
  }[];
};

/** The lines the rule fires at in each file, from one oxlint run through the repo's own config. */
const firesIn = (files: readonly string[]): ReadonlyMap<string, readonly number[]> => {
  const out = spawnSync(OXLINT, ["--format=json", ...files.map((f) => relative(ROOT, f))], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const report = JSON.parse(out.stdout) as Report;
  const lines = new Map<string, number[]>(files.map((f) => [f, []]));

  for (const d of report.diagnostics) {
    const at = lines.get(join(ROOT, d.filename));

    if (d.code === CODE && at !== undefined && d.labels[0] !== undefined) {
      at.push(d.labels[0].span.line);
    }
  }

  return new Map([...lines].map(([f, at]) => [f, at.sort((a, b) => a - b)]));
};

const fires = (file: string): readonly number[] => firesIn([file]).get(file)!;

/** One generated case: the text, where the rule fires, and the exact text its fix writes. */
type Case = { readonly text: string; readonly expected: readonly number[]; readonly fixed: string };

/** In process, RuleTester: the errors' lines, the exact fix, and the fixed text firing nothing. */
const check = ({ text, expected, fixed }: Case) => {
  tester.run("padding-line-between-statements", paddingLineBetweenStatements, {
    valid: expected.length === 0 ? [{ code: text, filename: "case.ts" }] : [{ code: fixed, filename: "case.ts" }],
    invalid:
      expected.length === 0
        ? []
        : [
            {
              code: text,
              filename: "case.ts",
              errors: expected.map((line) => ({ line, message: /Leave a blank line before this statement/ })),
              output: fixed,
            },
          ],
  });
};

/** One CLI pass over every file of a property: where it fires, what `--fix` writes, then nothing. */
const cli = (cases: ReadonlyMap<string, Case>) => {
  const files = [...cases.keys()];
  const found = firesIn(files);
  expect(Object.fromEntries(found)).toEqual(Object.fromEntries([...cases].map(([f, c]) => [f, c.expected])));
  spawnSync(OXLINT, ["--fix", ...files.map((f) => relative(ROOT, f))], { cwd: ROOT, encoding: "utf8" });
  expect(Object.fromEntries(files.map((f) => [f, readFileSync(f, "utf8")]))).toEqual(
    Object.fromEntries([...cases].map(([f, c]) => [f, c.fixed])),
  );
  expect([...firesIn(files).values()].flat()).toEqual([]);
};

const file = fc.array(
  fc.record({
    kind: fc.constantFrom<Kind>("import", "one", "many", "pair", "overloads"),
    blank: fc.boolean(),
    comment: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
);

it("fires before each piece with no blank line above it, unless both sides are one line or imports, and its fix adds just that line", () => {
  let n = 0;
  const cases = new Map<string, Case>();
  fc.assert(
    fc.property(file, (pieces) => {
      let text = "";
      let fixed = "";
      let line = 1;
      const expected: number[] = [];
      pieces.forEach(({ kind, blank, comment }, i) => {
        const { text: body, first } = piece(kind, i);
        const lead = comment ? `// piece ${i}\n` : "";

        if (i > 0) {
          const prev = pieces[i - 1]!;
          const both = prev.kind === "import" && kind === "import";
          const short = piece(prev.kind, i - 1).last && first;

          if (blank) {
            text += "\n";
            fixed += "\n";
            line++;
          } else if (!both && !short) {
            expected.push(line + lead.split("\n").length - 1);
            fixed += "\n";
          }
        }

        text += `${lead}${body}\n`;
        fixed += `${lead}${body}\n`;
        line += `${lead}${body}`.split("\n").length;
      });
      const at = join(plant, `p${n++}.ts`);
      writeFileSync(at, text);
      cases.set(at, { text, expected, fixed });
      check({ text, expected, fixed });
    }),
    { seed: 119120, numRuns: 40 },
  );
  cli(cases);
});

/** One statement in a function body: a plain one-line statement, or a control statement. */
type Inner = "plain" | "if" | "else" | "for" | "while" | "do" | "switch" | "try" | "labeled";

const inner = (kind: Inner, n: number): string => {
  switch (kind) {
    case "plain":
      return `\tx += ${n};`;
    case "if":
      return `\tif (x > ${n}) {\n\t\tx = 0;\n\t}`;
    case "else":
      return `\tif (x > ${n}) {\n\t\tx = 0;\n\t} else if (x < 0) {\n\t\tx = 1;\n\t} else {\n\t\tx = 2;\n\t}`;
    case "for":
      return `\tfor (const y of ys) {\n\t\tx += y;\n\t}`;
    case "while":
      return `\twhile (x > ${n}) {\n\t\tx--;\n\t}`;
    case "do":
      return `\tdo {\n\t\tx--;\n\t} while (x > ${n});`;
    case "switch":
      return `\tswitch (x) {\n\t\tcase ${n}:\n\t\t\tx = 0;\n\t}`;
    case "try":
      return `\ttry {\n\t\tx = f();\n\t} catch {\n\t\tx = 0;\n\t}`;
    case "labeled":
      return `\touter: for (const y of ys) {\n\t\tfor (const z of ys) {\n\t\t\tif (y > z) {\n\t\t\t\tcontinue outer;\n\t\t\t}\n\t\t}\n\t}`;
  }
};

const body = fc.array(
  fc.record({
    kind: fc.constantFrom<Inner>("plain", "plain", "if", "else", "for", "while", "do", "switch", "try", "labeled"),
    blank: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
);

it("inside a block, fires before and after each control statement with no blank line there, never at the block's ends, and its fix adds just that line", () => {
  let n = 0;
  const cases = new Map<string, Case>();
  fc.assert(
    fc.property(body, (statements) => {
      const head =
        "declare const ys: number[];\ndeclare const f: () => number;\n\nexport function g() {\n\tlet x = 0;\n";
      let text = head;
      let fixed = head;
      let line = 6;
      const expected: number[] = [];
      statements.forEach(({ kind, blank }, i) => {
        const prev = i === 0 ? "plain" : statements[i - 1]!.kind;

        if (blank) {
          text += "\n";
          fixed += "\n";
          line++;
        } else if (prev !== "plain" || kind !== "plain") {
          expected.push(line);
          fixed += "\n";
        }

        const piece = inner(kind, i);
        text += `${piece}\n`;
        fixed += `${piece}\n`;
        line += piece.split("\n").length;
      });
      const last = statements.at(-1)!.kind;

      if (last !== "plain") {
        expected.push(line);
        fixed += "\n";
      }

      text += "\treturn x;\n}\n";
      fixed += "\treturn x;\n}\n";

      const at = join(plant, `b${n++}.ts`);
      writeFileSync(at, text);
      cases.set(at, { text, expected, fixed });
      check({ text, expected, fixed });
    }),
    { seed: 119120, numRuns: 40 },
  );
  cli(cases);
});

it.each([
  [
    "scenario: an if first and last in its block needs no blank line",
    "export function g(x: number) {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n",
    [],
  ],
  [
    "scenario: in a switch case, a statement after an if",
    "export function g(x: number) {\n\tswitch (x) {\n\t\tcase 1:\n\t\t\tif (x) {\n\t\t\t\tx++;\n\t\t\t}\n\t\t\tbreak;\n\t}\n\treturn x;\n}\n",
    [7, 9],
  ],
  [
    "scenario: a comment above the if moves down with it",
    "export function g(x: number) {\n\tx++;\n\t// why\n\tif (x) {\n\t\tx++;\n\t}\n\treturn x;\n}\n",
    [4, 7],
  ],
  [
    "scenario: class members, a method after a field",
    "export class A {\n\tx = 1;\n\tf() {\n\t\treturn 1;\n\t}\n\tg() {\n\t\treturn 2;\n\t}\n}\n",
    [3, 6],
  ],
  ["scenario: one-line class fields stay a group", "export class A {\n\tx = 1;\n\ty = 2;\n}\n", []],
  ["scenario: two statements on one line are oxfmt's", "export const a = {\n\tb: 1,\n}; export const c = 2;\n", []],
  ["scenario: a re-export list", 'export {a} from "./a.ts";\nexport * from "./b.ts";\n', []],
  [
    "scenario: a long import list stays one list",
    'import {\n\ta,\n\tb,\n} from "./a.ts";\nimport {c} from "./c.ts";\nexport {\n\ta,\n\tb,\n} from "./a.ts";\nexport const d = c;\n',
    [10],
  ],
])("%s", (name, text, expected) => {
  const at = join(plant, `${name.replaceAll(/\W/g, "-")}.ts`);
  writeFileSync(at, text);
  expect(fires(at)).toEqual(expected);
});
