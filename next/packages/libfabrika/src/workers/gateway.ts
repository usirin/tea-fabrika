import {Context, Effect, Layer, ManagedRuntime, Result, Schema} from "effect";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {LedgerError, Waited} from "../data/index.ts";
import {workerSql} from "../data/worker-sql.ts";
import {connection} from "../transport/gateway.ts";
import {Answer, Attached, Hello} from "../transport/index.ts";
import type {ConnectionId, ProjectBinding} from "./bindings.ts";
import {
	complete,
	projectStub,
	recordingLayer,
	rpc,
	type BrainOptions,
	type Env,
} from "./runtime.ts";

const gatewayLogic = Effect.fnUntraced(function* (
	ctx: DurableObjectState,
	env: Env,
	config: BrainOptions,
) {
	const p = projectStub(env, config.name),
		ids = yield* ProcessIdGenerator;
	const gateway = Schema.decodeUnknownSync(Schema.String)(ctx.id.name);
	const recording = yield* Layer.build(
		recordingLayer(workerSql(ctx.storage), env, config.name, `gateway:${gateway}`),
	);
	const recorded = <A, E>(work: Effect.Effect<A, E>) =>
		complete(work).pipe(Effect.provideContext(recording));
	yield* recorded(Effect.void);
	const connections = new Map<WebSocket, ReturnType<typeof connection>>();
	const attached = (ws: WebSocket) =>
		Schema.decodeUnknownSync(Attached)(ws.deserializeAttachment());
	const make = (ws: WebSocket) => {
		const [session, tab, key] = Schema.decodeUnknownSync(
			Schema.Tuple([Schema.String, Schema.String, Schema.String]),
		)(ctx.getTags(ws));
		const c = connection({
			reader: gateway,
			session,
			read: () => attached(ws),
			save: (a) => ws.serializeAttachment(a),
			send: (text) => ws.send(text),
			close: (code) => ws.close(code, "reconnect"),
			ping: () => ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
			wait: Effect.fnUntraced(function* (stream, after, reader) {
				const answer = yield* rpc<typeof Answer.Type>(() =>
					p.route(attached(ws).client as ConnectionId, "ledger.wait", {stream, after}, reader),
				);
				if (answer._tag === "parked") return Waited.cases.parked.make({});
				if (answer._tag !== "ok") return yield* Effect.fail(answer);
				return Waited.cases.ready.make({
					rev: Schema.decodeUnknownSync(Schema.Struct({rev: Schema.Int}))(answer.result).rev,
				});
			}),
			call: Effect.fnUntraced(
				function* (method, params) {
					const client = attached(ws).client as ConnectionId;
					if (method === "initialize") {
						const hello = Schema.decodeUnknownResult(Hello)(params);
						const result = yield* rpc<Awaited<ReturnType<ProjectBinding["initialize"]>>>(() =>
							p.initialize(client, params, {
								url: `http://127.0.0.1:${config.port}`,
								tab,
								name: key,
							}),
						);
						if (result._tag === "refused") {
							if (Result.isSuccess(hello))
								ws.serializeAttachment(
									Attached.cases.waiting.make({
										client,
										key: hello.success.key,
										hello: hello.success,
										nonce: hello.success.nonce,
									}),
								);
							return result;
						}
						ws.serializeAttachment(
							Attached.cases.online.make({
								client,
								who: result.who,
								version: result.version,
								waits: [],
								watching: false,
								busy: false,
							}),
						);
						yield* rpc(() =>
							p.join({client, key: result.who.key, gateway, session, at: Date.now()}),
						);
						return Answer.cases.ok.make({
							result: {who: result.who, version: result.version, ping: result.ping},
						});
					}
					if (method === "door.knock") {
						const input = yield* Schema.decodeUnknownEffect(Schema.Struct({label: Schema.String}))(
							params,
						);
						const result = yield* rpc<typeof Answer.Type>(() => p.knock(client, input));
						if (result._tag === "ok") {
							const waiting = yield* Schema.decodeUnknownEffect(
								Schema.Struct({code: Schema.String, until: Schema.Number}),
							)(result.result);
							yield* rpc(() => p.publish(client, {method: "door.waiting", params: waiting}));
							return Answer.cases.ok.make({result: waiting});
						}
						return result;
					}
					return yield* rpc<typeof Answer.Type>(() => p.route(client, method, params));
				},
				// A failed or defective call still answers its request without exposing error details.
				Effect.catchCause(() => Effect.succeed(Answer.cases.refused.make({why: "unreachable"}))),
			),
		});
		connections.set(ws, c);
		return c;
	};
	const close = Effect.fn("gateway.close")(function* (ws: WebSocket) {
		const state = attached(ws),
			session = Schema.decodeUnknownSync(Schema.String)(ctx.getTags(ws)[0]);
		yield* rpc(() => p.leave(state.client, session));
		yield* rpc(() => p.disconnect(state.client as ConnectionId));
		connections.delete(ws);
	});
	const ring = Effect.fn("gateway.ring")(function* (stream: string, rev: number) {
		for (const ws of ctx.getWebSockets())
			if (attached(ws)._tag === "online")
				yield* (connections.get(ws) ?? make(ws)).ring(stream, rev);
	});
	const probe = Effect.fn("gateway.probe")(function* (session: string) {
		for (const ws of ctx.getWebSockets(session))
			if (attached(ws)._tag === "online")
				return yield* (connections.get(ws) ?? make(ws)).probe(session);
		return yield* new LedgerError({why: "unreachable"});
	});
	const notify = Effect.fn("gateway.notify")(function* (client: string, news: unknown) {
		yield* Effect.try({
			try: () => {
				for (const ws of ctx.getWebSockets())
					if (attached(ws).client === client) {
						if (
							typeof news === "object" &&
							news !== null &&
							"close" in news &&
							typeof news.close === "number"
						)
							ws.close(news.close, "permission changed");
						else
							ws.send(
								JSON.stringify({
									jsonrpc: "2.0",
									...(typeof news === "object" && news !== null ? news : {}),
								}),
							);
					}
			},
			catch: () => new LedgerError({why: "unreachable"}),
		});
	});
	for (const ws of ctx.getWebSockets()) {
		const work = make(ws).wake();
		yield* attached(ws)._tag === "online" ? recorded(work) : work;
	}
	return {
		fetch: Effect.fnUntraced(function* (request: Request) {
			const path = new URL(request.url).pathname.split("/");
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
				return new Response("WebSocket required", {status: 426});
			const client = yield* rpc(() => p.clientConnect()),
				nonce = yield* rpc(() => p.challenge(client)),
				session = yield* ids.next;
			const pair = new WebSocketPair(),
				server = pair[1];
			ctx.acceptWebSocket(server, [
				session,
				decodeURIComponent(Schema.decodeUnknownSync(Schema.String)(path[3])),
				decodeURIComponent(Schema.decodeUnknownSync(Schema.String)(path[2])),
			]);
			ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
			server.serializeAttachment(Attached.cases.new.make({client, nonce}));
			yield* rpc(() => p.register(client, gateway, session));
			make(server);
			server.send(JSON.stringify({jsonrpc: "2.0", method: "challenge", params: {nonce}}));
			return new Response(null, {status: 101, webSocket: pair[0]});
		}),
		message: (ws: WebSocket, text: string | ArrayBuffer) => {
			if (typeof text !== "string") return Effect.void;
			const work = (connections.get(ws) ?? make(ws)).frame(text);
			return attached(ws)._tag === "online" ? recorded(work) : work;
		},
		close: (ws: WebSocket) => (attached(ws)._tag === "online" ? recorded(close(ws)) : close(ws)),
		ring: (stream: string, rev: number) => recorded(ring(stream, rev)),
		probe: (session: string) => recorded(probe(session)),
		notify: (client: string, news: unknown) => {
			const online = ctx
				.getWebSockets()
				.some((ws) => attached(ws).client === client && attached(ws)._tag === "online");
			return online ? recorded(notify(client, news)) : notify(client, news);
		},
	};
});
export class GatewayService extends Context.Service<
	GatewayService,
	Effect.Success<ReturnType<typeof gatewayLogic>>
>()("fabrika/Gateway") {}
export const gatewayRuntime = (ctx: DurableObjectState, env: Env, config: BrainOptions) =>
	ManagedRuntime.make(
		Layer.effect(GatewayService, gatewayLogic(ctx, env, config)).pipe(
			Layer.provide(ProcessIdGenerator.layer),
		),
	);
