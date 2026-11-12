import type { Context, ESTree } from "@oxlint/plugins";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noQuestionWordKey } from "./no-question-word-key.ts";

// oxlint's own rule holds a name written as an identifier; ours holds a literal key (0081).
const NATIVE = "eslint(id-denylist)";
const CUSTOM = "fabrika(no-question-word-key)";
const PATH = "next/packages/libfabrika/src/keys.ts";
const WORDS = ["where", "why", "what", "who", "how"];
const runs = { seed: 119120, numRuns: 12 };

const isIdentifier = (name: string) => /^[$_\p{ID_Start}][$_‌‍\p{ID_Continue}]*$/u.test(name);

// Source text has no domain Schema. Quoted keys can contain any Unicode code point.
const unicodeKey = fc
  .array(fc.integer({ min: 0, max: 0x10ffff }), { maxLength: 24 })
  .map((points) => String.fromCodePoint(...points));

const identifier = fc
  .array(fc.constantFrom("a", "Z", "_", "$", "0", "é", "λ", "中"), { maxLength: 12 })
  .map((letters) => `key${letters.join("")}`);

// A name one step from a question word: a Unicode letter before or after it, or another case.
const neighbor = fc.oneof(
  fc
    .tuple(
      fc.constantFrom(...WORDS),
      fc.array(fc.constantFrom("s", "Not", "é", "λ", "中", "_", "$", "0", "‍"), { minLength: 1, maxLength: 3 }),
    )
    .map(([word, affix]) => `${word}${affix.join("")}`),
  fc
    .tuple(
      fc.constantFrom(...WORDS),
      fc.array(fc.constantFrom("a", "é", "λ", "中", "_", "$"), { minLength: 1, maxLength: 3 }),
    )
    .map(([word, affix]) => `${affix.join("")}${word}`),
  fc.constantFrom(...WORDS).map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`),
  fc.constantFrom(...WORDS).map((word) => word.toUpperCase()),
);

const escaped = (key: string) =>
  `"${Array.from({ length: key.length }, (_, i) => `\\u${key.charCodeAt(i).toString(16).padStart(4, "0")}`).join("")}"`;

const parameterModifiers = [
  "public",
  "protected",
  "private",
  "readonly",
  "public readonly",
  "protected readonly",
  "private readonly",
];

// Every form that declares a key, written with one spelling of its name.
const declarations = (key: string, i: number) => [
  `const a${i} = {${key}: 1};`,
  `const b${i} = {${key}() {}};`,
  `const c${i} = {get ${key}() {return 1;}};`,
  `const d${i} = {set ${key}(value: number) {}};`,
  `class E${i} {${key} = 1;}`,
  `class F${i} {readonly ${key} = 1;}`,
  `class G${i} {static ${key}() {}}`,
  `class H${i} {get ${key}() {return 1;}}`,
  `class I${i} {set ${key}(value: number) {}}`,
  `abstract class R${i} {abstract ${key}: number;}`,
  `abstract class S${i} {abstract ${key}(): void;}`,
  `class T${i} {accessor ${key} = 1;}`,
  `class U${i} {static accessor ${key} = 1;}`,
  `abstract class V${i} {abstract accessor ${key}: number;}`,
  `type J${i} = {readonly ${key}?: number};`,
  `type K${i} = {${key}(): void};`,
  `interface L${i} {readonly ${key}: number}`,
  `interface M${i} {${key}(): void}`,
  `const n${i} = Schema.Struct({${key}: Schema.String});`,
  `const o${i} = Schema.TaggedStruct("o", {${key}: Schema.String});`,
  `const p${i} = Schema.TaggedUnion({saved: {${key}: Schema.String}});`,
  `class Q${i} extends Schema.TaggedError<Q${i}>()("q", {${key}: Schema.String}) {}`,
];

// Every form that binds a name, which only an identifier spelling can write. Each sits in its own
// function, so the generated file declares a name at most once per scope.
const bindings = (name: string, i: number) => [
  ...parameterModifiers.flatMap((modifier, n) => [
    `class P${i}_${n} {constructor(${modifier} ${name}: number) {}}`,
    `class D${i}_${n} {constructor(${modifier} ${name}: number = 1) {}}`,
  ]),
  `class W${i} {constructor(${name}: number) {}}`,
  `function f${i}() {const ${name} = 1; return ${name};}`,
  `function g${i}() {let ${name} = 1; return ${name};}`,
  `function h${i}(${name}: string) {return ${name};}`,
  `function k${i}(${name} = "") {return ${name};}`,
  `function l${i}(...${name}: string[]) {return ${name};}`,
  `const m${i} = (${name}: number) => ${name};`,
  `function q${i}(source: {key: number}) {const {key: ${name}} = source; return ${name};}`,
  `function r${i}(source: {${name}: number}) {const {${name}} = source; return ${name};}`,
  `function s${i}(source: number[]) {const [${name}] = source; return ${name};}`,
  `function t${i}({${name}}: {${name}: number}) {return ${name};}`,
  `function u${i}() {for (const ${name} of [1]) {return ${name};} return 0;}`,
  `function v${i}() {try {return 1;} catch (${name}) {return ${name};}}`,
  `type X${i} = [${name}: string];`,
  `function y${i}() {const ${name} = 1; return {${name}};}`,
  `function z${i}(target: {${name}: number}) {target.${name} = 1;}`,
];

it("refuses all five words in every declaration and binding form, each by exactly one rule", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.constantFrom(...WORDS), unicodeKey),
      identifier,
      neighbor,
      async (key, other, near) => {
        // Every run holds all five words, so the positive branch never depends on random text.
        const names = [...WORDS, key, other, near, "whyNot", "Who", "reason", "location"];
        const lines: string[] = [];
        const native: number[] = [];
        const custom: number[] = [];
        const add = (source: string, by: number[] | null) => {
          lines.push(source);
          by?.push(lines.length);
        };

        for (const [i, name] of names.entries()) {
          const refused = WORDS.includes(name);
          const literal = [
            JSON.stringify(name),
            escaped(name),
            `[${JSON.stringify(name)}]`,
            `[\`${escaped(name).slice(1, -1)}\`]`,
          ];

          for (const [j, spelling] of literal.entries()) {
            for (const source of declarations(spelling, i * 10 + j)) {
              add(source, refused ? custom : null);
            }
          }

          if (isIdentifier(name)) {
            for (const [j, spelling] of [name, escaped(name).slice(1, -1)].entries()) {
              for (const source of [...declarations(spelling, i * 10 + 5 + j), ...bindings(spelling, i * 10 + 5 + j)]) {
                add(source, refused ? native : null);
              }
            }
          }
        }

        const result = await plant({ [PATH]: lines.join("\n") });
        expect([...new Set(result(NATIVE, PATH))]).toEqual(native);
        expect([...new Set(result(CUSTOM, PATH))]).toEqual(custom);
      },
    ),
    runs,
  );
});

