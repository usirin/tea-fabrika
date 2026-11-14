// edge: Effect has no node:sqlite driver for Sql.
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Status } from "@kampus/libfabrika/ci/Ci";
import * as CiTest from "@kampus/libfabrika/ci/CiTest";
import { CodeHost } from "@kampus/libfabrika/codehost/CodeHost";
import * as CodeHostTest from "@kampus/libfabrika/codehost/CodeHostTest";
import { InputId, Writer } from "@kampus/libfabrika/coordination";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import { LedgerTransaction } from "@kampus/libfabrika/ledger/LedgerTransaction";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import type { StartGrant } from "@kampus/libfabrika/processes/Children";
import * as ChildrenLedger from "@kampus/libfabrika/processes/ChildrenLedger";
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
import { nodeSql } from "@kampus/libfabrika/sqlite";
import type { Redacted } from "effect";
import {
  Clock,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { handlers } from "../handlers.ts";
import { merger } from "../Merger.ts";
import { queue } from "../Queue.ts";
import * as QueueRunnerTest from "../QueueRunnerTest.ts";
import * as Settings from "../Settings.ts";

const NAME = "queue:1";
const BUILD = "queue-laws";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const owner = Writer.cases.person.make({ key: "SHA256:law", for: "person_01m6v5270hf3c8x2q7w9z4k5mn" });
/** The process manager's own caller: the brain registered every name, so its fold answers them. */
const brain = Owner.cases.brain.make({});

const from = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-12T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
};

const base = CodeHostTest.commit("d".repeat(40));
const moved = CodeHostTest.commit("c".repeat(40));

const settings = Effect.runSync(
  Settings.all.parse(
    ConfigProvider.fromUnknown({
      queue: { checks: { rows: [{ name: "check" }], docs: [{ name: "check" }], code: [{ name: "check" }] } },
      merger: { poll: 1, wait: 1, backoff: 4 },
    }),
  ),
);

const programs = { "pipeline/queue": queue({ name: NAME, settings }), "pipeline/merger": merger(settings) };

const stores = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "queue-laws-" });
  const parent = yield* Scope.Scope;
  let scope = yield* Scope.fork(parent, "sequential");
  const held = new Map<string, Sql>();
  const connect = Effect.fnUntraced(function* (part: string) {
    if (held.has(part)) {
      return;
    }

    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(folder, `${encodeURIComponent(part)}.db`))),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Scope.provide(scope));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
    held.set(part, nodeSql(db));
  });
  const adapters = new Map<string, Sql>();
  const sql = (part: string): Sql => {
    const known = adapters.get(part);

    if (known !== undefined) {
      return known;
    }

    const current = () => {
      const handle = held.get(part);

      if (handle === undefined) {
        // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: Sql is synchronous and the caller must connect its part first.
        throw new Error("database part was not acquired");
      }

      return handle;
    };
    const made: Sql = {
      exec: (text, ...params) => current().exec(text, ...params),
      transaction: (f) => current().transaction(f),
      size: () => current().size(),
    };
    adapters.set(part, made);
    return made;
  };
  yield* connect("ledger");
  yield* connect("alarms");
  const table = () => {
    const db = sql("alarms");
    db.exec("CREATE TABLE IF NOT EXISTS alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    return db;
  };
  return {
    sql,
    connect,
    reopen: Effect.gen(function* () {
      const parts = [...held.keys()];
      yield* Scope.close(scope, Exit.void);
      scope = yield* Scope.fork(parent, "sequential");
      held.clear();

      for (const part of parts) {
        yield* connect(part);
      }
    }),
    alarm: (name: string, at: number | null) =>
      Effect.sync(() => {
        if (at === null) {
          table().exec("DELETE FROM alarms WHERE name = ?", name);
        } else {
          table().exec("INSERT OR REPLACE INTO alarms (name, at) VALUES (?, ?)", name, at);
        }
      }),
    alarms: Effect.sync(() =>
      table()
        .exec("SELECT name, at FROM alarms ORDER BY at, name")
        .map((row) => ({ name: String(row.name), at: Number(row.at) })),
    ),
  };
}).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.orDie);

type Store = Effect.Success<typeof stores>;
type Services = CiTest.Control | CodeHostTest.Control | CodeHost | import("@kampus/libfabrika/ci/Ci").Ci;

