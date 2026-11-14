import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { type Runner, samePaths, sameProgram } from "./program.ts";

// Today's CI for both versions. Covers program.ts: whether a changed file is the same program on
// both sides, so a comment-only change under next/ runs only the reader tests (the plan for CI
// paths, slice 2, laws 9 to 15 and 18).
const options = { seed: 119120, numRuns: 100 };

// A program is a list of tokens, and a gap after each one. A gap is space, a newline or a plain
// comment, so two sides that differ only in their gaps are the same program. No statement holds
// `return`, `throw`, `++`, `--` or an arrow, where a newline in a gap would change the meaning.
type Kind = "word" | "name" | "type" | "number" | "string" | "template" | "regex" | "mark";

interface Token {
  readonly text: string;
  readonly kind: Kind;
}

const t = (kind: Kind) => (text: string) => ({ text, kind });
const mark = t("mark");

// Comment-like text inside strings, templates and regexes is part of the program.
const value = fc.oneof(
  fc.integer({ min: 0, max: 999 }).map((n) => t("number")(String(n))),
  fc.constantFrom('"a // b"', "'/* c */'", '"x"', '"https://example.invalid/a"').map(t("string")),
  // A template with a placeholder, spelled in two parts so it stays text here.
  fc.constantFrom("`t // u $" + "{1} /* v */`", "`w`", "`/** x */`").map(t("template")),
  fc.constantFrom("/[/*]x/g", "/\\/\\/y/", "/[//]z/i", "/a*/").map(t("regex")),
);

const statement = (i: number): fc.Arbitrary<Token[]> =>
  fc.oneof(
    value.map((v) => [t("word")("const"), t("name")(`v${i}`), mark("="), v, mark(";")]),
    fc
      .tuple(fc.constantFrom("string", "number"), value)
      .map(([type, v]) => [
        t("word")("export"),
        t("word")("const"),
        t("name")(`v${i}`),
        mark(":"),
        t("type")(type),
        mark("="),
        v,
        mark(";"),
      ]),
    fc
      .tuple(value, value)
      .map(([a, b]) => [
        t("word")("let"),
        t("name")(`v${i}`),
        mark("="),
        mark("["),
        a,
        mark(","),
        b,
        mark("]"),
        mark(";"),
      ]),
    value.map((v) => [t("name")("f"), mark("("), v, mark(")"), mark(";")]),
    fc.constant<Token[]>([
      t("word")("function"),
      t("name")(`w${i}`),
      mark("("),
      t("name")("a"),
      mark(")"),
      mark("{"),
      t("name")("a"),
      mark(";"),
      mark("}"),
    ]),
  );

const tokens = fc
  .integer({ min: 1, max: 6 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => statement(i))))
  .map((statements) => statements.flat());

// Plain comment words, JSDoc tags that no tool reads among them (`@since`, `@stability`), and
// words with a dash or `@` that are no tool comment, as the real doc blocks of pull request 1165
// hold (`sk-ecdsa-sha2-nistp256@openssh.com`).
const words = fc
  .array(
    fc.constantFrom(
      "the",
      "note",
      "keeps",
      "order",
      "why",
      "value",
      "@since 1.0",
      "@stability unstable",
      "@example",
      "@param a the input",
      "built-in",
      "ssh-keygen -Y sign",
      "sk-ecdsa-sha2-nistp256@openssh.com",
      "snake_case",
      "https://example.invalid/x",
    ),
    { maxLength: 4 },
  )
  .map((list) => list.join(" "));

const comment = fc.oneof(
  words.map((w) => ` // ${w}\n`),
  words.map((w) => ` /* ${w} */ `),
  words.map((w) => ` /** ${w} */\n`),
  words.map((w) => `\n/**\n * ${w}\n *\n * ${w}\n */\n`),
);

const gap = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(" ", "\n", "\n\n  ") }, { weight: 2, arbitrary: comment });

// An unchanged tool comment on both sides, away from every changed comment: real files hold many.
const preamble = fc.constantFrom("", "// oxlint-disable-next-line no-console\nconsole.log(0);\n");

const join = (head: string, list: readonly Token[], gaps: readonly string[]) =>
  head + list.map((token, i) => `${token.text}${gaps[i] ?? " "}`).join("");

const gaps = (count: number) => fc.array(gap, { minLength: count, maxLength: count });

