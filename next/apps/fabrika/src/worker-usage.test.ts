// next/, U9. Host/container only: only workerd can deliver loader tail events. This file must not
// replace a zero CPU reading with a weaker assertion. The build's probe runs before this scenario.
// edge: crypto supplies an ephemeral public identity; no person's key is read
import { createHash, generateKeyPairSync, sign } from "node:crypto";
// edge: Node's SQLite driver opens only this test instance's health tables read-only
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect } from "vitest";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PROJECT = "isolate-usage-test";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const FROM = {
  by: "SHA256:fixture",
  for: PERSON,
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "fixture",
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
  const tab = "usage";
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
    expect(reply).toMatchObject({ result: { _tag: "accepted" } });
  });
});

const spinSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model=Schema.Struct({checksum: Schema.Int});",
  'const Msg=Schema.Struct({type: Schema.Literals(["idle","spin"])});',
  "const machine=Machine.make({model: Model, msg: Msg, cmds: [], init: (s)=>[s??{checksum:0},[]], update: {idle:s=>[s,[]], spin:s=>{let checksum=s.checksum;for(let i=0;i<40000000;i++){checksum=(checksum+i)|0;}return [{checksum},[]];}}});",
  'export const program={name:"usage/spin",machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{idle:{_tag:"write",schema:Msg,description:"Idle",personOnly:false},spin:{_tag:"write",schema:Msg,description:"Spin",personOnly:false}},outputs:{},writes:{},wake:()=>null};',
].join("\n");

const world = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "usage-worker-" });
  const oldAlchemy = process.env.ALCHEMY_HOME;
  const oldHome = process.env.FABRIKA_HOME;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.FABRIKA_HOME = home;
    }),
    () =>
      Effect.sync(() => {
        if (oldHome === undefined) {
          delete process.env.FABRIKA_HOME;
        } else {
          process.env.FABRIKA_HOME = oldHome;
        }

        if (oldAlchemy === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = oldAlchemy;
        }
      }),
  );
  yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
  const file = path.join(home, "spin.ts");
  yield* fs.writeFileString(file, spinSource);
  const checklist = path.join(home, "checklist.ts");
  yield* fs.writeFileString(checklist, 'export { checklist as program } from "@kampus/checklist";');
  const built = yield* build({
    out: path.join(home, "dist"),
    programs: { "usage/spin": file, "fabrika/checklist": checklist },
  });
  const key = identity();
  const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const instance = yield* localInstance(
    built,
    RecordWireTest.settingsFixture({
      home,
      name: PROJECT,
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: port.port,
    }),
  );
  const send = yield* wire(instance.url, key);
  return { instance, built, home, send, from: { ...FROM, by: key.fingerprint, build: built.build } };
});

const healthRows = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folders = [home];
    const found: Array<{ spanId: string; ms: number }> = [];

    for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
      for (const entry of yield* fs.readDirectoryEntries(folder)) {
        const file = path.join(folder, entry.name);

        if (entry.type === "Directory") {
          folders.push(file);
        }

        if (entry.type === "File" && /\.(sqlite|db)$/.test(entry.name)) {
          yield* Effect.acquireUseRelease(
            Effect.sync(() => new DatabaseSync(file, { readOnly: true })),
            (db) =>
              Effect.sync(() => {
                if (db.prepare("SELECT name FROM sqlite_master WHERE name='measurements'").get() !== undefined) {
                  for (const row of db.prepare("SELECT spanId, ms FROM measurements WHERE piece='isolate.cpu'").all()) {
                    found.push(
                      Schema.decodeUnknownSync(Schema.Struct({ spanId: Schema.String, ms: Schema.Number }))(row),
                    );
                  }
                }
              }),
            (db) => Effect.sync(() => db.close()),
          );
        }
      }
    }

    return found;
  });

const call = <A>(f: () => Promise<A>) => Effect.promise(f);

const invoke = (
  binding: Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>,
  method: string,
  ...args: ReadonlyArray<unknown>
) =>
  Effect.gen(function* () {
    const f = binding[method];

    if (f === undefined) {
      return yield* Effect.die(`missing trusted method ${method}`);
    }

    return yield* call(() => f(...args));
  });

const lifecycle = Schema.Array(
  Schema.Struct({
    _tag: Schema.String,
    body: Schema.Struct({ after: Schema.optionalKey(Schema.String), process: Schema.optionalKey(Schema.String) }),
  }),
);

class World extends Context.Service<World, Effect.Success<typeof world>>()("@kampus/fabrika/worker-usage.test.World") {}

const start = (world: World["Service"], name: string, program: string) =>
  invoke(
    world.instance.project(PROJECT),
    "start",
    {
      _tag: "first",
      id: `start-${name}`,
      name,
      code: { program, hash: world.built.programs[program]?.hash ?? "missing" },
    },
    world.from,
  ).pipe(Effect.map((reply) => Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(reply).process));

const read = (world: World["Service"], process: string) =>
  Effect.gen(function* () {
    // A later runner call flushes already delivered tails to the public JobRecord.
    yield* invoke(world.instance.process(process), "open", "usage-probe");
    const page = yield* invoke(
      world.instance.record(PROJECT, `job/${process}/0`),
      "read",
      { _tag: "job", process },
      0,
      0,
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ spans: Schema.Array(SpanRow) }))));
    return page.spans;
  });

const cpu = (rows: ReadonlyArray<SpanRow>, method: string) =>
  rows.filter((row) => row.name === "isolate.cpu" && row.attributes["fab.isolate.method"] === method);

