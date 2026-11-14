// The ratchet on the list files (0524, ticket 933): a list only shrinks until it is deleted. The core
// is judged on generated rows; then the script runs on a planted git repository, as CI runs it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { added, judge, LISTS } from "./ratchet.ts";

const runs = { seed: 119120, numRuns: 100 };
const [NEXT, AGENTS, DEAD] = LISTS as [(typeof LISTS)[0], (typeof LISTS)[0], (typeof LISTS)[0]];

const answer = (list: (typeof LISTS)[0], base: string | null, head: string | null) =>
  Effect.runSync(judge(list, base, head));

const text = (entries: ReadonlyArray<object>) => JSON.stringify({ entries });
const lintKey = (r: { file: string; rule: string; code: string }) => JSON.stringify([r.file, r.rule, r.code]);
const deadKey = (r: { scope: string; kind: string; id: string }) => JSON.stringify([r.scope, r.kind, r.id]);

// Five letters, so a key is often repeated and the counting matters.
const key = fc.constantFrom("a", "b", "c", "d", "e");

describe("added (L1)", () => {
  it("L1: a head drawn from the base adds nothing; one more key, new or a further copy, is added", () => {
    fc.assert(
      fc.property(
        fc.array(key, { maxLength: 12 }).chain((base) =>
          fc.record({
            base: fc.constant(base),
            subset: fc.shuffledSubarray(base),
            order: fc.shuffledSubarray(base, { minLength: base.length }),
            sorted: fc.subarray(base),
            extra: fc.oneof(key, fc.constant("z")),
            at: fc.nat({ max: base.length }),
          }),
        ),
        ({ base, subset, order, sorted, extra, at }) => {
          expect(added(base, subset)).toEqual([]);
          expect(added(base, sorted)).toEqual([]);
          expect(added(base, order)).toEqual([]);
          expect(added(base, [...order.slice(0, at), extra, ...order.slice(at)])).toEqual([extra]);
        },
      ),
      runs,
    );
  });
});

const field = fc.string({ maxLength: 8 });
// A change that keeps the old text and adds to it, spaces included, so it is never the same string.
const change = fc.constantFrom(" ", "  ", "\t", "x");

const lintRow = fc.record({ file: field, rule: field, code: field });
const deadRow = fc.record({ scope: field, kind: field, id: field, reason: field });

describe("row identity follows each reader (L2)", () => {
  it("L2: in the lint lists, a changed file, rule or code is an added row; an extra key or a new order is not", () => {
    fc.assert(
      fc.property(
        fc.array(lintRow, { minLength: 1, maxLength: 6 }).chain((rows) =>
          fc.record({
            rows: fc.constant(rows),
            i: fc.nat({ max: rows.length - 1 }),
            name: fc.constantFrom("file" as const, "rule" as const, "code" as const),
            suffix: change,
            order: fc.shuffledSubarray(rows, { minLength: rows.length }),
            list: fc.constantFrom(NEXT, AGENTS),
          }),
        ),
        ({ rows, i, name, suffix, order, list }) => {
          const moved = rows.map((r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(list, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: list.file,
            reason: "row_added",
            rows: [lintKey(moved[i]!)],
          });
          const extra = order.map((r) => ({ ...r, note: suffix }));
          expect(answer(list, text(rows), text(extra))).toEqual({ _tag: "done", file: list.file });
        },
      ),
      runs,
    );
  });

  it("L2: in unreachable-ledger.json, a changed scope, kind or id is an added row; a new reason or order is not", () => {
    fc.assert(
      fc.property(
        fc.array(deadRow, { minLength: 1, maxLength: 6 }).chain((rows) =>
          fc.record({
            rows: fc.constant(rows),
            i: fc.nat({ max: rows.length - 1 }),
            name: fc.constantFrom("scope" as const, "kind" as const, "id" as const),
            suffix: change,
            order: fc.shuffledSubarray(rows, { minLength: rows.length }),
          }),
        ),
        ({ rows, i, name, suffix, order }) => {
          const moved = rows.map((r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(DEAD, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: DEAD.file,
            reason: "row_added",
            rows: [deadKey(moved[i]!)],
          });
          const reworded = order.map((r) => ({ ...r, reason: r.reason + suffix }));
          expect(answer(DEAD, text(rows), text(reworded))).toEqual({ _tag: "done", file: DEAD.file });
        },
      ),
      runs,
    );
  });
});

const ROWS = {
  "next-ledger.json": [{ file: "next/a.ts", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "agents-ledger.json": [{ file: ".agents/a.mjs", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "unreachable-ledger.json": [{ scope: ".", kind: "only-called-from-tests", id: "a.ts:a", reason: "kept" }],
} as const;

describe("a file that comes, goes or does not read (L3)", () => {
  it("L3 scenario: per list, a new file is all added, a deleted file is done, an unreadable head is not a list", () => {
    for (const list of LISTS) {
      const rows = ROWS[list.file as keyof typeof ROWS];
      const keys = rows.map((r) => ("scope" in r ? deadKey(r) : lintKey(r)));
      expect(answer(list, null, text(rows))).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "row_added",
        rows: keys,
      });
      expect(answer(list, text(rows), null)).toEqual({ _tag: "done", file: list.file });
      expect(answer(list, null, null)).toEqual({ _tag: "done", file: list.file });
      expect(answer(list, text(rows), "{ not json")).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "not_a_list",
        rows: [],
      });
      expect(answer(list, text(rows), JSON.stringify({ entries: [{ file: 1 }] }))).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "not_a_list",
        rows: [],
      });
      // The base's own file does not read: main is broken, so the check fails closed.
      expect(Exit.isFailure(Effect.runSyncExit(judge(list, "{ not json", text(rows))))).toBe(true);
    }
  });
});

