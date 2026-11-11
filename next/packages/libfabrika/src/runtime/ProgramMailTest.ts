// P41 slice 1, next/ (ticket 744): two real runners exchange a request and its answer through durable
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
import { arbGuidedSequence, propertyInvariant, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Result, Schema, Scope, Stream } from "effect";
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
import { ProgramRunner } from "./Runner.ts";
import { Queued, send, SendInput } from "./Send.ts";

/** One saved alarm: the name it wakes, whether the runner or a mail delivery set it, and when. */
export type Saved = { readonly name: string; readonly kind: "alarm" | "mail"; readonly at: number };

/** The scoped, controllable alarm driver. A set is saved before it answers, and survives a reopen. */
export type Alarms = {
  readonly set: (name: string, kind: Saved["kind"], at: number | null) => Effect.Effect<void>;
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

const PROGRAMS: Record<string, unknown> = {
  ...Object.fromEntries(PAIRS.map((k) => [REQUESTERS[k].name, REQUESTERS[k]])),
  [mailResponder.name]: mailResponder,
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
  | "reopen";

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
  /** Each requester's current request, once its start letter is in its inbox. */
  readonly current: Map<Pair, Request>;
  /** Every ref each requester ever asked for, for stale answers. */
  readonly history: Map<Pair, Array<string>>;
  /** Responders a brain exit stopped and no restart has replaced. */
  readonly stopped: Set<Pair>;
  /** Responders whose wake hangs until the walk releases it. */
  readonly stalled: Map<Pair, Deferred.Deferred<void>>;
  readonly fault: { mail: boolean; ack: boolean; wake: boolean };
  /** Requests started while their pair's wake hangs, run in the background. */
  readonly background: Array<Fiber.Fiber<unknown, unknown>>;
  /** Refs whose value was negative: the responder refuses them. */
  readonly negative: Set<string>;
  /** Responders some restart replaced, whose saved model starts again. */
  readonly restarted: Set<Pair>;
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
  const wakeups = Layer.succeed(MailWakeups, {
    wake: (name: string) =>
      Effect.gen(function* () {
        const pair = PAIRS.find((k) => responderName(k) === name || requesterName(k) === name);
        const stall = pair === undefined ? undefined : world.stalled.get(pair);

        if (stall !== undefined && name === responderName(pair as Pair)) {
          yield* Deferred.await(stall);
        }

        if (world.fault.wake) {
          world.fault.wake = false;
          return yield* new MailWakeupsError({ reason: "unavailable" });
        }

        yield* store.alarms.set(name, "mail", yield* Clock.currentTimeMillis);
      }),
  });
  const shared = MailDeliveryLive.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(ProgramMailLedger.layer({ grants: GRANTS }), wakeups)),
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
  const runners = new Map<string, ProgramRunner["Service"]>();
  const names: ReadonlyArray<readonly [string, string]> = PAIRS.flatMap((k) => [
    [requesterName(k), REQUESTERS[k].name] as const,
    [responderName(k), mailResponder.name] as const,
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
      Layer.succeed(Alarm, { set: (at: number | null) => store.alarms.set(name, "alarm", at) }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const runner = ProgramRunner.layer(
      { id: pid, name, program, build: BUILD, owner },
      { recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 } },
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
  open: Effect.Effect<Store, never, Scope.Scope>,
  pairs: ReadonlyArray<Pair>,
  moves: ReadonlyArray<Move>,
  done: Set<Move>,
) =>
  Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: World = {
      current: new Map(),
      history: new Map(),
      stopped: new Set(),
      stalled: new Map(),
      fault: { mail: false, ack: false, wake: false },
      background: [],
      negative: new Set(),
      restarted: new Set(),
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

    /** The invariants every prefix keeps. */
    const check = Effect.fnUntraced(function* () {
      for (const k of pairs) {
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
      };
      const options = moves.filter((move) => can[move]);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);

      switch (move) {
        case "start":
        case "start_forbidden":
        case "start_missing": {
          const k = choose(idle, cell.pick);
          const other = pairs.find((p) => p !== k) ?? k;
          const ref = `ref-${k}-${++world.n}`;
          const kind = move === "start" ? "normal" : move === "start_forbidden" ? "forbidden" : "missing";
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

          if (world.stalled.has(k)) {
            world.background.push(yield* Effect.forkChild(work.pipe(Effect.result)));
          } else {
            yield* call(work, `${requesterName(k)}'s start`);
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

    for (const fiber of world.background) {
      yield* Fiber.join(fiber).pipe(Effect.timeoutOption("20 seconds"), Effect.ignore);
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
        expect(state, "L6: a stopped recipient keeps the letter and is not started by a send").toEqual(waiting);
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
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Move>();
        const law = walk(open, pairs, moves, done);
        const once = Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
          const probe = yield* Effect.scoped(law(tape));
          // L12: once the scope is gone, nothing it opened is still open or still running.
          yield* Effect.sleep("20 millis");
          expect(probe.open(), "L12: every database handle closed with its scope").toBe(0);
          expect(probe.late(), "L12: no alarm task set an alarm after its scope closed").toBe(0);
        });
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(once(tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 40, includeErrorInReport: true }));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    600_000,
  );

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P41 slice 1: a request and its answer between two real runners", () => {
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
