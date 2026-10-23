import {Cmd, type CmdInput} from "@demlik/tea";
import type {CheckingSchema} from "@demlik/tea/effect";
import {Schema} from "effect";
import type {z} from "zod";

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
//
// The other half that was here, how a Draft's answer is read (`reader`,
// `jsonSchema`), is fabrika's since experiment 114, on
// `@kampus/fabrika/agents/claude`, with the Draft that uses it.

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
