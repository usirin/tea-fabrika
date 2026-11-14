// P11, next/. All runner integration laws share one real SQLite world in this file.
// The plan leaves adapter signatures open. These tests use ProgramRunner.layer(descriptor),
// ProgramLoader.layer(programs, handlers), and entry.ts's CheckedWriter, WatcherManager,
// Alarm and Recording services. Watchers receive publish(client, whole-or-patch).
// A whole has {type:"whole", rev, view}; a patch has {type:"patch", base, rev, patch}.
// CheckedWriter.append(Incoming) saves delivery; commit(id, session, stream, event) and
// own(id, stream, event) are the checked door edges. The runner, not these adapters, signs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyCell, Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Arbitrary,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Result,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { SessionManagerError, Storage } from "../access/SessionManager.ts";
import { type Envelope, type NotGranted, SessionManager, SignRequest, Writer } from "../coordination/index.ts";
import { processId, processIds } from "../Id.test-support.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Appended, type Entry, InputId, lineFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { letterLine, Mailbox, type From } from "../processes/Mailbox.ts";
import { Activity, Down, Owner, Recipient, recoverActivity, signalId, Start } from "../processes/Process.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { type SpanRow } from "../telemetry/Trace.ts";
import { type Update as WatcherUpdate } from "./Entry.ts";
import type { Execution } from "./Execution.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input, Program, ProgramDown } from "./Program.ts";
import type { RecoveryStoreError } from "./RecoveryStore.ts";
import type { WatchersError } from "./Watchers.ts";

const SEED = 119120;
const PROCESS = Effect.runSync(processId);
const REPLACEMENT = Effect.runSync(processId);
const DOOR = Effect.runSync(processId);
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE = "0bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const BUILD = "p11-build-a";
const NAME = "queue:1";

const writer = (as: "person" | "agent" = "person") => Writer.cases[as].make({ key: `SHA256:${as}`, for: PERSON });

const owner = Writer.cases.agent.make({ key: "SHA256:owner", for: PERSON });

