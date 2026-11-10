// Experiment 248 spike, next/. Throwaway probe objects in Alchemy's modular Effect form.
// Never merged. Each object answers one question of ticket 502's plan.
import * as Cloudflare from "@alchemy.run/cloudflare";
import {Effect, Schema} from "effect";

export class Boom extends Schema.TaggedError<Boom>()("Boom", {reason: Schema.String}) {}
export class Note extends Schema.Class<Note>("Note")({text: Schema.String, n: Schema.Number}) {}

// Q2 and Q3: storage and alarms.
export interface StoreShape {
	readonly sql: () => Effect.Effect<{rows: number; size: number}>;
	readonly txSync: (
		fail: boolean,
	) => Effect.Effect<{before: number; after: number; threw: string | null}>;
	readonly txEffect: (
		fail: boolean,
	) => Effect.Effect<{before: number; after: number; threw: string | null}>;
	readonly arm: (ms: number, mode: "plain" | "abort" | "delete") => Effect.Effect<number | null>;
	readonly alarms: () => Effect.Effect<{
		fired: ReadonlyArray<{at: number; mode: string; instance: string; retry: number}>;
		armed: number | null;
		tables: ReadonlyArray<string>;
		instance: string;
	}>;
	readonly alarm: (info?: Cloudflare.AlarmInvocationInfo) => Effect.Effect<void>;
}

export class Store extends Cloudflare.DurableObject<Store, StoreShape>()("Store") {}

export const StoreLive = Store.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState;

		return Effect.gen(function* () {
			const instance = crypto.randomUUID();
			yield* state.storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)",
			);
			yield* state.storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS fired (at INTEGER, mode TEXT, instance TEXT, retry INTEGER)",
			);
			yield* state.storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS mode (id INTEGER PRIMARY KEY, mode TEXT)",
			);
			const count = () => Number(state.raw.storage.sql.exec("SELECT COUNT(*) AS n FROM t").one().n);
			return {
				sql: () =>
					Effect.gen(function* () {
						yield* state.storage.sql.exec("INSERT INTO t (v) VALUES (?)", "x");
						const cursor = yield* state.storage.sql.exec<{n: number}>(
							"SELECT COUNT(*) AS n FROM t",
						);
						const rows = yield* cursor.one();
						return {rows: Number(rows.n), size: state.storage.sql.databaseSize};
					}).pipe(Effect.orDie),
				txSync: (fail: boolean) =>
					Effect.sync(() => {
						const before = count();
						let threw: string | null = null;

						try {
							state.raw.storage.transactionSync(() => {
								state.raw.storage.sql.exec("INSERT INTO t (v) VALUES ('a')");
								state.raw.storage.sql.exec("INSERT INTO t (v) VALUES ('b')");

								if (fail) {
									throw new Error("refused");
								}
							});
						} catch (error) {
							threw = String(error);
						}

						return {before, after: count(), threw};
					}),
				txEffect: (fail: boolean) =>
					Effect.gen(function* () {
						const before = count();
						const exit = yield* state.storage
							.transaction(
								Effect.gen(function* () {
									yield* state.storage.sql.exec("INSERT INTO t (v) VALUES ('a')");
									yield* state.storage.sql.exec("INSERT INTO t (v) VALUES ('b')");

									if (fail) {
										return yield* new Boom({reason: "refused"});
									}
								}),
							)
							.pipe(Effect.exit);
						return {
							before,
							after: count(),
							threw: exit._tag === "Failure" ? String(exit.cause) : null,
						};
					}),
				arm: (ms: number, mode: "plain" | "abort" | "delete") =>
					Effect.gen(function* () {
						yield* state.storage.sql.exec(
							"INSERT OR REPLACE INTO mode (id, mode) VALUES (1, ?)",
							mode,
						);
						yield* state.storage.setAlarm(Date.now() + ms);

						if (mode === "delete") {
							yield* state.storage.deleteAlarm();
						}

						return yield* state.storage.getAlarm();
					}).pipe(Effect.orDie),
				alarms: () =>
					Effect.gen(function* () {
						const fired = Array.from(
							state.raw.storage.sql.exec(
								"SELECT at, mode, instance, retry FROM fired ORDER BY rowid",
							),
						) as unknown as ReadonlyArray<{
							at: number;
							mode: string;
							instance: string;
							retry: number;
						}>;
						const tables = Array.from(
							state.raw.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'"),
						).map((row) => String(row.name));
						return {fired, armed: yield* state.storage.getAlarm(), tables, instance};
					}).pipe(Effect.orDie),
				alarm: (info?: Cloudflare.AlarmInvocationInfo) =>
					Effect.sync(() => {
						const mode = String(
							Array.from(state.raw.storage.sql.exec("SELECT mode FROM mode WHERE id = 1"))[0]?.mode,
						);
						state.raw.storage.sql.exec(
							"INSERT INTO fired (at, mode, instance, retry) VALUES (?, ?, ?, ?)",
							Date.now(),
							mode,
							instance,
							info?.retryCount ?? -1,
						);

						if (mode === "abort" && (info?.retryCount ?? 0) === 0) {
							state.raw.abort("spike abort in alarm");
						}
					}),
			};
		});
	}),
);

