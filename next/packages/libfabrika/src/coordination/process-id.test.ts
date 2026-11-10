// Next/, P10/P33 shared process generator contract, retained by T518 PR 1.
// ProcessIdGenerator.layer owns one writer's state; next remains an Effect<ProcessId>.
import {describe, expect, it, vi} from "@effect/vitest";
import {Cause, Clock, Effect, Exit, Option, Schema, Tracer} from "effect";
import {TestClock} from "effect/testing";
import {ProcessId} from "../data/trace.ts";
import {processClocks} from "../id.test-support.ts";
import * as Id from "../id.ts";
import * as Coordination from "./index.ts";

const maxClock = 2 ** 48 - 1;
const Time = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: maxClock - 10_000}));
const Count = Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 512}));
const Calls = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 16}));
const Many = Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 1024}));

const BeforeEpoch = Schema.Int.check(
	Schema.isBetween({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
);

const Rollback = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 1_000_000_000}));
const options = {arbitrary: {seed: 119120, runs: 40}};

const decode = (id: string): Uint8Array => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	const value = [...id.slice(8)].reduce((n, c) => (n << 5n) | BigInt(alphabet.indexOf(c)), 0n);
	return Uint8Array.from({length: 16}, (_, i) => Number((value >> BigInt((15 - i) * 8)) & 255n));
};

const timestamp = (id: string): number =>
	[...decode(id).slice(0, 6)].reduce((n, b) => n * 256 + b, 0);

