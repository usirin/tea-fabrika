// Experiment 285, next/. What every script here shares: start a stack on the local runtime through
// Alchemy, add one private socket to it, and save a result. Nothing here signals a process: the
// runtime is stopped when the scope that started it closes.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";
import { NodeServices } from "@effect/platform-node";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { Context, Deferred, Effect, FileSystem, Layer, Path, Schedule } from "effect";

export const HOME = process.env.S285_HOME ?? "";
export const ROOT = process.env.S285_ROOT ?? "";
const OUT = process.env.S285_OUT ?? "";

/** One more socket on the local runtime, as Alchemy's plugin contract names it. */
class PrivateSocket extends Plugin.Service<PrivateSocket>()("cloudflare-runtime/plugin/Spike285") {}

export type Socket = {
  readonly name: string;
  /** The named entrypoint class, or none for the Worker's default export. */
  readonly entrypoint?: string;
  readonly props?: Record<string, unknown>;
};

/** Every time a workerd started listening: the ports of its sockets, by socket name. */
export const starts: Array<Record<string, number>> = [];

/** Cloudflare's providers, with `sockets` added to each workerd they start. */
export const providers = (sockets: ReadonlyArray<Socket>, ports: Deferred.Deferred<Record<string, number>>) =>
  Cloudflare.providers().pipe(
    Layer.provide(
      Layer.succeedContext(
        Context.empty().pipe(
          Context.add(PrivateSocket, {
            sockets: sockets.map((socket) => ({
              name: socket.name,
              address: "127.0.0.1:0",
              http: {},
              service: {
                name: "user-worker",
                ...(socket.entrypoint === undefined ? {} : { entrypoint: socket.entrypoint }),
                ...(socket.props === undefined ? {} : { props: { json: JSON.stringify(socket.props) } }),
              },
            })),
            start: (listening) =>
              Effect.sync(() => starts.push({ ...listening })).pipe(
                Effect.andThen(Deferred.succeed(ports, { ...listening })),
                Effect.asVoid,
              ),
          }),
        ),
      ),
    ),
  );

/** Deploys `stack` to the local runtime. The scope stops it. */
export const start = <A>(stack: Parameters<typeof deploy>[0]["stack"] & { readonly _A?: A }, place = "local") =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* deploy({ stack, stage: place, dev: true, scope: yield* Effect.scope }).pipe(
      Effect.provide(localState()),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(AlchemyContext, { dotAlchemy: path.join(HOME, ".alchemy"), dev: true, adopt: false }),
          Layer.succeed(ArtifactStore, createArtifactStore()),
          Interaction.layerNonInteractive(),
          AuthProvidersLive,
        ),
      ),
    );
  });

/** A GET or POST that waits for the runtime to listen. */
export const call = (url: string, init?: RequestInit) =>
  Effect.tryPromise(() => fetch(url, init)).pipe(
    Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
    Effect.flatMap((reply) =>
      Effect.promise(async () => ({ status: reply.status, text: await reply.text(), headers: reply.headers })),
    ),
  );

export const json = (url: string, init?: RequestInit) =>
  call(url, init).pipe(
    Effect.flatMap((reply) =>
      Effect.try({
        try: () => JSON.parse(reply.text) as unknown,
        catch: () => new Error(`${url} answered ${reply.status}, not JSON: ${reply.text.slice(0, 2000)}`),
      }),
    ),
  );

/** Prints the result and keeps it under `runs/285/`, which git ignores. */
export const save = (name: string, result: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = JSON.stringify(result, null, 2);
    yield* fs.writeFileString(path.join(OUT, `${name}.json`), `${text}\n`);
    yield* Effect.sync(() => console.log(text));
  });

export const median = (values: ReadonlyArray<number>): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Runs a script's Effect to its end, with Node's services and one scope. */
export const run = <A, E>(
  work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | import("effect").Scope.Scope>,
) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(NodeServices.layer)));
