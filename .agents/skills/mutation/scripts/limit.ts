/**
 * The mutation run's per-test time limit, from the plain run of the same tests in the same box
 * (ticket 605). Today's lead tooling. The mutation command beside it calls it when `BASELINE` names
 * that run's vitest JSON report, and hands the number it prints to the vitest config Stryker reads:
 *
 *   node .agents/skills/mutation/scripts/limit.ts /out/baseline.json    # prints 30000
 *
 * The decided fast check keeps a 10 s test limit (docs/direction/fast-and-daily-mutation.md), and
 * that stays the floor. A fixed 10 s stopped Stryker's dry run whenever one related law took longer
 * on its own, and then no mutant ran at all: three of the first five hourly runs on 2026-11-11, on
 * laws that took 9.8 s, 12.7 s and 25 s in the box's plain run. So the limit is three times the
 * slowest test or file set-up there, never under 10 s and never over 60 s, the repo's own limit in
 * `vitest.config.ts`, which fails a slower test anyway. Three: `vitest.config.ts` keeps 3.3 times
 * its slowest measured test, and Stryker's dry run took 1.03 times the plain run's net time (67.6 s
 * against 65.4 s, CI run 42962636258), so three leaves room the data does not yet ask for.
 *
 * Hand-written, since no tool here does it (0040): vitest takes one fixed `testTimeout`, and
 * Stryker 10.1.1's own limits are per mutant (`timeoutMS`, `timeoutFactor`) or for the whole dry
 * run (`dryRunTimeoutMinutes`), never per test in the dry run. Its edge cases, each in the test:
 *
 * - No test or file in the report: the floor.
 * - A test with no duration (skipped, todo): left out.
 * - A file whose hooks outlast its tests: its span less its tests' sum counts as set-up.
 * - A file with no start or end time (it failed to load): only its tests count.
 * - A slow test past a third of the ceiling: the ceiling.
 * - Not a vitest JSON report: an error, never the floor, so a broken baseline is seen.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schema } from "effect";
import { Argument, Command } from "effect/cli";

/** The decided fast check's test limit, in ms. */
export const FLOOR = 10_000;
/** `vitest.config.ts`'s own test limit, in ms. */
export const CEILING = 60_000;
/** Room over the slowest plain time, from the measures above. */
export const FACTOR = 3;

const Ms = Schema.Number.check(Schema.isFinite());

/** The part of vitest's JSON report the limit reads. */
export const Report = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      startTime: Schema.optional(Ms),
      endTime: Schema.optional(Ms),
      assertionResults: Schema.Array(Schema.Struct({ duration: Schema.optional(Schema.NullOr(Ms)) })),
    }),
  ),
});

/** The slowest single wait the run must allow: one test, or one file's set-up and tear-down. Pure. */
export const slowest = (report: typeof Report.Type): number =>
  Math.max(
    0,
    ...report.testResults.flatMap((file) => {
      const tests = file.assertionResults.flatMap((test) => (typeof test.duration === "number" ? [test.duration] : []));
      const span = file.startTime === undefined || file.endTime === undefined ? 0 : file.endTime - file.startTime;
      const setup = span - tests.reduce((sum, ms) => sum + ms, 0);
      return [...tests, setup];
    }),
  );

/** The limit for this report, in whole seconds of ms, from the floor to the ceiling. Pure. */
export const limit = (report: typeof Report.Type): number =>
  Math.min(CEILING, Math.max(FLOOR, Math.ceil((FACTOR * slowest(report)) / 1000) * 1000));

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Report));

const command = Command.make("limit", { report: Argument.String("report") }, ({ report }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const parsed = yield* decode(yield* fs.readFileString(report));
    yield* Console.log(String(limit(parsed)));
  }).pipe(Effect.tapError((error) => Console.error(`limit: cannot read ${report} as a vitest JSON report: ${error}`))),
);

// stdout carries only the number, since the mutation command reads it; a failure goes to stderr and exits 1.
if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(command, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
    { disableErrorReporting: true },
  );
}
