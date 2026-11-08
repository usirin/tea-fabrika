// T518, PR 1, next/: TypeID format, Effect failures, writer state, and the public Id export.
// TypeID 0.3.0: https://github.com/jetify-com/typeid/tree/main/spec
// Fabrika deliberately requires UUIDv7 on decode too; the spec permits other versions on decode.
import {describe, expect, it, vi} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {Cause, Clock, Effect, Exit, Schema, SchemaIssue, Tracer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {ProcessId} from "./data/trace.ts";

const seed = 119120;
const options = {seed, numRuns: 100};
const effectOptions = {arbitrary: {seed, runs: 40}};
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const maxClock = 2 ** 48 - 1;
const letters = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz");
const text = (minLength: number, maxLength: number) =>
	fc.array(letters, {minLength, maxLength}).map((chars) => chars.join(""));
const prefix = fc.oneof(
	fc.constant(""),
	letters,
	fc
		.tuple(
			letters,
			fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_"), {maxLength: 61}),
			letters,
		)
		.map(([first, middle, last]) => first + middle.join("") + last),
);
// Each generated family visits every structural edge, including repeated interior underscores.
const prefixShapes = fc
	.tuple(letters, text(2, 62), text(63, 63), letters, letters)
	.map(([single, word, longest, first, last]) => [
		"",
		single,
		word,
		longest,
		`${first}_${last}`,
		`${first}__${last}`,
		first + "_".repeat(61) + last,
	]);
const badPrefixShapes = fc
	.tuple(text(1, 63), text(64, 100), fc.constantFrom("0", "-", "/", "é", "\0", " ", "\n"))
	.map(([word, long, bad]) => [
		"_",
		`_${word}`,
		`${word}_`,
		word.toUpperCase(),
		long,
		`${word}${bad}${word}`,
		// T518-PREFIX-EXCEPTION: mutation 13 admitted this invalid prefix; UUIDs stay generated.
		"Stryker was here!",
	]);
const clock = fc.oneof(fc.constant(0), fc.constant(maxClock), fc.integer({min: 0, max: maxClock}));
const uuid = fc.tuple(clock, fc.uint8Array({minLength: 10, maxLength: 10})).map(([at, random]) => {
	const bytes = Uint8Array.from([
		...Array.from({length: 6}, (_, i) => Number((BigInt(at) >> BigInt((5 - i) * 8)) & 255n)),
		...random,
	]);
	bytes[6] = (bytes[6]! & 15) | 0x70;
	bytes[8] = (bytes[8]! & 63) | 0x80;
	return bytes;
});

// Independent oracle: follow the spec's bit-string recipe, not the generator's shift loop.
const referenceEncode = (bytes: Uint8Array): string => {
	const bits = `00${[...bytes].map((byte) => byte.toString(2).padStart(8, "0")).join("")}`;
	return Array.from(
		{length: 26},
		(_, i) => alphabet[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)],
	).join("");
};
const referenceDecode = (suffix: string): Uint8Array => {
	const bits = [...suffix]
		.map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
		.join("")
		.slice(2);
	return Uint8Array.from({length: 16}, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2));
};
const wire = (type: string, bytes: Uint8Array): string =>
	(type === "" ? "" : `${type}_`) + referenceEncode(bytes);
const split = (value: string): readonly [string, string] => {
	const separator = value.lastIndexOf("_");
	return separator < 0 ? ["", value] : [value.slice(0, separator), value.slice(separator + 1)];
};
const validPrefix = (type: string): boolean =>
	type.length <= 63 &&
	(type === "" || (/^[a-z]$/.test(type[0]!) && /^[a-z]$/.test(type.at(-1)!))) &&
	[...type].every((char) => "abcdefghijklmnopqrstuvwxyz_".includes(char));
