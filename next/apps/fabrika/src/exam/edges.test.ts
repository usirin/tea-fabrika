// The CI ask for edges (Tier 1, P35): a pull request that adds an edge comment lists it for the
// owner, one line each with its reason, and never blocks. The core is planted as two sets of files,
// the base and the head; then the script runs once on a planted git repository, as CI runs it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Exit } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { asks } from "./edges.ts";

const PRODUCT = "next/packages/libfabrika/src/data/project.ts";
const OTHER = "next/packages/libfabrika/src/data/ledger.ts";

const EDGE = "// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object answers a Promise";

const RUN_EDGE = "// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the platform calls it";

const CALL = "export const a = Effect.tryPromise(() => p);";
const PRELUDE = 'import {Effect} from "effect";\ndeclare const p: Promise<number>;';

const file = (...lines: ReadonlyArray<string>) => [PRELUDE, ...lines, ""].join("\n");

const run = (base: Record<string, string>, head: Record<string, string>) =>
  Effect.runSync(asks(new Map(Object.entries(base)), new Map(Object.entries(head))));

describe("asks", () => {
  it("lists one new edge comment in a product file, with its line, rules and reason", () => {
    expect(run({ [PRODUCT]: file() }, { [PRODUCT]: file(EDGE, CALL) })).toEqual([
      {
        path: PRODUCT,
        line: 3,
        rules: "fabrika/no-promises",
        why: "edge: a Durable Object answers a Promise",
      },
    ]);
  });

  it("lists an edge comment in a new file", () => {
    expect(run({}, { [PRODUCT]: file(EDGE, CALL) })).toHaveLength(1);
  });

  it("asks nothing about an edge already on the base, unchanged or moved within its file", () => {
    expect(run({ [PRODUCT]: file(EDGE, CALL) }, { [PRODUCT]: file(EDGE, CALL) })).toEqual([]);
    expect(run({ [PRODUCT]: file(EDGE, CALL) }, { [PRODUCT]: file("", "", EDGE, CALL) })).toEqual([]);
  });

  it("lists two new edges in path then line order, and a second copy of an old one", () => {
    const found = run(
      { [PRODUCT]: file(EDGE, CALL) },
      {
        [PRODUCT]: file(EDGE, CALL, RUN_EDGE, "export const b = 1;", EDGE, CALL),
        [OTHER]: file(EDGE, CALL),
      },
    );
    expect(found.map((e) => [e.path, e.line])).toEqual([
      [OTHER, 3],
      [PRODUCT, 5],
      [PRODUCT, 7],
    ]);
  });

  it("asks again when an old edge's reason is reworded, or its file renamed", () => {
    const reworded = EDGE.replace("answers", "must answer");
    expect(run({ [PRODUCT]: file(EDGE, CALL) }, { [PRODUCT]: file(reworded, CALL) })).toHaveLength(1);
    expect(run({ [PRODUCT]: file(EDGE, CALL) }, { [OTHER]: file(EDGE, CALL) })).toHaveLength(1);
  });

  it("asks nothing for a deleted file, a test's planted string, or a comment on other rules", () => {
    expect(run({ [PRODUCT]: file(EDGE, CALL) }, {})).toEqual([]);
    const test = `export const planted = ${JSON.stringify(`${EDGE}\n${CALL}`)};\n`;
    expect(run({}, { "next/apps/fabrika/src/exam/x.test.ts": test })).toEqual([]);
    const other = "// oxlint-disable-next-line fabrika/no-type-assertions -- the types need it";
    expect(run({}, { [PRODUCT]: file(other, "export const b = p as any;") })).toEqual([]);
  });

  it("fails on a file that does not parse, naming it, and never answers clean", () => {
    const exit = Effect.runSyncExit(asks(new Map(), new Map([[PRODUCT, file(EDGE, "export const = ;")]])));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain(PRODUCT);
  });
});

describe("edges.ts, as CI runs it", () => {
  const repo = mkdtempSync(join(tmpdir(), "edges-"));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const { GITHUB_STEP_SUMMARY: _summary, ...env } = process.env;
  const quiet = { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: ReadonlyArray<string>) => {
    const out = spawnSync("git", ["-c", "user.name=exam", "-c", "user.email=exam@example.com", ...args], {
      cwd: repo,
      encoding: "utf8",
      env: quiet,
    });

    if (out.status !== 0) {
      throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
    }

    return out.stdout.trim();
  };
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const script = join(import.meta.dirname, "edges.ts");
  const edges = (base: string, extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, "--base", base], {
      cwd: repo,
      encoding: "utf8",
      env: { ...quiet, ...extra },
    });

  git("init", "-q", "-b", "main");
  put(PRODUCT, file(EDGE, CALL));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  put(PRODUCT, file(EDGE, CALL, EDGE, CALL));
  put(OTHER, file(RUN_EDGE, "export const b = 1;"));
  git("add", ".");
  git("commit", "-q", "-m", "head");

  it("prints one line per new edge with [ok] [no], and exits 0", () => {
    const out = edges(base);
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split("\n")).toEqual([
      "Edges this pull request adds, for the owner:",
      `${OTHER}:3  fabrika/no-effect-run-outside-edge  edge: the platform calls it  [ok] [no]`,
      `${PRODUCT}:5  fabrika/no-promises  edge: a Durable Object answers a Promise  [ok] [no]`,
    ]);
  });

  it("in GitHub Actions, notes each line of the diff and writes the step summary", () => {
    const summary = join(repo, "..", `${repo.split("/").pop()}-summary.md`);
    const out = edges(base, { GITHUB_STEP_SUMMARY: summary });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(
      `::notice file=${OTHER},line=3::fabrika/no-effect-run-outside-edge -- edge: the platform calls it`,
    );
    expect(readFileSync(summary, "utf8")).toContain(`- \`${PRODUCT}:5  fabrika/no-promises`);
    rmSync(summary);
  });

  it("says so when there is nothing to ask", () => {
    const out = edges("HEAD");
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe("No new edge comments in this pull request.");
  });

  it("exits 2, naming the file, when a file does not parse", () => {
    put(OTHER, "export const = ;\n");
    const out = edges(base);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain(OTHER);
    expect(out.stdout).not.toContain("[ok] [no]");
  });
});
