// P12, next/. Outside only: real workerd, sockets and private local object capabilities.
// No control method below is an unauthenticated HTTP route. All record calls hit real local objects.
// The small record cap belongs to this fixture; the default remains P37's 1 GB.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Id } from "@kampus/libfabrika";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { CommitReply, SigningReply } from "@kampus/libfabrika/workers/bindings";
import { Effect, Layer, Schema, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

// The local instance exposes Promise calls; RecordManager takes Effect calls.
type RecordCalls = ReturnType<Parameters<typeof RecordManager.remote>[0]>;

const recordCalls = (stub: {
  [K in keyof RecordCalls]: (...args: Parameters<RecordCalls[K]>) => Promise<unknown>;
}): RecordCalls => ({
  write: (...args) => RecordWireTest.recordCall(() => stub.write(...args)),
  read: (...args) => RecordWireTest.recordCall(() => stub.read(...args)),
  content: (...args) => RecordWireTest.recordCall(() => stub.content(...args)),
  deleteContent: (...args) => RecordWireTest.recordCall(() => stub.deleteContent(...args)),
});

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const ids = Effect.runSync(Id.Generator.pipe(Effect.provide(Id.Generator.layer)));
const processId = () => Effect.runSync(ids.next(Id.Process));

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    n = Buffer.alloc(4);
  n.writeUInt32BE(body.length);
  return Buffer.concat([n, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "jwk" }).x!;
  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
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
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const span = (n: number) =>
  Schema.decodeUnknownSync(SpanRow)({
    traceId: TRACE,
    spanId: n.toString(16).padStart(16, "0"),
    parentSpanId: null,
    name: "runner.step",
    kind: "internal",
    startTimeUnixNano: "1794096000000000000",
    endTimeUnixNano: "1794096000001000000",
    attributes: { "fab.fill": "x".repeat(2000) },
    events: [],
    links: [],
    resource: { attributes: { "fab.object": "record-test" } },
    ok: true,
  });

const world = async (
  test: (
    instance: any,
    key: ReturnType<typeof identity>,
    probe: {
      hits: () => number;
      start: (name: string, program: string) => Promise<{ process: string }>;
      from: From;
    },
  ) => Promise<void>,
  instrument = false,
) => {
  process.env.DO_NOT_TRACK = "1";
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");
  const home = mkdtempSync(join(tmpdir(), "p12-o-")),
    key = identity();
  const previousHome = process.env.FABRIKA_HOME;
  process.env.FABRIKA_HOME = home;
  let hits = 0;
  let release: Effect.Effect<void> = Effect.void;
  const outbound = httpServer((_request, reply) => {
    hits++;
    reply.end("reachable");
  });

  try {
    await new Promise<void>((done, fail) => {
      outbound.once("error", fail);
      outbound.listen(0, "127.0.0.1", done);
    });
    const destination = outbound.address();

    if (destination === null || typeof destination === "string") {
      throw new Error("no probe address");
    }

    const at = await Effect.runPromise(heldPort());
    release = at.release;
    symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
    const writer = join(home, "writer.ts"),
      timer = join(home, "timer.ts"),
      sealed = join(home, "sealed.ts");
    const common = [
      'import {Machine, Cmd} from "@demlik/tea/effect";',
      'import {Schema} from "effect";',
      'const noted = Schema.TaggedStruct("noted", {n: Schema.Int});',
      "const Model = Schema.Struct({count: Schema.Int, replies: Schema.Int, wake: Schema.NullOr(Schema.Number)});",
      'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("prepare")}), Schema.Struct({type: Schema.Literal("schedule"), at: Schema.Number}), Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number})]);',
      'const write = Cmd.make("write", {input: Schema.Struct({stream: Schema.String, write: Schema.Json}), ok: Schema.Json, err: ["not_delivered"]});',
      'const machine = Machine.make({model: Model, msg: Msg, cmds: [write], init: (loaded) => [loaded ?? {count:0,replies:0,wake:null}, []], update: {throw: () => {throw new Error("private failure P12");}, prepare: s => [s,[]], schedule: (s,m) => [{...s,wake:m.at},[]], timer: (s,m) => [{...s,count:s.count+1,wake:m.at+10},[write({stream:"timer-events",write:{_tag:"own",event:{_tag:"noted",n:s.count+1}}})]], write_ok: s => [{...s,replies:s.replies+1},[]], write_err: s => [{...s,replies:s.replies+1},[]]}});',
      'const declaration = {machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{throw:{_tag:"write",schema:Msg,description:"Fail",personOnly:false},prepare:{_tag:"write",schema:Msg,description:"Prepare",personOnly:false},schedule:{_tag:"write",schema:Msg,description:"Schedule",personOnly:false}},outputs:{},writes:{noted:{schema:noted,personOnly:false}},wake:s=>s.wake};',
    ].join("\n");
    writeFileSync(writer, `${common}\nexport const program = {...declaration,name:"p12/writer-fixture"};`);
    writeFileSync(timer, `${common}\nexport const program = {...declaration,name:"p12/timer-fixture"};`);
    writeFileSync(
      sealed,
      [
        'import {env} from "cloudflare:workers";',
        'import {Machine} from "@demlik/tea/effect"; import {Schema} from "effect";',
        'let outbound = "blocked";',
        `try { await fetch("http://127.0.0.1:${destination.port}"); outbound = "allowed"; } catch {}`,
        "const Model = Schema.Struct({bindings: Schema.Array(Schema.String), outbound: Schema.String});",
        'const Msg = Schema.Struct({type: Schema.Literal("read")});',
        "const machine = Machine.make({model:Model,msg:Msg,cmds:[],init:loaded=>[loaded??{bindings:Object.keys(env),outbound},[]],update:{read:s=>[s,[]]}});",
        'export const program = {name:"p12/sealed-fixture",machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{},outputs:{},writes:{},wake:()=>null};',
      ].join("\n"),
    );
    // Ticket 502 slice S2: one wake, asked for by `schedule`, dropped by `cancel`, and never asked
    // for again by `timer`. So each alarm the platform delivers is one the test asked for.
    const alarm = join(home, "alarm.ts");
    writeFileSync(
      alarm,
      [
        'import {Machine} from "@demlik/tea/effect"; import {Schema} from "effect";',
        "const Model = Schema.Struct({fired: Schema.Int, wake: Schema.NullOr(Schema.Number)});",
        'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("schedule"), at: Schema.Number}), Schema.Struct({type: Schema.Literal("cancel")}), Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number})]);',
        "const machine = Machine.make({model:Model,msg:Msg,cmds:[],init:loaded=>[loaded??{fired:0,wake:null},[]],update:{schedule:(s,m)=>[{...s,wake:m.at},[]],cancel:s=>[{...s,wake:null},[]],timer:s=>[{fired:s.fired+1,wake:null},[]]}});",
        'export const program = {name:"p12/alarm-fixture",machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{schedule:{_tag:"write",schema:Msg,description:"Schedule",personOnly:false},cancel:{_tag:"write",schema:Msg,description:"Cancel",personOnly:false}},outputs:{},writes:{},wake:s=>s.wake};',
      ].join("\n"),
    );
    const built = await Effect.runPromise(
      build({
        out: join(home, "dist"),
        programs: {
          "p12/writer-fixture": writer,
          "p12/timer-fixture": timer,
          "p12/sealed-fixture": sealed,
          "p12/alarm-fixture": alarm,
        },
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    if (instrument) {
      await instrumentBrain(built.brain, home);
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const instance = yield* localInstance(
          built,
          RecordWireTest.startupFixture({
            home,
            name: "p12-records",
            person: PERSON,
            founder: key.line,
            window: key.raw,
            port: at.port,
            limits: { recordBytes: 64 * 1024 },
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
        yield* Effect.promise(() =>
          test(instance, key, {
            hits: () => hits,
            from,
            start: async (name, program) => {
              const code = built.programs[program];
              expect(code, `fixture program ${program} must be built`).toBeDefined();
              const started = await Reflect.get(instance.project("p12-records"), "start")(
                {
                  _tag: "first",
                  id: `start-${name}`,
                  name,
                  code: { program, hash: code!.hash },
                },
                from,
              );
              return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started);
            },
          }),
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(localState()),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(NodeServices.layer),
      ),
    );
  } finally {
    await new Promise<void>((done) => outbound.close(() => done()));
    // localInstance must close before removing its durable files.
    rmSync(home, { recursive: true, force: true });
    // Last, so the pair stays held until the instance that used its port is gone.
    await Effect.runPromise(release);

    if (previousHome === undefined) {
      delete process.env.FABRIKA_HOME;
    } else {
      process.env.FABRIKA_HOME = previousHome;
    }
  }
};

// Ticket 502 slice S2: the exam's Process holds for a plain class and for Alchemy's bridge class
// alike. A bridge class has no `msg` or any other RPC method on its prototype: its constructor
// returns a Proxy that answers each name the class lacks from the object's Layer
// (`Workers/DurableObjectBridge.ts`, the `get` trap). So an override that calls `super.msg` finds
// nothing there, and an override of any name hides the Layer's method. This class overrides
// nothing. Its constructor returns one more Proxy around what the base made, and that Proxy stands
// in front of two names only:
// - `msg`: holds the call before the base sees it, while `exam.hold` is saved.
// - `alarm`: counts each delivery of the platform alarm, and each one the base failed.
// Every other name is the base's own. The `test*` methods read and write this object's storage.
const examProcess = `
export class Process extends Brain.Process {
  constructor(ctx, env) {
    super(ctx, env);
    this.incarnation = crypto.randomUUID();
    const alarms = async (step) => {
      const seen = (await ctx.storage.get("exam.alarms")) ?? {delivered:0, failed:0};
      await ctx.storage.put("exam.alarms", step(seen));
    };
    return new Proxy(this, {
      get: (base, name) => {
        const member = Reflect.get(base, name);
        if (typeof member !== "function" || name === "constructor") return member;
        if (name === "msg") return async (...args) => {
          if (await ctx.storage.get("exam.hold")) { await ctx.storage.put("exam.entered",true); await new Promise(()=>{}); }
          return member.apply(base, args);
        };
        if (name === "alarm") return async (...args) => {
          await alarms((seen) => ({...seen, delivered: seen.delivered + 1}));
          try { return await member.apply(base, args); }
          catch (error) { await alarms((seen) => ({...seen, failed: seen.failed + 1})); throw error; }
        };
        return member.bind(base);
      },
    });
  }
  testState() { return {incarnation: this.incarnation}; }
  async testHold() { await this.ctx.storage.put("exam.hold",true); await this.ctx.storage.put("exam.entered",false); }
  testEntered() { return this.ctx.storage.get("exam.entered"); }
  testRelease() { return this.ctx.storage.put("exam.hold",false); }
  async testAlarms() { return (await this.ctx.storage.get("exam.alarms")) ?? {delivered:0, failed:0}; }
  async testBreak() {
    await this.ctx.storage.put("exam.descriptor", await this.ctx.storage.get("descriptor"));
    await this.ctx.storage.delete("descriptor");
    await this.ctx.storage.sync();
    this.ctx.abort("exam break");
  }
  async testRepair() {
    await this.ctx.storage.put("descriptor", await this.ctx.storage.get("exam.descriptor"));
    await this.ctx.storage.sync();
    this.ctx.abort("exam repair");
  }
}`;

// Test-only subclasses expose storage inspection and platform abort on the private control
// socket. The production Connection, runner, Project and transport behavior stays in the base.
// No HTTP route or extra target is installed in a product build.
const instrumentBrain = async (brain: string, home: string) => {
  const entry = join(home, "exam-entry.mjs");
  writeFileSync(
    entry,
    `
import * as Brain from ${JSON.stringify(brain)};
export default Brain.default;
export const RecordPart = Brain.RecordPart;
export const IsolateTail = Brain.IsolateTail;
export class Connection extends Brain.Connection {
  incarnation = crypto.randomUUID();
  testState() { return {incarnation:this.incarnation, sockets:this.ctx.getWebSockets().map(ws=>({attachment:ws.deserializeAttachment(),tags:this.ctx.getTags(ws)}))}; }
  testAbort() { this.ctx.abort("exam abort"); }
}
${examProcess}
export class Project extends Brain.Project {
  testGateway(name,method,args) { return this.env.CONNECTION.getByName(name)[method](...args); }
  testWaits(reader,stream) { return Array.from(this.ctx.storage.sql.exec('SELECT "to",stream,after FROM rings WHERE "to"=? AND stream=?',reader,stream)); }
}
export class Control extends Brain.Control {
  async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer "+this.ctx.props.token) return super.fetch(request);
    const q = await request.clone().json();
    if (!q.method.startsWith("test")) return super.fetch(request);
    try {const stub = q.target === "project" ? this.env.PROJECT.getByName(q.project) : this.env.PROCESS.getByName(JSON.stringify([q.project, await this.env.PROJECT.getByName(q.project).processObject(q.name)]));
      return Response.json({value: await stub[q.method](...q.args) ?? null});} catch {return Response.json({error:{reason:"unreachable"}});}
  }
}`,
  );
  const bundle = await rolldown({
    input: entry,
    platform: "browser",
    external: ["cloudflare:workers"],
  });

  try {
    const out = await bundle.generate({ format: "esm", codeSplitting: false });
    writeFileSync(
      brain,
      out.output
        .filter((item) => item.type === "chunk")
        .map((item) => item.code)
        .join("\n"),
    );
  } finally {
    await bundle.close();
  }
};

const pause = (ms = 20) => new Promise<void>((done) => setTimeout(done, ms));

/** Looks until `done` says yes, for at most `wait` ms. The platform's alarm retry sets the bound. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean, wait = 25_000) => {
  const end = Date.now() + wait;
  let last: A | undefined;

  while (Date.now() < end) {
    last = await look();

    if (done(last)) {
      return last;
    }

    await pause(50);
  }

  throw new Error(`${label}: timed out; last observed ${JSON.stringify(last)}`);
};

const wire = async (instance: any, key: ReturnType<typeof identity>, tab: string) => {
  const name = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
  const socket = new WebSocket(instance.url.replace("http", "ws") + name);
  const frames: any[] = [];
  let closeCode: number | undefined,
    serial = 0;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(JSON.parse(String(event.data)));
    }
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.addEventListener("error", () => {
    closeCode ??= 1006;
  });
  const next = async (match: (frame: any) => boolean) => {
    for (;;) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
      }

      await pause();
    }
  };
  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((frame) => frame.id === id);
  };
  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  expect(
    (
      await call("initialize", {
        versions: [1],
        has: ["seal"],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
      })
    ).error,
  ).toBeUndefined();
  return { name, call, socket, frames, closeCode: () => closeCode };
};

const workerdPid = () => {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((row) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
      return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3]! }] : [];
    });
  const descendants = new Set([process.pid]);

  for (let n = 0; n < rows.length; n++) {
    for (const row of rows) {
      if (descendants.has(row.parent)) {
        descendants.add(row.pid);
      }
    }
  }

  const matches = rows.filter((row) => descendants.has(row.pid) && /\/workerd(?:\s|$)/.test(row.command));
  expect(matches.length).toBeLessThanOrEqual(1);
  return matches[0]?.pid ?? 0;
};

const admitted = async (instance: any, key: ReturnType<typeof identity>, project = "p12-records") => {
  const p = instance.project(project);
  const client = await p.connect(),
    nonce = await p.challenge(client),
    tab = "internal-test";
  const hello = await p.initialize(
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
      signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
    },
    { url: instance.url, tab, name: key.fingerprint },
  );
  expect(hello._tag).toBe("online");
  return { p, client };
};

const routed = (p: any, client: string, method: string, params: unknown) => p.route(client, method, params);

const read = async (p: any, client: string, stream: string) => {
  const r = await routed(p, client, "ledger.read", { stream, after: 0 });
  expect(r._tag).toBe("ok");
  return r.result.entries as Array<any>;
};

describe("P12 real object adapters", () => {
  // Outside only. The saved attachment is read through the real object's private test method.
  // Sleep uses real idle time and must prove a new object instance, not merely a delayed ring.
  it("scenario: saved waits survive object sleep, object abort and workerd replacement", async () => {
    await world(async (instance, key) => {
      const p = instance.project("p12-records"),
        { client } = await admitted(instance, key);
      const pid = (await p.info()).find((row: any) => row.name === "counter:1").process;
      let c = await wire(instance, key, "wait-recovery");
      const gateway = (method: string, ...args: unknown[]) => p.testGateway(c.name, method, args);
      let after = 0;

      try {
        for (const mode of ["sleep", "abort", "replacement"] as const) {
          let settled = false;
          const wait = () =>
            c.call("ledger.wait", { stream: "counter:1/inbox", after }).then(
              (answer) => {
                settled = true;
                return { answer };
              },
              () => {
                settled = true;
                return { closed: true };
              },
            );
          let waiting = wait();
          let before = await gateway("testState");

          while (!before.sockets.some((row: any) => row.attachment.waits?.length === 1)) {
            await pause();
            before = await gateway("testState");
          }

          if (mode === "sleep") {
            // The original pending reply remains the one checked after wake.
            // workerd's idle eviction is normally about ten seconds. This is an outside
            // probe of that behavior: fail if the object did not actually sleep.
            await pause(12_000);
            const awake = await gateway("testState");
            expect(awake.incarnation).not.toBe(before.incarnation);
            expect(awake.sockets[0].attachment.waits).toEqual(before.sockets[0].attachment.waits);
          } else {
            if (mode === "abort") {
              await gateway("testAbort").catch(() => undefined);
            } else {
              const old = workerdPid();
              expect(old).toBeGreaterThan(0);
              process.kill(old, "SIGKILL");
              let current = workerdPid();

              while (current === 0 || current === old) {
                await pause();
                current = workerdPid();
              }

              expect(current).not.toBe(old);
            }

            let awake;

            for (;;) {
              try {
                awake = await gateway("testState");
                break;
              } catch {
                await pause();
              }
            }

            expect(awake.incarnation).not.toBe(before.incarnation);

            // If its socket closes, replay the pending wait before anything can ring it.
            if (mode === "replacement" || c.closeCode() !== undefined || awake.sockets.length === 0) {
              expect(await waiting).toEqual({ closed: true });

              for (;;) {
                try {
                  c = await wire(instance, key, "wait-recovery");
                  break;
                } catch {
                  await pause();
                }
              }

              settled = false;
              waiting = wait();
              let saved = await gateway("testState");

              while (!saved.sockets.some((row: any) => row.attachment.waits?.length === 1)) {
                await pause();
                saved = await gateway("testState");
              }

              before = saved;
            }
          }

          // Inspect saved data only. Calling wait here would conceal a lost registration.
          const pending = before.sockets[0].attachment.waits[0];
          expect(pending).toMatchObject({ stream: "counter:1/inbox", after });
          expect((await gateway("testState")).sockets[0].attachment.waits).toEqual([pending]);
          let rings = await p.testWaits(c.name, "counter:1/inbox");

          while (rings.length === 0) {
            await pause();
            rings = await p.testWaits(c.name, "counter:1/inbox");
          }

          expect(rings).toEqual([{ to: c.name, stream: "counter:1/inbox", after }]);
          expect(settled, `${mode} wait must still be parked before append`).toBe(false);
          const reply = await routed(p, client, "process.send", {
            pid,
            letter: `after-${mode}`,
            m: { type: "inc" },
            sentAt: SENT,
            seen: 0,
          });
          expect(reply).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
          after = reply.result.rev;
          expect(await waiting).toMatchObject({ answer: { id: pending.id, result: { rev: after } } });
          expect((await gateway("testState")).sockets[0].attachment.waits).toEqual([]);
          expect(await p.testWaits(c.name, "counter:1/inbox")).toEqual([]);
          expect((await p.info()).find((row: any) => row.name === "counter:1").process).toBe(pid);
        }
      } finally {
        c.socket.close();
      }
    }, true);
  });
  // Outside only. Hold an actual Process RPC before its inbox append, then kill that object.
  it("scenario: workerd abort closes with 1006; p15 busy plant holds 1012; the stable letter retries once", async () => {
    await world(async (instance, key) => {
      const p = instance.project("p12-records"),
        pid = (await p.info()).find((row: any) => row.name === "counter:1").process;
      const process = instance.process(pid),
        c = await wire(instance, key, "busy-recovery");
      let retry: Awaited<ReturnType<typeof wire>> | undefined;

      try {
        await process.testHold();
        const params = { pid, letter: "busy-once", m: { type: "inc" }, sentAt: SENT, seen: 0 };
        const pending = c.call("process.send", params).then(
          (answer) => ({ answer }),
          () => ({ closed: true }),
        );

        while (!(await process.testEntered())) {
          await pause();
        }

        const before = await p.testGateway(c.name, "testState", []);
        expect(before.sockets[0].attachment.busy).toBe(true);
        await process.abort().catch(() => undefined);
        await process.testRelease();
        await p.testGateway(c.name, "testAbort", []).catch(() => undefined);
        await p.testGateway(c.name, "testState", []);

        while (c.closeCode() === undefined) {
          await pause();
        }

        // workerd abort closes with 1006; "p15 busy plant" in app/gateway.laws.test.ts holds 1012.
        expect([1006, 1012]).toContain(c.closeCode());
        await pending;
        retry = await wire(instance, key, "busy-recovery");
        const first = await retry.call("process.send", params);
        expect(first).toMatchObject({ result: { _tag: "accepted" } });
        expect(await retry.call("process.send", params)).toMatchObject({ result: first.result });
        const opened = await retry.call("view.open", { pid });
        expect(opened).toMatchObject({ result: { view: { count: 1 } } });
        const inbox = await retry.call("ledger.read", { stream: "counter:1/inbox", after: 0 });
        expect(inbox.result.entries.filter((row: any) => row.id === params.letter)).toHaveLength(1);
      } finally {
        c.socket.close();
        retry?.socket.close();
      }
    }, true);
  });
  it("scenario: p79 plant: an old close cannot remove the newer session; failed real probes give unknown", async () => {
    await world(async (instance, key) => {
      const p = instance.project("p12-records");
      const first = {
        client: "client-1",
        key: key.fingerprint,
        gateway: "gateway-1",
        session: processId(),
        at: 1,
      };
      await p.gateways.join(first);
      const newer = processId();
      await p.gateways.join({ ...first, session: newer, at: 2 });
      await p.gateways.leave("client-1", first.session);
      const rows = await p.gateways.online(key.fingerprint);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ client: "client-1", session: newer, state: "unknown" });
      await p.gateways.leave("client-1", newer);
      expect(await p.gateways.online(key.fingerprint)).toEqual([]);
    });
  });
  it("scenario: P37 object wiring plant: alias every SQL part, omit project, or lose had after a lost reply", async () => {
    await world(async (instance) => {
      const chain = { _tag: "spans" } as const;
      const first = instance.record("project-a", "spans/0");
      const rows = Array.from({ length: 70 }, (_, n) => ({ span: span(n), content: null }));
      let part = 0;

      for (const row of rows) {
        for (;;) {
          const answer = await instance.record("project-a", `spans/${part}`).write(chain, part, [row]);

          if (answer._tag === "written") {
            break;
          }

          expect(answer.next).toBe(`spans/${part + 1}`);
          part++;
        }
      }

      expect(part).toBeGreaterThan(0);
      // Lose a successful write reply and resend it through the real manager.
      const manager = RecordManager.remote((name) => recordCalls(instance.record("project-a", name)));
      const found = await Effect.runPromise(
        RecordManager.use((r) => Stream.runCollect(r.read(chain))).pipe(Effect.provide(manager)),
      );
      expect(found.map((r) => r.spanId)).toEqual(rows.map((r) => r.span.spanId));
      const held = await first.read(chain, 0, 0);
      const retry = await first.write(chain, 0, [rows[0], { span: span(99), content: null }]);
      expect(retry).toMatchObject({ _tag: "rolled", had: [rows[0]!.span.spanId] });
      expect((await first.read(chain, 0, 0)).spans).toEqual(held.spans);
      await instance.record("project-b", "spans/0").write(chain, 0, [{ span: span(100), content: null }]);
      expect((await instance.record("project-b", "spans/0").read(chain, 0, 0)).spans.map((r: any) => r.spanId)).toEqual(
        [span(100).spanId],
      );
      expect(found.some((r) => r.spanId === span(100).spanId)).toBe(false);
    });
  });
  it("scenario: R2 archive plant: unlike checksum encodings or a lost acknowledgement must not lose the local copy", async () => {
    await world(async (instance) => {
      const { bucketCalls } = await import("@kampus/libfabrika/workers/runtime");
      const calls = bucketCalls(instance.bucket);
      const body = new TextEncoder().encode("local measurements archive");
      const expected = createHash("sha256").update(body).digest("hex");
      await calls.put("p12/health.json", body, expected);
      expect(await calls.head("p12/health.json")).toEqual({ sha256: expected });
      await expect(calls.put("p12/bad.json", body, "0".repeat(64))).rejects.toThrow();
      const archive = Archive.bucket(calls);
      expect(
        await Effect.runPromise(Archive.use((a) => a.put("p12/health.json", body)).pipe(Effect.provide(archive))),
      ).toEqual({ sha256: expected });
      // The same key/body after a lost answer is legal. A bucket lock would make this fail.
      expect(
        await Effect.runPromise(Archive.use((a) => a.put("p12/health.json", body)).pipe(Effect.provide(archive))),
      ).toEqual({ sha256: expected });

      for (const fail of ["put", "checksum"]) {
        const db = new DatabaseSync(":memory:");

        try {
          const archive = Archive.bucket(
            fail === "put"
              ? {
                  put: async () => {
                    throw new Error("private R2 failure");
                  },
                  head: calls.head,
                }
              : { put: calls.put, head: async () => ({ sha256: "0".repeat(64) }) },
          );
          const records = RecordManager.remote((name) => recordCalls(instance.record("p12-records", name)));
          // P37: a failed archive try deletes nothing and never fails `flush`.
          await expect(
            Effect.runPromise(
              Effect.gen(function* () {
                const sink = yield* SpanSink;
                yield* sink.summaries(0, 1);
                db.prepare(
                  'INSERT INTO measurements (piece,at,ms,ok,error,lag,"spanId") VALUES (?,0,1,1,NULL,NULL,NULL)',
                ).run("fixture");
                // Summarize the fixture's hour, so its day is due and flush tries the archive.
                yield* sink.summaries(0, 1);
                yield* sink.flush;
              }).pipe(
                Effect.provide(
                  Layer.mergeAll(SpanSink.layer(nodeSql(db), { object: "archive-fixture" }), archive, records),
                ),
              ),
            ),
          ).resolves.toBeUndefined();
          expect(db.prepare("SELECT piece FROM measurements WHERE piece='fixture'").all()).toHaveLength(1);
          expect(db.prepare("SELECT * FROM archived").all()).toEqual([]);
          // The try happened and failed: its own measurements row gives the reason.
          expect(db.prepare("SELECT ok,error FROM measurements WHERE piece='sink.archive'").all()).toEqual([
            { ok: 0, error: fail === "put" ? "unreachable" : "mismatch" },
          ]);
          expect(db.prepare("SELECT piece,count FROM summary").all()).toEqual(
            expect.arrayContaining([expect.objectContaining({ piece: "fixture", count: 1 })]),
          );
        } finally {
          db.close();
        }
      }
    });
  });
  it("scenario: recording/content plant: flush before final span, omit failure flush, or trace the sink recursively", async () => {
    await world(async (instance, key, fixture) => {
      const { p, client } = await admitted(instance, key);
      const info = await p.info(),
        pid = info.find((i: any) => i.name === "counter:1").process;
      const input = {
        pid,
        letter: "recorded",
        m: { type: "inc" },
        sentAt: SENT,
        seen: 0,
        traceId: TRACE,
      };
      const accepted = await routed(p, client, "process.send", input);
      expect(accepted).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
      const broken = await fixture.start("broken:1", "p12/writer-fixture");
      await expect(
        routed(p, client, "process.send", {
          ...input,
          pid: broken.process,
          letter: "failed",
          m: { type: "throw", body: "private raw frame P12" },
        }),
      ).rejects.toThrow();
      const manager = RecordManager.remote((name) => recordCalls(instance.record("p12-records", name)));
      const collect = (chain: any) =>
        Effect.runPromise(RecordManager.use((r) => Stream.runCollect(r.read(chain))).pipe(Effect.provide(manager)));
      const job = await collect({ _tag: "job", process: pid });
      expect(job.some((r) => r.name === "runner.step" && r.endTimeUnixNano !== "0")).toBe(true);
      const failures = await collect({ _tag: "job", process: broken.process });
      expect(failures.some((r) => r.ok === false && r.name === "runner.step")).toBe(true);
      expect(job.every((r) => r.attributes["fab.process"] === pid)).toBe(true);
      const outside = await collect({ _tag: "spans" });
      expect(outside.some((r) => r.name === "gateway.initialize")).toBe(true);
      const permanent = JSON.stringify([...job, ...outside, ...failures]);
      expect(permanent).not.toContain("private raw frame P12");
      expect(permanent).not.toContain("private failure P12");
      expect(permanent).not.toContain("PRIVATE KEY");
      expect([...job, ...outside].some((r) => /record\.(write|read)|sink\.flush/.test(r.name))).toBe(false);
      const again = await collect({ _tag: "job", process: pid });
      expect(again.map((r) => r.spanId)).toEqual(job.map((r) => r.spanId));
      expect(new Set(job.map((r) => r.spanId)).size).toBe(job.length);
    });
  });
  it.each(["revoke", "exit"] as const)(
    "scenario: checked writes plant: a receipt cannot authorize a new append after %s",
    async (end) => {
      await world(async (instance, key, fixture) => {
        const { p, client } = await admitted(instance, key);
        // Trusted declarations for this process permit the event; the signer is bound to this pid.
        const started = await fixture.start("writer:1", "p12/writer-fixture");
        const pid = started.process;
        const delivered = await routed(p, client, "process.send", {
          pid,
          letter: "cause",
          m: { type: "prepare" },
          sentAt: SENT,
          seen: 0,
          traceId: TRACE,
        });
        expect(delivered).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
        const parent = (await read(p, client, "writer:1/inbox"))[0].parent;
        const capability = p.forProcess(pid);
        const reply = Schema.decodeUnknownSync(SigningReply)(await capability.sign("write-1", parent, "noted"));
        expect(reply._tag).toBe("ok");

        if (reply._tag !== "ok") {
          throw new Error(`sign refused: ${reply._tag}`);
        }

        const receipt = reply.value;
        expect(receipt.parent).toBe(parent);

        if (end === "exit") {
          await p.exit(pid, { _tag: "normal" }, fixture.from);
        } else {
          const { revokeText } = await import("@kampus/libfabrika/access/Text");
          const text = revokeText({
            id: "revoke-1",
            key: key.raw,
            for: PERSON,
            to: "p12-records",
            saw: { label: "fixture", location: "local", method: "command", check: "none" },
            sentAt: SENT,
          });
          expect(await p.grant({ text, armored: key.proof(text) })).toMatchObject({ _tag: "applied" });
        }

        const refused = { _tag: end === "exit" ? "SigningRefused" : "NotGranted" };
        expect(
          Schema.decodeUnknownSync(CommitReply)(
            await capability.append({
              id: "write-1",
              parent,
              kind: "noted",
              stream: "events",
              event: { _tag: "noted", n: 1 },
            }),
          ),
        ).toMatchObject(refused);
        expect(await p.read("events", 0, "audit")).toEqual([]);
        // A changed process identity cannot reuse a capability issued to the old process.
        await expect(
          capability.append({
            id: "forged",
            parent,
            process: "another",
            kind: "noted",
            stream: "events",
            event: { _tag: "noted" },
          }),
        ).rejects.toMatchObject({ _tag: "ControlError", reason: "reserved" });
        expect(await p.read("events", 0, "audit")).toEqual([]);
      });
    },
  );
  it("scenario: p79/alarm handoff plant: storage wake keeps pid; durable due delivery has one letter and one Cmd", async () => {
    await world(async (instance, key, fixture) => {
      const { p, client } = await admitted(instance, key);
      const start = await fixture.start("timer:1", "p12/timer-fixture");
      const process = instance.process(start.process);
      expect(
        await routed(p, client, "process.send", {
          pid: start.process,
          letter: "schedule",
          m: { type: "schedule", at: 42 },
          sentAt: SENT,
          seen: 0,
        }),
      ).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
      await process.abort();
      expect((await p.info()).find((i: any) => i.name === "timer:1").process).toBe(start.process);
      await process.due(42);
      await process.due(42);
      const inbox = await p.read("timer:1/inbox", 0, "audit");
      expect(inbox.filter((r: any) => r.body.m?.type === "timer")).toHaveLength(1);
      expect(await process.open("audit")).toMatchObject({ view: { count: 1, replies: 1 } });
      expect(await process.alarm()).toBe(52);
      // Durable Activity belongs to P33/P11. A wake must report it instead of counting constructors.
      await process.activity({
        _tag: "stepping",
        process: start.process,
        letter: "interrupted",
        build: "fixture",
      });
      await process.abort();
      expect(await process.recover()).toMatchObject({ _tag: "interrupted", letter: "interrupted" });
    });
  });
  // Outside only. Ticket 502 slice S2, law 4: only the platform evicts an idle object, so this waits
  // past workerd's idle time on the real clock and must see a new instance, not a slow answer.
  // Plant: fork a fiber that sleeps in the Process object's Layer, which keeps the object awake.
  it("scenario: T502 law 4: an idle Process object sleeps, and wakes as a new instance with its saved wake and view", async () => {
    await world(async (instance, key, fixture) => {
      const { p, client } = await admitted(instance, key);
      const started = await fixture.start("sleeper:1", "p12/alarm-fixture");
      const object = instance.process(started.process);
      // An hour away: the wake is saved, and no alarm arrives to keep the object awake.
      const far = Date.now() + 3_600_000;
      const send = (letter: string, m: unknown) =>
        routed(p, client, "process.send", { pid: started.process, letter, m, sentAt: SENT, seen: 0 });
      expect(await send("arm", { type: "schedule", at: far })).toMatchObject({
        _tag: "ok",
        result: { _tag: "accepted" },
      });
      const view = await object.open("audit");
      expect(view).toMatchObject({ view: { fired: 0, wake: far } });
      expect(await object.alarm()).toBe(far);
      const before = await object.testState();
      // workerd's idle eviction is about ten seconds, as in the Connection scenario above.
      await pause(12_000);
      const awake = await object.testState();
      expect(awake.incarnation, "the object must have slept").not.toBe(before.incarnation);
      expect(await object.alarm()).toBe(far);
      expect(await object.open("audit")).toEqual(view);
      expect((await p.info()).find((row: any) => row.name === "sleeper:1").process).toBe(started.process);
      expect(await object.testAlarms()).toEqual({ delivered: 0, failed: 0 });
      // The woken instance still takes a letter, and drops the wake it kept.
      expect(await send("drop", { type: "cancel" })).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
      expect(await object.alarm()).toBeNull();
    }, true);
  }, 120_000);
  // Outside only. Ticket 502 slice S2, law 10 on the real Process object: only the platform fires,
  // deletes and retries an alarm. The exam's Process counts each delivery, and each one the object
  // failed. A failure is made by taking the saved descriptor away, so the object's own service
  // cannot be built when the alarm arrives; putting it back lets the platform's next try through.
  // Plants: drop the `alarm` slot from the Layer (nothing fires); catch the alarm's failure in the
  // Layer and answer done (the platform never tries again, so the wake is lost).
  it("scenario: T502 law 10: a saved alarm fires once, a deleted one never fires, and a failed one is retried", async () => {
    await world(async (instance, key, fixture) => {
      const { p, client } = await admitted(instance, key);
      const accepted = { _tag: "ok", result: { _tag: "accepted" } };
      const send = (pid: string, letter: string, m: unknown) =>
        routed(p, client, "process.send", { pid, letter, m, sentAt: SENT, seen: 0 });
      const timers = async (name: string) =>
        (await p.read(`${name}/inbox`, 0, "audit")).filter((row: any) => row.body.m?.type === "timer");

      // 1. A saved alarm fires once: one timer letter for the wake, and the wake is spent.
      const once = await fixture.start("once:1", "p12/alarm-fixture");
      const first = Date.now() + 1_000;
      expect(await send(once.process, "arm", { type: "schedule", at: first })).toMatchObject(accepted);
      expect(await instance.process(once.process).alarm()).toBe(first);
      await until(
        "the saved alarm's timer letter",
        () => timers("once:1"),
        (rows) => rows.length >= 1,
      );
      // Long enough for a second delivery of the same wake to show.
      await pause(1_500);
      const fired = await timers("once:1");
      expect(fired).toHaveLength(1);
      expect(fired[0].body.m).toMatchObject({ type: "timer", at: first });
      expect(await instance.process(once.process).open("audit")).toMatchObject({ view: { fired: 1, wake: null } });
      expect(await instance.process(once.process).alarm()).toBeNull();
      const counted = await instance.process(once.process).testAlarms();
      expect(counted.delivered).toBeGreaterThanOrEqual(1);
      expect(counted.failed).toBe(0);

      // 2. A deleted alarm never fires: the platform delivers nothing after the wake is dropped.
      const never = await fixture.start("never:1", "p12/alarm-fixture");
      const second = Date.now() + 2_000;
      expect(await send(never.process, "arm", { type: "schedule", at: second })).toMatchObject(accepted);
      expect(await instance.process(never.process).alarm()).toBe(second);
      expect(await send(never.process, "drop", { type: "cancel" })).toMatchObject(accepted);
      expect(await instance.process(never.process).alarm()).toBeNull();
      await pause(Math.max(0, second - Date.now()) + 1_500);
      expect(await timers("never:1")).toEqual([]);
      expect(await instance.process(never.process).testAlarms()).toEqual({ delivered: 0, failed: 0 });
      expect(await instance.process(never.process).open("audit")).toMatchObject({ view: { fired: 0, wake: null } });

      // 3. A failed alarm is retried: it fails while the descriptor is gone, and its wake is
      // delivered, once, by a later try after the descriptor is back.
      const retried = await fixture.start("retry:1", "p12/alarm-fixture");
      const third = Date.now() + 2_000;
      expect(await send(retried.process, "arm", { type: "schedule", at: third })).toMatchObject(accepted);
      // Both exam calls end in a platform abort, which rejects the call that asked for it.
      await instance
        .process(retried.process)
        .testBreak()
        .catch(() => undefined);
      await until(
        "one failed delivery of the alarm",
        () => instance.process(retried.process).testAlarms(),
        (seen: any) => seen.failed >= 1,
      );
      expect(await timers("retry:1")).toEqual([]);
      await instance
        .process(retried.process)
        .testRepair()
        .catch(() => undefined);
      await until(
        "the retried alarm's timer letter",
        () => timers("retry:1"),
        (rows) => rows.length >= 1,
      );
      await pause(1_500);
      const late = await timers("retry:1");
      expect(late).toHaveLength(1);
      expect(late[0].body.m).toMatchObject({ type: "timer", at: third });
      const seen = await instance.process(retried.process).testAlarms();
      expect(seen.failed).toBeGreaterThanOrEqual(1);
      expect(seen.delivered).toBeGreaterThan(seen.failed);
      expect(await instance.process(retried.process).open("audit")).toMatchObject({ view: { fired: 1, wake: null } });
    }, true);
  }, 180_000);
  it("scenario: sealed program plant: external fetch and Project/R2 bindings stay unavailable; unknown program fails", async () => {
    await world(async (instance, _key, probe) => {
      const loader = instance.loader;
      await expect(loader.load("no-such-program", processId())).rejects.toMatchObject({
        reason: "no_program",
      });
      const sealed = await loader.load("p12/sealed-fixture", processId());
      expect((await sealed.init(null)).view).toEqual({ bindings: [], outbound: "blocked" });
      expect(probe.hits()).toBe(0);
      const counter = await loader.load("fabrika/counter", processId());
      expect(await counter.init(null)).toMatchObject({ _tag: "stepped", view: { count: 0 } });
      expect(await counter.step({ count: 0 }, { type: "inc" })).toMatchObject({
        _tag: "stepped",
        view: { count: 1 },
      });
    });
  });
});
