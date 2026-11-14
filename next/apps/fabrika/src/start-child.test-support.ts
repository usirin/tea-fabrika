// P42 slice 1 (ticket 770), next/: the helpers L9, L10 and L11 share. They build two test programs into a
// real local instance in a scope, as ticket 402's supervision test does: `starter` asks the host to
// start a child with the built-in `start_child`, and `child` counts `inc` and throws on `throw`. The
// instance takes its start grants from its caller (`starts`), as the app's own wiring hands in its
// empty list. Real workerd, sockets, object storage and alarms; no raw platform object stands in.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
// Edge: Effect has no node:sqlite driver.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import type { Descriptor } from "@kampus/libfabrika";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { programs } from "virtual:fabrika-built";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { projectRuntime, type Env } from "./runtime.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
export const SENT = "2026-11-11T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
export const PROJECT = "p42-children";

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(body.length);
  return Buffer.concat([n, body]);
};

/** A fresh SSH identity: its public line and key, its fingerprint, and a signer for the door's hello. */
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
      const v = Buffer.alloc(4);
      v.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        v,
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

export type Key = ReturnType<typeof identity>;

/** Asks the host for a child on `start`, and keeps every answer it was told. */
const starterSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  'import {startChild} from "@kampus/libfabrika/runtime/StartChild";',
  "const Model = Schema.Struct({asked: Schema.Int, told: Schema.Array(Schema.Json)});",
  'const Msg = Schema.Struct({type: Schema.Literal("start"), program: Schema.String, name: Schema.String, input: Schema.optionalKey(Schema.Json)});',
  "const machine = Machine.make({model: Model, msg: Msg, cmds: [startChild], init: (loaded) => [loaded ?? {asked: 0, told: []}, []], update: {start: (s, m) => [{...s, asked: s.asked + 1}, [startChild({program: m.program, name: m.name, ...(m.input === undefined ? {} : {input: m.input})})]], start_child_ok: (s, m) => [{...s, told: [...s.told, m.value]}, []], start_child_err: (s, m) => [{...s, told: [...s.told, m.reason]}, []]}});",
  'export const program = {name: "p42/starter", machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {start: {_tag: "write", schema: Msg, description: "Start a child", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};',
].join("\n");

/** Counts `inc` and throws on `throw`: the supervision the boot's child has must restart it. */
const childSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model = Schema.Struct({count: Schema.Int});",
  'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("inc")})]);',
  'const machine = Machine.make({model: Model, msg: Msg, cmds: [], init: (loaded) => [loaded ?? {count: 0}, []], update: {throw: () => {throw new TypeError("child failure P42");}, inc: (s) => [{count: s.count + 1}, []]}});',
  'export const program = {name: "p42/child", maxDeliveries: 2, machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {throw: {_tag: "write", schema: Msg, description: "Fail", personOnly: false}, inc: {_tag: "write", schema: Msg, description: "Count", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};',
].join("\n");

/** Sets one env value for the scope; the release puts the old value back, or deletes it when unset. */
const env = (key: string, value: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const old = process.env[key];
      process.env[key] = value;
      return old;
    }),
    (old) =>
      Effect.sync(() => {
        if (old === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = old;
        }
      }),
  );

/**
 * One real local instance with both test programs built in and `starts` as its start grants. Its
 * home, port, environment and instance are acquired in the caller's scope and given back with it.
 */
export const childInstance = Effect.fnUntraced(
  function* (starts: ReadonlyArray<{ readonly source: string; readonly to: string }>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* env("DO_NOT_TRACK", "1");
    // A short home: a socket path has a 103-byte limit.
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "p42w-" });
    yield* env("FABRIKA_HOME", home);
    yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
    yield* fs.writeFileString(path.join(home, "starter.ts"), starterSource);
    yield* fs.writeFileString(path.join(home, "child.ts"), childSource);
    const built = yield* build({
      out: path.join(home, "dist"),
      programs: { "p42/starter": path.join(home, "starter.ts"), "p42/child": path.join(home, "child.ts") },
    });
    const hashes = {
      starter: built.programs["p42/starter"]?.hash ?? "",
      child: built.programs["p42/child"]?.hash ?? "",
    };
    // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
    const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    const key = identity();
    const instance = yield* localInstance(
      built,
      RecordWireTest.startupFixture({
        home,
        name: PROJECT,
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: port.port,
        starts,
      }),
    );
    const from: From = {
      by: key.fingerprint,
      for: PERSON,
      sentAt: SENT,
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: built.build,
    };
    return { instance, key, hashes, from };
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);

