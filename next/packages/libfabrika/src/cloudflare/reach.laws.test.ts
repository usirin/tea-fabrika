import { it, expect } from "@effect/vitest";
// T502 PR 2, next/. Plants: return the failed call unchanged; map all failures to unreachable.
import { encodeRpcError, ErrorTag, RpcCallError } from "alchemy/Rpc";
import { Effect, Result, Schema, Stream } from "effect";
import { RecordManager } from "../telemetry/Records.ts";
import { Chain, SinkError } from "../telemetry/Trace.ts";
import { reach } from "./reach.ts";
import { recordStub, type Env } from "./runtime.ts";

const unreachable = (cause: RpcCallError) => new SinkError({ reason: "unreachable", held: 0, cause });
const Method = Schema.Literals(["write", "read", "content", "deleteContent"]);

it.effect.prop(
  "reach keeps transport failures in SinkError's failure channel, with the same cause",
  { method: Method, message: Schema.String },
  ({ method, message }) =>
    Effect.gen(function* () {
      const cause = new RpcCallError({ method, cause: new Error(message) });
      // result does not catch defects: a die instead of fail fails this property too.
      const translated: Effect.Effect<never, SinkError> = reach(Effect.fail(cause), unreachable);
      const result = yield* Effect.result(translated);
      expect(Result.isFailure(result)).toBe(true);
      const error = Result.getFailure(result);
      expect(error).toMatchObject({ _tag: "Some", value: { _tag: "SinkError", reason: "unreachable", held: 0 } });
      expect(Result.match(result, { onSuccess: () => undefined, onFailure: (e) => e.cause })).toBe(cause);
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);

it.effect.prop(
  "reach passes the callee's typed failure through unchanged",
  { reason: Schema.Literals(["bad_row", "storage"]), held: Schema.Int },
  ({ reason, held }) =>
    Effect.gen(function* () {
      const failure = new SinkError({ reason, held });
      const translated: Effect.Effect<never, SinkError> = reach(Effect.fail(failure), unreachable);
      const result = yield* Effect.result(translated);
      expect(Result.match(result, { onSuccess: () => undefined, onFailure: (e) => e })).toBe(failure);
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);

// Plant: delete { errors: [SinkError] } from runtime.ts's recordStub makeRpcStub call.
// beta.84 WorkerBridge.handleRpcExit emits ErrorTag + encodeRpcError; Rpc.decodeRpcResult
// revives that plain wire value only when the caller declares the error class.
it.effect.prop(
  "the brain record path revives typed failures and preserves rejected transport causes",
  { reason: SinkError.fields.reason, held: SinkError.fields.held, thrown: Schema.String },
  ({ reason, held, thrown }) =>
    Effect.gen(function* () {
      for (const typed of [true, false]) {
        const calls: Array<string> = [];
        const answer = (method: string) => {
          calls.push(method);
          // Platform RPC boundary: resolve the bridge envelope or reject the transport call.
          return typed
            ? Promise.resolve({ _tag: ErrorTag, error: encodeRpcError(new SinkError({ reason, held })) })
            : Promise.reject(thrown);
        };
        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: only RECORD.getByName is consumed by recordStub; other platform handles are unused
        const env = {
          RECORD: {
            getByName: () => ({
              write: () => answer("write"),
              read: () => answer("read"),
              content: () => answer("content"),
              deleteContent: () => answer("deleteContent"),
            }),
          },
        } as unknown as Env;
        yield* Effect.gen(function* () {
          const records = yield* RecordManager;
          const chain = Chain.cases.spans.make({});
          const operations: Array<Effect.Effect<unknown, SinkError>> = [
            records.write(chain, 0, []),
            Stream.runCollect(records.read(chain)),
            records.content(chain, "span"),
            records.deleteContent(chain, "span", { by: "writer", reason: "requested" }),
          ];

          for (const operation of operations) {
            const failure = yield* Effect.flip(operation);
            expect(failure).toBeInstanceOf(SinkError);
            expect(failure.reason).toBe(typed ? reason : "unreachable");
            expect(failure.held).toBe(typed ? held : 0);

            if (!typed) {
              expect(failure.cause).toBeInstanceOf(RpcCallError);
              expect(failure.cause).toMatchObject({ cause: thrown });
            }
          }
        }).pipe(Effect.provide(RecordManager.remote((name) => recordStub(env, "project", name))));
        expect(calls).toEqual(["write", "read", "content", "deleteContent"]);
      }
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);
