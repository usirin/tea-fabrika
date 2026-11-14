// P34c Q12, next/. The app's real Project and Process services, its door and the runner on SQLite,
// assembled the way brain.ts hands off to them. Only Cloudflare's handles, the platform alarm and
// the loader's transport are supplied here; no quota decision is made in this file.
// The accounts are read with the public quota services from the two stores the objects wrote, and
// the oracle is the committed entries themselves, measured with the ledger's own encoder.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
// edge: Effect has no synchronous SQLite handle for the object stores
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { counter } from "@kampus/counter";
import { nodeExecution, type Descriptor } from "@kampus/libfabrika";
import { programBox } from "@kampus/libfabrika/box";
import { encodedBytes } from "@kampus/libfabrika/ledger/Log";
import { accountingEntries } from "@kampus/libfabrika/ledger/RefereeSql";
import { Start } from "@kampus/libfabrika/processes/Process";
import { Quotas } from "@kampus/libfabrika/processes/Quotas";
import * as QuotasSql from "@kampus/libfabrika/processes/QuotasSql";
import * as QuotaRunnerTest from "@kampus/libfabrika/runtime/QuotaRunnerTest";
import { send } from "@kampus/libfabrika/runtime/Send";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import {
  commitReply,
  configureProcess,
  processDescriptor,
  processRuntime,
  ProcessService,
  ProjectService,
  signingReply,
} from "@kampus/libfabrika/workers/runtime";
import { Clock, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { programs } from "virtual:fabrika-built";
import { vi } from "vitest";
import { projectRuntime, type Env } from "./runtime.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);
// Only the platform base class is fake. The box methods run the real programBox.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
vi.mock("virtual:fabrika-built", () => ({ ...table, assets: {} }));

type ProjectCalls = (typeof ProjectService)["Service"];
type ProcessCalls = (typeof ProcessService)["Service"];
type Limits = QuotaRunnerTest.Limits;

const PROJECT = "quota-laws";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-13T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const URL = "http://127.0.0.1:18787";
const NAMES = ["alpha:1", "alpha:2", "beta:1"] as const;
const PROGRAMS = ["quota/alpha", "quota/beta"] as const;
const programFor = (name: string) => (name.startsWith("alpha:") ? "quota/alpha" : "quota/beta");
const required = <A>(value: A | undefined): A => Option.getOrThrow(Option.fromUndefinedOr(value));
const live = TestClock.withLive;

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

/** A fresh SSH identity for this test's own door: its key, its fingerprint and a signer for the hello. */
const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x ?? "";
  const bytes = Buffer.from(raw, "base64url");
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ]);
      const lines = packet.toString("base64").match(/.{1,70}/g) ?? [];
      return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

// One program under two identities. It counts `inc`, throws on `throw`, and on `tell` mails an
// `inc` to another registered name; `told` and `failed` record the answer its Send got.
const Model = Schema.Struct({
  count: Schema.Int,
  told: Schema.Int,
  failed: Schema.Array(Schema.String),
  text: Schema.String,
});

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("inc"),
    text: Schema.optionalKey(Schema.String),
    parent: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("throw"), parent: Schema.optionalKey(Schema.String) }),
  Schema.Struct({
    type: Schema.Literal("tell"),
    to: Schema.NonEmptyString,
    parent: Schema.optionalKey(Schema.String),
  }),
]);

const worker = (name: string) => ({
  name,
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [send],
    init: (saved) => [saved ?? { count: 0, told: 0, failed: [], text: "" }, []],
    update: {
      inc: (s, m) => [{ ...s, count: s.count + 1, text: m.text ?? s.text }, []],
      throw: () => {
        throw new TypeError("quota wiring fixture");
      },
      tell: (s, m) => [s, [send({ to: m.to, m: { type: "inc" } })]],
      send_ok: (s) => [{ ...s, told: s.told + 1 }, []],
      send_err: (s, m) => [{ ...s, failed: [...s.failed, m.error._tag] }, []],
    },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: {
    inc: { _tag: "write", schema: Msg, description: "Count", personOnly: false },
    throw: { _tag: "write", schema: Msg, description: "Fail", personOnly: false },
    tell: { _tag: "write", schema: Msg, description: "Mail another name", personOnly: false },
  },
  outputs: {},
  writes: {},
  wake: () => null,
});

