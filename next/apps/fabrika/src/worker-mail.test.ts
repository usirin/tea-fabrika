// P41 slice 2, next/. Real workerd, sockets, object storage,
// alarms and the private local instance capability, set up the way P12's instance-records test is.
// No directly constructed runner and no raw Miniflare stands in for the instance.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Effect, Schema, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-09T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PROJECT = "p41-workers";
// Bounded waits tied to observable facts. Backoff is 100 to 800 ms, so this is generous.
const WAIT = 25_000;

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

type Key = ReturnType<typeof identity>;

// The fixtures use the same Send/ref exchange as slice 1. Source is bundled by the real app build.
const source = (role: "requester" | "responder", pair: number) => `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {send} from "@kampus/libfabrika/runtime/Send";
const Model = Schema.Struct({phase: Schema.Literals(["idle", "waiting", "answered", "failed"]), ref: Schema.String, value: Schema.Int, count: Schema.Int, reason: Schema.String});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("start"), ref: Schema.String, value: Schema.Int}),
 Schema.Struct({type: Schema.Literal("request"), ref: Schema.String, value: Schema.Int, reply: Schema.String}),
 Schema.Struct({type: Schema.Literal("answer"), ref: Schema.String, value: Schema.Int}),
 Schema.Struct({type: Schema.Literal("crash")})
]);
const machine = Machine.make({model: Model, msg: Msg, cmds: [send],
 init: (loaded) => [loaded ?? {phase: "idle", ref: "", value: 0, count: 0, reason: ""}, []],
 update: {
  start: (s,m) => [{...s, phase: "waiting", ref: m.ref}, [send({to: "responder:${pair}", m: {type: "request", ref: m.ref, value: m.value, reply: "requester:${pair}"}})]],
  request: (s,m) => [{...s, count: s.count+1}, [send({to: m.reply, m: {type: "answer", ref: m.ref, value: m.value+1}})]],
  answer: (s,m) => s.phase === "waiting" && s.ref === m.ref ? [{...s, phase: "answered", value: m.value}, []] : [s, []],
  send_ok: (s) => [s, []],
  send_err: (s,m) => s.phase === "waiting" ? [{...s, phase: "failed", reason: m.error._tag}, []] : [s, []],
  crash: () => { throw new TypeError("fixture crash"); }
 }});
export const program = Program.make({name: "${role}-${pair}", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: ${role === "requester" ? '{start: "Ask", answer: "Answer"}' : '{request: "Request", crash: "Crash"}'},
 outputs: {}, writes: {}, wake: () => null});
`;

type Instance = any;

type Fixture = {
  readonly from: From;
  readonly hash: string;
  readonly start: (name: string) => Promise<string>;
  readonly connect: (tab: string) => ReturnType<typeof wire>;
};

