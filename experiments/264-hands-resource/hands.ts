// Experiment 264: can one Alchemy stack provision hands through custom resources of our own?
//
// Two made-up resources in one tiny stack, with Alchemy's local state in a temp folder:
// - `HandsGrant` (made up) writes a stand-in grant record, a JSON file that stands in for the ledger.
// - `HandsProcess` (made up) starts a trivial long-running child that writes a heartbeat file.
//
// Run from the repo root, one step per call, against the same home:
//   HANDS_HOME=<temp folder> node experiments/264-hands-resource/hands.ts deploy|destroy|detect|repair
// Env: HANDS_LABEL changes a prop, HANDS_KEY changes the grant's key, HANDS_DIFF_PID=1 makes diff check the pid.
// No account, no network, no key. Nothing here touches a real ledger.
import { NodeServices } from "@effect/platform-node";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import { destroy } from "alchemy/Destroy";
import * as Interaction from "alchemy/Interaction";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Effect, FileSystem, Layer } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { ChildProcess } from "effect/process";

const home = process.env.HANDS_HOME;

if (!home) {
  throw new Error("set HANDS_HOME to a temp folder");
}

process.env.DO_NOT_TRACK = "1";
process.env.ALCHEMY_HOME = `${home}/alchemy-home`;

// ---- HandsGrant (made up for this sketch) ----
// The record's shape follows 0102: { key, for, to, as: "hands" }.
type GrantProps = { readonly ledger: string; readonly key: string; readonly for: string; readonly to: string };
type GrantAttrs = { readonly path: string; readonly writtenAt: string };
type HandsGrant = Alchemy.Resource<"Fabrika.HandsGrant", GrantProps, GrantAttrs>;
const HandsGrant = Resource<HandsGrant>("Fabrika.HandsGrant");

// Run 1 keyed the record by fqn alone, so a replacement's delete removed the new record (see the
// write-up). HANDS_PATH_BY=instance keys it by Alchemy's instance id, one per generation.
const byInstance = process.env.HANDS_PATH_BY === "instance";

const grantPath = (ledger: string, fqn: string, instanceId: string) =>
  `${ledger}/grants/${fqn.replaceAll("/", "_")}${byInstance ? `-${instanceId}` : ""}.json`;

const HandsGrantProvider = Provider.effect(
  HandsGrant,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
        const path = output?.path ?? grantPath(olds.ledger, fqn, instanceId);
        const there = yield* fs.exists(path);
        yield* Effect.log(`grant.read ${fqn}: ${there ? "found" : "missing"}`);
        return there ? { path, writtenAt: output?.writtenAt ?? "unknown" } : undefined;
      }),
      // A new key is a new grant, so it replaces; anything else falls through to Alchemy's own prop diff.
      diff: ({ olds, news }) =>
        Effect.succeed(Alchemy.isResolved(news) && olds.key !== news.key ? { action: "replace" as const } : undefined),
      reconcile: Effect.fn(function* ({ fqn, instanceId, news, olds, output }) {
        const path = grantPath(news.ledger, fqn, instanceId);
        yield* Effect.log(`grant.reconcile ${fqn}: ${output ? "update" : "create"} (olds ${olds ? "set" : "none"})`);
        yield* fs.makeDirectory(`${news.ledger}/grants`, { recursive: true });
        const writtenAt = new Date().toISOString();
        const record = { key: news.key, for: news.for, to: news.to, as: "hands", writtenAt };
        yield* fs.writeFileString(path, `${JSON.stringify(record, null, 2)}\n`);
        return { path, writtenAt };
      }),
      delete: Effect.fn(function* ({ fqn, output }) {
        yield* Effect.log(`grant.delete ${fqn}: ${output.path}`);
        yield* fs.remove(output.path, { force: true });
      }),
    };
  }),
);

// ---- HandsProcess (made up for this sketch) ----
type ProcessProps = { readonly home: string; readonly label: string; readonly every: number };
type ProcessAttrs = { readonly pid: number; readonly heartbeat: string };
type HandsProcess = Alchemy.Resource<"Fabrika.HandsProcess", ProcessProps, ProcessAttrs>;
const HandsProcess = Resource<HandsProcess>("Fabrika.HandsProcess");

// The child: a node one-liner that writes a heartbeat file and sleeps. It stands in for a hands
// process that would dial the brain and call jobs.take.
const childCode = (heartbeat: string, label: string, every: number) =>
  `const fs=require("fs");const w=()=>fs.writeFileSync(${JSON.stringify(heartbeat)},` +
  `JSON.stringify({pid:process.pid,label:${JSON.stringify(label)},at:new Date().toISOString()}));` +
  `w();setInterval(w,${every});`;

// `kill -0 <pid>` answers whether the process is alive, through Effect's ChildProcess.
const alive = (pid: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("kill", ["-0", String(pid)], { stdout: "ignore", stderr: "ignore" });
      return (yield* child.exitCode) === 0;
    }),
  );

