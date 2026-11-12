// P41 slices 1 and 2, next/ (tickets 744 and 764): two real runners exchange a request and its answer through durable
// mailboxes, and no driver. A runner in the module that owns a driver calls
// `ProgramMailTest.suite(open)`; `open` acquires real stores and the scoped alarm driver in a scope
// and gives them back when that scope closes (0061, 0062).
//
// The runner, mailbox, ledger transactions, process table and both program machines are real. Time
// moves only when a saved alarm fires, and every fault lands at a reachable boundary: a mail save,
// a send acknowledgement, a wake request. Nothing here calls a runner's `open`: a view is read from
// the process's saved checkpoint, so no window input ever drives the delivery.
//
// The contract these laws pin, beside ProgramMailTest.ts in processes:
//   Send.ts: `SendInput`, `Queued` and the built-in `send` command, `Cmd.make("send", ...)`.
//   MailWakeups.ts: the `MailWakeups` service, `wake(name)`, and its `MailWakeupsError`.
//   MailDeliveryLive.ts: `layer`, a MailDelivery over ProgramMail and MailWakeups.
//   Runner.ts: a runner given MailDelivery runs `send` itself, and `due` drains ordinary mail.
import { Machine } from "@demlik/tea/effect";
import { arbGuidedSequence, propertyInvariant, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  Clock,
  Console,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  References,
  Result,
  Schema,
  Scope,
  Stream,
  Tracer,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { InputId, Writer } from "../coordination/index.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { data as ledger, ids, PIDS, SHUTDOWN } from "../processes/Process.test-support.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { type Grants, ProgramMail } from "../processes/ProgramMail.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { mailRequester, Model as RequesterModel } from "./internal/mailRequester.test-support.ts";
import { mailResponder, Model as ResponderModel } from "./internal/mailResponder.test-support.ts";
import * as MailDeliveryLive from "./MailDeliveryLive.ts";
import { MailWakeups, MailWakeupsError } from "./MailWakeups.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import * as RepliesTest from "./RepliesTest.ts";
import { ProgramRunner } from "./Runner.ts";
import { Queued, send, SendInput } from "./Send.ts";

/** One saved alarm: the name it wakes and when. */
export type Saved = { readonly name: string; readonly at: number };

/** The scoped, controllable alarm driver. A set is saved before it answers, and survives a reopen. */
export type Alarms = {
  readonly set: (name: string, at: number | null) => Effect.Effect<void>;
  readonly saved: Effect.Effect<ReadonlyArray<Saved>>;
  /** Removes one saved alarm as the platform does when it fires. */
  readonly take: (alarm: Saved) => Effect.Effect<void>;
};

/** Real stores. `sql(part)` is one database per part; `reopen` closes and reopens every part. */
export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  readonly alarms: Alarms;
  /** Read after the scope closed: database handles still open, and driver calls after release. */
  readonly probe: { readonly open: () => number; readonly late: () => number };
};

const SEED = 119120;
const joinLimit = "20 seconds";

const completion = <A, E>(fiber: Fiber.Fiber<A, E>, label: string) =>
  Fiber.join(fiber).pipe(
    Effect.timeoutOrElse({
      duration: joinLimit,
      orElse: () =>
        Console.error(`${label}: exceeded ${joinLimit}`).pipe(
          Effect.andThen(Effect.sync(() => expect.fail(`${label}: exceeded ${joinLimit}`))),
        ),
    }),
  );

const BUILD = "p41-build-a";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const GHOST = "ghost:1";
/** The brain's own session: a process ID no start in a walk reaches. */
const DOOR = PIDS.at(-1) ?? "";
const PAIRS = [1, 2] as const;
type Pair = (typeof PAIRS)[number];
const requesterName = (k: Pair) => `requester:${k}`;
const responderName = (k: Pair) => `responder:${k}`;

const REQUESTERS = Object.fromEntries(
  PAIRS.map((k) => [k, mailRequester({ self: requesterName(k), peer: responderName(k) })]),
) as Record<Pair, ReturnType<typeof mailRequester>>;

const TimerModel = Schema.Struct({
  at: Schema.NullOr(Schema.Number),
  ticks: Schema.Array(Schema.Number),
  requests: Schema.Int,
});

const TimerMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("arm"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("crash") }),
  Schema.Struct({ type: Schema.Literal("request"), ref: Schema.String, value: Schema.Int, reply: Schema.String }),
]);

const timerMachine = Machine.make({
  model: TimerModel,
  msg: TimerMsg,
  cmds: [send],
  init: (loaded) => [loaded ?? { at: null, ticks: [], requests: 0 }, []],
  update: {
    arm: (s, m) => [{ ...s, at: m.at }, []],
    timer: (s, m) => [{ ...s, at: null, ticks: [...s.ticks, m.at] }, []],
    request: (s, m) => [
      { ...s, requests: s.requests + 1 },
      [send({ to: m.reply, m: { type: "answer", ref: m.ref, value: m.value + 1 } })],
    ],
    crash: () => {
      throw new TypeError("timer fixture crash");
    },
    send_ok: (s) => [s, []],
    send_err: (s) => [s, []],
  },
});

const timerProgram = Program.make({
  name: "mail-timer",
  machine: timerMachine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse: () => null,
  inputs: { arm: "Arm", request: "Request", crash: "Crash" },
  outputs: {},
  writes: {},
  wake: (s) => s.at,
});

const alarmPolicy = {
  maxDeliveries: 1,
  intensity: 2,
  periodMs: 10_000,
  backoff: { minMs: 10, maxMs: 10, resetAfterMs: 10_000 },
};

const PROGRAMS: Record<string, unknown> = {
  ...Object.fromEntries(PAIRS.map((k) => [REQUESTERS[k].name, REQUESTERS[k]])),
  [mailResponder.name]: mailResponder,
  [timerProgram.name]: timerProgram,
};

/** The host's closed grant: each requester reaches its own responder and a missing name; each
 *  responder reaches its own requester. */
const GRANTS: Grants = Object.fromEntries(
  PAIRS.flatMap((k) => [
    [requesterName(k), [responderName(k), GHOST]],
    [responderName(k), [requesterName(k)]],
  ]),
);

const person = Writer.cases.person.make({ key: "SHA256:person", for: PERSON });
const owner = Writer.cases.agent.make({ key: "SHA256:owner", for: PERSON });

