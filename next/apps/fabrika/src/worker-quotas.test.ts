// next/, Q13. Lead host/container run: real workerd and object RPC are required.
// This scenario is intentionally not replaced by a Node-only runner.
// edge: create only an ephemeral signing identity for this private test instance
import { createHash, generateKeyPairSync, sign } from "node:crypto";
// edge: inspect only this scenario's own object databases
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Quotas } from "@kampus/libfabrika/processes/Quotas";
import * as QuotasSql from "@kampus/libfabrika/processes/QuotasSql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect } from "vitest";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";

const PROJECT = "quota-workers";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const FROM = {
  by: "SHA256:fixture",
  for: PERSON,
  sentAt: "2026-11-12T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "fixture",
};

const recovery = {
  project: { writes: 160, bytes: 74_080, letter: { writes: 10, bytes: 5_469 } },
  process: { writes: 290, bytes: 207_410, letter: { writes: 50, bytes: 18_790 } },
};

const encodedRecovery = {
  project: { writes: 160, bytes: "74080 B", letter: { writes: 10, bytes: "5469 B" } },
  process: { writes: 290, bytes: "207410 B", letter: { writes: 50, bytes: "18790 B" } },
};

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x;

  if (raw === undefined) {
    throw new Error("no public identity");
  }

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
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const Frame = Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

const until = <A, E, R>(look: Effect.Effect<A, E, R>, done: (value: A) => boolean, reason: string) =>
  Effect.gen(function* () {
    for (let n = 0; n < 100; n++) {
      const value = yield* look;

      if (done(value)) {
        return value;
      }

      yield* Effect.sleep("100 millis");
    }

    return yield* Effect.die(reason);
  });

