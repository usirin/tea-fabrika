import { RpcCallError } from "alchemy/Rpc";
import { Effect, Schema } from "effect";

/** Turns a failed Connection call into `unreachable`; it opens no span, since a failed exit would keep a letter's text. */
export const reach = Effect.fnUntraced(function* <A, E, R, X>(
  call: Effect.Effect<A, E, R>,
  unreachable: (cause: RpcCallError) => X,
) {
  const widened: Effect.Effect<A, E | RpcCallError, R> = call;
  return yield* widened.pipe(
    Effect.catchIf(Schema.is(Schema.instanceOf(RpcCallError)), (cause) => Effect.fail(unreachable(cause))),
  );
});
