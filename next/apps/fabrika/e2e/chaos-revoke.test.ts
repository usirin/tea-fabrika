// next/, P17b p90. Lead runs the real platform scenario and its final-admission plant on the host.
// edge: Effect's WebSocket adapter cannot ignore a peer's Close frame.
import { createConnection } from "node:net";
import { NodeServices } from "@effect/platform-node";
import { build } from "@kampus/libfabrika/build";
import { Start } from "@kampus/libfabrika/processes/Process";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Clock, Effect, Fiber, FileSystem, Layer, Path, Queue, Schema, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { localInstance } from "../src/local-instance.ts";
import { heldPort } from "../src/port.test-support.ts";
import * as RecordWireTest from "../src/record-wire.test-support.ts";
import { programs } from "../src/table.ts";

import { Outcome } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { chaos } from "@kampus/chaos";
import { Chaos, type Handler } from "@kampus/libfabrika";
import { grantText, revokeText } from "@kampus/libfabrika/access/Text";
import { Ledger, type LedgerCalls } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerRemote from "@kampus/libfabrika/ledger/LedgerRemote";
import * as ChaosTest from "@kampus/libfabrika/node/Chaos.test-support";
import * as ProcessHistoryLedger from "@kampus/libfabrika/processes/ProcessHistoryLedger";
import * as ChaosSchedule from "@kampus/libfabrika/runtime/ChaosSchedule";
import { Nemesis } from "@kampus/libfabrika/runtime/Nemesis";
import * as NemesisLedger from "@kampus/libfabrika/runtime/NemesisLedger";
import * as RevokeHold from "./chaos-revoke.test-support.ts";

const PERSON = "person_0000000000e008000000000001";
const PROJECT = "p17b-revoke";
const SENT = "2026-11-12T00:00:00.000Z";
class WireFailure extends Schema.TaggedError<WireFailure>()("WireFailure", { cause: Schema.Defect() }) {}

const field = (raw: string | Uint8Array) => {
  const bytes = Buffer.from(raw);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return Buffer.concat([size, bytes]);
};

/** Nonextractable private material exists only in this scope, never in a file or report. */
const identity = Effect.fn("RevokeTest.identity")(function* () {
  const pair = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
      catch: (cause) => new WireFailure({ cause }),
    }),
    () => Effect.void,
  );
  const bytes = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => crypto.subtle.exportKey("raw", pair.publicKey),
      catch: (cause) => new WireFailure({ cause }),
    }),
  );
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: (cause) => new WireFailure({ cause }),
  });
  const line = Schema.decodeUnknownSync(KeyLine)(
    `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(bytes)]).toString("base64")}`,
  );
  return {
    raw: Buffer.from(bytes).toString("base64url"),
    fingerprint: `SHA256:${Buffer.from(digest).toString("base64").replace(/=+$/, "")}`,
    line,
    proof: (text: string) =>
      writeSshsig({
        text,
        line,
        space: "fabrika-client",
        sign: (bytes) =>
          Effect.tryPromise({
            try: () => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)),
            catch: (cause) => new WireFailure({ cause }),
          }).pipe(Effect.map((signed) => new Uint8Array(signed))),
      }),
  };
});

const Frame = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

/** Masked client frame, RFC 6455 section 5.2; the payload is a complete small JSON request. */
const encode = (value: unknown) => {
  const payload = new TextEncoder().encode(JSON.stringify(value));

  if (payload.length > 65535) {
    throw new RangeError("test request exceeds the short frame limit");
  }

  const mask = crypto.getRandomValues(new Uint8Array(4));
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
  header[0] = 0x81;
  header[1] = 0x80 | (payload.length < 126 ? payload.length : 126);

  if (payload.length >= 126) {
    header.writeUInt16BE(payload.length, 2);
  }

  return Buffer.concat([header, mask, payload.map((byte, n) => byte ^ (mask[n % 4] ?? 0))]);
};

