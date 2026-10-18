import {Cmd, type CmdInput} from "@demlik/tea";
import {Option, Schema} from "effect";
import {z} from "zod";
import {jsonSchemaOf} from "../../packages/tea-program/src/shape.ts";

// Schemas here are Effect Schema (docs/direction/data-first-markdown-is-a-view.md).
// tea takes any Standard Schema, and an Effect schema is not one until it is
// wrapped. This file does the wrapping, so no caller writes
// `Schema.toStandardSchemaV1`:
//
//   const readTicket = defineCmd("ticket_read", {
//     input: Schema.Struct({ id: Schema.String }),
//     ok: Ticket,
//     err: ["unknown"],
//   });
//
// One function over tea's `Cmd.define`, Elm's way: the Cmd it gives back is the
// same Cmd. The six moves (src/primitives.ts, src/draft.ts) go through it.
//
// Until the repo is off zod, every schema slot here takes a zod schema too.
// Each place that does is marked "zod": removing zod is deleting those.

/**
 * A schema a Cmd may carry: an Effect schema whose two sides are the same
 * type.
 *
 * A Cmd holds its values, it does not read them from outside. tea types a
 * handler's answer by the type the schema hands on, and checks that answer as
 * the type the schema takes in. A schema that turns one into the other
 * (`Schema.FiniteFromString`, a brand) makes the two disagree, so it does not
 * compile here. Hand over its type side, `Schema.toType(schema)`, or keep it
 * where outside data does come in: a handler, or a Draft's output.
 */
export type Plain<T> =
	| Schema.Codec<T, NoInfer<T>>
	// zod: a schema of the code not yet moved, as it was.
	| z.ZodType<T>;

/** The schema as tea takes it. */
const standard = <T>(schema: Plain<T>) =>
	// zod: one already is a Standard Schema.
	Schema.isSchema(schema) ? Schema.toStandardSchemaV1(schema) : schema;

/**
 * `Cmd.define`, from Effect schemas. Same Cmd out: the same `okType` and
 * `errType`, the same input and `ok` types, and a value the `ok` schema
 * rejects is still tea's `malformed_result`.
 *
 * tea checks a schema synchronously. One that needs a Promise to answer is
 * refused when the Cmd settles, with tea's own `AsyncSchemaError`. One that
 * needs a service to answer does not compile here.
 */
export const defineCmd = <
	const N extends string,
	I extends CmdInput,
	O,
	const T extends readonly string[],
>(
	name: N,
	spec: {readonly input: Plain<I>; readonly ok: Plain<O>; readonly err: T},
) => Cmd.define(name, {input: standard(spec.input), ok: standard(spec.ok), err: spec.err});

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

/**
 * The schema as JSON Schema, in the one shape the Agent SDK takes: a single
 * object, closed to fields it does not name, with the parts it refers to
 * under `$defs`.
 *
 * Claude Code checks the schema strictly before the first turn, and the run
 * dies there if it does not pass. It refuses the `$schema` line zod adds (it
 * names a draft Claude Code does not carry), and it refuses the document
 * Effect hands back as it comes (`dialect`, `schema`, `definitions`). So both
 * are unwrapped here.
 */
export const jsonSchema = (schema: Reads<unknown>): Record<string, unknown> => {
	// Effect: tea-program's, so a program's listing and a Draft's schema read alike.
	if (Schema.isSchema(schema)) return jsonSchemaOf(schema);
	// zod
	const {$schema: _, ...rest} = z.toJSONSchema(schema) as Record<string, unknown>;
	return rest;
};