const stop = (pid: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("kill", ["-TERM", String(pid)], { stdout: "ignore", stderr: "ignore" });
      return yield* child.exitCode;
    }),
  );

const HandsProcessProvider = Provider.effect(
  HandsProcess,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const diffChecksPid = process.env.HANDS_DIFF_PID === "1";
    return {
      read: Effect.fn(function* ({ fqn, output }) {
        if (!output) {
          return undefined;
        }

        const up = yield* alive(output.pid);
        yield* Effect.log(`process.read ${fqn}: pid ${output.pid} ${up ? "alive" : "gone"}`);
        return up ? output : undefined;
      }),
      diff: Effect.fn(function* ({ fqn, olds, news, output }) {
        if (!Alchemy.isResolved(news)) {
          return undefined;
        }

        if (olds.label !== news.label || olds.every !== news.every || olds.home !== news.home) {
          return { action: "update" as const };
        }

        if (diffChecksPid && output) {
          const up = yield* alive(output.pid);
          yield* Effect.log(`process.diff ${fqn}: pid ${output.pid} ${up ? "alive" : "gone"}`);
          return { action: up ? ("noop" as const) : ("update" as const) };
        }

        return { action: "noop" as const };
      }),
      reconcile: Effect.fn(function* ({ fqn, news, output }) {
        if (output && (yield* alive(output.pid))) {
          yield* Effect.log(`process.reconcile ${fqn}: stopping pid ${output.pid} to restart it`);
          yield* stop(output.pid);
        }

        const heartbeat = `${news.home}/heartbeat.json`;
        yield* fs.makeDirectory(news.home, { recursive: true });
        // Spawned detached (Effect's default off Windows) with no pipes, then unref'd: Effect's
        // spawner skips the kill when the scope closes on an unref'd child, so it outlives this deploy.
        const pid = yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* ChildProcess.make("node", ["-e", childCode(heartbeat, news.label, news.every)], {
              detached: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            });

            if (process.env.HANDS_NO_UNREF !== "1") {
              yield* child.unref;
            }

            return child.pid;
          }),
        );
        yield* Effect.log(`process.reconcile ${fqn}: started pid ${pid} (${output ? "update" : "create"})`);
        return { pid, heartbeat };
      }),
      delete: Effect.fn(function* ({ fqn, output }) {
        const up = yield* alive(output.pid);

        if (up) {
          yield* stop(output.pid);
        }

        yield* Effect.log(`process.delete ${fqn}: pid ${output.pid} ${up ? "stopped" : "was already gone"}`);
      }),
    };
  }),
);

// ---- The stack ----
const stack = Alchemy.Stack(
  "hands-exp",
  {
    providers: Layer.mergeAll(HandsGrantProvider, HandsProcessProvider),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const grant = yield* HandsGrant("LaptopGrant", {
      ledger: `${home}/ledger`,
      key: process.env.HANDS_KEY ?? "stand-in-public-key-1",
      for: "stand-in-person",
      to: "stand-in-ledger",
    });
    const hands = yield* HandsProcess("LaptopHands", {
      home: `${home}/hands`,
      label: process.env.HANDS_LABEL ?? "v1",
      every: 500,
    });
    return { grant: grant.path, pid: hands.pid };
  }),
);

const engine = Layer.mergeAll(
  Layer.succeed(AlchemyContext, { dotAlchemy: `${home}/.alchemy`, dev: false, adopt: false }),
  Layer.succeed(ArtifactStore, createArtifactStore()),
  Interaction.layerNonInteractive(),
  AuthProvidersLive,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, SecureRandom.layerWebCrypto, Digest.layerWebCrypto),
  ),
);

const stage = "local";
const step = process.argv[2];

const program =
  step === "deploy"
    ? deploy({ stack, stage })
    : step === "destroy"
      ? destroy({ stack, stage })
      : step === "detect"
        ? Alchemy.Drift.detect({ name: "hands-exp", stage })
        : step === "repair"
          ? Alchemy.Drift.repair({ name: "hands-exp", stage })
          : Effect.die(new Error(`unknown step ${step}`));

const started = Date.now();

const run = Effect.runPromise(
  program.pipe(
    Effect.tap((out) => Effect.log(`${step} result: ${JSON.stringify(out)}`)),
    Effect.provide(Layer.mergeAll(stack.providers, Alchemy.localState()).pipe(Layer.provideMerge(engine))),
    Effect.provide(engine),
    Effect.ensuring(Effect.sync(() => console.log(`${step} took ${Date.now() - started} ms`))),
  ) as Effect.Effect<unknown>,
);

// HANDS_NATURAL_EXIT=1 lets node exit on its own, to show an unref'd child does not hold it open.
run.then(
  () => (process.env.HANDS_NATURAL_EXIT === "1" ? undefined : process.exit(0)),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