/** The raw client keeps TCP's write half open and never acknowledges a WebSocket Close. */
const connect = Effect.fn("RevokeTest.connect")(function* (
  url: string,
  key: Effect.Success<ReturnType<typeof identity>>,
  tab: string,
) {
  const address = new URL(url);
  const chunks = yield* Queue.unbounded<Buffer>();
  const closes: Array<number> = [];
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => createConnection({ host: address.hostname, port: Number(address.port), allowHalfOpen: true })),
    (held) => Effect.sync(() => held.destroy()),
  );
  const listen = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const data = (bytes: Buffer) => {
        Queue.offerUnsafe(chunks, bytes);
      };
      const error = () => {
        Queue.offerUnsafe(chunks, Buffer.alloc(0));
      };
      socket.on("data", data);
      socket.on("error", error);
      socket.on("end", error);
      return { data, error };
    }),
    ({ data, error }) =>
      Effect.sync(() => {
        socket.off("data", data);
        socket.off("error", error);
        socket.off("end", error);
      }),
  );
  void listen;
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  socket.write(
    `GET /client/${encodeURIComponent(key.fingerprint)}/${tab} HTTP/1.1\r\nHost: ${address.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${nonce}\r\nOrigin: ${url}\r\n\r\n`,
  );
  let buffered = Buffer.alloc(0);
  const more = Effect.gen(function* () {
    const bytes = yield* Queue.take(chunks).pipe(Effect.timeout("20 seconds"));

    if (bytes.length === 0) {
      return yield* new WireFailure({ cause: "transport closed" });
    }

    buffered = Buffer.concat([buffered, bytes]);
  });

  while (!buffered.includes("\r\n\r\n")) {
    yield* more;
  }

  const boundary = buffered.indexOf("\r\n\r\n");

  if (!/^HTTP\/1\.1 101 /.test(buffered.subarray(0, boundary).toString())) {
    return yield* new WireFailure({ cause: "upgrade refused" });
  }

  buffered = buffered.subarray(boundary + 4);
  const frame = Effect.fnUntraced(function* () {
    while (true) {
      while (buffered.length < 2) {
        yield* more;
      }

      const opcode = (buffered[0] ?? 0) & 15;
      const short = (buffered[1] ?? 0) & 127;
      const header = short === 126 ? 4 : short === 127 ? 10 : 2;

      while (buffered.length < header) {
        yield* more;
      }

      const size =
        short === 126 ? buffered.readUInt16BE(2) : short === 127 ? Number(buffered.readBigUInt64BE(2)) : short;

      if (!Number.isSafeInteger(size) || size > 1024 * 1024) {
        return yield* new WireFailure({ cause: "oversized test frame" });
      }

      while (buffered.length < header + size) {
        yield* more;
      }

      const body = buffered.subarray(header, header + size);
      buffered = buffered.subarray(header + size);

      if (opcode === 8) {
        closes.push(body.length >= 2 ? body.readUInt16BE(0) : 1005);
        continue;
      }

      if (opcode === 1 && body.toString() !== "pong") {
        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Frame))(body.toString());
      }
    }
  });
  const next = Effect.fnUntraced(function* (match: (value: typeof Frame.Type) => boolean) {
    while (true) {
      const value = yield* frame();

      if (match(value)) {
        return value;
      }
    }
  });
  // A JSON-RPC 2.0 id only has to be unique among this client's open requests.
  let calls = 0;
  const call = Effect.fnUntraced(function* (method: string, params: unknown) {
    const id = `call-${++calls}`;
    socket.write(encode({ jsonrpc: "2.0", id, method, params }));
    return yield* next((value) => value.id === id);
  });
  const challenge = yield* next((value) => value.method === "challenge");
  const { nonce: challengeNonce } = yield* Schema.decodeUnknownEffect(Schema.Struct({ nonce: Schema.String }))(
    challenge.params,
  );
  const first = yield* call("initialize", {
    versions: [1],
    has: ["seal"],
    ping: "30s",
    key: key.raw,
    tab,
    nonce: challengeNonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: yield* key.proof(`fabrika-hello\n${url}\n${tab}\n${challengeNonce}`),
  });
  return {
    first,
    call,
    closes,
  };
});

/** A local binding's calls, as the dev command sees them. */
type Binding = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;

const invoke = Effect.fn("RevokeTest.control")(function* (
  binding: Binding,
  method: string,
  args: ReadonlyArray<unknown>,
) {
  const target = binding[method];

  if (target === undefined) {
    return yield* new WireFailure({ cause: new Error(`the binding has no ${method} call`) });
  }

  return yield* Effect.tryPromise({
    try: () => Reflect.apply(target, binding, args),
    catch: (cause) => new WireFailure({ cause }),
  });
});

