// T695, next/. The runtime's stores keep the failure they translate (decision 0043 rule 12). A
// suite on any `Sql`, read through its module as `RuntimeCauseTest.suite(law, fresh)`; the module that
// owns the driver runs it (0062).
//
// Audit sites: `ProcessStore.ts:120` (a throw in a stored step), `ProcessStore.ts:141` (an activity
// from the object's storage that does not decode), `RecoveryStore.ts:53` (a throw, and its
// pass-through branch for a LedgerError already made). The runtime's lower modules' stores, which
// it calls and may import: `access/Authorization.ts:30` and `access/ClientManager.ts:64` (a member
// row that does not decode), `access/SessionManager.ts:119` and `presence/Connections.ts:55` (a
// throw in a stored step), `processes/Process.ts:131` (a saved activity that does not decode),
// `processes/ProcessManager.ts:338` (a dead letter's record that does not decode). The runner, built
// as runner-reply.laws.test.ts builds it: `Runner.ts:1345` (a delivery that does not decode) and
// `Runner.ts:606` (a restart policy that does not decode).
import { Machine } from "@demlik/tea/effect";
import { describe, expect } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import * as fc from "fast-check";
import { MemberEvent } from "../access/Access.ts";
import { appendAdmitted } from "../access/Authorization.ts";
import { ClientManager } from "../access/ClientManager.ts";
import { SessionManager, Writer } from "../access/SessionManager.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { type Line, lineFor } from "../ledger/Log.ts";
import { Connections } from "../presence/Connections.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { BRAIN, brain, from } from "../processes/Process.test-support.ts";
import { Activity, Owner, Recipient, recoverActivity, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input } from "./Program.ts";
import { RecoveryStore } from "./RecoveryStore.ts";
import { ProgramRunner, RunnerError, type RunnerOptions } from "./Runner.ts";

const PROCESS = "process_0000000000e008000000000000";

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new RangeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

const reasons = fc.constantFrom("unreachable", "bad_row", "storage", "refused", "crypto");

/** Runs one property: generated input, each case an Effect on the real code. The runner gives it. */
export type Law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown>) => void;

/** The same `Sql`, but each query throws `failure` once armed. */
const throwing = (sql: Sql, failure: unknown): { readonly sql: Sql; readonly arm: () => void } => {
  let armed = false;
  return {
    sql: {
      ...sql,
      exec: (query, ...params) => {
        if (armed) {
          throw failure;
        }

        return sql.exec(query, ...params);
      },
    },
    arm: () => {
      armed = true;
    },
  };
};

const ledgerOn = (sql: Sql) =>
  Ledger.sql(sql, { reader: PROCESS }).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })));

const processStore = (sql: Sql, storage?: Parameters<typeof ProcessStore.layer>[1]["storage"]) =>
  ProcessStore.layer(sql, { process: PROCESS, ...(storage === undefined ? {} : { storage }) }).pipe(
    Layer.provide(ledgerOn(sql)),
  );

const recoveryStore = (sql: Sql) => RecoveryStore.layer(sql, { name: "counter:1", capacity: 1024 ** 3 });

/** The process store's calls a runner makes, by name. */
type StoreCall = "load" | "readActivity" | "placed" | "save";
const storeCalls = fc.constantFrom<StoreCall>("load", "readActivity", "placed", "save");

const callStore = (call: StoreCall) =>
  ProcessStore.use((store) => {
    if (call === "load") {
      return store.load;
    }

    if (call === "readActivity") {
      return store.readActivity;
    }

    if (call === "placed") {
      return store.placed("letter-1");
    }

    return store.save({ saved: { v: 1, build: "b", model: null, after: 0 }, turn: null, cmds: [] });
  });

type RecoveryCall = "load" | "input" | "receipt";
const recoveryCalls = fc.constantFrom<RecoveryCall>("load", "input", "receipt");

const callRecovery = (call: RecoveryCall) =>
  RecoveryStore.use((store) =>
    call === "load" ? store.load : call === "input" ? store.input("letter-1") : store.receipt("letter-1"),
  );

