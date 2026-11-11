/**
 * The mutation run's second pass, over the mutants a child process could kill but Stryker never
 * let it (tracker ticket 265). Today's lead tooling. The mutation command calls it after Stryker,
 * in the box, only on its throwaway checkout:
 *
 *   node .agents/skills/mutation/scripts/recheck.ts --report "$M/report.json" \
 *     --related a.test.ts,b.test.ts --deadline 1789000000000 --summary "$M/recheck.json"
 *
 * Why. Stryker 10.1.1's vitest runner turns a mutant on only inside its own test worker
 * (`stryker-setup.js` sets `globalThis.__stryker__.activeMutant` in a `beforeAll`). The
 * instrumented code falls back to `process.env.__STRYKER_ACTIVE_MUTANT__`, but only the command
 * runner sets that variable (`command-test-runner.js`). So a child process a test starts runs the
 * original code, and its coverage never reaches the runner: the mutant reads NoCoverage, or
 * Survived when an in-process test covers it too.
 *
 * Tools looked at first (0040). The vitest runner has no option that passes the mutant on
 * (`configFile`, `dir`, `related`, `pool`). `coverageAnalysis: "off"` runs every mutant, still
 * without the variable. The command runner sets it, so a child does see the mutant, but it has no
 * coverage, and Stryker picks mutants only by `mutate` ranges: a range takes every mutant inside it
 * (`babel-transformer.js`, `locationIncluded`), so a block mutant's range brings back each nested
 * one, and no cap holds. Upstream has no issue or option for this; stryker-js#6238 is the same
 * blind spot for `node:vm`. So this pass is hand-written: one mutant, from the report's own source,
 * replacement and location.
 *
 * Which tests: a related test that starts a process, by its text or a file it imports by a
 * relative path (`spawns`). Each such test runs against every candidate. It misses a test that
 * starts one through a helper two imports away, or by a word not listed.
 *
 * Edge cases, each in the test:
 *
 * - No related test starts a process: nothing runs, and each candidate is `no_child_test`.
 * - A test fails on the mutant: Killed, and the file is put back byte for byte.
 * - Interrupted mid-run (the run's cap, a signal): the scope puts the file back.
 * - Two mutants in one file: one at a time, each written over the original.
 * - The cap reached: the rest are `capped`, counted and named, never dropped.
 * - The file changed since Stryker read it, or the location is past its end: `stale`.
 * - The time limit hit: the run in flight stops, its file goes back, the rest are `unreached`.
 * - The tests pass, or a file fails to load with no failed test: the status stays.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";

/** At most this many mutants a run. A first bound: the summary's counts will set the next. */
export const CAP = 20;
/** Stop this long before the run's own cap, so the report is written before it fires. */
export const MARGIN_MS = 5_000;
/** The marker at the start of an upgraded mutant's `statusReason`. */
export const MARK = "recheck:";

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const Position = Schema.Struct({ line: Schema.Int, column: Schema.Int });
const Location = Schema.Struct({ start: Position, end: Position });

/** One mutant in Stryker's JSON report. Its other fields pass through unchanged. */
const Mutant = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    mutatorName: Schema.String,
    replacement: Schema.optional(Schema.String),
    status: Schema.String,
    location: Location,
  }),
  Rest,
);

/** The part of Stryker's JSON report this pass reads and writes back. */
export const Report = Schema.StructWithRest(
  Schema.Struct({
    files: Schema.Record(
      Schema.String,
      Schema.StructWithRest(Schema.Struct({ source: Schema.String, mutants: Schema.Array(Mutant) }), Rest),
    ),
  }),
  Rest,
);
export type Report = typeof Report.Type;
type Location = typeof Location.Type;

/** A mutant this pass may run: Stryker never saw a test fail on it. */
export interface Candidate {
  readonly file: string;
  readonly id: string;
  readonly status: string;
  readonly location: Location;
  readonly replacement: string;
  readonly source: string;
}

const Ref = { file: Schema.String, id: Schema.String };

/** What became of one candidate. */
export const Outcome = Schema.TaggedUnion({
  killed: { ...Ref, tests: Schema.Array(Schema.String) },
  kept: { ...Ref, reason: Schema.Literals(["passed", "load_error"]) },
  skipped: { ...Ref, reason: Schema.Literals(["no_child_test", "capped", "stale", "unreached"]) },
});
export type Outcome = typeof Outcome.Type;
type Skip = (typeof Outcome.cases.skipped.Type)["reason"];

/** What one run of the child-process tests said about the mutant on disk. */
export const Verdict = Schema.TaggedUnion({
  failed: { tests: Schema.Array(Schema.String) },
  passed: {},
  load_error: {},
});
export type Verdict = typeof Verdict.Type;

/** Runs the given test files against what is on disk now. */
export type Runner = (tests: ReadonlyArray<string>) => Effect.Effect<Verdict>;

