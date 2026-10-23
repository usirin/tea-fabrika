import {Option, Schema} from "effect";
import {z} from "zod";
import {jsonSchemaOf} from "../../program/shape.ts";

// The schema a Draft's answer is read by (./draft.ts): how the agent's JSON
// becomes a typed value, and the JSON Schema the Agent SDK is handed for it.
// Until experiment 114 this half was in the pipeline's `schema.ts`, beside
// the moves' Cmd schemas, which stayed there. Each place that serves zod is
// marked "zod", as there.

/**
 * A schema that reads outside data, for a Draft's output. The agent's JSON
 * goes in one side and the typed value comes out the other, so here the two
 * sides may differ.
 */
export type Reads<T> =
	| Schema.Codec<T, unknown>
	// zod
	| z.ZodType<T>;

/**
 * Read an outside JSON value against a schema: the typed value, or none when
 * it does not fit. It reads through the schema's JSON codec, the one
 * `jsonSchema` below describes, so the two agree on what an answer is. Like
 * tea's check it is synchronous: a schema that needs a Promise throws.
 */
export const reader = <T>(schema: Reads<T>): ((value: unknown) => Option.Option<T>) => {
	if (Schema.isSchema(schema)) return Schema.decodeUnknownOption(Schema.toCodecJson(schema));
	// zod
	return (value) => {
		const read = schema.safeParse(value);
		return read.success ? Option.some(read.data) : Option.none();
	};
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A JSON Schema with every `prefixItems` taken out where each of its entries
 * is the array's `items`: a non-empty list, not a tuple. A real tuple keeps it.
 */
function withoutSamePrefix(node: Record<string, unknown>): Record<string, unknown> {
	const walk = (value: unknown): unknown =>
		Array.isArray(value) ? value.map(walk) : isObject(value) ? withoutSamePrefix(value) : value;
	const {prefixItems, ...rest} = node;
	const same =
		Array.isArray(prefixItems) &&
		prefixItems.every((p) => JSON.stringify(p) === JSON.stringify(node.items));
	const kept = prefixItems === undefined || same ? rest : node;
	return Object.fromEntries(Object.entries(kept).map(([key, value]) => [key, walk(value)]));
}

/**
 * The schema as JSON Schema, in the one shape the Agent SDK takes: a single
 * object, closed to fields it does not name, with the parts it refers to
 * under `$defs`.
 *
 * Claude Code checks the schema strictly before the first turn, and the run
 * dies there if it does not pass. It refuses the `$schema` line zod adds (it
 * names a draft Claude Code does not carry), and it refuses the document
 * Effect hands back as it comes (`dialect`, `schema`, `definitions`). So both
 * are unwrapped here. It refuses `prefixItems` too, which Effect writes for a
 * non-empty list (`Schema.NonEmptyArray`): there every first item is the same
 * as the rest, and `minItems: 1` already says it, so the keyword is dropped.
 */
export const jsonSchema = (schema: Reads<unknown>): Record<string, unknown> => {
	// Effect: tea-program's, so a program's listing and a Draft's schema read alike.
	if (Schema.isSchema(schema)) return withoutSamePrefix(jsonSchemaOf(schema));
	// zod
	const {$schema: _, ...rest} = z.toJSONSchema(schema) as Record<string, unknown>;
	return rest;
};
