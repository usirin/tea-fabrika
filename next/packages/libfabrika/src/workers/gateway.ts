import {Context, Effect, Layer, ManagedRuntime, Result, Schema} from "effect";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {LedgerError, Waited} from "../data/index.ts";
import {workerSql} from "../data/worker-sql.ts";
import {connection} from "../transport/gateway.ts";
import {Answer, Attached, Hello} from "../transport/index.ts";
import type {ConnectionId} from "./bindings.ts";
import {ProjectClient} from "./platform.ts";
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
	const p = ProjectClient.make(projectStub(env, config.name)),
		ids = yield* ProcessIdGenerator;
	const gateway = yield* Schema.decodeUnknownEffect(Schema.String)(ctx.id.name).pipe(
		Effect.mapError(() => new LedgerError({reason: "bad_row"})),
	);
	const recording = yield* Layer.build(
		recordingLayer(workerSql(ctx.storage), env, config.name, `gateway:${gateway}`),
	);
	const recorded = <A, E>(work: Effect.Effect<A, E>) =>
		complete(work).pipe(Effect.provideContext(recording));
	yield* recorded(Effect.void);
	const connections = new Map<WebSocket, ReturnType<typeof connection>>();
	const attached = Effect.fnUntraced(function* (ws: WebSocket) {
		return yield* Schema.decodeUnknownEffect(Attached)(ws.deserializeAttachment()).pipe(
			Effect.mapError(() => new LedgerError({reason: "bad_row"})),
		);
	});
	const make = Effect.fnUntraced(function* (ws: WebSocket) {
		const [session, tab, key] = yield* Schema.decodeUnknownEffect(
			Schema.Tuple([Schema.String, Schema.String, Schema.String]),
		)(ctx.getTags(ws)).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
		const c = connection({
			reader: gateway,
			session,
			read: () => attached(ws),
			save: (a) => ws.serializeAttachment(a),
			send: (text) => ws.send(text),
			close: (code) => ws.close(code, "reconnect"),
			ping: () => ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
			wait: Effect.fnUntraced(function* (stream, after, reader) {
				const state = yield* attached(ws);
				const answer = yield* rpc(
					p.route(state.client as ConnectionId, "ledger.wait", {stream, after}, reader),
				);

				if (answer._tag === "parked") {
					return Waited.cases.parked.make({});
				}

				if (answer._tag !== "ok") {
					return yield* Effect.fail(answer);
				}

				const ready = yield* Schema.decodeUnknownEffect(Schema.Struct({rev: Schema.Int}))(
					answer.result,
				).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
				return Waited.cases.ready.make(ready);
			}),
			call: Effect.fnUntraced(
				function* (method, params) {
					const client = (yield* attached(ws)).client as ConnectionId;

					if (method === "initialize") {
						const hello = Schema.decodeUnknownResult(Hello)(params);
						const result = yield* rpc(
							p.initialize(client, params, {
								url: `http://127.0.0.1:${config.port}`,
								tab,
								name: key,
							}),
						);

						if (result._tag === "refused") {
							if (Result.isSuccess(hello)) {
								ws.serializeAttachment(
									Attached.cases.waiting.make({
										client,
										key: hello.success.key,
										hello: hello.success,
										nonce: hello.success.nonce,
									}),
								);
							}

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
						yield* rpc(p.join({client, key: result.who.key, gateway, session, at: Date.now()}));
						return Answer.cases.ok.make({
							result: {who: result.who, version: result.version, ping: result.ping},
						});
					}

					if (method === "door.knock") {
						const input = yield* Schema.decodeUnknownEffect(Schema.Struct({label: Schema.String}))(
							params,
						).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
						const result = yield* rpc(p.knock(client, input));

						if (result._tag === "ok") {
							const waiting = yield* Schema.decodeUnknownEffect(
								Schema.Struct({code: Schema.String, until: Schema.Number}),
							)(result.result).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
							yield* rpc(p.publish(client, {method: "door.waiting", params: waiting}));
							return Answer.cases.ok.make({result: waiting});
						}

						return result;
					}

					return yield* rpc(p.route(client, method, params));
				},
				// A failed or defective call still answers its request without exposing error details.
				Effect.catchCause(() => Effect.succeed(Answer.cases.refused.make({reason: "unreachable"}))),
			),
		});
		connections.set(ws, c);
		return c;
	});
	const connected = Effect.fnUntraced(function* (ws: WebSocket) {
		return connections.get(ws) ?? (yield* make(ws));
	});
	const close = Effect.fn("gateway.close")(function* (ws: WebSocket) {
		const state = yield* attached(ws),
			[session] = yield* Schema.decodeUnknownEffect(
				Schema.Tuple([Schema.String, Schema.String, Schema.String]),
			)(ctx.getTags(ws)).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
		yield* rpc(p.leave(state.client, session));
		yield* rpc(p.disconnect(state.client as ConnectionId));
		connections.delete(ws);
	});
	const ring = Effect.fn("gateway.ring")(function* (stream: string, rev: number) {
		for (const ws of ctx.getWebSockets()) {
			if ((yield* attached(ws))._tag === "online") {
				yield* (yield* connected(ws)).ring(stream, rev);
			}
		}
	});
	const probe = Effect.fn("gateway.probe")(function* (session: string) {
		for (const ws of ctx.getWebSockets(session)) {
			if ((yield* attached(ws))._tag === "online") {
				return yield* (yield* connected(ws)).probe(session);
			}
		}

		return yield* new LedgerError({reason: "unreachable"});
	});
	const notify = Effect.fn("gateway.notify")(function* (client: string, news: unknown) {
		for (const ws of ctx.getWebSockets()) {
			if ((yield* attached(ws)).client === client) {
				yield* Effect.try({
					try: () => {
						if (
							typeof news === "object" &&
							news !== null &&
							"close" in news &&
							typeof news.close === "number"
						) {
							ws.close(news.close, "permission changed");
						} else {
							ws.send(
								JSON.stringify({
									jsonrpc: "2.0",
									...(typeof news === "object" && news !== null ? news : {}),
								}),
							);
						}
					},
					catch: () => new LedgerError({reason: "unreachable"}),
				});
			}
		}
	});

	for (const ws of ctx.getWebSockets()) {
		const work = (yield* make(ws)).wake();
		yield* (yield* attached(ws))._tag === "online" ? recorded(work) : work;
	}

	return {
		fetch: Effect.fnUntraced(function* (request: Request) {
			const path = new URL(request.url).pathname.split("/");

			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
				return new Response("WebSocket required", {status: 426});
			}

			const segments = yield* Schema.decodeUnknownEffect(
				Schema.Tuple([Schema.String, Schema.String]),
			)(path.slice(2, 4)).pipe(Effect.mapError(() => new LedgerError({reason: "bad_row"})));
			const [key, tab] = yield* Effect.try({
				try: () => [decodeURIComponent(segments[0]), decodeURIComponent(segments[1])] as const,
				catch: () => new LedgerError({reason: "bad_row"}),
			});
			const client = yield* rpc(p.clientConnect()),
				nonce = yield* rpc(p.challenge(client)),
				session = yield* ids.next;
			const pair = new WebSocketPair(),
				server = pair[1];
			ctx.acceptWebSocket(server, [session, tab, key]);
			ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
			server.serializeAttachment(Attached.cases.new.make({client, nonce}));
			yield* rpc(p.register(client, gateway, session));
			yield* make(server);
			server.send(JSON.stringify({jsonrpc: "2.0", method: "challenge", params: {nonce}}));
			return new Response(null, {status: 101, webSocket: pair[0]});
		}),
		message: Effect.fnUntraced(function* (ws: WebSocket, text: string | ArrayBuffer) {
			const state = yield* attached(ws);

			if (typeof text !== "string") {
				return;
			}

			const work = (yield* connected(ws)).frame(text);
			return yield* state._tag === "online" ? recorded(work) : work;
		}),
		close: Effect.fnUntraced(function* (ws: WebSocket) {
			return yield* (yield* attached(ws))._tag === "online" ? recorded(close(ws)) : close(ws);
		}),
		ring: (stream: string, rev: number) => recorded(ring(stream, rev)),
		probe: (session: string) => recorded(probe(session)),
		notify: Effect.fnUntraced(function* (client: string, news: unknown) {
			const states = yield* Effect.forEach(ctx.getWebSockets(), attached, {concurrency: 1});
			const online = states.some((state) => state.client === client && state._tag === "online");
			return yield* online ? recorded(notify(client, news)) : notify(client, news);
		}),
	};
});

export class GatewayService extends Context.Service<
	GatewayService,
	Effect.Success<ReturnType<typeof gatewayLogic>>
>()("fabrika/Gateway") {}

export const gatewayLayer = (ctx: DurableObjectState, env: Env, config: BrainOptions) =>
	Layer.effect(GatewayService, gatewayLogic(ctx, env, config)).pipe(
		Layer.provide(ProcessIdGenerator.layer),
	);

export const gatewayRuntime = (ctx: DurableObjectState, env: Env, config: BrainOptions) =>
	ManagedRuntime.make(gatewayLayer(ctx, env, config));
