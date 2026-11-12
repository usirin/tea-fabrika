// next/, P17b. Raw RFC 6455 client: deliberately ignore Close, then try one more old-key frame.
// Effect's WebSocket adapter answers Close automatically, so this test needs the TCP byte edge.
// edge: Effect's WebSocket adapter cannot ignore a peer's Close frame.
import { createConnection } from "node:net";
import { NodeServices } from "@effect/platform-node";
import { build } from "@kampus/libfabrika/build";
import { Start } from "@kampus/libfabrika/processes/Process";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Clock, Effect, FileSystem, Path, Queue, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { localInstance } from "../src/local-instance.ts";
import { heldPort } from "../src/port.test-support.ts";
import { programs } from "../src/table.ts";

export const PERSON = "person_0000000000e008000000000001";
export const PROJECT = "p17b-revoke";
export const SENT = "2026-11-12T00:00:00.000Z";
export class WireFailure extends Schema.TaggedError<WireFailure>()("WireFailure", { cause: Schema.Defect() }) {}

const field = (raw: string | Uint8Array) => {
  const bytes = Buffer.from(raw);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return Buffer.concat([size, bytes]);
};

/** Nonextractable private material exists only in this scope, never in a file or report. */
export const identity = Effect.fn("RevokeTest.identity")(function* () {
  const pair = yield* Effect.acquireRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto returns its new key pair through a Promise
    Effect.tryPromise({
      try: () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
      catch: (cause) => new WireFailure({ cause }),
    }),
    () => Effect.void,
  );
  const bytes = new Uint8Array(
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports only the public key through a Promise
    yield* Effect.tryPromise({
      try: () => crypto.subtle.exportKey("raw", pair.publicKey),
      catch: (cause) => new WireFailure({ cause }),
    }),
  );
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto returns the public fingerprint digest through a Promise
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
          // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs with the scoped nonextractable key
          Effect.tryPromise({
            try: () => crypto.subtle.sign("Ed25519", pair.privateKey, bytes),
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
export const encode = (value: unknown) => {
  const payload = Buffer.from(JSON.stringify(value));

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
export const connect = Effect.fn("RevokeTest.connect")(function* (
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
  const call = Effect.fnUntraced(function* (method: string, params: unknown) {
    const id = crypto.randomUUID();
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
    // The frame was made before revoke, but goes onto the old TCP connection afterward.
    delayed: (method: string, params: unknown) => {
      const bytes = encode({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params });
      return Effect.sync(() => {
        socket.write(bytes, () => undefined);
      });
    },
  };
});

export const invoke = Effect.fn("RevokeTest.control")(function* (
  binding: object,
  method: string,
  args: ReadonlyArray<unknown>,
) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: Alchemy's private control binding has the platform's Promise API
  return yield* Effect.tryPromise({
    try: () => Reflect.apply(Reflect.get(binding, method), binding, args),
    catch: (cause) => new WireFailure({ cause }),
  });
});

export const served = Effect.gen(function* () {
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
    entry: path.join(app, "src/brain.ts"),
    out: path.join(home, "dist"),
    programs: [...programs, { name: "fabrika/checklist", package: "@kampus/checklist", export: "checklist" }],
    files: [],
    ledger: [],
    chaos: false,
  });
  // oxlint-disable-next-line fabrika/no-promises -- edge: load Alchemy after its telemetry has been disabled
  const { localState } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: Alchemy is loaded only after disabling its telemetry
    try: () => import("alchemy/State/LocalState"),
    catch: (cause) => new WireFailure({ cause }),
  });
  const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const instance = yield* localInstance(built, {
    home,
    name: PROJECT,
    person: PERSON,
    founder: root.line,
    window: old.raw,
    port,
  }).pipe(Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(localState()));
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
      name: "checklist:1",
      code: { program: "fabrika/checklist", hash: source.hash },
    }),
    from,
  ]);
  const { process: pid } = yield* Schema.decodeUnknownEffect(Schema.Struct({ process: Schema.String }))(started);
  const read = (stream: string) => invoke(instance.project(PROJECT), "read", [stream, 0, "p17b-audit"]);
  return { root, old, other, instance, pid, read, built: built.build };
}).pipe(Effect.provide(NodeServices.layer));

export const until = Effect.fn("RevokeTest.until")(function* <A, E, R>(
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
