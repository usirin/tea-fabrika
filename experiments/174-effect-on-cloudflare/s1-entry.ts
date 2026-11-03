// Part 1: Effect RPC as the door of one Durable Object, with hibernation on.
//
// /ws                 the door, over jsonRpc serialization
// ?timer=1            the object also keeps a setInterval, the control that must not sleep
// ?hold=1             an open call holds the object with waitUntil, as Alchemy does
// ?ping=text          the auto-response pair is ("ping","pong") and not Effect's own ping
//
// Each activation adds one row to `wakes`, written in the constructor. That row is the only
// measure of sleep the test trusts.
import {DurableObject} from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMessage from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {attached, makeDoor, type Door} from "./door.ts";
import {type Row, Conflict, Group} from "./s1-group.ts";

/** Set once the object has started. A missing one is a bug in this spike, so it throws. */
const need = <A>(value: A | undefined): A => {
	if (value === undefined) throw new Error("not started");
	return value;
};

type Env = {DOOR: DurableObjectNamespace};

export class DoorObject extends DurableObject<Env> {
	rt: ManagedRuntime.ManagedRuntime<never, never> | undefined;
	door: Door | undefined;
	news: PubSub.PubSub<typeof Row.Type> | undefined;
	boot: Promise<void> | undefined;
	serverPing: string;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;
		sql.exec("CREATE TABLE IF NOT EXISTS wakes (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER)");
		sql.exec("CREATE TABLE IF NOT EXISTS facts (n INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT)");
		sql.exec("CREATE TABLE IF NOT EXISTS conf (k TEXT PRIMARY KEY, v TEXT)");
		sql.exec("INSERT INTO wakes (at) VALUES (?)", Date.now());
		const conf = Object.fromEntries(
			sql
				.exec<{k: string; v: string}>("SELECT k, v FROM conf")
				.toArray()
				.map((r) => [r.k, r.v]),
		);
		if (conf.timer === "1") setInterval(() => {}, 1000);
		this.serverPing = conf.ping ?? "effect";
	}

	row = (n: number) =>
		this.ctx.storage.sql
			.exec<{n: number; text: string}>("SELECT n, text FROM facts WHERE n > ? ORDER BY n", n)
			.toArray();

	top = () =>
		this.ctx.storage.sql.exec<{n: number}>("SELECT COALESCE(MAX(n),0) AS n FROM facts").one().n;

	/** Parked streams: a chunk goes straight to the socket, under the id the client is waiting on. */
	pushParked = () => {
		for (const ws of this.ctx.getWebSockets()) {
			const a = attached(ws);
			if (a.parked.length === 0) continue;
			const parked = a.parked.map((p) => {
				const rows = this.row(p.after);
				if (rows.length > 0) {
					ws.send(JSON.stringify({jsonrpc: "2.0", id: p.id, chunk: true, result: rows}));
				}
				return {...p, after: rows.at(-1)?.n ?? p.after};
			});
			ws.serializeAttachment({...a, parked});
		}
	};

	start = (hold: boolean) => {
		this.boot ??= (async () => {
			const state = this.ctx;
			const appendEffect = (p: {base: number; text: string}) =>
				Effect.suspend(() => {
					const top = this.top();
					if (p.base !== top) return Effect.fail(new Conflict({top}));
					const row = this.ctx.storage.sql
						.exec<{n: number; text: string}>(
							"INSERT INTO facts (text) VALUES (?) RETURNING n, text",
							p.text,
						)
						.one();
					return PubSub.publish(need(this.news), row).pipe(
						Effect.tap(() => Effect.sync(() => this.pushParked())),
						Effect.as(row),
					);
				});
			const Handlers = Group.toLayer({
				append: appendEffect,
				read: ({after}) => Effect.sync(() => this.row(after)),
				wakes: () =>
					Effect.sync(() => this.ctx.storage.sql.exec("SELECT n FROM wakes").toArray().length),
				slow: ({ms}) => Effect.sleep(ms).pipe(Effect.as(ms)),
				tail: ({after}) =>
					Stream.concat(Stream.fromIterable(this.row(after)), Stream.fromPubSub(need(this.news))),
			});
			const Wire = Layer.effectDiscard(Effect.gen(this.bind(hold, Handlers, state)));
			this.rt = ManagedRuntime.make(Wire.pipe(Layer.provide(RpcSerialization.layerJsonRpc())));
			await this.rt.runPromise(Effect.void);
		})();
		return this.boot;
	};

	bind(hold: boolean, Handlers: Layer.Layer<any, never, never>, state: DurableObjectState) {
		// oxlint-disable-next-line typescript/no-this-alias -- a generator cannot be an arrow function, so it cannot see this
		const self = this;
		return function* (): Generator<any, void, any> {
			self.news = yield* PubSub.unbounded<typeof Row.Type>();
			const door: Door = yield* makeDoor({
				state,
				hold,
				intercept: (ws, request) => {
					if (request.tag !== "park") return false;
					const after = (request.payload as {after: number}).after;
					const a = attached(ws);
					const rows = self.row(after);
					if (rows.length > 0) {
						ws.send(JSON.stringify({jsonrpc: "2.0", id: request.id, chunk: true, result: rows}));
					}
					ws.serializeAttachment({
						...a,
						parked: [...a.parked, {id: request.id, after: rows.at(-1)?.n ?? after}],
					});
					return true;
				},
				interceptOther: (ws, message) => {
					if (message._tag === "Ack") {
						const a = attached(ws);
						return a.parked.some((p) => String(p.id) === String(message.requestId));
					}
					if (message._tag === "Interrupt") {
						const a = attached(ws);
						const left = a.parked.filter((p) => String(p.id) !== String(message.requestId));
						if (left.length === a.parked.length) return false;
						ws.serializeAttachment({...a, parked: left});
						return true;
					}
					return false;
				},
			});
			self.door = door;
			yield* Layer.build(
				RpcServer.layer(Group).pipe(
					Layer.provide(Handlers),
					Layer.provide(Layer.succeed(RpcServer.Protocol, door.protocol)),
				),
			);
		};
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const sql = this.ctx.storage.sql;
		for (const k of ["timer", "hold", "ping"]) {
			const v = url.searchParams.get(k);
			if (v !== null) sql.exec("INSERT OR REPLACE INTO conf (k, v) VALUES (?, ?)", k, v);
		}
		if (url.searchParams.get("timer") === "1") setInterval(() => {}, 1000);
		if (url.pathname === "/wakes") {
			return Response.json({
				wakes: sql.exec("SELECT n FROM wakes").toArray().length,
				sockets: this.ctx.getWebSockets().length,
				auto: this.ctx.getWebSocketAutoResponse()?.request ?? null,
			});
		}
		if (url.pathname === "/poke") {
			for (const ws of this.ctx.getWebSockets()) {
				ws.send(JSON.stringify({jsonrpc: "2.0", method: "poke", params: {top: this.top()}}));
			}
			return new Response("ok");
		}
		if (url.pathname === "/alarm") {
			await this.ctx.storage.setAlarm(Date.now() + Number(url.searchParams.get("in") ?? "100"));
			return new Response("ok");
		}
		if (url.pathname === "/plain") return Response.json(this.row(0).length);
		const hold =
			(sql.exec<{v: string}>("SELECT v FROM conf WHERE k='hold'").toArray()[0]?.v ?? "0") === "1";
		await this.start(hold);
		const ping = url.searchParams.get("ping") ?? this.serverPing;
		const pair =
			ping === "text"
				? new WebSocketRequestResponsePair("ping", "pong")
				: new WebSocketRequestResponsePair(
						JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Ping"}),
						JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Pong"}),
					);
		this.ctx.setWebSocketAutoResponse(pair);
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		need(this.door).accept(server);
		return new Response(null, {status: 101, webSocket: client});
	}

	async webSocketMessage(ws: WebSocket, text: string | ArrayBuffer) {
		// The control for speed: the same insert with no Effect on the path at all.
		if (typeof text === "string" && text.startsWith('{"bare"')) {
			const m = JSON.parse(text) as {bare: number; text: string};
			const row = this.ctx.storage.sql
				.exec<{n: number; text: string}>(
					"INSERT INTO facts (text) VALUES (?) RETURNING n, text",
					m.text,
				)
				.one();
			ws.send(JSON.stringify({jsonrpc: "2.0", id: m.bare, result: row}));
			return;
		}
		const hold =
			(this.ctx.storage.sql.exec<{v: string}>("SELECT v FROM conf WHERE k='hold'").toArray()[0]
				?.v ?? "0") === "1";
		await this.start(hold);
		return need(this.rt).runPromise(need(this.door).message(ws, text));
	}

	async webSocketClose(ws: WebSocket) {
		await this.start(false);
		return need(this.rt).runPromise(need(this.door).gone(ws));
	}

	async alarm() {
		this.ctx.storage.sql.exec("INSERT INTO facts (text) VALUES ('from the alarm')");
		this.pushParked();
	}
}

export default {
	fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		const name = url.searchParams.get("name") ?? "one";
		if (url.pathname === "/page") {
			return new Response("<!doctype html><title>tab</title>", {
				headers: {"content-type": "text/html"},
			});
		}
		return env.DOOR.get(env.DOOR.idFromName(name)).fetch(request);
	},
};

void Schema;
void RpcMessage;
void Rpc;
void RpcGroup;