/** Two sides of one program whose gaps differ: comments added, removed or rewritten. */
const pair = fc
  .tuple(preamble, tokens)
  .chain(([head, list]) => fc.tuple(fc.constant(head), fc.constant(list), gaps(list.length), gaps(list.length)));

const name = fc.constantFrom("a.ts", "b.tsx", "next/packages/libfabrika/src/transport/x.ts");

// Plants run once for laws 9, 10, 13, 14 and 15; the results are in the tests step's report.
it("property: comments added, removed or rewritten between tokens give the same program", () => {
  fc.assert(
    fc.property(pair, name, ([head, list, before, after], file) => {
      expect(sameProgram(file, join(head, list, before), join(head, list, after))).toBe(true);
    }),
    options,
  );
});

/** Another token of the same kind, so the program still parses and only that token differs. */
const swap = (token: Token): string => {
  switch (token.kind) {
    case "word":
      return token.text === "const" ? "let" : token.text === "let" ? "var" : token.text;
    case "name":
      return `${token.text}x`;
    case "type":
      return token.text === "string" ? "number" : "string";
    case "number":
      // The same value spelled another way is another program: literal text stays in the tree.
      return `0x${Number(token.text).toString(16)}`;
    case "string":
      return token.text.replace(/["']$/, (quote) => `y${quote}`);
    case "template":
      return token.text.replace(/`$/, "y`");
    case "regex":
      return token.text.endsWith("g") ? `${token.text.slice(0, -1)}i` : `${token.text}m`;
    case "mark":
      return token.text;
  }
};

/** A pair from law 9 with one token swapped on the new side. */
const swapped = pair.chain(([head, list, before, after]) => {
  const open = list.flatMap((token, i) => (swap(token) === token.text ? [] : [i]));
  return fc
    .constantFrom(...open)
    .map(
      (at) =>
        [
          head,
          list,
          list.map((token, i) => (i === at ? { ...token, text: swap(token) } : token)),
          before,
          after,
        ] as const,
    );
});

it("property: one changed token never gives the same program", () => {
  fc.assert(
    fc.property(swapped, name, ([head, list, changed, before, after], file) => {
      expect(sameProgram(file, join(head, list, before), join(head, changed, after))).toBe(false);
    }),
    {
      ...options,
      examples: [
        // pinned: the plan's own case, `16` and `0x10`, the same value with other literal text.
        [
          [
            "",
            [t("word")("const"), t("name")("v0"), mark("="), t("number")("16"), mark(";")],
            [t("word")("const"), t("name")("v0"), mark("="), t("number")("0x10"), mark(";")],
            [" ", " ", " ", " ", "\n"],
            [" ", " ", " ", " ", "\n"],
          ],
          "a.ts",
        ],
      ],
    },
  );
});

// The tool-comment list, written from the installed tools' own docs and source (vitest 5.0.5,
// vite 8.3.2, rolldown 1.2.13, esbuild 0.28.2, oxlint 1.90.0, oxfmt 0.75.0, TypeScript 7.0.2), apart
// from program.ts. Each body is a comment's text, and each form is where it may stand.
type Form = "line" | "block" | "doc";
const all: readonly Form[] = ["line", "block", "doc"];
const dash = "-";

const tools: readonly (readonly [string, readonly Form[]])[] = [
  // TypeScript: the checker's directives, triple-slash lines, JSX pragmas and `stripInternal`.
  ["@ts-ignore", all],
  ["@ts-expect-error", all],
  ["@ts-nocheck", all],
  ["@ts-check", all],
  ['/ <reference types="node" />', ["line"]],
  ['/ <reference path="./a.d.ts" />', ["line"]],
  ['/ <amd-module name="a" />', ["line"]],
  ["@jsx h", all],
  ["@jsxFrag Fragment", all],
  ["@jsxImportSource react", all],
  ["@jsxRuntime automatic", all],
  // rolldown's declarations drop code under an `@internal` JSDoc tag (its `stripInternal`).
  ["@internal", all],
  // esbuild and rolldown: annotations, legal comments and source map links.
  ["@__PURE__", all],
  ["#__PURE__", all],
  ["@__NO_SIDE_EFFECTS__", all],
  ["#__NO_SIDE_EFFECTS__", all],
  ["@__KEY__", all],
  ["! legal text", ["line", "block"]],
  ["@license MIT", all],
  ["@preserve", all],
  ["# sourceMappingURL=a.js.map", ["line", "block"]],
  ["@ sourceMappingURL=a.js.map", ["line", "block"]],
  // V8, which runs the code: a file's name in its stack traces.
  ["# sourceURL=a.js", ["line", "block"]],
  // vite and rolldown: dynamic imports left as they are.
  ["@vite-ignore", all],
  ["webpackIgnore: true", ["block"]],
  // vitest: a test file's environment and tags, read from its docblock, and coverage hints. vitest
  // reads these from the whole file, strings included, so this file spells them in two parts.
  [`@vitest${dash}environment jsdom`, all],
  [`@jest${dash}environment jsdom`, all],
  [`@vitest${dash}environment-options {}`, all],
  [`@module${dash}tag slow`, all],
  ["v8 ignore next", all],
  ["v8 ignore start", all],
  ["c8 ignore next", all],
  ["istanbul ignore next", all],
  // oxlint: its own and ESLint's directives, and ESLint's block comments it reads.
  ["oxlint-disable", all],
  ["oxlint-enable", all],
  ["oxlint-disable-line no-console", all],
  ["oxlint-disable-next-line no-console", all],
  ["eslint-disable", all],
  ["eslint-enable", all],
  ["eslint-disable-line no-console", all],
  ["eslint-disable-next-line no-console", all],
  ["global window", ["block"]],
  ["globals window", ["block"]],
  ["exported a", ["block"]],
  ["eslint-env node", ["block"]],
  // oxfmt, and Prettier's word, which it reads too.
  ["oxfmt-ignore", all],
  ["prettier-ignore", all],
];

/** A comment as the tool reads it: `/// <reference`, `//# sourceMappingURL`, `/*! ...` stay tight. */
const write = (form: Form, body: string) => {
  const tight = /^[/!#]|^@ /.test(body) ? "" : " ";

  if (form === "line") {
    return ` //${tight}${body}\n`;
  }

  return form === "block" ? ` /*${tight}${body} */ ` : ` /** ${body} */\n`;
};

const tool = fc.constantFrom(...tools).chain(([body, forms]) => fc.tuple(fc.constant(body), fc.constantFrom(...forms)));

it("property: a tool comment that was added, removed or changed is refused, in a line comment, a block or a doc block", () => {
  fc.assert(
    fc.property(
      pair,
      tool,
      fc.constantFrom("added", "removed", "changed"),
      fc.nat(),
      name,
      ([head, list, before], [body, form], how, at, file) => {
        const place = at % list.length;
        const put = (text: string) => before.map((g, i) => (i === place ? `${text}${g}` : g));
        const old = how === "added" ? before : how === "removed" ? put(write(form, body)) : put(write(form, body));
        const fresh =
          how === "added" ? put(write(form, body)) : how === "removed" ? before : put(write(form, `${body} b`));
        expect(sameProgram(file, join(head, list, old), join(head, list, fresh))).toBe(false);
      },
    ),
    { ...options, numRuns: Math.max(options.numRuns, tools.length * 3) },
  );

  // Every word on the list once, so no draw can miss one.
  for (const [body, forms] of tools) {
    for (const form of forms) {
      const plain = "const a = 1;\n";
      expect(sameProgram("a.ts", plain, `${write(form, body)}${plain}`), `${form} ${body}`).toBe(false);
    }
  }
});

it("pinned: comment-like text that changed inside a string, a template or a regex is not the same program", () => {
  // pinned: a hand-written stripper gets these wrong. A regex that drops `/* ... */` and `//...`
  // before parsing leaves each pair equal; the parser sees a changed literal.
  const pairs = [
    ['const a = "/* x */";\n', 'const a = "/* y */";\n'],
    ["const b = `/* x */`;\n", "const b = `/* y */`;\n"],
    ["const c = /[/*]/, d = /[*/]/;\n", "const c = /[/*x]/, d = /[*/]/;\n"],
    ["const e = `a // x\n`;\n", "const e = `a // y\n`;\n"],
  ] as const;

  for (const [before, after] of pairs) {
    expect(sameProgram("a.ts", before, after), after).toBe(false);
  }
});

it("scenario: a parse error on either side, or a parser that throws, is not the same program", () => {
  // scenario: broken source on the old side, then on the new side, then on both with the same
  // text, then a parser that throws on good source.
  const good = "const a = 1;\n";
  const broken = "const = ;\n";
  expect(sameProgram("a.ts", broken, good)).toBe(false);
  expect(sameProgram("a.ts", good, broken)).toBe(false);
  expect(sameProgram("a.ts", broken, broken)).toBe(false);
  expect(
    sameProgram("a.ts", good, good, () => {
      throw new Error("the parser failed");
    }),
  ).toBe(false);
  // The same good source with the real parser is the same program, so the refusals above are not
  // a function that always says no.
  expect(sameProgram("a.ts", good, `// a note\n${good}`)).toBe(true);
});

// A second tool: esbuild with whitespace minified and no legal comments, as pull request 1165's
// review checked. It normalizes literals (`0x10` becomes `16`), so it agrees only one way.
const emit = (file: string, text: string) =>
  transformSync(text, { loader: file.endsWith(".tsx") ? "tsx" : "ts", minifyWhitespace: true, legalComments: "none" })
    .code;

it("property: when the program is the same, esbuild gives the same output for both sides", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        pair.map(([head, list, before, after]) => [join(head, list, before), join(head, list, after)] as const),
        swapped.map(
          ([head, list, changed, before, after]) => [join(head, list, before), join(head, changed, after)] as const,
        ),
      ),
      name,
      ([before, after], file) => {
        // A pair the parser calls the same must emit the same; any other pair is not judged here.
        const same = sameProgram(file, before, after);
        expect(same ? emit(file, after) : emit(file, before)).toBe(emit(file, before));
      },
    ),
    options,
  );
});