const world = async (test: (instance: Instance, key: Key, fixture: Fixture) => Promise<void>, granted = true) => {
  process.env.DO_NOT_TRACK = "1";
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");
  return Effect.runPromise(
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "p41w-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );
      const key = identity();
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.FABRIKA_HOME;
          process.env.FABRIKA_HOME = home;
          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.FABRIKA_HOME;
            } else {
              process.env.FABRIKA_HOME = previous;
            }
          }),
      );
      symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const selections: Record<string, string> = {};

      for (const pair of [1, 2]) {
        for (const role of ["requester", "responder"] as const) {
          const name = `${role}-${pair}`;
          const path = join(home, `${name}.ts`);
          writeFileSync(path, source(role, pair));
          selections[name] = path;
        }
      }

      const built = yield* build({ out: join(home, "dist"), programs: selections });
      yield* Effect.gen(function* () {
        // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
        const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
        const instance = yield* localInstance(built, {
          home,
          name: PROJECT,
          person: PERSON,
          founder: key.line,
          window: key.raw,
          port: at.port,
          mail: {
            grants: granted
              ? {
                  "requester:1": ["responder:1"],
                  "responder:1": ["requester:1"],
                  "requester:2": ["responder:2"],
                  "responder:2": ["requester:2"],
                }
              : {},
          },
        });
        const scope = yield* Effect.scope;
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
            from,
            hash: built.build,
            connect: (tab) =>
              Effect.runPromise(
                Effect.gen(function* () {
                  const socket = yield* Effect.acquireRelease(
                    Effect.sync(
                      () =>
                        new WebSocket(
                          `${instance.url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
                        ),
                    ),
                    (socket) => Effect.sync(() => socket.close()),
                  );
                  return yield* Effect.promise(() => wire(instance, key, tab, socket));
                }).pipe(Effect.provideService(Scope.Scope, scope)),
              ),
            start: async (name) => {
              const program = name.replace(":", "-");
              const code = built.programs[program];
              expect(code).toBeDefined();
              const started = await Reflect.get(instance.project(PROJECT), "start")(
                {
                  _tag: "first",
                  id: `start-${name}`,
                  name,
                  code: { program, hash: code!.hash },
                },
                from,
              );
              return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
            },
          }),
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(localState()),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(NodeServices.layer),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
};

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(what: string, look: () => Promise<A>, done: (value: A) => boolean, ms = WAIT): Promise<A> => {
  const end = Date.now() + ms;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${what}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, initialized with a signed hello. */
const wire = async (instance: Instance, key: Key, tab: string, socket: WebSocket) => {
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
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms; last frames ${JSON.stringify(frames.slice(-3))}`);
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
  return { call, next };
};

const facts = async (instance: Instance, stream: string) =>
  ((await instance.project(PROJECT).read(stream, 0, "audit")) as Array<any>).map((row) => ({
    ...row.body,
    _tag: row._tag,
  }));

const request = (pid: string, ref: string) => ({
  pid,
  letter: `start-${ref}`,
  m: { type: "start", ref, value: 7 },
  sentAt: SENT,
  seen: 0,
});

const answer = async (instance: Instance, name = "requester:1", ref = "exchange") =>
  until(
    "answer letter",
    () => facts(instance, `${name}/inbox`),
    (rows) => rows.some((r) => r.m?.type === "answer" && r.m.ref === ref),
  );

// Read the view notifications; polling view.open would itself drain the requester's inbox.
const changed = async (client: Awaited<ReturnType<typeof wire>>, phase: string) =>
  client.next(
    (frame) =>
      frame.method === "view.patch" && frame.params.patch.some((p: any) => p.path === "/phase" && p.value === phase),
  );

// scenario: only workerd runs these two Process objects, real RPC and platform alarms.
it("scenario: W1 and W6, the door receives waiting then answered 8 and both objects release their alarms", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    const responder = await fixture.start("responder:1");
    const client = await fixture.connect("exchange");
    await client.call("view.open", { pid: requester });
    expect(await client.call("process.send", request(requester, "exchange"))).toMatchObject({
      result: { _tag: "accepted" },
    });
    await changed(client, "waiting");
    const patch = await changed(client, "answered");
    expect(patch.params.patch).toEqual(expect.arrayContaining([{ op: "replace", path: "/value", value: 8 }]));
    await until(
      "idle alarms",
      async () => [await instance.process(requester).savedAlarm(), await instance.process(responder).savedAlarm()],
      (alarms) => alarms.every((at) => at == null),
    );
  });
}, 180_000);

// scenario: abort is workerd's real eviction. Either alarm/abort order must keep exactly one exchange.
it("scenario: W2, aborting the target after its wake preserves one request and one answer", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    const responder = await fixture.start("responder:1");
    const client = await fixture.connect("evict-target");
    await client.call("view.open", { pid: requester });
    expect(await client.call("process.send", request(requester, "eviction"))).toMatchObject({
      result: { _tag: "accepted" },
    });
    // The accepted Send has awaited the target's mailed RPC. No target call precedes the abort.
    await instance
      .process(responder)
      .abort()
      .catch(() => undefined);
    await changed(client, "answered");
    await answer(instance, "requester:1", "eviction");
    expect((await facts(instance, "requester:1/outbox")).filter((r) => r.ref === "eviction")).toHaveLength(1);
    const inbox = await facts(instance, "responder:1/inbox");
    expect(inbox.filter((r) => r.m?.type === "request" && r.m.ref === "eviction")).toHaveLength(1);
    const answers = await facts(instance, "requester:1/inbox");
    expect(answers.filter((r) => r.m?.type === "answer" && r.m.ref === "eviction")).toHaveLength(1);
    await until(
      "the requester has drained its answer",
      () => instance.process(requester).savedAlarm(),
      (at) => at == null,
    );
    expect(await client.call("view.open", { pid: requester })).toMatchObject({
      result: { view: { phase: "answered", ref: "eviction", value: 8 } },
    });
  });
}, 180_000);

// scenario: the host's instance composition supplies grants to the actual Project object.
it("scenario: W4, no host grant refuses the requester and leaves the target inbox empty", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    await fixture.start("responder:1");
    const client = await fixture.connect("no-grant");
    await client.call("process.send", request(requester, "denied"));
    expect(await client.call("view.open", { pid: requester })).toMatchObject({
      result: { view: { phase: "failed", reason: "forbidden" } },
    });
    expect(await facts(instance, "responder:1/inbox")).toEqual([]);
  }, false);
}, 180_000);

// scenario: only real object recovery establishes the Worker's restart brake and its saved wait.
it("scenario: W5, mail respects a target's brake while another pair completes", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    let responder = await fixture.start("responder:1");
    const other = await fixture.start("requester:2");
    await fixture.start("responder:2");
    const client = await fixture.connect("brake");
    let down: any;

    for (let n = 0; n < 20 && down === undefined; n++) {
      await client.call("process.send", {
        pid: responder,
        letter: `crash-${n}`,
        m: { type: "crash" },
        sentAt: SENT,
        seen: 0,
      });
      const rows = await until(
        "restart or brake",
        () => facts(instance, "processes/responder:1"),
        (rows) =>
          rows.some((r) => r._tag === "down") || rows.some((r) => r._tag === "restarted" && r.after === responder),
      );
      down = rows.find((r) => r._tag === "down");

      if (down === undefined) {
        responder = rows.find((r) => r._tag === "restarted" && r.after === responder).process;
      }
    }

    expect(down, "the real restart brake must be reached").toBeDefined();
    const before = (await facts(instance, "processes/responder:1")).filter((r) => r._tag === "restarted").length;
    await client.call("process.send", request(requester, "braked"));
    await client.call("view.open", { pid: other });
    await client.call("process.send", request(other, "healthy"));
    await changed(client, "answered");
    expect(Date.now(), "the independent pair finishes inside the target's real recovery wait").toBeLessThan(down.until);
    expect((await facts(instance, "processes/responder:1")).filter((r) => r._tag === "restarted")).toHaveLength(before);
    expect((await facts(instance, "responder:1/inbox")).filter((r) => r.m?.ref === "braked")).toHaveLength(1);
    expect((await facts(instance, "requester:1/inbox")).filter((r) => r.m?.type === "answer")).toEqual([]);
    expect(await client.call("view.open", { pid: requester })).toMatchObject({
      result: { view: { phase: "waiting", ref: "braked" } },
    });
    expect(await instance.process(responder).savedAlarm()).toBe(down.until);
  });
}, 180_000);
