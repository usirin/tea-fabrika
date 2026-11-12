// P42 slice 1 (ticket 770), next/: the one helper L9 and L10 share. It builds two test programs into a
// real local instance in a scope, as ticket 402's supervision test does: `starter` asks the host to
// start a child with the built-in `start_child`, and `child` counts `inc` and throws on `throw`. The
// instance takes its start grants from its caller (`starts`), as the app's own wiring hands in its
// empty list. Real workerd, sockets, object storage and alarms; no raw platform object stands in.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Effect, FileSystem, Path } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";

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
  'export const program = {name: "starter", machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {start: {_tag: "write", schema: Msg, description: "Start a child", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};',
].join("\n");

/** Counts `inc` and throws on `throw`: the supervision the boot's child has must restart it. */
const childSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model = Schema.Struct({count: Schema.Int});",
  'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("inc")})]);',
  'const machine = Machine.make({model: Model, msg: Msg, cmds: [], init: (loaded) => [loaded ?? {count: 0}, []], update: {throw: () => {throw new TypeError("child failure P42");}, inc: (s) => [{count: s.count + 1}, []]}});',
  'export const program = {name: "child", maxDeliveries: 2, machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {throw: {_tag: "write", schema: Msg, description: "Fail", personOnly: false}, inc: {_tag: "write", schema: Msg, description: "Count", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};',
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
      programs: { starter: path.join(home, "starter.ts"), child: path.join(home, "child.ts") },
    });
    const hashes = { starter: built.programs["starter"]?.hash ?? "", child: built.programs["child"]?.hash ?? "" };
    // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
    const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    const key = identity();
    const instance = yield* localInstance(built, {
      home,
      name: PROJECT,
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: port.port,
      starts,
    } as Parameters<typeof localInstance>[1]);
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
