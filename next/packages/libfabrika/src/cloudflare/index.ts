/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
import { Effect, Option, Schema } from "effect";
import { Declaration, workerExecution, type ExecutionCalls, type ProgramSource } from "../runtime/Execution.ts";
import { ProgramDown } from "../runtime/Program.ts";
import type { bind } from "./tail.ts";
export type { ProgramSource } from "../runtime/Execution.ts";
export { cloudflareSql } from "./CloudflareSql.ts";
export { fetch, serveAsset } from "./fetch.ts";
export { callback as isolateTail } from "./tail.ts";

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

export const workerLoader = (loader: Loader, programs: Readonly<Record<string, ProgramSource>>) => ({
  load: Effect.fn("loader.load")(function* (
    name: string,
    process: string,
    tail?: Effect.Success<ReturnType<typeof bind>>,
  ) {
    const code = Object.hasOwn(programs, name) ? programs[name] : undefined;

    if (code === undefined) {
      return yield* new ProgramDown({ reason: "no_program" });
    }

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