// Q4: WebSocket hibernation, a tiny copy of what Gateway does.
const Attached = Schema.Struct({client: Schema.String, n: Schema.Number});

export interface SockShape {
	readonly fetch: Cloudflare.DurableObjectShape["fetch"];
	readonly webSocketMessage: NonNullable<Cloudflare.DurableObjectShape["webSocketMessage"]>;
	readonly webSocketClose: NonNullable<Cloudflare.DurableObjectShape["webSocketClose"]>;
	readonly ring: (tag: string, text: string) => Effect.Effect<number>;
	readonly look: () => Effect.Effect<{
		instance: string;
		sockets: ReadonlyArray<{attachment: unknown; tags: ReadonlyArray<string>}>;
		closed: number;
	}>;
}

export class Sock extends Cloudflare.DurableObject<Sock, SockShape>()("Sock") {}

export const SockLive = Sock.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState;

		return Effect.gen(function* () {
			const instance = crypto.randomUUID();
			let closed = 0;
			return {
				fetch: Effect.gen(function* () {
					const [response, socket] = yield* Cloudflare.upgrade({tags: ["tab-a", "session-1"]});
					yield* state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
					yield* socket.setAttachment(Attached, {client: "c1", n: 0});
					return response;
				}).pipe(Effect.orDie),
				webSocketMessage: (socket, message) =>
					Effect.gen(function* () {
						const attached = yield* socket.getAttachment(Attached);
						const next = {...attached, n: attached.n + 1};
						yield* socket.setAttachment(Attached, next);
						const tags = yield* state.getTags(socket.ws);
						yield* socket.send(
							JSON.stringify({echo: String(message), attached: next, tags, instance}),
						);
					}).pipe(Effect.orDie),
				webSocketClose: () =>
					Effect.sync(() => {
						closed++;
					}),
				ring: (tag: string, text: string) =>
					Effect.gen(function* () {
						const sockets = yield* state.getWebSockets(tag);

						for (const socket of sockets) {
							yield* socket.send(JSON.stringify({ring: text, instance}));
						}

						return sockets.length;
					}),
				look: () =>
					Effect.gen(function* () {
						const sockets = yield* state.getWebSockets();
						return {
							instance,
							closed,
							sockets: yield* Effect.forEach(sockets, (socket) =>
								Effect.map(state.getTags(socket.ws), (tags) => ({
									attachment: socket.deserializeAttachment(),
									tags,
								})),
							),
						};
					}),
			};
		});
	}),
);