const View = Schema.Struct({ view: Model });

const bytes = (n: number) => `${n} B`;

/** The limits as the checked settings encode them for the `INSTANCE` handoff. */
const encoded = (limits: Limits) => ({
  recordBytes: 1_000_000_000,
  writes: limits.writes,
  storage: bytes(limits.storage),
  recovery: {
    project: {
      writes: limits.recovery.project.writes,
      bytes: bytes(limits.recovery.project.bytes),
      letter: {
        writes: limits.recovery.project.letter.writes,
        bytes: bytes(limits.recovery.project.letter.bytes),
      },
    },
    process: {
      writes: limits.recovery.process.writes,
      bytes: bytes(limits.recovery.process.bytes),
      letter: {
        writes: limits.recovery.process.letter.writes,
        bytes: bytes(limits.recovery.process.letter.bytes),
      },
    },
  },
});

/** Row counts of every table, so a law can say "nothing was saved" without naming a table. */
const counts = (db: DatabaseSync) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => [
        String(name),
        db.prepare(`SELECT count(*) AS n FROM "${String(name).replaceAll('"', '""')}"`).get()?.n,
      ]),
  );

type Store = {
  readonly db: DatabaseSync;
  readonly ctx: DurableObjectState;
  readonly values: Map<string, unknown>;
  alarm: number | null;
};

/** The platform's storage handles over one SQLite database. The alarm is a saved time, fired by `settle`. */
const storage = (db: DatabaseSync, alarm: (at: number | null) => void) => {
  const sql = nodeSql(db);
  const values = new Map<string, unknown>();
  return {
    values,
    sql: {
      exec: sql.exec,
      get databaseSize() {
        return sql.size();
      },
    },
    transactionSync: sql.transaction,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    delete: async (key: string) => values.delete(key),
    sync: async () => {},
    setAlarm: async (at: number) => alarm(at),
    deleteAlarm: async () => alarm(null),
  };
};

