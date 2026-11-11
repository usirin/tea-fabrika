import type { Context } from "@oxlint/plugins";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noStageWord } from "./no-stage-word.ts";

const CODE = "fabrika(no-stage-word)";
const runs = { seed: 681080, numRuns: 12 };
const DISABLE = "// oxlint-disable-next-line fabrika/no-stage-word --";

// Source text has no domain Schema. A name is word parts joined in one spelling; the retired word
// is one part.
const part = fc.constantFrom("local", "error", "driver", "wire", "records", "one", "file", "p34", "dev");
const retired = fc.constantFrom("stage", "stages");
// One fused lowercase word that holds the letters but is not the word, like backstage.
const letters = fc.stringMatching(/^[a-z]{1,6}$/);
const fused = fc.tuple(letters, letters).map(([before, after]) => `${before}stage${after}`);
const neighbor = fc.oneof(fc.constantFrom("backstage", "stagecoach", "instance", "startDev"), fused);
const style = fc.constantFrom("camel", "pascal", "snake", "upper", "kebab", "path", "dot", "space");
const IDENTIFIER_STYLES = new Set(["camel", "pascal", "snake", "upper"]);

const upper = (word: string) => word[0]!.toUpperCase() + word.slice(1);

const join = (words: readonly string[], spelling: string) => {
  switch (spelling) {
    case "camel":
      return words.map((word, i) => (i === 0 ? word : upper(word))).join("");
    case "pascal":
      return words.map(upper).join("");
    case "snake":
      return words.join("_");
    case "upper":
      return words.map((word) => word.toUpperCase()).join("_");
    case "kebab":
      return words.join("-");
    case "path":
      return words.join("/");
    case "dot":
      return words.join(".");
    default:
      return words.join(" ");
  }
};

// Every placement of one name, one line each. Identifier placements need an identifier spelling.
const placements = (name: string, i: number, tsx: boolean) => [
  `const s${i} = ${JSON.stringify(name)};`,
  `const k${i} = {${JSON.stringify(name)}: 1};`,
  `const c${i} = {[${JSON.stringify(name)}]: 1};`,
  `import i${i} from ${JSON.stringify(`./${name}.ts`)};`,
  `const t${i} = \`\${s${i}}${name}\${s${i}}\`;`,
  `// ${name}`,
  `/* ${name} */`,
  ...(tsx ? [`const j${i} = <p>${name}</p>;`] : []),
  ...(/^[A-Za-z_][\w]*$/.test(name)
    ? [
        `{const ${name} = 1;}`,
        `const o${i} = {${name}: 1};`,
        `type T${i}_${name} = number;`,
        `class C${i} {#${name} = 1;}`,
      ]
    : []),
];

it("rejects the word in generated names, spellings and placements, and passes their neighbors", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        before: fc.option(part, { nil: undefined }),
        after: fc.option(part, { nil: undefined }),
        word: retired,
        allowed: neighbor,
        spelling: style,
        bare: fc.constantFrom("stage", "Stage", "STAGE", "stages"),
      }),
      async ({ before, after, word, allowed, spelling, bare }) => {
        const named = (middle: string) => {
          const words = [before, middle, after].filter((w) => w !== undefined);
          // An identifier spelling for a placement that needs one, so every run has identifiers.
          return [join(words, spelling), join(words, IDENTIFIER_STYLES.has(spelling) ? spelling : "camel")];
        };
        const files: Record<string, string> = {};
        const expected: Record<string, number[]> = {};

        for (const tsx of [false, true]) {
          const path = `next/apps/fabrika/src/words.${tsx ? "tsx" : "ts"}`;
          const lines: string[] = [];
          const fires: number[] = [];
          // Every run holds both sides: retired spellings fire, their neighbors in the same places pass.
          const cases: Array<[string, boolean]> = [
            ...named(word).map((name): [string, boolean] => [name, true]),
            [bare, true],
            ...named(allowed).map((name): [string, boolean] => [name, false]),
          ];

          for (const [n, [name, fire]] of cases.entries()) {
            for (const line of placements(name, n, tsx)) {
              lines.push(line);

              if (fire) {
                fires.push(lines.length);
              }
            }
          }

          files[path] = lines.join("\n");
          expected[path] = fires;
        }

        const result = await plant(files);

        for (const [path, fires] of Object.entries(expected)) {
          expect(result(CODE, path), files[path]).toEqual(fires);
        }
      },
    ),
    runs,
  );
});