describe("P10 shared process ids", () => {
	it.effect.prop(
		"next records process.next with an inner id.next span on generated clocks",
		{at: processClocks},
		({at}) => {
			const spans: Array<Tracer.NativeSpan> = [];
			const tracer = Tracer.make({
				span: (options) => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			return Effect.gen(function* () {
				yield* TestClock.setTime(at);
				const generator = yield* Coordination.ProcessIdGenerator;
				yield* generator.next;
				const process = spans.filter((span) => span.name === "process.next");
				const id = spans.filter((span) => span.name === "id.next");
				expect(process).toHaveLength(1);
				expect(id).toHaveLength(1);
				expect(process[0]!.status._tag).toBe("Ended");
				expect(id[0]!.status._tag).toBe("Ended");
				expect(id[0]!.parent).toEqual(Option.some(process[0]!));
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer), Effect.withTracer(tracer));
		},
		options,
	);
	// T287 mutation: renaming process.next to an empty string lost the operation in traces.
	it.effect.prop(
		"every generated process id ends its own process.next span",
		{at: Time, count: Calls},
		({at, count}) => {
			const spans: Array<Tracer.NativeSpan> = [];
			const tracer = Tracer.make({
				span: (settings) => {
					const span = new Tracer.NativeSpan(settings);
					spans.push(span);
					return span;
				},
			});
			return Effect.gen(function* () {
				yield* TestClock.setTime(at);
				const generator = yield* Coordination.ProcessIdGenerator;

				for (let i = 0; i < count; i++) {
					yield* generator.next;
				}

				const operations = spans.filter((span) => span.name === "process.next");
				expect(operations).toHaveLength(count);
				expect(new Set(operations.map((span) => span.spanId)).size).toBe(count);

				for (const span of operations) {
					expect(span.status._tag).toBe("Ended");
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer), Effect.withTracer(tracer));
		},
		options,
	);
	it.effect.prop(
		"monotonic: exhausted random bits advance the clock before the next id",
		{at: Time},
		({at}) =>
			Effect.gen(function* () {
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) {
						array.fill(255);
					}

					return array;
				});

				try {
					yield* TestClock.setTime(at);
					const gen = yield* Coordination.ProcessIdGenerator;
					const before = yield* gen.next;
					const after = yield* gen.next;
					expect(after > before).toBe(true);
					expect(timestamp(before)).toBe(at);
					expect(timestamp(after)).toBe(at + 1);
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		options,
	);
	it.effect.prop(
		"shape: a clock before the UUID epoch cannot produce a process id",
		{distance: BeforeEpoch},
		({distance}) =>
			Effect.gen(function* () {
				yield* TestClock.setTime(-distance);
				const gen = yield* Coordination.ProcessIdGenerator;
				const exit = yield* Effect.exit(gen.next);
				expect(Exit.isFailure(exit)).toBe(true);

				if (Exit.isFailure(exit)) {
					expect(exit.cause.reasons.length).toBeGreaterThan(0);

					for (const reason of exit.cause.reasons) {
						expect(Cause.isDieReason(reason)).toBe(true);

						if (Cause.isDieReason(reason)) {
							expect(reason.defect).toMatchObject({_tag: "IdError", why: "clock"});
						}
					}
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		options,
	);
	it.effect.prop(
		"shape: both process schemas decode UUIDv7 ids with the controlled clock",
		{at: Time, count: Count},
		({at, count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("process");
				yield* TestClock.setTime(at);
				const gen = yield* Coordination.ProcessIdGenerator;
				const ids = yield* Effect.forEach(Array.from({length: count}), () => gen.next, {
					concurrency: 1,
				});
				expect(timestamp(ids[0]!)).toBe(at);

				for (const id of ids) {
					expect(Schema.is(ProcessId)(id)).toBe(true);
					expect(Schema.decodeUnknownSync(ProcessId)(id)).toBe(id);
					expect(Schema.decodeUnknownSync(Specific)(id)).toBe(id);
					expect(id).toMatch(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
					const bytes = decode(id);
					expect(bytes[6]! >>> 4).toBe(7);
					expect(bytes[8]! >>> 6).toBe(2);
					expect(timestamp(id)).toBeGreaterThanOrEqual(at);
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		options,
	);
	it.effect.prop(
		"monotonic: same-millisecond calls never repeat or sort backward",
		{at: Time, count: Many},
		({at, count}) =>
			Effect.gen(function* () {
				yield* TestClock.setTime(at);
				const gen = yield* Coordination.ProcessIdGenerator;
				const ids = yield* Effect.forEach(Array.from({length: count}), () => gen.next, {
					concurrency: 1,
				});
				expect(new Set(ids).size).toBe(ids.length);

				for (let i = 1; i < ids.length; i++) {
					expect(ids[i]! > ids[i - 1]!).toBe(true);
				}
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		options,
	);
	it.effect.prop(
		"monotonic: a clock rollback cannot reuse or lower an id",
		{at: Time, rollback: Rollback},
		({at, rollback}) =>
			Effect.gen(function* () {
				// Time stops 10,000 ms below the 48-bit limit, so the clock always moves back at least 1 ms.
				const now = Math.min(at + rollback, maxClock);
				const gen = yield* Coordination.ProcessIdGenerator;
				yield* TestClock.setTime(now);
				const before = yield* gen.next;
				yield* TestClock.setTime(at);
				expect(yield* Clock.currentTimeMillis).toBe(at);
				const after = yield* gen.next;
				expect(after > before).toBe(true);
			}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer)),
		options,
	);

	for (const why of ["clock", "entropy", "exhausted"] as const) {
		it.effect.prop(
			`next dies on IdError ${why} and keeps process.next around id.next`,
			{at: Time, distance: Count, marker: Schema.String},
			({at, distance, marker}) => {
				const spans: Array<Tracer.NativeSpan> = [];
				const tracer = Tracer.make({
					span: (settings) => {
						const span = new Tracer.NativeSpan(settings);
						spans.push(span);
						return span;
					},
				});
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (why === "entropy") {
						throw new Error(marker);
					}

					if (array instanceof Uint8Array) {
						array.fill(255);
					}

					return array;
				});
				return Effect.gen(function* () {
					try {
						yield* TestClock.setTime(
							why === "clock" ? -distance : why === "exhausted" ? maxClock : at,
						);
						const generator = yield* Coordination.ProcessIdGenerator;

						if (why === "exhausted") {
							yield* generator.next;
						}

						const exit = yield* Effect.exit(generator.next);
						expect(Exit.isFailure(exit)).toBe(true);

						if (Exit.isFailure(exit)) {
							expect(exit.cause.reasons).toHaveLength(1);
							const reason = exit.cause.reasons[0]!;
							expect(Cause.isDieReason(reason)).toBe(true);

							if (Cause.isDieReason(reason)) {
								expect(reason.defect).toMatchObject({_tag: "IdError", why});
							}
						}

						const process = spans.filter((span) => span.name === "process.next").at(-1)!;
						const id = spans.filter((span) => span.name === "id.next").at(-1)!;
						expect(id.parent).toEqual(Option.some(process));

						for (const span of [process, id]) {
							expect(span.status._tag).toBe("Ended");

							if (span.status._tag === "Ended") {
								expect(Exit.isFailure(span.status.exit)).toBe(true);
							}
						}
					} finally {
						random.mockRestore();
					}
				}).pipe(Effect.provide(Coordination.ProcessIdGenerator.layer), Effect.withTracer(tracer));
			},
			options,
		);
	}
});
