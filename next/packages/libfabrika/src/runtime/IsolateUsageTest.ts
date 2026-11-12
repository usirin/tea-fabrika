// next/. SQLite laws, with no driver (0062). A decision tape chooses only a move allowed by
// the calls so far. The oracle reads committed health and span rows, never the sink's model.
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Layer, Result, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { SpanRow } from "../telemetry/Trace.ts";
import * as IsolateUsage from "./IsolateUsage.ts";

export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };
export type Props = { readonly project: string; readonly name: string; readonly process: string };

export type Event = {
  readonly event: { readonly rpcMethod: string };
  readonly cpuTime: number;
  readonly wallTime: number;
  readonly outcome: string;
};

export type Deliver = (
  props: Props,
  events: ReadonlyArray<Event>,
  receive: (object: string, rows: ReadonlyArray<typeof IsolateUsage.Usage.Type>) => Effect.Effect<void, unknown>,
) => Effect.Effect<void>;

export type World = {
  readonly step: (id: string, n: number) => Effect.Effect<unknown, unknown>;
  readonly snapshot: Effect.Effect<unknown, unknown>;
  readonly executions: () => number;
};

export type Rig = {
  readonly open: Effect.Effect<Store, never, Scope.Scope>;
  readonly deliver: Deliver;
  readonly runner: Effect.Effect<World, unknown, Scope.Scope>;
  readonly invoke: (process: string) => Effect.Effect<void, unknown>;
};

const pid = (n: number) => `process_0000000000e00800${String(n).padStart(10, "0")}`;

const Cell = fc.record({
  pick: fc.nat(),
  size: fc.integer({ min: 1, max: 32 }),
  cpu: fc.integer({ min: 0, max: 30000 }),
});

const Tape = fc.array(Cell, { minLength: 2, maxLength: 24 });