const accepts = (input: unknown, type?: string): boolean => {
	if (typeof input !== "string") return false;
	const [found, suffix] = split(input);
	if (!validPrefix(found) || (type !== undefined && found !== type)) return false;
	if (found === "" && input.includes("_")) return false;
	if (suffix.length !== 26 || ![...suffix].every((char) => alphabet.includes(char))) return false;
	if (alphabet.indexOf(suffix[0]!) > 7) return false;
	const bytes = referenceDecode(suffix);
	return bytes[6]! >>> 4 === 7 && bytes[8]! >>> 6 === 2;
};
const canonical = fc.tuple(prefix, uuid).map(([type, bytes]) => wire(type, bytes));
const unknown = fc.oneof(fc.anything(), fc.string(), canonical);

const expectDecoded = <A, E>(
	exit: Exit.Exit<A, E>,
	ok: boolean,
	input: unknown,
	error: (value: unknown) => boolean,
) => {
	expect(Exit.isSuccess(exit)).toBe(ok);
	if (Exit.isSuccess(exit)) expect(exit.value).toBe(input);
	else {
		expect(exit.cause.reasons.length).toBeGreaterThan(0);
		for (const reason of exit.cause.reasons) {
			expect(Cause.isFailReason(reason)).toBe(true);
			if (Cause.isFailReason(reason)) expect(error(reason.error)).toBe(true);
		}
	}
};
const timestamp = (id: string): number =>
	[...referenceDecode(split(id)[1]).slice(0, 6)].reduce((total, byte) => total * 256 + byte, 0);
const increasing = (ids: ReadonlyArray<string>): void => {
	expect(new Set(ids).size).toBe(ids.length);
	for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
};
const compare = (left: string, right: string): -1 | 0 | 1 =>
	left < right ? -1 : left > right ? 1 : 0;
const Time = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: maxClock}));
const Count = Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 128}));

