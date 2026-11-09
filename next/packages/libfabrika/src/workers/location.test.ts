// P24, next/. This decoder receives request.cf, never client params.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
const runs = {arbitrary: {seed: 119120, runs: 100, size: 100}};

const Place = Schema.NonEmptyString.check(Schema.isPattern(/^[A-Za-z][A-Za-z ]{0,30}$/));
const platformWords = (words: string, city: string, country: string, decoy: string) => {
	expect(words).toContain(city);
	expect(words).toContain(country);
	expect(words).not.toContain(decoy);
};
describe("P24 client location", () => {
	it.effect.prop(
		"checked platform city/country supply words; client decoys supply none",
		{city: Place, country: Place},
		({city, country}) =>
			Effect.gen(function* () {
				const {clientLocation} = yield* Effect.promise(() => import("./location.ts"));
				const decoy = "CLIENT_LOCATION_SENTINEL";
				platformWords(
					yield* clientLocation({
						city,
						country,
						params: {city: decoy, country: decoy},
						location: decoy,
					}),
					city,
					country,
					decoy,
				);
			}),
		runs,
	);
	it.effect.prop(
		"absent location stays unknown even with client-supplied words",
		{decoy: Schema.String},
		({decoy}) =>
			Effect.gen(function* () {
				const {clientLocation} = yield* Effect.promise(() => import("./location.ts"));
				for (const raw of [undefined, null, {}, {params: {city: decoy, country: decoy}}])
					expect(yield* clientLocation(raw)).toBe("Unknown location");
			}),
		runs,
	);
	it.effect.prop(
		"malformed platform fields fail through the typed channel",
		{bad: Schema.Union([Schema.Number, Schema.Boolean, Schema.Array(Schema.String)])},
		({bad}) =>
			Effect.gen(function* () {
				const {clientLocation} = yield* Effect.promise(() => import("./location.ts"));
				for (const raw of [
					{city: bad, country: "US"},
					{city: "City", country: bad},
				])
					expect(Exit.isFailure(yield* Effect.exit(clientLocation(raw)))).toBe(true);
			}),
		runs,
	);
	it.prop(
		"plants: trusting the client's location and converting missing data to a city fail",
		{city: Place, country: Place},
		({city, country}) => {
			expect(() =>
				platformWords("CLIENT_LOCATION_SENTINEL", city, country, "CLIENT_LOCATION_SENTINEL"),
			).toThrow();
			expect(() => expect(city).toBe("Unknown location")).toThrow();
		},
		runs,
	);
});
