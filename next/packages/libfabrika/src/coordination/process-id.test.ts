// P10/P33 shared generator contract. ProcessIdGenerator.layer owns monotonic state; next is an
// Effect<ProcessId>. The schema stays in data/trace.ts. RFC 9562 §5.7, TypeID's base32 encoding.
// Plants: UUIDv4 in a TypeID wrapper; random ids in one ms; wall-clock rollback; a constant id.
import {describe, expect, it, vi} from "@effect/vitest";
import {Clock, Effect, Exit, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {ProcessId} from "../data/trace.ts";
import * as Coordination from "./index.ts";

const decode = (id: string): Uint8Array => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	const value = [...id.slice(8)].reduce((n, c) => (n << 5n) | BigInt(alphabet.indexOf(c)), 0n);
	return Uint8Array.from({length: 16}, (_, i) => Number((value >> BigInt((15 - i) * 8)) & 255n));
};
// Keep the test clock in each generated run; each sample builds a new generator layer.
const check = <A, E, R>(
	arb: fc.Arbitrary<A>,
	examples: NoInfer<A>[],
	law: (a: A) => Effect.Effect<void, E, R>,
) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<R>();
		yield* Effect.promise(() =>
			fc.assert(
				fc.asyncProperty(arb, (a) =>
					Effect.runPromise(law(a).pipe(Effect.provideContext(context))),
				),
				{
					seed: 119120,
					numRuns: 50,
					includeErrorInReport: true,
					examples: examples.map((a): [A] => [a]),
				},
			),
		);
	});
const time = fc.integer({min: 0, max: 2 ** 48 - 1024});
describe("P10 shared process ids", () => {
	it.effect("monotonic: exhausted random bits advance the clock before the next id", () =>
		check(time, [1_790_000_000_000], (at) =>
			Effect.gen(function* () {
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(255);
					return array;
				});
				try {
					yield* TestClock.setTime(at);
					const gen = yield* Coordination.ProcessIdGenerator;
					const before = yield* gen.next;
					const after = yield* gen.next;
					expect(after > before).toBe(true);
					expect([...decode(after).slice(0, 6)].reduce((n, b) => n * 256 + b, 0)).toBe(at + 1);
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		),
	);
	it.effect("shape: a clock before the UUID epoch cannot produce a process id", () =>
		check(fc.integer({min: -Number.MAX_SAFE_INTEGER, max: -1}), [-1], (at) =>
			Effect.gen(function* () {
				yield* TestClock.setTime(at);
				const gen = yield* Coordination.ProcessIdGenerator;
				expect(Exit.isFailure(yield* Effect.exit(gen.next))).toBe(true);
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		),
	);
	it.effect("shape: a canonical TypeID containing UUIDv7, not a UUIDv4 plant", () =>
		check(
			fc.tuple(time, fc.integer({min: 1, max: 128})),
			[[1_790_000_000_000, 64]],
			([at, count]) =>
				Effect.gen(function* () {
					yield* TestClock.setTime(at);
					const gen = yield* Coordination.ProcessIdGenerator;
					const ids = yield* Effect.forEach(Array.from({length: count}), () => gen.next, {
						concurrency: 1,
					});
					expect([...decode(ids[0]!).slice(0, 6)].reduce((n, b) => n * 256 + b, 0)).toBe(at);
					for (const id of ids) {
						expect(Schema.is(ProcessId)(id)).toBe(true);
						const bytes = decode(id);
						expect(bytes[6]! >>> 4).toBe(7);
						expect(bytes[8]! >>> 6).toBe(2);
						const timestamp = [...bytes.slice(0, 6)].reduce((n, b) => n * 256 + b, 0);
						expect(timestamp).toBeGreaterThanOrEqual(at);
					}
				}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		),
	);
	it.effect("monotonic: same-millisecond calls never repeat or sort backward", () =>
		check(
			fc.tuple(time, fc.integer({min: 2, max: 1024})),
			[[1_790_000_000_000, 512]],
			([at, count]) =>
				Effect.gen(function* () {
					yield* TestClock.setTime(at);
					const gen = yield* Coordination.ProcessIdGenerator;
					const ids = yield* Effect.forEach(Array.from({length: count}), () => gen.next, {
						concurrency: 1,
					});
					expect(new Set(ids).size).toBe(ids.length);
					for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
				}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		),
	);
	it.effect("monotonic: a clock rollback cannot reuse or lower an id", () =>
		check(
			fc.tuple(time, fc.nat({max: 1_000_000_000})),
			[[1_790_000_000_000, 1_000_000]],
			([at, rollback]) =>
				Effect.gen(function* () {
					const gen = yield* Coordination.ProcessIdGenerator;
					yield* TestClock.setTime(at);
					const before = yield* gen.next;
					yield* TestClock.setTime(at - rollback);
					expect(yield* Clock.currentTimeMillis).toBe(at - rollback);
					const after = yield* gen.next;
					expect(after > before).toBe(true);
				}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		),
	);
});
