import { it, expect } from "@effect/vitest";
// T502 PR 2, next/. Plants: return the failed call unchanged; map all failures to unreachable.
import { RpcCallError } from "alchemy/Rpc";
import { Effect, Result, Schema } from "effect";
import { SinkError } from "../data/trace.ts";
import { reach } from "./reach.ts";

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
