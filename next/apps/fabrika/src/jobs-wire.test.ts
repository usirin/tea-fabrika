// A14, next/. Host-only under 0045: real sockets, workerd and persistent object storage are the subject.
// This scenario executes no child command. The isolated local instance uses generated keys only.
// edge: Node crypto creates test identities; these keys never touch a file or an account.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it, expect } from "@effect/vitest";
import { grantText, revokeText } from "@kampus/libfabrika/access/Text";
import { build } from "@kampus/libfabrika/build";
import { Job, Result } from "@kampus/libfabrika/jobs/Job";
import { Effect, FileSystem, Path, Queue, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import type { Project as SeededProject } from "./jobs-wire.test-support.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { programs } from "./table.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const SENT = "2026-11-12T10:00:00.000Z";

const field = (v: string | Uint8Array) => {
  const b = Buffer.from(v);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x;

  if (raw === undefined) {
    throw new Error("test public key has no x coordinate");
  }

  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    sign: (value: string) => {
      const body = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(value).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packed = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, body, pair.privateKey))])),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packed
        .toString("base64")
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const Frame = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Json),
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.Json),
});
type Frame = typeof Frame.Type;
class Closed extends Schema.TaggedError<Closed>()("Closed", { code: Schema.Int }) {}

const socket = Effect.fnUntraced(function* (
  url: string,
  key: ReturnType<typeof identity>,
  tab: string,
  authorized = true,
) {
  const inbox = yield* Queue.unbounded<Frame | Closed>();
  const frames: Array<Frame> = [];
  let closed: Closed | undefined;
  const ws = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const ws = new WebSocket(`${url.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`);
      ws.addEventListener("message", (event) => {
        const f = Schema.decodeUnknownSync(Schema.fromJsonString(Frame))(String(event.data));
        frames.push(f);
        Queue.offerUnsafe(inbox, f);
      });
      ws.addEventListener("close", (event) => {
        closed = new Closed({ code: event.code });
        Queue.offerUnsafe(inbox, closed);
      });
      return ws;
    }),
    (ws) => Effect.sync(() => ws.close()),
  );
  let next = 0;
  const call = Effect.fnUntraced(function* (method: string, params: unknown) {
    if (closed !== undefined) {
      return yield* closed;
    }

    const id = ++next;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    while (true) {
      const frame = yield* Queue.take(inbox).pipe(Effect.timeout("20 seconds"));

      if (frame instanceof Closed) {
        return yield* frame;
      }

      if (frame.id === id) {
        return frame;
      }
    }
  });
  let challenge: Frame;

  do {
    const frame = yield* Queue.take(inbox).pipe(Effect.timeout("20 seconds"));

    if (frame instanceof Closed) {
      return yield* frame;
    }

    challenge = frame;
  } while (challenge.method !== "challenge");

  const { nonce } = Schema.decodeUnknownSync(Schema.Struct({ nonce: Schema.String }))(challenge.params);
  const answer = yield* call("initialize", {
    versions: [1],
    has: ["git"],
    build: `client-${tab}`,
    ping: "30s",
    key: key.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: key.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
  });

  expect(answer.error === undefined).toBe(authorized);

  return { call, frames, close: () => ws.close() };
});

const ok = (frame: Frame) => {
  expect(frame.error).toBeUndefined();
  return frame.result;
};

const no = (frame: Frame) => {
  expect(frame.error).toBeDefined();
};

