// Experiment 285, next/. Question 5: what a call to an object costs each way. 1,000 calls one after
// another inside one request, five times, after 200 to warm up. The request's own cost, measured
// with no calls, is taken off.
//
//   plain    today: a Promise stub to a plain class, which runs its service through a runtime
//   stub     after S1: the same binding through Alchemy's stub, to the bridge class
//   sibling  after S4: the sibling taken in the Layer's init, to the bridge class
import { loadavg } from "node:os";
import { Deferred, Effect } from "effect";
import { json, median, run, save, start } from "./harness.ts";
import { type Build, prebuild, stack } from "./stacks.ts";

const RUNS = 5;
const CALLS = 1000;

const timed = (build: Build, ways: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const ports = yield* Deferred.make<Record<string, number>>();
      const built = build === "prebuilt" ? yield* prebuild : undefined;
      const out = (yield* start(stack(build, [], ports, built?.file))) as { url: string };
      const door = out.url.replace(/\/$/, "");
      const calls = (way: string, n: number) =>
        Effect.gen(function* () {
          const began = performance.now();
          const done = (yield* json(`${door}/calls?way=${way}&n=${n}&name=${build}-${way}`)) as { last: number };
          return { ms: performance.now() - began, last: done.last };
        });
      const result: Record<string, unknown> = {};

      for (const way of ways) {
        yield* calls(way, 200);
        const empty: Array<number> = [];
        const each: Array<number> = [];

        // An empty request and a full one take turns, so a busy moment on the laptop hits both.
        for (let n = 0; n < RUNS; n++) {
          empty.push((yield* calls(way, 0)).ms);
          const full = yield* calls(way, CALLS);

          if (full.last !== CALLS) {
            return yield* Effect.die(new Error(`${way} answered ${full.last}, not ${CALLS}`));
          }

          each.push(full.ms);
        }

        const micros = each.map((ms) => Math.round((ms - median(empty)) * 10) / 10);
        result[way] = {
          microsecondsACall: median(micros),
          lowest: Math.min(...micros),
          highest: Math.max(...micros),
          emptyRequestMs: Math.round(median(empty) * 100) / 100,
        };
      }

      return { build, built, ...result };
    }),
  );

await run(
  Effect.gen(function* () {
    const before = loadavg();
    const prebuilt = yield* timed("prebuilt", ["plain", "stub", "sibling"]);
    const bundled = yield* timed("bundled", ["stub", "sibling"]);
    yield* save("timing", { runs: RUNS, calls: CALLS, loadAverage: [before[0], loadavg()[0]], prebuilt, bundled });
  }),
);
