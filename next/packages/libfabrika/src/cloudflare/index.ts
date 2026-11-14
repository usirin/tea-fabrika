/**
 * The Cloudflare entry points libfabrika offers a brain: the Worker Loader that runs a program's
 * code, the request handling and asset serving, the SQL handle over Durable Object storage, and the
 * tail callback.
 *
 * @stability unstable
 */
import { Effect, Option, Schema } from "effect";
import { BuiltProgram } from "../runtime/Built.ts";
import { Declaration, workerExecution, type ExecutionCalls, type ProgramSource } from "../runtime/Execution.ts";
import { ProgramDown } from "../runtime/Program.ts";
import type { bind } from "./tail.ts";
export type {
  /**
   * One program's compiled source and its hash, as the build hands it to the loader.
   *
   * @stability unstable
   * @category models
   */
  ProgramSource,
} from "../runtime/Execution.ts";
export {
  /**
   * Returns the `Sql` handle over a Durable Object's own SQLite storage.
   *
   * @stability unstable
   * @category constructors
   */
  cloudflareSql,
} from "./CloudflareSql.ts";
export {
  /**
   * Handles one brain request, with the embedded window table it serves from.
   *
   * @stability unstable
   * @category combinators
   */
  fetch,
  /**
   * Answers a request from the brain's embedded window files; an unknown route is a 404.
   *
   * @stability unstable
   * @category combinators
   */
  serveAsset,
} from "./fetch.ts";
export {
  /**
   * Reads each tail invocation's props and bindings from Alchemy's live services.
   *
   * @stability unstable
   * @category combinators
   */
  callback as isolateTail,
} from "./tail.ts";

type Calls = Rpc.WorkerEntrypointBranded &
  Required<ExecutionCalls> & {
    readonly describe: () => Promise<unknown>;
  };

// Alchemy's native tail and the old ambient loader types come from separate platform declarations.
type Code = Omit<Parameters<WorkerLoader["load"]>[0], "tails"> & {
  readonly tails?: Array<Effect.Success<ReturnType<typeof bind>>>;
};

type Loader = Omit<WorkerLoader, "get"> & {
  get(
    name: Parameters<WorkerLoader["get"]>[0],
    code: () => Code | ReturnType<Parameters<WorkerLoader["get"]>[1]>,
  ): ReturnType<WorkerLoader["get"]>;
};

/**
 * Returns a loader that runs a program's compiled code in its own Worker Loader isolate.
 *
 * **Details**
 *
 * `load(name, process, tail?, hash?)` picks the built-in program by `name`, or, given a `hash`, the
 * built-in program with that hash and else the one `lookup` finds. The code is decoded with its hash
 * checked, loaded as the isolate `<hash>/<process>`, and asked for its declaration. It answers the
 * isolate's execution, the declaration and the hash. No code fails with `ProgramDown` reason
 * `no_program`; a failed lookup, decode or describe fails with reason `load`.
 *
 * @stability unstable
 * @category constructors
 */
export const workerLoader = (
  loader: Loader,
  programs: Readonly<Record<string, ProgramSource>>,
  lookup?: (hash: string) => Effect.Effect<ProgramSource | null, unknown>,
) => ({
  load: Effect.fn("loader.load")(function* (
    name: string,
    process: string,
    tail?: Effect.Success<ReturnType<typeof bind>>,
    hash?: string,
  ) {
    const built = Object.hasOwn(programs, name) ? programs[name] : undefined;
    const found =
      hash === undefined
        ? built
        : (Object.values(programs).find((p) => p.hash === hash) ??
          (lookup === undefined
            ? null
            : yield* lookup(hash).pipe(Effect.mapError((cause) => new ProgramDown({ reason: "load", cause })))));
    const code =
      found == null
        ? undefined
        : yield* Schema.decodeUnknownEffect(BuiltProgram)(found).pipe(
            Effect.mapError((cause) => new ProgramDown({ reason: "load", cause })),
          );

    if (code === undefined) {
      return yield* new ProgramDown({ reason: "no_program" });
    }

    yield* Effect.annotateCurrentSpan({
      program: name,
      hash: code.hash,
      role: process === "check" ? "candidate" : "process",
    });
    const worker = loader.get(`${code.hash}/${process}`, () => ({
      compatibilityDate: "2026-10-12",
      // Worker Loader reads an ES module only from a ".js" name; ".mjs" fails to load.
      mainModule: "program.js",
      modules: { "program.js": code.source },
      env: {},
      globalOutbound: null,
      ...(tail === undefined ? {} : { tails: [tail] }),
    }));
    const rpc = worker.getEntrypoint<Calls>();
    const fail = (cause: unknown) => new ProgramDown({ reason: "load", error: "ProgramDown", cause });
    // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader describes its checked declaration through RPC
    const work = Effect.tryPromise({ try: () => rpc.describe(), catch: fail });
    const raw = yield* work;
    const declaration = yield* Schema.decodeUnknownEffect(Declaration)(raw).pipe(
      Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
    );
    return {
      execution: workerExecution(rpc),
      declaration,
      hash: code.hash,
      handler: () => Option.none(),
    };
  }),
});