const base = "b".repeat(40);
const head = "c".repeat(40);

type Status = "modified" | "changed" | "added" | "deleted" | "unread";

/** One file: a path, what happened to it, and its two sides as git would show them. */
const entry = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
    fc.constantFrom(".ts", ".tsx", ".mts", ".js", ".mjs", ".json", ".md", ".ts.snap"),
    fc.constantFrom<Status>("modified", "changed", "added", "deleted", "unread"),
    fc.constantFrom(null, 1, 128),
  )
  .map(([stem, ext, status, code]) => ({ path: `next/packages/libfabrika/src/${stem}${ext}`, status, code }));

const files = fc.uniqueArray(entry, { selector: (e) => e.path, maxLength: 8 });

// The old side of an added file, or the new side of a deleted one, would be the same program as
// its other side if read as empty text: that side holds only a comment.
const sides: Record<Status, readonly [string | null, string | null]> = {
  modified: ["const a = 1;\n", "/** A note. */\nconst a = 1;\n"],
  changed: ["const a = 1;\n", "const a = 2;\n"],
  added: [null, "// a note\n"],
  deleted: ["// a note\n", null],
  unread: ["const a = 1;\n", "const a = 1;\n"],
};

it("property: samePaths leaves out a file that was added or deleted, is not .ts or .tsx, or whose git show failed", () => {
  fc.assert(
    fc.property(files, (list) => {
      const run: Runner = (args) => {
        for (const file of list) {
          for (const [at, side] of [
            [base, 0],
            [head, 1],
          ] as const) {
            if (args.includes(`${at}:${file.path}`)) {
              const text = sides[file.status][side];

              if (file.status === "unread") {
                return { status: file.code, stdout: "" };
              }

              return text === null ? { status: 128, stdout: "" } : { status: 0, stdout: text };
            }
          }
        }

        return { status: 128, stdout: "" };
      };
      const kept = list
        .filter((file) => file.status === "modified" && /\.tsx?$/.test(file.path))
        .map((file) => file.path);
      expect(
        samePaths(
          base,
          head,
          list.map((file) => file.path),
          run,
        ),
      ).toEqual(kept);
    }),
    options,
  );
});

// vector: three file pairs from pull request 1165 (https://github.com/kamp-us/tea-fabrika/pull/1165),
// a doc fill in next/packages/libfabrika/src/transport/, saved byte for byte from its squash commit
// 2a906886e7b7023cb3d79c93d8cdf966a033005a and its parent. Saved as .txt so no tool rewrites them.
it.each(["Sshsig", "Hello", "Webauthn"])(
  "vector: the real pair %s.ts from pull request 1165 is the same program",
  (stem) => {
    const read = (side: string) =>
      readFileSync(new URL(`./fixtures/same/${stem}.${side}.txt`, import.meta.url), "utf8");
    expect(sameProgram(`${stem}.ts`, read("old"), read("new"))).toBe(true);
  },
);