describe("T518 Id format", () => {
	it("built-in schemas and the type list keep every declared prefix", () => {
		const builtins = [
			["ledger", Id.Ledger],
			["person", Id.Person],
			["process", Id.Process],
			["connection", Id.Connection],
			["tab", Id.Tab],
			["mailbox", Id.Mailbox],
			["input", Id.Input],
			["letter", Id.Letter],
			["cmd", Id.Cmd],
			["monitor", Id.Monitor],
			["entry", Id.Entry],
			["grant", Id.Grant],
			["revoke", Id.Revoke],
			["add", Id.Add],
			["deny", Id.Deny],
		] as const;
		fc.assert(
			fc.property(uuid, prefix, (bytes, type) => {
				for (const [name, Specific] of builtins) {
					expect(Schema.is(Id.Type)(name)).toBe(true);
					expect(Specific.prefix).toBe(name);
					const raw = wire(name, bytes);
					expect(Schema.decodeUnknownSync(Specific)(raw)).toBe(raw);
					expect(Schema.is(Specific)(wire("", bytes))).toBe(false);
				}
				expect(Schema.is(Id.Type)(type)).toBe(builtins.some(([name]) => name === type));
			}),
			options,
		);
	});
	it("makeEffect records a named, completed span for valid and invalid generated prefixes", () => {
		fc.assert(
			fc.property(prefix, badPrefixShapes, (type, bad) => {
				for (const name of [type, ...bad]) {
					const spans: Array<Tracer.NativeSpan> = [];
					const tracer = Tracer.make({
						span(options) {
							const span = new Tracer.NativeSpan(options);
							spans.push(span);
							return span;
						},
					});
					const exit = Effect.runSync(
						Effect.exit(Id.makeEffect(name)).pipe(Effect.withTracer(tracer)),
					);
					expect(Exit.isSuccess(exit)).toBe(validPrefix(name));
					const made = spans.filter((span) => span.name === "id.makeEffect");
					expect(made).toHaveLength(1);
					const status = made[0]!.status;
					expect(status._tag).toBe("Ended");
					if (status._tag === "Ended") expect(Exit.isSuccess(status.exit)).toBe(validPrefix(name));
				}
			}),
			options,
		);
	});
	it("decodes independent UUIDv7 encodings for every valid prefix shape", () => {
		fc.assert(
			fc.property(uuid, prefixShapes, prefix, (bytes, shapes, type) => {
				for (const name of [...shapes, type]) {
					const raw = wire(name, bytes);
					expect(Schema.decodeUnknownSync(Id.Schema)(raw)).toBe(raw);
					expect(Schema.decodeUnknownSync(Id.make(name))(raw)).toBe(raw);
					expect(referenceDecode(split(raw)[1])).toEqual(bytes);
				}
			}),
			options,
		);
	});
	it("round trips generated values through the schema encoder and decoder", () => {
		fc.assert(
			fc.property(prefix, uuid, (type, bytes) => {
				const Specific = Id.make(type);
				const value = Specific.make(wire(type, bytes));
				const encoded = Schema.encodeSync(Specific)(value);
				expect(encoded).toBe(wire(type, bytes));
				expect(Schema.decodeSync(Specific)(encoded)).toBe(value);
				expect(Schema.decodeSync(Id.Schema)(Schema.encodeSync(Id.Schema)(value))).toBe(value);
				expect(referenceDecode(split(encoded)[1])).toEqual(bytes);
			}),
			options,
		);
	});
	it("rejects malformed suffixes, overflow, whitespace, versions, and variants without repair", () => {
		fc.assert(
			fc.property(
				prefix,
				uuid,
				fc.integer({min: 0, max: 25}),
				fc.integer({min: 8, max: 31}),
				fc.integer({min: 0, max: 15}).filter((version) => version !== 7),
				fc.constantFrom(0, 1, 3),
				(type, bytes, index, overflow, version, variant) => {
					const raw = wire(type, bytes),
						suffix = referenceEncode(bytes);
					const head = type === "" ? "" : `${type}_`;
					const wrongVersion = bytes.slice(),
						wrongVariant = bytes.slice();
					wrongVersion[6] = (bytes[6]! & 15) | (version << 4);
					wrongVariant[8] = (bytes[8]! & 63) | (variant << 6);
					const bad = [
						raw.toUpperCase(),
						head + suffix.toUpperCase(),
						head + suffix.slice(0, index) + suffix.slice(index + 1),
						`${head + suffix.slice(0, index)}0${suffix.slice(index)}`,
						head + alphabet[overflow] + suffix.slice(1),
						wire(type, wrongVersion),
						wire(type, wrongVariant),
						...[" ", "\t", "\n", "\r\n", "\u00a0"].flatMap((space) => [space + raw, raw + space]),
						...["i", "l", "o", "u", "-", "_", "é", "\0"].map(
							(char) => head + suffix.slice(0, index) + char + suffix.slice(index + 1),
						),
						...(type === "" ? [`_${suffix}`] : [type + suffix, `${type}__${suffix}`]),
					];
					const Specific = Id.make(type);
					for (const value of bad) {
						expect(accepts(value)).toBe(false);
						expectDecoded(
							Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Schema)(value))),
							false,
							value,
							Schema.isSchemaError,
						);
						expectDecoded(
							Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Specific)(value))),
							false,
							value,
							Schema.isSchemaError,
						);
					}
				},
			),
			options,
		);
	});
	it("keeps prefixes distinct at runtime, including the empty prefix", () => {
		fc.assert(
			fc.property(prefix, uuid, (type, bytes) => {
				const other = type === "" ? "process" : "";
				const left = wire(type, bytes),
					right = wire(other, bytes);
				expect(Schema.is(Id.make(type))(left)).toBe(true);
				expect(Schema.is(Id.make(other))(right)).toBe(true);
				for (const [target, input] of [
					[type, right],
					[other, left],
					["letter", wire("process", bytes)],
					["process", wire("letter", bytes)],
				]) {
					expectDecoded(
						Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(target!))(input))),
						false,
						input,
						Schema.isSchemaError,
					);
				}
			}),
			options,
		);
	});
	it("rejects every invalid prefix shape in the factory and in complete ids", () => {
		fc.assert(
			fc.property(badPrefixShapes, uuid, (bad, bytes) => {
				for (const type of bad) {
					expect(() => Id.make(type)).toThrow();
					const exit = Effect.runSync(Effect.exit(Id.makeEffect(type)));
					expect(Exit.isFailure(exit)).toBe(true);
					if (Exit.isFailure(exit)) {
						expect(exit.cause.reasons.length).toBeGreaterThan(0);
						expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
					}
					expect(Schema.is(Id.Schema)(wire(type, bytes))).toBe(false);
				}
			}),
			options,
		);
	});
	it("makeEffect accepts every valid prefix shape", () => {
		fc.assert(
			fc.property(prefixShapes, uuid, (shapes, bytes) => {
				for (const type of shapes) {
					const Specific = Effect.runSync(Id.makeEffect(type));
					expect(Schema.decodeUnknownSync(Specific)(wire(type, bytes))).toBe(wire(type, bytes));
				}
			}),
			options,
		);
	});
	it("unknown decoding never throws or dies, and only non-IDs fail typed", () => {
		fc.assert(
			fc.property(unknown, prefix, (input, type) => {
				expectDecoded(
					Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Schema)(input))),
					accepts(input),
					input,
					Schema.isSchemaError,
				);
				expectDecoded(
					Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(type))(input))),
					accepts(input, type),
					input,
					Schema.isSchemaError,
				);
			}),
			options,
		);
	});
	it("schema makeEffect keeps invalid strings and unknowns in its typed Issue channel", () => {
		fc.assert(
			fc.property(unknown, prefix, (input, type) => {
				// @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
				const common = Id.Schema.makeEffect(input);
				// @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
				const specific = Id.make(type).makeEffect(input);
				expectDecoded(
					Effect.runSync(Effect.exit(common)),
					accepts(input),
					input,
					SchemaIssue.isIssue,
				);
				expectDecoded(
					Effect.runSync(Effect.exit(specific)),
					accepts(input, type),
					input,
					SchemaIssue.isIssue,
				);
			}),
			options,
		);
	});
	it("trusted make and decodeSync throw on invalid strings", () => {
		fc.assert(
			fc.property(fc.oneof(fc.string(), canonical), prefix, (input, type) => {
				const Specific = Id.make(type);
				expect(Schema.is(Specific)(input)).toBe(accepts(input, type));
				if (accepts(input)) {
					expect(Id.Schema.make(input)).toBe(input);
					expect(Schema.decodeSync(Id.Schema)(input)).toBe(input);
				} else {
					expect(() => Id.Schema.make(input)).toThrow();
					expect(() => Schema.decodeSync(Id.Schema)(input)).toThrow();
				}
				if (accepts(input, type)) {
					expect(Specific.make(input)).toBe(input);
					expect(Schema.decodeSync(Specific)(input)).toBe(input);
				} else {
					expect(() => Specific.make(input)).toThrow();
					expect(() => Schema.decodeSync(Specific)(input)).toThrow();
				}
			}),
			options,
		);
	});
	it("ProcessId and Id.make(process) accept exactly the same inputs in both directions", () => {
		fc.assert(
			fc.property(unknown, uuid, (input, bytes) => {
				const Specific = Id.make("process");
				const wrongVersion = bytes.slice(),
					wrongVariant = bytes.slice();
				wrongVersion[6] = (bytes[6]! & 15) | 0x40;
				wrongVariant[8] = bytes[8]! & 63;
				for (const value of [
					input,
					wire("process", bytes),
					wire("process", wrongVersion),
					wire("process", wrongVariant),
					wire("letter", bytes),
				]) {
					const ok = accepts(value, "process");
					expectDecoded(
						Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(ProcessId)(value))),
						ok,
						value,
						Schema.isSchemaError,
					);
					expectDecoded(
						Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Specific)(value))),
						ok,
						value,
						Schema.isSchemaError,
					);
				}
			}),
			options,
		);
	});
});

