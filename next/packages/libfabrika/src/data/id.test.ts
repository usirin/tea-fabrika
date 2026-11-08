// P17a, next/. TypeID spec 0.3.0, with the project's stricter UUIDv7 decoding rule.
// https://github.com/jetify-com/typeid/blob/main/spec/README.md
import {beforeEach, describe, expect, expectTypeOf, it, vi} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {ProcessIdGenerator} from "../coordination/process-id.ts";

let ids: typeof import("./id.ts");
beforeEach(async () => {
	ids = await vi.importActual<typeof ids>("./id.ts");
});
const checks = {seed: 119120, numRuns: 60};
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const letters = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz");
const prefix = fc.oneof(
	letters,
	fc
		.tuple(
			letters,
			fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_"), {maxLength: 61}),
			letters,
		)
		.map(([a, middle, z]) => a + middle.join("") + z),
);
const bytes = fc.uint8Array({minLength: 16, maxLength: 16});
const v7 = (raw: Uint8Array) => {
	const copy = raw.slice();
	copy[6] = (copy[6]! & 15) | 112;
	copy[8] = (copy[8]! & 63) | 128;
	return copy;
};
// Independent bit conversion, not the generator's encoder.
const suffix = (raw: Uint8Array) => {
	const bits = `00${  [...raw].map((n) => n.toString(2).padStart(8, "0")).join("")}`;
	return Array.from(
		{length: 26},
		(_, i) => alphabet[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)],
	).join("");
};
const unpack = (id: string) => {
	const text = id.slice(id.lastIndexOf("_") + 1);
	const bits = [...text]
		.map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
		.join("")
		.slice(2);
	return Uint8Array.from({length: 16}, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2));
};
const timestamp = (id: string) =>
	[...unpack(id).slice(0, 6)].reduce((n, byte) => n * 256 + byte, 0);

// Type row. These checks bind to the real declarations, without running a constructor at collection.
const brands = (
	input: import("./id.ts").IdValue<"input">,
	chaos: import("./id.ts").IdValue<"chaos">,
	raw: string,
) => {
	expectTypeOf(input).not.toEqualTypeOf<string>();
	expectTypeOf(input).not.toEqualTypeOf(chaos);
	// @ts-expect-error an input id cannot stand for a chaos experiment
	const wrong: typeof chaos = input;
	// @ts-expect-error an outside string is not a checked input id
	const unchecked: typeof input = raw;
	const Input = ids.Id.make("input"),
		Chaos = ids.Id.make("chaos");
	expectTypeOf<typeof Input.Type>().toEqualTypeOf<typeof input>();
	expectTypeOf<typeof Chaos.Type>().toEqualTypeOf<typeof chaos>();
	return [wrong, unchecked];
};
void brands;

