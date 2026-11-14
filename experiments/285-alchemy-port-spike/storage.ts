// Experiment 285, next/. Question 4: the ledger's laws on Alchemy's Effect `transaction`, past the
// eight object laws and the interleave law of experiment 249.
//
// Three turns run side by side in one real object (`turn.ts`): S is today's, Sb and St are the
// plan's. The real ledger from libfabrika answers the same seeded calls on each, and the answers
// and the saved rows are compared. Then many requests append at once, and a turn is timed.
import { Deferred, Effect } from "effect";
import { call, median, run, save, start } from "./harness.ts";
import { type Build, prebuild, stack } from "./stacks.ts";

const ROUTES = ["S", "Sb", "St"] as const;
const SEEDS = [119120, 7, 285];
const CALLS = 400;
const AT_ONCE = [6, 24, 96];

const laws = (build: Build) =>
  Effect.scoped(
    Effect.gen(function* () {
      const ports = yield* Deferred.make<Record<string, number>>();
      const built = build === "prebuilt" ? yield* prebuild : undefined;
      const out = (yield* start(stack(build, [], ports, built?.file))) as { url: string };
      const door = out.url.replace(/\/$/, "");
      const ask = <A>(op: string, name: string, body: unknown) =>
        call(`${door}/turn/${op}?name=${encodeURIComponent(`${build}-${name}`)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).pipe(
          Effect.flatMap((reply) =>
            Effect.try({
              try: () => JSON.parse(reply.text) as A,
              catch: () => new Error(`${op} answered ${reply.status}: ${reply.text.slice(0, 600)}`),
            }),
          ),
        );

      // 1. Every way a plain step can end, on each turn.
      const cases: Record<string, unknown> = {};

      for (const route of ROUTES) {
        cases[route] = yield* ask("cases", `cases-${route}`, { route });
      }

      // 2. The real ledger, the same seeded calls on each turn: the answers and the rows must match.
      type Ran = {
        calls: number;
        kinds: Record<string, number>;
        answers: string;
        tables: Record<string, number>;
        hash: string;
      };
      const workloads = [];

      for (const seed of SEEDS) {
        const ran: Record<string, Ran> = {};

        for (const route of ROUTES) {
          ran[route] = yield* ask<Ran>("workload", `w-${seed}-${route}`, { route, seed, calls: CALLS });
        }

        workloads.push({
          seed,
          calls: CALLS,
          kinds: ran.S?.kinds,
          rows: ran.S?.tables,
          sameAnswers: ROUTES.every((route) => ran[route]?.answers === ran.S?.answers),
          sameRows: ROUTES.every((route) => ran[route]?.hash === ran.S?.hash),
          crashed: ROUTES.filter((route) => ran[route]?.answers === undefined),
        });
      }

      // 3. Many requests append to one object at once. Some wait first, outside the turn.
      const atOnce = [];

      for (const route of ROUTES) {
        for (const n of AT_ONCE) {
          const name = `at-once-${route}-${n}`;
          yield* ask("prime", name, { route });
          const began = performance.now();
          const answers = yield* Effect.all(
            Array.from({ length: n }, (_, i) =>
              ask<{ ok?: { _tag: string; rev: number; pos: number } }>("append", name, {
                route,
                id: `in-${i}`,
                pause: (["none", "key", "sleep"] as const)[i % 3],
              }).pipe(Effect.timeoutOption("8 seconds")),
            ),
            { concurrency: "unbounded" },
          );
          const ms = Math.round(performance.now() - began);
          const rows = yield* ask<Array<{ rev: number; pos: number; id: string }>>("entries", name, { route });
          atOnce.push({
            route,
            n,
            ms,
            answered: answers.filter((answer) => answer._tag === "Some").length,
            placed: answers.filter((answer) => answer._tag === "Some" && answer.value.ok?._tag === "placed").length,
            rows: rows.length,
            revsInOrder: rows.every((row, i) => row.rev === i + 1 && row.pos === i + 1),
            distinctIds: new Set(rows.map((row) => row.id)).size,
          });
        }
      }

      // 4. The key and alarm calls through Alchemy's storage, with no raw handle.
      const keys = yield* ask("keys", "keys", {});

      // 5. What one turn costs: 1,000 appends in one call, five times, after 200 to warm up.
      const timing: Record<string, unknown> = {};
      const empty: Array<number> = [];

      for (let n = 0; n < 5; n++) {
        const began = performance.now();
        yield* ask("appends", "time-empty", { route: "S", n: 0 });
        empty.push(performance.now() - began);
      }

      for (const route of ROUTES) {
        const name = `time-${route}`;
        yield* ask("prime", name, { route });
        yield* ask("appends", name, { route, n: 200, id: "warm" });
        const each: Array<number> = [];

        for (let n = 0; n < 5; n++) {
          const began = performance.now();
          const done = yield* ask<{ placed: number }>("appends", name, { route, n: 1000, id: `r${n}` });
          const ms = performance.now() - began - median(empty);

          if (done.placed !== 1000) {
            return yield* Effect.die(new Error(`${route} placed ${done.placed} of 1000`));
          }

          each.push(Math.round(ms * 10) / 10);
        }

        timing[route] = {
          microsecondsATurn: Math.round(median(each) * 10) / 10,
          lowest: Math.min(...each),
          highest: Math.max(...each),
        };
      }

      return { build, cases, workloads, atOnce, keys, emptyCallMs: Math.round(median(empty) * 100) / 100, timing };
    }),
  );

await run(
  Effect.gen(function* () {
    const prebuilt = yield* laws("prebuilt");
    const bundled = yield* laws("bundled");
    yield* save("storage", { prebuilt, bundled });
  }),
);
