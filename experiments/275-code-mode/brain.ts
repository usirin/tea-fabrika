// Experiment 275, lab code. Starts one local instance the way next/apps/fabrika/dev.ts's child does
// (build, then the Alchemy stack in local dev), with this folder's notes program in the bootstrap
// slot and door B's Scripts Worker in the same runtime. The harness runs it in its own process
// group, so a kill ends workerd too.
// Usage: FABRIKA_HOME=<home> node brain.ts <port> <scripts port> <founder public key line>
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { Effect, Path } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "../../next/apps/fabrika/src/build.ts";
import { startDev } from "./instance.ts";

const port = Number(process.argv[2]);
const scriptsPort = Number(process.argv[3]);
const founder = process.argv[4] ?? "";
const home = process.env.FABRIKA_HOME ?? "";
process.env.DO_NOT_TRACK = "1";

const main = Effect.scoped(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    process.env.ALCHEMY_HOME = path.join(home, "alchemy-home");
    const built = yield* build({
      out: path.join(home, "build"),
      programs: { "fabrika/counter": path.resolve(import.meta.dirname, "notes.ts") },
    });
    yield* startDev(built, {
      name: "exp-275",
      person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
      founder,
      window: null,
      port,
      scriptsPort,
      home,
    }).pipe(Effect.provide(ProcessIdGenerator.layer));
    process.stdout.write(`${JSON.stringify({ ready: `http://127.0.0.1:${port}`, build: built.build })}\n`);
    return yield* Effect.never;
  }),
);

NodeRuntime.runMain(main.pipe(Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto])));
