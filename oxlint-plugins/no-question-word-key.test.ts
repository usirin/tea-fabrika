// A question word is never a name in next/ and .agents/ (0081). Two rules hold it together, through
// the repo's real config: oxlint's own `eslint/id-denylist` for every name written as a word, and
// `fabrika/no-question-word-key` for a key written as a string, which id-denylist cannot see. The
// laws check that each key is reported once, by the rule that sees its spelling.
import type { Context, ESTree } from "@oxlint/plugins";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noQuestionWordKey } from "./no-question-word-key.ts";

const OURS = "fabrika(no-question-word-key)";
const DENY = "eslint(id-denylist)";
const PATH = "next/packages/libfabrika/src/keys.ts";
const WORDS: ReadonlyArray<string> = ["where", "why", "what", "who", "how"];
const runs = { seed: 119120, numRuns: 12 };

// Source text has no domain Schema. Quoted keys can contain any Unicode code point.
const unicodeKey = fc
  .array(fc.integer({ min: 0, max: 0x10ffff }), { maxLength: 24 })
  .map((points) => String.fromCodePoint(...points));

const identifier = fc
  .array(fc.constantFrom("a", "Z", "_", "$", "0", "é", "λ", "中"), { maxLength: 12 })
  .map((letters) => `key${letters.join("")}`);

const word = fc.constantFrom(...WORDS);

const isIdentifier = (key: string) => /^[$_\p{ID_Start}][$_‌‍\p{ID_Continue}]*$/u.test(key);

const escaped = (key: string) =>
  `"${Array.from({ length: key.length }, (_, i) => `\\u${key.charCodeAt(i).toString(16).padStart(4, "0")}`).join("")}"`;

/** Every declaration form that holds a key. Each source is one line. */
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
  `class Q${i} extends Schema.TaggedError<Q${i}>()("q", {${key}: Schema.String}) {}`,
];

/** The names only a word can spell: a parameter and its read, a parameter property, a local. */
const names = (name: string, i: number) => [
  `function p${i}(${name}: string) {return ${name};}`,
  `class W${i} {constructor(readonly ${name}: number) {}}`,
  `const {${name}} = {${name}: 1};`,
];

it("each question-word key is reported once, by the rule that sees its spelling, beside any neighbor", async () => {
  await fc.assert(
    fc.asyncProperty(word, unicodeKey, identifier, async (question, key, neighbor) => {
      // Every run holds a question word, so the positive side never waits on random text.
      const keys = [question, key, neighbor, `${question}Not`, question.toUpperCase(), "reason"];
      const lines: string[] = [];
      const ours: number[] = [];
      const deny: number[] = [];

      for (const [i, name] of keys.entries()) {
        const strings = [
          JSON.stringify(name),
          escaped(name),
          `[${JSON.stringify(name)}]`,
          `[\`${escaped(name).slice(1, -1)}\`]`,
        ];
        const spellings = [
          ...strings.map((spelling) => ({ spelling, seen: ours })),
          ...(isIdentifier(name) ? [{ spelling: name, seen: deny }] : []),
        ];

        for (const [j, { spelling, seen }] of spellings.entries()) {
          for (const source of declarations(spelling, i * 5 + j)) {
            lines.push(source);

            if (WORDS.includes(name)) {
              seen.push(lines.length);
            }
          }
        }
      }

      const result = await plant({ [PATH]: lines.join("\n") });
      expect(result(OURS, PATH)).toEqual(ours);
      expect(result(DENY, PATH)).toEqual(deny);
    }),
    runs,
  );
});

it("a parameter, a parameter property and a local named by a question word are refused", async () => {
  await fc.assert(
    fc.asyncProperty(word, identifier, async (question, neighbor) => {
      const result = await plant({ [PATH]: [...names(question, 0), ...names(neighbor, 1)].join("\n") });
      expect(result(DENY, PATH)).toEqual([1, 1, 2, 3, 3]);
      expect(result(OURS, PATH)).toEqual([]);
    }),
    runs,
  );
});

