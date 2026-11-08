import {DatabaseSync} from "node:sqlite";
// P12, next/. The callbacks are real platform duties, not replacement gateway logic.
// The connection must save attachments and release its turn before calling the Project.
import {describe, expect, it} from "@effect/vitest";
import {Deferred, Effect, Fiber, Layer} from "effect";
import * as fc from "fast-check";
import {Doorbell, Ledger, LedgerError, Referee, lineFor} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Answer, Attached} from "../transport/wire.ts";

const SEED = 119120;
type Connection = {
	frame: (text: string) => Effect.Effect<void, unknown>;
	ring: (stream: string, rev: number) => Effect.Effect<void>;
	wake: () => Effect.Effect<void>;
	probe: (session: string) => Effect.Effect<number | null>;
};
const online = () =>
	Attached.cases.online.make({
		client: "gateway/session-1",
		who: {key: "SHA256:test", person: "person-test", as: "window"},
		version: 1,
		waits: [],
		watching: false,
		busy: false,
	});

const setup = Effect.fnUntraced(function* (
	wait: (
		stream: string,
		after: number,
		reader: string,
	) => Effect.Effect<
		{readonly _tag: "ready"; readonly rev: number} | {readonly _tag: "parked"},
		LedgerError
	>,
	call = () => Effect.succeed(Answer.cases.ok.make({result: null})),
) {
	const {connection} = yield* Effect.promise(() => import("../transport/gateway.ts"));
	let saved: typeof Attached.Type = online();
	const frames: Array<Record<string, unknown>> = [];
	const closes: Array<number> = [];
	const c: Connection = connection({
		reader: "gateway/session-1",
		session: "session-1",
		ping: () => 42,
		read: () => saved,
		save: (a: typeof Attached.Type) => {
			saved = a;
		},
		send: (text: string) => {
			frames.push(JSON.parse(text));
		},
		close: (code: number) => {
			closes.push(code);
		},
		wait,
		call,
	});
	return {
		c,
		frames,
		closes,
		saved: () => saved,
		save: (a: typeof Attached.Type) => {
			saved = a;
		},
	};
});
const request = (id: string | number, stream = "counter:1/inbox", after = 0) =>
	JSON.stringify({jsonrpc: "2.0", id, method: "ledger.wait", params: {stream, after}});