it("an exception allows only its annotated line, at generated offsets beside unannotated uses", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        filler: fc.array(fc.constantFrom("a();", "// instance", "b(`instance`);"), { maxLength: 6 }),
        gap: fc.array(fc.constant("g();"), { maxLength: 3 }),
        kept: fc.constantFrom(
          'deploy({stack, stage: "local", dev: true});',
          'stack({name: "fabrika", stage: "local"});',
          'assert.equal(bar.driver, "experiments/238-local-stage-speed-bar.ts");',
        ),
        planted: fc.constantFrom("localStage();", 'e("StageError");', "// a stage"),
        path: fc.constantFrom("next/apps/fabrika/src/brain.ts", "next/apps/fabrika/src/sibling.laws.test.ts"),
      }),
      async ({ filler, gap, kept, planted, path }) => {
        const lines = [...filler, planted, `${DISABLE} the kept word`, kept, ...gap, planted, kept];
        const start = filler.length + 1;
        const result = await plant({ [path]: lines.join("\n") });
        // The planted lines and the second, unannotated copy fire; the annotated copy does not.
        expect(result(CODE, path)).toEqual([start, start + 3 + gap.length, start + 4 + gap.length]);
      },
    ),
    runs,
  );
});

it("real config holds generated next/ paths and leaves today's version, .agents/ and top-level scripts out", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.tuple(letters, fc.constantFrom("ts", "tsx"), fc.constantFrom("", ".test", ".test-support")),
      async ([name, extension, kind]) => {
        const file = `${name}${kind}.${extension}`;
        const inside = [`next/${file}`, `next/apps/fabrika/src/${file}`, `next/apps/fabrika/src/exam/${file}`];
        const outside = [
          `packages/pipeline/src/stages/${file}`,
          `apps/fabrika/src/${file}`,
          `programs/tracker/src/${file}`,
          // Not oxlint-plugins/: the plant links that real folder, so a file there would land in the repo.
          `scripts/fixture-${file}`,
          `.agents/skills/lead/scripts/${file}`,
          `nextish/${file}`,
        ];
        const source = "const localStage = 1;\n// a stage\n";
        const result = await plant(Object.fromEntries([...inside, ...outside].map((path) => [path, source])));

        for (const path of inside) {
          expect(result(CODE, path), path).toEqual([1, 2]);
        }

        for (const path of outside) {
          expect(result(CODE, path), path).toEqual([]);
        }
      },
    ),
    runs,
  );
});

it("absolute, relative and Windows spellings of a path get the same next/-only scope", () => {
  fc.assert(
    fc.property(
      fc.record({
        root: fc.array(letters, { minLength: 1, maxLength: 3 }),
        top: fc.constantFrom("next", "packages", "apps", "oxlint-plugins", "nextish", ".agents"),
        rest: fc.array(letters, { minLength: 1, maxLength: 3 }),
        windows: fc.boolean(),
        absolute: fc.boolean(),
        slash: fc.boolean(),
      }),
      ({ root, top, rest, windows, absolute, slash }) => {
        const sep = windows ? "\\" : "/";
        const cwd = (windows ? "C:" : "") + sep + root.join(sep) + (slash ? sep : "");
        const relative = `${[top, ...rest].join(sep)}.ts`;
        const filename = absolute ? `${cwd.replace(/[\\/]$/, "")}${sep}${relative}` : relative;
        // The scope check reads only the two paths; the rest of the Context is never touched for it.
        const context: Pick<Context, "cwd" | "filename"> = { cwd, filename };
        const visitor = noStageWord.create(context as Context);
        expect(Object.keys(visitor).length > 0, `${cwd} ${filename}`).toBe(top === "next");
      },
    ),
    { ...runs, numRuns: 200 },
  );
});