it.live(
  "scenario: A14 real Project takes, reconnects, starts, finishes and reads its startup request",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "jobs-wire-" });
      const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
      const root = identity(),
        hands = identity(),
        other = identity();
      const selected: typeof SeededProject.selected = hands.fingerprint;
      const app = path.resolve(import.meta.dirname, "..");
      const entry = path.join(home, "jobs-entry.ts");
      yield* fs.symlink(path.join(app, "node_modules"), path.join(home, "node_modules"));
      // Only a generated public fingerprint enters the bundle; no key material or extra wire method.
      yield* fs.writeFileString(
        entry,
        [
          `export { default, Connection, Process, RecordPart, Control } from ${JSON.stringify(path.join(app, "src/brain.ts"))};`,
          `import { Project as SeededProject } from ${JSON.stringify(path.join(app, "src/jobs-wire.test-support.ts"))};`,
          `export class Project extends SeededProject { static selected = ${JSON.stringify(selected)}; }`,
        ].join("\n"),
      );
      const built = yield* build({
        out: path.join(home, "dist"),
        root: path.resolve(app, "../../.."),
        entry,
        programs,
        chaos: false,
        files: [],
      });
      const oldHome = process.env.ALCHEMY_HOME;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (oldHome === undefined) {
            delete process.env.ALCHEMY_HOME;
          } else {
            process.env.ALCHEMY_HOME = oldHome;
          }
        }),
      );
      const running = yield* localInstance(
        built,
        // The settings fixture names the same gateway budget, 100,000 a minute.
        RecordWireTest.startupFixture({
          home,
          name: "jobs-wire",
          person: PERSON,
          founder: root.line,
          window: root.raw,
          port: port.port,
        }),
      );
      const url = `http://127.0.0.1:${port.port}`;
      expect(running).toBeDefined();
      const grant = Effect.fnUntraced(function* (key: ReturnType<typeof identity>, id: string) {
        const value = grantText({
          id,
          key: key.raw,
          for: PERSON,
          to: "jobs-wire",
          as: "hands",
          sentAt: SENT,
          saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: ["git"] },
        });
        const reply = yield* Effect.tryPromise({
          try: () =>
            fetch(`${url}/grant`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: value, armored: root.sign(value) }),
            }),
          catch: (cause: unknown) => new Error("grant failed", { cause }),
        });
        expect(reply.ok).toBe(true);
      });
      yield* grant(hands, "hands");
      yield* grant(other, "other");
      const first = yield* socket(url, hands, "first");
      expect(first.frames.filter((f) => f.method?.startsWith("jobs."))).toEqual([]);
      const taken = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.Literal("assigned"), job: Job }))(
        ok(yield* first.call("jobs.take", { process: PROCESS, sentAt: SENT, seen: 0 })),
      );
      expect(taken.job.state._tag).toBe("assigned");

      if (taken.job.state._tag !== "assigned") {
        return yield* Effect.die("take did not assign");
      }

      const execution = taken.job.state.assignment.execution;
      expect(taken.job.state.request).toMatchObject({ id: "wire-job", target: hands.fingerprint, process: PROCESS });
      first.close();
      const resumed = yield* socket(url, hands, "resumed");
      expect(ok(yield* resumed.call("jobs.take", { process: PROCESS, sentAt: "retry", seen: 0 }))).toEqual(taken);
      const stranger = yield* socket(url, other, "stranger");
      const resource = { process: PROCESS, job: "wire-job" };
      no(yield* stranger.call("jobs.read", resource));
      no(yield* stranger.call("jobs.started", { ...resource, execution, sentAt: SENT, seen: 0 }));
      expect(ok(yield* stranger.call("jobs.take", { process: PROCESS, sentAt: SENT, seen: 0 }))).toEqual({
        _tag: "idle",
      });
      const started = ok(yield* resumed.call("jobs.started", { ...resource, execution, sentAt: SENT, seen: 0 }));
      expect(ok(yield* resumed.call("jobs.started", { ...resource, execution, sentAt: "retry", seen: 0 }))).toEqual(
        started,
      );
      const result = Result.cases.exited.make({ code: 0, version: "fixture-result" });
      no(yield* stranger.call("jobs.finish", { ...resource, execution, result, sentAt: SENT, seen: 0 }));
      const finished = ok(
        yield* resumed.call("jobs.finish", { ...resource, execution, result, sentAt: SENT, seen: 0 }),
      );
      expect(
        ok(yield* resumed.call("jobs.finish", { ...resource, execution, result, sentAt: "retry", seen: 0 })),
      ).toEqual(finished);
      const read = Schema.decodeUnknownSync(Job)(ok(yield* resumed.call("jobs.read", resource)));
      expect(read.state).toMatchObject({ _tag: "finished", result, assignment: taken.job.state.assignment });
      expect(read.events.map((e) => e.event)).toEqual(["requested", "taken", "started", "finished"]);
      expect(ok(yield* resumed.call("jobs.take", { process: PROCESS, sentAt: SENT, seen: 0 }))).toEqual({
        _tag: "idle",
      });
      const revoke = revokeText({
        id: "revoke-hands",
        key: hands.raw,
        for: PERSON,
        to: "jobs-wire",
        sentAt: SENT,
        saw: { label: "test", location: "test", method: "command", check: "touch" },
      });
      yield* Effect.tryPromise({
        try: () =>
          fetch(`${url}/grant`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: revoke, armored: root.sign(revoke) }),
          }),
        catch: (cause: unknown) => new Error("revoke failed", { cause }),
      });

      for (const [method, params] of [
        ["jobs.finish", { ...resource, execution, result, sentAt: "revoked", seen: 0 }],
        ["jobs.read", resource],
      ] as const) {
        const answer = yield* resumed.call(method, params).pipe(Effect.result);

        if (answer._tag === "Success") {
          no(answer.success);
        } else {
          expect(answer.failure).toBeInstanceOf(Closed);
          expect(answer.failure).toMatchObject({ code: 4003 });
        }
      }

      yield* socket(url, hands, "revoked", false);
    }).pipe(Effect.scoped, Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(NodeServices.layer)),
  180_000,
);