// Trusted, repeatable UUIDv7 fixtures. The schema checks the same brand as the real door.
const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e008${n.toString(16).padStart(12, "0")}`);

const from = (over: Partial<From> = {}): From => ({
  by: "SHA256:person",
  for: PERSON,
  sentAt: "2026-11-08T01:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
  ...over,
});

const Request = Schema.Struct({
  token: Schema.String,
  parent: Schema.NullOr(Schema.String),
  tag: Schema.String,
});
type Request = typeof Request.Type;

const Model = Schema.Struct({
  count: Schema.Int,
  replies: Schema.Int,
  busy: Schema.Boolean,
  note: Schema.String,
  queue: Schema.Array(Request),
  failures: Schema.Array(Schema.String),
  wake: Schema.NullOr(Schema.Number),
});
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("request"),
    token: Schema.String,
    parent: Schema.NullOr(Schema.String),
    tag: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("work"),
    n: Schema.Int,
    parent: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("approve") }),
  Schema.Struct({ type: Schema.Literal("comment") }),
  Schema.Struct({ type: Schema.Literal("background"), token: Schema.String, tag: Schema.String }),
  Schema.Struct({ type: Schema.Literal("throw") }),
  Schema.Struct({ type: Schema.Literal("fire") }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("schedule"), at: Schema.Number }),
]);

const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Schema.Json }),
  ok: Schema.Json,
  err: ["not_delivered", "spent", "person_only", "ended", "not_granted", "bad_cmd"],
});

const work = Cmd.make("work", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Int,
  err: ["disk"],
});

class DiskError extends Schema.TaggedError<DiskError>()("disk", {}) {}

class WorkValue extends Schema.Class<WorkValue>("WorkValue")({
  n: Schema.Int,
  extra: Schema.optionalKey(Schema.String),
}) {}

const fire = Cmd.make("fire", { input: Schema.Struct({}), ok: Schema.Null, err: ["bad_cmd"] });

const initial: Model = {
  count: 0,
  replies: 0,
  busy: false,
  queue: [],
  failures: [],
  wake: null,
  note: "private model body P11",
};

const command = (r: Request) =>
  write({
    stream: "facts",
    write:
      r.parent === null
        ? { _tag: "own", event: { _tag: r.tag, token: r.token } }
        : { _tag: "caused", parent: r.parent, event: { _tag: r.tag, token: r.token } },
  });

const nextWrite = (s: Model): readonly [Model, ReadonlyArray<ReturnType<typeof write>>] => {
  const [next, ...queue] = s.queue;
  return next === undefined ? [{ ...s, busy: false }, []] : [{ ...s, queue, busy: true }, [command(next)]];
};

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [write, work, fire],
  init: (loaded) => [loaded ?? initial, []],
  update: {
    add: (s, m) => [{ ...s, count: s.count + m.n }, []],
    approve: (s) => [s, []],
    comment: (s) => [s, []],
    request: (s, m) =>
      s.busy
        ? [{ ...s, queue: [...s.queue, { token: m.token, parent: m.parent, tag: m.tag }] }, []]
        : [{ ...s, busy: true }, [command(m)]],
    work: (s, m) => [{ ...s, busy: true }, [work({ n: m.n })]],
    background: (s, m) => [s, [command({ ...m, parent: null })]],
    throw: () => {
      throw new Error("private reducer detail");
    },
    fire: (s) => [s, [fire({})]],
    timer: (s, m) => [{ ...s, count: s.count + 1, wake: m.at + 10 }, [work({ n: m.at })]],
    schedule: (s, m) => [{ ...s, wake: m.at }, []],
    write_ok: (s) => nextWrite({ ...s, replies: s.replies + 1 }),
    write_err: (s, m) => nextWrite({ ...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag] }),
    work_ok: (s) => nextWrite({ ...s, replies: s.replies + 1 }),
    work_err: (s, m) => nextWrite({ ...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag] }),
    fire_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
    fire_err: (s, m) => [{ ...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag] }, []],
  },
});

const SavedEvent = Schema.TaggedStruct("saved", { token: Schema.String });
const Answered = Schema.TaggedStruct("answered", { token: Schema.String });
const Polled = Schema.TaggedStruct("polled", { token: Schema.String });

const authoring = (name = "queue") => ({
  name,
  machine,
  state: { v: 1, upgrades: [] },
  view: (s: Model) => s,
  refuse: (s: Model, m: typeof Msg.Type) =>
    m.type === "add" && s.count + m.n > 1000 ? { reason: "limit", now: s.count, most: 1000 } : null,
  inputs: {
    add: "Add",
    approve: { description: "Approve", personOnly: true } satisfies {
      description: string;
      personOnly: true;
    },
    comment: "Comment",
    request: "Queue a write",
    work: "Work",
    background: "Own work",
    schedule: "Schedule",
    fire: "Fire",
    throw: "Throw",
    count: Input.cases.read.make({
      schema: Schema.Null,
      description: "Read",
      answer: (v: Model) => v.count,
    }),
  },
  outputs: {},
  writes: {
    saved: { schema: SavedEvent, personOnly: false },
    answered: { schema: Answered, personOnly: true },
    polled: { schema: Polled, personOnly: false },
  },
  wake: (s: Model) => s.wake,
});

type Incoming = {
  readonly id: string;
  readonly envelope: Envelope<unknown>;
  readonly sentAt: string;
  readonly seen: number;
  readonly span: { readonly traceId: string; readonly spanId: string };
};

type Failure =
  | { readonly _tag: string; readonly reason: string }
  | NotGranted
  | WatchersError
  | RecoveryStoreError
  | SessionManagerError;

type Sent =
  | { readonly _tag: "accepted"; readonly rev: number; readonly pos: number }
  | {
      readonly _tag: "refused";
      readonly reason: string;
      readonly now?: number;
      readonly most?: number;
    };

type Opened = { readonly rev: number; readonly view: Model };

type Runner = {
  readonly open: (client: string) => Effect.Effect<Opened, Failure>;
  readonly msg: (i: Incoming) => Effect.Effect<Sent, Failure>;
  readonly due: (at: number) => Effect.Effect<void, Failure>;
};

// Decode this test program's view at its client, so changing the public View to unknown
// cannot force the builder to edit these laws.
class ViewedRunner extends Context.Service<ViewedRunner, Runner>()(
  "@kampus/libfabrika/runtime/Runner.test.ViewedRunner",
) {}

type Update =
  | { readonly type: "whole"; readonly rev: number; readonly view: Model }
  | {
      readonly type: "patch";
      readonly rev: number;
      readonly base: number;
      readonly patch: ReadonlyArray<{
        readonly op: string;
        readonly path: string;
        readonly value?: unknown;
      }>;
    };

// A case's disks: one temp folder and every connection opened in it. A world opens its files as
// its layers ask for them, so the case holds them all here. The scope that holds the disks closes
// the connections, then removes the folder (0061).
const disks = Effect.acquireRelease(
  Effect.sync(() => ({
    folder: mkdtempSync(join(tmpdir(), "p11-runner-")),
    databases: new Array<DatabaseSync>(),
    files: 0,
  })),
  ({ folder, databases }) =>
    Effect.sync(() => {
      for (const db of databases.splice(0)) {
        if (db.isOpen) {
          db.close();
        }
      }

      rmSync(folder, { recursive: true, force: true });
    }),
);

type Disks = Effect.Success<typeof disks>;

const connect = ({ databases }: Disks, path: string) => {
  const db = new DatabaseSync(path);
  // Match dev-recording.ts's WAL. Its synchronous=FULL guards against power loss, which a test
  // process cannot have; here it only made the time follow the disk (ticket 585, decision 0052).
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
  databases.push(db);
  return db;
};

const disk = (disks: Disks) => {
  const path = join(disks.folder, `${++disks.files}.db`);
  let db = connect(disks, path);
  let inner = nodeSql(db);
  const fault = { query: (_q: string) => false, once: false };
  const sql: Sql = {
    exec: (q, ...values) => {
      if (fault.once && fault.query(q)) {
        fault.once = false;
        throw new Error("SQLITE_FULL");
      }

      return inner.exec(q, ...values);
    },
    transaction: (f) => inner.transaction(f),
    size: () => inner.size(),
  };
  return {
    sql,
    fault,
    db: () => db,
    reopen: () => {
      db.close();
      db = connect(disks, path);
      inner = nodeSql(db);
    },
  };
};

const read = (stream: string) => Ledger.use((l) => Stream.runCollect(l.read(stream, 0)));

const body = (row: Entry) => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.body);

const inbox = read(`${NAME}/inbox`);
const events = read("facts");
const steps = read(PROCESS).pipe(Effect.map((rows) => rows.filter((r) => r._tag === "stepped")));

const resultLetters = inbox.pipe(
  Effect.map((rows) =>
    rows.filter((r) => {
      const m = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Struct({ type: Schema.String }) }))(r.body);
      return Option.isSome(m) && /_(ok|err)$/.test(m.value.m.type);
    }),
  ),
);

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.exit,
    Effect.map((exit) => {
      expect(Exit.isFailure(exit)).toBe(true);
      return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
    }),
  );

// Experiment 231's storage edge, supplied as ProcessStore.layer(sql, {process, storage}).
// put is buffered; only a completed sync survives an abort. No runner behavior lives here.
type ActivityStorage = {
  readonly get: (key: string) => Effect.Effect<unknown, LedgerError>;
  readonly put: (key: string, value: unknown) => Effect.Effect<void, LedgerError>;
  readonly sync: () => Effect.Effect<void, LedgerError>;
};

const activityStorage = () => {
  let durable: unknown = Activity.cases.idle.make({ process: PROCESS });
  let pending = durable;
  let aborted = false;
  const calls: Array<unknown> = [];
  const stored = <A>(f: () => A) =>
    Effect.suspend(() => (aborted ? Effect.fail(new LedgerError({ reason: "storage" })) : Effect.sync(f)));
  const storage: ActivityStorage = {
    get: (key) => stored(() => (key === "activity" ? structuredClone(pending) : undefined)),
    put: (key, value) =>
      stored(() => {
        expect(key).toBe("activity");
        calls.push({ put: structuredClone(value) });
        pending = structuredClone(value);
      }),
    sync: () =>
      stored(() => {
        calls.push("sync");
        durable = structuredClone(pending);
      }),
  };
  return {
    storage,
    calls,
    abort: () => {
      aborted = true;
      pending = structuredClone(durable);
    },
    wake: () => {
      aborted = false;
      return structuredClone(durable);
    },
  };
};

const worldOn = async (
  disks: Disks,
  options: {
    readonly name?: string;
    readonly process?: string;
    readonly build?: string;
    readonly unknownCmd?: boolean;
    readonly owner?: Writer;
    readonly storage?: ActivityStorage;
    readonly onStep?: () => void;
    readonly noPorts?: boolean;
    readonly addPort?: Schema.Codec<(typeof Msg.members)[0]["Type"]>;
    readonly execution?: (actual: Execution) => Execution;
  } = {},
) => {
  const { ProgramRunner, defaultPolicy } = await import("./Runner.ts");
  const { ProgramLoader, CheckedWriter, WatcherManager, Alarm, Recording } = await import("./Entry.ts");
  const { ProcessStore } = await import("./ProcessStore.ts");
  const coordination = await import("../coordination/index.ts");
  const store = disk(disks);
  const managerDisk = disk(disks);
  const ledgerDisk = disk(disks);
  const authority = disk(disks);
  const sink = disk(disks);
  const process = options.process ?? PROCESS;
  const checkedOwner = options.owner ?? owner;
  const normal = authoring(options.name ?? "queue");
  const ghost = Cmd.make("ghost", { input: Schema.Struct({}), ok: Schema.Null, err: [] });
  const p = Program.make({
    ...normal,
    inputs: options.noPorts ? {} : normal.inputs,
    machine:
      options.onStep === undefined
        ? machine
        : {
            ...machine,
            update: {
              ...machine.update,
              add: (s: Model, m: { readonly type: "add"; readonly n: number }) => {
                options.onStep?.();
                return [{ ...s, count: s.count + m.n }, []] as const;
              },
            },
          },
  });
  // The undeclared Cmd is an explicit broken module, not supported authoring.
  const loaded = (): unknown =>
    options.unknownCmd
      ? {
          ...p,
          machine: {
            ...machine,
            update: { ...machine.update, fire: (s: Model) => [s, [ghost({})]] as const },
          },
        }
      : options.addPort === undefined
        ? p
        : {
            ...p,
            inputs: {
              ...p.inputs,
              add: Input.cases.write.make({ schema: options.addPort, description: "Add", personOnly: false }),
            },
          };
  const published = new Map<string, Update[]>();
  const alarms: Array<number | null> = [];
  const calls: Array<{ kind: string; id: string; parent: string | null }> = [];
  const fault = {
    append: "" as "" | "before" | "after" | "refused",
    answer: false,
    commitReason: "" as "" | (typeof Appended.cases.refused.Type)["reason"],
    sign: false,
    commit: false,
    record: false,
    flush: false,
    work: "ok" as "ok" | "declared" | "undeclared" | "throw" | "malformed" | "tagged" | "class" | "non_json",
    pause: false,
    load: "" as "" | "down" | "pause" | "limit",
  };
  let fireCalls = 0;
  let workCalls = 0;
  const gate = await Effect.runPromise(Deferred.make<void>());
  const entered = await Effect.runPromise(Deferred.make<void>());
  const signCalls: Array<{ id: string; parent: string; process: string; kind: string }> = [];
  const data = () =>
    LedgerSql.layer(ledgerDisk.sql, { reader: "p11-runner" }).pipe(
      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
    );
  const sessions = () =>
    Layer.effect(
      SessionManager,
      Effect.gen(function* () {
        const actual = yield* SessionManager;
        return {
          ...actual,
          signer: (parent: string, pid: string, kind: string) =>
            Effect.gen(function* () {
              const request = yield* SignRequest;
              signCalls.push({ id: request.id, parent, process: pid, kind });
              const session = yield* actual.signer(parent, pid, kind);

              if (fault.sign) {
                fault.sign = false;
                return yield* new SessionManagerError({ reason: new Storage({ cause: new Error("unreachable") }) });
              }

              return session;
            }),
        };
      }),
    ).pipe(
      Layer.provide(
        SessionManager.layer(
          authority.sql,
          (key: string) => Effect.succeed(key === "agent" ? writer("agent") : writer()),
          {
            input: (name: string) => name === "approve",
            event: (tag: string) => p.writes[tag as keyof typeof p.writes]?.personOnly ?? false,
          },
        ),
      ),
    );
  const recordDisks = new Map<string, ReturnType<typeof disk>>();
  const records = RecordManager.sql(
    (name) => {
      const existing = recordDisks.get(name);

      if (existing !== undefined) {
        return existing.sql;
      }

      const made = disk(disks);
      recordDisks.set(name, made);
      return made.sql;
    },
    1024 * 1024 * 1024,
  );
  const monitors = () => Layer.mergeAll(SpanSink.layer(sink.sql, { object: process }), records, Archive.memory);
  const base = () => Layer.mergeAll(data(), sessions(), monitors());
  // Lose only the reply to a real answer append. The inbox row remains on disk.
  const mail = () =>
    Layer.effect(
      Mailbox,
      Effect.gen(function* () {
        const actual = yield* Mailbox;
        return {
          ...actual,
          send: (...args: Parameters<typeof actual.send>) =>
            actual.send(...args).pipe(
              Effect.flatMap((answer) => {
                if (fault.answer && args[1].endsWith("/answer")) {
                  fault.answer = false;
                  return Effect.fail(new LedgerError({ reason: "unreachable" }));
                }

                return Effect.succeed(answer);
              }),
            ),
        };
      }),
    ).pipe(Layer.provide(Mailbox.layer));
  const storageOptions = { process, storage: options.storage };
  const processStore = () =>
    Layer.effect(
      ProcessStore,
      Effect.gen(function* () {
        const actual = yield* ProcessStore;
        return {
          ...actual,
          record: (id: string, event: unknown, from: From) =>
            actual.record(id, event, from).pipe(
              Effect.flatMap((answer: unknown) => {
                if (fault.record) {
                  fault.record = false;
                  return Effect.fail(new LedgerError({ reason: "unreachable" }));
                }

                return Effect.succeed(answer);
              }),
            ),
        };
      }),
    ).pipe(Layer.provide(ProcessStore.layer(store.sql, storageOptions)));
  const input = (n: number, m: unknown, as: "person" | "agent" = "person"): Incoming => ({
    id: `letter-${n}`,
    envelope: {
      id: inputId(n),
      by: writer(as),
      arrivedAt: 1794099600000 + n,
      input: m,
    },
    sentAt: "2026-11-08T01:00:00Z",
    seen: 0,
    span: { traceId: TRACE, spanId: SPAN },
  });
  const deliver = (i: Incoming, name = "approve", to = process, personOnly = name === "approve") =>
    SessionManager.use((s) =>
      Effect.gen(function* () {
        yield* s.record({
          id: i.envelope.id,
          by: i.envelope.by,
          client: i.envelope.by._tag,
          process: to,
          name,
          personOnly,
          digest: JSON.stringify(i.envelope.input),
          traceId: i.span.traceId,
          span: i.span,
          arrivedAt: i.envelope.arrivedAt,
        });
        yield* s.delivered(i.envelope.id, to);
      }),
    );
  const wiring = () =>
    Layer.mergeAll(
      ProgramLoader.layer(
        { [p.name]: loaded() },
        {
          work: (cmd: { readonly n: number }) =>
            Effect.gen(function* () {
              workCalls++;
              yield* Deferred.succeed(entered, undefined);
              const rows = yield* inbox;
              expect(
                rows.some(
                  (row) =>
                    JSON.stringify(row.body).includes(`"n":${cmd.n}`) ||
                    JSON.stringify(row.body).includes(`"at":${cmd.n}`),
                ),
              ).toBe(true);

              if (fault.pause) {
                yield* Deferred.await(gate);
              }

              if (fault.work === "declared") {
                return Outcome.err({ _tag: "disk" });
              }

              if (fault.work === "tagged") {
                return Outcome.err(new DiskError({}));
              }

              if (fault.work === "class") {
                return Outcome.ok(new WorkValue({ n: cmd.n, extra: "outside the Cmd schema" }));
              }

              if (fault.work === "non_json") {
                return Outcome.ok(() => cmd.n);
              }

              if (fault.work === "undeclared") {
                return Outcome.err({ _tag: "other" });
              }

              if (fault.work === "throw") {
                return yield* Effect.die(new Error("private handler detail"));
              }

              return Outcome.ok(fault.work === "malformed" ? "wrong" : cmd.n);
            }),
          fire: () =>
            Effect.sync(() => {
              fireCalls++;
              return Outcome.ok(null);
            }),
        },
      ).pipe(
        Layer.flatMap((context) => {
          const actual = Context.get(context, ProgramLoader);
          return Layer.succeed(ProgramLoader, {
            load: (...args) =>
              Effect.gen(function* () {
                if (fault.load === "down") {
                  fault.load = "";
                  return yield* new ProgramDown({ reason: "load" });
                }

                if (fault.load === "pause") {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(gate);
                }

                const loaded = yield* actual.load(...args);
                return {
                  ...loaded,
                  // A new delivery limit is a journal change the load saves.
                  declaration:
                    fault.load === "limit" ? { ...loaded.declaration, maxDeliveries: 7 } : loaded.declaration,
                  execution: options.execution?.(loaded.execution) ?? loaded.execution,
                };
              }),
          });
        }),
      ),
      Layer.succeed(WatcherManager, {
        publish: (client: string, update: WatcherUpdate) =>
          Effect.sync(() => {
            const updates = published.get(client) ?? [];
            const decoded =
              update.type === "whole" ? { ...update, view: Schema.decodeUnknownSync(Model)(update.view) } : update;
            updates.push(structuredClone(decoded));
            published.set(client, updates);
          }),
      }),
      Layer.succeed(Alarm, {
        set: (at: number | null) =>
          Effect.sync(() => {
            alarms.push(at);
          }),
      }),
      Layer.effect(
        Recording,
        Effect.gen(function* () {
          const recording = yield* Recording;
          return {
            flush: Effect.gen(function* () {
              if (fault.flush) {
                return yield* new LedgerError({ reason: "storage" });
              }

              return yield* recording.flush;
            }),
          };
        }),
      ).pipe(Layer.provide(Recording.layer)),
      Layer.effect(
        CheckedWriter,
        Effect.gen(function* () {
          const mailbox = yield* Mailbox;
          const ledger = yield* Ledger;
          const s = yield* SessionManager;
          return {
            append: (i: Incoming) =>
              Effect.gen(function* () {
                if (fault.append === "before") {
                  fault.append = "";
                  return yield* new LedgerError({ reason: "unreachable" });
                }

                if (fault.append === "refused") {
                  return { _tag: "refused", reason: "seen_ahead" };
                }

                const answer = yield* mailbox.send(
                  NAME,
                  i.id,
                  i.envelope.input,
                  from({
                    by: i.envelope.by.key,
                    for: i.envelope.by.for,
                    parent: i.envelope.id,
                    traceId: i.span.traceId,
                    sentAt: i.sentAt,
                    seen: i.seen,
                  }),
                );

                if (fault.append === "after") {
                  fault.append = "";
                  return yield* new LedgerError({ reason: "unreachable" });
                }

                return answer;
              }),
            commit: (id: string, session: { readonly parent: string }, stream: string, event: { _tag: string }) =>
              Effect.gen(function* () {
                calls.push({ kind: event._tag, id, parent: session.parent });
                const checked = yield* s.receipt(id, session.parent, process, event._tag);

                if (fault.commitReason !== "") {
                  return { _tag: "refused", reason: fault.commitReason } as const;
                }

                const answer = yield* ledger.append(
                  stream,
                  id,
                  lineFor(
                    from({
                      by: checked.by.key,
                      for: checked.by.for,
                      parent: checked.parent,
                      traceId: checked.traceId,
                    }),
                    event,
                  ),
                );

                if (fault.commit) {
                  fault.commit = false;
                  return yield* new LedgerError({ reason: "unreachable" });
                }

                return answer;
              }),
            own: (id: string, stream: string, event: { _tag: string }) =>
              Effect.gen(function* () {
                calls.push({ kind: event._tag, id, parent: null });
                return yield* ledger.append(
                  stream,
                  id,
                  lineFor(from({ by: checkedOwner.key, for: checkedOwner.for }), event),
                );
              }),
          };
        }),
      ).pipe(Layer.provide(mail())),
    );
  // Ticket 402: every runner is supervised. The real manager keeps this world's process table in
  // its own ledger, its first start names this world's process, and receipts live beside
  // ProcessStore.
  let pids = 0;
  const nextPid = Effect.suspend(() => (pids++ === 0 ? Effect.succeed(process) : processId));
  const manager = () => {
    const { ProcessManager } = coordination;
    const managed = ProcessManager.layer(
      {
        by: "SHA256:brain",
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "brain", session: DOOR }),
      },
      nextPid,
    ).pipe(
      // The manager's own ledger: its process facts never land on the streams these laws read.
      Layer.provide(
        Layer.mergeAll(
          LedgerSql.layer(managerDisk.sql, { reader: "p11-manager" }),
          LedgerTransactionSql.layer(managerDisk.sql),
        ).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
      ),
    );
    const boot = Layer.effectDiscard(
      ProcessManager.use((m) =>
        m.status(NAME).pipe(
          Effect.catch(() =>
            m.start(
              Start.cases.first.make({
                id: `boot:${NAME}`,
                name: NAME,
                code: { program: p.name, hash: options.build ?? BUILD },
              }),
              from(),
            ),
          ),
        ),
      ).pipe(Effect.orDie),
    );
    return boot.pipe(Layer.provideMerge(managed));
  };
  // One built layer shares a runner/permit across concurrent inputs. Rebuilding it is a wake.
  const runner = () =>
    ProgramRunner.layer(
      {
        id: process,
        name: NAME,
        program: p.name,
        build: options.build ?? BUILD,
        owner: checkedOwner,
      },
      { recovery: { sql: store.sql, name: NAME, capacity: 1024 ** 3 } },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(wiring(), processStore(), manager()).pipe(
          Layer.provideMerge(mail().pipe(Layer.provideMerge(base()))),
        ),
      ),
    );
  const layer = () =>
    Layer.effect(
      ViewedRunner,
      Effect.gen(function* () {
        const actual = yield* ProgramRunner;
        return {
          ...actual,
          open: (client: string) =>
            actual.open(client).pipe(
              Effect.map((opened) => ({
                ...opened,
                view: Schema.decodeUnknownSync(Model)(opened.view),
              })),
            ),
        };
      }),
    ).pipe(Layer.provideMerge(runner()));
  return {
    p,
    store,
    ledgerDisk,
    authority,
    sink,
    process,
    input,
    deliver,
    fault,
    calls,
    signCalls,
    published,
    alarms,
    gate,
    entered,
    layer,
    base,
    ProgramRunner: ViewedRunner,
    // This world's wiring and program set no restart policy, so its runner keeps the default.
    policy: defaultPolicy,
    workCalls: () => workCalls,
    fireCalls: () => fireCalls,
    reopen: () => {
      store.reopen();
      managerDisk.reopen();
      ledgerDisk.reopen();
      authority.reopen();
      sink.reopen();

      for (const part of recordDisks.values()) {
        part.reopen();
      }
    },
  };
};

// One case: its body builds worlds on disks that the test's scope gives back.
const onDisks = <A>(
  body: (world: (options?: Parameters<typeof worldOn>[1]) => ReturnType<typeof worldOn>) => Promise<A>,
) => disks.pipe(Effect.flatMap((disks) => Effect.promise(() => body((options) => worldOn(disks, options)))));

describe("ticket 884, next/ brain mail", () => {
  // Independent of the new helper: this is the reserved wire format in A-BrainMail.
  const notice = (key: string) => JSON.stringify(["notice", key]);
  const appendNotice = (id: string, m: Schema.Json) =>
    Ledger.use((l) => l.append(`${NAME}/inbox`, id, letterLine(from({ by: "SHA256:brain" }), m)));

  it.live.prop(
    "B1: brain letters step a machine without ports once each and survive a storage reopen",
    [Arbitrary.array(Arbitrary.schema(Msg.members[0]), { minLength: 1, maxLength: 30 })],
    ([msgs]) =>
      onDisks(async (world) => {
        const w = await world({ noPorts: true });
        let model = machine.init(null, {})[0];
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;

            for (const [index, msg] of msgs.entries()) {
              // Keep every move within the real program's refusal limit.
              const next = { ...msg, n: Math.abs(msg.n % 10) };
              expect(yield* appendNotice(notice(String(index)), next)).toMatchObject({ _tag: "placed" });
              [model] = applyCell(machine, model, next);
              expect((yield* r.open(`notice-${index}`)).view).toEqual(model);
            }

            expect((yield* steps).map((row) => body(row).input)).toEqual(msgs.map((_, i) => notice(String(i))));
          }).pipe(Effect.provide(w.layer())),
        );
        w.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            expect((yield* r.open("reopened")).view).toEqual(model);
            expect(yield* steps).toHaveLength(msgs.length);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  it.live.prop(
    "B2: a person, agent or recovered device cannot send brain mail by either door",
    [Schema.Literals(["person", "agent", "recovered"])],
    ([sender]) =>
      onDisks(async (world) => {
        const w = await world({ noPorts: true });
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            const before = (yield* r.open("before")).view;
            const by =
              sender === "recovered"
                ? Writer.cases.person.make({ key: "SHA256:recovered", for: PERSON })
                : writer(sender);

            for (const id of ["client-letter", notice("client-letter")]) {
              const input = w.input(1, { type: "add", n: 7 });
              expect(yield* r.msg({ ...input, id, envelope: { ...input.envelope, by } })).toEqual({
                _tag: "refused",
                reason: "bad_msg",
              });
              expect(yield* inbox).toEqual([]);
            }

            const mailbox = yield* Mailbox;
            expect(yield* mailbox.send(NAME, notice("mail"), { type: "add", n: 7 }, from({ by: by.key }))).toEqual({
              _tag: "refused",
              reason: "forbidden",
            });
            expect(yield* inbox).toEqual([]);
            expect(yield* mailbox.send(NAME, "plain-mail", { type: "add", n: 7 }, from({ by: by.key }))).toMatchObject({
              _tag: "placed",
            });
            expect((yield* r.open("after")).view).toEqual(before);
            expect((yield* inbox).map((row) => row.id)).toEqual(["plain-mail"]);
            expect(yield* steps).toEqual([]);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    { arbitrary: { seed: SEED } },
  );

  it.live.prop(
    "B3: a refused or throwing brain letter is skipped without down and the next good letter steps",
    [
      Arbitrary.schema(Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7])).pipe(
        Arbitrary.map(
          (index): Schema.Json =>
            [
              { type: "unknown" },
              { type: "add", n: "bad" },
              { type: "timer", at: 42 },
              { type: "work_ok", cmd: { type: "work", n: 1 }, value: 1, at: 42 },
              null,
              { type: "add", n: 7, parent: "forged" },
              { type: "throw" },
              { type: "add", n: 1001 },
            ][index]!,
        ),
      ),
    ],
    ([bad]) =>
      onDisks(async (world) => {
        const w = await world({ noPorts: true });
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            const before = (yield* r.open("before")).view;
            yield* appendNotice(notice("bad"), bad);
            expect((yield* r.open("bad")).view).toEqual(before);
            expect((yield* read(PROCESS)).filter((row) => row._tag === "down")).toEqual([]);
            expect(yield* steps).toEqual([]);
            yield* appendNotice(notice("good"), { type: "add", n: 2 });
            expect((yield* r.open("good")).view).toEqual({ ...before, count: 2 });
            expect((yield* steps).map((row) => body(row).input)).toEqual([notice("good")]);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    { arbitrary: { seed: SEED } },
  );

  it.live.prop(
    "mail admission: a throwing port schema is skipped, later opens and valid mail work, and notices bypass the port",
    [Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))],
    ([n]) =>
      onDisks(async (world) => {
        const checked: Array<number> = [];
        const w = await world({
          addPort: Msg.members[0].check(
            Schema.makeFilter((m) => {
              checked.push(m.n);

              if (m.n < 0) {
                throw new Error("port schema failed");
              }

              return true;
            }),
          ),
        });
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            const before = (yield* r.open("before")).view;
            const mailbox = yield* Mailbox;
            yield* mailbox.send(NAME, "throwing-port", { type: "add", n: -n }, from());
            expect((yield* r.open("bad-port")).view).toEqual(before);
            expect((yield* r.open("after-bad-port")).view).toEqual(before);
            expect(checked).toEqual([-n]);
            expect(yield* ProcessStore.use((s) => s.placed("throwing-port"))).toBeNull();
            expect(yield* steps).toEqual([]);

            // The same Msg is valid brain mail even though this client's port would throw.
            yield* appendNotice(notice("bypass-port"), { type: "add", n: -n });
            expect((yield* r.open("brain-mail")).view).toEqual({ ...before, count: -n });
            expect(checked).toEqual([-n]);
            yield* mailbox.send(NAME, "good-port", { type: "add", n: n + 1 }, from());
            expect((yield* r.open("good-port")).view).toEqual({ ...before, count: 1 });
            expect(checked).toEqual([-n, n + 1]);
            expect((yield* r.open("after-good-port")).view).toEqual({ ...before, count: 1 });
            expect((yield* steps).map((row) => body(row).input)).toEqual([notice("bypass-port"), "good-port"]);
            expect((yield* read(PROCESS)).filter((row) => row._tag === "down")).toEqual([]);
          }).pipe(Effect.provide(w.layer())),
        );
        w.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            expect((yield* r.open("reopened")).view).toEqual({ ...initial, count: 1 });
            expect(yield* steps).toHaveLength(2);
            expect(checked).toEqual([-n, n + 1]);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    { arbitrary: { seed: SEED } },
  );

  it.live.prop(
    "mail admission: RPC and decode failures propagate and the next open retries the same letter",
    [
      Schema.Literals(["rpc", "decode"]),
      Schema.Literals(["admit", "step"]),
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
    ],
    ([source, point, n]) =>
      onDisks(async (world) => {
        let failing = true;
        const error = new ProgramDown({ reason: "step", source });
        const w = await world({
          execution: (actual) => ({
            ...actual,
            admit: (m) => (failing && point === "admit" ? Effect.fail(error) : actual.admit(m)),
            step: (model, m) => (failing && point === "step" ? Effect.fail(error) : actual.step(model, m)),
          }),
        });
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            const before = (yield* r.open("before")).view;
            const mailbox = yield* Mailbox;
            yield* mailbox.send(NAME, "retry-mail", { type: "add", n }, from());
            expect(yield* failure(r.open("failed"))).toMatchObject({ _tag: "ProgramDown", reason: "step", source });
            expect(yield* steps).toEqual([]);
            expect(yield* ProcessStore.use((s) => s.placed("retry-mail"))).toBeNull();
            failing = false;
            expect((yield* r.open("retry")).view).toEqual({ ...before, count: n });
            expect((yield* steps).map((row) => body(row).input)).toEqual(["retry-mail"]);
            yield* mailbox.send(NAME, "later-mail", { type: "add", n: 1 }, from());
            expect((yield* r.open("later")).view).toEqual({ ...before, count: n + 1 });
            expect((yield* steps).map((row) => body(row).input)).toEqual(["retry-mail", "later-mail"]);
            expect((yield* read(PROCESS)).filter((row) => row._tag === "down")).toEqual([]);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    { arbitrary: { seed: SEED } },
  );
});

describe("P11 activity durability, experiment 231", () => {
  it.live("plant, skip sync: the runner puts stepping, completes sync, then starts the step", () =>
    onDisks(async (world) => {
      const activity = activityStorage();
      const w = await world({
        storage: activity.storage,
        onStep: () => activity.calls.push("step"),
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect(yield* r.msg(w.input(1, { type: "add", n: 1 }))).toMatchObject({ _tag: "accepted" });
          const step = activity.calls.indexOf("step");
          expect(step).toBeGreaterThanOrEqual(0);
          expect(activity.calls.slice(0, step + 1).slice(-3)).toEqual([
            { put: Activity.cases.stepping.make({ process: PROCESS, letter: "letter-1", build: BUILD }) },
            "sync",
            "step",
          ]);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.effect.prop(
    "plant, buffered marker: an abort at the start of the step wakes as interrupted, never idle",
    { generated: Schema.Int.check(Schema.isLessThanOrEqualTo(1000)) },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) =>
          onDisks(async (world) => {
            const activity = activityStorage();
            let starts = 0;
            const w = await world({
              storage: activity.storage,
              onStep: () => {
                starts++;
                activity.abort();
                throw new Error("object aborted at step entry");
              },
            });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                expect(yield* failure(r.msg(w.input(1, { type: "add", n: value })))).toMatchObject({
                  _tag: "ProgramDown",
                  reason: "step",
                });
              }).pipe(Effect.provide(w.layer())),
            );
            expect(starts).toBe(1);
            expect(Result.getOrThrow(recoverActivity(activity.wake()))).toEqual({
              _tag: "interrupted",
              process: PROCESS,
              letter: "letter-1",
              build: BUILD,
              reason: "interrupted",
            });
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("p14 turns and watcher revisions", () => {
  it.live("plant, keep every client forever: the 1,025th opens and evicts the least recently seen", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;

          for (let n = 0; n < 1024; n++) {
            yield* r.open(`client-${n}`);
          }

          // Refresh the first client, so insertion order alone picks the wrong eviction.
          yield* r.open("client-0");
          expect(yield* r.open("client-1024")).toEqual({ rev: 0, view: initial });
          yield* r.msg(w.input(1, { type: "add", n: 1 }));
          expect(w.published.get("client-1")).toEqual([{ type: "whole", rev: 0, view: initial }]);

          for (let n = 0; n <= 1024; n++) {
            if (n === 1) {
              continue;
            }

            expect(w.published.get(`client-${n}`)?.at(-1)).toMatchObject({
              type: "patch",
              base: 0,
              rev: 1,
            });
          }
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("plant, remove the permit: concurrent bursts accept every input once with consecutive positions", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.open("a");
          yield* r.open("b");
          const messages = Array.from({ length: 24 }, (_, i) => w.input(i + 1, { type: "add", n: 1 }));
          const answers = yield* Effect.forEach(messages, (m) => r.msg(m), {
            concurrency: "unbounded",
          });
          expect(answers.every((a) => a._tag === "accepted")).toBe(true);
          expect(answers.map((a) => (a._tag === "accepted" ? a.pos : -1)).sort((a, b) => a - b)).toEqual(
            Array.from({ length: 24 }, (_, i) => i + 1),
          );
          expect(yield* inbox).toHaveLength(24);
          expect((yield* r.open("inspect")).view.count).toBe(24);

          for (const client of ["a", "b"]) {
            expect(w.published.get(client)?.map((u) => u.rev)).toEqual(Array.from({ length: 25 }, (_, i) => i));
          }
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("plant, confuse global rev with inbox pos: unrelated writes cause no watcher gaps", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          const ledger = yield* Ledger;
          yield* r.open("a");
          yield* r.msg(w.input(1, { type: "add", n: 2 }));
          yield* ledger.append("elsewhere", "noise", lineFor(from(), { _tag: "noise" }));
          yield* r.msg(w.input(2, { type: "add", n: 3 }));
          expect(w.published.get("a")?.map((u) => u.rev)).toEqual([0, 1, 2]);
          expect((yield* r.open("inspect")).view.count).toBe(5);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
});

describe("p22 refusal and p25 thrown steps", () => {
  for (const [label, msg, answer] of [
    ["bad fresh shape", { type: "add", n: "bad" }, { _tag: "refused", reason: "bad_msg" }],
    ["program refusal", { type: "add", n: 1001 }, { _tag: "refused", reason: "limit", now: 0, most: 1000 }],
  ] as const) {
    it.effect.prop(
      `plant, append before refusal: ${label} changes no history, view or Cmd`,
      {
        generated: label === "program refusal" ? Schema.Int.check(Schema.isGreaterThan(1000)) : Schema.String,
      },
      ({ generated }) =>
        Effect.forEach(
          [msg.n, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  const before = yield* r.open("a");
                  expect(yield* r.msg(w.input(1, { ...msg, n: value }))).toEqual(answer);
                  expect(yield* inbox).toEqual([]);
                  expect(yield* steps).toEqual([]);
                  expect((yield* r.open("inspect")).view).toEqual(before.view);
                  expect(w.published.get("a")).toHaveLength(1);
                  expect(w.workCalls()).toBe(0);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "plant, turn throw into refusal: a fresh throw leaves no accepted input, result or Cmd",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["private reducer detail", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            Object.assign(w.p.machine.update, {
              throw: () => {
                throw new Error(value);
              },
            });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* r.open("a");
                expect(yield* failure(r.msg(w.input(1, { type: "throw" })))).toMatchObject({
                  _tag: "ProgramDown",
                  reason: "step",
                });
                expect(yield* inbox).toEqual([]);
                expect(yield* steps).toEqual([]);
                expect(w.workCalls()).toBe(0);
                expect(w.published.get("a")).toHaveLength(1);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, skip a bad saved letter: recovery preserves all letters and accepts no later input",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["bad", generated],
        (poison) =>
          onDisks(async (world) => {
            const w = await world();
            await Effect.runPromise(
              Effect.gen(function* () {
                const m = yield* Mailbox;
                const placed: Array<{ id: string; rev: number; pos: number }> = [];

                for (const [id, value] of [
                  ["good-a", 1],
                  ["bad", poison],
                  ["good-b", 2],
                ] as const) {
                  const sent = yield* m.send(NAME, id, { type: "add", n: value }, from());

                  if (sent._tag === "placed") {
                    placed.push({ id, rev: sent.rev, pos: sent.pos });
                  }
                }

                // These letters were accepted before the saved model. Only accepted poison is down.
                yield* ProcessStore.use((s) =>
                  s.save({ saved: { v: 1, build: BUILD, model: initial, after: 0 }, turn: null, cmds: [] }, placed),
                );
              }).pipe(
                Effect.provide(
                  Layer.mergeAll(Mailbox.layer, ProcessStore.layer(w.store.sql, { process: PROCESS })).pipe(
                    Layer.provide(w.base()),
                  ),
                ),
              ),
            );
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                const before = yield* inbox;
                expect(yield* failure(r.open("a"))).toMatchObject({
                  _tag: "ProgramDown",
                  reason: "saved_letter",
                });
                expect(yield* failure(r.msg(w.input(4, { type: "add", n: 3 })))).toMatchObject({
                  _tag: "ProgramDown",
                });
                expect(yield* inbox).toEqual(before);
                expect(w.published.size).toBe(0);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("p35 Cmd order, replay and recorded failures", () => {
  for (const [mode, ok, answer, failures] of [
    ["tagged", Schema.Int, { type: "work_err", error: { _tag: "disk" }, reason: "disk" }, ["disk"]],
    ["class", Schema.Struct({ n: Schema.Int }), { type: "work_ok", value: { n: 29 } }, []],
    ["non_json", Schema.Unknown, { type: "work_err", error: { _tag: "bad_cmd" }, reason: "bad_cmd" }, ["bad_cmd"]],
  ] as const) {
    it.effect.prop(
      `plant, save raw ${mode} handler answer: encode it or save bad_cmd, then step once`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [29, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              w.fault.work = mode;
              const declared = Cmd.make("work", {
                input: Schema.Struct({ n: Schema.Int }),
                ok,
                err: ["disk"],
              });
              Object.assign(
                w.p,
                Program.make({
                  ...authoring(w.p.name),
                  machine: { ...machine, cmds: [write, declared, fire] },
                }),
              );
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  expect(yield* r.msg(w.input(1, { type: "work", n: value }))).toMatchObject({
                    _tag: "accepted",
                  });
                  const answers = yield* resultLetters;
                  expect(answers).toHaveLength(1);
                  expect(answers[0]?.body).toMatchObject({
                    m: mode === "class" ? { ...answer, value: { n: value } } : answer,
                  });

                  if (mode === "tagged") {
                    const saved = Schema.decodeUnknownSync(Schema.Struct({ m: Schema.Struct({ error: DiskError }) }))(
                      answers[0]!.body,
                    );
                    expect(saved.m.error).toBeInstanceOf(DiskError);
                  }

                  if (mode === "class") {
                    const saved = Schema.decodeUnknownSync(Schema.Struct({ m: Schema.Struct({ value: WorkValue }) }))(
                      answers[0]!.body,
                    );
                    expect(saved.m.value).toEqual(new WorkValue({ n: value }));
                  }

                  expect((yield* r.open("answered")).view).toMatchObject({ replies: 1, failures });
                  expect((yield* ProcessStore.use((s) => s.load))?.cmds).toEqual([]);
                }).pipe(Effect.provide(w.layer())),
              );
              w.reopen();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  expect((yield* r.open("after-wake")).view).toMatchObject({ replies: 1, failures });
                  expect(yield* resultLetters).toHaveLength(1);
                  expect(w.workCalls()).toBe(1);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.live("plant, fire before append: a real handler sees its saved input before it runs", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect(yield* r.msg(w.input(1, { type: "work", n: 17 }))).toMatchObject({ _tag: "accepted" });
          expect(w.workCalls()).toBe(1);
          expect(yield* resultLetters).toHaveLength(1);
          expect((yield* r.open("a")).view.replies).toBe(1);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );

  for (const at of ["before", "refused"] as const) {
    it.live(`plant, dispatch after ${at} append: no handler, patch or alarm escapes`, () =>
      onDisks(async (world) => {
        const w = await world();
        w.fault.append = at;
        await Effect.runPromise(
          Effect.gen(function* () {
            const r: Runner = yield* w.ProgramRunner;
            yield* r.open("a");
            const alarmCount = w.alarms.length;
            const result = yield* Effect.exit(r.msg(w.input(1, { type: "work", n: 19 })));
            expect(Exit.isFailure(result) || (Exit.isSuccess(result) && result.value._tag === "refused")).toBe(true);
            expect(w.workCalls()).toBe(0);
            expect(yield* inbox).toEqual([]);
            expect(w.published.get("a")).toHaveLength(1);
            expect(w.alarms).toHaveLength(alarmCount);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  for (const [mode, reason] of [
    ["declared", "disk"],
    ["undeclared", "bad_cmd"],
    ["throw", "handler_failed"],
    ["malformed", "bad_cmd"],
  ] as const) {
    it.effect.prop(
      `plant, drop ${mode} result: one saved failure with reason reaches update once`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [23, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              w.fault.work = mode;
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  yield* r.msg(w.input(1, { type: "work", n: value }));
                  const answers = yield* resultLetters;
                  expect(answers).toHaveLength(1);
                  expect(answers[0]?.body).toMatchObject({ m: { type: "work_err", reason } });
                  expect((yield* r.open("inspect")).view.replies).toBe(1);
                }).pipe(Effect.provide(w.layer())),
              );
              w.reopen();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  expect((yield* r.open("after-wake")).view.replies).toBe(1);
                  expect(yield* resultLetters).toHaveLength(1);
                  expect(w.workCalls()).toBe(1);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  for (const name of ["fabrika/chaos", "chaos", "queue"]) {
    it.effect.prop(
      `fire in ${name} is owned only by the exact qualified chaos program`,
      { generated: Schema.NonEmptyString },
      ({ generated }) =>
        Effect.forEach(
          [name, generated, `${generated}/chaos`, `${generated}/fabrika/chaos`],
          (value) =>
            onDisks(async (world) => {
              const w = await world({ name: value });
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  yield* r.msg(w.input(1, { type: "fire" }));
                  expect(w.fireCalls()).toBe(value === "fabrika/chaos" ? 1 : 0);
                  expect(yield* resultLetters).toHaveLength(1);
                  expect((yield* resultLetters)[0]?.body).toMatchObject({
                    m: {
                      type: value === "fabrika/chaos" ? "fire_ok" : "fire_err",
                      ...(value === "fabrika/chaos" ? {} : { error: { _tag: "bad_cmd" }, reason: "bad_cmd" }),
                    },
                  });
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.live("plant, execute folded Cmds: wake rebuilds state from inbox without calling handlers", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const sent = yield* Mailbox.use((m) => m.send(NAME, "prior-work", { type: "work", n: 27 }, from()));
          expect(sent._tag).toBe("placed");

          if (sent._tag === "placed") {
            yield* ProcessStore.use((s) =>
              s.save({ saved: { v: 1, build: BUILD, model: initial, after: 0 }, turn: null, cmds: [] }, [
                { id: "prior-work", rev: sent.rev, pos: sent.pos },
              ]),
            );
          }
        }).pipe(
          Effect.provide(
            Layer.mergeAll(Mailbox.layer, ProcessStore.layer(w.store.sql, { process: PROCESS })).pipe(
              Layer.provide(w.base()),
            ),
          ),
        ),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.open("a");
          expect(w.workCalls()).toBe(0);
          expect(yield* resultLetters).toHaveLength(0);
          expect(yield* inbox).toHaveLength(1);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.effect.prop(
    "A-Timer: asking for the same wake after a new input delivers a second timer with its own arrival",
    {
      asked: Schema.Union([Schema.Literal(0), Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 }))]),
      lag: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    },
    ({ asked, lag }) =>
      Effect.gen(function* () {
        const w = yield* disks.pipe(
          Effect.flatMap((on) =>
            Effect.tryPromise({
              try: () => worldOn(on),
              catch: (cause: unknown): Error => new Error("Runner fixture failed", { cause }),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          const arrivals = [1_000_000 + asked + lag, 1_000_000 + asked + lag * 2];
          const ids: Array<string> = [];

          for (const [n, arrivedAt] of arrivals.entries()) {
            yield* r.msg(w.input(n + 1, { type: "schedule", at: asked }));
            const before = yield* r.open("scheduled");
            expect(before.view.wake).toBe(asked);
            ids.push(`${PROCESS}/due/${asked}/${before.rev}`);
            yield* TestClock.setTime(arrivedAt);
            yield* r.due(before.view.wake!);
            const timers = (yield* inbox).filter((row) => row.id.includes("/due/"));
            expect((yield* r.open("delivered")).view).toMatchObject({
              count: n + 1,
              replies: n + 1,
              wake: asked + 10,
            });
            expect(timers.map((row) => body(row).m)).toEqual(
              arrivals.slice(0, n + 1).map((clock) => ({ type: "timer", at: asked, arrivedAt: clock })),
            );
            expect(w.workCalls()).toBe(n + 1);
          }

          expect((yield* inbox).filter((row) => row.id.includes("/due/")).map((row) => row.id)).toEqual(ids);
          expect(new Set(ids).size).toBe(2);
        }).pipe(Effect.provide(w.layer()));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
  it.effect.prop(
    "A-Timer: a due repeated after a failed step keeps one letter and its first arrival",
    {
      asked: Schema.Union([Schema.Literal(0), Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 }))]),
      lag: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    },
    ({ asked, lag }) =>
      Effect.gen(function* () {
        const w = yield* disks.pipe(
          Effect.flatMap((on) =>
            Effect.tryPromise({
              try: () => worldOn(on),
              catch: (cause: unknown): Error => new Error("Runner fixture failed", { cause }),
            }),
          ),
        );
        const arrivedAt = 1_000_000 + asked + lag;
        yield* Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.msg(w.input(1, { type: "schedule", at: asked }));
          const before = yield* r.open("scheduled");
          const saved = yield* ProcessStore.use((store) => store.load);
          w.fault.record = true;
          yield* TestClock.setTime(arrivedAt);
          expect(yield* failure(r.due(asked))).toMatchObject({ _tag: "LedgerError" });
          const first = (yield* inbox).filter((row) => row.id.includes("/due/"));
          expect(first).toHaveLength(1);
          expect(first[0]!.id).toBe(`${PROCESS}/due/${asked}/${before.rev}`);
          expect(body(first[0]!).m).toEqual({ type: "timer", at: asked, arrivedAt });
          expect(yield* ProcessStore.use((store) => store.load)).toEqual(saved);
          expect(w.workCalls()).toBe(0);
          yield* TestClock.adjust(lag);
          yield* r.due(asked);
          expect((yield* inbox).filter((row) => row.id.includes("/due/"))).toEqual(first);
          expect((yield* r.open("repeated")).view).toMatchObject({ count: 1, wake: asked + 10 });
        }).pipe(Effect.provide(w.layer()));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
  // The drain retries only a storage failure: LedgerError or RecoveryStoreError. Each fault lands
  // on a woken runner before it holds a live state, so the program's own wake cannot hide the
  // retry alarm. The recovery fault needs a journal save in that window: a new delivery limit.
  const drainFaults = {
    ledger: { failure: "LedgerError", retries: true },
    recovery: { failure: "RecoveryStoreError", retries: true },
    down: { failure: "ProgramDown", retries: false },
    interrupt: { failure: "interrupted", retries: false },
  } as const;
  it.effect.prop(
    "A-Timer: only a storage failure in a drain sets the retry alarm, one backoff after the failure",
    {
      asked: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
      lag: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
    },
    ({ asked, lag }) =>
      Effect.forEach(
        Object.entries(drainFaults),
        ([fault, { failure, retries }]) =>
          Effect.gen(function* () {
            const w = yield* disks.pipe(
              Effect.flatMap((on) =>
                Effect.tryPromise({
                  try: () => worldOn(on),
                  catch: (cause: unknown): Error => new Error("Runner fixture failed", { cause }),
                }),
              ),
            );
            yield* Effect.gen(function* () {
              const r: Runner = yield* w.ProgramRunner;
              yield* r.msg(w.input(1, { type: "schedule", at: asked }));
              expect((yield* r.open("scheduled")).view.wake).toBe(asked);
            }).pipe(Effect.provide(w.layer()));
            const now = 1_000_000 + asked + lag;
            const before = [...w.alarms];
            const failing =
              fault === "ledger" ? "SELECT checkpoint FROM process_state" : "INSERT INTO process_recovery";
            w.store.fault.query = (q) => q.startsWith(failing);
            w.store.fault.once = fault === "ledger" || fault === "recovery";
            w.fault.load =
              fault === "recovery" ? "limit" : fault === "down" ? "down" : fault === "interrupt" ? "pause" : "";
            yield* Effect.gen(function* () {
              const r: Runner = yield* w.ProgramRunner;
              yield* TestClock.setTime(now);
              const draining = yield* r.due(asked).pipe(Effect.exit, Effect.forkChild);
              // An interrupted drain is cut while it loads the program; the others end on their own.
              yield* Deferred.await(w.entered).pipe(Effect.race(Fiber.await(draining)));
              yield* Fiber.interrupt(draining);
              const exit = yield* Fiber.await(draining);
              const failed = Exit.isFailure(exit)
                ? Cause.hasInterrupts(exit.cause) && "interrupted"
                : Exit.isFailure(exit.value) && Option.getOrUndefined(Cause.findErrorOption(exit.value.cause))?._tag;
              expect(failed).toBe(failure);
              expect(w.store.fault.once).toBe(false);
              expect(w.alarms).toEqual(retries ? [...before, now + w.policy.backoff.minMs] : before);
            }).pipe(Effect.provide(w.layer()));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: SEED, runs: 25 } },
  );
  it.effect.prop(
    "A-Timer: a due writes no timer when the program asks for no wake or a later wake",
    {
      at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
      gap: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    },
    ({ at, gap }) =>
      Effect.gen(function* () {
        const w = yield* disks.pipe(
          Effect.flatMap((on) =>
            Effect.tryPromise({
              try: () => worldOn(on),
              catch: (cause: unknown): Error => new Error("Runner fixture failed", { cause }),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect((yield* r.open("initial")).view.wake).toBeNull();
          const initialRows = yield* inbox;
          const initialSteps = yield* steps;
          yield* r.due(at);
          expect(yield* inbox).toEqual(initialRows);
          expect(yield* steps).toEqual(initialSteps);
          yield* r.msg(w.input(1, { type: "schedule", at: at + gap }));
          const scheduled = yield* r.open("later");
          const scheduledRows = yield* inbox;
          const scheduledSteps = yield* steps;
          expect(scheduled.view.wake).toBeGreaterThan(at);
          yield* r.due(at);
          expect(yield* inbox).toEqual(scheduledRows);
          expect(yield* steps).toEqual(scheduledSteps);
          expect(yield* r.open("unchanged")).toEqual(scheduled);
          expect(w.workCalls()).toBe(0);
        }).pipe(Effect.provide(w.layer()));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
  it.live("plant, mint a new timer id: a repeated due time saves and fires exactly once", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.msg(w.input(1, { type: "schedule", at: 40 }));
          yield* r.due(40);
          yield* r.due(40);
          expect(w.workCalls()).toBe(1);
          expect((yield* r.open("a")).view).toMatchObject({ count: 1, replies: 1, wake: 50 });
          expect((yield* inbox).filter((row) => JSON.stringify(row.body).includes('"type":"timer"'))).toHaveLength(1);
          expect(w.alarms.at(-1)).toBe(50);
        }).pipe(Effect.provide(w.layer())),
      );
      w.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.due(40);
          expect(w.workCalls()).toBe(1);
          expect((yield* r.open("wake")).view.count).toBe(1);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("plant, re-fire an unanswered dispatch: an interrupted handler remains visible after wake", () =>
    onDisks(async (world) => {
      const w = await world();
      w.fault.pause = true;
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          const running = yield* r.msg(w.input(1, { type: "work", n: 31 })).pipe(Effect.forkChild);
          yield* Deferred.await(w.entered);
          yield* Fiber.interrupt(running);
          expect(w.workCalls()).toBe(1);
          expect(yield* resultLetters).toHaveLength(0);
        }).pipe(Effect.provide(w.layer())),
      );
      w.reopen();
      w.fault.pause = false;
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect((yield* r.open("a")).rev).toBe(1);
          expect(w.workCalls()).toBe(1);
          expect(yield* resultLetters).toHaveLength(0);
          const tables = w.store.db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const saved = tables.map(({ name }) =>
            w.store
              .db()
              .prepare(`SELECT * FROM "${String(name)}"`)
              .all(),
          );
          expect(JSON.stringify(saved)).toContain("dispatched");
          expect(JSON.stringify(saved)).toContain("31");
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
});

describe("p69 sender survives queued work and Cmd replies", () => {
  it.effect.prop(
    "p69 plant, strip a mail parent: mail cannot borrow an unspent person approval",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["borrowed", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const person = w.input(1, { type: "request", token: "person", tag: "answered" });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(person, "approve");
                const m = yield* Mailbox;
                expect(
                  yield* m.send(
                    NAME,
                    "borrowed-mail",
                    { type: "request", token: value, parent: person.envelope.id, tag: "answered" },
                    from({ by: writer("agent").key }),
                  ),
                ).toMatchObject({ _tag: "placed" });
                expect((yield* r.open("mail-parent")).view).toEqual(initial);
                expect(yield* steps).toEqual([]);
                expect(yield* ProcessStore.use((s) => s.placed("borrowed-mail"))).toBeNull();
                expect(yield* events).toEqual([]);
                expect(w.signCalls).toEqual([]);
                expect(w.authority.db().prepare("SELECT count(*) AS n FROM gateway_receipts").get()?.n).toBe(0);
                // Mail still works on a public port; only the borrowed parent is refused.
                yield* m.send(NAME, "ordinary-mail", { type: "add", n: 2 }, from());
                expect((yield* r.open("ordinary")).view.count).toBe(2);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const as of ["person", "agent"] as const) {
    it.live(`p69 plant, admit person-only mail: mail from ${as} cannot use a person-only port`, () =>
      onDisks(async (world) => {
        const w = await world();
        Object.assign(
          w.p,
          Program.make({
            ...authoring(w.p.name),
            inputs: { ...authoring().inputs, add: { description: "Person add", personOnly: true } },
          }),
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const r: Runner = yield* w.ProgramRunner;
            expect(
              yield* Mailbox.use((m) =>
                m.send(NAME, "person-only-mail", { type: "add", n: 7 }, from({ by: writer(as).key })),
              ),
            ).toMatchObject({ _tag: "placed" });
            expect((yield* r.open("person-only")).view).toEqual(initial);
            expect(yield* steps).toEqual([]);
            expect(yield* ProcessStore.use((s) => s.placed("person-only-mail"))).toBeNull();
            // The same port works for a checked person input through the door.
            expect(yield* r.msg(w.input(2, { type: "add", n: 3 }))).toMatchObject({ _tag: "accepted" });
            expect((yield* r.open("door-person")).view.count).toBe(3);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  it.live("plant, trust every process-prefixed mail id: a forged Cmd reply is refused", () =>
    onDisks(async (world) => {
      const w = await world();
      const id = `${PROCESS}/1/0`;
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect(
            yield* Mailbox.use((m) =>
              m.send(NAME, id, { type: "work_ok", cmd: { type: "work", n: 7 }, value: 7, at: 1 }, from()),
            ),
          ).toMatchObject({ _tag: "placed" });
          expect((yield* r.open("forged-reply")).view).toEqual(initial);
          expect(yield* steps).toEqual([]);
          expect(yield* ProcessStore.use((s) => s.placed(id))).toBeNull();
          expect(w.workCalls()).toBe(0);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );

  for (const parent of [null, inputId(1), inputId(99), `in-${DOOR}-1`, `in-${DOOR}-99`]) {
    it.live(`p69 plant, silently strip client parent ${parent}: refuse it before stepping or appending`, () =>
      onDisks(async (world) => {
        const w = await world();
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            expect(yield* r.msg(w.input(1, { type: "add", n: 1, parent }))).toMatchObject({
              _tag: "refused",
            });
            expect(yield* inbox).toEqual([]);
            expect((yield* r.open("client-parent")).view).toMatchObject({ count: 0 });
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  it.effect.prop(
    "p69 plant, trust a client parent: an agent cannot borrow an unspent person approval in the same process",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["borrowed", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const person = w.input(1, {
              type: "request",
              token: "person",
              tag: "answered",
            });
            const agent = w.input(
              2,
              { type: "request", token: value, parent: person.envelope.id, tag: "answered" },
              "agent",
            );
            await Effect.runPromise(
              Effect.gen(function* () {
                const r = yield* w.ProgramRunner;
                // P10 has delivered both to this process. The person's press has never reached the
                // program or spent a receipt. Cross-process and spent-parent guards cannot save us.
                yield* w.deliver(person, "approve");
                yield* w.deliver(agent, "comment");
                expect(w.authority.db().prepare("SELECT count(*) AS n FROM gateway_receipts").get()?.n).toBe(0);
                const sent = yield* r.msg(agent);
                expect(yield* events, "an agent input must never produce a person-signed answered").toEqual([]);
                expect(sent).toMatchObject({ _tag: "refused" });
                expect(w.signCalls).toEqual([]);
                expect(yield* inbox).toEqual([]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p69 plant, omit the door stamp: a parent-free input gives the program its own envelope id",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const Stamped = Schema.Struct({
              type: Schema.Literal("work"),
              n: Schema.Int,
              parent: Schema.optionalKey(Schema.String),
            });
            Object.assign(
              w.p,
              Program.make({
                ...authoring(w.p.name),
                machine: {
                  ...machine,
                  update: {
                    ...machine.update,
                    work: (s: Model, m: typeof Stamped.Type) => [
                      { ...s, note: m.parent ?? "no stamped parent" },
                      m.parent === undefined
                        ? []
                        : [
                            write({
                              stream: "facts",
                              write: {
                                _tag: "caused",
                                parent: m.parent,
                                event: { _tag: "saved", token: "stamped" },
                              },
                            }),
                          ],
                    ],
                  },
                },
              }),
            );
            const input = w.input(1, { type: "work", n: value }, "agent");
            await Effect.runPromise(
              Effect.gen(function* () {
                const r = yield* w.ProgramRunner;
                yield* w.deliver(input, "comment");
                expect(yield* r.msg(input)).toMatchObject({ _tag: "accepted" });
                expect((yield* r.open("stamp")).view).toMatchObject({ note: input.envelope.id });
                expect((yield* events).map((row) => ({ by: row.by, parent: row.parent }))).toEqual([
                  { by: writer("agent").key, parent: input.envelope.id },
                ]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, pair Cmd with latest Msg: a person's completion releases an agent's queued write",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["b", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            w.fault.pause = true;
            const a = w.input(1, { type: "work", n: 37 });
            const b = w.input(2, { type: "request", token: value, tag: "saved" }, "agent");
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(a);
                yield* w.deliver(b, "comment");
                const running = yield* r.msg(a).pipe(Effect.forkChild);
                yield* Deferred.await(w.entered);
                yield* r.msg(b);
                expect((yield* r.open("queued")).view.queue).toEqual([
                  { token: value, parent: b.envelope.id, tag: "saved" },
                ]);
                yield* Deferred.succeed(w.gate, undefined);
                yield* Fiber.join(running);
                const rows = yield* events;
                expect(rows.map((row) => ({ token: body(row).token, by: row.by, parent: row.parent }))).toEqual([
                  { token: value, by: writer("agent").key, parent: b.envelope.id },
                ]);
                expect((yield* r.open("done")).view).toMatchObject({ queue: [], replies: 2 });
                expect(w.signCalls).toMatchObject([{ parent: b.envelope.id, process: PROCESS, kind: "saved" }]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, read expected writers from returned parents: generated inputs keep an independent sender table",
    { generated: Schema.Array(Schema.Boolean).check(Schema.isMinLength(8), Schema.isMaxLength(16)) },
    ({ generated }) =>
      Effect.forEach(
        [undefined, generated],
        (value) =>
          onDisks(async (world) => {
            const generated = fc.sample(fc.array(fc.boolean(), { minLength: 8, maxLength: 16 }), {
              seed: SEED,
              numRuns: 1,
            })[0]!;
            const senders = value ?? generated;
            const w = await world();
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                const expected: Array<{ token: string; by: string; parent: string | null }> = [];

                for (const [index, asPerson] of senders.entries()) {
                  const token = `request-${index}`;
                  const as = asPerson ? "person" : "agent";
                  const m = w.input(index + 1, { type: "request", token, tag: "saved" }, as);
                  expected.push({ token, by: writer(as).key, parent: m.envelope.id });
                  yield* w.deliver(m, "comment");
                  yield* r.msg(m);
                }

                const own = w.input(99, { type: "background", token: "own", tag: "polled" });
                yield* r.msg(own);
                expected.push({ token: "own", by: owner.key, parent: null });
                expect(
                  (yield* events).map((row) => ({
                    token: body(row).token,
                    by: row.by,
                    parent: row.parent,
                  })),
                ).toEqual(expected);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const [scenario, reason, as, inputName, parentProcess] of [
    ["undelivered", "not_delivered", "person", "approve", PROCESS],
    ["another process", "not_delivered", "person", "approve", REPLACEMENT],
    ["person comment", "person_only", "person", "comment", PROCESS],
    ["agent comment", "person_only", "agent", "comment", PROCESS],
    ["agent approval", "person_only", "agent", "approve", PROCESS],
    ["ended process", "ended", "person", "approve", PROCESS],
  ] as const) {
    it.effect.prop(
      `plant, fall back to owner: ${scenario} writes nothing and records ${reason}`,
      { generated: Request.fields.token },
      ({ generated }) =>
        Effect.forEach(
          ["refused", generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              const i = w.input(1, { type: "request", token: value, tag: "answered" }, as);
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  const s = yield* SessionManager;

                  if (scenario !== "undelivered") {
                    yield* w.deliver(i, inputName, parentProcess);
                  }

                  if (scenario === "ended process") {
                    yield* s.end(PROCESS);
                  }

                  yield* r.msg(i);
                  expect(yield* events).toEqual([]);
                  expect(w.calls.filter((c) => c.parent === null)).toEqual([]);
                  expect((yield* resultLetters).at(-1)?.body).toMatchObject({
                    m: { type: "write_err", reason },
                  });
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "plant, spend by Cmd position: a second answered with the same parent is refused",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["first", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            Object.assign(
              w.p,
              Program.make({
                ...authoring(w.p.name),
                machine: {
                  ...machine,
                  update: {
                    ...machine.update,
                    request: (s: Model, m: Request) => [s, [command(m), command({ ...m, token: "second" })]],
                  },
                },
              }),
            );
            const first = w.input(1, { type: "request", token: value, tag: "answered" });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(first);
                yield* r.msg(first);
                expect((yield* events).map((row) => body(row).token)).toEqual([value]);
                expect((yield* resultLetters).at(-1)?.body).toMatchObject({ m: { reason: "spent" } });
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, own bypasses personOnly: even a person-owned process needs a qualifying parent",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["own-approval", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world({ owner: writer("person") });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* r.msg(w.input(1, { type: "background", token: value, tag: "answered" }));
                expect(yield* events).toEqual([]);
                expect(w.calls, "the runner must refuse before reaching the permissive own writer").toEqual([]);
                expect((yield* resultLetters).at(-1)?.body).toMatchObject({
                  m: { reason: "person_only" },
                });
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const lost of ["sign", "commit"] as const) {
    it.effect.prop(
      `plant, new write id after lost ${lost} reply: retry uses the saved receipt and places once`,
      { generated: Request.fields.token },
      ({ generated }) =>
        Effect.forEach(
          ["retry", generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              w.fault[lost] = true;
              const i = w.input(1, { type: "request", token: value, tag: "saved" }, "agent");
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  yield* w.deliver(i, "comment");
                  yield* Effect.exit(r.msg(i));
                }).pipe(Effect.provide(w.layer())),
              );
              w.reopen();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  expect(yield* r.msg(i)).toMatchObject({ _tag: "accepted" });
                  expect((yield* events).map((row) => ({ by: row.by, parent: row.parent }))).toEqual([
                    { by: writer("agent").key, parent: i.envelope.id },
                  ]);
                  expect(w.signCalls.length).toBeGreaterThanOrEqual(2);
                  expect(new Set(w.signCalls.map((call) => call.id)).size).toBe(1);
                  expect(
                    (yield* resultLetters).filter((row) => JSON.stringify(row.body).includes("write_ok")),
                  ).toHaveLength(1);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "plant, sender table in runner memory: a queued parent survives a same-process storage wake",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["queued-after-wake", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            w.fault.pause = true;
            const a = w.input(1, { type: "work", n: 41 });
            const b = w.input(2, { type: "request", token: value, tag: "saved" }, "agent");
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(a);
                yield* w.deliver(b, "comment");
                const running = yield* r.msg(a).pipe(Effect.forkChild);
                yield* Deferred.await(w.entered);
                yield* r.msg(b);
                yield* Fiber.interrupt(running);
              }).pipe(Effect.provide(w.layer())),
            );
            w.reopen();
            w.fault.pause = false;
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                expect((yield* r.open("wake")).view.queue).toEqual([
                  { token: value, parent: b.envelope.id, tag: "saved" },
                ]);
                // A late brain-written answer, not a fresh client input.
                yield* Ledger.use((ledger) =>
                  ledger.append(
                    `${NAME}/inbox`,
                    `${PROCESS}/1/0/answer`,
                    lineFor(from({ parent: a.envelope.id }), {
                      _tag: "send",
                      m: Schema.decodeUnknownSync(Schema.Json)(work.ok(work({ n: 41 }), 41, 1794099600003)),
                    }),
                  ),
                );
                yield* r.open("late-answer");
                expect((yield* ProcessStore.use((s) => s.load))?.cmds).toMatchObject([
                  { cmd: { type: "write", write: { _tag: "caused", parent: b.envelope.id } } },
                ]);
                const session = yield* SessionManager.use((s) => s.signer(b.envelope.id, PROCESS, "saved")).pipe(
                  Effect.provideService(SignRequest, { id: `${PROCESS}/3/0` }),
                );
                expect(session).toMatchObject({ by: writer("agent"), parent: b.envelope.id });
                expect(yield* events).toEqual([]);
                expect(w.workCalls()).toBe(1);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, reuse old authority after replacement: old parent cannot sign for a new process id",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["old-queue", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world({ process: REPLACEMENT });
            const i = w.input(1, { type: "request", token: value, tag: "saved" }, "agent");
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                const s = yield* SessionManager;
                yield* w.deliver(i, "comment", PROCESS);
                yield* s.end(PROCESS);
                yield* r.msg(i);
                expect(yield* events).toEqual([]);
                expect((yield* resultLetters).at(-1)?.body).toMatchObject({
                  m: { reason: "not_delivered" },
                });
                expect(w.signCalls).toMatchObject([{ process: REPLACEMENT, parent: i.envelope.id }]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P11 review: fresh input, accepted history, and brain-only ids", () => {
  for (const msg of [
    { type: "work_ok", cmd: work({ n: 1 }), value: 1, at: 42 },
    {
      type: "write_ok",
      cmd: write({ stream: "facts", write: { _tag: "own", event: { _tag: "polled", token: "forged" } } }),
      value: {},
      at: 42,
    },
    { type: "timer", at: 42 },
  ]) {
    it.effect.prop(
      `plant, accept a client answer: fresh ${msg.type} cannot settle work or fire the timer`,
      { generated: Schema.Record(Schema.String, Schema.Json) },
      ({ generated }) =>
        Effect.forEach(
          [msg, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r = yield* w.ProgramRunner;
                  yield* r.open("before");
                  expect(yield* r.msg(w.input(1, { ...value, type: msg.type }))).toMatchObject({
                    _tag: "refused",
                    reason: "bad_msg",
                  });
                  expect(yield* inbox).toEqual([]);
                  expect(w.workCalls()).toBe(0);
                  expect((yield* r.open("after")).view).toMatchObject({ count: 0, replies: 0 });
                  expect(w.published.get("before")).toHaveLength(1);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.live("plant, fold every inbox row: unaccepted mail goes through the fresh refusal", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* w.ProgramRunner;
          yield* r.msg(w.input(1, { type: "add", n: 800 }));
          const mailbox = yield* Mailbox;
          expect(yield* mailbox.send(NAME, "outside-limit", { type: "add", n: 300 }, from())).toMatchObject({
            _tag: "placed",
          });
          expect((yield* r.open("after-mail")).view).toMatchObject({ count: 800 });
          expect(yield* ProcessStore.use((s) => s.placed("outside-limit"))).toBeNull();
          expect(yield* r.msg(w.input(2, { type: "add", n: 1 }))).toMatchObject({ _tag: "accepted" });
          expect((yield* r.open("still-live")).view).toMatchObject({ count: 801 });
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );

  for (const [label, m] of [
    ["bad input", { type: "add", n: "bad" }],
    ["malformed value", null],
    ["forged settled reply", { type: "work_ok", cmd: work({ n: 1 }), value: 1, at: 42 }],
    ["throwing fresh input", { type: "throw" }],
  ] as const) {
    it.live(`plant, treat other mail as accepted: receive is total for ${label}`, () =>
      onDisks(async (world) => {
        const w = await world();
        await Effect.runPromise(
          Effect.gen(function* () {
            const mailbox = yield* Mailbox;
            expect(yield* mailbox.send(NAME, "outside", m, from())).toMatchObject({ _tag: "placed" });
            const r = yield* w.ProgramRunner;
            const received = yield* Effect.exit(r.open("mail"));
            expect(received._tag, "other mail cannot fail the process").toBe("Success");

            if (Exit.isSuccess(received)) {
              expect(received.value.view).toMatchObject({ count: 0, replies: 0 });
            }

            expect(yield* r.msg(w.input(1, { type: "add", n: 2 }))).toMatchObject({ _tag: "accepted" });
            expect((yield* r.open("still-live")).view).toMatchObject({ count: 2, replies: 0 });
            expect(yield* inbox).toHaveLength(2);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  it.effect.prop(
    "plant, fold DOWN as a saved Msg: a real P33 signal cannot mark its recipient down",
    { generated: Down.fields.reason },
    ({ generated }) =>
      Effect.forEach(
        [{ _tag: "shutdown" } as const, generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const to = Recipient.cases.process.make({ process: PROCESS });
            const down = Down.make({ ref: "child", process: REPLACEMENT, reason: value, to });
            await Effect.runPromise(
              Effect.gen(function* () {
                const ledger = yield* Ledger;
                expect(
                  yield* ledger.append(
                    `${NAME}/inbox`,
                    signalId(to, "child", 1),
                    lineFor(from({ by: "SHA256:brain" }), { _tag: "send", m: down }),
                  ),
                ).toMatchObject({ _tag: "placed" });
                const r = yield* w.ProgramRunner;
                const opened = yield* Effect.exit(r.open("down-mail"));
                expect(opened._tag, "DOWN is fresh mail, never a corrupt accepted letter").toBe("Success");

                if (Exit.isSuccess(opened)) {
                  expect(opened.value.view).toMatchObject({ count: 0 });
                }

                expect(yield* r.msg(w.input(1, { type: "add", n: 1 }))).toMatchObject({
                  _tag: "accepted",
                });
                expect((yield* r.open("still-live")).view).toMatchObject({ count: 1 });
                expect((yield* read(PROCESS)).filter((row) => row._tag === "down")).toEqual([]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const id of [`${PROCESS}/1/0/answer`, `${PROCESS}/due/42/0`]) {
    it.effect.prop(
      `plant, leave ${id} public: mail cannot squat on a runner-owned id`,
      {
        generated: Arbitrary.all({
          process: processIds,
          n: Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        }).pipe(
          Arbitrary.map(({ process, n }) =>
            id.includes("/due/") ? `${process}/due/${n}/${n}` : `${process}/${n}/0/answer`,
          ),
        ),
      },
      ({ generated }) =>
        Effect.forEach(
          [id, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const mailbox = yield* Mailbox;
                  expect(yield* mailbox.send(NAME, value, { type: "add", n: 999 }, from())).toEqual({
                    _tag: "refused",
                    reason: "forbidden",
                  });
                  expect(yield* inbox).toEqual([]);
                }).pipe(Effect.provide(Mailbox.layer.pipe(Layer.provideMerge(w.base())))),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
    it.live(`plant, authorize ${id}: a caused write cannot spend a parent under a runner-owned id`, () =>
      onDisks(async (world) => {
        const w = await world();
        const input = w.input(1, { type: "add", n: 1 });
        await Effect.runPromise(
          Effect.gen(function* () {
            yield* w.deliver(input);
            const sessions = yield* SessionManager;
            const refused = yield* Effect.exit(
              sessions.signer(input.envelope.id, PROCESS, "saved").pipe(Effect.provideService(SignRequest, { id })),
            );
            expect(refused._tag, "runner ids never acquire a signing receipt").toBe("Failure");
            expect(w.authority.db().prepare("SELECT count(*) AS n FROM gateway_receipts").get()?.n).toBe(0);
            expect(
              yield* sessions
                .signer(input.envelope.id, PROCESS, "saved")
                .pipe(Effect.provideService(SignRequest, { id: "real-write" })),
            ).toMatchObject({ parent: input.envelope.id });
          }).pipe(Effect.provide(w.base())),
        );
      }),
    );
    it.live(`plant, trust an Incoming id: a client delivery cannot claim ${id}`, () =>
      onDisks(async (world) => {
        const w = await world();
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            const sent = yield* r.msg({ ...w.input(1, { type: "add", n: 1 }), id });
            expect(sent).toMatchObject({ _tag: "refused" });
            expect(yield* inbox).toEqual([]);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }
});

describe("P11 review: write boundaries, ports, and watcher bounds", () => {
  for (const stream of ["processes", "processes/other:1", "other:1/inbox", "client:other/inbox"]) {
    for (const signing of ["own", "caused"] as const) {
      it.effect.prop(
        `plant, trust a valid event on ${stream}: ${signing} write is refused before commit`,
        { generated: Request.fields.token },
        ({ generated }) =>
          Effect.forEach(
            ["forbidden", generated],
            (value) =>
              onDisks(async (world) => {
                const w = await world();
                Object.assign(
                  w.p,
                  Program.make({
                    ...authoring(w.p.name),
                    machine: {
                      ...machine,
                      update: {
                        ...machine.update,
                        work: (s: Model) => [
                          s,
                          [
                            write({
                              stream,
                              write:
                                signing === "own"
                                  ? { _tag: "own", event: { _tag: "polled", token: value } }
                                  : {
                                      _tag: "caused",
                                      parent: inputId(1),
                                      event: { _tag: "saved", token: value },
                                    },
                            }),
                          ],
                        ],
                      },
                    },
                  }),
                );
                const input = w.input(1, { type: "work", n: 1 });
                await Effect.runPromise(
                  Effect.gen(function* () {
                    const r = yield* w.ProgramRunner;
                    yield* w.deliver(input, "comment");
                    yield* r.msg(input);
                    expect(w.calls, "no checked commit may be attempted on this stream").toEqual([]);
                    expect(yield* read(stream)).toEqual([]);
                    expect((yield* resultLetters).map((row) => row.body)).toMatchObject([
                      { m: { type: "write_err", reason: expect.any(String) } },
                    ]);
                  }).pipe(Effect.provide(w.layer())),
                );
              }),
            { concurrency: 1, discard: true },
          ),
        { arbitrary: { seed: 119120, runs: 12 } },
      );
    }
  }

  for (const reason of ["seen_ahead", "id_reused"] as const) {
    it.effect.prop(
      `plant, replace refused commit reason with bad_cmd: ${reason} survives in the saved answer`,
      { generated: Appended.cases.refused.fields.reason },
      ({ generated }) =>
        Effect.forEach(
          [reason, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              w.fault.commitReason = value;
              Object.assign(
                w.p,
                Program.make({
                  ...authoring(w.p.name),
                  machine: {
                    ...machine,
                    update: {
                      ...machine.update,
                      work: (s: Model) => [s, [command({ token: "refused-commit", parent: inputId(1), tag: "saved" })]],
                    },
                  },
                }),
              );
              const input = w.input(1, { type: "work", n: 1 });
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r = yield* w.ProgramRunner;
                  yield* w.deliver(input, "comment");
                  yield* r.msg(input);
                  expect(w.calls).toHaveLength(1);
                  expect((yield* resultLetters).map((row) => row.body)).toMatchObject([
                    { m: { type: "write_err", reason: value, error: { _tag: value } } },
                  ]);
                  expect(yield* events).toEqual([]);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  for (const port of ["read", "personOnly"] as const) {
    it.live(`plant, treat port policy as documentation: ${port} port cannot accept an agent write`, () =>
      onDisks(async (world) => {
        const w = await world();
        Object.assign(
          w.p,
          Program.make({
            ...authoring(w.p.name),
            inputs: {
              add:
                port === "read"
                  ? Input.cases.read.make({
                      schema: Msg,
                      description: "Read count",
                      answer: (v: Model) => v.count,
                    })
                  : { description: "Person add", personOnly: true },
            },
          }),
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* w.ProgramRunner;
            yield* r.open("before");
            expect(yield* r.msg(w.input(1, { type: "add", n: 4 }, "agent"))).toMatchObject({
              _tag: "refused",
            });
            expect(yield* inbox).toEqual([]);
            expect((yield* r.open("after")).view).toMatchObject({ count: 0 });
            expect(w.published.get("before")).toHaveLength(1);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  it.live("plant, accept unlimited client text: a 257-character id is refused before registering a watcher", () =>
    onDisks(async (world) => {
      const w = await world();
      const over = "c".repeat(257);
      await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* w.ProgramRunner;
          yield* r.open("c".repeat(256));
          expect((yield* Effect.exit(r.open(over)))._tag).toBe("Failure");
          yield* r.msg(w.input(1, { type: "add", n: 1 }));
          expect(w.published.has(over)).toBe(false);
          expect(w.published.get("c".repeat(256))).toHaveLength(2);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("plant, retain every client forever: watcher fanout stays bounded across repeated opens", () =>
    onDisks(async (world) => {
      const w = await world();
      // A finite test workload, not the exact product cap. A smaller refusal or eviction cap
      // passes too. This also catches a limit that counts repeat opens as new clients.
      const most = 1024;
      await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* w.ProgramRunner;
          yield* r.open("repeat");

          for (let n = 0; n <= most; n++) {
            yield* r.open("repeat");
          }

          for (let n = 0; n <= most; n++) {
            yield* Effect.exit(r.open(`client-${n}`));
          }

          w.published.clear();
          yield* r.msg(w.input(1, { type: "add", n: 1 }));
          expect(w.published.size, "one process cannot retain every client ever opened").toBeLessThanOrEqual(most);
          expect(w.published.size).toBeGreaterThan(0);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
});

describe("P11 recovery gaps and durable installation", () => {
  for (const cut of ["after append", "after stepped", "before checkpoint"] as const) {
    for (const wake of [false, true]) {
      it.live(
        `p35 plant, save only mine: ${cut}, ${wake ? "wake" : "same runner"} keeps a Cmd visibly unanswered`,
        () =>
          onDisks(async (world) => {
            const w = await world();
            const i = w.input(1, { type: "work", n: 71 });

            if (cut === "after append") {
              w.fault.append = "after";
            }

            if (cut === "after stepped") {
              w.fault.record = true;
            }

            if (cut === "before checkpoint") {
              w.store.fault.once = true;
              w.store.fault.query = (q) =>
                q.startsWith("INSERT INTO process_state") &&
                Number(w.ledgerDisk.db().prepare("SELECT count(*) AS n FROM entries WHERE _tag='stepped'").get()?.n) >
                  0;
            }

            const inspect = Effect.gen(function* () {
              const r = yield* w.ProgramRunner;
              yield* r.open("inspect-gap");
              expect((yield* inbox).map((row) => row.id)).toEqual([i.id]);
              expect(w.workCalls()).toBe(0);
              expect((yield* ProcessStore.use((s) => s.load))?.cmds).toMatchObject([
                { id: `${PROCESS}/1/0`, state: "dispatched", cmd: { type: "work", n: 71 } },
              ]);
            });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r = yield* w.ProgramRunner;
                expect(yield* failure(r.msg(i))).toMatchObject({ _tag: "LedgerError" });

                if (!wake) {
                  yield* inspect;
                }
              }).pipe(Effect.provide(w.layer())),
            );

            if (wake) {
              w.reopen();
              await Effect.runPromise(inspect.pipe(Effect.provide(w.layer())));
            }
          }),
      );
    }
  }

  it.effect.prop(
    "p35 plant, retire only options.done: folding a saved write answer prevents another commit",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["once", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            Object.assign(
              w.p,
              Program.make({
                ...authoring(w.p.name),
                machine: {
                  ...machine,
                  update: {
                    ...machine.update,
                    work: (s: Model) => [
                      s,
                      [
                        write({
                          stream: "facts",
                          write: { _tag: "own", event: { _tag: "polled", token: value } },
                        }),
                      ],
                    ],
                  },
                },
              }),
            );
            w.fault.answer = true;
            await Effect.runPromise(
              Effect.gen(function* () {
                const r = yield* w.ProgramRunner;
                expect(yield* failure(r.msg(w.input(1, { type: "work", n: 1 })))).toMatchObject({
                  _tag: "LedgerError",
                });
                expect(yield* resultLetters).toHaveLength(1);
                expect(w.calls).toHaveLength(1);
              }).pipe(Effect.provide(w.layer())),
            );
            w.reopen();
            await Effect.runPromise(
              Effect.gen(function* () {
                const r = yield* w.ProgramRunner;
                const opened = yield* Effect.exit(r.open("answer-wake"));
                expect(w.calls, "the saved answer already settles this write").toHaveLength(1);
                expect(Exit.isSuccess(opened)).toBe(true);
                expect((yield* ProcessStore.use((s) => s.load))?.cmds).toEqual([]);
                expect(yield* events).toHaveLength(1);
                expect(yield* resultLetters).toHaveLength(1);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.live("p35 plant, drop replayed follow-ups: an answer folded on wake saves its new Cmd without running it", () =>
    onDisks(async (world) => {
      const w = await world();
      Object.assign(
        w.p,
        Program.make({
          ...authoring(w.p.name),
          machine: {
            ...machine,
            update: { ...machine.update, work_ok: (s: Model) => [s, [work({ n: 73 })]] },
          },
        }),
      );
      w.fault.answer = true;
      await Effect.runPromise(
        w.ProgramRunner.use((r) => failure(r.msg(w.input(1, { type: "work", n: 72 })))).pipe(Effect.provide(w.layer())),
      );
      w.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* w.ProgramRunner;
          yield* r.open("follow-up-wake");
          expect(w.workCalls()).toBe(1);
          const saved = yield* ProcessStore.use((s) => s.load);
          expect(
            saved?.cmds.filter(
              (cmd) => typeof cmd === "object" && cmd !== null && "id" in cmd && cmd.id === `${PROCESS}/2/0`,
            ),
          ).toMatchObject([{ id: `${PROCESS}/2/0`, state: "dispatched", cmd: { type: "work", n: 73 } }]);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("opening after a failed append clears the prepared turn without accepting its input", () =>
    onDisks(async (world) => {
      const w = await world();
      const { ProcessStore } = await import("./ProcessStore.ts");
      w.fault.append = "before";
      await Effect.runPromise(
        w.ProgramRunner.use((r) => failure(r.msg(w.input(1, { type: "add", n: 7 })))).pipe(Effect.provide(w.layer())),
      );
      w.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect(yield* r.open("a")).toMatchObject({ rev: 0, view: { count: 0 } });
          expect(yield* ProcessStore.use((s) => s.load)).toMatchObject({
            saved: { after: 0, model: { count: 0 } },
            turn: null,
          });
          expect(yield* inbox).toEqual([]);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.effect.prop(
    "an async handler result schema produces a saved bad_cmd reply",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [23, generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const broken: unknown = {
              machine: {
                ...w.p.machine,
                cmds: [
                  write,
                  {
                    ...work,
                    schema: {
                      ...work.schema,
                      ok: {
                        "~standard": { validate: (value: unknown) => Promise.resolve({ value }) },
                      },
                    },
                  },
                  fire,
                ],
              },
            };
            Object.assign(w.p, broken);
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                expect((yield* r.msg(w.input(1, { type: "work", n: value })))._tag).toBe("accepted");
                expect((yield* resultLetters).map((row) => row.body)).toMatchObject([
                  { m: { type: "work_err", reason: "bad_cmd" } },
                ]);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const cut of ["before append", "after append", "after stepped", "before checkpoint"] as const) {
    it.live(`plant, trust a prepared model: recovery ${cut} saves one accepted input at its original placing`, () =>
      onDisks(async (world) => {
        const w = await world();
        const i = w.input(1, { type: "add", n: 7 });

        if (cut === "before append") {
          w.fault.append = "before";
        }

        if (cut === "after append") {
          w.fault.append = "after";
        }

        if (cut === "after stepped") {
          w.fault.record = true;
        }

        if (cut === "before checkpoint") {
          w.store.fault.once = true;
          w.store.fault.query = (q) =>
            /^\s*(INSERT|UPDATE|REPLACE)/i.test(q) &&
            Boolean(w.ledgerDisk.db().prepare("SELECT name FROM sqlite_master WHERE name='entries'").get()) &&
            Number(w.ledgerDisk.db().prepare("SELECT count(*) AS n FROM entries WHERE _tag='stepped'").get()?.n) > 0;
        }

        await Effect.runPromise(
          Effect.gen(function* () {
            const r: Runner = yield* w.ProgramRunner;
            expect(yield* failure(r.msg(i))).toMatchObject({ _tag: "LedgerError" });
          }).pipe(Effect.provide(w.layer())),
        );
        w.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const r: Runner = yield* w.ProgramRunner;
            const answer = yield* r.msg(i);
            const letters = yield* inbox;
            expect(letters).toHaveLength(1);
            expect(answer).toEqual({ _tag: "accepted", rev: letters[0]!.rev, pos: letters[0]!.pos });
            expect(yield* r.open("a")).toMatchObject({
              rev: letters[0]!.pos,
              view: { count: 7 },
            });
            expect(yield* steps).toHaveLength(1);
            expect((yield* steps)[0]).toMatchObject({ body: { input: i.id, pos: 1 }, build: BUILD });
            expect(w.workCalls()).toBe(0);
          }).pipe(Effect.provide(w.layer())),
        );
      }),
    );
  }

  it.live("plant, check refusal before duplicate id: resend returns the original placing despite later state", () =>
    onDisks(async (world) => {
      const w = await world();
      const i = w.input(1, { type: "add", n: 800 });
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          const answer = yield* r.msg(i);
          yield* r.msg(w.input(2, { type: "add", n: 100 }));
          expect(yield* r.msg({ ...i, seen: 999999, sentAt: "retry clock" })).toEqual(answer);
          expect((yield* r.open("a")).view.count).toBe(900);
          expect(yield* inbox).toHaveLength(2);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.live("S3 plant, replace without recording: a successful upgrade records ran and the new build", () =>
    onDisks(async (world) => {
      const w = await world({ build: "new-build" });
      const Legacy = Schema.Struct({ n: Schema.Int });
      const Middle = Schema.Struct({ count: Schema.Int });
      const upgrades = [
        {
          name: "n_to_count",
          from: 1,
          run: (raw: unknown) => ({ count: Schema.decodeUnknownSync(Legacy)(raw).n }),
        },
        {
          name: "add_runtime",
          from: 2,
          run: (raw: unknown) => ({ ...initial, count: Schema.decodeUnknownSync(Middle)(raw).count }),
        },
      ];
      Object.assign(w.p, Program.make({ ...authoring(w.p.name), state: { v: 3, upgrades } }));
      const { ProcessStore } = await import("./ProcessStore.ts");
      await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* ProcessStore;
          yield* store.save({
            saved: { v: 1, build: "old-build", after: 0, model: { n: 9 } },
            turn: null,
            cmds: [],
          });
        }).pipe(Effect.provide(ProcessStore.layer(w.store.sql, { process: PROCESS }).pipe(Layer.provide(w.base())))),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect((yield* r.open("a")).view.count).toBe(9);
          const rows = yield* read(PROCESS);
          expect(rows.filter((row) => row._tag === "state.upgraded")).toMatchObject([
            {
              build: "new-build",
              body: { program: "queue", from: 1, to: 3, ran: ["n_to_count", "add_runtime"] },
            },
          ]);
        }).pipe(Effect.provide(w.layer())),
      );
      w.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect((yield* r.open("b")).view.count).toBe(9);
          expect((yield* read(PROCESS)).filter((row) => row._tag === "state.upgraded")).toHaveLength(1);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.effect.prop(
    "plant, accept an undeclared event: caller-supplied personOnly cannot authorize a write",
    {
      generated: Request.fields.tag.check(Schema.makeFilter((tag) => !["saved", "answered", "polled"].includes(tag))),
    },
    ({ generated }) =>
      Effect.forEach(
        ["granted", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const i = w.input(1, {
              type: "request",
              token: "undeclared",
              tag: value,
              personOnly: false,
            });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(i, "comment");
                yield* r.msg(i);
                expect(yield* events).toEqual([]);
                expect(w.signCalls).toEqual([]);
                expect(w.calls).toEqual([]);
                expect((yield* resultLetters).at(-1)?.body).toMatchObject({ m: { reason: "bad_cmd" } });
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const tag of ["granted", "started", "stepped", "state.upgraded"]) {
    it.effect.prop(
      `plant, trust a forbidden declaration: programs cannot emit ${tag} even if declared`,
      { generated: Request.fields.token },
      ({ generated }) =>
        Effect.forEach(
          ["reserved", generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();
              Object.assign(
                w.p,
                Program.make({
                  ...authoring(w.p.name),
                  writes: {
                    ...authoring().writes,
                    [tag]: {
                      schema: Schema.TaggedStruct(tag, { token: Schema.String }),
                      personOnly: false,
                    },
                  },
                }),
              );
              const i = w.input(1, { type: "request", token: value, tag });
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  yield* w.deliver(i);
                  yield* r.msg(i);
                  expect(yield* events).toEqual([]);
                  expect(w.signCalls).toEqual([]);
                  expect((yield* resultLetters).at(-1)?.body).toMatchObject({
                    m: { reason: "bad_cmd" },
                  });
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "S3 plant, overwrite before decoding: a rejected saved model keeps its old SQL value",
    { generated: Schema.Int.check(Schema.isGreaterThan(1)) },
    ({ generated }) =>
      Effect.forEach(
        [999, generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const { ProcessStore } = await import("./ProcessStore.ts");
            const saved = {
              saved: { v: value, model: { n: 3 }, after: 0, build: "future-build" },
              turn: null,
              cmds: [],
            };
            const storeLayer = () =>
              ProcessStore.layer(w.store.sql, { process: PROCESS }).pipe(Layer.provide(w.base()));
            await Effect.runPromise(
              Effect.gen(function* () {
                const store = yield* ProcessStore;
                yield* store.save(saved);
              }).pipe(Effect.provide(storeLayer())),
            );
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                expect(yield* failure(r.open("a"))).toMatchObject({
                  _tag: "ProgramDown",
                  reason: "saved_state",
                });
              }).pipe(Effect.provide(w.layer())),
            );
            w.reopen();
            await Effect.runPromise(
              Effect.gen(function* () {
                const store = yield* ProcessStore;
                expect(yield* store.load).toEqual(saved);
              }).pipe(Effect.provide(storeLayer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, let unknown Cmd disappear: it produces a saved bad_cmd answer",
    { generated: Schema.Json },
    ({ generated }) =>
      Effect.forEach(
        [{}, generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world({ unknownCmd: true });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* r.msg(w.input(1, { type: "fire", extra: value }));
                expect(w.fireCalls()).toBe(0);
                expect((yield* resultLetters).at(-1)?.body).toMatchObject({ m: { reason: "bad_cmd" } });
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P11 monitoring, content and storage failures", () => {
  const recorded = (process = PROCESS) => RecordManager.use((r) => Stream.runCollect(r.read({ _tag: "job", process })));
  it.live("plant, flush before spans end: step, Cmd, write, due and open reach the process JobRecord", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          yield* r.open("a");
          const i = w.input(1, { type: "request", token: "linked", tag: "saved" }, "agent");
          yield* w.deliver(i, "comment");
          yield* r.msg(i);
          yield* r.due(50);
          const rows: ReadonlyArray<SpanRow> = yield* recorded();

          for (const name of ["runner.open", "runner.step", "runner.cmd", "runner.write", "runner.due"]) {
            expect(rows.some((row) => row.name === name)).toBe(true);
          }

          const linked = rows.filter((row) => row.name === "runner.write");
          expect(rows.find((row) => row.name === "runner.cmd")?.attributes).toMatchObject({
            "fab.process": PROCESS,
            "fab.runner.cmd": "write",
            "fab.runner.id": w.signCalls[0]!.id,
          });
          expect(linked[0]?.attributes["fab.runner.stream"]).toBe("facts");
          expect(linked.some((row) => row.links.some((link) => link.traceId === TRACE && link.spanId === SPAN))).toBe(
            true,
          );
          expect(linked.some((row) => Object.values(row.attributes).includes(w.signCalls[0]!.id))).toBe(true);
          expect(w.sink.db().prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );
  it.effect.prop(
    "plant, use traceId as authority: changed trace context cannot replace the direct parent sender",
    { generated: Request.fields.token },
    ({ generated }) =>
      Effect.forEach(
        ["trace", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            const agent = w.input(1, { type: "request", token: value, tag: "saved" }, "agent");
            const person = w.input(2, { type: "add", n: 1 });
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* w.deliver(agent, "comment");
                yield* w.deliver({ ...person, span: { traceId: OTHER_TRACE, spanId: SPAN } });
                yield* r.msg({ ...agent, span: { traceId: OTHER_TRACE, spanId: SPAN } });
                expect((yield* events)[0]).toMatchObject({
                  by: writer("agent").key,
                  parent: agent.envelope.id,
                  traceId: TRACE,
                });
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, tag bodies or error messages: failures keep class, with content deletable separately",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["test deletion", generated],
        (value) =>
          onDisks(async (world) => {
            const w = await world();
            w.fault.work = "throw";
            const marker = "private handler detail";
            const signature = "made-up signature bytes P11";
            await Effect.runPromise(
              Effect.gen(function* () {
                const r: Runner = yield* w.ProgramRunner;
                yield* r.msg(w.input(1, { type: "work", n: 59, signature, body: "private model body P11" }));
                const rows: ReadonlyArray<SpanRow> = yield* recorded();
                const tags = JSON.stringify(
                  rows.map((row) => ({
                    attributes: row.attributes,
                    events: row.events,
                    links: row.links,
                  })),
                );
                const measurements = JSON.stringify(w.sink.db().prepare("SELECT * FROM measurements").all());

                for (const secret of [marker, signature, "private model body P11"]) {
                  expect(tags).not.toContain(secret);
                  expect(measurements).not.toContain(secret);
                }

                const failed = rows.filter((row) => !row.ok);
                expect(failed.length).toBeGreaterThan(0);
                expect(failed.some((row) => typeof row.attributes["error.type"] === "string")).toBe(true);
                const records = yield* RecordManager;
                const content = yield* Effect.forEach(
                  failed,
                  (row) => records.content({ _tag: "job", process: PROCESS }, row.spanId),
                  { concurrency: 1 },
                );
                expect(JSON.stringify(content)).toContain(marker);
                const contentSpan = failed[content.findIndex((value) => JSON.stringify(value).includes(marker))]!;
                yield* records.deleteContent({ _tag: "job", process: PROCESS }, contentSpan.spanId, {
                  by: "SHA256:person",
                  reason: value,
                });
                expect(
                  Option.getOrNull(yield* records.content({ _tag: "job", process: PROCESS }, contentSpan.spanId)),
                ).toMatchObject({ _tag: "deleted", reason: value });
                expect((yield* recorded()).some((row) => row.spanId === contentSpan.spanId)).toBe(true);
                expect(JSON.stringify(yield* resultLetters)).not.toContain(marker);
              }).pipe(Effect.provide(w.layer())),
            );
          }),
        { discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.live("plant, flush success only: a thrown fresh step reaches JobRecord before returning failure", () =>
    onDisks(async (world) => {
      const w = await world();
      await Effect.runPromise(
        Effect.gen(function* () {
          const r: Runner = yield* w.ProgramRunner;
          expect(yield* failure(r.msg(w.input(1, { type: "throw" })))).toMatchObject({
            _tag: "ProgramDown",
          });
          expect((yield* recorded()).some((row) => row.name === "runner.step" && !row.ok)).toBe(true);
          expect(w.sink.db().prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
        }).pipe(Effect.provide(w.layer())),
      );
    }),
  );

  for (const piece of ["process store", "sink"] as const) {
    it.effect.prop(
      `plant, swallow ${piece} storage failure: no success or later handler dispatch`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [61, generated],
          (value) =>
            onDisks(async (world) => {
              const w = await world();

              if (piece === "sink") {
                w.sink.fault.once = true;
                w.sink.fault.query = (q) => /^\s*(INSERT|UPDATE|REPLACE)/i.test(q);
              } else {
                w.store.fault.once = true;
                w.store.fault.query = (q) => /^\s*(INSERT|UPDATE|REPLACE)/i.test(q);
              }

              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  // The recovery store's own error keeps the Sql throw beneath it.
                  expect(yield* failure(r.msg(w.input(1, { type: "work", n: value })))).toMatchObject(
                    piece === "sink"
                      ? { reason: "storage" }
                      : {
                          _tag: "RecoveryStoreError",
                          reason: { _tag: "Storage", cause: { message: "SQLITE_FULL" } },
                        },
                  );
                  expect(piece === "sink" || w.workCalls() === 0).toBe(true);
                }).pipe(Effect.provide(w.layer())),
              );
              w.fault.flush = false;
              w.reopen();
              await Effect.runPromise(
                Effect.gen(function* () {
                  const r: Runner = yield* w.ProgramRunner;
                  const rows = yield* inbox;
                  yield* r.open("recovered");
                  expect(yield* inbox).toEqual(rows);
                }).pipe(Effect.provide(w.layer())),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }
});
