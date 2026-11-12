// T502 PR 2, next/. Records through the normal local instance control socket.
import { createHash, generateKeyPairSync } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { SinkError } from "@kampus/libfabrika/telemetry/Sink";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";

const Failure = Schema.Struct({ reason: Schema.String });

export const settingsFixture = <A extends StartsTest.Fixture>(config: A) => {
  const { port: _port, person: _person, founder: _founder, window: _window, ...rest } = config;
  return {
    ...rest,
    ...StartsTest.fixture(config, (algorithm, data) =>
      createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
    ),
  };
};

// Startup allocates its own identity; direct Worker fixtures still need a complete envelope.
export const startupFixture = <A extends StartsTest.Fixture & { readonly home: string }>(config: A) => {
  const { start: _start, ...input } = settingsFixture(config);
  return { ...input, ...(config.start === undefined ? {} : { start: config.start }) };
};

export const recordCall = Effect.fnUntraced(function* (invoke: () => Promise<unknown>) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the local instance record proxy exposes Promise-returning stub calls
  return yield* Effect.tryPromise({
    try: invoke,
    catch: (cause: unknown) => Schema.decodeUnknownSync(Failure)(cause),
  }).pipe(
    // Mapping every reach failure to unreachable still fails the bad_row law.
    Effect.catch((error) =>
      error.reason === "unreachable" || error.reason === "bad_row" || error.reason === "storage"
        ? Effect.fail(new SinkError({ reason: error.reason, held: 0, cause: error }))
        : Effect.die(error),
    ),
  );
});

export const recordWire = Effect.fnUntraced(
  function* (cap: number) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-r-" });
    const port = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
    const pair = generateKeyPairSync("ed25519");
    const raw = pair.publicKey.export({ format: "jwk" }).x;

    if (raw === undefined) {
      return yield* Effect.die(new Error("generated Ed25519 public key has no x coordinate"));
    }

    const field = (body: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length);
      return Buffer.concat([length, body]);
    };
    const blob = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(Buffer.from(raw, "base64url"))]);
    const built = yield* build({ out: path.join(home, "dist") });
    const old = process.env.ALCHEMY_HOME;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (old === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = old;
        }
      }),
    );
    return yield* localInstance(
      built,
      startupFixture({
        home,
        name: "record-law",
        person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
        founder: `ssh-ed25519 ${blob.toString("base64")}`,
        window: raw,
        port: port.port,
        limits: { recordBytes: cap },
      }),
    );
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);