it("the real config holds both rules in next/ and .agents/, tests too, and leaves today's paths off", async () => {
  await fc.assert(
    fc.asyncProperty(identifier, word, async (name, question) => {
      const source = [`const a = {${question}: 1};`, `const b = {${JSON.stringify(question)}: 1};`].join("\n");
      const held = [
        `next/${name}.ts`,
        `next/${name}.test.tsx`,
        `next/apps/fabrika/src/exam/${name}.ts`,
        `.agents/skills/x/scripts/${name}.ts`,
        `.agents/skills/x/scripts/${name}.test.ts`,
      ];
      const free = [
        `packages/fabrika/src/${name}.ts`,
        `apps/fabrika/src/${name}.test.ts`,
        `programs/tracker/src/${name}.ts`,
      ];
      const result = await plant(Object.fromEntries([...held, ...free].map((path) => [path, source])));

      for (const path of held) {
        expect([path, result(DENY, path), result(OURS, path)]).toEqual([path, [1], [2]]);
      }

      for (const path of free) {
        expect([path, result(DENY, path), result(OURS, path)]).toEqual([path, [], []]);
      }
    }),
    runs,
  );
});

it("generated values, dynamic keys, reads, renamed reads and neighboring names pass", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({ value: unicodeKey, dynamic: identifier, neighbor: identifier, question: word }),
      async ({ value, dynamic, neighbor, question }) => {
        const text = JSON.stringify(question);
        const source = [
          `const ${dynamic} = ${text};`,
          `const a = {[${dynamic}]: 1, [${JSON.stringify(question.slice(0, 2))} + ${JSON.stringify(question.slice(2))}]: 1};`,
          `const c = {reason: ${JSON.stringify(value)}, ${neighbor}: ${text}};`,
          `const d = a.${question}; const e = a[${text}]; const f = ${text} in a;`,
          `const {${question}: borrowed} = a;`,
          `const g: A[${text}] = borrowed;`,
          `// ${question} is an ordinary English word here`,
        ].join("\n");
        const result = await plant({ [PATH]: source });
        expect([result(OURS, PATH), result(DENY, PATH)]).toEqual([[], []]);
      },
    ),
    runs,
  );
});

// format: these exact TypeScript spellings pin decoded names and which rule reports each.
it("format: quoted, escaped, shorthand and computed spellings", async () => {
  const result = await plant({
    [PATH]: [
      "const why = 1; const a = {why};",
      'const b = {"where": 1};',
      'const c = {"\\u0077hat": 1};',
      'const d = {["who"]: 1};',
      "const e = {[`how`]: 1};",
      "const f = {[why]: 1};",
      'interface G {readonly "\\u0077hy": string}',
      'type H = {["where"](): void};',
      "class I {readonly [`what`] = 1;}",
    ].join("\n"),
  });
  expect(result(OURS, PATH)).toEqual([2, 3, 4, 5, 7, 8, 9]);
  expect(result(DENY, PATH)).toEqual([1, 1, 6]);
});

// format: the user-facing diagnostic names 0081 and the nouns; no partial rename fix.
it("format: diagnostic names the decision and offers no autofix", () => {
  const report = vi.fn();
  // This diagnostic check supplies only the Context method this rule calls.
  const context: Pick<Context, "report"> = { report };
  const visitor = noQuestionWordKey.create(context as Context);
  const key = { type: "Literal", value: "how" };
  visitor.Property?.({
    key,
    computed: false,
    parent: { type: "ObjectExpression" },
  } as ESTree.ObjectProperty);
  expect(report.mock.calls).toEqual([
    [
      {
        node: key,
        message:
          'A question word is never a key (0081): name the value "how" holds, such as reason, location, message, to or method.',
      },
    ],
  ]);
});
