import {Effect, Exit, Fiber, Layer, Ref, Schema, Scope, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {IdSchema} from "../data/id.ts";
import {memorySocket} from "./platform.test-support.ts";
import {p18Suffix} from "./tile.test-support.ts";

const options = {seed: 119120, numRuns: 30};
const WireRequest = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.String,
	method: Schema.String,
	params: Schema.Json,
});
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(WireRequest));
const until = <A, E, R>(
	read: Effect.Effect<A, E, R>,
	done: (a: A) => boolean,
): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		while (true) {
			const a = yield* read;
			if (done(a)) return a;
			yield* Effect.yieldNow;
		}
	});

// Every property uses the actual adapter, with only its transport and ID service supplied.
const fixture = Effect.fn("test.p18.socket")(function* (suffix: string) {
	const {ClientConnection} = yield* Effect.promise(() => import("./connection.ts"));
	const {socketConnection} = yield* Effect.promise(() => import("./socket.ts"));
	const {IdGenerator} = yield* Effect.promise(() => import("../data/id.ts"));
	let serial = 0;
	const identity = Layer.succeed(IdGenerator, {
		next: <K extends string>(schema: IdSchema<K>) =>
			Schema.decodeUnknownEffect(schema)(
				`${schema.prefix}_${suffix.slice(0, -3)}${(++serial).toString(32).padStart(3, "0")}`,
			),
	});
	const wire = yield* memorySocket;
	const connection = yield* ClientConnection.pipe(
		Effect.provide(socketConnection(wire.socket).pipe(Layer.provide(identity))),
	);
	return {wire, connection};
});

