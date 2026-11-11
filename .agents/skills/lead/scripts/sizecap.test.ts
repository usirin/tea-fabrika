// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  advise,
  readCap,
  DEFAULT_CAP,
  diffLine,
  classify,
  numberIn,
  readPlan,
  Row,
  parseNumstat,
  countLines,
} from "./sizecap.ts";

// Lead tooling for ticket 686: decision 0087's cap on product lines, as advice. The pure laws read
// paths, numstat text and plan text; one scenario runs the command on a disposable git repository.
const options = { seed: 119120, numRuns: 200 };
const script = join(import.meta.dirname, "sizecap.ts");

const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
const folders = fc.array(word, { minLength: 0, maxLength: 3 });
const code = fc.tuple(folders, word, fc.constantFrom(".ts", ".tsx", ".css", ".json"));

describe("classify", () => {
  it("property: a code file under a product root is product, and the same file elsewhere is other", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("next", "apps", "programs", "packages"),
        code,
        fc.constantFrom(".agents", "oxlint-plugins", ".github", "scripts"),
        (root, [inner, name, ext], other) => {
          const below = [...inner.filter((part) => !["e2e", "fixtures", "docs"].includes(part)), `${name}${ext}`];
          expect(classify([root, ...below].join("/"), false)).toBe("product");
          expect(classify([other, ...below].join("/"), false)).toBe("other");
        },
      ),
      options,
    );
  });

  it("property: a test, fixture or e2e file is a test wherever it stands", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("next", "apps", "packages", ".agents", "oxlint-plugins"),
        code,
        fc.constantFrom("test", "test-support", "fixtures", "e2e"),
        (root, [inner, name, ext], mark) => {
          const path =
            mark === "fixtures" || mark === "e2e"
              ? [root, ...inner, mark, `${name}${ext}`].join("/")
              : [root, ...inner, `${name}.${mark}${ext}`].join("/");
          expect(classify(path, false)).toBe("test");
        },
      ),
      options,
    );
  });

  it("property: Markdown and anything under docs/ is docs; a marked file is generated, first of all", () => {
    fc.assert(
      fc.property(fc.constantFrom("next", "apps", ".decisions", "experiments"), code, (root, [inner, name, ext]) => {
        expect(classify([root, ...inner, `${name}.md`].join("/"), false)).toBe("docs");
        expect(classify([root, ...inner, "docs", `${name}${ext}`].join("/"), false)).toBe("docs");
        expect(classify([root, ...inner, `${name}.test${ext}`].join("/"), true)).toBe("generated");
      }),
      options,
    );
  });

  it("vector: lock files by name, at any depth (0087 names lock files)", () => {
    for (const path of ["pnpm-lock.yaml", "next/apps/fabrika/package-lock.json", "packages/x/yarn.lock", "a.lock"]) {
      expect(classify(path, false)).toBe("lock");
    }
  });
});

const NUMSTAT = fc.record({
  path: fc.stringMatching(/^[a-z][a-z0-9 /._é-]{0,20}[a-z]$/),
  added: fc.nat(5000),
  deleted: fc.nat(5000),
  shape: fc.constantFrom("plain", "renamed", "binary"),
  from: fc.stringMatching(/^[a-z][a-z0-9/]{0,10}$/),
});

describe("parseNumstat", () => {
  it("property: every numstat entry is read back, renames by their new path, binaries with no lines", () => {
    fc.assert(
      fc.property(fc.array(NUMSTAT, { maxLength: 12 }), (entries) => {
        const out = entries
          .map((entry) =>
            entry.shape === "binary"
              ? `-\t-\t${entry.path}\0`
              : entry.shape === "renamed"
                ? `${entry.added}\t${entry.deleted}\t\0${entry.from}\0${entry.path}\0`
                : `${entry.added}\t${entry.deleted}\t${entry.path}\0`,
          )
          .join("");
        const rows = parseNumstat(out);
        expect(rows.map((row) => row.path)).toEqual(entries.map((entry) => entry.path));
        rows.forEach((row, at) => {
          const entry = entries[at];
          expect(row._tag).toBe(entry?.shape === "binary" ? "binary" : "text");

          if (row._tag === "text") {
            expect(row.lines).toBe((entry?.added ?? 0) + (entry?.deleted ?? 0));
          }
        });
      }),
      options,
    );
  });
});

