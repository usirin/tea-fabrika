import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, FileSystem, Option, type Scope } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  candidates,
  childTests,
  counts,
  MARK,
  mutate,
  Outcome,
  recheck,
  type Report,
  type Runner,
  spawns,
  upgrade,
  Verdict,
} from "./recheck.ts";

// Today's lead tooling. Every law runs on small files in a temp folder and a fake runner: no real
// Stryker and no real vitest run here.
const options = { seed: 119120, numRuns: 60 };

// Vitest awaits the Promise a test hands back: the one place a law's Effect is run.
const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  law.pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise);

type Mutants = Report["files"][string]["mutants"];
type Planted = ReadonlyArray<{ readonly name: string; readonly source: string; readonly mutants: Mutants }>;

/** A temp folder, gone with the law's scope, holding these files; the report names them by path. */
const files = Effect.fnUntraced(function* (planted: Planted) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "recheck-" });
  const entries: Array<[string, Report["files"][string]]> = [];

  for (const f of planted) {
    yield* fs.writeFileString(join(dir, f.name), f.source);
    entries.push([join(dir, f.name), { source: f.source, mutants: f.mutants }]);
  }

  const report: Report = { files: Object.fromEntries(entries) };
  return { dir, report, paths: entries.map(([path]) => path) };
});

const at = (line: number, start: number, end: number) => ({
  start: { line, column: start },
  end: { line, column: end },
});

const mutant = (id: string, status: string, location: ReturnType<typeof at>, replacement: string) => ({
  id,
  mutatorName: "StringLiteral",
  replacement,
  status,
  location,
  coveredBy: [],
});

/** The text of every file in the report, as it is on disk now. */
const disk = (report: Report) => Object.keys(report.files).map((f) => readFileSync(f, "utf8"));

const STATUSES = ["NoCoverage", "Survived", "Killed", "Timeout", "Ignored"] as const;