const life = Effect.fnUntraced(function* (
  store: Store,
  services: Context.Context<Services>,
  ids: Effect.Effect<string>,
  scope: Scope.Scope,
  grants: ReadonlyArray<typeof StartGrant.Type>,
) {
  const data = Layer.merge(
    LedgerSql.layer(store.sql("ledger"), { reader: "queue-laws" }),
    LedgerTransactionSql.layer(store.sql("ledger")),
  ).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })));
  const manager = ProcessManager.layer(
    {
      by: from.by,
      owner: brain,
      recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000099" }),
    },
    ids,
  );
  const shared = MailDeliveryLive.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ChildrenLedger.layer({ grants }),
        ProgramMailLedger.layer({ grants: { [NAME]: Array.from({ length: 6 }, (_, i) => `lane:${i + 1}`) } }),
        Layer.succeed(MailWakeups, { wake: () => Effect.void }),
      ),
    ),
    Layer.provideMerge(manager),
    Layer.provideMerge(Mailbox.layer),
    Layer.provideMerge(data),
  );
  const context = yield* Layer.buildWithScope(shared, scope);

  const registrations: ReadonlyArray<readonly [string, string]> = [
    [NAME, "pipeline/queue"],
    ...Array.from({ length: 6 }, (_, i) => [`lane:${i + 1}`, "lane"] as const),
  ];

  for (const [name, program] of registrations) {
    const known = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.provide(context), Effect.result);

    if (Result.isFailure(known)) {
      yield* ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), from),
      ).pipe(Effect.provide(context));
    }
  }

  const runners = new Map<string, ProgramRunner["Service"]>();
  const runner = Effect.fnUntraced(function* (name: string) {
    const status = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.provide(context));
    const pid = status.state.process;
    const known = runners.get(pid);

    if (known !== undefined) {
      return known;
    }

    yield* store.connect(`model:${pid}`);
    yield* store.connect(`recovery:${pid}`);
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
          commit: () => Effect.die("no writes"),
          own: () => Effect.die("no own command"),
        };
      }),
    );
    const own = Layer.mergeAll(
      ProgramLoader.layer(programs, handlers).pipe(Layer.provide(Layer.succeedContext(services))),
      ProcessStore.layer(store.sql(`model:${pid}`), { process: pid }),
      Layer.succeed(Alarm, { set: (at: number | null) => store.alarm(name, at) }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const built = yield* Layer.buildWithScope(
      ProgramRunner.layer(
        { id: pid, name, program: status.state.code.program, build: BUILD, owner },
        { recovery: { sql: store.sql(`recovery:${pid}`), name, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(own)),
      scope,
    );
    const made = Context.get(built, ProgramRunner);
    runners.set(pid, made);
    return made;
  });
  return { context, runner };
});

