// A thin RpcServer.Protocol over a Durable Object's hibernating WebSockets.
//
// Adapted from @alchemy.run/cloudflare's Workers/RpcWebSocket.ts (2.0.0-beta.84), cut down for a
// spike. The idea we took: the transport lives one activation, the socket's attachment holds what
// must survive, and a socket that had a call open when the object slept is closed with 1012.
//
// `hold: true` keeps an open call alive with waitUntil, as Alchemy does. `hold: false` does not,
// which shows what happens to a call when the object sleeps under it.
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as RpcMessage from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

interface Attached {
	readonly client: number;
	readonly open: boolean;
	/** Streams parked as data: they need no fiber, so the object can sleep under them. */
	readonly parked: ReadonlyArray<{readonly id: string | number; readonly after: number}>;
}

const blank = (client: number): Attached => ({client, open: false, parked: []});

export const attached = (ws: WebSocket): Attached =>
	(ws.deserializeAttachment() as Attached | null) ?? blank(-1);

export interface Door {
	readonly protocol: RpcServer.Protocol["Service"];
	readonly accept: (ws: WebSocket) => void;
	readonly message: (ws: WebSocket, text: string | ArrayBuffer) => Effect.Effect<void>;
	readonly gone: (ws: WebSocket) => Effect.Effect<void>;
	readonly resets: () => number;
}

interface Conn {
	readonly id: number;
	readonly ws: WebSocket;
	readonly parser: RpcSerialization.Parser;
	readonly open: Set<string | number>;
}

export const makeDoor = (options: {
	readonly state: DurableObjectState;
	readonly hold: boolean;
	/** A request the door answers itself, before RpcServer sees it. True means handled. */
	readonly intercept?: (ws: WebSocket, request: RpcMessage.RequestEncoded) => boolean;
	readonly interceptOther?: (ws: WebSocket, message: RpcMessage.FromClientEncoded) => boolean;
}) =>
	Effect.gen(function* () {
		const {state, hold} = options;
		const serialization = yield* RpcSerialization.RpcSerialization;
		const disconnects = yield* Queue.make<number>();
		const byId = new Map<number, Conn>();
		const bySocket = new Map<WebSocket, Conn>();
		const waiters: Array<{conn: Conn; resolve: () => void}> = [];
		let nextId = 0;
		let resets = 0;
		let receive: ((id: number, m: RpcMessage.FromClientEncoded) => Effect.Effect<void>) | undefined;

		const register = (ws: WebSocket, id: number): Conn => {
			const conn: Conn = {id, ws, parser: serialization.makeUnsafe(), open: new Set()};
			byId.set(id, conn);
			bySocket.set(ws, conn);
			nextId = Math.max(nextId, id + 1);
			return conn;
		};

		const persist = (conn: Conn) => {
			const was = attached(conn.ws);
			conn.ws.serializeAttachment({...was, client: conn.id, open: conn.open.size > 0});
		};

		const drop = (ws: WebSocket) => {
			const conn = bySocket.get(ws);
			if (conn === undefined) return;
			bySocket.delete(ws);
			byId.delete(conn.id);
			Queue.offerUnsafe(disconnects, conn.id);
		};

		// Waking up: every socket comes back. One that had an open call lost it, so it is closed.
		for (const ws of state.getWebSockets()) {
			const a = attached(ws);
			if (a.open) {
				resets++;
				ws.close(1012, "activation reset");
				continue;
			}
			register(ws, a.client);
		}

		const protocol = yield* RpcServer.Protocol.make((write) => {
			receive = write;
			return Effect.succeed({
				disconnects,
				send: (id, response) =>
					Effect.suspend(() => {
						const conn = byId.get(id);
						if (conn === undefined) return Effect.void;
						const encoded = conn.parser.encode(response);
						if (encoded === undefined) return Effect.void;
						conn.ws.send(encoded as string);
						if (response._tag === "Exit") {
							conn.open.delete(response.requestId);
							persist(conn);
							if (conn.open.size === 0) {
								for (const w of waiters.filter((x) => x.conn === conn)) w.resolve();
							}
						}
						return Effect.void;
					}),
				end: (id) =>
					Effect.sync(() => {
						const conn = byId.get(id);
						if (conn !== undefined) conn.ws.close(1000);
					}),
				clientIds: Effect.sync(() => new Set(byId.keys())),
				initialMessage: Effect.succeedNone,
				supportsAck: true,
				supportsTransferables: false,
				supportsSpanPropagation: true,
				supportsNotifications: true,
				codecFor: serialization.codecFor,
			});
		});

		const door: Door = {
			protocol,
			accept: (ws) => {
				state.acceptWebSocket(ws);
				const conn = register(ws, nextId);
				ws.serializeAttachment(blank(conn.id));
			},
			message: (ws, text) =>
				Effect.gen(function* () {
					const conn = bySocket.get(ws);
					if (conn === undefined || receive === undefined) return;
					const data = typeof text === "string" ? text : new Uint8Array(text);
					const messages = conn.parser.decode(data) as ReadonlyArray<RpcMessage.FromClientEncoded>;
					for (const m of messages) {
						if (m._tag === "Request") {
							if (options.intercept?.(ws, m)) continue;
							if (!m.isNotification) {
								conn.open.add(m.id);
								persist(conn);
							}
						} else if (options.interceptOther?.(ws, m)) {
							continue;
						}
						yield* receive(conn.id, m);
						if (hold && conn.open.size > 0) {
							// A promise and nothing else: no timer, so only waitUntil can hold the object.
							state.waitUntil(new Promise<void>((resolve) => waiters.push({conn, resolve})));
						}
					}
				}),
			gone: (ws) => Effect.sync(() => drop(ws)),
			resets: () => resets,
		};
		return door;
	});

export {RpcMessage};
