// Ticket 930 (0523): the five old advice rules block wherever their folder is at zero, and advise
// only where a warn override at the end of the config names their folder. These laws read
// `advice.ts` in process, and run the real `lint.ts` and oxlint in a small temp repo of their own.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advises, type Fire, stale, type WarnLine, warnLines } from "./advice.ts";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const runs = { seed: 119120, numRuns: 200 };

/** The five, as oxlint prints them: the oracle, written out apart from `advice.ts`. */
const FIVE = [
  "eslint(no-restricted-properties)",
  "fabrika(law-shape)",
  "fabrika(no-effect-promise)",
  "fabrika(no-raw-try-catch)",
  "fabrika(prefer-schema-arbitrary)",
] as const;

const OTHERS = [
  "fabrika(service-id)",
  "eslint(no-debugger)",
  "fabrika(no-type-assertions)",
  "eslint(no-restricted-imports)",
];

describe("T930 L1 a fire advises only when it is one of the five and graded a warning", () => {
  it("is true exactly for the five at severity warning, and false for an error or any other rule", () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            // A missing key is drawn through `requiredKeys: []`: oxlint's JSON never holds an explicit undefined.
            code: fc.constantFrom<string>(...FIVE, ...OTHERS),
            severity: fc.constantFrom("warning", "error"),
          },
          { requiredKeys: [] },
        ),
        (fire) => {
          const five = FIVE.some((code) => code === fire.code);
          expect(advises(fire)).toBe(five && fire.severity === "warning");
        },
      ),
      runs,
    );
  });
});

describe("T930 L3 a warn line is stale when no advice fire of its rule is in its folder", () => {
  /** One folder's warn line: a whole tree, its own files only, or one file, which is never a folder. */
  type Kind = "tree" | "files" | "file";
  const globOf = (folder: string, kind: Kind) =>
    kind === "tree" ? `next/${folder}/**` : kind === "files" ? `next/${folder}/*` : `next/${folder}/a.ts`;

  it("names exactly the lines with no fire of their rule, and each line that names a file", () => {
    const folders = fc.uniqueArray(fc.stringMatching(/^[a-z]{2,5}$/), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(
        folders.chain((names) =>
          fc.record({
            lines: fc.tuple(
              ...names.map((folder) =>
                fc.record({
                  folder: fc.constant(folder),
                  kind: fc.constantFrom<Kind>("tree", "files", "file"),
                  rule: fc.constantFrom(...FIVE),
                }),
              ),
            ),
            fires: fc.array(
              fc.record({
                folder: fc.constantFrom(...names),
                // `sibling` is a folder whose name starts with this one's: a glob is not a prefix.
                place: fc.constantFrom("direct", "deep", "sibling"),
                rule: fc.constantFrom(...FIVE),
              }),
              { maxLength: 8 },
            ),
          }),
        ),
        ({ lines, fires }) => {
          const warn: WarnLine[] = lines.map(({ folder, kind, rule }) => ({ rule, glob: globOf(folder, kind) }));
          const advice: Fire[] = fires.map(({ folder, place, rule }) => ({
            code: rule,
            severity: "warning",
            filename:
              place === "direct"
                ? `next/${folder}/b.ts`
                : place === "deep"
                  ? `next/${folder}/sub/b.ts`
                  : `next/${folder}x/b.ts`,
          }));
          const want = lines.flatMap(({ folder, kind, rule }, i) => {
            const line = warn[i]!;

            if (kind === "file") {
              return [{ _tag: "file", line }];
            }

            const held = fires.some(
              (f) =>
                f.rule === rule &&
                f.folder === folder &&
                (f.place === "direct" || (f.place === "deep" && kind === "tree")),
            );
            return held ? [] : [{ _tag: "zero", line }];
          });
          expect(stale(warn, advice)).toEqual(want);
        },
      ),
      runs,
    );
  });
});