describe("countLines and diffLine", () => {
  it("property: product lines are the sum of the product rows, and the line says over only past the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(code, fc.nat(400), fc.boolean()), { maxLength: 10 }),
        fc.integer({ min: 1, max: 2000 }),
        (files, cap) => {
          const rows: Array<Row> = files.map(([[inner, name, ext], lines, binary], at) => {
            const path = [at % 2 === 0 ? "next" : ".agents", ...inner, `${name}${at}${ext}`].join("/");
            return binary ? Row.cases.binary.make({ path }) : Row.cases.text.make({ path, lines });
          });
          const tally = countLines(rows, new Set());
          const product = rows.reduce(
            (sum, row) => sum + (row._tag === "text" && classify(row.path, false) === "product" ? row.lines : 0),
            0,
          );
          expect(tally.product).toBe(product);
          expect(tally.binary).toBe(rows.filter((row) => row._tag === "binary").length);
          expect(diffLine(tally, cap).includes("over the cap")).toBe(product > cap);
        },
      ),
      options,
    );
  });
});

const table = (cells: ReadonlyArray<string>) =>
  [
    "| File | Product lines expected | Owner |",
    "|---|---:|---|",
    ...cells.map((cell, at) => `| \`f${at}.ts\` | ${cell} | build |`),
  ].join("\n");

const sizeSection = (slices: ReadonlyArray<number | null>) =>
  [
    "## Size",
    "",
    "Seven pull requests, each below 600 expected product lines.",
    "",
    ...slices.map((lines, at) =>
      lines === null
        ? `${at + 1}. **Slice ${at + 1}.** No estimate yet.`
        : `${at + 1}. **Slice ${at + 1}: ${lines} lines.** Some words.`,
    ),
  ].join("\n");

const cell = fc.oneof(
  fc.nat(900).map((n) => ({ text: String(n), lines: n })),
  fc.nat(900).map((n) => ({ text: `**${n}**`, lines: n })),
  fc.constantFrom("tests", "docs", "generated", "configuration", "rows").map((text) => ({ text, lines: 0 })),
);

describe("readPlan and advise", () => {
  it("property: the files table total is the sum of its number cells, and each slice keeps its estimate", () => {
    fc.assert(
      fc.property(
        fc.array(cell, { minLength: 1, maxLength: 12 }),
        fc.array(fc.option(fc.nat(1200), { nil: null }), { maxLength: 7 }),
        (cells, slices) => {
          const plan = [
            "## Files",
            "",
            table(cells.map((c) => c.text)),
            "",
            sizeSection(slices),
            "",
            "## Records",
            "",
            "1. not a slice: 9000 lines",
          ].join("\n");
          const size = readPlan(plan);
          expect(size.table).toBe(cells.reduce((sum, c) => sum + c.lines, 0));
          expect(size.slices.map((slice) => slice.lines)).toEqual(slices);
        },
      ),
      options,
    );
  });

  it("property: advice names exactly the slices over the cap and those with no estimate, never one within it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.nat(1200), { nil: null }), { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 1, max: 1000 }),
        (slices, cap) => {
          const advice = advise(readPlan(sizeSection(slices)), cap);
          const named = advice.flatMap((a) => (a._tag === "over" || a._tag === "unsized" ? [a.order] : []));
          const expected = slices.flatMap((lines, at) => (lines === null || lines > cap ? [at + 1] : []));
          expect(named).toEqual(expected);
        },
      ),
      options,
    );
  });

  it("property: a plan with no slices is advised only when its table is over the cap", () => {
    fc.assert(
      fc.property(fc.array(cell, { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3000 }), (cells, cap) => {
        const total = cells.reduce((sum, c) => sum + c.lines, 0);
        const advice = advise(readPlan(table(cells.map((c) => c.text))), cap);
        expect(advice.map((a) => a._tag)).toEqual(total > cap ? ["unsliced"] : []);
      }),
      options,
    );
  });

  it("scenario: a table in a fence is an example, an escaped pipe stays in its cell, and no column is unknown", () => {
    const fenced = [
      "```md",
      table(["900"]),
      "```",
      "",
      "| File \\| path | Product lines expected |",
      "|---|---|",
      "| a \\| b | 700 |",
    ].join("\n");
    expect(readPlan(fenced)).toEqual({ table: 700, slices: [] });
    expect(advise(readPlan("## Files\n\n| File | Owner |\n|---|---|\n| a | build |"), 600).map((a) => a._tag)).toEqual([
      "unknown",
    ]);
  });

  it("vector: a number cell may carry commas, a tilde or words after it", () => {
    expect([numberIn("1,200"), numberIn("~70"), numberIn("45 (est)"), numberIn("tests"), numberIn("`12`")]).toEqual([
      1200,
      70,
      45,
      null,
      12,
    ]);
  });
});

