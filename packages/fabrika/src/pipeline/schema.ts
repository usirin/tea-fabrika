import {Cmd, type CmdInput} from "@demlik/tea";
import type {CheckingSchema} from "@demlik/tea/effect";
import {Option, Schema} from "effect";
import {z} from "zod";
import {jsonSchemaOf} from "../program/shape.ts";

// Schemas here are Effect Schema (docs/direction/data-first-markdown-is-a-view.md).
// A Cmd from Effect schemas is tea's own `Cmd.define` from `@demlik/tea/effect`,
// which wraps them for tea itself, so no caller writes `Schema.toStandardSchemaV1`.
// The six moves (src/primitives.ts) call it.
//
// What stays here for Cmds is the one thing tea's does not do: a schema slot
// that holds zod. Until the repo is off zod, a move takes a zod schema in any
// slot, beside an Effect one, and tea's Effect `Cmd.define` takes Effect
// schemas only. Each place that serves zod is marked "zod": removing zod is
// deleting those, and then a move calls tea's `Cmd.define` and nothing else.

/**
 * A schema a Cmd may carry: an Effect schema whose two sides are the same
 * type, as tea's Effect `Cmd.define` takes it.
 *
 * A Cmd holds its values, it does not read them from outside. tea types a
 * handler's answer by the type the schema hands on, and checks that answer as
 * the type the schema takes in. A schema that turns one into the other
 * (`Schema.FiniteFromString`, a brand) makes the two disagree, so it does not
 * compile here. Hand over its type side, `Schema.toType(schema)`, or keep it
 * where outside data does come in: a handler, or a Draft's output.
 */
export type Plain<T> =
	| CheckingSchema<T>
	// zod: a schema of the code not yet moved, as it was.
	| z.ZodType<T>;

/** A Cmd's spec as a move takes it. */
export interface Spec<I, O, T extends readonly string[]> {
	readonly input: Plain<I>;
	readonly ok: Plain<O>;
	readonly err: T;
}

/** zod: no slot holds zod, so the spec goes to tea's Effect `Cmd.define` as it is. */
export const isEffectSpec = <I, O, T extends readonly string[]>(
	spec: Spec<I, O, T>,
): spec is {readonly input: CheckingSchema<I>; readonly ok: CheckingSchema<O>; readonly err: T} =>
	Schema.isSchema(spec.input) && Schema.isSchema(spec.ok);

/** zod: the schema as the core `Cmd.define` takes it. A zod schema already is a Standard Schema. */
const standard = <T>(schema: Plain<T>) =>
	Schema.isSchema(schema) ? Schema.toStandardSchemaV1(schema) : schema;

/**
 * zod: a Cmd with a zod slot. tea's Effect `Cmd.define` refuses zod, so this
 * wraps any Effect slot and hands the spec to the core `Cmd.define`. The Cmd
 * it gives back is the one tea's Effect `Cmd.define` gives for the same types.
 */
export const zodCmd = <
	const N extends string,
	I extends CmdInput,
	O,
	const T extends readonly string[],
>(
	name: N,
	spec: Spec<I, O, T>,
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