// A real client signs the challenge and sends through the door, which creates the inbox envelope.
const wire = Effect.fnUntraced(function* (url: string, key: ReturnType<typeof identity>) {
  const tab = "quotas";
  const frames: Array<typeof Frame.Type> = [];
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const socket = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`);
      socket.addEventListener("message", (event) => {
        if (event.data !== "pong") {
          frames.push(Schema.decodeUnknownSync(Schema.fromJsonString(Frame))(String(event.data)));
        }
      });
      return socket;
    }),
    (held) => Effect.sync(() => held.close()),
  );
  const next = (match: (frame: typeof Frame.Type) => boolean) =>
    until(
      Effect.sync(() => {
        const at = frames.findIndex(match);
        return at < 0 ? undefined : frames.splice(at, 1)[0];
      }),
      (frame) => frame !== undefined || socket.readyState === WebSocket.CLOSED,
      "the signed client received no matching frame within 10 seconds",
    ).pipe(
      Effect.flatMap((frame) => (frame === undefined ? Effect.die("the signed client closed") : Effect.succeed(frame))),
    );
  let serial = 0;
  const call = Effect.fnUntraced(function* (method: string, params: unknown) {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return yield* next((frame) => frame.id === id);
  });
  const challenge = yield* next((frame) => frame.method === "challenge");
  const { nonce } = yield* Schema.decodeUnknownEffect(Schema.Struct({ nonce: Schema.String }))(challenge.params);
  const hello = yield* call("initialize", {
    versions: [1],
    has: ["seal"],
    ping: "30s",
    key: key.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: FROM.sentAt,
    signed: key.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
  });
  expect(hello.error, "the signed client must be admitted before any program input").toBeUndefined();
  return Effect.fnUntraced(function* (process: string, letter: string, input: unknown) {
    const reply = yield* call("process.send", { pid: process, letter, m: input, sentAt: FROM.sentAt, seen: 0 });
    return reply;
  });
});

const source = (name: string) => `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
const Model = Schema.Struct({count: Schema.Int});
const Msg = Schema.Union([
  Schema.Struct({type: Schema.Literal("inc"), text: Schema.String}),
  Schema.Struct({type: Schema.Literal("throw")})
]);
const machine = Machine.make({model: Model, msg: Msg, cmds: [], init: s => [s ?? {count: 0}, []], update: {
  inc: s => [{count: s.count + 1}, []],
  throw: () => {throw new TypeError("quota fixture failure");}
}});
export const program = Program.make({name: ${JSON.stringify(name)}, maxDeliveries: 1, machine,
  state: {v: 1, upgrades: []}, view: s => s, refuse: () => null,
  inputs: {inc: "Count", throw: "Fail"}, outputs: {}, writes: {}, wake: () => null});
`;

const rpc = Effect.fnUntraced(function* (binding: object, method: string, ...args: ReadonlyArray<unknown>) {
  return yield* Effect.promise(() => Reflect.apply(Reflect.get(binding, method), binding, args) as Promise<unknown>);
});

const Rows = Schema.Array(Schema.Struct({ _tag: Schema.String, body: Schema.Json }));
const started = Schema.Struct({ process: Schema.String });

const world = Effect.fnUntraced(function* (mode: "writes" | "storage" | "reserve") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "q13-" });
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { home: process.env.FABRIKA_HOME, alchemy: process.env.ALCHEMY_HOME };
      process.env.FABRIKA_HOME = home;
      process.env.DO_NOT_TRACK = "1";
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous.home === undefined) {
          delete process.env.FABRIKA_HOME;
        } else {
          process.env.FABRIKA_HOME = previous.home;
        }

        if (previous.alchemy === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = previous.alchemy;
        }
      }),
  );
  yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
  const files: Record<string, string> = {};

  for (const name of ["alpha", "beta"]) {
    files[`quota/${name}`] = path.join(home, `${name}.ts`);
    yield* fs.writeFileString(files[`quota/${name}`]!, source(`quota/${name}`));
  }

  const built = yield* build({ out: path.join(home, "dist"), programs: files });
  const key = identity();
  const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const limits = {
    recordBytes: 1_000_000_000,
    writes: mode === "writes" ? 44 : 13_760,
    storage: mode === "storage" ? "12000 B" : "1000000000 B",
    recovery:
      mode === "reserve"
        ? {
            project: { ...encodedRecovery.project, writes: 1, bytes: "1 B" },
            process: { ...encodedRecovery.process, writes: 1, bytes: "1 B" },
          }
        : encodedRecovery,
  };
  const instance = yield* localInstance(built, {
    home,
    name: PROJECT,
    person: PERSON,
    founder: key.line,
    window: key.raw,
    port: port.port,
    rateLimit: { limit: 100_000, window: 60_000 },
    limits,
  });
  const send = yield* wire(instance.url, key);
  const project = instance.project(PROJECT);
  const from = { ...FROM, by: key.fingerprint, build: built.build };
  const start = Effect.fnUntraced(function* (name: string, program: string) {
    const code = built.programs[program]!;
    return Schema.decodeUnknownSync(started)(
      yield* rpc(
        project,
        "start",
        { _tag: "first", id: `start:${name}`, name, code: { program, hash: code.hash } },
        from,
      ),
    ).process;
  });
  const facts = Effect.fnUntraced(function* (stream: string) {
    return Schema.decodeUnknownSync(Rows)(yield* rpc(project, "read", stream, 0, "audit"));
  });
  return { instance, project, home, send, start, facts, limits, build: built.build };
});

// Locate stores by their committed data, never by a machine-specific directory or object ID.
const accounting = Effect.fnUntraced(function* (home: string, name: string, process: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folders = [home];
  let projectUse: unknown;
  let processUse: unknown;

  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (const entry of yield* fs.readDirectoryEntries(folder)) {
      const file = path.join(folder, entry.name);

      if (entry.type === "Directory") {
        folders.push(file);
      }

      if (entry.type !== "File" || !/\.(sqlite|db)$/.test(entry.name)) {
        continue;
      }

      yield* Effect.acquireUseRelease(
        Effect.sync(() => new DatabaseSync(file)),
        (db) =>
          Effect.gen(function* () {
            const exists = (table: string) =>
              db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table) !== undefined;
            const sql = nodeSql(db);

            if (
              exists("entries") &&
              db.prepare("SELECT 1 FROM entries WHERE stream=? LIMIT 1").get(`processes/${name}`) !== undefined
            ) {
              projectUse = yield* Quotas.use((q) => q.recovery(name)).pipe(
                Effect.provide(
                  QuotasSql.layer(sql, {
                    brain: "SHA256:fixture",
                    limits: { writes: 13_760, storage: 1_000_000_000, recovery },
                  }),
                ),
              );
            }

            if (
              exists("process_state") &&
              db.prepare("SELECT 1 FROM process_state WHERE process=?").get(process) !== undefined
            ) {
              processUse = yield* QuotasSql.accounting(sql, { name, limits: recovery.process }).status;
            }
          }),
        (db) => Effect.sync(() => db.close()),
      );
    }
  }

  expect(projectUse, "Project account must be installed by the live assembly").toBeDefined();
  expect(processUse, "Process accounting must be installed by the live assembly").toBeDefined();
  return { project: projectUse, process: processUse };
});

// scenario: actual workerd transport, durable object storage and eviction need the lead's isolated host container.
for (const mode of ["writes", "storage", "reserve"] as const) {
  it.live(
    `scenario: Q13 ${mode}, one program refuses or faults while another remains writable`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world(mode);
          const alpha = yield* w.start("alpha:1", "quota/alpha");
          const beta = yield* w.start("beta:1", "quota/beta");
          // Ordinary inputs stay outside both recovery accounts before the quota or fault exercise.
          const ordinary = mode === "writes" ? 21 : 3;

          for (let n = 0; n < ordinary; n++) {
            expect(yield* w.send(alpha, `healthy:${n}`, { type: "inc", text: "é😀" })).toMatchObject({
              result: { _tag: "accepted" },
            });
          }

          const before = yield* accounting(w.home, "alpha:1", alpha);
          expect(before.project).toHaveProperty("total", { writes: 0, bytes: 0 });
          expect(before.process).toHaveProperty("recovery.total", { writes: 0, bytes: 0 });

          if (mode === "storage") {
            expect(yield* w.send(alpha, "too-large", { type: "inc", text: "😀".repeat(6000) })).toMatchObject({
              error: { data: { reason: "quota" } },
            });
            expect(yield* w.facts("alpha:1/inbox")).toHaveLength(ordinary);
          }

          // The last admitted letter can still fail and be recovered with the program at its write cap.
          yield* w.send(alpha, "poison", { type: "throw" });

          if (mode === "reserve") {
            yield* until(
              accounting(w.home, "alpha:1", alpha),
              (use) =>
                Schema.is(
                  Schema.Struct({
                    process: Schema.Struct({
                      fault: Schema.Struct({ _tag: Schema.Literal("RecoveryReserveExhausted") }),
                    }),
                  }),
                )(use),
              "reserve exhaustion must save the named fault",
            );
            // Checked reads remain available and object eviction must not clear the saved fault.
            yield* rpc(w.instance.process(alpha), "abort");
            const stopped = yield* accounting(w.home, "alpha:1", alpha);
            expect(stopped.process).toHaveProperty("fault._tag", "RecoveryReserveExhausted");
          } else {
            yield* until(
              w.facts("processes/alpha:1"),
              (rows) => rows.some((r) => r._tag === "restarted"),
              "the exhausted program must recover",
            );
            expect(yield* w.facts(`${alpha}/dead`)).toHaveLength(1);

            if (mode === "writes") {
              const info = Schema.decodeUnknownSync(
                Schema.Array(Schema.Struct({ name: Schema.String, process: Schema.String })),
              )(yield* rpc(w.project, "info"));
              const successor = info.find((r) => r.name === "alpha:1")!.process;
              expect(yield* w.send(successor, "fill-cap", { type: "inc", text: "" })).toMatchObject({
                result: { _tag: "accepted" },
              });
              yield* rpc(w.instance.process(successor), "restart", { id: "person-at-cap", build: w.build });
              const restarted = yield* until(
                w.facts("processes/alpha:1"),
                (rows) => rows.filter((r) => r._tag === "restarted").length === 2,
                "a checked person restart must complete at the program cap",
              );
              expect(restarted.filter((r) => r._tag === "restarted")).toHaveLength(2);
              const current = Schema.decodeUnknownSync(
                Schema.Array(Schema.Struct({ name: Schema.String, process: Schema.String })),
              )(yield* rpc(w.project, "info")).find((r) => r.name === "alpha:1")!.process;
              expect(yield* w.send(current, "excess", { type: "inc", text: "" })).toMatchObject({
                error: { data: { reason: "quota" } },
              });
            }
          }

          expect(yield* w.send(beta, "other", { type: "inc", text: "" })).toMatchObject({
            result: { _tag: "accepted" },
          });
        }),
      ).pipe(Effect.provide(NodeServices.layer), Effect.provide(SecureRandom.layerWebCrypto)),
    240_000,
  );
}
