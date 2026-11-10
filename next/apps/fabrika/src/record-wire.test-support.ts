// T502 PR 2, next/. Records through the normal local stage control socket.
import { generateKeyPairSync } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { SinkError } from "@kampus/libfabrika/data";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "./build.ts";
import { localStage } from "./local-stage.ts";
import { heldPort } from "./port.test-support.ts";

const Failure = Schema.Struct({ reason: Schema.String });

export const recordCall = (invoke: () => Promise<unknown>): Effect.Effect<unknown, SinkError> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: the local stage record proxy exposes Promise-returning stub calls
  Effect.tryPromise({ try: invoke, catch: (cause: unknown) => Schema.decodeUnknownSync(Failure)(cause) }).pipe(
    // Mapping every reach failure to unreachable still fails the bad_row law.
    Effect.catch((error) =>
      error.reason === "unreachable" || error.reason === "bad_row" || error.reason === "storage"
        ? Effect.fail(new SinkError({ reason: error.reason, held: 0 }))
        : Effect.die(error),
    ),
  );

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
    return yield* localStage(built, {
      home,
      name: "record-law",
      person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
      founder: `ssh-ed25519 ${blob.toString("base64")}`,
      window: raw,
      port: port.port,
      limits: { recordBytes: cap },
    });
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);
