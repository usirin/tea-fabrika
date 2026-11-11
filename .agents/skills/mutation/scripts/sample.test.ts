// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./scope.ts?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { diffRange, sample } from "./sample.ts";

// Today's tooling. This is the selector's contract; the CLI gathers candidates with the real
// Instrumenter and changed lines with git. Stryker's CLI proof belongs to the mutation step.
// sample({candidates, changed, seed, max}) returns the plan's Sample report.
// Candidates use Stryker's fileName/location shape; changed is [{file, line}].
type Position = { line: number; column: number };

type Candidate = {
  id: string;
  fileName: string;
  mutatorName: string;
  replacement: string;
  location: { start: Position; end: Position };
};

type Changed = { file: string; line: number };

type Report = {
  seed: number;
  ranges: readonly string[];
  total: number;
  selected: number;
  left: number;
  files: readonly { file: string; total: number; selected: number }[];
};

const options = { seed: 520, numRuns: 100 };
const position = (a: Position, b: Position) => a.line - b.line || a.column - b.column;

// Stryker 10.1.1's fs/project-reader.js keeps columns zero-based and subtracts one from lines.
// These candidates keep CLI lines one-based. Missing columns default to 0 and MAX_SAFE_INTEGER.
const parseRange = (range: string) => {
  const match = /^(.*?):(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/.exec(range);
  expect(match, `invalid Stryker range: ${range}`).not.toBeNull();

  if (!match) {
    throw new Error("invalid range");
  }

  const [, file, startLine, startColumn, endLine, endColumn] = match;
  return {
    file,
    start: { line: Number(startLine), column: Number(startColumn ?? 0) },
    end: { line: Number(endLine), column: Number(endColumn ?? Number.MAX_SAFE_INTEGER) },
  };
};

type Range = ReturnType<typeof parseRange>;

const enclosed = ({ file, start, end }: Range, candidate: Candidate) =>
  file === candidate.fileName &&
  position(candidate.location.start, start) >= 0 &&
  position(candidate.location.end, end) <= 0;

// The changed lines of each file, so a candidate's check reads only its own span's lines.
const changedLines = (changed: Changed[]) => {
  const lines = new Map<string, Set<number>>();

  for (const c of changed) {
    lines.set(c.file, (lines.get(c.file) ?? new Set()).add(c.line));
  }

  return (candidate: Candidate) => {
    const mine = lines.get(candidate.fileName);
    const { start, end } = candidate.location;
    return mine !== undefined && [...mine].some((line) => line >= start.line && line <= end.line);
  };
};

// Each range is parsed once per report, not once per candidate: parseRange runs a vitest
// `expect`, and the across-files property's reports hold up to 150 ranges over 470 candidates.
// Re-parsing per pair made that property take 9.8 s in CI's plain run and pass the 10 s timeout
// under Stryker's dry run (hourly mutation run, 2026-11-11).
const checkReport = (report: Report, candidates: Candidate[], changed: Changed[], seed: number, max: number) => {
  const isChanged = changedLines(changed);
  const ranges = report.ranges.map(parseRange);
  const eligible = candidates.filter(isChanged);
  const selected = candidates.filter((c) => ranges.some((r) => enclosed(r, c)));
  expect(report.seed).toBe(seed);
  expect(report.total).toBe(eligible.length);
  expect(report.selected).toBe(selected.length);
  expect(report.selected).toBeLessThanOrEqual(Math.min(max, 150));
  expect(report.left).toBe(report.total - report.selected);
  expect(report.left).toBeGreaterThanOrEqual(0);
  // Each changed file has its row, in name order, with what it offered and what was selected.
  const names = [...new Set(changed.map((c) => c.file))].sort();
  expect(report.files).toEqual(
    names.map((file) => ({
      file,
      total: eligible.filter((c) => c.fileName === file).length,
      selected: selected.filter((c) => c.fileName === file).length,
    })),
  );
  expect(selected.every(isChanged)).toBe(true);
  expect(new Set(report.ranges).size).toBe(report.ranges.length);

  for (const range of ranges) {
    expect(selected.some((c) => enclosed(range, c))).toBe(true);
  }

  return selected;
};

const candidate = (id: number, file: string, line: number, start: number, end: number): Candidate => ({
  id: String(id),
  fileName: file,
  mutatorName: "EqualityOperator",
  replacement: `replacement${id}`,
  location: { start: { line, column: start }, end: { line, column: end } },
});

const pool = fc.array(
  fc.record({
    file: fc.constantFrom("src/a.ts", "src/b.ts", "src/c.tsx"),
    line: fc.integer({ min: 1, max: 8 }),
    start: fc.integer({ min: 0, max: 5 }),
    width: fc.integer({ min: 1, max: 6 }),
    changed: fc.boolean(),
  }),
  { minLength: 0, maxLength: 180 },
);

describe("mutation sampling, today's tooling", () => {
  // Plant: make the file match greedy, so it swallows the start line when a column follows.
  it("range helper parses generated ranges with and without zero-based columns", () => {
    fc.assert(
      fc.property(
        fc.record({
          file: fc
            .tuple(fc.constantFrom("src/", "C:/src/", "src/with:colon/"), fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/))
            .map(([dir, name]) => `${dir}${name}.ts`),
          startLine: fc.integer({ min: 1, max: 50 }),
          lineSpan: fc.nat({ max: 10 }),
          startColumn: fc.nat({ max: 80 }),
          columnSpan: fc.nat({ max: 80 }),
        }),
        ({ file, startLine, lineSpan, startColumn, columnSpan }) => {
          const endLine = startLine + lineSpan;
          const endColumn = startColumn + columnSpan;

          for (const from of [startColumn, undefined]) {
            for (const to of [endColumn, undefined]) {
              const range = `${file}:${startLine}${from === undefined ? "" : `:${from}`}-${endLine}${to === undefined ? "" : `:${to}`}`;
              expect(parseRange(range)).toEqual({
                file,
                start: { line: startLine, column: from ?? 0 },
                end: { line: endLine, column: to ?? Number.MAX_SAFE_INTEGER },
              });
            }
          }
        },
      ),
      {
        ...options,
        // pinned: ticket 520 round 3 parsed src/a.ts:1:0-1:1 as file src/a.ts:1.
        examples: [[{ file: "src/a.ts", startLine: 1, lineSpan: 0, startColumn: 0, columnSpan: 1 }]],
      },
    );
  });

  // Plants: ignore the seed, include unchanged lines, or allow more than the cap.
  it("sampling is repeatable, changed-only and bounded", () => {
    fc.assert(
      fc.property(pool, fc.integer(), fc.integer({ min: 0, max: 180 }), (rows, seed, max) => {
        const candidates = rows.map((r, i) => candidate(i, r.file, r.line, r.start, r.start + r.width));
        const changed = rows.filter((r) => r.changed).map((r) => ({ file: r.file, line: r.line }));
        const input = { candidates, changed, seed, max };
        const before = structuredClone(input);
        const report: Report = sample(input);
        checkReport(report, candidates, changed, seed, max);
        expect(sample(input)).toEqual(report);
        expect(
          sample({
            ...input,
            candidates: [...candidates].reverse(),
            changed: [...changed].reverse(),
          }),
        ).toEqual(report);
        expect(input).toEqual(before);

        if (max === 0 || !changed.length) {
          expect(report.ranges).toEqual([]);
        }
      }),
      options,
    );

    // Disjoint single-mutant ranges must fill the budget, covering different changed lines
    // before taking a second mutant from one line. This also rules out an always-empty sample.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer(), (lines, seed) => {
        const candidates = Array.from({ length: lines * 2 }, (_, i) =>
          candidate(i, "src/a.ts", 1 + Math.floor(i / 2), (i % 2) * 10, (i % 2) * 10 + 1),
        );
        const changed = Array.from({ length: lines }, (_, i) => ({ file: "src/a.ts", line: i + 1 }));
        const report: Report = sample({ candidates, changed, seed, max: lines });
        const selected = checkReport(report, candidates, changed, seed, lines);
        expect(selected).toHaveLength(lines);
        expect(new Set(selected.map((c) => c.location.start.line)).size).toBe(lines);
        const full: Report = sample({ candidates, changed, seed, max: candidates.length });
        expect(checkReport(full, candidates, changed, seed, candidates.length)).toHaveLength(candidates.length);
      }),
      options,
    );

    // A seeded sample must offer a choice when the pool has many disjoint choices on one line.
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 16 }), fc.integer({ min: 1, max: 50 }), (n, line) => {
        const candidates = Array.from({ length: n }, (_, i) => candidate(i, "src/a.ts", line, i * 3, i * 3 + 1));
        const changed = [{ file: "src/a.ts", line }];
        const choices = new Set(
          Array.from({ length: 32 }, (_, seed) => {
            const report: Report = sample({ candidates, changed, seed, max: 1 });
            expect(checkReport(report, candidates, changed, seed, 1)).toHaveLength(1);
            return JSON.stringify(report.ranges);
          }),
        );
        expect(choices.size).toBeGreaterThan(1);
      }),
      { ...options, numRuns: 20 },
    );
  });

  // Plant: charge only the outer candidate, ignoring mutants its range pulls in.
  it("a range's enclosed and equal-location mutants count toward the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 2, maxLength: 12 }),
        fc.integer(),
        fc.integer({ min: 0, max: 15 }),
        (widths, seed, max) => {
          expect.hasAssertions();
          // Every location is nested at the same start. Equal widths create equal locations
          // with different replacements, so they remain different mutant identities.
          const candidates = widths.map((width, i) => candidate(i, "src/nested.ts", 3, 0, width));
          const changed = [{ file: "src/nested.ts", line: 3 }];
          const report: Report = sample({ candidates, changed, seed, max });
          const selected = checkReport(report, candidates, changed, seed, max);
          const least = Math.min(...widths);
          const cost = widths.filter((w) => w === least).length;

          if (max < cost) {
            expect(selected).toHaveLength(0);
          } else {
            expect(selected.length).toBeGreaterThanOrEqual(cost);
          }

          if (max >= widths.length) {
            expect(selected).toHaveLength(widths.length);
          }
        },
      ),
      options,
    );
  });
});