const served = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ directory: path.join(path.sep, "tmp"), prefix: "p17b-" });
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = {
        home: process.env.FABRIKA_HOME,
        alchemy: process.env.ALCHEMY_HOME,
        track: process.env.DO_NOT_TRACK,
      };
      process.env.FABRIKA_HOME = home;
      process.env.DO_NOT_TRACK = "1";
      delete process.env.TYPESAFE_API_KEY;
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [name, value] of [
          ["FABRIKA_HOME", previous.home],
          ["ALCHEMY_HOME", previous.alchemy],
          ["DO_NOT_TRACK", previous.track],
        ] as const) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
      }),
  );
  const root = yield* identity();
  const old = yield* identity();
  const other = yield* identity();
  const app = path.resolve(import.meta.dirname, "..");
  const repo = path.resolve(app, "../../..");
  const built = yield* build({
    root: repo,
    entry: path.join(app, "e2e/chaos-revoke.worker.test-support.ts"),
    out: path.join(home, "dist"),
    // P14 slice 2: the app's table lists `fabrika/checklist` itself.
    programs,
    files: [],
    ledger: [],
    chaos: false,
  });
  const { localState } = yield* Effect.tryPromise({
    try: () => import("alchemy/State/LocalState"),
    catch: (cause) => new WireFailure({ cause }),
  });
  const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const instance = yield* localInstance(
    built,
    RecordWireTest.settingsFixture({
      home,
      name: PROJECT,
      person: PERSON,
      founder: root.line,
      window: old.raw,
      port,
    }),
  ).pipe(Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(localState()));
  const from = {
    by: root.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    build: built.build,
  };
  const source = built.programs["fabrika/checklist"];

  if (source === undefined) {
    return yield* Effect.die(new Error("the real checklist was not built"));
  }

  const started = yield* invoke(instance.project(PROJECT), "start", [
    Start.cases.first.make({
      id: "checklist-start",
      // P14 slice 2: the real entry boots `checklist:1` itself, so the proof starts its own target
      // under the next name, owned by this test's root key.
      name: "checklist:2",
      code: { program: "fabrika/checklist", hash: source.hash },
    }),
    from,
  ]);
  const { process: pid } = yield* Schema.decodeUnknownEffect(Schema.Struct({ process: Schema.String }))(started);
  const read = (stream: string) => invoke(instance.project(PROJECT), "read", [stream, 0, "p17b-audit"]);
  return { root, old, other, instance, pid, read, built: built.build };
}).pipe(Effect.provide(NodeServices.layer));

const until = Effect.fn("RevokeTest.until")(function* <A, E, R>(
  look: Effect.Effect<A, E, R>,
  ready: (value: A) => boolean,
) {
  const end = (yield* Clock.currentTimeMillis) + 20_000;

  while (true) {
    const value = yield* look;

    if (ready(value)) {
      return value;
    }

    if ((yield* Clock.currentTimeMillis) >= end) {
      return yield* Effect.die(new Error("local revoke proof did not reach its expected history"));
    }

    yield* Effect.sleep("25 millis");
  }
});

const RevokeTest = { PERSON, PROJECT, SENT, served, connect, invoke, until };

const NAME = "chaos:revoke";
const TARGET = "checklist:2";
const SEED = 119120;