describe("T518 Id order and generation", () => {
	it.effect.prop(
		"an empty-prefix schema generates bare UUIDv7 suffixes on generated clocks and bursts",
		{at: Time, count: Count},
		({at, count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("");
				const generator = yield* Id.Generator;
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(0);
					return array;
				});
				try {
					yield* TestClock.setTime(at);
					const ids = yield* Effect.forEach(
						Array.from({length: count}),
						() => generator.next(Specific),
						{
							concurrency: 1,
						},
					);
					increasing(ids);
					for (const id of ids) {
						expect(accepts(id, "")).toBe(true);
						expect(id).not.toContain("_");
						expect(Schema.decodeUnknownSync(Specific)(id)).toBe(id);
						expect(timestamp(id)).toBe(at);
					}
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Id.Generator.layer)),
		effectOptions,
	);
	it("Order compares suffix first, then the whole prefix on ties", () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(prefix, uuid), {minLength: 2, maxLength: 40}),
				uuid,
				prefixShapes,
				(values, tied, shapes) => {
					const ids = [
						...values.map(([type, bytes]) => wire(type, bytes)),
						...shapes.map((type) => wire(type, tied)),
					].map((raw) => Id.Schema.make(raw));
					const expected = [...ids].sort((left, right) => {
						const [lp, ls] = split(left),
							[rp, rs] = split(right);
						return compare(ls, rs) || compare(lp, rp);
					});
					expect([...ids].sort(Id.Order)).toEqual(expected);
					for (const left of ids) {
						expect(Id.Order(left, left)).toBe(0);
						for (const right of ids) {
							const [lp, ls] = split(left),
								[rp, rs] = split(right);
							expect(Id.Order(left, right)).toBe(compare(ls, rs) || compare(lp, rp));
						}
					}
				},
			),
			options,
		);
	});
	it.effect.prop(
		"next(schema) encodes the controlled clock and UUIDv7 bits at both clock edges",
		{at: Time, count: Count},
		({at, count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("letter");
				const generator = yield* Id.Generator;
				// Zero entropy keeps a burst at the last millisecond inside the clock's range.
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(0);
					return array;
				});
				try {
					for (const now of [0, at, maxClock]) {
						yield* TestClock.setTime(now);
						const ids = yield* Effect.forEach(
							Array.from({length: count}),
							() => generator.next(Specific),
							{concurrency: 1},
						);
						increasing(ids);
						for (const id of ids) {
							expect(accepts(id, "letter")).toBe(true);
							expect(Schema.decodeUnknownSync(Specific)(id)).toBe(id);
							expect(timestamp(id)).toBe(now);
						}
					}
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Id.Generator.layer)),
		effectOptions,
	);
	it.effect.prop(
		"one writer stays strictly increasing across bursts and clock rollback",
		{
			at: Time,
			deltas: Schema.Array(
				Schema.Int.check(Schema.isBetween({minimum: -1000, maximum: 1000})),
			).check(Schema.isBetweenLength(2, 30)),
			count: Count,
		},
		({at, deltas, count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("process");
				const generator = yield* Id.Generator;
				const ids: Array<string> = [];
				// Leave room for increments even when a generated entropy value is all ones.
				const start = Math.max(1000, Math.min(at, maxClock - 10_000));
				for (const delta of [0, 0, -1, ...deltas]) {
					const now = Math.max(0, start + delta);
					yield* TestClock.setTime(now);
					expect(yield* Clock.currentTimeMillis).toBe(now);
					ids.push(
						...(yield* Effect.forEach(Array.from({length: count}), () => generator.next(Specific), {
							concurrency: 1,
						})),
					);
				}
				increasing(ids);
			}).pipe(Effect.provide(Id.Generator.layer)),
		effectOptions,
	);
	it.effect.prop(
		"exhausted random bits advance the logical clock and keep the UUID layout",
		{at: Time, count: Count},
		({at, count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("process");
				const generator = yield* Id.Generator;
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(255);
					return array;
				});
				try {
					const now = Math.min(at, maxClock - 1);
					yield* TestClock.setTime(now);
					const ids = yield* Effect.forEach(
						Array.from({length: count}),
						() => generator.next(Specific),
						{concurrency: 1},
					);
					increasing(ids);
					expect(timestamp(ids[0]!)).toBe(now);
					for (const id of ids.slice(1)) {
						expect(timestamp(id)).toBe(now + 1);
						expect(accepts(id, "process")).toBe(true);
					}
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Id.Generator.layer)),
		effectOptions,
	);
	it.effect.prop(
		"clock exhaustion dies with the existing ProcessIdGenerator defect",
		{extra: Count},
		({extra}) =>
			Effect.gen(function* () {
				const Specific = Id.make("process");
				for (const now of [-extra, maxClock + extra, Number.MAX_SAFE_INTEGER + extra]) {
					yield* TestClock.setTime(now);
					const exit = yield* Effect.gen(function* () {
						const generator = yield* Id.Generator;
						return yield* generator.next(Specific);
					}).pipe(Effect.provide(Id.Generator.layer), Effect.exit);
					expect(Exit.isFailure(exit)).toBe(true);
					if (Exit.isFailure(exit)) {
						expect(exit.cause.reasons).toHaveLength(1);
						const reason = exit.cause.reasons[0]!;
						expect(Cause.isDieReason(reason)).toBe(true);
						if (Cause.isDieReason(reason)) expect(reason.defect).toBe("UUIDv7 clock exhausted");
					}
				}
			}),
		effectOptions,
	);
	it.effect.prop(
		"random-bit overflow at the last millisecond dies instead of wrapping",
		{count: Count},
		({count}) =>
			Effect.gen(function* () {
				const Specific = Id.make("process");
				const generator = yield* Id.Generator;
				const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					if (array instanceof Uint8Array) array.fill(255);
					return array;
				});
				try {
					yield* TestClock.setTime(maxClock);
					expect(timestamp(yield* generator.next(Specific))).toBe(maxClock);
					for (let i = 1; i < count; i++) {
						const exit = yield* Effect.exit(generator.next(Specific));
						expect(Exit.isFailure(exit)).toBe(true);
						if (Exit.isFailure(exit)) {
							expect(exit.cause.reasons.every(Cause.isDieReason)).toBe(true);
							for (const reason of exit.cause.reasons)
								if (Cause.isDieReason(reason)) expect(reason.defect).toBe("UUIDv7 clock exhausted");
						}
					}
				} finally {
					random.mockRestore();
				}
			}).pipe(Effect.provide(Id.Generator.layer)),
		effectOptions,
	);
	it.effect.prop(
		"independent layers and writer restarts do not collide on generated schedules",
		{
			at: Time,
			writers: Schema.Int.check(Schema.isBetween({minimum: 8, maximum: 24})),
			schedule: Schema.Array(
				Schema.Int.check(Schema.isBetween({minimum: -100, maximum: 100})),
			).check(Schema.isBetweenLength(4, 20)),
		},
		({at, writers, schedule}) =>
			Effect.gen(function* () {
				const Specific = Id.make("letter");
				const start = Math.min(at, maxClock - 10_000);
				// A collision sample, not a proof. Fresh provide calls build independent layers, including
				// writers restarted on exactly the same schedule. Entropy is real, never stubbed here.
				const batches = yield* Effect.forEach(
					Array.from({length: writers}),
					() =>
						Effect.gen(function* () {
							const generator = yield* Id.Generator;
							return yield* Effect.forEach(
								[0, 0, -1, ...schedule],
								(delta) =>
									Effect.gen(function* () {
										yield* TestClock.setTime(Math.max(0, start + delta));
										return yield* generator.next(Specific);
									}),
								{concurrency: 1},
							);
						}).pipe(Effect.provide(Id.Generator.layer)),
					{concurrency: 1},
				);
				const ids = batches.flat();
				expect(new Set(ids).size).toBe(ids.length);
				for (const batch of batches) {
					increasing(batch);
					for (const id of batch) expect(accepts(id, "letter")).toBe(true);
				}
			}),
		effectOptions,
	);
});
