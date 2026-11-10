import { memoryStorage, openJobs } from "@kampus/fabrika-old";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { jobLines } from "./job-lines.ts";

// The host's wait for a job's end (`ended`), as the `stop` tool waits for it (host/serve.ts,
// `stopFor`). A wait that gives up, as the tool's `asked` does after `EXIT_WITHIN`, takes only
// itself away: another wait for the same job still hears its end, and `job` reads the end later.
// Today's version, the host's table in memory, no tile and no tsh: the tile's news is said by hand.
//
//   lines.ended(1)  gives up after a short wait     "asked"
//   lines.ended(1)  still waiting
//   news("t1").ended {n: 1, how: "stopped"}         the second wait hears it; job(1) says ended

const RUN = "counter-1";

/** The host's table with job 1 running in t1, and its lines beside it. */
const withJob = Effect.gen(function* () {
  const jobs = yield* openJobs(memoryStorage());
  const lines = yield* jobLines(jobs.table);
  yield* jobs.table.dispatch({
    type: "began",
    text: "counter &",
    stages: [{ program: "counter", flags: {}, run: RUN, wire: null, ended: false }],
    background: true,
    owner: "t1",
    by: "user:owner",
  });
  /** Job 1 ends stopped, as t1's tsh and tile say it: it leaves the table, then the tile tells its end. */
  const end = Effect.gen(function* () {
    yield* jobs.table.dispatch({ type: "stage_ended", run: RUN, how: "stopped" });
    lines.news("t1").ended({ n: 1, text: "counter &", how: "stopped", since: 0, at: 1, foreground: false });
  });
  return { lines, end };
});

describe("a wait for a job's end that gives up", () => {
  it("leaves the job's end for another wait on the same job, and for job", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const { lines, end } = yield* withJob;
        const still = yield* Effect.forkChild(
          lines.ended(1).pipe(
            Effect.timeoutOrElse({
              duration: "3 seconds",
              orElse: () => Effect.succeed("never told" as const),
            }),
          ),
        );
        const gaveUp = yield* lines.ended(1).pipe(
          Effect.timeoutOrElse({
            duration: "50 millis",
            orElse: () => Effect.succeed("asked" as const),
          }),
        );
        yield* end;
        const heard = yield* Fiber.join(still);
        const after = yield* lines.ended(1).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.succeed("never told" as const),
          }),
        );
        return { gaveUp, heard, after, job: lines.job(1) };
      }).pipe(Effect.scoped),
    );
    expect(seen.gaveUp).toBe("asked");
    const ended = { n: 1, text: "counter &", tile: "t1", state: { _tag: "ended", how: "stopped" } };
    expect(seen.heard).toMatchObject(ended);
    // A wait asked after the end answers at once, and `job` reads the end later.
    expect(seen.after).toMatchObject(ended);
    expect(seen.job).toMatchObject(ended);
  });

  it("leaves the job's end for a wait that comes after it, as a second stop after asked does", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const { lines, end } = yield* withJob;
        const gaveUp = yield* lines.ended(1).pipe(
          Effect.timeoutOrElse({
            duration: "50 millis",
            orElse: () => Effect.succeed("asked" as const),
          }),
        );
        const next = yield* Effect.forkChild(
          lines.ended(1).pipe(
            Effect.timeoutOrElse({
              duration: "3 seconds",
              orElse: () => Effect.succeed("never told" as const),
            }),
          ),
        );
        yield* Effect.sleep("10 millis");
        yield* end;
        return { gaveUp, heard: yield* Fiber.join(next) };
      }).pipe(Effect.scoped),
    );
    expect(seen.gaveUp).toBe("asked");
    expect(seen.heard).toMatchObject({ n: 1, state: { _tag: "ended", how: "stopped" } });
  });
});