describe("mutation sampling across files, today's tooling", () => {
  // Plant: walk changed lines in file-name order, so the first files take the whole cap.
  it("every changed file gets a mutant when the cap is at least the file count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 2, maxLength: 8 }),
        fc.integer(),
        fc.nat({ max: 150 }),
        (sizes, seed, extra) => {
          // File names sort in this order, and the first file alone has more lines than any cap.
          const files = sizes.map((_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
          const counts = sizes.map((n, i) => (i === 0 ? n + 150 : n));
          const candidates = files.flatMap((file, f) =>
            Array.from({ length: counts[f] }, (_, l) => candidate(f * 1000 + l, file, l + 1, 0, 1)),
          );
          const changed = candidates.map((c) => ({ file: c.fileName, line: c.location.start.line }));
          const max = Math.min(150, files.length + extra);
          const report: Report = sample({ candidates, changed, seed, max });
          const selected = checkReport(report, candidates, changed, seed, max);
          expect(selected).toHaveLength(max);
          expect(new Set(selected.map((c) => c.fileName))).toEqual(new Set(files));
          // Round-robin: a file that still has lines left trails no other file by more than one.
          const per = files.map((file) => selected.filter((c) => c.fileName === file).length);
          const open = per.filter((mine, i) => mine < counts[i]);
          expect(Math.max(...per)).toBeLessThanOrEqual(Math.min(...open, Infinity) + 1);
        },
      ),
      { ...options, seed: 119120 },
    );
  });
});