describe("P18 Effect socket", () => {
	// Plants: parse pong as JSON, require WebSocket ping frames, or settle the first request.
	it("interleaved text pong, news and out-of-order JSON replies settle only their own operations", async () => {
		await fc.assert(
			fc.asyncProperty(
				p18Suffix,
				fc.shuffledSubarray([0, 1, 2], {minLength: 3, maxLength: 3}),
				fc.integer({min: 1, max: 50}),
				async (suffix, order, dial) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const {wire, connection} = yield* fixture(suffix);
								const events = yield* Ref.make<ReadonlyArray<unknown>>([]);
								const news = yield* Ref.make<ReadonlyArray<unknown>>([]);
								yield* Stream.runForEach(connection.events, (event: unknown) =>
									Ref.update(events, (xs) => [...xs, event]),
								).pipe(Effect.forkScoped);
								yield* Stream.runForEach(connection.news, (event: unknown) =>
									Ref.update(news, (xs) => [...xs, event]),
								).pipe(Effect.forkScoped);
								yield* connection.open(dial);
								const a = yield* connection
									.request("client.inbox", {after: 0})
									.pipe(Effect.forkScoped);
								const b = yield* connection
									.request("process.demonitor", {ref: `monitor_${suffix}`})
									.pipe(Effect.forkScoped);
								const requests = (yield* until(
									wire.writes,
									(xs) => xs.filter((x) => x.startsWith("{")).length === 2,
								))
									.filter((x) => x.startsWith("{"))
									.map((frame) => decodeRequest(frame));
								const first = requests.find((r) => r.method === "client.inbox")!;
								const second = requests.find((r) => r.method === "process.demonitor")!;
								const page = {after: 0, more: false, letters: []};
								const frames = [
									"pong",
									JSON.stringify({
										jsonrpc: "2.0",
										id: second.id,
										result: {ref: `monitor_${suffix}`},
									}),
									JSON.stringify({jsonrpc: "2.0", method: "changed", params: {pid: "counter"}}),
								];
								yield* wire.push(
									JSON.stringify({jsonrpc: "2.0", id: "unknown-request", result: page}),
								);
								for (const i of order) yield* wire.push(frames[i]!);
								yield* Effect.yieldNow;
								expect(a.pollUnsafe()).toBeUndefined();
								yield* wire.push(JSON.stringify({jsonrpc: "2.0", id: first.id, result: page}));
								expect(yield* Fiber.join(a)).toEqual(page);
								expect(yield* Fiber.join(b)).toEqual({ref: `monitor_${suffix}`});
								expect(yield* until(Ref.get(events), (xs) => xs.length >= 2)).toContainEqual({
									_tag: "pong",
									dial,
								});
								expect(yield* until(Ref.get(news), (xs) => xs.length > 0)).toEqual([
									{method: "changed", params: {pid: "counter"}},
								]);
								yield* connection.ping(dial);
								expect(yield* wire.writes).toContain("ping");
							}),
						),
					);
				},
			),
			options,
		);
	});

	// Plant: replace all close codes with 1006. ClientDown has why only; events retain the code.
	it("close events preserve every legal code, fail requests and release the reader", async () => {
		await fc.assert(
			fc.asyncProperty(
				p18Suffix,
				fc.oneof(fc.constantFrom(1000, 1001, 4003), fc.integer({min: 3000, max: 4999})),
				fc.integer({min: 1, max: 50}),
				fc.integer({min: 1, max: 4}),
				async (suffix, code, dial, count) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const {wire, connection} = yield* fixture(suffix);
								const events = yield* Ref.make<ReadonlyArray<unknown>>([]);
								yield* Stream.runForEach(connection.events, (event: unknown) =>
									Ref.update(events, (xs) => [...xs, event]),
								).pipe(Effect.forkScoped);
								yield* connection.open(dial);
								const pending = yield* Effect.forEach(
									Array.from({length: count}),
									() =>
										connection
											.request("client.inbox", {after: 0})
											.pipe(Effect.exit, Effect.forkScoped),
									{concurrency: 1},
								);
								yield* until(wire.writes, (xs) => xs.length >= count);
								yield* wire.end(code);
								for (const fiber of pending)
									expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true);
								expect(
									yield* until(Ref.get(events), (xs) =>
										xs.some((e) => typeof e === "object" && e !== null && "code" in e),
									),
								).toContainEqual({_tag: "closed", dial, code});
								yield* connection.close;
								expect(yield* wire.activeReaders).toBe(0);
							}),
						),
					);
				},
			),
			options,
		);
	});

	// Plant: send 4003 through the retryable-close branch.
	it("4003 removes the link and later timer or close messages never redial", async () => {
		const {Link, stepLink} = await import("../transport/link.ts");
		fc.assert(
			fc.property(fc.nat({max: 100}), fc.nat(), (dial, at) => {
				const [removed, actions] = stepLink(
					Link.cases.online.make({dial, version: 1, ping: 30_000, beat: 0}),
					{type: "closed", dial, code: 4003, at},
				);
				expect(removed._tag).toBe("removed");
				expect(actions.filter((a: {_tag: string}) => a._tag === "dial")).toEqual([]);
				const [later, work] = stepLink(removed, {type: "timer", dial, beat: 0, at: at + 60_000});
				expect(later).toEqual(removed);
				expect(work).toEqual([]);
			}),
			options,
		);
	});

	// Plants: acquire two readers, close the current dial in an old finalizer, queue offline writes.
	it("one reader per dial; delayed old scope close cannot close a newer dial or leak detached writes", async () => {
		await fc.assert(
			fc.asyncProperty(
				p18Suffix,
				fc.integer({min: 1, max: 100}),
				fc.boolean(),
				async (suffix, dial, closeOldLate) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const {wire, connection} = yield* fixture(suffix);
								const old = yield* Scope.make();
								yield* connection.open(dial).pipe(Scope.provide(old));
								expect(yield* wire.activeReaders).toBe(1);
								yield* connection.open(dial).pipe(Scope.provide(old));
								expect(yield* wire.activeReaders).toBe(1);
								yield* connection.close;
								const failed = yield* Effect.result(connection.request("client.inbox", {after: 0}));
								expect(failed).toMatchObject({_tag: "Failure", failure: {why: "closed"}});
								if (!closeOldLate) yield* Scope.close(old, Exit.void);
								const fresh = yield* Scope.make();
								yield* connection.open(dial + 1).pipe(Scope.provide(fresh));
								if (closeOldLate) yield* Scope.close(old, Exit.void);
								expect(yield* wire.activeReaders).toBe(1);
								expect(yield* wire.writes).toEqual([]);
								yield* connection.ping(dial + 1);
								expect(yield* wire.writes).toEqual(["ping"]);
								yield* Scope.close(fresh, Exit.void);
								expect(yield* wire.activeReaders).toBe(0);
							}),
						),
					);
				},
			),
			options,
		);
	});

	// Plants: retain the reader or leave one request unresolved after closing its acquisition.
	it("scope closure releases a blocked pull and every outstanding request", async () => {
		await fc.assert(
			fc.asyncProperty(p18Suffix, fc.integer({min: 1, max: 5}), async (suffix, count) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const {wire, connection} = yield* fixture(suffix);
							const scope = yield* Scope.make();
							yield* connection.open(1).pipe(Scope.provide(scope));
							const pending = yield* Effect.forEach(
								Array.from({length: count}),
								() =>
									connection
										.request("client.inbox", {after: 0})
										.pipe(Effect.exit, Effect.forkScoped),
								{concurrency: 1},
							);
							yield* until(wire.writes, (xs) => xs.length === count);
							yield* Scope.close(scope, Exit.void);
							for (const fiber of pending)
								expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true);
							expect(yield* wire.activeReaders).toBe(0);
						}),
					),
				);
			}),
			options,
		);
	});

	it("transport support itself releases blocked pulls and keeps new acquisitions alive", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1000, max: 4999}), async (code) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const wire = yield* memorySocket;
							const old = yield* Scope.make();
							const reader = yield* wire.socket.reader.pipe(Scope.provide(old));
							const blocked = yield* reader.pull.pipe(Effect.exit, Effect.forkScoped);
							const fresh = yield* wire.socket.reader;
							yield* Scope.close(old, Exit.void);
							expect(Exit.isFailure(yield* Fiber.join(blocked))).toBe(true);
							yield* wire.push("pong");
							expect(yield* fresh.pull).toEqual(["pong"]);
							yield* wire.end(code);
							expect(yield* Effect.result(fresh.pull)).toMatchObject({
								_tag: "Failure",
								failure: {reason: {code}},
							});
						}),
					),
				);
			}),
			options,
		);
	});
});
