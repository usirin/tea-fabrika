import {ProcessIdGenerator} from "@kampus/libfabrika/coordination";
import {LedgerError, Waited} from "@kampus/libfabrika/data";
import {Answer, Attached, Hello, Row} from "@kampus/libfabrika/transport";
import {connection} from "@kampus/libfabrika/transport/gateway";
import {workerSql} from "@kampus/libfabrika/workers";
import {Context, Effect, Layer, ManagedRuntime, Result, Schema} from "effect";
import type {ProjectBinding} from "./bindings.ts";
import type {ConnectionId} from "./door.ts";
import {complete, projectStub, recordingLayer, rpc, settings, type Env} from "./runtime.ts";

const gatewayLogic = Effect.fnUntraced(function* (ctx: DurableObjectState, env: Env) {
	const config = settings(env),
		p = projectStub(env, config.name),
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
			call: Effect.fnUntraced(function* (method, params) {
				const client = attached(ws).client as ConnectionId;
				if (method === "initialize") {
					const hello = Schema.decodeUnknownResult(Hello)(params);
					const result = yield* rpc<Awaited<ReturnType<ProjectBinding["initialize"]>>>(() =>
						p.initialize(client, params, {url: `http://127.0.0.1:${config.port}`, tab, name: key}),
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
					yield* rpc(() => p.join({client, key: result.who.key, gateway, session, at: Date.now()}));
					return Answer.cases.ok.make({
						result: {who: result.who, version: result.version, ping: result.ping},
					});
				}
				if (method === "door.knock") {
					const result = yield* rpc<typeof Answer.Type>(() =>
						p.knock(
							client,
							Schema.decodeUnknownSync(Schema.Struct({label: Schema.String}))(params),
						),
					);
					if (result._tag === "ok") {
						const rows = Schema.decodeUnknownSync(Schema.Struct({rows: Schema.Array(Row)}))(
							result.result,
						).rows;
						for (const row of rows)
							if (row.clients.includes(client))
								for (const waiting of row.clients)
									yield* rpc(() =>
										p.publish(waiting, {
											method: "door.waiting",
											params: {code: row.code, until: row.until},
										}),
									);
					}
					return result;
				}
				return yield* rpc<typeof Answer.Type>(() => p.route(client, method, params));
			}),
		});
		connections.set(ws, c);
		return c;
	};
	for (const ws of ctx.getWebSockets()) yield* make(ws).wake();
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
		close: Effect.fnUntraced(function* (ws: WebSocket) {
			const state = attached(ws),
				session = Schema.decodeUnknownSync(Schema.String)(ctx.getTags(ws)[0]);
			yield* rpc(() => p.leave(state.client, session));
			yield* rpc(() => p.disconnect(state.client as ConnectionId));
			connections.delete(ws);
		}),
		ring: Effect.fnUntraced(function* (stream: string, rev: number) {
			for (const ws of ctx.getWebSockets())
				yield* (connections.get(ws) ?? make(ws)).ring(stream, rev);
		}),
		probe: Effect.fnUntraced(function* (session: string) {
			for (const ws of ctx.getWebSockets(session))
				return yield* (connections.get(ws) ?? make(ws)).probe(session);
			return yield* new LedgerError({why: "unreachable"});
		}),
		notify: (client: string, news: unknown) =>
			Effect.sync(() => {
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
			}),
	};
});
export class GatewayService extends Context.Service<
	GatewayService,
	Effect.Success<ReturnType<typeof gatewayLogic>>
>()("fabrika/Gateway") {}
export const gatewayRuntime = (ctx: DurableObjectState, env: Env) =>
	ManagedRuntime.make(
		Layer.effect(GatewayService, gatewayLogic(ctx, env)).pipe(
			Layer.provide(ProcessIdGenerator.layer),
		),
	);