const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e008${n.toString(16).padStart(12, "0")}`);

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const decodeRequester = Schema.decodeUnknownOption(RequesterModel);
const decodeResponder = Schema.decodeUnknownOption(ResponderModel);
const Body = Schema.Struct({ type: Schema.String, ref: Schema.optionalKey(Schema.String) });
const decodeBody = Schema.decodeUnknownOption(Body);

/** One tape cell: which move, which pair or alarm, a value, and which bad shape. */
const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  value: fc.oneof(
    { weight: 9, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
    { weight: 1, arbitrary: fc.integer({ min: -5, max: -1 }) },
  ),
  shape: fc.nat(),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
const Tape = fc.array(Cell, { minLength: 6, maxLength: 24, size: "max" });

const records = (secrets: ReadonlyArray<string>, trace: boolean) => {
  const captured = RepliesTest.capture();
  const spans: Array<Tracer.Span> = [];
  const errors: Array<string> = [];
  const logs: Array<string> = [];
  const wakes: Array<{ span: string; name: string; at: number | null }> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = captured.tracer.span(options);
      spans.push(span);
      return span;
    },
  });
  const logger = Logger.layer([
    Logger.make((options) => {
      // Effect 4 keeps a line's annotations on its fiber; a logger that throws would hide the line.
      const plain = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
      logs.push(
        JSON.stringify(options.message, plain),
        JSON.stringify(options.fiber.getRef(References.CurrentLogAnnotations), plain),
        Cause.pretty(options.cause),
      );
    }),
  ]);
  const check = () => {
    RepliesTest.unleaked([...captured.text(), ...logs, ...errors], secrets);

    if (!trace) {
      return;
    }

    for (const span of spans) {
      if (span.name !== "mail_delivery.send" || span.status._tag !== "Ended" || !Exit.isSuccess(span.status.exit)) {
        continue;
      }

      const queued = Schema.decodeUnknownSync(Queued)(span.status.exit.value);
      expect(span.attributes.get("fab.mail.receipt"), "T1a: queued is tied to its receipt").toBe(queued.id);
      const wake = wakes.find((w) => w.span === span.spanId);
      expect(wake, "T1a: every queued Send saved its target alarm").toBeDefined();
      expect(span.attributes.get("fab.mail.to")).toBe(wake?.name);
      const children = spans.filter(
        (s) => s.name === "runner.mailed" && Option.getOrUndefined(s.parent)?.spanId === span.spanId,
      );
      expect(children).toHaveLength(1);
      expect(children[0]?.attributes.get("fab.mail.to")).toBe(wake?.name);
      expect(children[0]?.attributes.get("fab.mail.alarm")).toBe(wake?.at);
    }
  };
  return { secrets, tracer, logger, errors, wakes, check, spans };
};

type Move =
  | "start"
  | "start_forbidden"
  | "start_missing"
  | "cut_mail"
  | "lose_ack"
  | "fail_wake"
  | "fire"
  | "forge"
  | "stale_answer"
  | "restart"
  | "stop"
  | "stall"
  | "settle"
  | "reopen"
  | "evict"
  | "wakeDuringDrain"
  | "holdAlarm";

/** What one request is for: an ordinary one, one aimed at a forbidden name while claiming a granted
 *  sender, or one aimed at a missing name. */
type Request = {
  readonly ref: string;
  readonly value: number;
  readonly kind: "normal" | "forbidden" | "missing";
  readonly to: string;
};

/** What the fold knows, from its own moves only: never read back from the product, except which
 *  letters an inbox holds after a call whose outcome a fault made unknown. */
type World = {
  readonly records?: ReturnType<typeof records>;
  readonly timers?: boolean;
  /** Each requester's current request, once its start letter is in its inbox. */
  readonly current: Map<Pair, Request>;
  /** Every ref each requester ever asked for, for stale answers. */
  readonly history: Map<Pair, Array<string>>;
  /** Responders a brain exit stopped and no restart has replaced. */
  readonly stopped: Set<Pair>;
  /** Responders whose wake hangs until the walk releases it. */
  readonly stalled: Map<Pair, Deferred.Deferred<void>>;
  readonly holds: Map<string, { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }>;
  readonly reached: Set<Pair>;
  readonly wakes: Map<string, Deferred.Deferred<void>>;
  readonly wakeTimes: Map<string, number>;
  readonly fault: { mail: boolean; ack: boolean; wake: boolean };
  /** Requests started while their pair's wake hangs, run in the background. */
  readonly background: Array<Fiber.Fiber<unknown, unknown>>;
  /** Refs whose value was negative: the responder refuses them. */
  readonly negative: Set<string>;
  /** Responders some restart replaced, whose saved model starts again. */
  readonly restarted: Set<Pair>;
  /** The ref whose answer letter was already in its requester's inbox when its responder stopped. */
  readonly answeredAtStop: Map<Pair, string>;
  /** Delivery IDs of the mail the walk forged as another program. */
  readonly forgedIds: Set<string>;
  forged: number;
  n: number;
};

/** The public JSON a client sends or reads, written out by hand because the shape itself is the law. */
const wire = (tag: string, fields: object): unknown =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- format: L13 pins the encoded JSON other clients decode
  ({ _tag: tag, ...fields });

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** The ledger's Sql, with the two cuts a send can meet: its mail save and its acknowledgement. */
const faulting = (sql: Sql, fault: World["fault"]) => {
  const strings = (params: ReadonlyArray<SqlValue>) => params.filter((p): p is string => typeof p === "string");
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (/^\s*INSERT\b/i.test(query)) {
        const text = strings(params);

        if (fault.mail && text.some((p) => p.endsWith("/mail"))) {
          fault.mail = false;
          throw new Error("SQLITE_FULL planted at the mail save");
        }

        if (fault.ack && text.some((p) => p.endsWith("/answer")) && text.some((p) => p.includes('"send_ok"'))) {
          fault.ack = false;
          throw new Error("SQLITE_FULL planted at the send acknowledgement");
        }
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return wrapped;
};

/**
 * One life of the whole host: the shared ledger, process table, program mail and wakes, and one runner
 * per name, all in `scope`. Closing the scope is the host going away; the stores keep their rows.
 */
const host = Effect.fnUntraced(function* (store: Store, world: World, next: Effect.Effect<string>, scope: Scope.Scope) {
  const ledgerSql = faulting(store.sql("ledger"), world.fault);
  const data = ledger(ledgerSql);
  const manager = ProcessManager.layer(
    {
      by: "SHA256:brain",
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: DOOR }),
    },
    next,
  );
  const runners = new Map<string, ProgramRunner["Service"]>();
  const wakeups = Layer.succeed(MailWakeups, {
    wake: (name: string) =>
      Effect.gen(function* () {
        const pair = PAIRS.find((k) => responderName(k) === name || requesterName(k) === name);
        const stall = pair === undefined ? undefined : world.stalled.get(pair);

        if (stall !== undefined && name === responderName(pair as Pair)) {
          world.reached.add(pair as Pair);
          yield* Deferred.await(stall);
        }

        if (world.fault.wake) {
          world.fault.wake = false;
          return yield* new MailWakeupsError({ reason: "unavailable" });
        }

        const target = runners.get(name);

        if (target === undefined) {
          return yield* Effect.die(`no runner for ${name}`);
        }

        world.wakeTimes.set(name, yield* Clock.currentTimeMillis);
        const entered = world.wakes.get(name);

        if (entered !== undefined) {
          yield* Deferred.succeed(entered, undefined);
        }

        yield* target.mailed.pipe(Effect.mapError((cause) => new MailWakeupsError({ reason: "unavailable", cause })));

        if (world.records !== undefined) {
          const span = yield* Effect.currentSpan.pipe(Effect.orDie);
          world.records.wakes.push({
            span: span.spanId,
            name,
            at: (yield* store.alarms.saved).find((a) => a.name === name)?.at ?? null,
          });
        }
      }),
  });
  const shared = MailDeliveryLive.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProgramMailLedger.layer({
          grants: {
            ...GRANTS,
            ...Object.fromEntries(
              (world.records?.secrets ?? []).map((secret) => [`decoy-${secret}`, [`unused-${secret}`]]),
            ),
          },
        }),
        wakeups,
      ),
    ),
    Layer.provideMerge(manager),
    Layer.provideMerge(Mailbox.layer),
    Layer.provideMerge(data),
  );
  const context = yield* Layer.buildWithScope(shared, scope);
  const boot = Effect.fnUntraced(function* (name: string, program: string) {
    const status = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.result);

    if (Result.isSuccess(status)) {
      return status.success.state.process;
    }

    const started = yield* ProcessManager.use((p) =>
      p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), brainFrom()),
    ).pipe(Effect.orDie);
    return started.process;
  });
  const names: ReadonlyArray<readonly [string, string]> = PAIRS.flatMap((k) => [
    [requesterName(k), REQUESTERS[k].name] as const,
    [responderName(k), world.timers ? timerProgram.name : mailResponder.name] as const,
  ]);

  for (const [name, program] of names) {
    const pid = yield* boot(name, program).pipe(Effect.provide(context));
    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return {
          append: (i: Incoming) =>
            mailbox.send(name, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build: BUILD,
            }),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        };
      }),
    );
    const own = Layer.mergeAll(
      ProgramLoader.layer(PROGRAMS, {}),
      ProcessStore.layer(store.sql(`process-${name}`), { process: pid }),
      Layer.succeed(Alarm, {
        set: (at: number | null) =>
          Effect.gen(function* () {
            const hold = world.holds.get(name);

            if (hold !== undefined) {
              world.holds.delete(name);
              yield* Deferred.succeed(hold.entered, undefined);
              yield* Deferred.await(hold.release);
            }

            yield* store.alarms.set(name, at);
          }),
      }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const runner = ProgramRunner.layer(
      { id: pid, name, program, build: BUILD, owner },
      {
        ...(world.timers ? { policy: alarmPolicy } : {}),
        recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 },
      },
    ).pipe(Layer.provide(own));
    const built = yield* Layer.buildWithScope(runner, scope);
    runners.set(name, Context.get(built, ProgramRunner));
  }

  return { context, runners };
});

/** A process's saved model: what its view is made from, read without asking the runner. */
const savedModel = Effect.fnUntraced(function* (store: Store, name: string) {
  const status = yield* ProcessManager.use((p) => p.status(name));
  const saved = yield* ProcessStore.use((s) => s.load).pipe(
    Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process: status.state.process })),
  );
  return saved?.saved.model ?? null;
});

/**
 * Folds one tape through two or four real runners. Each cell reads the world the fold has reached and
 * picks a move possible there; the invariants hold at every prefix, and once every fault is cleared
 * and every saved alarm has fired, each request has the end its kind gives it.
 */
const walk = (
  law: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  pairs: ReadonlyArray<Pair>,
  moves: ReadonlyArray<Move>,
  done: Set<Move>,
  recorded?: ReturnType<typeof records>,
) =>
  Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: World = {
      ...(recorded === undefined ? {} : { records: recorded }),
      current: new Map(),
      history: new Map(),
      stopped: new Set(),
      stalled: new Map(),
      holds: new Map(),
      reached: new Set(),
      wakes: new Map(),
      wakeTimes: new Map(),
      fault: { mail: false, ack: false, wake: false },
      background: [],
      negative: new Set(),
      restarted: new Set(),
      answeredAtStop: new Map(),
      forgedIds: new Set(),
      forged: 0,
      n: 0,
    };
    let scope = yield* Scope.make();
    let life = yield* host(store, world, next.next, scope);
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const inContext = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(life.context));
    const runner = (name: string) => {
      const found = life.runners.get(name);

      if (found === undefined) {
        throw new Error(`no runner for ${name}`);
      }

      return found;
    };
    const letters = (name: string) => inContext(Mailbox.use((m) => Stream.runCollect(m.read(name, 0))));
    const bodies = (name: string) =>
      Effect.map(letters(name), (all) =>
        all.flatMap((l) => Option.toArray(Option.map(decodeBody(l.m), (b) => ({ id: l.id, ...b })))),
      );
    /** A call that may fail at a planted boundary; it must still answer, never hang. */
    const call = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
      effect.pipe(
        Effect.onError((cause) =>
          Effect.sync(() => {
            recorded?.errors.push(
              String(Cause.squash(cause)),
              JSON.stringify(Cause.squash(cause)),
              Cause.pretty(cause),
            );
          }),
        ),
        Effect.result,
        Effect.timeoutOption("20 seconds"),
        Effect.map((answer) => {
          expect(Option.isSome(answer), `${label} answers: no other recipient's stall holds it`).toBe(true);
          return answer;
        }),
      );
    const pairFor = (name: string): Pair | undefined =>
      pairs.find((k) => requesterName(k) === name || responderName(k) === name);
    /** Fires every saved alarm until none is left, or only those of stalled pairs. */
    const settle = Effect.fnUntraced(function* (skip: ReadonlySet<Pair>) {
      for (let round = 0; round < 64; round++) {
        const due = (yield* store.alarms.saved).filter((a) => {
          const k = pairFor(a.name);
          return k !== undefined && !skip.has(k);
        });

        if (due.length === 0) {
          return;
        }

        for (const alarm of due) {
          yield* store.alarms.take(alarm);
          const now = yield* Clock.currentTimeMillis;
          yield* call(runner(alarm.name).due(Math.max(now, alarm.at)), `${alarm.name}'s alarm`);
        }
      }
    });
    const requesterState = (k: Pair) =>
      Effect.map(inContext(savedModel(store, requesterName(k))), (m) => Option.getOrNull(decodeRequester(m)));
    const deliverAs = Effect.fnUntraced(function* (source: string, to: string, m: unknown) {
      const status = yield* inContext(ProcessManager.use((p) => p.status(source)));
      const command = `${status.state.process}/${1_000_000 + ++world.forged}/0`;
      world.forgedIds.add(`${command}/mail`);
      return yield* inContext(
        ProgramMail.use((mail) =>
          mail.deliver({
            command,
            source: { name: source, process: status.state.process },
            to,
            m,
            from: { ...brainFrom(), by: owner.key, for: owner.for, parent: null },
          }),
        ),
      ).pipe(Effect.result);
    });

    const checkpoint = Effect.fnUntraced(function* (name: string) {
      const status = yield* inContext(ProcessManager.use((p) => p.status(name)));
      return yield* ProcessStore.use((s) => s.load).pipe(
        Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process: status.state.process })),
        Effect.provide(life.context),
      );
    });

    /** The command ids of every Send the name's saved checkpoint still owes. */
    const owedIds = (name: string) =>
      Effect.map(checkpoint(name), (saved) =>
        (saved?.cmds ?? []).flatMap((cmd) =>
          Schema.is(Schema.Struct({ id: Schema.String, mail: Schema.Literal(true) }))(cmd) ? [cmd.id] : [],
        ),
      );
    const owed = (name: string) => Effect.map(owedIds(name), (ids) => ids.length > 0);

    /** The invariants every prefix keeps. */
    const check = Effect.fnUntraced(function* () {
      recorded?.check();

      for (const k of pairs) {
        if (moves.includes("wakeDuringDrain")) {
          for (const name of [requesterName(k), responderName(k)]) {
            const saved = yield* checkpoint(name);
            const unread = (yield* letters(name)).some((letter) => letter.rev > (saved?.saved.after ?? 0));

            if (unread) {
              expect(
                (yield* store.alarms.saved).some((alarm) => alarm.name === name),
                "M1: unread mail keeps its recipient's alarm",
              ).toBe(true);
            }
          }
        }

        if (moves.includes("evict")) {
          for (const name of [requesterName(k), responderName(k)]) {
            if (yield* owed(name)) {
              expect(
                (yield* store.alarms.saved).some((a) => a.name === name),
                `S1: ${name}'s saved Send keeps a saved alarm`,
              ).toBe(true);
            }
          }
        }

        const state = yield* requesterState(k);
        const asked = world.history.get(k) ?? [];
        const answers = (yield* bodies(requesterName(k))).filter(
          (b) => b.type === "answer" && !world.forgedIds.has(b.id),
        );
        const requests = (yield* bodies(responderName(k))).filter(
          (b) => b.type === "request" && !world.forgedIds.has(b.id) && asked.includes(b.ref ?? ""),
        );
        const refs = requests.map((r) => r.ref);
        expect(new Set(refs).size, `L3: one request letter per command in ${responderName(k)}`).toBe(refs.length);
        const answered = answers.map((a) => a.ref);
        expect(new Set(answered).size, `L3: one answer letter per command in ${requesterName(k)}`).toBe(
          answered.length,
        );

        if (state?._tag === "answered") {
          const current = world.current.get(k);
          expect(state.ref, "L9: only the current reference completes a request").toBe(current?.ref);
          expect(state.value, "L1: the answer is the responder's successor of the asked value").toBe(
            (current?.value ?? Number.NaN) + 1,
          );
          expect(
            answers.some((a) => a.ref === state.ref && a.id.endsWith("/mail")),
            "L2: a request completes only by its answer letter, never by `queued`",
          ).toBe(true);
        }
      }
    });

    for (const k of pairs) {
      world.history.set(k, []);
    }

    for (const cell of tape) {
      // A requester takes a new request only once its last one has ended: it holds one at a time.
      const idle: Array<Pair> = [];

      for (const k of pairs) {
        const state = yield* requesterState(k);

        if (state === null || state._tag !== "waiting") {
          idle.push(k);
        }
      }

      const can: Record<Move, boolean> = {
        start: idle.length > 0,
        start_forbidden: idle.length > 0 && pairs.length > 1,
        start_missing: idle.length > 0,
        cut_mail: !world.fault.mail,
        lose_ack: !world.fault.ack,
        fail_wake: !world.fault.wake,
        fire: (yield* store.alarms.saved).some((a) => {
          const k = pairFor(a.name);
          return k !== undefined && !world.stalled.has(k);
        }),
        forge: true,
        stale_answer: pairs.some((k) => (world.history.get(k) ?? []).length > 0),
        restart: true,
        stop: pairs.some((k) => !world.stopped.has(k)),
        stall: world.stalled.size === 0 && pairs.length > 1,
        settle: true,
        reopen: world.stalled.size === 0,
        evict: world.reached.size > 0 && world.background.length > 0,
        wakeDuringDrain:
          idle.some((k) => !world.stopped.has(k)) &&
          world.stalled.size === 0 &&
          !world.fault.mail &&
          !world.fault.ack &&
          !world.fault.wake,
        holdAlarm:
          idle.some((k) => !world.stopped.has(k)) &&
          world.stalled.size === 0 &&
          !world.fault.mail &&
          !world.fault.ack &&
          !world.fault.wake,
      };
      const options = moves.filter((move) => can[move]);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);

      switch (move) {
        case "start":
        case "start_forbidden":
        case "start_missing":
        case "wakeDuringDrain":
        case "holdAlarm": {
          const k = choose(
            move === "wakeDuringDrain" || move === "holdAlarm" ? idle.filter((p) => !world.stopped.has(p)) : idle,
            cell.pick,
          );
          const other = pairs.find((p) => p !== k) ?? k;
          const ref = `${recorded?.secrets[k - 1] ?? "ref"}-${k}-${++world.n}`;
          const kind =
            move === "start" || move === "wakeDuringDrain" || move === "holdAlarm"
              ? "normal"
              : move === "start_forbidden"
                ? "forbidden"
                : "missing";
          const input =
            kind === "normal"
              ? { type: "start", ref, value: cell.value }
              : kind === "forbidden"
                ? // Aimed at the other requester, claiming to be that requester's own responder.
                  { type: "start", ref, value: cell.value, to: requesterName(other), claim: responderName(other) }
                : { type: "start", ref, value: cell.value, to: GHOST };
          const incoming: Incoming = {
            id: `letter-${world.n}`,
            envelope: { id: inputId(world.n), by: person, arrivedAt: 1794099600000 + world.n, input },
            sentAt: "2026-11-11T01:00:00Z",
            seen: 0,
            span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
          };
          const work = runner(requesterName(k)).msg(incoming);

          if (move === "wakeDuringDrain" || move === "holdAlarm") {
            const name = responderName(k);
            yield* runner(name).due(yield* Clock.currentTimeMillis);
            const hold = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
            const arrived = yield* Deferred.make<void>();
            world.holds.set(name, hold);
            world.wakes.set(name, arrived);
            const now = yield* Clock.currentTimeMillis;
            const clock = yield* Clock.Clock;
            // Keep wall time fixed across the held storage call; deadline sleeps still use the live clock.
            const frozen: Clock.Clock = {
              currentTimeMillisUnsafe: () => now,
              currentTimeMillis: Effect.succeed(now),
              currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
              currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              sleep: (duration) => clock.sleep(duration),
            };
            const drain =
              move === "wakeDuringDrain"
                ? yield* Effect.forkChild(runner(name).due(now).pipe(Effect.provideService(Clock.Clock, frozen)))
                : null;

            if (drain !== null) {
              yield* Deferred.await(hold.entered).pipe(Effect.timeout("5 seconds"));
            }

            const sending = yield* Effect.forkChild(work.pipe(Effect.provideService(Clock.Clock, frozen)));
            yield* Deferred.await(arrived).pipe(Effect.timeout("5 seconds"));

            if (drain === null) {
              yield* Deferred.await(hold.entered).pipe(Effect.timeout("5 seconds"));
            }

            // Give the call a scheduler turn to attempt the permit or awaited storage.
            yield* Effect.yieldNow;
            expect(sending.pollUnsafe(), "M1, M4: queued waits for the target to save its alarm").toBeUndefined();
            yield* Deferred.succeed(hold.release, undefined);

            if (drain !== null) {
              yield* completion(drain, `${law}: drain completion for ${name}`);
            }

            yield* completion(sending, `${law}: sending completion for ${requesterName(k)}`);
            world.wakes.delete(name);
            const alarm = (yield* store.alarms.saved).find((a) => a.name === name);
            expect(alarm, "M1, M4: the wake behind the drain saves the next alarm").toBeDefined();
            expect(alarm?.at).toBeLessThanOrEqual(world.wakeTimes.get(name) ?? Number.NaN);
          } else if (world.stalled.has(k)) {
            const background = yield* Effect.forkChild(work.pipe(Effect.result));
            world.background.push(background);

            // The fork is only scheduled: let it run until its start letter lands, before the stalled wake.
            for (let turn = 0; turn < 1000; turn++) {
              if (world.reached.has(k) || background.pollUnsafe() !== undefined) {
                break;
              }

              yield* Effect.yieldNow;
            }
          } else {
            const healthy = !world.fault.mail && !world.fault.ack && !world.fault.wake;
            // An earlier Send whose answer was lost stays owed until its own alarm: S1 keeps that one.
            const before = yield* owedIds(requesterName(k));
            yield* call(work, `${requesterName(k)}'s start`);

            if (moves.includes("evict") && healthy) {
              const after = yield* owedIds(requesterName(k));
              expect(
                after.filter((id) => !before.includes(id)),
                "S2: the completed Send is no longer owed",
              ).toEqual([]);

              if (after.length === 0) {
                expect(
                  (yield* store.alarms.saved).filter((a) => a.name === requesterName(k)),
                  "S2: the last Send's answer removes its retry alarm",
                ).toEqual([]);
              }
            }
          }

          if ((yield* letters(requesterName(k))).some((l) => l.id === incoming.id)) {
            const to = kind === "normal" ? responderName(k) : kind === "forbidden" ? requesterName(other) : GHOST;
            world.current.set(k, { ref, value: cell.value, kind, to });
            world.history.get(k)?.push(ref);

            if (cell.value < 0) {
              world.negative.add(ref);
            }
          }

          break;
        }
        case "cut_mail":
          world.fault.mail = true;
          break;
        case "lose_ack":
          world.fault.ack = true;
          break;
        case "fail_wake":
          world.fault.wake = true;
          break;
        case "fire": {
          const alarm = choose(
            (yield* store.alarms.saved).filter((a) => {
              const k = pairFor(a.name);
              return k !== undefined && !world.stalled.has(k);
            }),
            cell.pick,
          );
          yield* store.alarms.take(alarm);
          const now = yield* Clock.currentTimeMillis;
          yield* call(runner(alarm.name).due(Math.max(now, alarm.at)), `${alarm.name}'s alarm`);
          break;
        }
        case "forge": {
          // Mail another program could send: it takes the recipient's ordinary admission.
          const k = choose(pairs, cell.pick);
          const ref = `forged-${++world.forged}`;
          const shapes: ReadonlyArray<unknown> = [
            { type: "request", value: cell.value, reply: requesterName(k) },
            { type: "approve" },
            { type: "request", ref, value: Math.abs(cell.value), reply: requesterName(k), parent: `in-${PIDS[0]}-1` },
            { type: "unknown", ref },
            {
              type: "send_ok",
              cmd: { type: "send", to: requesterName(k), m: {} },
              value: Queued.make({ id: ref }),
              at: 0,
            },
          ];
          yield* deliverAs(requesterName(k), responderName(k), choose(shapes, cell.shape));
          break;
        }
        case "stale_answer": {
          const k = choose(
            pairs.filter((p) => (world.history.get(p) ?? []).length > 0),
            cell.pick,
          );
          const current = world.current.get(k)?.ref;
          const old = (world.history.get(k) ?? []).filter((r) => r !== current);
          const state = yield* requesterState(k);
          // A repeat of the current answer, only once it is answered; else an old or an unknown ref.
          const ref =
            state?._tag === "answered" && cell.shape % 3 === 1
              ? state.ref
              : old.length > 0 && cell.shape % 3 !== 0
                ? choose(old, cell.shape)
                : `unknown-${++world.forged}`;
          yield* deliverAs(responderName(k), requesterName(k), { type: "answer", ref, value: cell.value });
          break;
        }
        case "restart": {
          const k = choose(pairs, cell.pick);
          yield* call(
            runner(responderName(k)).restart({ id: `restart-${k}-${++world.n}`, build: BUILD }),
            `${responderName(k)}'s restart`,
          );
          world.stopped.delete(k);
          world.restarted.add(k);
          break;
        }
        case "stop": {
          const k = choose(
            pairs.filter((p) => !world.stopped.has(p)),
            cell.pick,
          );
          const current = world.current.get(k)?.ref;
          const reached = (yield* bodies(requesterName(k))).some(
            (b) => b.type === "answer" && b.ref === current && !world.forgedIds.has(b.id),
          );

          if (current !== undefined && reached) {
            world.answeredAtStop.set(k, current);
          }

          const status = yield* inContext(ProcessManager.use((p) => p.status(responderName(k))));
          yield* inContext(ProcessManager.use((p) => p.exit(status.state.process, SHUTDOWN, brainFrom()))).pipe(
            Effect.result,
          );
          world.stopped.add(k);
          break;
        }
        case "stall": {
          const k = choose(pairs, cell.pick);
          world.stalled.set(k, yield* Deferred.make<void>());
          break;
        }
        case "settle": {
          const skip = new Set(world.stalled.keys());
          yield* settle(skip);

          // L10: every pair whose recipient is available has finished, whatever the stalled one does.
          if (!world.fault.mail && !world.fault.ack && !world.fault.wake) {
            for (const k of pairs) {
              const current = world.current.get(k);

              if (skip.has(k) || world.stopped.has(k) || current?.kind !== "normal" || current.value < 0) {
                continue;
              }

              const state = yield* requesterState(k);
              expect(state, `L10: ${requesterName(k)} finished while another recipient was unavailable`).toEqual(
                RequesterModel.cases.answered.make({ ref: current.ref, value: current.value + 1 }),
              );
            }
          }

          break;
        }
        case "evict": {
          // The wake is held after the receipt and letter were saved. Interrupt only the
          // test's Send fibers, then discard the runners; the databases and alarms survive.
          for (const fiber of world.background.splice(0)) {
            yield* Fiber.interrupt(fiber);
          }

          for (const stall of world.stalled.values()) {
            yield* Deferred.succeed(stall, undefined);
          }

          world.stalled.clear();
          world.reached.clear();
          yield* Scope.close(scope, Exit.void);
          yield* store.reopen;
          scope = yield* Scope.make();
          life = yield* host(store, world, next.next, scope);
          break;
        }
        case "reopen": {
          yield* Scope.close(scope, Exit.void);
          yield* store.reopen;
          scope = yield* Scope.make();
          life = yield* host(store, world, next.next, scope);
          break;
        }
      }

      done.add(move);
      yield* check();
    }

    // Every fault cleared and every stall released: saved work resumes from its saved alarms alone.
    world.fault.mail = false;
    world.fault.ack = false;
    world.fault.wake = false;

    for (const stall of world.stalled.values()) {
      yield* Deferred.succeed(stall, undefined);
    }

    world.stalled.clear();

    for (const [index, fiber] of world.background.entries()) {
      yield* completion(fiber, `${law}: background Send completion for fiber ${index}`);
    }

    for (let round = 0; round < 4; round++) {
      yield* settle(new Set());
    }

    yield* check();

    for (const k of pairs) {
      const current = world.current.get(k);
      const state = yield* requesterState(k);

      if (current === undefined) {
        continue;
      }

      const answered = RequesterModel.cases.answered.make({ ref: current.ref, value: current.value + 1 });
      const waiting = RequesterModel.cases.waiting.make({ ref: current.ref });

      if (current.kind === "forbidden") {
        expect(state, "L8: a forbidden destination is refused, whatever sender the command claims").toEqual(
          RequesterModel.cases.failed.make({ ref: current.ref, reason: "forbidden" }),
        );
        const reached = (yield* bodies(current.to)).filter((b) => b.ref === current.ref);
        expect(reached, "L8: no forbidden delivery reaches its destination").toEqual([]);
      } else if (current.kind === "missing") {
        expect(state, "L8: a missing name is a typed refusal").toEqual(
          RequesterModel.cases.failed.make({ ref: current.ref, reason: "no_name" }),
        );
      } else if (current.value < 0) {
        expect(state, "the responder refused it: no business answer is invented").toEqual(waiting);
      } else if (world.stopped.has(k)) {
        // An answer already in the requester's inbox before the stop is still its answer.
        expect(state, "L6: a stopped recipient keeps the letter and is not started by a send").toEqual(
          world.answeredAtStop.get(k) === current.ref ? answered : waiting,
        );
        const status = yield* inContext(ProcessManager.use((p) => p.status(responderName(k))));
        expect(status.state._tag, "L6: a send never restarts a stopped application").toBe("ended");
      } else {
        expect(state, "L1, L4: once reachable work completes, the requester holds its answer").toEqual(answered);
      }

      // L3: each command reached its recipient once, however often its delivery was retried.
      const answers = (yield* bodies(requesterName(k))).filter(
        (b) => b.type === "answer" && b.ref === current.ref && !world.forgedIds.has(b.id),
      );
      expect(answers.length, `L3: at most one answer letter for ${current.ref}`).toBeLessThanOrEqual(1);
    }

    for (const k of pairs) {
      if (world.stopped.has(k) || world.restarted.has(k)) {
        continue;
      }

      // L7: only admitted requests stepped the responder; forged and malformed mail did not.
      const model = Option.getOrNull(decodeResponder(yield* inContext(savedModel(store, responderName(k)))));
      const asked = world.history.get(k) ?? [];
      const admitted = new Set(
        (yield* bodies(responderName(k)))
          .filter((b) => b.type === "request" && !world.forgedIds.has(b.id))
          .flatMap((b) => (b.ref !== undefined && asked.includes(b.ref) && !world.negative.has(b.ref) ? [b.ref] : [])),
      );
      expect(
        model?.answered ?? 0,
        `L7: ${responderName(k)} stepped once per admitted request, never for other mail`,
      ).toBe(admitted.size);
    }

    return store.probe;
  });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  pairs: ReadonlyArray<Pair>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Move>,
  runs = 40,
  examples: ReadonlyArray<ReadonlyArray<Cell>> = [],
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Move>();
        const law = walk(name, open, pairs, moves, done);
        const once = Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
          const probe = yield* Effect.scoped(law(tape));
          // L12: once the scope is gone, nothing it opened is still open or still running.
          yield* Effect.sleep("20 millis");
          expect(probe.open(), "L12: every database handle closed with its scope").toBe(0);
          expect(probe.late(), "L12: no alarm task set an alarm after its scope closed").toBe(0);
        });
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(once(tape)));
        const options = {
          seed: SEED,
          numRuns: runs,
          examples: examples.map((tape) => [[...tape]]),
          includeErrorInReport: true,
        };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, options));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    // CI max S1/S2 19.7 s, runs 43239450301, 43235822398, 43234969237: ceil(2 * 19.7) s.
    40_000,
  );

