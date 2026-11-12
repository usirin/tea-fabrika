import { describe, expect, it } from "@effect/vitest";
import type { Ci } from "@kampus/libfabrika/ci/Ci";
import { Status } from "@kampus/libfabrika/ci/Ci";
import * as CiTest from "@kampus/libfabrika/ci/CiTest";
import type { CodeHost } from "@kampus/libfabrika/codehost/CodeHost";
import { Change } from "@kampus/libfabrika/codehost/CodeHost";
import * as CodeHostTest from "@kampus/libfabrika/codehost/CodeHostTest";
import { InputId, Writer } from "@kampus/libfabrika/coordination";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import * as ProgramMailLedger from "@kampus/libfabrika/processes/ProgramMailLedger";
import {
  Alarm,
  CheckedWriter,
  type Incoming,
  ProgramLoader,
  Recording,
  WatcherManager,
} from "@kampus/libfabrika/runtime/Entry";
import * as MailDeliveryLive from "@kampus/libfabrika/runtime/MailDeliveryLive";
import { MailWakeups } from "@kampus/libfabrika/runtime/MailWakeups";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import * as RepliesTest from "@kampus/libfabrika/runtime/RepliesTest";
import { ProgramRunner } from "@kampus/libfabrika/runtime/Runner";
import type { Sql } from "@kampus/libfabrika/Sql";
import {
  Cause,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Redacted,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import * as fc from "fast-check";
import { handlers } from "./handlers.ts";
import * as Mail from "./Mail.ts";
import { merger } from "./Merger.ts";
import * as Settings from "./Settings.ts";

export type Saved = { readonly name: string; readonly at: number };

export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  readonly alarms: {
    readonly set: (name: string, at: number | null) => Effect.Effect<void>;
    readonly saved: Effect.Effect<ReadonlyArray<Saved>>;
    readonly take: (alarm: Saved) => Effect.Effect<void>;
  };
};

const NAME = "merger:1";
const BUILD = "merge-law";
const PROCESS = "process_0000000000e008000000000000";
const QUEUE = "process_0000000000e008000000000001";
const SESSION = "process_0000000000e008000000000002";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const owner = Writer.cases.agent.make({ key: "SHA256:law", for: "law" });

const from = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
};

const head = CodeHostTest.commit("a".repeat(40));
const base = CodeHostTest.commit("d".repeat(40));
const checked = CodeHostTest.tree("e".repeat(40));

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: shared runner suite constructs its pure program once
const settings = Effect.runSync(
  Settings.all.parse(
    ConfigProvider.fromUnknown({
      queue: { checks: { rows: [{ name: "check" }], docs: [{ name: "check" }], code: [{ name: "check" }] } },
      merger: { wait: 1, poll: 1, backoff: 4 },
    }),
  ),
);

const program = merger(settings);
type Model = typeof program.machine.model.Type;

