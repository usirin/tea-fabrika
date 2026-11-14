// `fabrika/jsdocs`, the docs rule of E6 (0023, 0120): ticket 913, slice B2.1 of
// `docs/plan/effect-rules-big.md`, with laws 3 to 9 of the draft that plan cites (laws 1 and 2 are the
// rule itself, in `pnpm lint`). Laws 3 to 7 run in process through oxlint's RuleTester on generated
// files, seed 119120; law 8 runs the real oxlint over Effect 4.1.2's own source; law 9 lints planted
// files at their real paths with the repo's own `.oxlintrc.json`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { afterAll, describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { jsdocs } from "./jsdocs.ts";

const ROOT = join(import.meta.dirname, "..");
const RUNS = { seed: 119120, numRuns: 100 };

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });

type Since = "absent" | "required";

/** The rule fires on exactly these lines of `code`, each once. */
const expectFires = (code: string, lines: ReadonlyArray<number>, since: Since = "absent") => {
  const options = [{ since }];
  tester.run("jsdocs", jsdocs, {
    valid: lines.length === 0 ? [{ code, filename: "case.ts", options }] : [],
    invalid:
      lines.length === 0
        ? []
        : [
            {
              code,
              filename: "case.ts",
              options,
              errors: [...lines].sort((a, b) => a - b).map((line) => ({ line, message: /\(E6, 0023\)/ })),
            },
          ],
  });
};

const doc = (...lines: ReadonlyArray<string>): string =>
  ["/**", ...lines.map((line) => (line === "" ? " *" : ` * ${line}`)), " */"].join("\n");

const MODULE = doc("A planted module.", "", "@stability unstable");

/** An import under the module block, so the block is the module's whatever the first export is (case 21). */
const IMPORT = 'import { z } from "./z.ts";';

/** A block in Effect's shape for an export of any kind here. */
const RIGHT = doc("A planted export.", "", "@stability unstable", "@category models");

/**
 * Each a block wrong in one named way, wrong on every kind of export: a re-export's tag-only pass
 * needs its first line to be a tag, which none of these has.
 */
const WRONG = {
  "no blank line before the tags": doc("A planted export.", "@stability unstable", "@category models"),
  "two description paragraphs": doc("A planted export.", "", "More.", "", "@stability unstable", "@category models"),
  "no @stability": doc("A planted export.", "", "@category models"),
  "a @stability outside the three": doc("A planted export.", "", "@stability solid", "@category models"),
  "tags out of order": doc("A planted export.", "", "@category models", "@stability unstable"),
  "an @example tag": doc("A planted export.", "", "@example x", "@stability unstable", "@category models"),
  "a Markdown heading": doc("A planted export.", "", "# Heading", "", "@stability unstable", "@category models"),
  "a @since before a release": doc("A planted export.", "", "@stability unstable", "@category models", "@since 1.0.0"),
  "two blocks, the last wrong": `${RIGHT}\n${doc("A planted export.")}`,
} as const;

type Wrong = keyof typeof WRONG;

/** What stands above one export: Effect's shape, nothing, or a block wrong in one named way. */
type State =
  | { readonly _tag: "right" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "wrong"; readonly way: Wrong };

const state: fc.Arbitrary<State> = fc.oneof(
  fc.constant({ _tag: "right" } as const),
  fc.constant({ _tag: "missing" } as const),
  fc.constantFrom(...(Object.keys(WRONG) as Wrong[])).map((way) => ({ _tag: "wrong", way }) as const),
);

const blockFor = (s: State): string | null => (s._tag === "right" ? RIGHT : s._tag === "missing" ? null : WRONG[s.way]);

/**
 * One piece of a file. `text` writes it with the block (or `null`) where its export takes one, and
 * `at` is the export's line within the piece, counted from 0, or `null` for a piece nothing reads.
 */
type Piece = {
  readonly text: (n: number, block: string | null) => string;
  readonly at: (n: number, block: string | null) => number | null;
};

const lineCount = (text: string | null): number => (text === null ? 0 : text.split("\n").length);

/** A statement under its block: the export is the first line after the block. */
const under = (body: (n: number) => string): Piece => ({
  text: (n, block) => (block === null ? body(n) : `${block}\n${body(n)}`),
  at: (_n, block) => lineCount(block),
});

