// next/. SQLite laws, with no driver (0062). A decision tape chooses only a move allowed by
// the calls so far. The oracle reads committed health and span rows, never the sink's model.
import { describe, expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Logger, References, Ref, Result, Tracer, type Scope } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import type * as IsolateUsage from "./IsolateUsage.ts";

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

export type Recording = {
  readonly record: (usage: ReadonlyArray<typeof IsolateUsage.Usage.Type>) => Effect.Effect<void>;
  readonly flush: Effect.Effect<unknown, unknown>;
};

export type UsageSpan = {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly resource: { readonly attributes: Readonly<Record<string, unknown>> };
};

export type Rig = {
  readonly open: Effect.Effect<Store, never, Scope.Scope>;
  readonly deliver: Deliver;
  readonly runner: (usage: Effect.Effect<void, unknown>) => Effect.Effect<World, unknown, Scope.Scope>;
  readonly invoke: (process: string) => Effect.Effect<void, unknown>;
  readonly telemetry: (sql: Sql, object: string) => Effect.Effect<Recording, never, Scope.Scope>;
  readonly rows: (sql: Sql) => ReadonlyArray<UsageSpan>;
  readonly health: (sql: Sql) => ReadonlyArray<unknown>;
};

const pid = (n: number) => `process_0000000000e00800${String(n).padStart(10, "0")}`;

