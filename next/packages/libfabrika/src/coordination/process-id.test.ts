// P10/P33 shared generator contract. ProcessIdGenerator.layer owns monotonic state; next is an
// Effect<ProcessId>. The schema stays in data/trace.ts. RFC 9562 §5.7, TypeID's base32 encoding.
// Plants: UUIDv4 in a TypeID wrapper; random ids in one ms; wall-clock rollback; a constant id.
import {describe, expect, it, vi} from "@effect/vitest";
import {Clock, Effect, Exit, Schema, Tracer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {ProcessId} from "../data/trace.ts";
import * as Coordination from "./index.ts";

const decode = (id: string): Uint8Array => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	const value = [...id.slice(8)].reduce((n, c) => (n << 5n) | BigInt(alphabet.indexOf(c)), 0n);
	return Uint8Array.from({length: 16}, (_, i) => Number((value >> BigInt((15 - i) * 8)) & 255n));
};
describe("P10 shared process ids", () => {
	// T287 mutation: renaming process.next to an empty string lost the operation in traces.
	it("every generated process id ends its own process.next span", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 16}), async (count) => {
				const spans: Array<Tracer.NativeSpan> = [];
				const tracer = Tracer.make({
					span(options) {
						const span = new Tracer.NativeSpan(options);
						spans.push(span);
						return span;
					},
				});
				await Effect.runPromise(
					Effect.gen(function* () {
						const generator = yield* Coordination.ProcessIdGenerator;
						yield* Effect.forEach(Array.from({length: count}), () => generator.next, {
							concurrency: 1,
						});
					}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer), Effect.withTracer(tracer)),
				);
				const operations = spans.filter((span) => span.name === "process.next");
				expect(operations).toHaveLength(count);
				expect(new Set(operations.map((span) => span.spanId)).size).toBe(count);
				for (const span of operations) expect(span.status._tag).toBe("Ended");
			}),
			{seed: 119120, numRuns: 25, endOnFailure: true},
		);
	});
	it.effect("monotonic: exhausted random bits advance the clock before the next id", () =>
		Effect.gen(function* () {
			const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
				if (array instanceof Uint8Array) array.fill(255);
				return array;
			});
			try {
				yield* TestClock.setTime(1_790_000_000_000);
				const gen = yield* Coordination.ProcessIdGenerator;
				const before = yield* gen.next;
				const after = yield* gen.next;
				expect(after > before).toBe(true);
				expect([...decode(after).slice(0, 6)].reduce((n, b) => n * 256 + b, 0)).toBe(
					1_790_000_000_001,
				);
			} finally {
				random.mockRestore();
			}
		}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
	);
	it.effect("shape: a clock before the UUID epoch cannot produce a process id", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(-1);
			const gen = yield* Coordination.ProcessIdGenerator;
			expect(Exit.isFailure(yield* Effect.exit(gen.next))).toBe(true);
		}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
	);
	it.effect("shape: a canonical TypeID containing UUIDv7, not a UUIDv4 plant", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_790_000_000_000);
			const gen = yield* Coordination.ProcessIdGenerator;
			const ids = yield* Effect.forEach(Array.from({length: 64}), () => gen.next, {concurrency: 1});
			expect([...decode(ids[0]!).slice(0, 6)].reduce((n, b) => n * 256 + b, 0)).toBe(
				1_790_000_000_000,
			);
			for (const id of ids) {
				expect(Schema.is(ProcessId)(id)).toBe(true);
				const bytes = decode(id);
				expect(bytes[6]! >>> 4).toBe(7);
				expect(bytes[8]! >>> 6).toBe(2);
				const timestamp = [...bytes.slice(0, 6)].reduce((n, b) => n * 256 + b, 0);
				expect(timestamp).toBeGreaterThanOrEqual(1_790_000_000_000);
			}
		}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
	);
	it.effect("monotonic: same-millisecond calls never repeat or sort backward", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_790_000_000_000);
			const gen = yield* Coordination.ProcessIdGenerator;
			const ids = yield* Effect.forEach(Array.from({length: 512}), () => gen.next, {
				concurrency: 1,
			});
			expect(new Set(ids).size).toBe(ids.length);
			for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
		}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
	);
	it.effect("monotonic: a clock rollback cannot reuse or lower an id", () =>
		Effect.gen(function* () {
			const gen = yield* Coordination.ProcessIdGenerator;
			yield* TestClock.setTime(1_790_000_000_000);
			const before = yield* gen.next;
			yield* TestClock.setTime(1_789_999_000_000);
			expect(yield* Clock.currentTimeMillis).toBe(1_789_999_000_000);
			const after = yield* gen.next;
			expect(after > before).toBe(true);
		}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
	);
});
