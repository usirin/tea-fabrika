import { RpcCallError } from "alchemy/Rpc";
import { Effect, Schema } from "effect";

export const reach = Effect.fn("brain.reach")(function* <A, E, R, X>(
  call: Effect.Effect<A, E, R>,
  unreachable: (cause: RpcCallError) => X,
) {
  const widened: Effect.Effect<A, E | RpcCallError, R> = call;
  return yield* widened.pipe(
    Effect.catchIf(Schema.is(Schema.instanceOf(RpcCallError)), (cause) => Effect.fail(unreachable(cause))),
  );
});