const UNSEEN = new Set(["NoCoverage", "Survived"]);

/** Each NoCoverage or Survived mutant, one file at a time in turn, so every file gets one first. */
export const candidates = (report: Report): Array<Candidate> => {
  const perFile = Object.entries(report.files).map(([file, f]) =>
    f.mutants
      .filter((m) => UNSEEN.has(m.status) && m.replacement !== undefined)
      .map((m) => ({
        file,
        id: m.id,
        status: m.status,
        location: m.location,
        replacement: m.replacement ?? "",
        source: f.source,
      })),
  );
  const longest = Math.max(0, ...perFile.map((ms) => ms.length));
  return Array.from({ length: longest }, (_, i) => perFile.flatMap((ms) => ms.slice(i, i + 1))).flat();
};

/** The source with one mutant applied; none when its location is not inside the source. Pure. */
export const mutate = (source: string, location: Location, replacement: string): Option.Option<string> => {
  const starts = [0];

  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }

  const offset = (p: Location["start"]): Option.Option<number> => {
    const start = starts[p.line - 1];
    const end = p.line < starts.length ? (starts[p.line] ?? source.length) - 1 : source.length;
    return start === undefined || p.column < 1 || start + p.column - 1 > end
      ? Option.none()
      : Option.some(start + p.column - 1);
  };

  return Option.flatMap(Option.all([offset(location.start), offset(location.end)]), ([from, to]) =>
    from > to ? Option.none() : Option.some(source.slice(0, from) + replacement + source.slice(to)),
  );
};

const SPAWN =
  /\bchild_process\b|\bChildProcess\b|\bexeca\b|\b(?:spawn|spawnSync|execFile|execFileSync|execSync)\(|(?<![.\w])fork\(/;

/** Whether this text starts a process. Pure. */
export const spawns = (text: string): boolean => SPAWN.test(text);

const RELATIVE = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"'?]+)["']/g;

/** The related tests that start a process, by their own text or a file they import by path. */
export const childTests = Effect.fnUntraced(function* (related: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) => fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")));
  const found: Array<string> = [];

  for (const test of related) {
    const text = yield* read(test);
    const imported = [...text.matchAll(RELATIVE)].map((m) => path.join(path.dirname(test), m[1] ?? ""));
    const texts = [text, ...(yield* Effect.forEach(imported, read, { concurrency: 1 }))];

    if (texts.some(spawns)) {
      found.push(test);
    }
  }

  return found;
});

/** The report with each killed mutant marked Killed by this pass. Pure. */
export const upgrade = (report: Report, outcomes: ReadonlyArray<Outcome>): Report => {
  const killed = new Map(
    outcomes.flatMap((o) => (o._tag === "killed" ? [[`${o.file}\u0000${o.id}`, o] as const] : [])),
  );
  const files = Object.fromEntries(
    Object.entries(report.files).map(([file, f]) => [
      file,
      {
        ...f,
        mutants: f.mutants.map((m) => {
          const k = killed.get(`${file}\u0000${m.id}`);
          return k === undefined
            ? m
            : {
                ...m,
                status: "Killed",
                statusReason: `${MARK} ${k.tests.join(", ")} failed with this mutant on disk alone; Stryker said ${m.status}`,
              };
        }),
      },
    ]),
  );
  return { ...report, files };
};

/**
 * Run each candidate against the child-process tests, one at a time, up to the cap and until the
 * deadline. Each run writes one mutant over the file in a scope, so the file is put back however
 * the run ends: a failed test, a time limit or an interrupt.
 */
export const recheck = Effect.fnUntraced(function* (input: {
  readonly report: Report;
  readonly tests: ReadonlyArray<string>;
  readonly cap: number;
  readonly deadline: number;
  readonly run: Runner;
}) {
  const fs = yield* FileSystem.FileSystem;
  const all = candidates(input.report);
  const outcomes: Array<Outcome> = [];
  let out = false;

  for (const [i, c] of all.entries()) {
    const ref = { file: c.file, id: c.id };
    const skip = (reason: Skip) => Outcome.cases.skipped.make({ ...ref, reason });

    if (input.tests.length === 0) {
      outcomes.push(skip("no_child_test"));
      continue;
    }

    if (i >= input.cap) {
      outcomes.push(skip("capped"));
      continue;
    }

    const left = input.deadline - (yield* Clock.currentTimeMillis);

    if (out || left <= 0) {
      out = true;
      outcomes.push(skip("unreached"));
      continue;
    }

    // Read whole, so the file goes back byte for byte, whatever its encoding.
    const original = yield* fs.readFile(c.file);
    const mutated = mutate(c.source, c.location, c.replacement);

    if (new TextDecoder().decode(original) !== c.source || Option.isNone(mutated)) {
      outcomes.push(skip("stale"));
      continue;
    }

    const verdict = yield* Effect.acquireRelease(fs.writeFileString(c.file, mutated.value), () =>
      fs.writeFile(c.file, original).pipe(Effect.orDie),
    ).pipe(
      Effect.andThen(() => input.run(input.tests).pipe(Effect.timeoutOption(left))),
      Effect.scoped,
    );

    if (Option.isNone(verdict)) {
      out = true;
      outcomes.push(skip("unreached"));
    } else if (verdict.value._tag === "failed") {
      outcomes.push(Outcome.cases.killed.make({ ...ref, tests: verdict.value.tests }));
    } else {
      outcomes.push(Outcome.cases.kept.make({ ...ref, reason: verdict.value._tag }));
    }
  }

  return outcomes;
});

/** The pass's own record, beside Stryker's report: the cap, the tests and every outcome. */
export const Summary = Schema.Struct({
  cap: Schema.Int,
  tests: Schema.Array(Schema.String),
  candidates: Schema.Int,
  counts: Schema.Record(Schema.String, Schema.Int),
  seconds: Schema.Number,
  outcomes: Schema.Array(Outcome),
});

/** How many of each outcome: `killed`, `kept`, and each skip by its reason. Pure. */
export const counts = (outcomes: ReadonlyArray<Outcome>): Record<string, number> => {
  const c: Record<string, number> = {};

  for (const o of outcomes) {
    const key = o._tag === "killed" ? "killed" : o._tag === "kept" ? `kept_${o.reason}` : o.reason;
    c[key] = (c[key] ?? 0) + 1;
  }

  return c;
};

const VitestJson = Schema.fromJsonString(
  Schema.Struct({
    testResults: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        assertionResults: Schema.Array(Schema.Struct({ status: Schema.String })),
      }),
    ),
  }),
);

