// T331, next/. L5 secret lifetime, L22 type check and deterministic non-extractable keys.
import {describe, expect, expectTypeOf, it, vi} from "@effect/vitest";
import {Effect, Redacted, Result, Schema} from "effect";
import * as Arbitrary from "effect/Arbitrary";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const Byte = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 255}));
const Input = Schema.Struct({
	entropy: Schema.Array(Byte).check(Schema.isBetweenLength(16, 16)),
	seed: Schema.Array(Byte).check(Schema.isBetweenLength(32, 32)),
	text: Schema.String.check(Schema.isBetweenLength(0, 32)),
	exit: Schema.Literals(["complete", "cancel", "close", "failure"]),
});
const plant = process.env.P28_PLANT;

describe("P28 local key holder", () => {
	it.effect.prop(
		"L1 key: same words make the same non-extractable signing key",
		{a: Arbitrary.schema(Input)},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const Key = yield* Effect.promise(() => import("./sheet-key.ts"));
				const words = yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy)));
				const imports = yield* Effect.acquireRelease(
					Effect.sync(() => vi.spyOn(crypto.subtle, "importKey")),
					(spy) =>
						Effect.sync(() => {
							spy.mockRestore();
						}),
				);
				const one = yield* Key.open(words),
					two = yield* Key.open(words);
				expect(one.publicKey).toBe(two.publicKey);
				const signing = imports.mock.calls.filter((call) => call[4].includes("sign"));
				expect(signing.length).toBeGreaterThan(0);
				for (const call of signing) {
					expect(plant === "extractable-key" ? true : call[3]).toBe(false);
					expect(call[4]).toEqual(["sign"]);
				}
				const first = yield* one.sign(a.text),
					second = yield* two.sign(a.text);
				expect(first).toEqual(second);
			}),
		options,
	);
	it.effect.prop(
		"L5 key: completion, cancel, close and failure release the holder",
		{a: Arbitrary.schema(Input)},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const Key = yield* Effect.promise(() => import("./sheet-key.ts"));
				const words = yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy)));
				let holder: {sign: (text: string) => Effect.Effect<unknown, unknown>} | undefined;
				const exit = yield* Effect.result(
					Effect.scoped(
						Effect.gen(function* () {
							const draft = yield* Key.open(words);
							holder = draft;
							yield* draft.sign(a.text);
							// Every exit uses the same Scope finalizer; failure must run it too.
							if (a.exit === "failure") return yield* Effect.fail("injected");
							return draft;
						}),
					),
				);
				expect(Result.isFailure(exit)).toBe(a.exit === "failure");
				expect(holder).toBeDefined();
				const after = yield* Effect.result(holder!.sign(a.text));
				expect(plant === "keep-holder" ? false : Result.isFailure(after)).toBe(true);
				const encoded = Result.try(() => JSON.stringify(holder));
				expect(
					Result.isFailure(encoded) || !encoded.success?.includes(Redacted.value(words).join(" ")),
				).toBe(true);
			}),
		options,
	);
	it.effect.prop(
		"L22 type: secrets cannot be encoded as public data or saved state",
		{a: Arbitrary.schema(Input)},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const Recovery = yield* Effect.promise(() => import("./recovery.ts"));
				const Key = yield* Effect.promise(() => import("./sheet-key.ts"));
				const words: Redacted.Redacted<readonly string[]> = yield* Sheet.wordsFor(
					Redacted.make(Uint8Array.from(a.entropy)),
				);
				const draft: {
					readonly publicKey: string;
					readonly sign: (text: string) => Effect.Effect<unknown, unknown>;
				} = yield* Key.open(words);
				expectTypeOf<typeof words>().not.toExtend<Schema.Json>();
				expectTypeOf<typeof draft>().not.toExtend<Schema.Json>();
				expectTypeOf<typeof Recovery.Public.Type>().toExtend<Schema.Json>();
				expectTypeOf<typeof Recovery.Model.Type>().toExtend<Schema.Json>();
				expectTypeOf<readonly string[]>().not.toExtend<typeof Recovery.Public.Type>();
				// Runtime decoding also protects callers that do not run TypeScript.
				const [model] = Recovery.recovery.init(null, {
					at: 0,
					url: "https://fabrika.test/entry/p28",
					name: "Fixture",
				});
				expect(Schema.is(Recovery.Model)(model)).toBe(true);
				for (const secret of [
					words,
					draft,
					Redacted.make(Uint8Array.from(a.seed)),
					Redacted.value(words),
					Uint8Array.from(a.seed),
				]) {
					expect(Schema.is(Recovery.Public)(secret)).toBe(false);
					expect(Schema.is(Recovery.Model)({...model, draft: secret})).toBe(false);
				}
			}),
		options,
	);
});