/** Cases 6 to 13, and the owner's schema-and-type pair. */
const PIECES = {
  const: under((n) => `export const v${n} = ${n};`),
  // Case 7: one statement, one block.
  consts: under((n) => `export const a${n} = 1,\n  b${n} = 2;`),
  let: under((n) => `export let l${n} = ${n};`),
  function: under((n) => `export function f${n}() {\n  return ${n};\n}`),
  // Case 8: only the first signature needs the block.
  overloads: under(
    (n) =>
      `export function o${n}(a: string): string;\nexport function o${n}(a: number): number;\nexport function o${n}(a: unknown) {\n  return a;\n}`,
  ),
  class: under((n) => `export class C${n} {\n  readonly a = ${n};\n}`),
  interface: under((n) => `export interface I${n} {\n  readonly a: string;\n}`),
  type: under((n) => `export type T${n} = string;`),
  // Case 12: the namespace and each export inside it.
  namespace: under((n) => `export declare namespace N${n} {\n  /** An inner type. */\n  export type A = string;\n}`),
  // Case 10: a namespace re-export.
  "star as": under((n) => `export * as S${n} from "./s${n}.ts";`),
  // Case 11: each name in a list, inside the braces.
  list: {
    text: (n, block) => `const x${n} = ${n};\nexport {\n${block === null ? "" : `${block}\n`}  x${n},\n};`,
    at: (_n, block) => 2 + lineCount(block),
  },
  from: {
    text: (n, block) => `export {\n${block === null ? "" : `${block}\n`}  y${n},\n} from "./y${n}.ts";`,
    at: (_n, block) => 1 + lineCount(block),
  },
  // The owner's answer of 2026-11-13: the type directly under its same-name schema shares its block.
  pair: under((n) => `export const P${n} = { a: ${n} };\nexport type P${n} = typeof P${n};`),
  // Not directly under it: the type needs its own block, and here has none.
  "split pair": {
    text: (n, block) =>
      `${block === null ? "" : `${block}\n`}export const Q${n} = { a: ${n} };\nconst gap${n} = 0;\nexport type Q${n} = typeof Q${n};`,
    at: (_n, block) => lineCount(block),
  },
  // Cases 9, 13 and 14: not read, so no block is asked.
  "star from": { text: (n) => `export * from "./all${n}.ts";`, at: () => null },
  plain: { text: (n) => `const p${n} = ${n};`, at: () => null },
  enum: { text: (n) => `export enum E${n} {\n  A,\n}`, at: () => null },
} satisfies Record<string, Piece>;

type Kind = keyof typeof PIECES;

const KINDS = Object.keys(PIECES) as Kind[];

/** A `//` line between a block and its export is skipped (case 16). */
const GAPS = ["", "// @ts-expect-error planted\n", "// a planted note\n"] as const;

describe("law 3: the rule reports exactly the exports whose block is missing or wrong, once each, at the export's first line", () => {
  it("for any generated public file", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom(...KINDS), state, gap: fc.constantFrom(...GAPS) }), {
          minLength: 1,
          maxLength: 8,
        }),
        (pieces) => {
          const parts = [MODULE, IMPORT];
          const fires: number[] = [];
          let line = lineCount(parts.join("\n")) + 1;

          pieces.forEach(({ kind, state: s, gap }, n) => {
            const piece: Piece = PIECES[kind];
            const block = blockFor(s);
            const shown = block === null ? null : `${block}\n${gap}`.replace(/\n$/, "");
            const text = piece.text(n, shown);
            const at = piece.at(n, shown);

            if (at !== null && s._tag !== "right") {
              fires.push(line + at);
            }

            // The split pair's type has no block of its own, so it fires whatever stands on the schema.
            if (kind === "split pair") {
              fires.push(line + lineCount(text) - 1);
            }

            parts.push(text);
            line += lineCount(text);
          });

          expectFires(`${parts.join("\n")}\n`, fires);
        },
      ),
      RUNS,
    );
  });

  it.each([
    [
      "scenario: a member's own block is judged once its export passes, and fires at the export",
      `${MODULE}\n${RIGHT}\nexport interface A {\n  /** A field.\n   * @category models */\n  readonly a: string;\n}\n`,
      [12],
    ],
    [
      "scenario: a member block with @default and no @category passes",
      `${MODULE}\n${RIGHT}\nexport interface A {\n  /**\n   * A field.\n   *\n   * @default 1\n   */\n  readonly a: number;\n}\n`,
      [],
    ],
    ["scenario: a member with no block passes", `${MODULE}\n${RIGHT}\nexport class A {\n  readonly a = 1;\n}\n`, []],
    [
      "pinned: the owner's answer of 2026-11-13, a type directly under its same-name schema shares the schema's block",
      `${MODULE}\n${IMPORT}\n${RIGHT}\nexport const Sent = { a: 1 };\nexport type Sent = typeof Sent;\n`,
      [],
    ],
    [
      "pinned: the same answer, a type not directly under its schema takes its own block",
      `${MODULE}\n${IMPORT}\n${RIGHT}\nexport const Sent = { a: 1 };\n${RIGHT}\nexport const other = 1;\nexport type Sent = typeof Sent;\n`,
      [21],
    ],
    [
      "scenario: a pair's type that carries its own block is judged by it",
      `${MODULE}\n${RIGHT}\nexport const S = { a: 1 };\n${doc("No tags.")}\nexport type S = typeof S;\n`,
      [16],
    ],
    [
      "scenario: a type under a same-name schema that is not exported is not a pair",
      `${MODULE}\n${IMPORT}\nconst S = { a: 1 };\nexport type S = typeof S;\n`,
      [8],
    ],
    [
      "scenario: two blocks, the last right, pass (case 17)",
      `${MODULE}\n${doc("Lost.")}\n${RIGHT}\nexport const a = 1;\n`,
      [],
    ],
  ])("%s", (_name, code, lines) => {
    expectFires(code, lines);
  });
});