it("real config holds generated next/, exam, test and skill paths, and leaves today's paths off", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.tuple(
        identifier,
        fc.constantFrom("ts", "tsx"),
        fc.constantFrom(...WORDS),
        fc.constantFrom("lead", "tests", "plan", "step-commit"),
      ),
      async ([name, extension, word, skill]) => {
        const source = (spelling: string) => declarations(spelling, 0).join("\n");
        const held = [
          `next/${name}.${extension}`,
          `next/${name}.test.${extension}`,
          `next/apps/fabrika/src/exam/${name}.${extension}`,
          `next/packages/libfabrika/src/${name}.test-support.ts`,
          `.agents/skills/${skill}/scripts/${name}.ts`,
          `.agents/skills/lead/scripts/${name}.test.ts`,
        ];
        const today = [
          `packages/fabrika/src/${name}.${extension}`,
          `apps/fabrika/src/${name}.test.${extension}`,
          `programs/tracker/src/${name}.${extension}`,
        ];
        const files: Record<string, string> = {};

        for (const path of [...held, ...today]) {
          files[path] = source(word);
          files[path.replace(/(\.[a-z-]+)?\.tsx?$/, (end) => `-quoted${end}`)] = source(JSON.stringify(word));
        }

        const result = await plant(files);
        const every = declarations(word, 0).map((_, n) => n + 1);

        for (const path of [...held, ...today]) {
          const quoted = path.replace(/(\.[a-z-]+)?\.tsx?$/, (end) => `-quoted${end}`);
          const expected = held.includes(path) ? every : [];
          expect([...new Set(result(NATIVE, path))]).toEqual(expected);
          expect([...new Set(result(CUSTOM, quoted))]).toEqual(expected);
          expect(result(CUSTOM, path)).toEqual([]);
          expect(result(NATIVE, quoted)).toEqual([]);
        }
      },
    ),
    runs,
  );
});