const life = Effect.fnUntraced(function* (
  store: Store,
  services: Context.Context<CodeHost | CodeHostTest.Control | Ci | CiTest.Control>,
  scope: Scope.Scope,
) {
  const data = Layer.merge(
    LedgerSql.layer(store.sql("ledger"), { reader: "merge-laws" }),
    LedgerTransactionSql.layer(store.sql("ledger")),
  ).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })));
  let serial = 0;
  const manager = ProcessManager.layer(
    {
      by: from.by,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: SESSION }),
    },
    Effect.sync(() => (serial++ === 0 ? PROCESS : QUEUE)),
  );
  const shared = MailDeliveryLive.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProgramMailLedger.layer({ grants: { [NAME]: ["queue"] } }),
        Layer.succeed(MailWakeups, { wake: () => Effect.void }),
      ),
    ),
    Layer.provideMerge(manager),
    Layer.provideMerge(Mailbox.layer),
    Layer.provideMerge(data),
  );
  const context = yield* Layer.buildWithScope(shared, scope);

  for (const [name, code] of [
    [NAME, "merger"],
    ["queue", "queue"],
  ] as const) {
    const status = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.provide(context), Effect.result);

    if (Result.isFailure(status)) {
      yield* ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program: code, hash: BUILD } }), from),
      ).pipe(Effect.provide(context));
    }
  }

  const checkedWriter = Layer.effect(
    CheckedWriter,
    Effect.gen(function* () {
      const mailbox = yield* Mailbox;
      return {
        append: (i: Incoming) =>
          mailbox.send(NAME, i.id, i.envelope.input, {
            by: i.envelope.by.key,
            for: i.envelope.by.for,
            sentAt: i.sentAt,
            seen: i.seen,
            parent: i.envelope.id,
            traceId: i.span.traceId,
            build: BUILD,
          }),
        commit: () => Effect.die("no writes"),
        own: () => Effect.die("no own command"),
      };
    }),
  );
  const own = Layer.mergeAll(
    ProgramLoader.layer({ merger: program }, handlers).pipe(Layer.provide(Layer.succeedContext(services))),
    ProcessStore.layer(store.sql("process"), { process: PROCESS }),
    Layer.succeed(Alarm, { set: (at: number | null) => store.alarms.set(NAME, at) }),
    Layer.succeed(WatcherManager, { publish: () => Effect.void }),
    Layer.succeed(Recording, { flush: Effect.void }),
    checkedWriter,
  ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
  const built = yield* Layer.buildWithScope(
    ProgramRunner.layer(
      { id: PROCESS, name: NAME, program: "merger", build: BUILD, owner },
      { recovery: { sql: store.sql("recovery"), name: NAME, capacity: 1024 ** 3 } },
    ).pipe(Layer.provide(own)),
    scope,
  );
  const runner = Context.get(built, ProgramRunner);
  const letters = (name: string) =>
    Mailbox.use((m) => Stream.runCollect(m.read(name, 0))).pipe(Effect.provide(context));
  const checkpoint = ProcessStore.use((s) => s.load).pipe(
    Effect.provide(ProcessStore.layer(store.sql("process"), { process: PROCESS })),
  );
  return {
    runner,
    letters,
    checkpoint,
    model: Effect.map(checkpoint, (saved) =>
      saved === null ? null : Schema.decodeUnknownSync(program.machine.model)(saved.saved.model),
    ),
  };
});

const start = Effect.fnUntraced(function* (store: Store, token?: Redacted.Redacted<string>) {
  const options = token === undefined ? {} : { token };
  const services = yield* Layer.build(Layer.merge(CodeHostTest.layer(options), CiTest.layer(options)));
  const host = Context.get(services, CodeHostTest.Control);
  const ci = Context.get(services, CiTest.Control);
  yield* host.main(base);
  yield* host.put({
    ...Change.cases.found.make({ change: 1, head, state: "open", paths: ["src/a.ts"] }),
    base: head,
    tree: checked,
    conflict: null,
  });
  let scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  let current = yield* life(store, services, scope);
  let serial = 0;
  const deliver = (input: unknown) =>
    current.runner.msg({
      id: `incoming-${++serial}`,
      envelope: {
        id: Schema.decodeUnknownSync(InputId)(`input_0000000000e008${serial.toString(16).padStart(12, "0")}`),
        by: owner,
        arrivedAt: serial,
        input,
      },
      sentAt: from.sentAt,
      seen: 0,
      span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
    });
  const reopen = Effect.gen(function* () {
    yield* Scope.close(scope, Exit.void);
    yield* store.reopen;
    scope = yield* Scope.make();
    current = yield* life(store, services, scope);
  });
  const fire = Effect.gen(function* () {
    const alarm = (yield* store.alarms.saved).find((a) => a.name === NAME);
    expect(alarm, "a working merger has a saved alarm").toBeDefined();

    if (alarm !== undefined) {
      yield* store.alarms.take(alarm);
      yield* current.runner.due(alarm.at);
    }
  });
  const green = Effect.gen(function* () {
    const found = yield* host.read(1);
    expect(found?._tag).toBe("found");

    if (found !== undefined) {
      yield* ci.report({
        commit: found.head,
        order: 1,
        run: {
          name: "check",
          source: "push",
          id: "run",
          status: Status.cases.done.make({ conclusion: "success" }),
          startedAt: 0,
          completedAt: 1,
          url: null,
        },
      });
    }
  });
  return {
    host,
    ci,
    services,
    deliver,
    reopen,
    fire,
    green,
    current: () => current,
    land: (ref: string) => deliver(Mail.Land.make({ type: "land", ref, change: 1, head, reply: "queue" })),
  };
});

const replies = Effect.fnUntraced(function* (h: Effect.Success<ReturnType<typeof start>>) {
  return (yield* h.current().letters("queue")).map((letter) => Schema.decodeUnknownSync(Mail.Reply)(letter.m));
});