it.live(
  "scenario: p90 signed revoke over real WebSocket, gateway, Alchemy and workerd rejects an ignored-close client while another client writes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* RevokeTest.served;
        const { instance, old: oldKey, other: otherKey, root, pid } = fixture;
        const project = instance.project(RevokeTest.PROJECT);
        // The private Alchemy binding already implements the project's public ledger-call protocol.
        const { append, read, wait } = project;

        if (append === undefined || read === undefined || wait === undefined) {
          return yield* Effect.die(new Error("the project binding has no ledger calls"));
        }

        const calls: LedgerCalls = { append, read, wait };
        const ledger = LedgerRemote.layer(calls, { reader: "p17b-revoke-audit" });
        const rows = (stream: string) =>
          Ledger.use((service) => Stream.runCollect(service.read(stream, 0))).pipe(Effect.provide(ledger));
        const old = yield* RevokeTest.connect(instance.url, oldKey, "old");
        expect(old.first.error).toBeUndefined();
        const grant = grantText({
          id: "grant-other",
          key: otherKey.raw,
          for: RevokeTest.PERSON,
          to: RevokeTest.PROJECT,
          as: "window",
          sentAt: RevokeTest.SENT,
          saw: {
            code: "123456",
            label: "Other test client",
            location: "local",
            method: "command",
            check: "none",
            has: [],
          },
        });
        expect(
          yield* RevokeTest.invoke(project, "grant", [{ text: grant, armored: yield* root.proof(grant) }]),
        ).toMatchObject({ _tag: "applied" });
        const other = yield* RevokeTest.connect(instance.url, otherKey, "other");
        expect(other.first.error).toBeUndefined();
        const input = (letter: string, name: string) => ({
          pid,
          letter,
          m: { type: "add", name },
          sentAt: RevokeTest.SENT,
          seen: 0,
        });
        const before = yield* old.call("process.send", input("old-before", "before"));
        expect(before.error).toBeUndefined();
        expect(before.result).toMatchObject({ _tag: "accepted" });
        const hold = (method: string, params: unknown = {}) =>
          RevokeTest.invoke(project, "route", ["p90-control", method, params, "p90-control"]);
        yield* Effect.acquireRelease(hold("p90.arm", { process: pid }), () => hold("p90.release").pipe(Effect.orDie));
        const delayed = yield* Effect.forkScoped(
          old.call("process.send", input("old-delayed", "must-not-land")).pipe(Effect.exit),
        );
        expect(
          yield* RevokeTest.until(
            hold("p90.status"),
            (answer) =>
              Schema.is(Schema.Struct({ _tag: Schema.Literal("ok"), result: RevokeHold.Model }))(answer) &&
              answer.result._tag === "held",
          ),
        ).toMatchObject({ result: { _tag: "held", process: pid } });
        // Nothing has been written yet. The real request has already passed online membership.
        expect((yield* rows("gateway/inputs")).filter((row) => row.by === oldKey.fingerprint)).toHaveLength(1);
        const binding = Chaos.Target.make({
          program: "fabrika/checklist",
          name: TARGET,
          process: pid,
          client: oldKey.fingerprint,
          key: oldKey.raw,
        });
        const id = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000017");
        const start = Chaos.Start.make({ id, seed: SEED, target: binding, most: 64, gap: 1000 });
        let schedule = ChaosSchedule.seed(start.seed);
        let most = 0;

        // Select the cap from the actual saved schedule, without replacing any selected fault.
        while (most < start.most) {
          const draw = ChaosSchedule.draw(schedule, start);
          schedule = draw.schedule;
          most++;

          if (draw.fault._tag === "revoke_key") {
            break;
          }
        }

        expect(most).toBeLessThan(start.most);
        const world = yield* ChaosTest.open;
        const fire: Handler<never> = (raw) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(Schema.toType(Chaos.Fire))(raw);

            if (request.fault._tag !== "revoke_key") {
              return Outcome.ok(Chaos.Fired.cases.refused.make({ reason: "off" }));
            }

            expect(request.target).toEqual(binding);
            expect(request.fault.key).toBe(oldKey.raw);
            const model = yield* world.snapshot(NAME);
            const saved = Schema.decodeUnknownSync(chaos.state.schema)(model.model);
            expect(saved.phase._tag).toBe("checking");

            if (saved.phase._tag !== "checking") {
              return yield* Effect.die(new Error("the revoke was not saved before firing"));
            }

            expect(saved.phase.experiment.asked.at(-1)).toMatchObject({
              ordinal: request.ordinal,
              fault: request.fault,
            });
            const text = revokeText({
              id: `revoke-${request.id}-${request.ordinal}`,
              key: request.fault.key,
              for: RevokeTest.PERSON,
              to: RevokeTest.PROJECT,
              sentAt: RevokeTest.SENT,
              saw: { label: "Old test client", location: "local", method: "command", check: "none" },
            });
            expect(
              yield* RevokeTest.invoke(project, "grant", [{ text, armored: yield* root.proof(text) }]),
            ).toMatchObject({ _tag: "applied" });
            return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
          });
        const nemesis = NemesisLedger.layer(() => Effect.die("only the host fire handler revokes")).pipe(
          Layer.provide(ProcessHistoryLedger.layer),
          Layer.provide(ledger),
        );
        const handlers: Readonly<Record<string, Handler<never>>> = {
          now: () => Clock.currentTimeMillis.pipe(Effect.map(Outcome.ok)),
          fire,
          inspect: () =>
            Nemesis.use((service) => service.check(binding)).pipe(Effect.provide(nemesis), Effect.map(Outcome.ok)),
        };
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
            expect((yield* runner.msg(world.letter(1, { type: "start", ...start, most })))._tag).toBe("accepted");

            for (let n = 0; n < most; n++) {
              const saved = Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model);
              const deadline = chaos.wake(saved);

              if (deadline === null) {
                return yield* Effect.die(new Error("the revoke experiment lost its timer"));
              }

              yield* runner.due(deadline);
            }
          }),
        );
        const final = Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model);
        expect(final.phase._tag).toBe("done");
        const revoked = (yield* rows("gateway/access")).find((row) => row._tag === "revoked");
        expect(revoked).toBeDefined();

        if (revoked === undefined) {
          return yield* Effect.die(new Error("signed revoke is absent from real history"));
        }

        expect(yield* hold("p90.release")).toMatchObject({ result: { _tag: "released", process: pid } });
        const queued = yield* Fiber.join(delayed);

        if (queued._tag === "Success") {
          expect(queued.value.result).not.toMatchObject({ _tag: "accepted" });
          expect(queued.value.error).toBeDefined();
        }

        const late = yield* old
          .call("process.send", input("old-ignored-close", "also-must-not-land"))
          .pipe(Effect.exit);

        if (late._tag === "Success") {
          expect(late.value.result).not.toMatchObject({ _tag: "accepted" });
          expect(late.value.error).toBeDefined();
        }

        expect(old.closes.length).toBeGreaterThan(0);
        const fresh = yield* RevokeTest.connect(instance.url, oldKey, "fresh-old-key");
        expect(fresh.first.error).toMatchObject({ data: { reason: "not_granted" } });
        const live = yield* other.call("process.send", input("other-after", "other-still-works"));
        expect(live.error).toBeUndefined();
        expect(live.result).toMatchObject({ _tag: "accepted" });
        const inbox = yield* RevokeTest.until(rows(`${TARGET}/inbox`), (entries) =>
          entries.some((entry) => entry.id === "other-after"),
        );
        const sends = inbox.filter((row) => row._tag === "send");
        const clientKeys = new Set([oldKey.fingerprint, otherKey.fingerprint]);
        expect(sends.filter((row) => clientKeys.has(row.by)).map((row) => ({ id: row.id, by: row.by }))).toEqual([
          { id: "old-before", by: oldKey.fingerprint },
          { id: "other-after", by: otherKey.fingerprint },
        ]);

        // The checklist runner stamps its own timer letters with the program owner's key.
        for (const row of sends.filter((entry) => !clientKeys.has(entry.by))) {
          const { m } = Schema.decodeUnknownSync(
            Schema.Struct({
              m: Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int, arrivedAt: Schema.Int }),
            }),
          )(row.body);
          // The timer follows the inbox position whose model asked for this wake.
          expect(row.id).toBe(`${pid}/due/${m.at}/${row.pos - 1}`);
          expect(row).toMatchObject({ by: root.fingerprint, for: RevokeTest.PERSON, parent: null });
          expect(row.body).toEqual({ m });
        }

        const surviving = inbox.find((row) => row.id === "other-after");
        expect(surviving?.rev).toBeGreaterThan(revoked.rev);
        expect(surviving?.arrivedAt).toBeGreaterThanOrEqual(revoked.arrivedAt);
        const gateway = yield* rows("gateway/inputs");
        const process = yield* rows(pid);
        const after = [...gateway, ...inbox, ...process].filter((row) => row.rev > revoked.rev);
        expect(after.filter((row) => row.by === oldKey.fingerprint)).toEqual([]);
        const oldInputs = new Set(gateway.filter((row) => row.by === oldKey.fingerprint).map((row) => row.id));
        expect(after.filter((row) => row.parent !== null && oldInputs.has(row.parent))).toEqual([]);
        expect(inbox.find((row) => row.id === "old-before")?.rev).toBeLessThan(revoked.rev);
        const viewed = yield* other.call("view.open", { pid });
        expect(viewed.error).toBeUndefined();
        expect(viewed.result).toMatchObject({
          view: {
            items: expect.arrayContaining([{ name: "other-still-works", state: expect.any(String), note: null }]),
          },
        });
        // Reopening the host runner must not submit a second signed revoke.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
            yield* runner.open("reopen");
            yield* runner.due(Number.MAX_SAFE_INTEGER);
            expect(Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model)).toEqual(final);
          }),
        );
        expect((yield* rows("gateway/access")).filter((row) => row._tag === "revoked")).toHaveLength(1);
        // Compact reproducible facts only. Signing keys, proofs and item text never enter this record.
        yield* Effect.logInfo("p17b-revoke", {
          seed: SEED,
          build: fixture.built,
          most,
          expected: ["old-before", "other-after"],
          revoke: revoked.rev,
          verdict: "passed",
        });
      }),
    ),
  { timeout: 120_000 },
);
