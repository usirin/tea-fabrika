import type { RpcCallError } from "alchemy/Rpc";
import { Effect } from "effect";

export const reach = <A, E, R, X>(call: Effect.Effect<A, E, R>, unreachable: (cause: RpcCallError) => X) =>
  // edge: Alchemy's stub type hides RpcCallError, which arrives at run time
  (call as Effect.Effect<A, E | RpcCallError, R>).pipe(
    Effect.catchTag("RpcCallError", (cause) => Effect.fail(unreachable(cause))),
  );