const TAGS = ["deprecated", "see", "stability", "category"] as const;

const VALUE = { deprecated: "use b", see: "b", stability: "unstable", category: "models" } as const;

describe("law 4: tags pass only in the order of case 29, with @stability one of three, and any tag from outside the list fires", () => {
  it("for any subset of the allowed tags, in any order, with or without one from outside", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...TAGS]),
        fc.constantFrom("stable", "unstable", "experimental", "solid"),
        fc.option(fc.constantFrom("param", "returns", "example", "default", "author", "since"), { nil: undefined }),
        fc.nat(),
        (tags, stability, outside, at) => {
          const lines = tags.map((tag) => `@${tag} ${tag === "stability" ? stability : VALUE[tag]}`);

          if (outside !== undefined) {
            lines.splice(at % (lines.length + 1), 0, `@${outside} x`);
          }

          const order = tags.map((tag) => TAGS.indexOf(tag));
          const ordered = order.every((rank, i) => i === 0 || (order[i - 1] ?? rank) < rank);
          const passes =
            ordered &&
            tags.includes("stability") &&
            tags.includes("category") &&
            stability !== "solid" &&
            outside === undefined;
          const block = doc("A planted export.", ...(lines.length > 0 ? ["", ...lines] : []));
          const code = `${MODULE}\n${block}\nexport const v = 1;\n`;
          expectFires(code, passes ? [] : [lineCount(`${MODULE}\n${block}`) + 1]);
        },
      ),
      RUNS,
    );
  });
});

describe("law 5: a file with a checked export fires for its module block unless one stands as cases 20 to 22 say", () => {
  it("for any header, imports, module block and first export", () => {
    fc.assert(
      fc.property(
        fc.record({
          header: fc.boolean(),
          imports: fc.boolean(),
          module: fc.constantFrom("none", "right", "with @category", "a plain /* */ first"),
          first: fc.boolean(),
          exported: fc.boolean(),
        }),
        ({ header, imports, module, first, exported }) => {
          const parts: string[] = [];
          let line = 1;
          const push = (text: string) => {
            parts.push(text);
            line += lineCount(text);
          };

          if (header) {
            push("// A planted header.\n// Its second line.");
          }

          const blockLine = line;

          if (module === "right") {
            push(MODULE);
          } else if (module === "with @category") {
            push(doc("A planted module.", "", "@stability unstable", "@category models"));
          } else if (module === "a plain /* */ first") {
            push(`/* not a doc block */\n${MODULE}`);
          }

          if (imports) {
            push('import { z } from "./z.ts";');
          }

          if (first) {
            push(RIGHT);
          }

          const exportLine = line;
          push(exported ? "export const v = 1;" : "const v = 1;");

          const block = module !== "none" && module !== "a plain /* */ first" && (imports || first);
          const fires: number[] = [];

          // With no import and one block above it, the export owns that block (case 22).
          const owns = module === "with @category" && !imports;

          if (exported && !first && !owns) {
            fires.push(exportLine);
          }

          if (exported && !block) {
            fires.push(1);
          } else if (exported && module === "with @category") {
            fires.push(blockLine);
          }

          expectFires(`${parts.join("\n")}\n`, fires);
        },
      ),
      RUNS,
    );
  });
});

/** Case 18 and the tag-only pass of cases 10 and 11. */
const FORMS = ["const", "function", "class", "interface", "type", "namespace", "star as", "list", "from"] as const;

const RE_EXPORTS: ReadonlySet<string> = new Set(["star as", "list", "from"]);

describe("law 6: a block with @internal takes its export out, and tags alone pass on a re-export and on no other export", () => {
  it("for each export form with each of the two block kinds", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FORMS), fc.constantFrom("internal", "tags alone"), (form, kind) => {
        const block = kind === "internal" ? "/** @internal */" : doc("@stability unstable", "@category models");
        const piece: Piece = PIECES[form];
        const text = piece.text(0, block);
        const at = piece.at(0, block) ?? 0;
        const fires = kind === "tags alone" && !RE_EXPORTS.has(form) ? [lineCount(MODULE) + 2 + at] : [];
        expectFires(`${MODULE}\n${IMPORT}\n${text}\n`, fires);
      }),
      RUNS,
    );
  });

  it("scenario: a file whose only export is @internal needs no module block (case 24)", () => {
    expectFires("/** @internal */\nexport const a = 1;\n", []);
  });
});