const alarmLaw = (open: Effect.Effect<Store, never, Scope.Scope>, stopped: boolean) =>
  it.effect(
    stopped
      ? "M3: mailed neither starts a stopped name nor keeps its mail alarm alive"
      : "M2: one alarm keeps the earliest timer, mail wake and owed Send",
    () =>
      Effect.gen(function* () {
        const visited = new Set<string>();
        const once = Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
          const store = yield* open;
          const world: World = {
            timers: true,
            current: new Map(),
            history: new Map(),
            stopped: new Set(),
            stalled: new Map(),
            holds: new Map(),
            reached: new Set(),
            wakes: new Map(),
            wakeTimes: new Map(),
            fault: { mail: false, ack: false, wake: false },
            background: [],
            negative: new Set(),
            restarted: new Set(),
            answeredAtStop: new Map(),
            forgedIds: new Set(),
            forged: 0,
            n: 0,
          };
          const next = ids(...PIDS);
          let scope = yield* Scope.make();
          let life = yield* host(store, world, next.next, scope);
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
          const name = responderName(1);
          const runner = () => Option.getOrThrow(Option.fromUndefinedOr(life.runners.get(name)));
          const within = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.provide(life.context));
          const input = (m: unknown): Incoming => ({
            id: `timer-${++world.n}`,
            envelope: { id: inputId(world.n), by: person, arrivedAt: world.n, input: m },
            sentAt: "2026-11-11T00:00:00Z",
            seen: 0,
            span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
          });
          let timer: number | null = null,
            wake: number | null = null,
            retry: number | null = null;
          let live = true;
          let recoveryWait: number | null = null;
          let kept: ReadonlyArray<unknown> = [];
          const ticks: number[] = [];
          const saved = () => Effect.map(store.alarms.saved, (rows) => rows.find((a) => a.name === name)?.at ?? null);
          yield* runner().due(0);

          for (const cell of tape) {
            const now = yield* Clock.currentTimeMillis;
            const choices = stopped
              ? live
                ? ["stop", "brake", "wake", "reopen"]
                : ["wake", "reopen"]
              : ["arm", "wake", "send", "advance", ...((yield* saved()) === null ? [] : ["fire"])];
            const move = choose(choices, cell.move);
            visited.add(move);

            if (retry !== null && retry <= now && ["arm", "wake", "send"].includes(move)) {
              retry = now + alarmPolicy.backoff.minMs;
            }

            if (move === "advance") {
              yield* TestClock.setTime(now + (cell.pick % 100) + 1);
            } else if (move === "arm") {
              timer = now + (Math.abs(cell.value) % 100) + 1;
              yield* runner().msg(input({ type: "arm", at: timer }));
            } else if (move === "send") {
              world.fault.wake = true;
              yield* runner()
                .msg(input({ type: "request", ref: `r-${world.n}`, value: 7, reply: requesterName(1) }))
                .pipe(Effect.result);
              retry ??= now + alarmPolicy.backoff.minMs;
            } else if (move === "wake") {
              if (!live) {
                visited.add("kept");
                const source = yield* within(ProcessManager.use((p) => p.status(requesterName(1))));
                yield* within(
                  ProgramMail.use((p) =>
                    p.deliver({
                      command: `${source.state.process}/${++world.n}/0`,
                      source: { name: requesterName(1), process: source.state.process },
                      to: name,
                      m: { type: "request", ref: `kept-${world.n}`, value: 7, reply: requesterName(1) },
                      from: brainFrom(),
                    }),
                  ),
                );
                kept = yield* within(Mailbox.use((m) => Stream.runCollect(m.read(name, 0))));
              }

              yield* runner().mailed;

              if (live) {
                wake = wake === null ? now : Math.min(now, wake);
              }
            } else if (move === "brake") {
              for (let n = 0; n <= alarmPolicy.intensity; n++) {
                yield* runner()
                  .msg(input({ type: "crash" }))
                  .pipe(Effect.result);
                const at = yield* saved();
                expect(at, "a crash keeps its recovery alarm").not.toBeNull();

                if (n < alarmPolicy.intensity && at !== null) {
                  yield* TestClock.setTime(at);
                  yield* store.alarms.take({ name, at });
                  yield* runner().due(at);
                }
              }

              live = false;
              recoveryWait = yield* saved();
              expect(recoveryWait).toBeTypeOf("number");
              kept = yield* within(Mailbox.use((m) => Stream.runCollect(m.read(name, 0))));
            } else if (move === "stop") {
              const status = yield* within(ProcessManager.use((p) => p.status(name)));
              yield* within(ProcessManager.use((p) => p.exit(status.state.process, SHUTDOWN, brainFrom())));
              live = false;
              timer = null;
              wake = null;
              retry = null;
              // Load the stopped supervision before checking what another mail wake can schedule.
              yield* runner().due(now);
              kept = yield* within(Mailbox.use((m) => Stream.runCollect(m.read(name, 0))));
            } else if (move === "reopen") {
              yield* Scope.close(scope, Exit.void);
              yield* store.reopen;
              scope = yield* Scope.make();
              life = yield* host(store, world, next.next, scope);
              // A cold stopped name may take one wake; its first alarm must clear that mail time.
              yield* runner().mailed;
              const at = yield* saved();

              if (at !== null && (recoveryWait === null || at < recoveryWait)) {
                yield* store.alarms.take({ name, at });
                yield* runner().due(Math.max(now, at));
              }

              wake = null;
            } else {
              const at = yield* saved();

              if (at !== null) {
                yield* TestClock.setTime(Math.max(now, at));
                yield* store.alarms.take({ name, at });

                if (timer !== null && timer <= Math.max(now, at)) {
                  ticks.push(Math.max(now, at));
                  timer = null;
                }

                yield* runner().due(Math.max(now, at));
                wake = null;
                retry = null;
              }
            }

            if (!live) {
              expect(yield* saved(), "M3: a non-live name keeps only its own recovery wait").toBe(recoveryWait);
              expect(
                yield* within(Mailbox.use((m) => Stream.runCollect(m.read(name, 0)))),
                "M3: every saved letter stays in the inbox",
              ).toEqual(kept);
              const status = yield* within(ProcessManager.use((p) => p.status(name)));
              expect(status.state._tag, "M3: mailed never starts a non-live name").toBe(
                recoveryWait === null ? "ended" : "down",
              );
            } else if (!stopped) {
              const terms = [timer, wake, retry].filter((at): at is number => at !== null);
              expect(yield* saved(), "M2: the single saved alarm is the earliest pending work").toBe(
                terms.length === 0 ? null : Math.min(...terms),
              );
              const checkpoint = yield* within(savedModel(store, name));
              const model =
                checkpoint === null
                  ? timerMachine.init(null, stubCtxThrowingProxy<unknown>())[0]
                  : Schema.decodeUnknownSync(TimerModel)(checkpoint);
              expect(model.at, "M2: a mail drain keeps the program timer").toBe(timer);
              expect(model.ticks, "M2: only a due program timer adds its timer letter").toEqual(ticks);
            }
          }
        });
        const scoped = (tape: ReadonlyArray<Cell>) => Effect.scoped(once(tape)).pipe(Effect.provide(TestClock.layer()));
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each generated tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(scoped(tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check reports its result as a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 100, includeErrorInReport: true }));
        expect([...visited]).toEqual(
          expect.arrayContaining(
            stopped ? ["stop", "brake", "wake", "reopen", "kept"] : ["arm", "wake", "send", "advance", "fire"],
          ),
        );
      }),
    // CI max M3 11.1 s across the same three runs: ceil(2 * 11.1) s.
    23_000,
  );

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P41: a request and its answer between two real runners", () => {
    for (const trace of [false, true]) {
      it.effect(
        trace ? "T1a: receipt traces join each saved wake" : "T1a [secrets]: records hold no mail",
        () =>
          Effect.gen(function* () {
            const done = new Set<Move>();
            let sends = 0;
            const once = Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>, seed: number) {
              const secrets = yield* Arbitrary.sampleEffect(RepliesTest.sentinel, { seed, count: 2 });
              const observed = records(secrets, trace);
              const run = walk(
                trace ? "T1a" : "T1a [secrets]",
                open,
                [1, 2],
                [
                  "start",
                  "start_forbidden",
                  "start_missing",
                  "stall",
                  "evict",
                  "cut_mail",
                  "lose_ack",
                  "fail_wake",
                  "fire",
                  "settle",
                ],
                done,
                observed,
              );
              yield* Effect.scoped(run(tape)).pipe(Effect.withTracer(observed.tracer), Effect.provide(observed.logger));
              observed.check();
              sends += observed.spans.filter((s) => s.name === "mail_delivery.send").length;
            });
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits the state-aware tape
            const property = fc.asyncProperty(Tape, fc.nat(), (tape, seed) => Effect.runPromise(once(tape, seed)));
            // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check reports its property result
            yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 100, includeErrorInReport: true }));
            expect(sends).toBeGreaterThan(0);
            expect([...done]).toEqual(
              expect.arrayContaining([
                "start",
                "start_forbidden",
                "start_missing",
                "evict",
                "cut_mail",
                "lose_ack",
                "fail_wake",
              ]),
            );
          }),
        // CI max T1a [secrets] 58.5 s across the same three runs: 2 * 58.5 s.
        117_000,
      );
    }

    alarmLaw(open, false);
    alarmLaw(open, true);
    prop(
      "M1, M4: a wake waits behind a drain and queued waits until the target alarm is saved",
      open,
      [1],
      ["start", "wakeDuringDrain", "holdAlarm", "fire", "reopen", "settle"],
      ["wakeDuringDrain", "holdAlarm", "fire", "reopen"],
      100,
    );
    prop(
      "M4: failed wakes and reopened recipients retry the same saved letter",
      open,
      [1],
      ["start", "fail_wake", "fire", "reopen", "settle"],
      ["start", "fail_wake", "fire", "reopen"],
      100,
    );
    prop(
      "S1, S2: an evicted Send finishes from saved alarms, and its retry alarm leaves with its answer",
      open,
      [1, 2],
      ["start", "stall", "evict", "cut_mail", "lose_ack", "fail_wake", "fire", "settle"],
      ["start", "stall", "evict", "fire"],
      100,
      // pinned: plan amendment 3, main saves a Send without arming its sender before delivery.
      [
        [
          { move: 1, pick: 0, value: 7, shape: 0 },
          { move: 0, pick: 0, value: 7, shape: 0 },
        ],
      ],
    );
    prop(
      "L1: once reachable work completes, the requester holds the responder's answer for its reference",
      open,
      [1],
      ["start", "fire", "settle"],
      ["start", "fire", "settle"],
    );
    prop(
      "L2: `queued` never completes a request, and an early answer survives a late acknowledgement",
      open,
      [1],
      ["start", "lose_ack", "fire", "settle"],
      ["start", "lose_ack", "fire"],
    );
    prop(
      "L4: every durable cut resumes from saved alarms alone, with one letter per command",
      open,
      [1],
      ["start", "cut_mail", "lose_ack", "fail_wake", "fire", "reopen", "settle"],
      ["start", "cut_mail", "lose_ack", "fail_wake", "fire", "reopen"],
    );
    prop(
      "L6: a restarted recipient reads the same inbox in order; a stopped one keeps its mail and is not started",
      open,
      [1],
      ["start", "fire", "restart", "stop", "settle", "reopen"],
      ["start", "restart", "stop", "fire"],
    );
    prop(
      "L7: malformed, person-only, forged-parent and unknown mail never steps the recipient",
      open,
      [1],
      ["start", "forge", "fire", "settle"],
      ["start", "forge", "fire"],
    );
    prop(
      "L8: a forbidden or missing destination is a typed refusal, whatever sender the command claims",
      open,
      [1, 2],
      ["start", "start_forbidden", "start_missing", "fire", "settle"],
      ["start_forbidden", "start_missing", "fire"],
    );
    prop(
      "L9: stale, unknown and repeated answers never complete the current request",
      open,
      [1],
      ["start", "stale_answer", "fire", "settle"],
      ["start", "stale_answer", "fire"],
    );
    prop(
      "L10: one recipient's stalled wake holds neither another recipient's progress nor its sender's other work",
      open,
      [1, 2],
      ["start", "stall", "fire", "settle"],
      ["start", "stall", "settle"],
    );

    it("L2, L9 on the requester's own reducer: only its waiting reference's answer completes it; a receipt never does", () => {
      const { machine } = REQUESTERS[1];
      const ctx = stubCtxThrowingProxy<unknown>();
      const ref = fc.constantFrom("ref-a", "ref-b", "ref-c");
      const lists = arbGuidedSequence(
        machine,
        ctx,
        {
          outside: {
            start: fc.record({ type: fc.constant("start" as const), ref, value: fc.integer({ min: 0, max: 100 }) }),
            answer: fc.record({
              type: fc.constant("answer" as const),
              ref,
              value: fc.integer({ min: -100, max: 100 }),
            }),
          },
          answers: {
            send: {
              draw: fc.oneof(
                fc.string({ minLength: 1, maxLength: 20 }).map((id) => ({ ok: true as const, id })),
                fc
                  .constantFrom("no_name", "forbidden", "stale_sender", "bad_message", "id_reused")
                  .map((reason) => ({ ok: false as const, reason })),
              ),
              make: (cmd, drawn) =>
                drawn.ok
                  ? { type: "send_ok" as const, cmd, value: Queued.make({ id: drawn.id }), at: 0 }
                  : { type: "send_err" as const, cmd, error: Schema.TaggedStruct(drawn.reason, {}).make({}), at: 0 },
            },
          },
        },
        { maxLength: 40 },
      );
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      propertyInvariant(
        machine,
        ctx,
        lists,
        ({ prev, msg, next }) => {
          if (msg.type === "send_ok") {
            return same(prev, next) || "L2: `queued` is a delivery receipt and changes nothing";
          }

          if (prev._tag === "answered") {
            return msg.type === "start" || same(prev, next) || "L2: a late message undid an answered request";
          }

          if (next._tag === "answered") {
            return (
              (msg.type === "answer" &&
                prev._tag === "waiting" &&
                prev.ref === msg.ref &&
                same(next, RequesterModel.cases.answered.make({ ref: msg.ref, value: msg.value }))) ||
              "L9: only the waiting reference's own answer completes it"
            );
          }

          return true;
        },
        { seed: SEED, numRuns: 300 },
      );
    });

    it("L13: Send's public JSON keeps `_tag`, the receipt ID and the operands explicit", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 80 }),
          fc.string({ minLength: 1, maxLength: 40 }),
          fc.jsonValue({ maxDepth: 2 }),
          (id, to, m) => {
            const queued = Schema.encodeSync(Queued)(Queued.make({ id }));
            expect(queued, "a receipt is `_tag: queued` with its delivery ID, and nothing else").toEqual(
              wire("queued", { id }),
            );
            expect(Schema.decodeUnknownSync(Queued)(wire("queued", { id }))).toEqual(Queued.make({ id }));
            expect(Result.isFailure(Schema.decodeUnknownResult(Queued)({ kind: "queued", id }))).toBe(true);
            expect(Result.isFailure(Schema.decodeUnknownResult(Queued)(wire("queued", { id: "" })))).toBe(true);
            const operands = JSON.parse(JSON.stringify({ to, m: m ?? null }));
            expect(Schema.decodeUnknownSync(SendInput)(operands)).toEqual(operands);
            expect(Result.isFailure(Schema.decodeUnknownResult(SendInput)({ ...operands, to: "" }))).toBe(true);
            expect(send(operands), "the built-in command is `type: send` with its two operands").toMatchObject({
              type: "send",
              to: operands.to,
              m: operands.m,
            });
          },
        ),
        { seed: SEED, numRuns: 200 },
      );
    });
  });