describe("readCap", () => {
  const cap = readCap;

  it("property: [review] lines sets the cap; a file that leaves it out keeps 0087's 600", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (lines) => {
        expect(cap(`[review]\nrubrics = "r"\nlines = ${lines}\n`)).toEqual(Result.succeed(lines));
      }),
      options,
    );
    expect([cap(null), cap('[review]\nrubrics = "r"\n'), cap("")]).toEqual(
      [600, 600, 600].map((n) => Result.succeed(n)),
    );
    expect(DEFAULT_CAP).toBe(600);
  });

  it("property: a cap below 1, a fraction, a string or a file that is not TOML cannot run", () => {
    fc.assert(
      fc.property(fc.constantFrom("0", "-3", "1.5", '"600"', "[600]"), (value) => {
        expect(Result.isFailure(cap(`[review]\nlines = ${value}\n`))).toBe(true);
      }),
      options,
    );
    expect(Result.isFailure(cap("[review\nlines = 1"))).toBe(true);
  });
});

describe("the command", () => {
  it("scenario: diff counts a renamed product file's change only, keeps the lower cap of base and head, and plan prints its advice", () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));

    try {
      const env = {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        TYPESAFE_API_KEY: undefined,
      };
      const git = (...args: string[]) => {
        const got = spawnSync(
          "git",
          ["-C", dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
          {
            encoding: "utf8",
            env,
            timeout: 10_000,
          },
        );
        expect(got.status, got.stderr).toBe(0);
        return got.stdout.trim();
      };
      const write = (path: string, text: string) => {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), text);
      };
      const lines = (n: number, tag: string) =>
        `${Array.from({ length: n }, (_, at) => `line ${tag} ${at}`).join("\n")}\n`;
      git("init", "-q", "-b", "main");
      write(".fabrika/fabrika.toml", "[review]\nlines = 50\n");
      write("next/src/old name.ts", lines(40, "kept"));
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");
      git("mv", "next/src/old name.ts", "next/src/new name.ts");
      write("next/src/new name.ts", lines(40, "kept") + lines(3, "added"));
      write("next/src/big.ts", lines(60, "big"));
      write("next/src/big.test.ts", lines(500, "test"));
      write("next/gen.ts", lines(70, "gen"));
      write(".gitattributes", "next/gen.ts linguist-generated\n");
      write(".fabrika/fabrika.toml", "[review]\nlines = 900\n");
      git("add", "-A");
      git("commit", "-q", "-m", "head");
      const run = (...args: string[]) =>
        spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8", env, timeout: 20_000 });

      const diff = run("diff", base, "HEAD");
      expect(diff.status, diff.stderr).toBe(0);
      expect(diff.stdout).toBe(
        "size: 63 product lines, over the cap of 50 by 13 (advice until the replay, 0087); not counted: 500 test, 0 docs, 0 lock, 70 generated, 3 other lines, 0 binary files\n",
      );

      write("plan.md", [table(["450", "tests"]), "", sizeSection([450, 700])].join("\n"));
      const plan = run("plan", "plan.md");
      expect(plan.status, plan.stderr).toBe(0);
      expect(plan.stdout).toContain("size: 450 product lines in the files table, 2 slices, the largest 700, cap 900\n");
      expect(plan.stdout).not.toContain("slice 2");
      write(".fabrika/fabrika.toml", "[review]\nlines = 0\n");
      const bad = run("plan", "plan.md");
      expect([bad.status, bad.stderr]).toEqual([
        2,
        "sizecap: .fabrika/fabrika.toml at the working tree: [review] lines is not a whole number of at least 1\n",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