describe("P17a, one valid typed identity", () => {
	it("decodes generated UUIDv7 bytes exactly; rejects other prefixes, versions and variants", async () => {
		await fc.assert(
			fc.asyncProperty(prefix, bytes, async (p, raw) => {
				const schema = yieldSchema(p);
				const valid = v7(raw),
					text = `${p}_${suffix(valid)}`;
				expect(await Effect.runPromise(Schema.decodeUnknownEffect(schema)(text))).toBe(text);
				expect(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(text))).toBe(text);
				const Input = ids.Id.make("input"),
					Chaos = ids.Id.make("chaos");
				expect(Schema.is(Input)(`input_${suffix(valid)}`)).toBe(true);
				expect(Schema.is(Chaos)(`input_${suffix(valid)}`)).toBe(false);
				expect(Schema.is(schema)(`${p}x_${suffix(valid)}`)).toBe(false);
				for (const version of Array.from({length: 16}, (_, n) => n).filter((n) => n !== 7)) {
					const bad = valid.slice();
					bad[6] = (bad[6]! & 15) | (version << 4);
					expect(Result.isFailure(Schema.decodeUnknownResult(schema)(`${p}_${suffix(bad)}`))).toBe(
						true,
					);
				}
				for (const variant of [0, 1, 3]) {
					const bad = valid.slice();
					bad[8] = (bad[8]! & 63) | (variant << 6);
					expect(Result.isFailure(Schema.decodeUnknownResult(schema)(`${p}_${suffix(bad)}`))).toBe(
						true,
					);
				}
			}),
			checks,
		);
	});
	it("rejects base32 mutations, overflow, nonstrings and count-derived input ids", () => {
		fc.assert(
			fc.property(
				bytes,
				fc.integer({min: 0, max: 25}),
				fc.constantFrom("i", "l", "o", "u", "A", "-", "_"),
				fc.integer({min: 1}),
				(raw, at, mutation, count) => {
					const Input = ids.Id.make("input"),
						s = suffix(v7(raw));
					for (const bad of [
						`input_${s.slice(0, at)}${mutation}${s.slice(at + 1)}`,
						`input_8${s.slice(1)}`,
						`input_${s.slice(1)}`,
						`input_${s}0`,
						`in-process_${s}-${count}`,
						`input_${count}`,
						null,
						count,
						{id: `input_${s}`},
					])
						expect(Result.isFailure(Schema.decodeUnknownResult(Input)(bad))).toBe(true);
				},
			),
			checks,
		);
	});
	it("outside prefixes get typed errors, while code declarations may throw", async () => {
		await fc.assert(
			fc.asyncProperty(prefix, fc.integer({min: 64, max: 90}), async (p, length) => {
				const valid = await Effect.runPromise(ids.Id.makeEffect(p));
				expect(Schema.is(valid)(`${p}_${suffix(v7(new Uint8Array(16)))}`)).toBe(true);
				for (const bad of [
					p.toUpperCase(),
					`_${p}`,
					`${p}_`,
					`${p}1`,
					`${p}-x`,
					"a".repeat(length),
					`input_${suffix(v7(new Uint8Array(16)))}`,
				]) {
					const error = await Effect.runPromise(Effect.flip(ids.Id.makeEffect(bad)));
					expect(error).toMatchObject({_tag: "IdError", why: "prefix"});
					expect(() => ids.Id.make(bad)).toThrow();
				}
			}),
			checks,
		);
	});
	it("keeps unique, increasing UUIDv7 ids over equal clocks and rollback; process ids share the format", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 10_000, max: 2 ** 46}),
				fc.array(fc.integer({min: -1000, max: 1000}), {minLength: 1, maxLength: 12}),
				bytes,
				async (at, changes, raw) => {
					const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
						if (array instanceof Uint8Array)
							array.forEach((_, i) => {
								array[i] = raw[i % raw.length]!;
							});
						return array;
					});
					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const gen = yield* ids.IdGenerator,
									Input = ids.Id.make("input"),
									Chaos = ids.Id.make("chaos");
								const made: string[] = [];
								let highest = at;
								for (const now of [at, at, at - 1, ...changes.map((n) => at + n)]) {
									yield* TestClock.setTime(now);
									highest = Math.max(now, highest);
									const input = yield* gen.next(Input),
										chaos = yield* gen.next(Chaos);
									if (made.length === 0) {
										const expected =
											Array.from({length: 10}, (_, i) => raw[i]!).reduce(
												(n, byte) => (n << 8n) | BigInt(byte),
												0n,
											) &
											((1n << 74n) - 1n);
										const uuid = [...unpack(input)].reduce(
											(n, byte) => (n << 8n) | BigInt(byte),
											0n,
										);
										const actual = (((uuid >> 64n) & 4095n) << 62n) | (uuid & ((1n << 62n) - 1n));
										expect(actual, "fresh identity uses the supplied entropy, not a count").toBe(
											expected,
										);
									}
									expect(Schema.is(Input)(input)).toBe(true);
									expect(Schema.is(Chaos)(chaos)).toBe(true);
									expect(timestamp(input)).toBeGreaterThanOrEqual(highest);
									expect(unpack(input)[6]! >>> 4).toBe(7);
									expect(unpack(input)[8]! >>> 6).toBe(2);
									made.push(input.slice(6));
								}
								expect(made).toEqual([...new Set(made)].sort());
								const process = yield* ProcessIdGenerator.use((g) => g.next);
								expect(process).toMatch(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
								expect(unpack(process)[6]! >>> 4).toBe(7);
								expect(unpack(process)[8]! >>> 6).toBe(2);
							}).pipe(
								Effect.provide(ProcessIdGenerator.layer),
								Effect.provide(ids.IdGenerator.layer),
								Effect.provide(TestClock.layer()),
							),
						);
					} finally {
						entropy.mockRestore();
					}
				},
			),
			{...checks, numRuns: 30},
		);
	});
	it("bad clocks and failed entropy are typed IdErrors, never defects", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(
					fc.integer({max: -1}),
					fc.integer({min: 2 ** 48, max: Number.MAX_SAFE_INTEGER}),
					fc.constantFrom(Number.NaN, Infinity, 0.5),
				),
				fc.string({minLength: 1, maxLength: 20}),
				async (at, marker) => {
					const run = (time: number) =>
						Effect.gen(function* () {
							yield* TestClock.setTime(time);
							return yield* ids.IdGenerator.use((g) => g.next(ids.Id.make("input")));
						}).pipe(Effect.provide(ids.IdGenerator.layer), Effect.provide(TestClock.layer()));
					expect(await Effect.runPromise(Effect.flip(run(at)))).toMatchObject({
						_tag: "IdError",
						why: "clock",
					});
					const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
						throw new Error(marker);
					});
					try {
						expect(await Effect.runPromise(Effect.flip(run(1000)))).toMatchObject({
							_tag: "IdError",
							why: "entropy",
						});
					} finally {
						entropy.mockRestore();
					}
				},
			),
			{...checks, numRuns: 20},
		);
	});
	it("random overflow advances the logical clock; its final millisecond refuses exhaustion", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 2 ** 48 - 2}), async (at) => {
				const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(255);
					return array;
				});
				const run = (now: number) =>
					Effect.gen(function* () {
						yield* TestClock.setTime(now);
						const gen = yield* ids.IdGenerator,
							Input = ids.Id.make("input");
						const first = yield* gen.next(Input);
						return {first, second: yield* Effect.result(gen.next(Input))};
					}).pipe(Effect.provide(ids.IdGenerator.layer), Effect.provide(TestClock.layer()));
				try {
					const ordinary = await Effect.runPromise(run(at));
					expect(Result.isSuccess(ordinary.second)).toBe(true);
					if (Result.isFailure(ordinary.second)) throw ordinary.second.failure;
					expect(timestamp(ordinary.second.success)).toBe(at + 1);
					const last = await Effect.runPromise(run(2 ** 48 - 1));
					expect(Result.isFailure(last.second)).toBe(true);
					if (Result.isSuccess(last.second)) throw new Error("exhausted generator minted an id");
					expect(last.second.failure).toMatchObject({_tag: "IdError", why: "exhausted"});
				} finally {
					entropy.mockRestore();
				}
			}),
			{...checks, numRuns: 20},
		);
	});
});

// Prefix text is outside data; schema creation must use the typed path here too.
const yieldSchema = (p: string) => {
	const result = Effect.runSync(Effect.result(ids.Id.makeEffect(p)));
	if (Result.isFailure(result)) throw result.failure;
	return result.success;
};
