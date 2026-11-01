// Only bundled, to weigh it: what Effect's RpcClient costs a window that chooses to use it.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import {Group} from "./s1-group.ts";

const clientLayer = RpcClient.layerProtocolSocket({retryTransientErrors: true}).pipe(
	Layer.provide(Socket.layerWebSocket("ws://x")),
	Layer.provide(Socket.layerWebSocketConstructorGlobal),
	Layer.provide(RpcSerialization.layerJsonRpc()),
);

export const run = Effect.gen(function* () {
	const client = yield* RpcClient.make(Group);
	return yield* client.read({after: 0});
}).pipe(Effect.scoped, Effect.provide(clientLayer));