// format: escapes decode to the word, in literals, keys, identifiers and template text.
it("format: escaped literal and identifier spellings fire by their decoded word", async () => {
  const path = "next/apps/fabrika/src/escaped.ts";
  const result = await plant({
    [path]: [
      'const a = "\\u0073tage";',
      'const b = {"\\u{53}tageError": 1};',
      "const \\u0073tageX = 1;",
      "const c = `\\x73tage`;",
      'const d = {["sta\\u0067e"]: 1};',
      'const e = "\\u0062ackstage";',
    ].join("\n"),
  });
  expect(result(CODE, path)).toEqual([1, 2, 3, 4, 5]);
});

// format: each comment and text form, with one report per line that holds the word.
it("format: line, block and multi-line comments, template lines and TSX text", async () => {
  const path = "next/apps/fabrika/src/view.tsx";
  const result = await plant({
    [path]: [
      "// the stage starts",
      "/* the Stage */",
      "/**",
      " * no word here",
      " * stages",
      " */",
      "const t = `first",
      "STAGE_DRIVER",
      "last`;",
      "const v = <p>the stage-wire</p>;",
      'const w = <p title="backstage">stagecoach</p>;',
    ].join("\n"),
  });
  expect(result(CODE, path)).toEqual([1, 2, 5, 8, 10]);
});

// scenario: Alchemy's own stage key passes only on its annotated line; the same key beside it fails.
it("scenario: the annotated Alchemy key passes and an adjacent domain use fails", async () => {
  const path = "next/apps/fabrika/src/brain.ts";
  const result = await plant({
    [path]: [
      "const stack = {",
      '  name: "fabrika",',
      `  ${DISABLE} Alchemy's own key picks its deployment state`,
      '  stage: "local",',
      '  stage2: "local",',
      "};",
      "const localStage = stack;",
    ].join("\n"),
  });
  expect(result(CODE, path)).toEqual([5, 7]);
});

// pinned: experiment 238's saved driver name and today's app's capture stages keep their bytes.
it("pinned: the saved driver and today's quote pass on annotated lines, new text beside them fails", async () => {
  const path = "next/apps/fabrika/src/instance-one-file.test.ts";
  const result = await plant({
    [path]: [
      `${DISABLE} saved speed-bar results name experiment 238's driver exactly`,
      'assert.equal(bar.driver, "experiments/238-local-stage-speed-bar.ts");',
      'assert.equal(bar.name, "a local stage");',
      "// oxlint-disable fabrika/no-stage-word -- the pinned bytes quote today's app, which keeps its pipeline words",
      "const quote = `",
      '  { "why": "today\'s app\'s keyboard focus laws and capture stages" },',
      "`;",
      "// oxlint-enable fabrika/no-stage-word",
      "const after = `capture stages`;",
    ].join("\n"),
  });
  expect(result(CODE, path)).toEqual([3, 9]);
});

// format: a directive that names this rule is not itself a use; its reason after `--` is read.
it("format: an ignore directive's rule names are not read, its reason and the next violation are", async () => {
  const path = "next/apps/fabrika/src/directive.ts";
  const result = await plant({
    [path]: [
      `${DISABLE} a kept key`,
      "const localStage = 1;",
      "// oxlint-disable-next-line no-console -- not this rule",
      "const stageError = 2;",
      "/* oxlint-disable fabrika/no-stage-word -- a range */",
      "/* oxlint-enable fabrika/no-stage-word */",
      "const stageAfter = 3;",
      "// oxlint-disable-next-line fabrika/no-promises -- edge: the local stage proxy",
      "// eslint-disable-line fabrika/no-stage-word",
    ].join("\n"),
  });
  expect(result(CODE, path)).toEqual([4, 7, 8]);
});

// format: the path alone fires, at the file's start, with no code tokens to report on.
it("format: an empty file or folder named for the word is refused by its path", async () => {
  const files = {
    "next/apps/fabrika/src/stage.ts": "",
    "next/apps/fabrika/src/stage-records.test.ts": "",
    "next/apps/fabrika/stages/index.ts": "",
    "next/apps/fabrika/src/localStage.tsx": "",
    "next/apps/fabrika/src/backstage.ts": "",
    "next/apps/fabrika/src/instance.ts": "",
  };
  const result = await plant(files);
  expect(Object.keys(files).map((path) => result(CODE, path))).toEqual([[1], [1], [1], [1], [], []]);
});