export const suite = (law: Law, fresh: () => Sql) => {
  describe("T695, ProcessStore keeps what its storage threw", () => {
    // C1, ProcessStore.ts:120. Plant: `catch: () => new LedgerError({ reason: "storage" })`.
    law(
      "C1: a generated throw on any store call after setup is `storage` with that value as its cause",
      fc.record({ calls: fc.array(storeCalls, { minLength: 1, maxLength: 4 }), failure: failures }),
      ({ calls, failure }) =>
        Effect.gen(function* () {
          const planted = throwing(fresh(), failure);
          const layer = processStore(planted.sql);
          yield* Effect.provide(callStore("load"), layer);
          planted.arm();

          for (const call of calls) {
            const error = yield* Effect.flip(Effect.provide(callStore(call), layer));
            expect(error.reason).toBe("storage");
            expect(error.cause).toBe(failure);
          }
        }),
    );

    // C3, ProcessStore.ts:120. Plant: replace the cause with `undefined`.
    law(
      "C3: a saved checkpoint damaged after a valid save is `bad_row` with the decoder's SchemaError",
      fc.record({ model: fc.jsonValue(), after: fc.nat(), bad: fc.string() }),
      ({ model, after, bad }) =>
        Effect.gen(function* () {
          const sql = fresh();
          const layer = processStore(sql);
          yield* Effect.provide(
            ProcessStore.use((store) =>
              store.save({ saved: { v: 1, build: "b", model: model ?? null, after }, turn: null, cmds: [] }),
            ),
            layer,
          );
          // The required `after` is now text, as a row this store never wrote.
          sql.exec("UPDATE process_state SET checkpoint = json_set(checkpoint, '$.saved.after', ?)", bad);
          const error = yield* Effect.flip(Effect.provide(callStore("load"), layer));
          expect(error.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        }),
    );

    // C3, ProcessStore.ts:141. Plant: `catch: () => new LedgerError({ reason: "bad_row" })`.
    law(
      "C3: an activity from the object's storage with a damaged field is `bad_row` with its SchemaError",
      fc.record({ tag: fc.constantFrom("idle", "stepping"), letter: fc.string({ minLength: 1 }), bad: fc.integer() }),
      ({ tag, letter, bad }) =>
        Effect.gen(function* () {
          const valid =
            tag === "idle"
              ? Activity.cases.idle.make({ process: PROCESS })
              : Activity.cases.stepping.make({ process: PROCESS, letter, build: "b" });
          const raw = { ...valid, process: bad };
          const layer = processStore(fresh(), {
            put: () => Effect.void,
            sync: () => Effect.void,
            get: () => Effect.succeed(raw),
          });
          const error = yield* Effect.flip(Effect.provide(callStore("readActivity"), layer));
          expect(error.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        }),
    );
  });

  describe("T695, RecoveryStore keeps what its storage threw", () => {
    // C1, RecoveryStore.ts:53. Plant: drop `cause` from the translated LedgerError.
    law(
      "C1: a generated throw on any recovery call is `storage` with that value as its cause",
      fc.record({ calls: fc.array(recoveryCalls, { minLength: 1, maxLength: 4 }), failure: failures }),
      ({ calls, failure }) =>
        Effect.gen(function* () {
          const planted = throwing(fresh(), failure);
          planted.arm();

          for (const call of calls) {
            const error = yield* Effect.flip(Effect.provide(callRecovery(call), recoveryStore(planted.sql)));
            expect(error.reason).toBe("storage");
            expect(error.cause).toBe(failure);
          }
        }),
    );

    // C3, RecoveryStore.ts:53. Plant: replace `cause` with `undefined`.
    law(
      "C3: a recovery row that does not decode is `bad_row` with the decoder's SchemaError",
      fc.record({ name: fc.string(), bad: fc.jsonValue() }),
      ({ name, bad }) =>
        Effect.gen(function* () {
          const sql = fresh();
          // The tables come with the first call; then a row this store never wrote.
          yield* Effect.provide(callRecovery("load"), recoveryStore(sql));
          sql.exec(
            "INSERT INTO process_recovery (name, value) VALUES (?, ?)",
            "counter:1",
            JSON.stringify({ v: 1, name, policy: bad }),
          );
          const error = yield* Effect.flip(Effect.provide(callRecovery("load"), recoveryStore(sql)));
          expect(error.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        }),
    );

    // C4, RecoveryStore.ts:51. Plant: construct a new LedgerError from the caught one's reason.
    law(
      "C4: a LedgerError thrown by the storage comes out as that same object, its chain untouched",
      fc.record({ call: recoveryCalls, reason: reasons, failure: failures }),
      ({ call, reason, failure }) =>
        Effect.gen(function* () {
          const thrown = new LedgerError({ reason, cause: failure });
          const planted = throwing(fresh(), thrown);
          planted.arm();
          const error = yield* Effect.flip(Effect.provide(callRecovery(call), recoveryStore(planted.sql)));
          expect(error).toBe(thrown);
          expect(error.cause).toBe(failure);
        }),
    );
  });

  describe("T695, the stores under the runtime keep what failed", () => {
    const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
    const writer = {
      by: "SHA256:founder",
      for: "person-1",
      sentAt: "2026-11-07T21:10:01.204Z",
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: "b-1",
    };
    /** A valid `founded` line, then its body replaced by `body`. */
    const memberLine = (body: Record<string, unknown>): Line => ({
      ...lineFor(writer, MemberEvent.cases.founded.make({ id: "person-1", name: "p", keys: [], window: null })),
      body,
    });
    const founder = { name: "p", keys: [], window: null, person: "person-1", by: "SHA256:founder", build: "b-1" };

    // C3, Authorization.ts:30 and ClientManager.ts:64. Plant: `new LedgerError({ reason: "bad_row" })`.
    law(
      "C3: a member row with a damaged field fails `bad_row` with the decoder's SchemaError, on both readers",
      fc.record({
        reader: fc.constantFrom("authorization", "members"),
        field: fc.constantFrom("id", "name", "keys", "window"),
        bad: fc.oneof(fc.integer(), fc.boolean(), fc.constant({})),
      }),
      ({ reader, field, bad }) =>
        Effect.gen(function* () {
          const sql = fresh();
          const ledger = ledgerOn(sql);
          const body = { id: "person-1", name: "p", keys: [], window: null, [field]: bad };
          yield* Effect.provide(
            Ledger.use((l) => l.append("gateway/access", "founded", memberLine(body))),
            ledger,
          );
          const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
          const error = yield* Effect.flip(
            reader === "authorization"
              ? Effect.provide(
                  appendAdmitted("SHA256:anyone", { stream: "notes:1", id: "w-1", line: memberLine({ note: 1 }) }),
                  LedgerTransaction.layer(sql).pipe(Layer.provide(quiet)),
                )
              : Effect.provide(
                  ClientManager.use((m) => m.members),
                  ClientManager.layer(founder).pipe(Layer.provide(ledger)),
                ),
          );
          expect(error).toBeInstanceOf(LedgerError);
          expect((error as LedgerError).reason).toBe("bad_row");
          expect(Schema.isSchemaError((error as LedgerError).cause), "the decoder's own failure").toBe(true);
        }),
    );

    // C1, SessionManager.ts:119 and Connections.ts:55. Plant: their zero-argument `catch`.
    law(
      "C1: a generated throw in a session or connection store step is `storage` with that value as its cause",
      fc.record({ store: fc.constantFrom("sessions", "connections"), failure: failures, key: fc.string() }),
      ({ store, failure, key }) =>
        Effect.gen(function* () {
          const planted = throwing(fresh(), failure);
          planted.arm();
          const error = yield* Effect.flip(
            store === "sessions"
              ? Effect.provide(
                  SessionManager.use((s) => s.end(PROCESS)),
                  SessionManager.layer(planted.sql, () => Effect.die("unused"), {
                    input: () => true,
                    event: () => true,
                  }),
                )
              : Effect.provide(
                  Connections.use((c) => c.online(key)),
                  Connections.layer(planted.sql, {
                    probe: () => Effect.succeed(null),
                    admitted: () => Effect.succeed(true),
                  }),
                ),
          );
          expect(error.reason).toBe("storage");
          expect(error.cause).toBe(failure);
        }),
    );

    // C3, Process.ts:131. Plant: `Result.fail(new LedgerError({ reason: "bad_row" }))`.
    law(
      "C3: a saved activity with a damaged field fails `bad_row` with the decoder's SchemaError",
      fc.record({ tag: fc.constantFrom("idle", "stepping"), bad: fc.oneof(fc.integer(), fc.boolean()) }),
      ({ tag, bad }) =>
        Effect.sync(() => {
          const valid =
            tag === "idle"
              ? Activity.cases.idle.make({ process: PROCESS })
              : Activity.cases.stepping.make({ process: PROCESS, letter: "l", build: "b" });
          const recovered = recoverActivity({ ...valid, process: bad });
          expect(Result.isFailure(recovered)).toBe(true);
          const error = Result.isFailure(recovered) ? recovered.failure : null;
          expect(error?.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error?.cause), "the decoder's own failure").toBe(true);
        }),
    );

    // C3, ProcessManager.ts:338. Plant: `Effect.mapError(() => new ProcessError({ reason: "bad_text" }))`.
    law(
      "C3: a dead record with a damaged field fails `bad_text` with the decoder's SchemaError",
      fc.record({
        field: fc.constantFrom("tries", "limit", "m", "build", "errors"),
        bad: fc.oneof(fc.constant(-1), fc.constant(""), fc.boolean(), fc.constant(null)),
      }),
      ({ field, bad }) =>
        Effect.gen(function* () {
          const sql = fresh();
          const manager = ProcessManager.layer({ ...brain(), by: BRAIN }, Effect.succeed(PROCESS)).pipe(
            Layer.provide(
              LedgerTransaction.layer(sql).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
            ),
          );
          const dead = { tries: 3, limit: 3, m: "m-1", build: "b-1", errors: ["E", "E", "E"], [field]: bad };
          const error = yield* Effect.flip(
            Effect.provide(
              ProcessManager.use((m) => m.dead(PROCESS, dead as never, from())),
              manager,
            ),
          );
          expect(error.reason).toBe("bad_text");
          expect(Schema.isSchemaError(error.cause), "the decoder's own failure").toBe(true);
        }),
    );
  });

  describe("T695, the runner keeps what failed", () => {
    const NAME = "cause:1";
    const owner = Writer.cases.person.make({ key: "SHA256:owner", for: "person-1" });
    const Model = Schema.Struct({ n: Schema.Int });
    const Msg = Schema.Struct({ type: Schema.Literal("inc") });
    const program = {
      name: "cause",
      machine: Machine.make({
        model: Model,
        msg: Msg,
        init: (saved) => [saved ?? { n: 0 }, []],
        update: { inc: (s) => [{ n: s.n + 1 }, []] },
      }),
      state: { v: 1, schema: Model, upgrades: [] },
      msg: Msg,
      view: { data: Model, select: (s: typeof Model.Type) => s },
      refuse: () => null,
      inputs: { inc: Input.cases.write.make({ schema: Msg, description: "Inc", personOnly: false }) },
      outputs: {},
      writes: {},
      wake: () => null,
    } as const;
    const writer = {
      by: BRAIN,
      for: "brain",
      sentAt: "2026-11-08T00:00:00Z",
      seen: 0,
      parent: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      build: "test",
    };

    /** A real runner on fresh storage, supervised by the real process manager, as in production. */
    const runner = (policy?: RunnerOptions["policy"]) => {
      const sql = fresh();
      const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
      const mail = Mailbox.layer.pipe(Layer.provideMerge(ledgerOn(sql)));
      const dependencies = Layer.mergeAll(
        ProcessStore.layer(sql, { process: PROCESS }),
        Layer.succeed(Alarm, { set: () => Effect.void }),
        Layer.succeed(WatcherManager, { publish: () => Effect.void }),
        Layer.succeed(Recording, { flush: Effect.void }),
        Layer.succeed(CheckedWriter, {
          append: () => Effect.die("unused"),
          commit: () => Effect.die("unused"),
          own: () => Effect.die("unused"),
        }),
      ).pipe(Layer.provideMerge(mail));
      const manager = Layer.effectDiscard(
        ProcessManager.use((m) =>
          m.start(
            Start.cases.first.make({ id: `boot:${NAME}`, name: NAME, code: { program: "cause", hash: "test" } }),
            writer,
          ),
        ).pipe(Effect.orDie),
      ).pipe(
        Layer.provideMerge(
          ProcessManager.layer(
            {
              by: BRAIN,
              owner: Owner.cases.brain.make({}),
              recipient: Recipient.cases.client.make({ client: "brain", session: PROCESS }),
            },
            Effect.succeed(PROCESS),
          ),
        ),
        Layer.provide(LedgerTransaction.layer(fresh()).pipe(Layer.provide(quiet))),
      );
      return ProgramRunner.layer(
        { id: PROCESS, name: NAME, program: "cause", build: "test", owner },
        {
          recovery: { sql, name: NAME, capacity: 1024 ** 3 },
          ...(policy === undefined ? {} : { policy }),
        },
      ).pipe(
        Layer.provideMerge(Layer.mergeAll(dependencies, manager)),
        Layer.provide(ProgramLoader.layer({ cause: program }, {})),
      );
    };

    const delivery = (traceId: unknown): unknown => ({
      id: "letter-1",
      envelope: {
        id: "in-process_0000000000e008000000000000-1",
        by: owner,
        arrivedAt: 1794099600000,
        input: { type: "inc" },
      },
      sentAt: "2026-11-08T00:00:00Z",
      seen: 0,
      span: { traceId, spanId: "00f067aa0ba902b7" },
    });

    // C3, Runner.ts:1345. Plant: `Effect.mapError(() => new RunnerError({ reason: "bad_input" }))`.
    law(
      "C3: a delivery with a damaged span fails `bad_input` with the decoder's SchemaError",
      fc.record({ traceId: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)) }),
      ({ traceId }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            Effect.provide(
              ProgramRunner.use((r) => r.msg(delivery(traceId) as Incoming)),
              runner(),
            ),
          );
          expect(error).toBeInstanceOf(RunnerError);
          expect((error as RunnerError).reason).toBe("bad_input");
          expect(Schema.isSchemaError((error as RunnerError).cause), "the decoder's own failure").toBe(true);
        }),
    );

    // C3, Runner.ts:606. Plant: `catch: () => new LedgerError({ reason: "bad_row" })`.
    law(
      "C3: a restart policy that does not decode fails `bad_row` with the decoder's SchemaError",
      fc.record({ max: fc.integer({ min: 2, max: 32 }), gap: fc.integer({ min: 1, max: 8 }) }),
      ({ max, gap }) =>
        Effect.gen(function* () {
          // Fewer restarts allowed than deliveries tried: a policy the brake could never trip.
          const policy = {
            maxDeliveries: max,
            intensity: Math.max(0, max - gap),
            periodMs: 5000,
            backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
          };
          const error = yield* Effect.flip(
            Effect.provide(
              ProgramRunner.use((r) => r.msg(delivery("4bf92f3577b34da6a3ce929d0e0e4736") as Incoming)),
              runner(policy),
            ),
          );
          expect(error).toBeInstanceOf(LedgerError);
          expect((error as LedgerError).reason).toBe("bad_row");
          expect(Schema.isSchemaError((error as LedgerError).cause), "the decoder's own failure").toBe(true);
        }),
    );
  });
};