/**
 * The real runner: vitest on the given files with the run's own config, so `TEST_LIMIT`, the
 * run's per-test limit (ticket 605), holds here too. A test that failed kills; a run with no failed
 * test that still exits non-zero, or leaves no report, could not load the mutant and kills nothing.
 */
export const vitest = (config: string) => (tests: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "recheck-" });
    const out = path.join(dir, "vitest.json");
    const ran = yield* ChildProcess.make(
      "node_modules/.bin/vitest",
      ["run", "--config", config, "--maxWorkers=1", "--reporter=json", `--outputFile=${out}`, ...tests],
      { extendEnv: true, stdout: "ignore", stderr: "ignore", forceKillAfter: "1 second" },
    );
    const code = Number(yield* ran.exitCode);
    const report = yield* fs
      .readFileString(out)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(VitestJson)), Effect.option);
    const failed = Option.match(report, {
      onNone: () => [],
      onSome: (r) =>
        r.testResults
          .filter((f) => f.assertionResults.some((a) => a.status === "failed"))
          .map((f) => path.relative(process.cwd(), f.name)),
    });
    return failed.length > 0
      ? Verdict.cases.failed.make({ tests: failed })
      : code === 0
        ? Verdict.cases.passed.make({})
        : Verdict.cases.load_error.make({});
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed<Verdict>(Verdict.cases.load_error.make({}))),
    Effect.provide(NodeServices.layer),
  );

const command = Command.make(
  "recheck",
  {
    report: Flag.String("report"),
    related: Flag.String("related"),
    deadline: Flag.Int("deadline"),
    summary: Flag.String("summary"),
    cap: Flag.Int("cap").pipe(Flag.withDefault(CAP)),
    config: Flag.String("config").pipe(Flag.withDefault("vitest.mutation.config.ts")),
  },
  (flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const started = yield* Clock.currentTimeMillis;
      const report = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Report))(
        yield* fs.readFileString(flags.report),
      );
      const related = flags.related
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const tests = yield* childTests(related);
      const outcomes = yield* recheck({
        report,
        tests,
        cap: flags.cap,
        deadline: flags.deadline - MARGIN_MS,
        run: vitest(flags.config),
      });
      const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Report))(upgrade(report, outcomes));
      // Written whole, then moved over the report, so a stop mid-write leaves Stryker's own.
      yield* fs.writeFileString(`${flags.report}.recheck`, encoded);
      yield* fs.rename(`${flags.report}.recheck`, flags.report);
      const c = counts(outcomes);
      const seconds = ((yield* Clock.currentTimeMillis) - started) / 1000;
      const summary = { cap: flags.cap, tests, candidates: outcomes.length, counts: c, seconds, outcomes };
      yield* fs.writeFileString(flags.summary, yield* Schema.encodeEffect(Schema.fromJsonString(Summary))(summary));
      yield* Console.log(
        `recheck: ${outcomes.length} candidates, ${tests.length} child-process tests, cap ${flags.cap}, ` +
          `${seconds.toFixed(1)} s: ${JSON.stringify(c)}`,
      );
    }).pipe(Effect.tapError((error) => Console.error(`recheck: ${error}`))),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(command, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
    { disableErrorReporting: true },
  );
}