describe("P12 Gateway attachment laws", () => {
	it.effect("a failed wait registration answers once and removes the saved request", () =>
		Effect.gen(function* () {
			const f = yield* setup(() => Effect.fail(new LedgerError({why: "unreachable"})));
			// Inspect state even when the event fails, so an escaped failure cannot hide the lost reply.
			yield* Effect.exit(f.c.frame(request("failed")));
			expect.soft(f.frames).toMatchObject([{id: "failed", error: {data: {why: "unreachable"}}}]);
			expect(f.saved()).toMatchObject({waits: []});
			yield* f.c.ring("counter:1/inbox", 1);
			expect(f.frames).toHaveLength(1);
		}),
	);
	it.effect("each saved wait receives the first later revision on its stream", () =>
		Effect.gen(function* () {
			const db = new DatabaseSync(":memory:");
			try {
				const sql = nodeSql(db);
				let ring: Connection["ring"] = () => Effect.void;
				const bell = Layer.succeed(Doorbell, {ring: (_reader, stream, rev) => ring(stream, rev)});
				const layer = Layer.mergeAll(Referee.layer(sql), Ledger.sql(sql, {reader: "writer"})).pipe(
					Layer.provide(bell),
				);
				yield* Effect.gen(function* () {
					const referee = yield* Referee;
					const ledger = yield* Ledger;
					const f = yield* setup(referee.wait);
					ring = f.c.ring;
					yield* f.c.frame(request("early", "facts", 0));
					yield* f.c.frame(request("later", "facts", 100));
					for (let n = 1; n <= 101; n++) {
						yield* ledger.append(
							"facts",
							`fact-${n}`,
							lineFor(
								{
									by: "writer",
									for: "person",
									sentAt: "2026-11-08T00:00:00Z",
									seen: 0,
									parent: null,
									traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
									build: "test",
								},
								{_tag: "noted", n},
							),
						);
					}
					expect(f.frames).toEqual([
						{jsonrpc: "2.0", id: "early", result: {rev: 1}},
						{jsonrpc: "2.0", id: "later", result: {rev: 101}},
					]);
					expect(f.saved()).toMatchObject({waits: []});
				}).pipe(Effect.provide(layer));
			} finally {
				db.close();
			}
		}),
	);
	it.effect("p79 plant: a probe must read the runtime timestamp of its exact live session", () =>
		Effect.gen(function* () {
			const f = yield* setup(() => Effect.succeed({_tag: "parked"} as const));
			expect(yield* f.c.probe("session-1")).toBe(42);
			expect(yield* f.c.probe("old-session")).toBeNull();
			f.save(Attached.cases.new.make({client: "gateway/session-1", nonce: "fresh"}));
			expect(yield* f.c.probe("session-1")).toBeNull();
		}),
	);
	it.effect("a ready wait reply cannot answer a new wait that reused its request id", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const reply = yield* Deferred.make<{readonly _tag: "ready"; readonly rev: number}>();
			const f = yield* setup((stream) =>
				stream === "old"
					? Effect.gen(function* () {
							yield* Deferred.succeed(entered, undefined);
							return yield* Deferred.await(reply);
						})
					: Effect.succeed({_tag: "parked"} as const),
			);
			const first = yield* Effect.forkChild(f.c.frame(request("reused", "old")));
			yield* Deferred.await(entered);
			yield* f.c.ring("old", 1);
			yield* f.c.frame(request("reused", "new"));
			yield* Deferred.succeed(reply, {_tag: "ready", rev: 1} as const);
			yield* Fiber.join(first);
			expect(f.frames).toEqual([{jsonrpc: "2.0", id: "reused", result: {rev: 1}}]);
			expect(f.saved()).toMatchObject({waits: [{id: "reused", stream: "new", after: 0}]});
			yield* f.c.ring("new", 2);
			expect(f.frames).toEqual([
				{jsonrpc: "2.0", id: "reused", result: {rev: 1}},
				{jsonrpc: "2.0", id: "reused", result: {rev: 2}},
			]);
		}),
	);
	it.effect("a ready wait reply is discarded after the connection loses its hello", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const reply = yield* Deferred.make<{readonly _tag: "ready"; readonly rev: number}>();
			const f = yield* setup(() =>
				Effect.gen(function* () {
					yield* Deferred.succeed(entered, undefined);
					return yield* Deferred.await(reply);
				}),
			);
			const pending = yield* Effect.forkChild(f.c.frame(request(1)));
			yield* Deferred.await(entered);
			const fresh = Attached.cases.new.make({client: "gateway/session-1", nonce: "fresh"});
			f.save(fresh);
			yield* Deferred.succeed(reply, {_tag: "ready", rev: 1} as const);
			yield* Fiber.join(pending);
			expect(f.saved()).toEqual(fresh);
			expect(f.frames).toEqual([]);
		}),
	);
	it.effect(
		"wait race plant: save after registration loses a ring; holding the turn deadlocks",
		() =>
			Effect.gen(function* () {
				let ring: (stream: string, rev: number) => Effect.Effect<void> = () => Effect.void;
				let read: () => typeof Attached.Type = () => online();
				const f = yield* setup((stream, after, reader) =>
					Effect.gen(function* () {
						expect(reader).toBe("gateway/session-1");
						expect(read()).toMatchObject({waits: [{id: 1, stream, after}]});
						yield* ring(stream, after + 1); // Reentrant RPC, before registration returns.
						return {_tag: "parked"} as const;
					}),
				);
				ring = f.c.ring;
				read = f.saved;
				yield* f.c.frame(request(1));
				expect(f.frames).toEqual([{jsonrpc: "2.0", id: 1, result: {rev: 1}}]);
				expect(f.saved()).toMatchObject({waits: []});
				yield* f.c.ring("counter:1/inbox", 2);
				expect(f.frames).toHaveLength(1);
			}),
	);
	it.effect("p12/p94 plant: a late ready reply must not restore an already answered wait", () =>
		Effect.gen(function* () {
			const registered = yield* Deferred.make<void>();
			const reply = yield* Deferred.make<{readonly _tag: "ready"; readonly rev: number}>();
			const f = yield* setup(() =>
				Effect.gen(function* () {
					yield* Deferred.succeed(registered, undefined);
					return yield* Deferred.await(reply);
				}),
			);
			const pending = yield* Effect.forkChild(f.c.frame(request("r")));
			yield* Deferred.await(registered);
			yield* f.c.ring("other", 99);
			expect(f.frames).toEqual([]);
			yield* f.c.ring("counter:1/inbox", 4);
			yield* Deferred.succeed(reply, {_tag: "ready", rev: 4} as const);
			yield* Fiber.join(pending);
			expect(f.frames).toEqual([{jsonrpc: "2.0", id: "r", result: {rev: 4}}]);
			expect(f.saved()).toMatchObject({waits: []});
		}),
	);
	it.effect(
		"p12 plant: ready waits answer now; parked waits survive a reconstructed connection",
		() =>
			Effect.gen(function* () {
				const ready = yield* setup(() => Effect.succeed({_tag: "ready", rev: 7} as const));
				yield* ready.c.frame(request(1));
				expect(ready.frames).toEqual([{jsonrpc: "2.0", id: 1, result: {rev: 7}}]);
				expect(ready.saved()).toMatchObject({waits: []});
				const parked = yield* setup(() => Effect.succeed({_tag: "parked"} as const));
				yield* parked.c.frame(request(2));
				const fresh = yield* setup(() => Effect.succeed({_tag: "parked"} as const));
				fresh.save(JSON.parse(JSON.stringify(parked.saved())));
				yield* fresh.c.wake();
				yield* fresh.c.ring("counter:1/inbox", 8);
				expect(fresh.frames).toEqual([{jsonrpc: "2.0", id: 2, result: {rev: 8}}]);
				expect(fresh.saved()).toMatchObject({waits: []});
			}),
	);
	it.effect("attachment plant: enforce 64 waits and the encoded 16384-byte cap", () =>
		Effect.gen(function* () {
			for (const ids of [
				Array.from({length: 65}, (_, n) => String(n)),
				fc.sample(
					fc.array(fc.string({minLength: 1800, maxLength: 2200}), {minLength: 12, maxLength: 12}),
					{seed: SEED, numRuns: 1},
				)[0]!,
			]) {
				const f = yield* setup(() => Effect.succeed({_tag: "parked"} as const));
				for (const id of ids) {
					yield* f.c.frame(request(id));
					expect(new TextEncoder().encode(JSON.stringify(f.saved())).length).toBeLessThanOrEqual(
						16384,
					);
				}
				expect(f.frames.some((frame) => JSON.stringify(frame).includes("too_many_waits"))).toBe(
					true,
				);
				if (ids.length === 65) expect(f.frames).toHaveLength(1);
				const a = f.saved();
				expect(a._tag === "online" && a.waits.length <= 64).toBe(true);
			}
		}),
	);
	it.effect(
		"p15 busy plant: save busy before RPC, keep it until installed, close 1012 on wake",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				let busyRead: () => typeof Attached.Type = () => online();
				const f = yield* setup(
					() => Effect.succeed({_tag: "parked"} as const),
					() =>
						Effect.gen(function* () {
							expect(busyRead()).toMatchObject({busy: true});
							yield* Deferred.succeed(entered, undefined);
							yield* Deferred.await(release);
							return Answer.cases.ok.make({result: {_tag: "accepted", rev: 1, pos: 1}});
						}),
				);
				busyRead = f.saved;
				const pending = yield* Effect.forkChild(
					f.c.frame(
						JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							method: "process.send",
							params: {},
						}),
					),
				);
				yield* Deferred.await(entered);
				const wake = yield* setup(() => Effect.succeed({_tag: "parked"} as const));
				wake.save(JSON.parse(JSON.stringify(f.saved())));
				yield* wake.c.wake();
				expect(wake.closes).toEqual([1012]);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(pending);
				expect(f.saved()).toMatchObject({busy: false});
				expect(f.frames).toHaveLength(1);
			}),
	);
});