/** A small repo of its own: lint.ts and the rules copied, node_modules linked, and this config. */
const repo = (config: object | string, files: Readonly<Record<string, string>>) => {
  const at = realpathSync(mkdtempSync(join(tmpdir(), "advice-")));
  spawnSync("git", ["init", "-q", at]);
  mkdirSync(join(at, "oxlint-plugins"));

  for (const entry of readdirSync(join(ROOT, "oxlint-plugins"), { withFileTypes: true })) {
    if (entry.isFile()) {
      copyFileSync(join(ROOT, "oxlint-plugins", entry.name), join(at, "oxlint-plugins", entry.name));
    }
  }

  symlinkSync(join(ROOT, "oxlint-plugins", "node_modules"), join(at, "oxlint-plugins", "node_modules"));
  symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
  mkdirSync(join(at, ".agents/skills"), { recursive: true });
  writeFileSync(join(at, ".oxlintrc.json"), typeof config === "string" ? config : JSON.stringify(config));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }

  return {
    at,
    lint: (...args: readonly string[]) => {
      const ran = spawnSync(process.execPath, [join(at, "oxlint-plugins/lint.ts"), ...args], {
        cwd: at,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(ran.error).toBeUndefined();
      return { status: ran.status, out: ran.stdout + ran.stderr };
    },
    done: () => rmSync(at, { recursive: true, force: true }),
  };
};

const HINT = "decode with Effect Schema, not a bare JSON.parse";
const parse = (level: string) => [level, { object: "JSON", property: "parse", message: HINT }];

/**
 * The frozen version's override, as the real config writes it (0525): both top-level rules "warn"
 * there, and fabrika-design carved back to "error". It is not a dirty-folder line, so no fire under
 * these paths is ever needed to keep a whole run passing.
 */
const FROZEN = [
  {
    files: ["apps/**", "programs/**", "packages/**", "bin/**"],
    rules: { "fabrika/no-effect-promise": "warn", "fabrika/no-raw-try-catch": "warn" },
  },
  {
    files: ["packages/fabrika-design/**"],
    rules: { "fabrika/no-effect-promise": "error", "fabrika/no-raw-try-catch": "error" },
  },
];

/** The five at "error" in their base scope, the frozen override, and "warn" for each dirty folder, placed last. */
const small = (dirty: readonly string[] = ["next/dirty"]) => ({
  jsPlugins: ["./oxlint-plugins/index.ts"],
  categories: { correctness: "off" },
  ignorePatterns: ["oxlint-plugins/**", "node_modules/**"],
  rules: { "fabrika/no-effect-promise": "error", "fabrika/no-raw-try-catch": "error" },
  overrides: [
    {
      files: ["next/**/*.test.ts"],
      rules: { "fabrika/law-shape": "error", "fabrika/prefer-schema-arbitrary": "error" },
    },
    { files: ["next/**/*"], rules: { "eslint/no-restricted-properties": parse("error") } },
    ...FROZEN,
    ...dirty.flatMap((folder) => [
      {
        files: [`${folder}/**`],
        rules: {
          "fabrika/no-effect-promise": "warn",
          "fabrika/no-raw-try-catch": "warn",
          "eslint/no-restricted-properties": parse("warn"),
        },
      },
      {
        files: [`${folder}/**/*.test.ts`],
        rules: { "fabrika/law-shape": "warn", "fabrika/prefer-schema-arbitrary": "warn" },
      },
    ]),
  ],
});

/** One planted fire per rule: the file it sits in, inside a folder, and its text. */
const PLANTS: Readonly<Record<(typeof FIVE)[number], { readonly file: string; readonly text: string }>> = {
  "eslint(no-restricted-properties)": { file: "parse.ts", text: 'export const a: unknown = JSON.parse("1");\n' },
  "fabrika(law-shape)": { file: "law.test.ts", text: 'import { it } from "vitest";\n\nit("adds one", () => {});\n' },
  "fabrika(no-effect-promise)": {
    file: "promise.ts",
    text: 'import { Effect } from "effect";\n\nexport const a = Effect.promise(() => Promise.resolve(1));\n',
  },
  "fabrika(no-raw-try-catch)": {
    file: "try.ts",
    text: 'import { Effect } from "effect";\n\ndeclare const f: () => void;\nexport const e = Effect.void;\n\ntry {\n  f();\n} catch {\n  f();\n}\n',
  },
  "fabrika(prefer-schema-arbitrary)": {
    file: "data.test.ts",
    text: "import fc from 'fast-check';\nimport {Schema} from 'effect';\nconst S = Schema.Struct({x: Schema.String});\nexport const data: fc.Arbitrary<typeof S.Type> = fc.record({x: fc.string()});\n",
  },
};

const planted = (folder: string) =>
  Object.fromEntries(Object.values(PLANTS).map(({ file, text }) => [`${folder}/${file}`, text]));

describe("T930 L2 through lint.ts and oxlint, one of the five blocks in a clean folder and advises in a dirty one", () => {
  it.each(FIVE)(
    "scenario: %s blocks in next/clean, advises in next/dirty, and a warning of another rule still fails",
    (code) => {
      const { file } = PLANTS[code];
      const { lint, done } = repo(small(), {
        ...planted("next/clean"),
        ...planted("next/dirty"),
        "next/dirty/debug.ts": "debugger;\n",
      });

      try {
        const clean = lint(`next/clean/${file}`);
        expect(clean.out).toContain(`next/clean/${file}`);
        expect(clean.out).toContain(code);
        expect(clean.out).toContain("oxlint: 1 blocking, 0 advice");
        expect(clean.status, clean.out).toBe(1);

        const dirty = lint(`next/dirty/${file}`);
        expect(dirty.out).toContain(`${code} advice, this folder is not at zero yet:`);
        expect(dirty.out).toContain("oxlint: 0 blocking, 1 advice");
        expect(dirty.status, dirty.out).toBe(0);

        const warned = lint("--warn=no-debugger", `next/dirty/${file}`, "next/dirty/debug.ts");
        expect(warned.out).toContain("eslint(no-debugger)");
        expect(warned.out).toContain("oxlint: 1 blocking, 1 advice");
        expect(warned.status, warned.out).toBe(1);

        if (code === "eslint(no-restricted-properties)") {
          expect(clean.out).toContain(HINT);
          expect(dirty.out).toContain(HINT);
        }
      } finally {
        done();
      }
    },
    120_000,
  );

  it("scenario: all five together block in next/clean and advise in next/dirty", () => {
    const { lint, done } = repo(small(), { ...planted("next/clean"), ...planted("next/dirty") });

    try {
      const clean = lint(...Object.values(PLANTS).map(({ file }) => `next/clean/${file}`));
      expect(clean.out).toContain(`oxlint: ${FIVE.length} blocking, 0 advice`);
      expect(clean.status, clean.out).toBe(1);
      const dirty = lint(...Object.values(PLANTS).map(({ file }) => `next/dirty/${file}`));
      expect(dirty.out).toContain(`oxlint: 0 blocking, ${FIVE.length} advice`);
      expect(dirty.status, dirty.out).toBe(0);
    } finally {
      done();
    }
  }, 120_000);

  // scenario: the repo's own config fails closed. A folder nobody listed blocks, the frozen version
  // still advises until the freeze lane takes it out of lint, and fabrika-design stays live (0456).
  it("scenario: under the real config an Effect.promise blocks in a new folder and in fabrika-design, and advises under apps/", () => {
    const { text } = PLANTS["fabrika(no-effect-promise)"];
    const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
    const { lint, done } = repo(config, {
      "newfolder/unit.ts": text,
      "packages/fabrika-design/unit.ts": text,
      "apps/unit.ts": text,
    });

    try {
      for (const file of ["newfolder/unit.ts", "packages/fabrika-design/unit.ts"]) {
        const blocked = lint(file);
        expect(blocked.out).toContain(`${file}:3:33 fabrika(no-effect-promise) `);
        expect(blocked.status, blocked.out).toBe(1);
      }

      const frozen = lint("apps/unit.ts");
      expect(frozen.out).toContain("fabrika(no-effect-promise) advice, this folder is not at zero yet:");
      expect(frozen.out).toContain("oxlint: 0 blocking, 1 advice");
      expect(frozen.status, frozen.out).toBe(0);
    } finally {
      done();
    }
  }, 120_000);
});

describe("T930 L4 the warn lines are read from oxlint's own --print-config", () => {
  // pinned: oxlint 1.90.0's --print-config shape (pnpm-lock.yaml): a builtin's key loses its plugin,
  // a level prints as "deny" or "warn", and an override keeps its `files` list. The config holds the
  // frozen version's warn override too (FROZEN above): it is not a dirty-folder line, so it is not read.
  it("pinned: reads a law-shape warn override and a no-restricted-properties one with options, and no error or frozen line", () => {
    const config = {
      ...small([]),
      overrides: [
        ...small([]).overrides,
        {
          files: ["next/dirty/**/*{.test.ts,Test.ts}", "next/other/*{.test.ts,Test.ts}"],
          rules: { "fabrika/law-shape": "warn" },
        },
        { files: ["next/dirty/**"], rules: { "eslint/no-restricted-properties": parse("warn") } },
      ],
    };
    const { at, done } = repo(config, {});

    try {
      const printed = spawnSync(OXLINT, [`--config=${join(at, ".oxlintrc.json")}`, "--print-config"], {
        cwd: at,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(printed.status, printed.stderr).toBe(0);
      expect(warnLines(JSON.parse(printed.stdout))).toEqual([
        { rule: "fabrika(law-shape)", glob: "next/dirty/**/*{.test.ts,Test.ts}" },
        { rule: "fabrika(law-shape)", glob: "next/other/*{.test.ts,Test.ts}" },
        { rule: "eslint(no-restricted-properties)", glob: "next/dirty/**" },
      ]);
    } finally {
      done();
    }
  }, 120_000);
});

describe("T930 L5 a whole run fails on a warn line whose folder has no fire left", () => {
  it("scenario: names the empty folder's line, passes once it goes, and a run given a path skips the check", () => {
    const files = planted("next/dirty");
    const stuck = repo(small(["next/dirty", "next/empty"]), files);
    const pruned = repo(small(["next/dirty"]), files);

    try {
      const whole = stuck.lint();
      expect(whole.out).toMatch(/fabrika\(no-effect-promise\)[^\n]*next\/empty\/\*\*/);
      expect(whole.out).not.toMatch(/has no fire left in next\/dirty/);
      expect(whole.status, whole.out).toBe(1);

      const path = stuck.lint("next/dirty/promise.ts");
      expect(path.out).not.toContain("next/empty");
      expect(path.status, path.out).toBe(0);

      // Both repos hold the frozen override with no fire under it, and that never fails a run.
      const clean = pruned.lint();
      expect(clean.out).not.toContain("has no fire left");
      expect(clean.out).not.toContain("warn line");
      expect(clean.out).toContain(`oxlint: 0 blocking, ${FIVE.length} advice`);
      expect(clean.status, clean.out).toBe(0);
    } finally {
      stuck.done();
      pruned.done();
    }
  }, 120_000);
});

describe("T930 L10 the five stop saying they only advise", () => {
  // format: the rules' own words, as the repo's real config prints them for a fire in a clean folder.
  it("format: no message or hint of the five holds Advice or does not block, and each blocks", () => {
    const at = realpathSync(mkdtempSync(join(tmpdir(), "advice-words-")));

    try {
      copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
      symlinkSync(join(ROOT, "oxlint-plugins"), join(at, "oxlint-plugins"));
      const files = planted("next/packages/zero/src/clean");

      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(at, path)), { recursive: true });
        writeFileSync(join(at, path), text);
      }

      const ran = spawnSync(
        OXLINT,
        [
          `--config=${join(at, ".oxlintrc.json")}`,
          "--disable-nested-config",
          "--no-ignore",
          "--format=json",
          ...Object.keys(files),
        ],
        { cwd: at, encoding: "utf8", timeout: 60_000, maxBuffer: 2 ** 28 },
      );
      const report: {
        readonly diagnostics: ReadonlyArray<{
          readonly code?: string;
          readonly message: string;
          readonly help?: string;
          readonly severity: string;
        }>;
      } = JSON.parse(ran.stdout);
      const fires = report.diagnostics.filter((d) => FIVE.some((code) => code === d.code));
      expect([...new Set(fires.map((d) => d.code))].sort()).toEqual([...FIVE].sort());

      for (const d of fires) {
        expect(`${d.message} ${d.help ?? ""}`, d.code).not.toMatch(/advice|does not block/i);
        expect(d.severity, d.code).toBe("error");
      }
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 120_000);
});