// The assembled instance. The Project and each Process run their real services; a platform restart
// (`reopen`) ends every runtime and keeps every store and saved alarm.
const world = Effect.fnUntraced(function* (limits: Limits) {
  table.programs["fabrika/counter"] = { hash: "counter-a", source: "counter" };
  table.programs["quota/alpha"] = { hash: "alpha-a", source: "alpha" };
  table.programs["quota/beta"] = { hash: "beta-a", source: "beta" };
  const key = identity();
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (held) => Effect.sync(() => held.close()),
  );
  const loopbacks = { IsolateTail: () => ({ fetch: async () => new Response() }) };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the platform handles the real Project service reads
  const ctx = {
    id: { name: PROJECT },
    storage: storage(db, () => {}),
    exports: loopbacks,
  } as unknown as DurableObjectState;
  const stores = new Map<string, Store>();
  const runtimes = new Map<Store, ReturnType<typeof processRuntime>>();
  const from = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: "quota-laws",
  };
  const everyone = Object.fromEntries(NAMES.map((name) => [name, NAMES.filter((other) => other !== name)]));
  let projectHeld = undefined as ReturnType<typeof projectRuntime> | undefined;
  // What the Project class hands off: one service call on the object's runtime.
  const project = <A, E>(use: (p: ProjectCalls) => Effect.Effect<A, E>) =>
    Effect.flatMap(required(projectHeld).contextEffect, (services) =>
      ProjectService.use(use).pipe(Effect.provideContext(services)),
    );
  // What the Process class hands off, with the descriptor calls on its own handles.
  const process = <A, E>(store: Store, use: (p: ProcessCalls) => Effect.Effect<A, E>) =>
    Effect.flatMap(required(runtimes.get(store)).contextEffect, (services) =>
      ProcessService.use(use).pipe(Effect.provideContext(services)),
    );
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node namespaces call the real services but lack workerd's nominal brands
  const env = {
    INSTANCE: JSON.stringify({
      name: PROJECT,
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: 18787,
      rateLimit: { limit: 100_000, window: 60_000 },
      limits: encoded(limits),
      build: "quota-laws",
      mail: { grants: everyone },
    }),
    // Every Project RPC a Process makes reaches the real service, with the two typed replies the class adds.
    PROJECT: {
      getByName: () =>
        new Proxy(
          {},
          {
            get: (_target, method) =>
              typeof method !== "string" || method === "then"
                ? undefined
                : (...args: ReadonlyArray<unknown>) =>
                    Effect.runPromise(
                      project((p) => {
                        const member = Reflect.get(p, method);
                        const work = typeof member === "function" ? Reflect.apply(member, p, args) : member;
                        return method === "sign" ? signingReply(work) : method === "commit" ? commitReply(work) : work;
                      }),
                    ),
          },
        ),
    },
    PROCESS: {
      getByName: (name: string) => {
        const [, storageKey] = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
        )(name);
        let store = stores.get(storageKey);

        if (store === undefined) {
          const processDb = new DatabaseSync(":memory:");
          const handles = storage(processDb, (at) => {
            made.alarm = at;
          });
          // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies the SQL, descriptor and alarm handles the real Process reads
          const processCtx = { id: { name }, storage: handles, exports: loopbacks } as unknown as DurableObjectState;
          const made: Store = { db: processDb, ctx: processCtx, values: handles.values, alarm: null };
          stores.set(storageKey, made);
          runtimes.set(made, processRuntime(processCtx, env, programs));
          store = made;
        }

        const current = store;
        return new Proxy(
          {},
          {
            get: (_target, method) =>
              typeof method !== "string" || method === "then"
                ? undefined
                : (...args: ReadonlyArray<unknown>) =>
                    Effect.runPromise(
                      method === "configure"
                        ? configureProcess(
                            current.ctx,
                            args[0] as Descriptor,
                            required(runtimes.get(current)),
                            args[1] === true,
                          )
                        : method === "descriptor"
                          ? processDescriptor(current.ctx)
                          : process(current, (p): Effect.Effect<unknown, unknown> => {
                              const member = Reflect.get(p, method);
                              return typeof member === "function" ? Reflect.apply(member, p, args) : Effect.void;
                            }),
                    ),
          },
        );
      },
    },
    CONNECTION: {
      getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }),
    },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => {
          if (id.startsWith("alpha-") || id.startsWith("beta-")) {
            // The real box around the fixture program.
            const alpha = id.startsWith("alpha-");
            const Box = programBox(worker(alpha ? "quota/alpha" : "quota/beta"), alpha ? "alpha-a" : "beta-a");
            const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
            return {
              describe: () => box.describe(),
              init: (saved: unknown) => box.init(saved),
              step: (model: unknown, msg: unknown) => box.step(model, msg),
              fold: (model: unknown, msg: unknown) => box.fold(model, msg),
              upgrade: (saved: unknown) => box.upgrade(saved),
              reply: (cmd: unknown, outcome: unknown) => box.reply(cmd, outcome),
              check: (kind: string, event: unknown) => box.check(kind, event),
              admit: (msg: unknown) => box.admit(msg),
            };
          }

          // The app's own bootstrap, `fabrika/counter`.
          const execution = nodeExecution(counter);
          return {
            describe: async () => ({
              name: counter.name,
              v: 1,
              writes: {},
              inputs: {
                inc: { write: true, personOnly: false },
                dec: { write: true, personOnly: false },
                reset: { write: true, personOnly: false },
              },
              cmds: [],
            }),
            init: (saved: unknown) => Effect.runPromise(execution.init(saved)),
            step: (model: unknown, msg: unknown) => Effect.runPromise(execution.step(model, msg)),
            fold: (model: unknown, msg: unknown) => Effect.runPromise(execution.fold(model, msg)),
            upgrade: (saved: unknown) => Effect.runPromise(execution.upgrade(saved)),
            reply: (cmd: unknown, outcome: unknown) => Effect.runPromise(execution.reply(cmd, outcome)),
            check: (kind: string, event: unknown) => Effect.runPromise(execution.check(kind, event)),
            admit: (msg: unknown) => Effect.runPromise(execution.admit(msg)),
          };
        },
      }),
    },
  } as unknown as Env;
  const boot = Effect.sync(() => {
    projectHeld = projectRuntime(ctx, env);

    for (const store of stores.values()) {
      runtimes.set(store, processRuntime(store.ctx, env, programs));
    }
  });
  const halt = Effect.gen(function* () {
    for (const runtime of runtimes.values()) {
      yield* runtime.disposeEffect;
    }

    yield* required(projectHeld).disposeEffect;
  });
  yield* Effect.acquireRelease(boot, () =>
    Effect.andThen(
      halt,
      Effect.sync(() => {
        for (const store of stores.values()) {
          store.db.close();
        }
      }),
    ),
  );
  yield* project((p) => p.info);
  const pid = Effect.fnUntraced(function* (name: string) {
    return required((yield* project((p) => p.info)).find((row) => row.name === name)).process;
  });
  /** The store of a registered name, found by the descriptor its Process saved. */
  const storeFor = Effect.fnUntraced(function* (name: string) {
    const current = yield* pid(name);
    const named = [...stores.values()].filter(
      (store) => Reflect.get(Object(store.values.get("descriptor")), "name") === name,
    );
    return required(
      named.find((store) => Reflect.get(Object(store.values.get("descriptor")), "id") === current) ?? named[0],
    );
  });

  for (const name of NAMES) {
    const program = programFor(name);
    yield* project((p) =>
      p.start(
        Start.cases.first.make({
          id: `start:${name}`,
          name,
          code: { program, hash: required(table.programs[program]).hash },
        }),
        from,
      ),
    );
  }

  const client = yield* project((p) => p.connect());
  const nonce = yield* project((p) => p.challenge(client));
  const tab = "quota-laws";
  expect(
    yield* project((p) =>
      p.initialize(
        client,
        {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: key.raw,
          tab,
          nonce,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
          signed: key.proof(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
        },
        { url: URL, tab, name: key.fingerprint },
      ),
    ),
  ).toMatchObject({ _tag: "online" });
  const view = Effect.fnUntraced(function* (name: string) {
    const store = yield* storeFor(name);
    return Schema.decodeUnknownSync(View)(yield* process(store, (p) => p.open("audit"))).view;
  });
  /** Fires each saved alarm that is due, as the platform would, until `done` holds and none is saved. */
  const settle = Effect.fnUntraced(function* (done: Effect.Effect<boolean, unknown>) {
    for (let n = 0; n < 2_000; n++) {
      const now = yield* live(Clock.currentTimeMillis);

      for (const store of stores.values()) {
        if (store.alarm !== null && store.alarm <= now) {
          store.alarm = null;
          const fired = yield* Effect.exit(process(store, (p) => p.alarm()));

          // workerd runs a failed alarm handler again; so does this stand-in.
          if (fired._tag === "Failure" && store.alarm === null) {
            store.alarm = now + 100;
          }
        }
      }

      const quiet = [...stores.values()].every((store) => store.alarm === null);
      const reached = yield* Effect.exit(done);

      if (quiet && reached._tag === "Success" && reached.value) {
        return;
      }

      yield* live(Effect.sleep("5 millis"));
    }

    return yield* Effect.die("the instance did not settle");
  });
  const sql = nodeSql(db);
  const quotas = QuotasSql.layer(sql, { brain: `brain:${PROJECT}`, limits });
  /** Every account in both stores. A read of an installed account adds no row to either store. */
  const accounts = Effect.gen(function* () {
    const found = yield* Effect.forEach(
      NAMES,
      (name) => Effect.map(storeFor(name), (store) => [name, store] as const),
      {
        concurrency: 1,
      },
    );
    const rows = { project: counts(db), process: found.map(([, store]) => counts(store.db)) };
    const program = yield* Effect.forEach(
      PROGRAMS,
      (id) =>
        Effect.map(
          Quotas.use((q) => q.program(id)),
          (use) => [id, use] as const,
        ),
      { concurrency: 1 },
    ).pipe(Effect.provide(quotas), live);
    const recovery = yield* Effect.forEach(
      NAMES,
      (name) =>
        Effect.map(
          Quotas.use((q) => q.recovery(name)),
          (use) => [name, use] as const,
        ),
      { concurrency: 1 },
    ).pipe(Effect.provide(quotas), live);
    const local = yield* Effect.forEach(
      found,
      ([name, store]) =>
        Effect.map(
          QuotasSql.accounting(nodeSql(store.db), { name, limits: limits.recovery.process }).status,
          (use) => [name, use] as const,
        ),
      { concurrency: 1 },
    ).pipe(live);
    expect(
      { project: counts(db), process: found.map(([, store]) => counts(store.db)) },
      "the live assembly installs accounting in both stores; a read never creates it",
    ).toEqual(rows);
    return {
      program: Object.fromEntries(program),
      recovery: Object.fromEntries(recovery),
      local: Object.fromEntries(local),
    };
  });
  return {
    pid,
    view,
    settle,
    accounts,
    rows: Effect.gen(function* () {
      const found = yield* Effect.forEach(NAMES, storeFor, { concurrency: 1 });
      return { project: counts(db), process: found.map((store) => counts(store.db)) };
    }),
    /** The committed entries after `rev` that the door's own record does not hold (0153). */
    entries: (rev: number) =>
      Effect.sync(() =>
        accountingEntries(sql).filter(
          (entry) => entry.rev > rev && entry.stream !== "gateway" && !entry.stream.startsWith("gateway/"),
        ),
      ),
    head: Effect.sync(() => accountingEntries(sql).at(-1)?.rev ?? 0),
    /** One input through the door, to the name's live process. */
    input: Effect.fnUntraced(function* (name: string, letter: string, m: unknown) {
      const to = yield* pid(name);
      return yield* project((p) => p.route(client, "process.send", { pid: to, letter, m, sentAt: SENT, seen: 0 }));
    }),
    reopen: Effect.gen(function* () {
      yield* halt;
      yield* boot;
      yield* project((p) => p.info);
    }),
  };
});