describe("T655 every changed file holds a mutant before any holds two, today's tooling", () => {
  const block = (id: number, file: string, from: number, to: number): Candidate => ({
    ...candidate(id, file, from, 0, 99),
    mutatorName: "BlockStatement",
    location: { start: { line: from, column: 0 }, end: { line: to, column: 99 } },
  });

  // Lane t389, 2026-11-10: block ranges over the first files' rewritten lines took the whole cap,
  // and the launcher, the hook and the rule got no mutant in five rounds. Here each file is a run
  // of changed lines, some with no mutant (imports), each other line with one cheap mutant, all
  // inside one block range; the first file's block alone costs the whole cap.
  // Plants: take a line's first range in seed order (the old pick); give each turn to one changed
  // line, so a file whose first lines hold no mutant loses its turns.
  it("property: with a cap of at least the file count, every changed file gets a mutant", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ bare: fc.nat({ max: 6 }), lines: fc.integer({ min: 1, max: 30 }) }), {
          minLength: 2,
          maxLength: 8,
        }),
        fc.integer(),
        fc.nat({ max: 40 }),
        (shapes, seed, extra) => {
          const max = Math.min(150, shapes.length + extra);
          const files = shapes.map((_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
          // The first file has as many cheap lines as the cap, so its block costs more than the cap
          // would leave anyone else.
          const sized = shapes.map((s, i) => (i === 0 ? { ...s, lines: Math.max(s.lines, max) } : s));
          const candidates = sized.flatMap(({ bare, lines }, f) => [
            block(f * 1000, files[f], 1, bare + lines),
            ...Array.from({ length: lines }, (_, l) => candidate(f * 1000 + l + 1, files[f], bare + l + 1, 10, 11)),
          ]);
          const changed = sized.flatMap(({ bare, lines }, f) =>
            Array.from({ length: bare + lines }, (_, l) => ({ file: files[f], line: l + 1 })),
          );
          const report: Report = sample({ candidates, changed, seed, max });
          checkReport(report, candidates, changed, seed, max);
          expect(report.files.filter((f) => f.selected === 0)).toEqual([]);
          // Round-robin of cheap picks: while every file still has a cheap line, none is two ahead.
          const per = report.files.map((f) => f.selected);
          const short = Math.min(...sized.map((s) => s.lines));

          if (Math.max(...per) <= short) {
            expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
          }
        },
      ),
      {
        ...options,
        seed: 119120,
        // pinned: the t389 shape, seven files, the first a rewritten block over the cap.
        examples: [
          [
            [
              { bare: 3, lines: 30 },
              { bare: 0, lines: 2 },
              { bare: 6, lines: 30 },
              { bare: 6, lines: 30 },
              { bare: 2, lines: 30 },
              { bare: 6, lines: 30 },
              { bare: 0, lines: 1 },
            ],
            0,
            0,
          ],
        ],
      },
    );
  });

  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "sample655-"));
    const git = (...args: string[]) => {
      const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], { encoding: "utf8" });
      expect(ran.status, ran.stderr).toBe(0);
      return ran.stdout.trim();
    };
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    mkdirSync(join(dir, "packages"));
    symlinkSync(resolve("packages/pipeline"), join(dir, "packages/pipeline"));
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    put(".gitignore", "packages/\n");
    return { dir, git, put };
  };

  // Lane t389's hook was apps/fabrika/src/testing/electron-hook.cjs, outside the old `*.ts` filter.
  // Stryker 10.1.1's Instrumenter parses .cjs, .mjs, .cts, .mts, .js and .jsx too.
  // Plant: the old pathspec, `*.ts *.tsx :!*.test.ts :!*.test.tsx`.
  it("scenario: a changed .cjs, .mjs or .cts file is sampled; its test and its type declaration are not", () => {
    const { dir, git, put } = repo();
    const code = (n: number) => `module.exports = (a) => (a > ${n} ? a + 1 : a - 1);\n`;

    try {
      git("commit", "-q", "--allow-empty", "-m", "root");
      const base = git("rev-parse", "HEAD");
      put("src/hook.cjs", code(1));
      put("src/lib.mjs", `export const lib = (a) => (a > 2 ? a * 2 : a / 2);\n`);
      put("src/types.cts", `export const t = (a: number) => (a > 3 ? a : -a);\n`);
      put("src/hook.d.cts", "export declare const hook: (a: number) => number;\n");
      put("src/hook.test.cjs", code(4));
      put("src/a.test.ts", `export const x = (a: number) => (a > 5 ? 1 : 0);\n`);
      git("add", "--all");
      git("commit", "-qm", "build");
      const report = join(dir, "s.json");
      const ran = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "sample.ts"), "--build", "HEAD", "--since", base, "--report", report],
        { cwd: dir, encoding: "utf8" },
      );
      expect(ran.status, ran.stderr).toBe(0);
      const got = JSON.parse(readFileSync(report, "utf8")) as Report;
      expect(got.files.map((f) => f.file)).toEqual(["src/hook.cjs", "src/lib.mjs", "src/types.cts"]);
      expect(got.files.every((f) => f.total > 0 && f.selected > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // 0089: of the lead tooling, only lane code is sampled. Plant: drop `inScope` from the diff's loop.
  it("scenario: a changed lane script and product file are sampled; another lead script is not", () => {
    const { dir, git, put } = repo();
    const code = (n: number) => `export const f = (a: number) => (a > ${n} ? a + 1 : a - 1);\n`;

    try {
      git("commit", "-q", "--allow-empty", "-m", "root");
      const base = git("rev-parse", "HEAD");
      // Built from stems, so the script-reads lint does not take these paths for reads.
      const at = (name: string, stem: string) => `.agents/skills/${name}/scripts/${stem}.ts`;
      put(at("lead", "chain"), code(1));
      put(at("lead", "flow/machine"), code(2));
      put(at("lead", "mutbox"), code(3));
      put(at("mutation", "sample"), code(4));
      put("src/a.ts", code(5));
      git("add", "--all");
      git("commit", "-qm", "build");
      const report = join(dir, "s.json");
      const ran = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "sample.ts"), "--build", "HEAD", "--since", base, "--report", report],
        { cwd: dir, encoding: "utf8" },
      );
      expect(ran.status, ran.stderr).toBe(0);
      const got = JSON.parse(readFileSync(report, "utf8")) as Report;
      expect(got.files.map((f) => f.file)).toEqual([at("lead", "chain"), at("lead", "flow/machine"), "src/a.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("mutation sampling across lines, today's tooling", () => {
  const span = (id: number, from: Position, to: Position): Candidate => ({
    ...candidate(id, "src/a.ts", from.line, from.column, to.column),
    location: { start: from, end: to },
  });

  // Plant: drop the check that refuses a range enclosing a mutant on an unchanged line.
  it("a range never pulls in a mutant from an unchanged line", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer(), fc.nat({ max: 150 }), (line, seed, max) => {
        const candidates = [
          span(0, { line, column: 0 }, { line: line + 1, column: 5 }),
          span(1, { line: line + 1, column: 0 }, { line: line + 1, column: 1 }),
        ];
        const changed = [{ file: "src/a.ts", line }];
        const report: Report = sample({ candidates, changed, seed, max });
        expect(checkReport(report, candidates, changed, seed, max)).toHaveLength(0);
        expect(report).toMatchObject({ total: 1, selected: 0, left: 1 });

        // A refused range must not end its line's search: a cheap mutant inside it still fits.
        const other = line + 5;
        const mixed = [
          ...candidates,
          span(2, { line, column: 10 }, { line, column: 11 }),
          span(3, { line: other, column: 0 }, { line: other, column: 1 }),
          span(4, { line: other, column: 5 }, { line: other, column: 6 }),
        ];
        const both = [...changed, { file: "src/a.ts", line: other }];
        const picked = checkReport(sample({ candidates: mixed, changed: both, seed, max: 2 }), mixed, both, seed, 2);
        expect(new Set(picked.map((c) => c.location.start.line))).toEqual(new Set([line, other]));
      }),
      options,
    );
  });

  // Plants: retry a line an earlier multi-line pick already covers, or stop a line's search
  // at the first range over the cap instead of trying the next one.
  it("each changed line gets a first pick before any line gets a second", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer(), (line, seed) => {
        const at = (l: number, column: number) => ({ line: l, column });
        // One range covers lines line and line+1. Line line+1 also has its own mutant.
        const covered = [
          span(0, at(line, 0), at(line + 1, 1)),
          span(1, at(line + 1, 5), at(line + 1, 6)),
          span(2, at(line + 2, 0), at(line + 2, 1)),
        ];
        const three = [0, 1, 2].map((n) => ({ file: "src/a.ts", line: line + n }));
        const a: Report = sample({ candidates: covered, changed: three, seed, max: 2 });
        const lines = (c: Candidate[]) => new Set(c.flatMap((m) => [m.location.start.line, m.location.end.line]));
        expect(lines(checkReport(a, covered, three, seed, 2))).toEqual(new Set(three.map((c) => c.line)));

        // Line line has a wide range that costs three, over a cap of two, beside cheap ones.
        const nested = [
          span(0, at(line, 0), at(line, 10)),
          span(1, at(line, 0), at(line, 1)),
          span(2, at(line, 2), at(line, 3)),
          span(3, at(line, 20), at(line, 21)),
          span(4, at(line + 1, 0), at(line + 1, 1)),
          span(5, at(line + 1, 5), at(line + 1, 6)),
        ];
        const two = three.slice(0, 2);
        const b: Report = sample({ candidates: nested, changed: two, seed, max: 2 });
        expect(lines(checkReport(b, nested, two, seed, 2))).toEqual(new Set([line, line + 1]));
      }),
      options,
    );
  });
});