const rows = (sql: Sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='unsent'").length === 0
    ? []
    : sql
        .exec("SELECT row FROM unsent ORDER BY rowid")
        .map((r) => Schema.decodeUnknownSync(Schema.fromJsonString(SpanRow))(r.row));

const health = (sql: Sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='measurements'").length === 0
    ? []
    : sql.exec("SELECT * FROM measurements WHERE piece='isolate.cpu' ORDER BY rowid");

const sink = (sql: Sql, object: string) =>
  Layer.mergeAll(SpanSink.layer(sql, { object }), RecordManager.memory(1_000_000_000), Archive.memory);

const sample = (process: string, cpuMs: number): typeof IsolateUsage.Usage.Type => ({
  process,
  cpuMs,
  wallMs: cpuMs + 1,
  method: "step",
  outcome: "ok",
});

export const suite = (rig: Rig) =>
  describe("next/ isolate usage on real SQLite", () => {
    it.effect.prop(
      "U1 names own their rows; replacements and late batches keep the process from the load",
      { tape: Tape },
      ({ tape }) =>
        Effect.gen(function* () {
          const stores = [yield* rig.open, yield* rig.open];
          const names = ["checklist:1", "checklist:2"];
          const live = [1, 2];
          const ran: Array<{ name: string; process: string }> = [];
          const expected: Array<Array<typeof IsolateUsage.Usage.Type>> = [[], []];
          const layers = stores.map((store, n) => sink(store.sql, names[n] ?? ""));
          const contexts = yield* Effect.forEach(layers, (layer) => Layer.build(layer), { concurrency: 1 });
          let next = 2;
          const deliver = (called: { name: string; process: string }, cpu: number, count: number) =>
            Effect.gen(function* () {
              const index = names.indexOf(called.name);
              const events = Array.from({ length: count }, () => ({
                event: { rpcMethod: "step" },
                cpuTime: cpu,
                wallTime: cpu + 1,
                outcome: "ok",
              }));
              yield* rig.deliver({ project: "project-test", ...called }, events, (object, usage) => {
                expect(object).toBe(JSON.stringify(["project-test", called.name]));
                return IsolateUsage.record(usage).pipe(
                  Effect.annotateSpans({ "fab.process": pid(live[index] ?? 1) }),
                  Effect.provideContext(contexts[index] ?? Context.empty()),
                );
              });
              expected[index]?.push(...events.map(() => sample(called.process, cpu)));
            });
          const check = () => {
            for (const [i, store] of stores.entries()) {
              expect(
                rows(store.sql).map((row) => ({
                  process: row.attributes["fab.process"],
                  method: row.attributes["fab.isolate.method"],
                  outcome: row.attributes["fab.isolate.outcome"],
                  cpuMs: Number(BigInt(row.endTimeUnixNano) - BigInt(row.startTimeUnixNano)) / 1_000_000,
                  wallMs: row.attributes["fab.isolate.wall_ms"],
                })),
              ).toEqual(expected[i]);
              expect(rows(store.sql).every((row) => row.resource.attributes["fab.object"] === names[i])).toBe(true);
              expect(health(store.sql)).toHaveLength(expected[i]?.length ?? 0);
            }
          };

          for (const cell of tape) {
            // Before anything ran, only a call is possible. Later cells can replace, run, deliver late or reopen.
            const moves = ran.length === 0 ? ["call"] : ["call", "replace", "tail", "reopen"];
            const move = moves[cell.pick % moves.length];
            const n = cell.pick % names.length;

            if (move === "call") {
              const process = pid(live[n] ?? 1);
              yield* rig.invoke(process);
              ran.push({ name: names[n] ?? "", process });
            } else if (move === "replace") {
              live[n] = ++next;
            } else if (move === "reopen") {
              yield* stores[n]?.reopen ?? Effect.void;
              const store = stores[n];

              if (store !== undefined) {
                contexts[n] = yield* Layer.build(sink(store.sql, names[n] ?? ""));
              }
            } else {
              const called = ran[cell.pick % ran.length];

              if (called === undefined) {
                return yield* Effect.die("tail without a call");
              }

              yield* deliver(called, cell.cpu, cell.size);
            }

            check();
          }

          // Drain all calls, including processes replaced since they ran. No walk can pass with no tail.
          for (const called of ran) {
            yield* deliver(called, 0, 1);
          }

          check();
        }),
      { arbitrary: { seed: 119120, runs: 40 } },
    );

    it.effect.prop(
      "U3 batches commit once, survive reopen and hold every row after a failed write",
      { tape: Tape },
      ({ tape }) =>
        Effect.gen(function* () {
          const store = yield* rig.open;
          let transactions = 0;
          let depth = 0;
          let failAt: number | null = null;
          let writes = 0;
          const sql: Sql = {
            exec: (query, ...params) => {
              if (/^\s*INSERT INTO unsent\b/i.test(query)) {
                writes++;

                if (failAt === writes) {
                  // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: the SQLite driver throws on a full disk; the sink must hold the batch
                  throw new Error("SQLITE_FULL");
                }
              }

              return store.sql.exec(query, ...params);
            },
            transaction: (body) => {
              if (depth === 0) {
                transactions++;
              }

              depth++;
              const result = Result.try(() => store.sql.transaction(body));
              depth--;
              return Result.getOrThrow(result);
            },
            size: () => store.sql.size(),
          };
          yield* Effect.gen(function* () {
            const service = yield* SpanSink;
            // Warm the existing sink tables. The law counts batch transactions after setup.
            yield* IsolateUsage.record([sample(pid(1), 0)]);
            let committed = 1;
            let held = 0;
            let owed = false;

            for (const cell of tape) {
              const moves = held > 0 || owed ? ["flush", "recover"] : ["batch", "cut", "reopen"];
              const move = moves[cell.pick % moves.length];

              if (move === "reopen") {
                yield* store.reopen;
              } else if (move === "flush") {
                expect(Exit.isFailure(yield* Effect.exit(service.flush))).toBe(true);
                owed = false;
              } else {
                const count = move === "recover" ? 1 : cell.size;
                const batch = Array.from({ length: count }, (_, n) => sample(pid(1), cell.cpu + n));
                writes = 0;
                // Fail inside a batch, including after earlier rows would have been written.
                failAt = move === "cut" ? 1 + (cell.pick % count) : null;
                transactions = 0;
                const before = rows(store.sql).length;
                yield* IsolateUsage.record(batch);
                expect(transactions, "one batch is one atomic sink commit").toBe(1);

                if (move === "cut") {
                  held += count;
                  owed = true;
                  expect(rows(store.sql)).toHaveLength(before);
                } else {
                  committed += count + held;
                  held = 0;
                }

                failAt = null;
                expect(rows(store.sql)).toHaveLength(committed);
                expect(health(store.sql)).toHaveLength(committed);
              }
            }

            if (held > 0) {
              yield* IsolateUsage.record([sample(pid(1), 0)]);
              committed += held + 1;
            }

            yield* store.reopen;
            expect(rows(store.sql)).toHaveLength(committed);
            expect(health(store.sql)).toHaveLength(committed);
          }).pipe(Effect.provide(sink(sql, "checklist:1")));
        }),
      { arbitrary: { seed: 119120, runs: 40 } },
    );

    it.effect.prop(
      "U7 failed, hung and successful usage deliveries leave program answers, receipts and journal alone",
      {
        tape: fc.array(fc.record({ n: fc.integer({ min: -1000, max: 1000 }), pick: fc.nat() }), {
          minLength: 1,
          maxLength: 24,
        }),
      },
      ({ tape }) =>
        Effect.gen(function* () {
          const control = yield* rig.runner;
          const measured = yield* rig.runner;

          for (const [n, cell] of tape.entries()) {
            const id = `letter-${n}`;
            const behavior = ["ok", "fail", "hang"][cell.pick % 3];
            const before = yield* measured.snapshot;
            const delivery = rig.deliver(
              { project: "project-test", name: "checklist:1", process: pid(1) },
              [{ event: { rpcMethod: "step" }, cpuTime: n, wallTime: n + 1, outcome: "ok" }],
              () =>
                behavior === "hang"
                  ? Effect.never
                  : behavior === "fail"
                    ? Effect.fail(new TypeError("private failure"))
                    : Effect.void,
            );
            const pending = yield* delivery.pipe(Effect.forkScoped);
            yield* Effect.yieldNow;
            expect(yield* measured.snapshot).toEqual(before);
            const answer = yield* measured.step(id, cell.n);
            expect(answer).toEqual(yield* control.step(id, cell.n));
            expect(yield* measured.snapshot).toEqual(yield* control.snapshot);
            expect(measured.executions()).toBe(control.executions());
            // A resend must still find the same receipt and must not execute again.
            expect(yield* measured.step(id, cell.n)).toEqual(answer);
            expect(measured.executions()).toBe(control.executions());
            yield* Fiber.interrupt(pending);
          }
        }),
      { arbitrary: { seed: 119120, runs: 40 } },
    );
  });
