import {it, type Vitest} from "@effect/vitest";
import {Effect, Schema} from "effect";

class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", {
	cause: Schema.Unknown,
}) {}

/** Effect 4.1.1's property runner; live services keep real SQLite and clock checks honest. */
export const property = <const Inputs extends Record<string, Schema.Schema<unknown>>>(
	name: string,
	inputs: Inputs,
	check: (input: {[K in keyof Inputs]: Vitest.ArbitraryValue<Inputs[K]>}) => void | Promise<void>,
) =>
	it.live.prop(
		name,
		inputs,
		(input) =>
			Effect.tryPromise({
				try: async () => check(input),
				catch: (cause) => new PropertyFailed({cause}),
			}),
		{arbitrary: {seed: 119120}},
	);

export const ticketNumber = Schema.Int.check(
	Schema.isGreaterThanOrEqualTo(1),
	Schema.isLessThanOrEqualTo(1_000_000),
);

// RFC 8785 rejects lone UTF-16 surrogates. Generated display text must be Unicode text.
export const unicode = Schema.isPattern(/^[^\uD800-\uDFFF]*$/u);