// Q5 and Q6: typed calls between two objects, the sibling resolved per call.
export interface PingShape {
	readonly hit: (n: number) => Effect.Effect<{path: ReadonlyArray<string>; n: number}, Boom>;
	readonly leaf: (n: number) => Effect.Effect<{path: ReadonlyArray<string>; n: number}>;
	readonly crossing: () => Effect.Effect<Record<string, unknown>>;
}

export interface PongShape {
	readonly back: (n: number) => Effect.Effect<{path: ReadonlyArray<string>; n: number}, Boom>;
	readonly note: () => Effect.Effect<Note>;
	readonly encoded: () => Effect.Effect<typeof Note.Encoded>;
	readonly crash: () => Effect.Effect<never>;
	readonly nothing: () => Effect.Effect<null>;
	readonly bytes: () => Effect.Effect<Uint8Array>;
	readonly refuse: () => Effect.Effect<never, Boom>;
}

export class Ping extends Cloudflare.DurableObject<Ping, PingShape>()("Ping") {}
export class Pong extends Cloudflare.DurableObject<Pong, PongShape>()("Pong", {errors: [Boom]}) {}

export const PingLive = Ping.make(
	Effect.gen(function* () {
		return Effect.gen(function* () {
			return {
				hit: (n: number) =>
					Effect.gen(function* () {
						const pongs = yield* Pong; // per call
						const answer = yield* pongs.getByName("one").back(n + 1);
						return {path: ["ping.hit", ...answer.path], n: answer.n};
					}),
				leaf: (n: number) => Effect.succeed({path: ["ping.leaf"], n: n + 1}),
				crossing: () =>
					Effect.gen(function* () {
						const pong = (yield* Pong).getByName("one");
						const show = <A, E>(work: Effect.Effect<A, E>, read: (a: A) => unknown) =>
							work.pipe(
								Effect.map(read),
								Effect.catch((error) =>
									Effect.succeed(
										`fail:${String(Reflect.get(Object(error), "_tag"))}:${error instanceof Boom ? "Boom instance" : "not Boom instance"}:${String(Reflect.get(Object(error), "message")).slice(0, 120)}`,
									),
								),
								Effect.catchDefect((defect) => Effect.succeed(`defect:${String(defect)}`)),
							);
						return {
							classInstance: yield* show(pong.note(), (note) => ({
								isNote: note instanceof Note,
								note,
							})),
							encoded: yield* show(pong.encoded(), (raw) => ({
								decodedIsNote: Schema.decodeUnknownSync(Note)(raw) instanceof Note,
								raw,
							})),
							nothing: yield* show(pong.nothing(), (value) => ({isNull: value === null})),
							bytes: yield* show(pong.bytes(), (bytes) => ({
								isBytes: bytes instanceof Uint8Array,
								length: bytes.length,
							})),
							typedFailure: yield* show(pong.refuse(), () => "no error"),
							missingMethod: yield* show(
								(pong as unknown as {nope: () => Effect.Effect<void, unknown>}).nope(),
								() => "no error",
							),
							defect: yield* show(pong.crash(), () => "no error"),
						};
					}),
			};
		});
	}),
);

export const PongLive = Pong.make(
	Effect.gen(function* () {
		return Effect.gen(function* () {
			return {
				back: (n: number) =>
					Effect.gen(function* () {
						const pings = yield* Ping; // per call
						const answer = yield* pings.getByName("two").leaf(n + 1);
						return {path: ["pong.back", ...answer.path], n: answer.n};
					}),
				note: () => Effect.succeed(new Note({text: "hello", n: 1})),
				encoded: () => Effect.succeed(Schema.encodeSync(Note)(new Note({text: "hello", n: 1}))),
				crash: () => Effect.die(new Error("spike defect")),
				nothing: () => Effect.succeed(null),
				bytes: () => Effect.succeed(new Uint8Array([1, 2, 3])),
				refuse: () => Effect.fail(new Boom({reason: "refused"})),
			};
		});
	}),
);