describe("law 7: with since absent a @since tag fires, with since required its absence fires, and nothing else changes", () => {
  it("for either value and a right block with or without the tag", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Since>("absent", "required"),
        fc.boolean(),
        // A namespace's inner exports take `@since` too under `required`, so it is not in this list.
        fc.constantFrom(...FORMS.filter((form) => form !== "namespace")),
        (since, tagged, form) => {
          const tag = tagged ? ["@since 1.0.0"] : [];
          const module = doc("A planted module.", "", "@stability unstable", ...tag);
          const block = doc("A planted export.", "", "@stability unstable", "@category models", ...tag);
          const piece: Piece = PIECES[form];
          const text = piece.text(0, block);
          const at = piece.at(0, block) ?? 0;
          const fires = tagged === (since === "absent") ? [1, lineCount(module) + 2 + at] : [];
          expectFires(`${module}\n${IMPORT}\n${text}\n`, fires, since);
        },
      ),
      RUNS,
    );
  });
});

/** Every `.ts` file under a folder, `internal/` left out, as Effect's own jsdocs config reads them. */
const publicFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      return name === "internal" ? [] : publicFiles(full);
    }

    return name.endsWith(".ts") ? [full] : [];
  });

type Report = {
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly filename: string }>;
  readonly number_of_files: number;
};

describe("law 8: on Effect 4.1.2's own source, with since required", () => {
  const scratch = mkdtempSync(join(tmpdir(), "jsdocs-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  // vector: Effect's checker passes this tree at the pin, so Effect's source is the grammar's own
  // answer sheet. Its config leaves `StandardSchema.ts` out, and ours asks a module block that four
  // of its files lack (case 19).
  it("fires on the exports of StandardSchema.ts, on the four files with no module block, and nowhere else", () => {
    const src = realpathSync(join(ROOT, "node_modules", "effect", "src"));
    const files = publicFiles(src).map((file) => relative(src, file));
    const config = join(scratch, ".oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        plugins: [],
        categories: { correctness: "off" },
        jsPlugins: [join(import.meta.dirname, "index.ts")],
        rules: { "fabrika/jsdocs": ["error", { since: "required" }] },
      }),
    );
    const ran = spawnSync(
      join(ROOT, "node_modules", ".bin", "oxlint"),
      [`--config=${config}`, "--disable-nested-config", "--no-ignore", "--format=json", ...files],
      { cwd: src, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(ran.stdout) as Report;
    const fired = new Map<string, number>();

    for (const d of report.diagnostics) {
      fired.set(d.filename, (fired.get(d.filename) ?? 0) + (d.code === "fabrika(jsdocs)" ? 1 : 0));
    }

    expect(report.number_of_files).toBe(432);
    expect(Object.fromEntries(fired)).toEqual({
      "StandardSchema.ts": 6,
      "encoding/Ini.ts": 1,
      "encoding/Yaml.ts": 1,
      "http/HttpStatus.ts": 1,
      "index.ts": 1,
    });
  });
});

describe("law 9: the real config turns the rule on for the listed folders' public files only", async () => {
  const SRC = "next/packages/libfabrika/src";
  const body = "export const planted = 1;\n";
  const on = [`${SRC}/ci/Planted.ts`, `${SRC}/codehost/Planted.ts`];
  const off = [
    // Five of the six kinds that are not public. The sixth, `fixtures/`, is also in the config's
    // `ignorePatterns`, which oxlint obeys even with `--no-ignore`, so no file there is ever linted.
    `${SRC}/ci/internal/planted.ts`,
    `${SRC}/codehost/internal/deep/planted.ts`,
    `${SRC}/ci/Planted.test.ts`,
    `${SRC}/codehost/Planted.test.tsx`,
    `${SRC}/ci/Planted.test-support.ts`,
    `${SRC}/codehost/PlantedTest.ts`,
    `${SRC}/codehost/Planted.d.ts`,
    // A folder not yet on the list, and an app (case 4).
    `${SRC}/jobs/Planted.ts`,
    "next/apps/fabrika/src/Planted.ts",
  ];
  const linted = await plant(Object.fromEntries([...on, ...off].map((path) => [path, body])));

  // scenario: one real lint run over one planted file per kind, since only the real config holds the list.
  it("fires in ci/ and codehost/, at the module block and the export", () => {
    for (const path of on) {
      expect(linted("fabrika(jsdocs)", path), path).toEqual([1, 1]);
    }
  });

  it("is off for internal/, tests, test support, shared suites, fixtures, declaration files, unlisted folders and apps", () => {
    for (const path of off) {
      expect(linted("fabrika(jsdocs)", path), path).toEqual([]);
    }
  });
});
