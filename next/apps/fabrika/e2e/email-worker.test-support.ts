// next/. Alchemy owns the local runtime, as in src/instance.ts.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { testKey } from "@kampus/libfabrika/email/Email.test-support";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { Effect, FileSystem, Layer, Path } from "effect";
import { build } from "../src/build.ts";
import { heldPort } from "../src/port.test-support.ts";
import { Settings } from "../src/settings.ts";

// P24/P26's email injection and observation contracts are carried from P36's exam.
// Reconcile them with the real Project at build; never answer these paths with fake membership.
export type EmailFixture = { readonly seed: ReadonlyArray<number>; readonly code: number };

const wrapper = (brain: string, fixture: EmailFixture, publicKey: string) => `
import base, {Project as BaseProject} from ${JSON.stringify(brain)};
export {Process, Connection, RecordPart, Control} from ${JSON.stringify(brain)};
import {Effect, Redacted} from "effect";
import {writeSshsig} from "@kampus/libfabrika/transport/Sshsig";
let now = 1800000000000;
const mails = [];
let sendFailure = null;
const raw = Uint8Array.from(${JSON.stringify(fixture.seed)});
const emailKey = {
  public: ${JSON.stringify(publicKey)}, private: Redacted.make(raw),
  sign: (text) => writeSshsig({text, space: "fabrika-client", line: ${JSON.stringify(publicKey)},
    sign: (bytes) => Effect.gen(function* () {
      const pkcs8 = new Uint8Array([48,46,2,1,0,48,5,6,3,43,101,112,4,34,4,32,...raw]);
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto imports the made-up test key through a Promise
      const key = yield* Effect.tryPromise(() => crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]));
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs with the made-up test key through a Promise
      return new Uint8Array(yield* Effect.tryPromise(() => crypto.subtle.sign("Ed25519", key, new Uint8Array(bytes))));
    })})
};
export class Project extends BaseProject {
  constructor(ctx, env) {
    super(ctx, {...env, emailClock: Effect.sync(() => now),
      emailKey,
      emailEntropy: {bytes: () => Effect.sync(() => {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, ${fixture.code});
        return bytes;
      })},
      emailSender: {send: (mail) => Effect.suspend(() => {
        if (sendFailure !== null) {
          const message = sendFailure;
          sendFailure = null;
          return Effect.fail({reason: "send", message});
        }
        return Effect.sync(() => {
        // oxlint-disable-next-line fabrika/no-redacted-value -- edge: the stand-in sender captures only made-up mail
        mails.push({to: Redacted.value(mail.to), raw: Redacted.value(mail.code)});
      });})}, personCheck: Effect.succeed("touch")});
  }
}
// oxlint-disable-next-line import/no-default-export -- edge: Alchemy loads this generated Worker entry
export default {fetch(request, env, ctx) {
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the generated Worker's fetch callback returns a Promise
  return Effect.runPromise(Effect.gen(function* () {
  const url = new URL(request.url);
  if (url.pathname === "/__test/clock") {
    // oxlint-disable-next-line fabrika/no-promises -- edge: HTTP request JSON is a Promise API
    now = (yield* Effect.tryPromise(() => request.json())).at;
    return Response.json({ok:true});
  }
  if (url.pathname === "/__test/mail") return Response.json(mails);
  if (url.pathname === "/__test/fail-send") {
    // oxlint-disable-next-line fabrika/no-promises -- edge: HTTP request JSON is a Promise API
    sendFailure = (yield* Effect.tryPromise(() => request.json())).message;
    return Response.json({ok:true});
  }
  const project = env.PROJECT.getByName("p36-test");
  if (url.pathname === "/__test/snapshot") {
    // oxlint-disable-next-line fabrika/no-promises -- edge: the carried P24/P26 observation contract returns a Promise
    return Response.json(yield* Effect.tryPromise(() => project.emailTestSnapshot()));
  }
  if (url.pathname === "/__test/device") {
    // oxlint-disable-next-line fabrika/no-promises -- edge: HTTP request JSON is a Promise API
    const input = yield* Effect.tryPromise(() => request.json());
    // oxlint-disable-next-line fabrika/no-promises -- edge: the carried P24/P26 device fixture contract returns a Promise
    return Response.json(yield* Effect.tryPromise(() => project.emailTestDevice(input)));
  }
  // oxlint-disable-next-line fabrika/no-promises -- edge: the app's current Worker entry returns a fetch Promise
  return yield* Effect.tryPromise(() => base.fetch(request, env, ctx));
  }));
}};
`;

// Only test-scoped, nonsecret variables are changed. The scope restores them on every exit.
const environment = (key: "DO_NOT_TRACK" | "ALCHEMY_HOME", value: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env[key];
      process.env[key] = value;
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous;
        }
      }),
  );

export const startWorker = Effect.fn("emailExam.startWorker")(function* (
  home: string,
  fixture: EmailFixture = { seed: Array.from({ length: 32 }, (_, n) => n + 32), code: 7 },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Missing P36 code is checked before opening a socket in the box.
  const email = path.resolve(import.meta.dirname, "../../../packages/libfabrika/src/email/EmailRecovery.ts");
  yield* fs.access(email);
  yield* environment("DO_NOT_TRACK", "1");
  yield* environment("ALCHEMY_HOME", path.join(home, "alchemy-home"));
  const port = yield* Effect.acquireRelease(heldPort(), (port) => port.release);
  const built = yield* build({ out: path.join(home, "build") });
  const main = path.join(home, "email-worker.mjs");
  const emailKey = yield* testKey(fixture.seed);
  yield* fs.writeFileString(main, wrapper(built.brain, fixture, emailKey.line));
  const founder = yield* testKey(Array.from({ length: 32 }, (_, n) => n));
  const settings = Settings.make({
    name: "p36-test",
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    founder: founder.line,
    window: null,
    port: port.port,
    build: built.build,
    rateLimit: { limit: 100_000, window: 60_000 },
  });
  const stack = Alchemy.Stack(
    "p36-exam",
    { providers: Cloudflare.providers(), state: Alchemy.localState() },
    Effect.gen(function* () {
      const measurements = yield* Cloudflare.R2.Bucket("Measurements", {
        name: "p36-measurements",
        lifecycleRules: [],
        locks: [],
      });
      const worker = yield* Cloudflare.Workers.Worker("EmailExam", {
        name: "p36-test",
        main,
        bundle: true,
        compatibility: { date: "2026-10-12" },
        observability: { enabled: false },
        dev: { host: "127.0.0.1", port: port.port, strictPort: true },
        env: {
          PROJECT: Cloudflare.DurableObject("Project"),
          PROCESS: Cloudflare.DurableObject("Process"),
          CONNECTION: Cloudflare.DurableObject("Connection"),
          RECORD: Cloudflare.DurableObject("RecordPart"),
          RecordPart: Cloudflare.DurableObject("RecordPart"),
          LOADER: Cloudflare.WorkerLoader(),
          MEASUREMENTS: measurements,
          INSTANCE: JSON.stringify(settings),
        },
      });
      return { url: worker.url };
    }),
  );
  // oxlint-disable-next-line fabrika/no-stage-word -- Alchemy's own key picks its deployment state
  yield* deploy({ stack, stage: "local", dev: true, scope: yield* Effect.scope }).pipe(
    Effect.provide(localState()),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(AlchemyContext, { dotAlchemy: path.join(home, ".alchemy"), dev: true, adopt: false }),
        Layer.succeed(ArtifactStore, createArtifactStore()),
        Interaction.layerNonInteractive(),
        AuthProvidersLive,
      ),
    ),
  );
  return `http://127.0.0.1:${port.port}`;
});
