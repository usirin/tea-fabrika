// next/. Contract: tail(env, {project, name, process}, items) returns an Effect<void>.
// Only the platform is doubled. Decoding, routing and the loader are the product's public calls.
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Tracer } from "effect";
import * as fc from "fast-check";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import { workerLoader } from "./index.ts";
import type { Env } from "./runtime.ts";

type BoundTail = NonNullable<Parameters<ReturnType<typeof workerLoader>["load"]>[2]>;

const PROCESS = "process_0000000000e008000000000001";

const CODE = {
  hash: "120970d812836f19888625587a4606a5ad23cef31c8684e601771552548fc6b9",
  source: "module",
};

// The product's own closed list, which the U10 format law pins word by word in IsolateUsage.test.ts.
const methods = IsolateUsage.Method.literals;
const outcomes = ["ok", "exception", "exceededCpu", "exceededMemory", "canceled", "other"] as const;
const word = fc.string();

class TailImportError extends Schema.TaggedError<TailImportError>()("TailImportError", { cause: Schema.Defect() }) {}

const event = fc.record({
  method: fc.option(fc.oneof(fc.constantFrom(...methods), word), { nil: null }),
  outcome: fc.oneof(fc.constantFrom(...outcomes), word),
  cpuTime: fc.double({ min: 0, max: 30_000, noNaN: true }),
  wallTime: fc.double({ min: 0, max: 30_000, noNaN: true }),
  content: fc.string().map((s) => `PRIVATE_SENTINEL_${s}_END`),
  emptyEvent: fc.boolean(),
});

const loadTail = Effect.gen(function* () {
  const url = new URL("./tail.ts", import.meta.url).href;
  const api: typeof import("./tail.ts") = yield* Effect.tryPromise({
    try: () => import(/* @vite-ignore */ url),
    catch: (cause) => new TailImportError({ cause }),
  });
  return api.tail;
});

// fast-check owns the decision tapes and arbitrary platform words, which have no domain Schema.
it("U4 U5 U6 tail closes words and never reads trace content or sends it to a Process", () =>
  fc.assert(
    fc.asyncProperty(
      fc.record({
        events: fc.array(event, { minLength: 1, maxLength: 32 }),
      }),
      ({ events }) =>
        // edge: fast-check awaits each scoped Effect property
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const tail = yield* loadTail;
              const calls: Array<{ object: string; rows: unknown }> = [];
              const spans: Array<Tracer.NativeSpan> = [];
              // oxlint-disable-next-line fabrika/no-type-assertions -- only the platform namespace and Promise RPC are doubled
              const env = {
                PROCESS: {
                  getByName: (object: string) => ({
                    usage: (rows: unknown) => {
                      calls.push({ object, rows });
                      return Promise.resolve();
                    },
                  }),
                },
              } as unknown as Env;
              const items = events.map(({ method, outcome, cpuTime, wallTime, content, emptyEvent }) => ({
                event: method === null ? (emptyEvent ? {} : null) : { rpcMethod: method },
                outcome,
                cpuTime,
                wallTime,
                // Accessors fail even if the implementation reads content and drops it before sending.
                get logs() {
                  // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: a platform getter throws if the tail reads forbidden content
                  throw new Error(content);
                },
                get exceptions() {
                  // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: a platform getter throws if the tail reads forbidden content
                  throw new Error(content);
                },
              }));
              yield* tail(
                env,
                { project: "project-test", name: "checklist:1", process: PROCESS },
                // oxlint-disable-next-line fabrika/no-type-assertions -- partial platform trace objects expose only the allowed timing fields
                items as unknown as Parameters<typeof tail>[2],
              ).pipe(
                Effect.provide(
                  Layer.succeed(
                    Tracer.Tracer,
                    Tracer.make({
                      span: (options) => {
                        const span = new Tracer.NativeSpan(options);
                        spans.push(span);
                        return span;
                      },
                    }),
                  ),
                ),
              );
              expect(calls).toEqual([
                {
                  object: JSON.stringify(["project-test", "checklist:1"]),
                  rows: events.map(({ method, outcome, cpuTime, wallTime }) => ({
                    process: PROCESS,
                    method: methods.some((known) => known === method) ? method : "other",
                    outcome: outcomes.some((known) => known === outcome) ? outcome : "other",
                    cpuMs: cpuTime,
                    wallMs: wallTime,
                  })),
                },
              ]);

              for (const { content } of events) {
                expect(JSON.stringify(calls)).not.toContain(content);
                expect(JSON.stringify(spans.map((span) => Object.fromEntries(span.attributes)))).not.toContain(content);
              }
            }),
          ),
        ),
    ),
    { seed: 119120 },
  ));

it("U8 each load, reload and successor carries exactly its own tail; bootstrap loads have none", () =>
  fc.assert(
    fc.asyncProperty(
      fc.record({
        tape: fc.array(fc.record({ pick: fc.nat(), replace: fc.boolean() }), { minLength: 2, maxLength: 32 }),
      }),
      ({ tape }) =>
        // edge: fast-check awaits each scoped Effect property
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const seen: Array<{ key: string; tails: ReadonlyArray<unknown> | undefined }> = [];
              const declaration = { name: "checklist", v: 1, inputs: {}, writes: {}, cmds: [] };
              // oxlint-disable-next-line fabrika/no-type-assertions -- recording Worker Loader implements only get and describe
              const loader = {
                get: (key: string, code: () => { tails?: ReadonlyArray<unknown> }) => {
                  seen.push({ key, tails: code().tails });
                  return { getEntrypoint: () => ({ describe: () => Promise.resolve(declaration) }) };
                },
              } as unknown as Parameters<typeof workerLoader>[0];
              const load = workerLoader(loader, {
                checklist: CODE,
              }).load;
              const live = new Map([
                ["checklist:1", 1],
                ["checklist:2", 2],
              ]);
              const tails = new Map<number, BoundTail>();
              let next = 2;

              for (const cell of tape) {
                const names = [...live.keys()];
                const name = names[cell.pick % names.length] ?? "checklist:1";
                const previous = live.get(name) ?? 1;
                const n = cell.replace ? ++next : previous;
                live.set(name, n);
                const process = `process_0000000000e00800${String(n).padStart(10, "0")}`;
                // oxlint-disable-next-line fabrika/no-type-assertions -- opaque platform tail identity, never invoked by this fake loader
                const bound = tails.get(n) ?? ({ process, name } as unknown as BoundTail);
                tails.set(n, bound);
                // The third argument is the process-bound tail. Bootstrap callers omit it.
                yield* load("checklist", process, bound);
                expect(seen.at(-1)).toEqual({ key: `${CODE.hash}/${process}`, tails: [bound] });
              }

              yield* load("checklist", "project:bootstrap/checklist:1");
              expect(seen.at(-1)).toEqual({ key: `${CODE.hash}/project:bootstrap/checklist:1`, tails: undefined });
            }),
          ),
        ),
    ),
    { seed: 119120 },
  ));