/** Files of word lines, each with mutants inside a line; every replacement carries its own id. */
const planted: fc.Arbitrary<Planted> = fc
  .array(
    fc.record({
      lines: fc.array(fc.stringMatching(/^[a-z ]{4,20}$/), { minLength: 1, maxLength: 5 }),
      mutants: fc.array(
        fc.record({ line: fc.nat(), from: fc.nat(), width: fc.nat({ max: 3 }), status: fc.constantFrom(...STATUSES) }),
        { maxLength: 4 },
      ),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((list) => {
    let next = 0;
    return list.map((f, i) => ({
      name: `f${i}.ts`,
      source: `${f.lines.join("\n")}\n`,
      mutants: f.mutants.map((m) => {
        const line = (m.line % f.lines.length) + 1;
        const length = f.lines[line - 1]!.length;
        const from = (m.from % (length + 1)) + 1;
        const id = String(next++);
        return mutant(id, m.status, at(line, from, Math.min(length + 1, from + m.width)), `<${id}>`);
      }),
    }));
  });

/**
 * A fake runner that kills the ids in `kills`. At each call it reads every file, checks that only
 * one differs from its source, and by exactly one candidate's mutant, and records that id.
 */
const fakeRunner = (report: Report, kills: ReadonlySet<string>, seen: Array<string>): Runner => {
  const all = candidates(report);
  return () =>
    Effect.sync(() => {
      const changed = Object.entries(report.files).filter(([file, f]) => readFileSync(file, "utf8") !== f.source);
      expect(changed, "one file at a time").toHaveLength(1);
      const [file] = changed[0]!;
      const now = readFileSync(file, "utf8");
      const ids = all
        .filter((c) => c.file === file && Option.getOrUndefined(mutate(c.source, c.location, c.replacement)) === now)
        .map((c) => c.id);
      expect(ids, "one mutant over the original").toHaveLength(1);
      seen.push(ids[0]!);
      return kills.has(ids[0]!)
        ? Verdict.cases.failed.make({ tests: ["child.test.ts"] })
        : Verdict.cases.passed.make({});
    });
};

const never: Runner = () => Effect.die("the runner must not be called");
const far = () => Date.now() + 600_000;

describe("the mutation run's second pass, today's tooling", () => {
  it("upgrades exactly the candidates the runner kills, and leaves every file byte for byte", () =>
    fc.assert(
      fc.asyncProperty(planted, fc.func(fc.boolean()), (list, kill) =>
        ran(
          Effect.gen(function* () {
            const { report } = yield* files(list);
            const all = candidates(report);
            const kills = new Set(all.filter((c) => kill(c.id)).map((c) => c.id));
            const seen: Array<string> = [];
            const run = fakeRunner(report, kills, seen);
            const outcomes = yield* recheck({ report, tests: ["child.test.ts"], cap: 1_000, deadline: far(), run });

            expect(disk(report)).toEqual(list.map((f) => f.source));
            expect(seen).toEqual(all.map((c) => c.id));
            expect(new Set(outcomes.flatMap((o) => (o._tag === "killed" ? [o.id] : [])))).toEqual(kills);
            expect(outcomes.filter((o) => o._tag === "kept").map((o) => o.id)).toEqual(
              all.filter((c) => !kills.has(c.id)).map((c) => c.id),
            );

            const after = upgrade(report, outcomes);

            for (const [file, f] of Object.entries(report.files)) {
              for (const [i, m] of f.mutants.entries()) {
                const now = after.files[file]!.mutants[i]!;
                const want = kills.has(m.id)
                  ? {
                      ...m,
                      status: "Killed",
                      statusReason: `${MARK} child.test.ts failed with this mutant on disk alone; Stryker said ${m.status}`,
                    }
                  : m;
                expect(now).toEqual(want);
              }
            }
          }),
        ),
      ),
      options,
    ));

  it("tries at most the cap, and names every other candidate capped", () =>
    fc.assert(
      fc.asyncProperty(planted, fc.nat({ max: 6 }), (list, cap) =>
        ran(
          Effect.gen(function* () {
            const { report } = yield* files(list);
            const all = candidates(report);
            const seen: Array<string> = [];
            const run = fakeRunner(report, new Set(), seen);
            const outcomes = yield* recheck({ report, tests: ["child.test.ts"], cap, deadline: far(), run });

            expect(outcomes.map((o) => o.id)).toEqual(all.map((c) => c.id));
            expect(seen).toHaveLength(Math.min(cap, all.length));
            expect(counts(outcomes).capped ?? 0).toBe(Math.max(0, all.length - cap));
            expect(Object.values(counts(outcomes)).reduce((s, n) => s + n, 0)).toBe(all.length);
            expect(disk(report)).toEqual(list.map((f) => f.source));
          }),
        ),
      ),
      options,
    ));

  it("takes each NoCoverage and Survived mutant once, every file's first before any second", () => {
    fc.assert(
      fc.property(planted, (list) => {
        const report: Report = {
          files: Object.fromEntries(list.map((f) => [f.name, { source: f.source, mutants: f.mutants }])),
        };
        const got = candidates(report);
        const want = list.flatMap((f) => f.mutants.filter((m) => m.status === "NoCoverage" || m.status === "Survived"));
        expect(got.map((c) => c.id).toSorted()).toEqual(want.map((m) => m.id).toSorted());
        const rank = new Map<string, number>();
        const ranks = got.map((c) => {
          const r = rank.get(c.file) ?? 0;
          rank.set(c.file, r + 1);
          return r;
        });
        expect(ranks).toEqual(ranks.toSorted((a, b) => a - b));
      }),
      options,
    );
  });

  it("scenario: no related test starts a process, so nothing runs and each is no_child_test", () =>
    ran(
      Effect.gen(function* () {
        const { report, paths } = yield* files([
          { name: "a.ts", source: 'x = "a";\n', mutants: [mutant("1", "Survived", at(1, 5, 8), '""')] },
        ]);
        const outcomes = yield* recheck({ report, tests: [], cap: 20, deadline: far(), run: never });
        expect(outcomes).toEqual([Outcome.cases.skipped.make({ file: paths[0]!, id: "1", reason: "no_child_test" })]);
      }),
    ));

  it("scenario: two mutants in one file run one at a time, each over the original", () =>
    ran(
      Effect.gen(function* () {
        const source = 'a = "x";\nb = "y";\n';
        const two = [mutant("1", "NoCoverage", at(1, 5, 8), '""'), mutant("2", "Survived", at(2, 5, 8), '""')];
        const { report, paths } = yield* files([{ name: "a.ts", source, mutants: two }]);
        const states: Array<string> = [];
        const run: Runner = () =>
          Effect.sync(() => {
            states.push(readFileSync(paths[0]!, "utf8"));
            return Verdict.cases.failed.make({ tests: ["t"] });
          });
        const outcomes = yield* recheck({ report, tests: ["t"], cap: 20, deadline: far(), run });
        expect(states).toEqual(['a = "";\nb = "y";\n', 'a = "x";\nb = "";\n']);
        expect(outcomes.map((o) => o._tag)).toEqual(["killed", "killed"]);
        expect(disk(report)).toEqual([source]);
      }),
    ));

  it("scenario: a file changed since Stryker read it, or a location past its end, is stale", () =>
    ran(
      Effect.gen(function* () {
        const { report, paths } = yield* files([
          { name: "a.ts", source: 'a = "x";\n', mutants: [mutant("1", "Survived", at(1, 5, 8), '""')] },
          { name: "b.ts", source: 'b = "y";\n', mutants: [mutant("2", "Survived", at(3, 1, 2), '""')] },
        ]);
        writeFileSync(paths[0]!, 'a = "changed";\n');
        const outcomes = yield* recheck({ report, tests: ["t"], cap: 20, deadline: far(), run: never });
        expect(outcomes.map((o) => o._tag === "skipped" && o.reason)).toEqual(["stale", "stale"]);
        expect(readFileSync(paths[0]!, "utf8")).toBe('a = "changed";\n');
        expect(readFileSync(paths[1]!, "utf8")).toBe('b = "y";\n');
      }),
    ));

  it("scenario: the time limit stops the run in flight, puts the file back, and leaves the rest unreached", () =>
    ran(
      Effect.gen(function* () {
        const source = 'a = "x";\nb = "y";\n';
        const two = [mutant("1", "Survived", at(1, 5, 8), '""'), mutant("2", "Survived", at(2, 5, 8), '""')];
        const { report } = yield* files([{ name: "a.ts", source, mutants: two }]);
        const run: Runner = () => Effect.never;
        const outcomes = yield* recheck({ report, tests: ["t"], cap: 20, deadline: Date.now() + 200, run });
        expect(outcomes.map((o) => o._tag === "skipped" && o.reason)).toEqual(["unreached", "unreached"]);
        expect(disk(report)).toEqual([source]);
      }),
    ));

  it("scenario: an interrupt mid-run puts the file back", () =>
    ran(
      Effect.gen(function* () {
        const source = 'a = "x";\n';
        const { report, paths } = yield* files([
          { name: "a.ts", source, mutants: [mutant("1", "Survived", at(1, 5, 8), '""')] },
        ]);
        const started = yield* Deferred.make<string>();
        const run: Runner = () =>
          Effect.suspend(() => Deferred.succeed(started, readFileSync(paths[0]!, "utf8"))).pipe(
            Effect.andThen(Effect.never),
          );
        const fiber = yield* Effect.forkChild(recheck({ report, tests: ["t"], cap: 20, deadline: far(), run }));
        expect(yield* Deferred.await(started)).toBe('a = "";\n');
        yield* Fiber.interrupt(fiber);
        expect(disk(report)).toEqual([source]);
      }),
    ));

  it("vector: a location is 1-based, its end column past the last character, as Stryker 10.1.1 writes it", () => {
    // From a real hourly run's report: `""` at 40:36-40:38 on a line of three tabs.
    const lines = "\n".repeat(39);
    const source = `${lines}\t\t\tconst source = tree.get(via) ?? "";\n`;
    expect(mutate(source, at(40, 36, 38), '"Stryker was here!"')).toEqual(
      Option.some(`${lines}\t\t\tconst source = tree.get(via) ?? "Stryker was here!";\n`),
    );
    expect(mutate("ab\ncd", at(1, 3, 3), "X")).toEqual(Option.some("abX\ncd"));
    expect(mutate("ab\ncd", at(2, 1, 3), "")).toEqual(Option.some("ab\n"));
    expect(mutate("ab\ncd", at(1, 4, 4), "X")).toEqual(Option.none());
    expect(mutate("ab\ncd", at(3, 1, 1), "X")).toEqual(Option.none());
    expect(mutate("ab\ncd", at(1, 0, 1), "X")).toEqual(Option.none());
  });

  it("vector: the words that mean a test starts a process, and look-alikes that do not", () => {
    for (const text of [
      'import { spawnSync } from "node:child_process";',
      'import { ChildProcess } from "effect/process";',
      "const ran = spawn(cmd, args);",
      "execFile('sh', [script]);",
      "fork(worker);",
      'import { execa } from "execa";',
    ]) {
      expect(spawns(text), text).toBe(true);
    }

    for (const text of ["Effect.fork(task);", "regex.exec(text);", "const spawned = 1;", "forked()"]) {
      expect(spawns(text), text).toBe(false);
    }
  });

  it("scenario: a test that starts a process through a helper it imports by path counts", () =>
    ran(
      Effect.gen(function* () {
        const { dir } = yield* files([
          { name: "helper.ts", source: 'import { spawnSync } from "node:child_process";\n', mutants: [] },
          { name: "via.test.ts", source: 'import { go } from "./helper.ts";\n', mutants: [] },
          { name: "own.test.ts", source: "const ran = spawn(cmd);\n", mutants: [] },
          { name: "plain.test.ts", source: 'import { add } from "./add.ts";\n', mutants: [] },
        ]);
        const tests = ["via.test.ts", "own.test.ts", "plain.test.ts", "missing.test.ts"].map((t) => join(dir, t));
        expect(yield* childTests(tests)).toEqual([tests[0], tests[1]]);
      }),
    ));
});