const Cell = fc.record({
  pick: fc.nat(),
  target: fc.nat(),
  size: fc.integer({ min: 1, max: 32 }),
  cpu: fc.integer({ min: 0, max: 30000 }),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc.array(Cell, { minLength: 2, maxLength: 24 });

const DeliveryCell = fc.record({
  n: fc.integer({ min: -1000, max: 1000 }),
  pick: fc.nat(),
  error: fc.string(),
  elapsed: fc.integer({ min: 0, max: 30_000 }),
});
type DeliveryCell = typeof DeliveryCell extends fc.Arbitrary<infer A> ? A : never;
const DeliveryTape = fc.array(DeliveryCell, { minLength: 1, maxLength: 24 });

const sample = (process: string, cpuMs: number): typeof IsolateUsage.Usage.Type => ({
  process,
  cpuMs,
  wallMs: cpuMs + 1,
  method: "step",
  outcome: "ok",
});

export const suite = (rig: Rig) =>
  describe("next/ isolate usage on real SQLite", () => {
    // fast-check shrinks the decision tape; each replay picks only moves legal in its current state.
    it.effect("U1 names own their rows; replacements and late batches keep the process from the load", () =>
      Effect.gen(function* () {
        const once = (tape: ReadonlyArray<Cell>) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stores = [yield* rig.open, yield* rig.open];
              const names = ["checklist:1", "checklist:2"];
              const live = [1, 2];
              const ran: Array<{ name: string; process: string }> = [];
              const expected: Array<Array<typeof IsolateUsage.Usage.Type>> = [[], []];
              const recordings = yield* Effect.forEach(stores, (store, n) => rig.telemetry(store.sql, names[n] ?? ""), {
                concurrency: 1,
              });
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
                    const recording = recordings[index];

                    if (recording === undefined) {
                      return Effect.die("tail without a receiving object");
                    }

                    return recording.record(usage).pipe(Effect.annotateSpans({ "fab.process": pid(live[index] ?? 1) }));
                  });
                  expected[index]?.push(...events.map(() => sample(called.process, cpu)));
                });
              const check = () => {
                for (const [i, store] of stores.entries()) {
                  expect(
                    rig.rows(store.sql).map((row) => ({
                      process: row.attributes["fab.process"],
                      method: row.attributes["fab.isolate.method"],
                      outcome: row.attributes["fab.isolate.outcome"],
                      cpuMs: Number(BigInt(row.endTimeUnixNano) - BigInt(row.startTimeUnixNano)) / 1_000_000,
                      wallMs: row.attributes["fab.isolate.wall_ms"],
                    })),
                  ).toEqual(expected[i]);
                  expect(rig.rows(store.sql).every((row) => row.resource.attributes["fab.object"] === names[i])).toBe(
                    true,
                  );
                  expect(rig.health(store.sql)).toHaveLength(expected[i]?.length ?? 0);
                }
              };

              for (const cell of tape) {
                // Before anything ran, only a call is possible. Later cells can replace, run, deliver late or reopen.
                const moves = ran.length === 0 ? ["call"] : ["call", "replace", "tail", "reopen"];
                const move = moves[cell.pick % moves.length];
                const n = cell.target % names.length;

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
                    recordings[n] = yield* rig.telemetry(store.sql, names[n] ?? "");
                  }
                } else {
                  const called = ran[cell.target % ran.length];

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
          );
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped SQLite replay
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(once(tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async assertion returns a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40 }));
      }),
    );

    it.effect("U3 fresh and warm sinks commit batches once, recover failed writes and survive reopen", () =>
      Effect.gen(function* () {
        const once = (tape: ReadonlyArray<Cell>, warm: boolean) =>
          Effect.scoped(
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
                const service = yield* rig.telemetry(sql, "checklist:1");

                if (warm) {
                  yield* service.record([sample(pid(1), 0)]);
                }

                let committed = warm ? 1 : 0;
                let held = 0;
                let owed = false;

                for (const cell of tape) {
                  // A fresh sink first loses its table creation in the failed transaction.
                  const moves =
                    held > 0 || owed ? ["flush", "recover"] : committed === 0 ? ["cut"] : ["batch", "cut", "reopen"];
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
                    const before = rig.rows(store.sql).length;
                    yield* service.record(batch);
                    expect(transactions, "one batch is one atomic sink commit").toBe(1);

                    if (move === "cut") {
                      held += count;
                      owed = true;
                      expect(rig.rows(store.sql)).toHaveLength(before);
                    } else {
                      committed += count + held;
                      held = 0;
                    }

                    failAt = null;
                    expect(rig.rows(store.sql)).toHaveLength(committed);
                    expect(rig.health(store.sql)).toHaveLength(committed);
                  }
                }

                if (held > 0) {
                  yield* service.record([sample(pid(1), 0)]);
                  committed += held + 1;
                }

                yield* store.reopen;
                expect(rig.rows(store.sql)).toHaveLength(committed);
                expect(rig.health(store.sql)).toHaveLength(committed);
              });
            }),
          );
        const replay = (tape: ReadonlyArray<Cell>) =>
          Effect.forEach([true, false], (warm) => once(tape, warm), { concurrency: 1, discard: true });
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped SQLite replay
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(replay(tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async assertion returns a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40 }));
      }),
    );

    it.effect("U7 failed, hung and successful usage deliveries leave program answers, receipts and journal alone", () =>
      Effect.gen(function* () {
        const once = (tape: ReadonlyArray<DeliveryCell>) =>
          Effect.scoped(
            Effect.gen(function* () {
              // Both runners see the same controlled clock, including inside fast-check replays.
              yield* TestClock.setTime(0);
              const pendingUsage = yield* Ref.make<Effect.Effect<void, unknown>>(Effect.void);
              const control = yield* rig.runner(Effect.void);
              const measured = yield* rig.runner(Ref.get(pendingUsage).pipe(Effect.flatten));

              for (const [n, cell] of tape.entries()) {
                yield* TestClock.adjust(cell.elapsed);
                const id = `letter-${n}`;
                const behavior = ["ok", "fail", "hang"][cell.pick % 3];
                const before = yield* measured.snapshot;
                const entered = yield* Deferred.make<void>();
                const spans: Array<Tracer.NativeSpan> = [];
                const logs: Array<{ level: string; message: unknown; cause: string; fields: unknown }> = [];
                const logger = Logger.layer([
                  Logger.make((options: Logger.Options<unknown>) => {
                    logs.push({
                      level: options.logLevel,
                      message: (Array.isArray(options.message) ? options.message : [options.message]).map(
                        (value: unknown) =>
                          value instanceof Error
                            ? { name: value.name, message: value.message, stack: value.stack }
                            : value,
                      ),
                      cause: Cause.pretty(options.cause),
                      fields: options.fiber.getRef(References.CurrentLogAnnotations),
                    });
                  }),
                ]);
                const tracer = Tracer.make({
                  span: (options) => {
                    const span = new Tracer.NativeSpan(options);
                    spans.push(span);
                    return span;
                  },
                });
                const response: Effect.Effect<void, unknown> =
                  behavior === "hang"
                    ? Effect.never
                    : behavior === "fail"
                      ? Effect.fail(new TypeError(`PRIVATE_DELIVERY_${cell.error}_END`))
                      : Effect.void;
                const delivery = rig.deliver(
                  { project: "project-test", name: "checklist:1", process: pid(1) },
                  [{ event: { rpcMethod: "step" }, cpuTime: n, wallTime: n + 1, outcome: "ok" }],
                  () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(response)),
                );
                const pending = yield* delivery.pipe(
                  Effect.withTracer(tracer),
                  Effect.provide(logger),
                  Effect.forkScoped,
                );
                // Wait for the actual usage call, so the hung case overlaps the program step.
                yield* Deferred.await(entered);
                yield* Ref.set(pendingUsage, Fiber.join(pending));
                expect(yield* measured.snapshot).toEqual(before);
                const expected = yield* control.step(id, cell.n);
                // A step must answer while its independent usage call is still hung.
                const answer = yield* Effect.raceFirst(
                  measured.step(id, cell.n),
                  TestClock.withLive(Effect.sleep("1 second")).pipe(
                    Effect.andThen(Effect.fail("the step waited for its usage call")),
                  ),
                );
                expect(answer).toEqual(expected);
                expect(yield* measured.snapshot).toEqual(yield* control.snapshot);
                expect(measured.executions()).toBe(control.executions());
                // A resend must still find the same receipt and must not execute again.
                expect(yield* measured.step(id, cell.n)).toEqual(answer);
                expect(measured.executions()).toBe(control.executions());

                if (behavior !== "hang") {
                  yield* Fiber.join(pending);
                  // A3: an unreachable Process leaves one error log at the entrypoint, which has no sink.
                  expect(spans.filter((span) => span.name === "isolate.tail")).toHaveLength(0);
                  expect(logs).toHaveLength(behavior === "fail" ? 1 : 0);

                  if (behavior === "fail") {
                    expect(logs[0]?.level).toBe("Error");
                    expect(JSON.stringify(logs[0])).toContain("TypeError");
                  }

                  expect(
                    JSON.stringify([logs, spans.map((span) => Object.fromEntries(span.attributes))]),
                  ).not.toContain(JSON.stringify(`PRIVATE_DELIVERY_${cell.error}_END`).slice(1, -1));
                }

                yield* Fiber.interrupt(pending);
              }
            }),
          ).pipe(Effect.provide(TestClock.layer()));
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped SQLite replay with its own test clock
        const property = fc.asyncProperty(DeliveryTape, (tape) => Effect.runPromise(once(tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async assertion returns a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40 }));
      }),
    );
  });