/** A letter for the door's `process.send`. */
export const letter = (pid: string, id: string, m: unknown) => ({ pid, letter: id, m, sentAt: SENT, seen: 0 });

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: platform RPC doubles return Promises to the public client adapters
const remote = <A>(work: Effect.Effect<A>) => Effect.runPromise(work);
const Written = Schema.TaggedStruct("written", {});

/** The platform operation that fails during a child start or its recovery. */
export type ChildFailure =
  | "owner"
  | "descriptor"
  | "exists"
  | "pending"
  | "configure"
  | "ack"
  | "exit_write"
  | "down"
  | "watch_cleanup"
  | "retire";

/** The real Project service on scoped SQLite, with only the platform handles supplied by the test. */
export const childProject = Effect.fnUntraced(function* () {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (held) => Effect.sync(() => held.close()),
  );
  const sql = nodeSql(db);
  const key = identity();
  const configured: Array<{ descriptor: Descriptor; wake: boolean }> = [];
  const descriptors = new Map<string, Descriptor>();
  const recorded: Array<unknown> = [];
  let failure: { point: ChildFailure; error: Error; process?: string } | undefined;
  let armed = false;
  let observing = false;
  let target: { operation: number; error: Error } | undefined;
  let operations: Array<string> = [];
  const observe = (operation: string) => {
    if (!observing) {
      return;
    }

    const index = operations.push(operation) - 1;

    if (target?.operation === index) {
      const error = target.error;
      target = undefined;
      hit = true;
      // The SQL and transaction adapters throw the platform's original error value.
      throw error;
    }
  };
  let hit = false;
  const trip = (point: ChildFailure, process?: string) => {
    if (failure?.point === point && (failure.process === undefined || failure.process === process)) {
      const error = failure.error;
      failure = undefined;
      hit = true;
      // The platform's synchronous SQL API throws; its RPC double rejects with the same value.
      throw error;
    }
  };
  const storage = {
    sql: {
      exec: (query: string, ...params: Array<string | number | null>) => {
        // Keep each occurrence, including repeated reads before and after the write turn.
        observe(query.replace(/\s+/g, " ").trim());

        const process = typeof params[0] === "string" ? params[0] : undefined;

        if (query === "SELECT value FROM dev_descriptors WHERE process=?") {
          trip("owner");
        } else if (/INSERT.*dev_descriptors/.test(query)) {
          trip("descriptor", process);
        } else if (query === "SELECT process FROM dev_descriptors WHERE process=?") {
          trip("exists", process);
        } else if (query === "SELECT value, pending FROM dev_descriptors WHERE process=? AND pending>0") {
          trip("pending", process);
        } else if (query === "UPDATE dev_descriptors SET pending=0 WHERE process=?") {
          trip("ack", process);
        } else if (/INSERT INTO entries/.test(query)) {
          if (params[12] === "exited") {
            trip("exit_write");
          } else if (params[12] === "send" && String(params[13]).includes('"DOWN"')) {
            trip("down");
          } else if (params[12] === "demonitored") {
            trip("watch_cleanup");
          }
        } else if (/INSERT OR IGNORE INTO gateway_ended/.test(query)) {
          trip("retire", process);
        }

        if (armed && /INSERT.*dev_descriptors/.test(query)) {
          armed = false;
          hit = true;
          throw new Error("SQLITE_FULL while saving the child descriptor");
        }

        return sql.exec(query, ...params);
      },
      get databaseSize() {
        observe("databaseSize");
        return sql.size();
      },
    },
    transactionSync: <A>(step: () => A): A => {
      observe("transaction.begin");
      return sql.transaction(() => {
        const value = step();
        observe("transaction.commit");
        return value;
      });
    },
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies the storage members read by the public Project service; workerd alone constructs the branded handle
  const ctx = {
    id: { name: PROJECT },
    storage,
    // oxlint-disable-next-line fabrika/no-promises -- edge: the ctx.exports fetch binding returns a Promise
    exports: { IsolateTail: () => ({ fetch: async () => new Response() }) },
  } as unknown as DurableObjectState;
  // oxlint-disable-next-line fabrika/no-type-assertions -- only platform transports are supplied; authority, ledger and start logic are real
  const env = {
    INSTANCE: JSON.stringify(
      RecordWireTest.settingsFixture({
        name: PROJECT,
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: 18787,
        build: "p42-project",
        starts: [{ source: "fabrika/counter", to: "p42/child" }],
      }),
    ),
    PROCESS: {
      getByName: (name: string) => {
        const [, registered] = JSON.parse(name) as [string, string];
        return {
          configure: (descriptor: Descriptor, wake = false) =>
            remote(
              Effect.sync(() => {
                observe("process.configure");
                trip("configure", descriptor.id);
                descriptors.set(registered, descriptor);
                configured.push({ descriptor, wake });
              }),
            ),
          descriptor: () =>
            remote(
              Effect.sync(() => {
                observe("process.descriptor");
                return descriptors.get(registered);
              }),
            ),
        };
      },
    },
    CONNECTION: {
      getByName: () => ({
        ring: () => remote(Effect.sync(() => observe("connection.ring"))),
        notify: () => remote(Effect.void),
        probe: () => remote(Effect.succeed(42)),
      }),
    },
    RECORD: {
      getByName: () => ({
        write: (_chain: unknown, _part: number, rows: unknown) =>
          remote(
            Effect.sync(() => {
              observe("record.write");
              recorded.push(rows);
              return Written.make({});
            }),
          ),
      }),
    },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => ({
          describe: () =>
            remote(
              Effect.sync(() => ({
                // The loader keys an isolate by `<hash>/<process>`, so the hash says which program it holds.
                name: id.startsWith(`${programs["p42/child"]?.hash}/`) ? "p42/child" : "fabrika/counter",
                v: 1,
                writes: {},
                inputs: { inc: { write: true, personOnly: false } },
                cmds: [],
              })),
            ),
        }),
      }),
    },
  } as unknown as Env;
  // Each restart loses service memory but keeps the database and the remote objects' storage.
  const acquire = () =>
    Effect.acquireRelease(
      Effect.sync(() => projectRuntime(ctx, env)),
      // oxlint-disable-next-line fabrika/no-promises -- edge: ManagedRuntime disposal returns a Promise
      (runtime) => Effect.promise(() => runtime.dispose()),
    );
  const from: From = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: "p42-project",
  };
  return {
    acquire,
    from,
    configured,
    recorded,
    legacyDescriptors: () => sql.exec("ALTER TABLE dev_descriptors DROP COLUMN pending"),
    /** How many starts the Project has saved and not yet delivered to their objects. */
    undelivered: () => sql.exec("SELECT process FROM dev_descriptors WHERE pending>0").length,
    monitor: (watcher: string, target: string, ref: string) =>
      ProcessManager.use((manager) => manager.monitor(ref, target, from)).pipe(
        Effect.provide(
          ProcessManager.layer(
            {
              by: `brain:${PROJECT}`,
              owner: Owner.cases.brain.make({}),
              recipient: Recipient.cases.process.make({ process: watcher }),
            },
            Effect.die("monitor must not allocate a process"),
          ).pipe(
            Layer.provide(LedgerTransactionSql.layer(sql)),
            Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
          ),
        ),
      ),
    rows: () =>
      sql
        .exec("SELECT name FROM sqlite_master WHERE type='table'")
        .flatMap(({ name }) =>
          typeof name === "string" ? sql.exec(`SELECT * FROM "${name.replaceAll('"', '""')}"`) : [],
        ),
    observe: (operation?: number, error?: Error) => {
      operations = [];
      observing = true;
      target = operation === undefined || error === undefined ? undefined : { operation, error };
      hit = false;
    },
    observed: () => {
      observing = false;
      target = undefined;
      return operations;
    },
    fail: (point: ChildFailure, error: Error, process?: string) => {
      failure = { point, error, ...(process === undefined ? {} : { process }) };
      hit = false;
    },
    cut: () => {
      armed = true;
    },
    hit: () => hit,
  };
});
