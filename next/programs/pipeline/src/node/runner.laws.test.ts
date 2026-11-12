// edge: Effect has no node:sqlite driver for the Sql contract
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { expect } from "@effect/vitest";
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
import { Replies } from "@kampus/libfabrika/runtime/Replies";
import * as RepliesSql from "@kampus/libfabrika/runtime/RepliesSql";
import * as RepliesTest from "@kampus/libfabrika/runtime/RepliesTest";
import { ProgramRunner } from "@kampus/libfabrika/runtime/Runner";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { FileSystem, Path } from "effect";
import type { Redacted } from "effect";
import { Clock, ConfigProvider, Context, Effect, Exit, Layer, Result, Schema, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { handlers } from "../handlers.ts";
import * as Mail from "../Mail.ts";
import { merger } from "../Merger.ts";
import * as RunnerTest from "../RunnerTest.ts";
import * as Settings from "../Settings.ts";

type Saved = { readonly name: string; readonly at: number };

type Store = {
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

const settings = Effect.runSync(
  Settings.all.parse(
    ConfigProvider.fromUnknown({
      queue: { checks: { rows: [{ name: "check" }], docs: [{ name: "check" }], code: [{ name: "check" }] } },
      merger: { wait: 1, poll: 1, backoff: 4 },
    }),
  ),
);

const program = merger(settings);

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
    Effect.provide(context),
  );
  return {
    runner,
    letters,
    checkpoint,
    reply: (id: string) =>
      Replies.use((replies) => replies.reply(NAME, id)).pipe(
        Effect.provide(RepliesSql.layer(store.sql("recovery"), { capacity: 1024 ** 3 })),
      ),
    model: Effect.map(checkpoint, (saved) =>
      saved === null
        ? null
        : Schema.decodeUnknownSync<typeof program.machine.model>(program.machine.model)(saved.saved.model),
    ),
  };
});

const start = Effect.fnUntraced(function* (store: Store, token?: Redacted.Redacted<string>) {
  const options = token === undefined ? {} : { token };
  const services = yield* Layer.build(Layer.merge(CodeHostTest.layer(options), CiTest.layer(options)));
  const host = Context.get(services, CodeHostTest.Control);
  const ci = Context.get(services, CiTest.Control);
  yield* host.main(base);
  const reset = host.put({
    ...Change.cases.found.make({ change: 1, head, state: "open", paths: ["src/a.ts"] }),
    base: head,
    tree: checked,
    conflict: null,
  });
  yield* reset;
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
      yield* TestClock.setTime(Math.max(yield* Clock.currentTimeMillis, alarm.at));
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
    reset,
    alarms: store.alarms,
    services,
    deliver,
    reopen,
    fire,
    green,
    current: () => current,
    savedReplies: Effect.suspend(() =>
      Effect.forEach(
        Array.from({ length: serial }, (_, index) => `incoming-${index + 1}`),
        (id) => current.reply(id),
        { concurrency: 1 },
      ),
    ),
    land: (ref: string) => deliver(Mail.Land.make({ type: "land", ref, change: 1, head, reply: "queue" })),
  };
});

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "merger-laws-" });
  const parent = yield* Scope.Scope;
  let scope = yield* Scope.fork(parent, "sequential");
  const opened = new Map<string, Sql>();
  const connect = Effect.fnUntraced(function* (part: string) {
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(folder, `${part}.db`))),
      (handle) => Effect.sync(() => handle.close()),
    ).pipe(Scope.provide(scope));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
    opened.set(part, nodeSql(db));
  });
  const parts = ["ledger", "process", "recovery", "alarms"];
  yield* Effect.forEach(parts, connect, { discard: true, concurrency: 1 });
  const sqls = new Map<string, Sql>();
  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const handle = () => {
      const current = opened.get(part);

      if (current === undefined) {
        // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: Sql is synchronous; an unknown harness part is a programming defect
        throw new Error(`unknown database part: ${part}`);
      }

      return current;
    };
    const adapter: Sql = {
      exec: (query, ...params) => handle().exec(query, ...params),
      transaction: (f) => handle().transaction(f),
      size: () => handle().size(),
    };
    sqls.set(part, adapter);
    return adapter;
  };
  const table = () => {
    const db = sql("alarms");
    db.exec("CREATE TABLE IF NOT EXISTS alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    return db;
  };
  return {
    sql,
    reopen: Effect.gen(function* () {
      yield* Scope.close(scope, Exit.void);
      scope = yield* Scope.fork(parent, "sequential");
      yield* Effect.forEach(parts, connect, { discard: true, concurrency: 1 });
    }),
    alarms: {
      set: (name, at) =>
        Effect.sync(() => {
          if (at === null) {
            table().exec("DELETE FROM alarms WHERE name = ?", name);
          } else {
            table().exec("INSERT OR REPLACE INTO alarms (name, at) VALUES (?, ?)", name, at);
          }
        }),
      saved: Effect.sync(() =>
        table()
          .exec("SELECT name, at FROM alarms ORDER BY at, name")
          .map((row) => ({ name: String(row.name), at: Number(row.at) })),
      ),
      take: (alarm) =>
        Effect.sync(() => {
          table().exec("DELETE FROM alarms WHERE name = ? AND at = ?", alarm.name, alarm.at);
        }),
    },
  } satisfies Store;
}).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.orDie);

RunnerTest.suite({
  open: (token) => open.pipe(Effect.flatMap((store) => start(store, token))),
  capture: RepliesTest.capture,
  unleaked: RepliesTest.unleaked,
});