const finish = Effect.fnUntraced(function* (h: Effect.Success<ReturnType<typeof start>>) {
  for (let i = 0; i < 128; i++) {
    if ((yield* h.current().model)?._tag === "idle") {
      return;
    }

    yield* h.green;
    const result = yield* Fiber.await(yield* Effect.forkChild(h.fire));

    if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
      yield* h.reopen;
    } else if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause);
    }
  }

  expect((yield* h.current().model)?._tag).toBe("idle");
});

const secret = fc
  .tuple(
    fc.constantFrom("ghp_", "github_pat_"),
    fc.stringMatching(/^[A-Z0-9]{32}$/),
    fc.constantFrom("token", "bearer", "url"),
  )
  .map(([prefix, body, form]) => {
    const token = `${prefix}${body}`;
    return {
      token,
      text:
        form === "token"
          ? token
          : form === "bearer"
            ? `Bearer ${token}`
            : `https://invalid.test/auth?access_token=${token}`,
    };
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("the merger on the real Node runner", () => {
    it.effect("scenario: R1 lands one checked change through saved commands and alarms", () =>
      Effect.gen(function* () {
        // Only the runner saves commands, answers and alarms; one change keeps this integration short.
        const store = yield* open;
        const h = yield* start(store);
        yield* h.land("r1");
        expect((yield* h.current().model)?._tag).toBe("checking");
        yield* h.green;
        yield* h.fire;
        const all = yield* replies(h);
        expect(all).toHaveLength(1);
        expect(all[0]?._tag).toBe("merged");
        expect(all[0]?.ref).toBe("r1");
        expect(yield* store.alarms.saved).toEqual([]);
      }),
    );
    it.effect("scenario: R2 reopens while checking and fires the same saved alarm", () =>
      Effect.gen(function* () {
        // Reopen exercises the runner's own database recovery, not a pure reducer's JSON round trip.
        const store = yield* open;
        const h = yield* start(store);
        yield* h.land("r2");
        const before = yield* store.alarms.saved;
        expect(before.length).toBeGreaterThan(0);
        yield* h.reopen;
        expect(yield* store.alarms.saved).toEqual(before);
        yield* h.green;
        yield* h.fire;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(1);
        expect(yield* replies(h)).toHaveLength(1);
      }),
    );
    it.effect("scenario: R3 retries an interrupted merge only at its saved asking deadline", () =>
      Effect.gen(function* () {
        // The handler merged before interruption. Recovery cannot assume it is safe to call it again.
        const store = yield* open;
        const h = yield* start(store);
        yield* h.land("r3");
        yield* h.green;
        yield* h.host.crashMerge;
        const crashed = yield* Effect.forkChild(h.fire);
        const exit = yield* Fiber.await(crashed);
        expect(Exit.isFailure(exit)).toBe(true);
        expect((yield* h.current().model)?._tag).toBe("merging");
        expect((yield* h.host.read(1))?.state).toBe("merged");
        expect(yield* replies(h)).toEqual([]);
        yield* h.reopen;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(1);
        yield* h.fire;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(2);
        expect((yield* replies(h))[0]?._tag).toBe("merged");
        expect((yield* replies(h))[0]?.ref).toBe("r3");
        expect(yield* replies(h)).toHaveLength(1);
      }),
    );
    it.effect("S1: [secrets] generated service failures stay out of every durable record, span and log", () =>
      Effect.gen(function* () {
        type ModelState = { model: Model | null; n: number };
        type Real = { h: Effect.Success<ReturnType<typeof start>>; inspect: Effect.Effect<void, unknown> };
        const command = fc
          .record({ pick: fc.nat(), reason: fc.constantFrom("unavailable", "rate_limited", "refused"), move: fc.nat() })
          .map((cell): fc.AsyncCommand<ModelState, Real> => ({
            check: () => true,
            run: (m, r) =>
              // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each command's Effect
              Effect.runPromise(
                Effect.gen(function* () {
                  const state = yield* r.h.current().model;

                  if (state === null || state._tag === "idle") {
                    yield* r.h.host.fail(
                      "change",
                      cell.pick % 2 === 0 ? { kind: "fault", reason: cell.reason } : { kind: "defect" },
                    );
                    yield* r.h.land(`job${++m.n}`);
                  } else {
                    const possible = [
                      "fire",
                      "reopen",
                      ...(state._tag === "merging" ? [] : ["abandon"]),
                      "fault",
                      "green",
                      "crash",
                    ];
                    const move = possible[cell.move % possible.length];

                    if (move === "reopen") {
                      yield* r.h.reopen;
                    } else if (move === "abandon") {
                      yield* r.h.deliver(Mail.Abandon.make({ type: "abandon", ref: state.job.ref }));
                    } else if (move === "fault") {
                      if (state._tag === "checking" && cell.pick % 3 !== 0) {
                        yield* r.h.ci.fail(
                          "at",
                          cell.pick % 2 === 0
                            ? { kind: "fault", reason: cell.reason === "refused" ? "unavailable" : cell.reason }
                            : { kind: "defect" },
                        );
                      } else {
                        yield* r.h.host.fail(
                          state._tag === "reading"
                            ? cell.pick % 3 === 0
                              ? "update"
                              : "change"
                            : state._tag === "updating"
                              ? "update"
                              : "merge",
                          cell.pick % 2 === 0 ? { kind: "fault", reason: cell.reason } : { kind: "defect" },
                        );
                      }
                    } else if (move === "green") {
                      yield* r.h.green;
                    } else {
                      if (move === "crash") {
                        yield* r.h.green;
                        yield* r.h.host.crashMerge;
                      }

                      const result = yield* Fiber.await(yield* Effect.forkChild(r.h.fire));

                      if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
                        yield* r.h.reopen;
                      } else if (Exit.isFailure(result)) {
                        return yield* Effect.failCause(result.cause);
                      }
                    }
                  }

                  m.model = yield* r.h.current().model;
                  yield* r.inspect;
                }),
              ),
            toString: () => JSON.stringify(cell),
          }));
        const once = Effect.fnUntraced(function* (
          value: typeof secret extends fc.Arbitrary<infer A> ? A : never,
          commands: Iterable<fc.AsyncCommand<ModelState, Real>>,
        ) {
          const captured = RepliesTest.capture();
          const logs: Array<string> = [];
          const logger = Logger.make((options) => {
            logs.push(JSON.stringify(options.message), Cause.pretty(options.cause));
          });
          yield* Effect.gen(function* () {
            const store = yield* open;
            const h = yield* start(store, Redacted.make(value.text));
            yield* h.host.fail("update", { kind: "fault", reason: "unavailable" });
            yield* h.host.fail("update", { kind: "defect" });
            yield* h.ci.fail("at", { kind: "fault", reason: "rate_limited" });
            yield* h.ci.fail("at", { kind: "defect" });
            yield* h.land("initial");
            const inspect = Effect.gen(function* () {
              const letters = [...(yield* h.current().letters(NAME)), ...(yield* h.current().letters("queue"))];
              const checkpoint = yield* h.current().checkpoint;
              RepliesTest.unleaked(
                [JSON.stringify(letters), JSON.stringify(checkpoint), ...captured.text(), ...logs],
                [value.text, value.token, encodeURIComponent(value.text)],
              );
            });
            // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check owns the asynchronous command scheduler
            yield* Effect.promise(() =>
              fc.asyncModelRun(() => ({ model: { model: null, n: 0 }, real: { h, inspect } }), commands),
            );
            // Finish a real checked merge so captures cannot be empty even when the random walk abandoned.
            yield* finish(h);
            const status = yield* h.host.read(1);

            if (status?.state === "open") {
              yield* h.host.put({
                ...Change.cases.found.make({ change: 1, head, state: "open", paths: ["src/a.ts"] }),
                base: head,
                tree: checked,
                conflict: null,
              });
              yield* h.land("finish");
              yield* finish(h);
            }

            yield* inspect;
            const spans = captured.text().join("\n");
            expect(spans).toContain("fab.change");
            expect(spans).toContain("fab.head");
            expect((yield* h.current().letters(NAME)).length).toBeGreaterThan(0);
          }).pipe(Effect.withTracer(captured.tracer), Effect.provide(Logger.layer([logger])));
        });
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check awaits each complete scoped runner flow
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(secret, fc.commands([command], { maxCommands: 24 }), (value, commands) =>
              // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped runner flow
              Effect.runPromise(Effect.scoped(once(value, commands))),
            ),
            { seed: 119120, numRuns: 40 },
          ),
        );
      }),
    );
  });
