// P10/P33 shared generator contract. ProcessIdGenerator.layer owns monotonic state; next is an
// Effect<ProcessId>. The schema stays in data/trace.ts. RFC 9562 §5.7, TypeID's base32 encoding.
// Plants: UUIDv4 in a TypeID wrapper; random ids in one ms; wall-clock rollback; a constant id.
import {describe, expect, it} from "@effect/vitest";
import {Clock, Effect, Schema} from "effect";
import {TestClock} from "effect/testing";
import {ProcessId} from "../data/trace.ts";
import * as Coordination from "./index.ts";

const decode = (id: string): Uint8Array => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	const value = [...id.slice(8)].reduce((n, c) => (n << 5n) | BigInt(alphabet.indexOf(c)), 0n);
	return Uint8Array.from({length: 16}, (_, i) => Number((value >> BigInt((15 - i) * 8)) & 255n));
};
describe("P10 shared process ids", () => {
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
