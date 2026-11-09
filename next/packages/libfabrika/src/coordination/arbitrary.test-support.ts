import {Arbitrary, Schema} from "effect";
import * as fc from "fast-check";

// fast-check 4.10.2's default JSON has no hard depth bound. Effect 4.1.1's
// recursive Schema.Json spends one shared size budget, so no finite size
// preserves that range. Keep the old generator for this input only.
export const unboundedJson = Arbitrary.schema(
	Schema.Int.check(Schema.isBetween({minimum: -2_147_483_648, maximum: 2_147_483_647})),
).pipe(
	Arbitrary.map((seed) =>
		Schema.decodeUnknownSync(Schema.Json)(fc.sample(fc.jsonValue(), {seed, numRuns: 1})[0]),
	),
);

// Match fc.jsonValue({maxDepth: depth}): finite numbers, strings/keys of
// length 0..10, and arrays/objects of width 0..10. No required object keys.
// Finite schema levels give every child its own full range. Call with size >= 10.
const scalar = Schema.Union([
	Schema.Null,
	Schema.Boolean,
	Schema.Finite,
	Schema.String.check(Schema.isMaxLength(10)),
]);
export const json = (depth: number): Schema.Codec<Schema.Json> =>
	depth === 0
		? scalar
		: Schema.Union([
				scalar,
				Schema.Array(json(depth - 1)).check(Schema.isMaxLength(10)),
				Schema.Record(Schema.String.check(Schema.isMaxLength(10)), json(depth - 1)).check(
					Schema.isMaxProperties(10),
				),
			]);