it("generated values, dynamic keys, external reads, comments, SQL and neighboring names pass", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({ value: unicodeKey, dynamic: identifier, near: neighbor, word: fc.constantFrom(...WORDS) }),
      async ({ value, dynamic, near, word }) => {
        const text = JSON.stringify(value);
        const source = [
          `import { ${word} as imported } from "./outside.ts";`,
          `const text = ${text} + imported;`,
          `const ${dynamic} = text;`,
          `const a = {[${dynamic}]: text, [text]: text, [${JSON.stringify(word.slice(0, 2))} + ${JSON.stringify(word.slice(2))}]: text};`,
          `const b = {[\`${word.slice(0, 2)}\${text}\`]: text};`,
          `const c = {reason: text, ${near}: ${JSON.stringify(word)}, ${JSON.stringify(near)}: text};`,
          `const d = a.${word}; const e = a[${JSON.stringify(word)}]; const f = ${JSON.stringify(word)} in a;`,
          // An outside key read into a good local name is the edge 0081 allows.
          `const {${word}: borrowed} = a; const {${word}: renamed = text} = a;`,
          `function read({${word}: kept}: {readonly ${near}: string}) {return kept;}`,
          `const g: A[${JSON.stringify(word)}] = borrowed; const h: ${near} = renamed;`,
          `const sql = "select * from rows ${word} id = ?";`,
          `// ${word} is an ordinary English word here`,
          `type ${near[0]?.toUpperCase()}${near.slice(1)}Type = {${near}: string};`,
        ].join("\n");
        const result = await plant({ [PATH]: source });
        expect(result(NATIVE, PATH)).toEqual([]);
        expect(result(CUSTOM, PATH)).toEqual([]);
      },
    ),
    runs,
  );
});

// format: these exact TypeScript spellings pin decoded names, shorthand and computed identifiers.
it("format: quoted, escaped, shorthand and computed spellings", async () => {
  const result = await plant({
    [PATH]: [
      "const why = 1;",
      "const a = {why};",
      'const b = {"where": 1};',
      'const c = {"\\u0077hat": 1};',
      'const d = {["who"]: 1};',
      "const e = {[`how`]: 1};",
      "const f = {[why]: 1};",
      'interface G {readonly "\\u0077here": string}',
      'type H = {["who"](): void};',
      "class I {readonly [`what`] = 1;}",
      "const j = {\\u0077ho: 1};",
    ].join("\n"),
  });
  expect([...new Set(result(NATIVE, PATH))]).toEqual([1, 2, 7, 11]);
  expect(result(CUSTOM, PATH)).toEqual([3, 4, 5, 6, 8, 9, 10]);
});

// format: the user-facing diagnostic names all five words, asks for the value's noun, assumes no
// replacement and offers no autofix.
it("format: diagnostic names the five words and offers no autofix", () => {
  const report = vi.fn();
  // This diagnostic check supplies only the Context method this rule calls.
  const context: Pick<Context, "report"> = { report };
  const visitor = noQuestionWordKey.create(context as Context);
  const keys = WORDS.map((word) => ({ type: "Literal", value: word, raw: JSON.stringify(word) }));

  for (const key of [...keys, { type: "Identifier", name: "why" }]) {
    visitor.Property?.({
      key,
      computed: false,
      parent: { type: "ObjectExpression" },
    } as ESTree.ObjectProperty);
  }

  expect(report.mock.calls).toEqual(
    keys.map((key) => [
      {
        node: key,
        message:
          "Name this key with the noun for the value it holds: where, why, what, who and how are question words, never names (0081).",
      },
    ]),
  );
});