describe("ratchet.ts, as CI runs it (L4)", () => {
  const quiet = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const script = join(import.meta.dirname, "ratchet.ts");
  const extra = { file: "next/b.ts", rule: "fabrika(no-of)", code: "const b = 2;" };
  // Each test builds its own repository in its own scope, which removes it when the test ends (0061).
  const scenario = Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "ratchet-"))),
    (repo) => Effect.sync(() => rmSync(repo, { recursive: true, force: true })),
  ).pipe(
    Effect.map((repo) => {
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
      const put = (file: string, entries: ReadonlyArray<object>) => writeFileSync(join(repo, file), text(entries));
      const commit = (message: string) => {
        git("add", "-A");
        git("commit", "-q", "--allow-empty", "-m", message);
        return git("rev-parse", "HEAD");
      };
      const ratchet = (base: string) =>
        spawnSync(process.execPath, [script, "--base", base], { cwd: repo, encoding: "utf8", env: quiet });

      git("init", "-q", "-b", "main");

      for (const [file, rows] of Object.entries(ROWS)) {
        put(file, rows);
      }

      const base = commit("base");
      return { repo, git, put, commit, ratchet, base };
    }),
  );

  const jsonLines = (stdout: string) =>
    stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(line));

  it.effect("L4 scenario: a head that adds a row exits 1, naming the row in its JSON line and annotation", () =>
    Effect.gen(function* () {
      const { put, commit, ratchet, base } = yield* scenario;
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");
      const out = ratchet(base);
      expect(out.status).toBe(1);
      expect(jsonLines(out.stdout)).toEqual([
        { _tag: "stuck", file: "next-ledger.json", reason: "row_added", rows: [lintKey(extra)] },
        { _tag: "done", file: "agents-ledger.json" },
        { _tag: "done", file: "unreachable-ledger.json" },
      ]);
      expect(out.stdout).toContain("::error file=next-ledger.json::");
    }),
  );

  it.effect("L4 scenario: a head that prunes rows and deletes a list exits 0", () =>
    Effect.gen(function* () {
      const { repo, put, commit, ratchet, base } = yield* scenario;
      put("agents-ledger.json", []);
      unlinkSync(join(repo, "unreachable-ledger.json"));
      commit("head");
      const out = ratchet(base);
      expect(out.status).toBe(0);
      expect(jsonLines(out.stdout)).toEqual(LISTS.map((list) => ({ _tag: "done", file: list.file })));
    }),
  );

  it.effect('L4 scenario: no base, as "" or forty zeros, exits 0 and says so; a base that is not a sha exits 2', () =>
    Effect.gen(function* () {
      const { put, commit, ratchet } = yield* scenario;
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");

      for (const none of ["", "0".repeat(40)]) {
        const out = ratchet(none);
        expect(out.status).toBe(0);
        expect(out.stdout).toContain("no base");
        expect(jsonLines(out.stdout)).toEqual([]);
      }

      const out = ratchet("nothex");
      expect(out.status).toBe(2);
      expect(jsonLines(out.stdout)).toEqual([]);
    }),
  );

  it.effect("L4 scenario: the committed HEAD is judged, never a dirty working tree", () =>
    Effect.gen(function* () {
      const { put, commit, ratchet, base } = yield* scenario;
      // Committed: a row added. Working tree: back to the base's rows, as an uncommitted prune would be.
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");
      put("next-ledger.json", ROWS["next-ledger.json"]);
      expect(ratchet(base).status).toBe(1);
      // Committed: the base's rows. Working tree: a row added and not committed.
      put("next-ledger.json", ROWS["next-ledger.json"]);
      commit("back");
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      expect(ratchet(base).status).toBe(0);
    }),
  );
});