const calls = (rows: ReadonlyArray<SpanRow>, method: string) =>
  rows.filter((row) => row.name === `execution.${method}`);

const duration = (row: SpanRow) => Number(BigInt(row.endTimeUnixNano) - BigInt(row.startTimeUnixNano)) / 1_000_000;

const checkHealth = (home: string, spans: ReadonlyArray<SpanRow>) =>
  Effect.gen(function* () {
    const health = yield* healthRows(home);

    for (const span of spans.filter((row) => row.name === "isolate.cpu")) {
      expect(health.filter((row) => row.spanId === span.spanId)).toEqual([{ spanId: span.spanId, ms: duration(span) }]);
    }
  });

// Collect and validate the spin rows in layer setup. Only the CPU comparison is an expected
// failure, so a broken signed connection, missing tail or wrong health row still fails the suite.
const spinSample = Effect.gen(function* () {
  const world = yield* World;
  const spin = yield* start(world, "spin:1", "usage/spin");
  yield* world.send(spin, "idle", { type: "idle" });
  const idle = yield* until(
    read(world, spin),
    (rows) => cpu(rows, "update").length === 1,
    "the idle update produced no isolate.cpu row",
  );
  yield* world.send(spin, "spin", { type: "spin" });
  const busy = yield* until(
    read(world, spin),
    (rows) => cpu(rows, "update").length === 2,
    "the spinning update produced no second isolate.cpu row",
  );
  const baseline = cpu(idle, "update").map(duration);
  const later = cpu(busy, "update").filter((row) => !idle.some((old) => old.spanId === row.spanId));
  expect(later).toHaveLength(1);
  const [spinning] = later;

  if (spinning === undefined) {
    return yield* Effect.die("no spinning update row");
  }

  yield* checkHealth(world.home, busy).pipe(Effect.provide(NodeServices.layer));
  return { baseline, spinning };
});

class SpinSample extends Context.Service<SpinSample, Effect.Success<typeof spinSample>>()(
  "@kampus/fabrika/worker-usage.test.SpinSample",
) {}

it.layer(
  Layer.effect(World, world).pipe(Layer.provide(SecureRandom.layerWebCrypto), Layer.provide(NodeServices.layer)),
  { excludeTestServices: true, timeout: "180 seconds" },
)("U9 real local isolate usage", (it) => {
  it.effect(
    "scenario: U9 real checklist fresh, update and replay fold each record one CPU row through workerd",
    () =>
      Effect.gen(function* () {
        const world = yield* World;
        const { instance, built, send, home } = world;
        const checklist = yield* start(world, "checklist:1", "fabrika/checklist");
        yield* send(checklist, "add", { type: "add", name: "milk" });
        yield* send(checklist, "rename", { type: "rename", name: "milk", to: "bread" });
        yield* send(checklist, "remove", { type: "remove", name: "bread" });
        const updated = yield* until(
          read(world, checklist),
          (rows) =>
            calls(rows, "update").length >= 3 &&
            cpu(rows, "update").length === calls(rows, "update").length &&
            calls(rows, "fresh").length >= 3 &&
            cpu(rows, "fresh").length === calls(rows, "fresh").length,
          "checklist execution.fresh and execution.update calls did not each produce an isolate.cpu row",
        );
        expect(cpu(updated, "update")).toHaveLength(calls(updated, "update").length);
        expect(cpu(updated, "fresh")).toHaveLength(calls(updated, "fresh").length);
        yield* invoke(instance.process(checklist), "restart", {
          id: "replay",
          build: built.programs["fabrika/checklist"]?.hash ?? "missing",
        });
        const started = yield* until(
          invoke(instance.project(PROJECT), "read", "processes/checklist:1", 0, "usage-probe").pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(lifecycle)),
          ),
          (rows) => rows.some((row) => row.body.after === checklist),
          "restart recorded no successor within 10 seconds",
        );
        const successor = started.find((row) => row.body.after === checklist)?.body.process;

        if (successor === undefined) {
          return yield* Effect.die("restart recorded no successor");
        }

        // The three accepted client inputs replay. The old process's alarm stamps do not
        // drive its successor, and execution.fold spans need not be in the successor's record.
        const replayed = calls(updated, "update").length;
        const folded = yield* until(
          read(world, successor),
          (rows) => cpu(rows, "fold").length === replayed,
          "successor execution.fold calls did not each produce an isolate.cpu row",
        );
        expect(replayed).toBe(3);
        expect(cpu(folded, "fold")).toHaveLength(replayed);

        for (const [process, spans] of [
          [checklist, updated],
          [successor, folded],
        ] as const) {
          for (const span of spans.filter((row) => row.name === "isolate.cpu")) {
            expect(span.attributes["fab.process"]).toBe(process);
            expect(span.attributes["fab.isolate.outcome"]).toBe("ok");
          }
        }

        yield* checkHealth(home, [...updated, ...folded]).pipe(Effect.provide(NodeServices.layer));
      }),
    180_000,
  );

  // Only workerd provides isolate CPU readings. The host measured 0 even for the spinning step.
  it.layer(Layer.effect(SpinSample, spinSample), { timeout: "180 seconds" })("spin measurement", (it) => {
    it.effect.fails("scenario: U9 spin exceeds idle CPU; local workerd reports 0", () =>
      Effect.gen(function* () {
        const { baseline, spinning } = yield* SpinSample;
        expect(
          duration(spinning),
          "local cpuTime=0 is a failed measurement, never a reason to loosen U9",
        ).toBeGreaterThan(Math.max(...baseline));
      }),
    );
  });
});