describe("T568 the sample reads the lane's own lines from its base, today's tooling", () => {
  const ref = fc.stringMatching(/^[0-9a-f]{7,40}$/);

  // Plants: ignore --since; diff since against its own parent; drop the build side.
  it("property: with a since the diff is since..build, else build's first parent..build", () => {
    fc.assert(
      fc.property(ref, fc.option(ref, { nil: undefined }), (build, since) => {
        expect(diffRange(build, since)).toEqual([since ?? `${build}^`, build]);
      }),
      options,
    );
  });

  // p14-mutation-r1, 2026-11-10: the lane's tip was "Merge main into fabrikalfa/p14", and the
  // sample took main's lines. The real CLI, with Stryker's real Instrumenter, on a merge tip.
  it("scenario: a tip that merged main samples the lane's file from its base, and main's file without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "sample568-"));
    const git = (...args: string[]) => {
      const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], { encoding: "utf8" });
      expect(ran.status, ran.stderr).toBe(0);
      return ran.stdout.trim();
    };
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };

    try {
      mkdirSync(join(dir, "packages"));
      symlinkSync(resolve("packages/pipeline"), join(dir, "packages/pipeline"));
      git("init", "-q", "-b", "main");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.test");
      put(".gitignore", "packages/\n");
      put("src/ours.ts", "export const lane = (a: number) => a;\n");
      put("src/theirs.ts", "export const main = (a: number) => a;\n");
      git("add", "--all");
      git("commit", "-qm", "root");
      const base = git("rev-parse", "HEAD");
      git("checkout", "-q", "-b", "lane");
      put("src/ours.ts", "export const lane = (a: number) => (a > 1 ? a + 1 : a - 1);\n");
      git("commit", "-qam", "build");
      git("checkout", "-q", "main");
      put("src/theirs.ts", "export const main = (a: number) => (a > 2 ? a * 2 : a / 2);\n");
      git("commit", "-qam", "main moves on");
      const merged = git("rev-parse", "HEAD");
      git("checkout", "-q", "lane");
      git("merge", "-q", "--no-edit", "main");
      const tip = git("rev-parse", "HEAD");
      const files = (since: string[]) => {
        const ran = spawnSync(
          process.execPath,
          [join(import.meta.dirname, "sample.ts"), "--build", tip, ...since, "--report", join(dir, "s.json")],
          { cwd: dir, encoding: "utf8" },
        );
        expect(ran.status, ran.stderr).toBe(0);
        return new Set((JSON.parse(`[${ran.stdout.trim()}]`) as string[]).map((r) => r.split(":")[0]));
      };
      // The lane's base after the catch-up is the main it merged, so only the lane's file is left.
      expect(files(["--since", merged])).toEqual(new Set(["src/ours.ts"]));
      expect(files(["--since", base])).toEqual(new Set(["src/ours.ts", "src/theirs.ts"]));
      expect(files([])).toEqual(new Set(["src/theirs.ts"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