const Cell = Schema.Struct({
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  amount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  reopen: Schema.Boolean,
});

const Tape = Schema.Array(Cell).check(Schema.isMinLength(3), Schema.isMaxLength(10));
const options = { timeout: 300_000, arbitrary: { seed: 119120, runs: 40 } };
const accepted = { _tag: "ok", result: { _tag: "accepted" } };
const refused = { _tag: "refused", reason: "quota" };
const none = { writes: 0, bytes: 0 };

const cost = (entries: ReadonlyArray<Parameters<typeof encodedBytes>[0]>) => ({
  writes: entries.length,
  bytes: entries.reduce((n, entry) => n + encodedBytes(entry), 0),
});

describe("P34c live wiring, both object stores", () => {
  it.effect.prop(
    "Q12 every entry a live call commits is charged to the account of its cause, and each step to its name's own store",
    { tape: Tape },
    ({ tape }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world(QuotaRunnerTest.defaults);
          const counted = new Map<string, number>(NAMES.map((name) => [name, 0]));
          const told = new Map<string, number>(NAMES.map((name) => [name, 0]));
          const crashes = new Map<string, number>(NAMES.map((name) => [name, 0]));

          for (const name of NAMES) {
            expect(yield* w.view(name)).toMatchObject({ count: 0 });
          }

          for (const [n, c] of tape.entries()) {
            const name = required(NAMES[c.pick % NAMES.length]);
            const program = programFor(name);
            const other = required(PROGRAMS.find((id) => id !== program));
            // A name is crashed at most twice, so the supervisor's own restart limit is never the subject.
            const moves = ["inc", "tell", ...(required(crashes.get(name)) < 2 ? ["throw"] : [])];
            const move = required(moves[c.amount % moves.length]);
            const before = yield* w.accounts;
            const head = yield* w.head;

            if (move === "throw") {
              const old = yield* w.pid(name);
              yield* Effect.exit(w.input(name, `throw:${n}`, { type: "throw" }));
              crashes.set(name, required(crashes.get(name)) + 1);
              yield* w.settle(Effect.map(w.pid(name), (current) => current !== old));
              const after = yield* w.accounts;
              const fresh = cost(yield* w.entries(head));
              expect(fresh.writes).toBeGreaterThan(0);
              // A throwing input never reaches the inbox, and the brain pays for the recovery.
              expect(after.program).toEqual(before.program);
              const paid = required(after.recovery[name]).total;
              const owed = required(before.recovery[name]).total;
              expect({ writes: paid.writes - owed.writes, bytes: paid.bytes - owed.bytes }).toEqual(fresh);
              expect(required(after.local[name]).recovery.total.writes).toBeGreaterThan(
                required(before.local[name]).recovery.total.writes,
              );

              for (const bystander of NAMES.filter((registered) => registered !== name)) {
                expect(after.recovery[bystander]).toEqual(before.recovery[bystander]);
                expect(after.local[bystander]).toEqual(before.local[bystander]);
              }
            } else {
              const peer = required(NAMES.filter((registered) => registered !== name)[c.amount % 2]);
              const stepped = move === "tell" ? [name, peer] : [name];
              const m =
                move === "tell" ? { type: "tell", to: peer } : { type: "inc", text: "é😀".repeat(c.amount % 64) };
              expect(yield* w.input(name, `${move}:${n}`, m)).toMatchObject(accepted);

              if (move === "tell") {
                told.set(name, required(told.get(name)) + 1);
                counted.set(peer, required(counted.get(peer)) + 1);
              } else {
                counted.set(name, required(counted.get(name)) + 1);
              }

              yield* w.settle(
                Effect.gen(function* () {
                  const sender = yield* w.view(name);
                  const receiver = yield* w.view(peer);
                  return (
                    sender.told === required(told.get(name)) &&
                    sender.count === required(counted.get(name)) &&
                    receiver.count === required(counted.get(peer))
                  );
                }),
              );
              const after = yield* w.accounts;
              const fresh = cost(yield* w.entries(head));
              // The letter, its step, a Send's receipt, the mailed letter and its step, the answer
              // letter and its step: all of it is the work of the program that took the input.
              const paid = required(after.program[program]);
              const owed = required(before.program[program]);
              expect({ writes: paid.writes - owed.writes, bytes: paid.bytes - owed.bytes }).toEqual(fresh);
              expect(paid.ahead).toEqual(none);
              expect(after.program[other]).toEqual(before.program[other]);
              // Ordinary work never spends reserved room, in either store.
              expect(after.recovery).toEqual(before.recovery);

              for (const registered of NAMES) {
                const local = required(after.local[registered]);
                const old = required(before.local[registered]);
                expect(local.recovery).toEqual(old.recovery);
                expect(local.fault).toBeNull();

                if (stepped.includes(registered)) {
                  expect(local.program.writes).toBeGreaterThan(old.program.writes);
                } else {
                  expect(local).toEqual(old);
                }
              }
            }

            if (c.reopen) {
              const saved = yield* w.accounts;
              yield* w.reopen;
              expect(yield* w.accounts).toEqual(saved);
            }
          }
        }),
      ),
    options,
  );

  it.effect.prop(
    "Q12 at the exact cap the door gives the typed quota answer and saves nothing, while the other program stays writable",
    { tape: Tape },
    ({ tape }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const first = required(tape[0]);
          const resource = first.pick % 2 === 0 ? "writes" : "storage";
          // An input counts 2 writes, so an odd cap also meets "one write short". A bare input and its
          // step take about 900 bytes in the canonical encoding, so the storage caps hold a few.
          const cap = resource === "writes" ? 2 + (first.amount % 8) : 4_000 + (first.amount % 8) * 2_000;
          const limits = {
            ...QuotaRunnerTest.defaults,
            ...(resource === "writes" ? { writes: cap } : { storage: cap }),
          };
          const w = yield* world(limits);
          const counted = new Map<string, number>(NAMES.map((name) => [name, 0]));
          let refusals = 0;
          let admitted = 0;
          const one = Effect.fnUntraced(function* (name: string, letter: string, text: string) {
            const program = programFor(name);
            const before = yield* w.accounts;
            const rows = yield* w.rows;
            const head = yield* w.head;
            const used = required(before.program[program]);
            const reply = yield* w.input(name, letter, { type: "inc", text });

            if (Schema.is(Schema.Struct({ _tag: Schema.Literal("refused") }))(reply)) {
              // The typed answer, before an envelope, a binding, a reply or a local step is saved.
              expect(reply).toMatchObject(refused);
              expect(yield* w.rows).toEqual(rows);
              expect(yield* w.accounts).toEqual(before);
              expect(yield* w.view(name)).toMatchObject({ count: required(counted.get(name)) });
              refusals++;

              if (resource === "writes") {
                // Refused only when the letter and its step do not both fit.
                expect(used.writes + 2).toBeGreaterThan(cap);
              }

              return false;
            }

            expect(reply).toMatchObject(accepted);
            counted.set(name, required(counted.get(name)) + 1);
            admitted++;
            yield* w.settle(Effect.map(w.view(name), (view) => view.count === required(counted.get(name))));
            const after = yield* w.accounts;
            const paid = required(after.program[program]);
            const fresh = cost(yield* w.entries(head));
            expect({ writes: paid.writes - used.writes, bytes: paid.bytes - used.bytes }).toEqual(fresh);
            expect(paid.ahead).toEqual(none);
            // The write that reaches the cap is admitted; nothing passes it.
            expect(resource === "writes" ? paid.writes : paid.bytes).toBeLessThanOrEqual(cap);

            if (resource === "storage") {
              // A letter bigger than the room left is never admitted.
              expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(cap - used.bytes);
            }

            return true;
          });

          // With room for it, the first bare input is admitted: the wall is not shut from the start.
          expect(yield* one("alpha:1", "first", "")).toBe(true);

          for (const [n, c] of tape.entries()) {
            const name = required(NAMES[c.pick % 2]);
            const text = resource === "storage" ? "é😀".repeat(c.amount) : "";
            yield* one(name, `fill:${n}`, text);

            if (c.reopen) {
              const saved = yield* w.accounts;
              yield* w.reopen;
              expect(yield* w.accounts).toEqual(saved);
            }
          }

          // Drive to the wall: the refusal must occur, and it repeats without a new row.
          for (let n = 0; n < 12 && refusals < 2; n++) {
            yield* one("alpha:2", `wall:${n}`, resource === "storage" ? "😀".repeat(cap) : "");
          }

          expect(refusals).toBeGreaterThanOrEqual(2);
          expect(admitted).toBeGreaterThan(0);
          // The other program has its own room in the same Project.
          expect(yield* one("beta:1", "other-program", "")).toBe(true);
        }),
      ),
    options,
  );
});