const open = Effect.fnUntraced(function* (
  token?: Redacted.Redacted<string>,
): Effect.fn.Return<QueueRunnerTest.World, unknown, Scope.Scope> {
  const store = yield* stores;
  const services = yield* Layer.build(
    Layer.merge(
      CodeHostTest.layer(token === undefined ? {} : { token }),
      CiTest.layer(token === undefined ? {} : { token }),
    ),
  );
  const host = Context.get(services, CodeHostTest.Control);
  const ci = Context.get(services, CiTest.Control);
  const rawHost = Context.get(services, CodeHost);
  let gap = false;
  const wrapped = Context.add(
    services,
    CodeHost,
    CodeHost.of({
      ...rawHost,
      merge: (change, head) =>
        Effect.gen(function* () {
          if (gap) {
            gap = false;
            yield* host.main(moved);
            const found = yield* host.read(change);

            if (found !== undefined) {
              yield* host.put({ ...found, tree: CodeHostTest.tree("9".repeat(40)) });
            }
          }

          return yield* rawHost.merge(change, head);
        }),
    }),
  );
  yield* host.main(base);

  for (let change = 1; change <= 6; change++) {
    yield* host.put({
      ...Schema.TaggedStruct("found", {}).make({}),
      change,
      head: CodeHostTest.commit(change.toString(16).repeat(40)),
      state: "open",
      paths: ["src/a.ts"],
      base,
      tree: CodeHostTest.tree((change + 6).toString(16).repeat(40)),
      conflict: null,
    });
  }

  let serial = 0;
  const ids = Effect.sync(() => `process_0000000000e008${(++serial).toString(16).padStart(12, "0")}`);
  let scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const grants: Array<typeof StartGrant.Type> = [{ source: "pipeline/queue", to: "pipeline/merger" }];
  let current = yield* life(store, wrapped, ids, scope, grants);
  let letter = 0;
  const deliver = Effect.fnUntraced(function* (input: unknown) {
    const runner = yield* current.runner(NAME);
    const n = ++letter;
    return yield* runner.msg({
      id: `incoming:${n}`,
      envelope: {
        id: Schema.decodeUnknownSync(InputId)(`input_0000000000e008${n.toString(16).padStart(12, "0")}`),
        by: owner,
        arrivedAt: n,
        input,
      },
      sentAt: from.sentAt,
      seen: 0,
      span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
    });
  });
  // One fold of the process table answers every name. `status` folds the whole log on each call,
  // and one call for each name was half of S2's time, which ran out on a busy CI machine.
  const statuses = Effect.gen(function* () {
    const rows = yield* Ledger.use((ledger) => Stream.runCollect(ledger.read("processes", 0)));
    const registrations = rows
      .filter((row) => row._tag === "registered")
      .map((row) => Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, program: Schema.String }))(row.body));
    const processes = yield* ProcessManager;
    const answers = yield* LedgerTransaction.use((tx) =>
      tx.transact((turn) => {
        const table = processes.table(turn);
        return registrations.map((entry) => ({ entry, status: table.status(entry.name, brain) }));
      }),
    );
    return yield* Effect.forEach(
      answers,
      ({ entry, status }) => Effect.fromResult(status).pipe(Effect.map((found) => ({ ...entry, state: found.state }))),
      { concurrency: 1 },
    );
  });
  const snapshot = Effect.gen(function* () {
    const info = yield* statuses.pipe(Effect.provide(current.context));
    const names = [
      NAME,
      ...Array.from({ length: 6 }, (_, i) => `lane:${i + 1}`),
      ...info.filter((i) => i.program === "pipeline/merger").map((i) => i.name),
    ];
    const letters = yield* Effect.forEach(
      names,
      (name) =>
        Mailbox.use((m) => Stream.runCollect(m.read(name, 0))).pipe(
          Effect.provide(current.context),
          Effect.map((all) => all.map((l) => ({ name, id: l.id, pos: l.pos, m: l.m }))),
        ),
      { concurrency: 1 },
    );
    const saved = yield* Effect.forEach(
      info.filter((i) => i.program === "pipeline/queue" || i.program === "pipeline/merger"),
      (i) =>
        Effect.gen(function* () {
          yield* store.connect(`model:${i.state.process}`);
          return yield* ProcessStore.use((s) => s.load).pipe(
            Effect.provide(ProcessStore.layer(store.sql(`model:${i.state.process}`), { process: i.state.process })),
            Effect.provide(current.context),
          );
        }),
      { concurrency: 1 },
    );
    // Read the queue checkpoint by its process, including its last model after exit.
    const queueInfo = info.find((i) => i.name === NAME)!;
    const checkpoint = yield* ProcessStore.use((s) => s.load).pipe(
      Effect.provide(
        ProcessStore.layer(store.sql(`model:${queueInfo.state.process}`), { process: queueInfo.state.process }),
      ),
      Effect.provide(current.context),
    );
    const model =
      checkpoint === null
        ? null
        : Schema.decodeUnknownSync(programs["pipeline/queue"].state.schema)(checkpoint.saved.model);
    return {
      model,
      view: model === null ? null : programs["pipeline/queue"].view.select(model),
      starts: info.map((i) => ({
        name: i.name,
        process: i.state.process,
        program: i.program,
        state: i.state._tag,
        reason: i.state._tag === "ended" ? i.state.reason : null,
      })),
      letters: letters.flat(),
      saved,
    };
  });
  const notify = Effect.fnUntraced(function* (name: string) {
    const runner = yield* current.runner(name);
    const status = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.provide(current.context));
    const checkpoint = yield* ProcessStore.use((s) => s.load).pipe(
      Effect.provide(ProcessStore.layer(store.sql(`model:${status.state.process}`), { process: status.state.process })),
      Effect.provide(current.context),
    );
    const incoming = yield* Mailbox.use((m) => Stream.runHead(m.read(name, checkpoint?.saved.after ?? 0))).pipe(
      Effect.provide(current.context),
    );

    if (Option.isSome(incoming)) {
      yield* runner.mailed;
    }
  });
  const step = Effect.gen(function* () {
    yield* notify(NAME);
    const info = yield* statuses.pipe(Effect.provide(current.context));

    for (const child of info.filter((i) => i.program === "pipeline/merger" && i.state._tag === "live")) {
      yield* notify(child.name);
    }

    const alarm = (yield* store.alarms)[0];

    if (alarm !== undefined) {
      yield* store.alarm(alarm.name, null);
      yield* TestClock.setTime(Math.max(yield* Clock.currentTimeMillis, alarm.at));
      yield* (yield* current.runner(alarm.name)).due(alarm.at);
    }

    yield* notify(NAME);
  });
  return {
    host,
    ci,
    snapshot,
    step,
    enqueue: (change, ref) =>
      Effect.gen(function* () {
        const found = yield* host.read(change);
        return yield* deliver({
          type: "enqueue",
          change,
          head: found!.head,
          ...(ref === null ? {} : { reply: { to: `lane:${change}`, ref } }),
        });
      }),
    drop: (change) => deliver({ type: "drop", change }),
    resume: deliver({ type: "resume" }),
    green: (change) =>
      Effect.gen(function* () {
        const found = yield* host.read(change);

        if (found !== undefined) {
          yield* ci.report({
            commit: found.head,
            order: 1,
            run: {
              name: "check",
              source: "push",
              id: `run:${change}`,
              startedAt: 0,
              completedAt: 1,
              url: null,
              status: Status.cases.done.make({ conclusion: "success" }),
            },
          });
        }
      }),
    moveMain: host.main(moved),
    moveBeforeMerge: Effect.sync(() => {
      gap = true;
    }),
    allowStart: (allowed) =>
      Effect.sync(() => {
        grants.splice(0);

        if (allowed) {
          grants.push({ source: "pipeline/queue", to: "pipeline/merger" });
        }
      }),
    reopen: Effect.gen(function* () {
      yield* Scope.close(scope, Exit.void);
      yield* store.reopen;
      scope = yield* Scope.make();
      current = yield* life(store, wrapped, ids, scope, grants);
    }),
  } satisfies QueueRunnerTest.World;
});

QueueRunnerTest.suite({ open, capture: RepliesTest.capture, unleaked: RepliesTest.unleaked });
