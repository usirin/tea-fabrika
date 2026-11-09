// P24, next/. Pure laws and independent plants. No fallback implements chaosFrom.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {LedgerName, runs, SEED, StageName} from "./p24.test-support.ts";

const defaults = (answer: {_tag: string}) => expect(answer._tag).toBe("off");
const refused = (answer: Result.Result<unknown, unknown>, why: string) => {
	expect(Result.isFailure(answer)).toBe(true);
	if (Result.isFailure(answer)) expect(answer.failure).toMatchObject({_tag: "ChaosError", why});
};
const malformed = fc.oneof(
	fc.constantFrom("", " ", "on", "real", "real:", "OFF", "throwaway:", "off:true"),
	fc
		.string({maxLength: 80})
		.filter((text) => text !== "off" && text !== "throwaway" && !/^real:.+$/.test(text)),
);

describe("P24 chaos selection", () => {
	it.effect.prop(
		"p60 defaults to off on every stage",
		{stage: StageName, ledger: LedgerName, flag: Schema.NullOr(Schema.Literal("off"))},
		({stage, ledger, flag}) =>
			Effect.gen(function* () {
				const {chaosFrom} = yield* Effect.promise(() => import("./chaos.ts"));
				defaults(yield* chaosFrom({flag, stage, ledger}));
			}),
		runs,
	);
	it.effect.prop(
		"p60 malformed flags fail visibly",
		{stage: StageName, ledger: LedgerName},
		({stage, ledger}) =>
			Effect.gen(function* () {
				const {chaosFrom} = yield* Effect.promise(() => import("./chaos.ts"));
				// Malformed flag text has no Schema. Stages and names use Schema inputs.
				fc.assert(
					fc.property(malformed, (flag) => {
						refused(Effect.runSync(Effect.result(chaosFrom({flag, stage, ledger}))), "flag");
					}),
					{seed: SEED, numRuns: 200},
				);
			}),
		runs,
	);
	it.effect.prop(
		"p60 throwaway cannot target cloud",
		{ledger: LedgerName},
		({ledger}) =>
			Effect.gen(function* () {
				const {chaosFrom} = yield* Effect.promise(() => import("./chaos.ts"));
				refused(
					yield* Effect.result(chaosFrom({flag: "throwaway", stage: "cloud", ledger})),
					"not_here",
				);
			}),
		runs,
	);
	it.effect.prop(
		"p60 throwaway uses a shared identity on local and drill",
		{stage: Schema.Literals(["local", "drill"]), ledger: LedgerName},
		({stage, ledger}) =>
			Effect.gen(function* () {
				const {chaosFrom} = yield* Effect.promise(() => import("./chaos.ts"));
				const {IdGenerator} = yield* Effect.promise(() => import("../data/id.ts"));
				const allocated: string[] = [];
				const answer = yield* IdGenerator.use((generator: any) => {
					const next: typeof generator.next = (schema: any) =>
						generator.next(schema).pipe(
							Effect.tap((id) =>
								Effect.sync(() => {
									expect(typeof id).toBe("string");
									allocated.push(String(id));
								}),
							),
						);
					return chaosFrom({flag: "throwaway", stage, ledger}).pipe(
						Effect.provideService(IdGenerator, {...generator, next}),
					);
				}).pipe(Effect.provide(IdGenerator.layer));
				expect(allocated).toHaveLength(1);
				expect(answer).toMatchObject({
					_tag: "throwaway",
					ledger: expect.stringMatching(/^throwaway-/),
				});
			}),
		runs,
	);
	it.effect.prop(
		"p60 real requires cloud and the exact ledger",
		{stage: StageName, ledger: LedgerName},
		({stage, ledger}) =>
			Effect.gen(function* () {
				const {chaosFrom} = yield* Effect.promise(() => import("./chaos.ts"));
				const answer = yield* Effect.result(chaosFrom({flag: `real:${ledger}`, stage, ledger}));
				expect.hasAssertions();
				if (stage === "cloud")
					expect(answer).toMatchObject({success: {_tag: "real", typed: ledger}});
				else refused(answer, "not_here");
			}),
		runs,
	);
	it("p60 near misses never become exact matches", async () => {
		const {chaosFrom} = await import("./chaos.ts");
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z]{1,20}$/),
				fc.constantFrom("-other", "x", " "),
				(ledger, suffix) => {
					for (const typed of [ledger + suffix, suffix + ledger])
						refused(
							Effect.runSync(
								Effect.result(chaosFrom({flag: `real:${typed}`, stage: "cloud", ledger})),
							),
							"wrong_name",
						);
				},
			),
			{seed: SEED, numRuns: 100},
		);
	});
	it.prop(
		"plants: cloud on, malformed off, cloud throwaway, prefix and local real are caught",
		{ledger: LedgerName},
		({ledger}) => {
			expect(() => defaults({_tag: `real:${ledger}`})).toThrow();
			for (const why of ["flag", "not_here", "wrong_name"])
				expect(() => refused(Result.succeed({_tag: "off"}), why)).toThrow();
			// Each refusal assertion is the one above, also used by the real laws.
		},
		runs,
	);
});
