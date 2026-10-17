import {structuralHash} from "@demlik/tea";
import {Cause, Effect, Exit, Schema, SchemaAST} from "effect";
import {jsonSchema} from "../schema.ts";

// A shape: what a program's input or output carries. It only says yes or no,
// and why not. It never hands on a converted value: the value that passes is
// the value that arrived, so a shape cannot translate even if its schema could.
//
//   const PR = Schema.Struct({pr: Schema.String, head: Schema.String});
//   const hand = input(PR, "A pull request to put in the merge queue.");
//   hand.shape.check({pr: "#7", head: "abc1234"})   // true
//   hand.shape.problem({pr: 7})                       // why not, in the schema's words
//   hand.shape.json                                   // its JSON Schema
//
// A shape takes an Effect schema or any Standard Schema. A schema whose two
// sides differ does not compile (`Schema.Codec<T, T>`). An Effect schema that
// converts anywhere inside, with the same type on both sides, is refused when
// the shape is made. A Standard Schema that converts with the same type cannot
// be seen from outside; it is harmless here all the same, because the check's
// output is thrown away.

/** One answer of a Standard Schema's `validate`. */
type StandardResult<T> =
	| {readonly value: T; readonly issues?: undefined}
	| {readonly issues: ReadonlyArray<{readonly message: string}>};

/** A Standard Schema whose two sides are one type. Spelled here: tea uses the spec's types but does not export them. */
export interface StandardShape<T> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>;
		readonly types?: {readonly input: T; readonly output: T} | undefined;
	};
}

/** A schema a shape may be made from: one type on both sides. */
export type ShapeSchema<T> = Schema.Codec<T, NoInfer<T>> | StandardShape<T>;

/** The JSON Schema of a shape. */
export type JsonSchema = Record<string, unknown>;

export interface Shape<T> {
	/** True when the value fits. Never throws, never waits: a check that does either is a no. */
	readonly check: (value: unknown) => value is T;
	/** Why the value does not fit, in the schema's own words. `undefined`: it fits. */
	readonly problem: (value: unknown) => string | undefined;
	/** Its JSON Schema, when the schema can give one. Without it, fit says `cannot_tell`. */
	readonly json: JsonSchema | undefined;
}

/** One thing a program takes in or sends out: its shape, and a sentence for people. */
export interface Declared<D extends "input" | "output", T> {
	readonly direction: D;
	readonly description: string;
	readonly shape: Shape<T>;
}
/** A value a program is started with. */
export type Input<T> = Declared<"input", T>;
/** A value a program sends while it runs. One-way: nothing comes back. */
export type Output<T> = Declared<"output", T>;

/** The payload type a declaration carries. */
export type PayloadOf<D> = D extends {readonly shape: Shape<infer T>} ? T : never;

// Asked as "not Effect", never as "has `~standard`": `Schema.toStandardSchemaV1`
// (which `defineCmd` calls) sets `~standard` on the Effect schema it is given.
const isStandard = <T>(schema: ShapeSchema<T>): schema is StandardShape<T> =>
	!Schema.isSchema(schema);

function fromEffect<T>(schema: Schema.Codec<T, T>): Shape<T> {
	// `toType` strips every encoding, at any depth, and keeps the same node when there is none.
	if (SchemaAST.toType(schema.ast) !== schema.ast)
		throw new Error("a shape only checks: this schema converts a value somewhere inside it");
	const decode = Schema.decodeUnknownExit(schema);
	const problem = (value: unknown): string | undefined => {
		const exit = decode(value, {onExcessProperty: "error"});
		if (Exit.isSuccess(exit)) return undefined;
		const failure = Cause.squash(exit.cause);
		return failure instanceof Error ? failure.message : String(failure);
	};
	return {
		check: (value): value is T => problem(value) === undefined,
		problem,
		json: jsonSchema(schema),
	};
}

function fromStandard<T>(schema: StandardShape<T>): Shape<T> {
	const validate = (value: unknown) =>
		Effect.runSyncExit(
			Effect.try({try: () => schema["~standard"].validate(value), catch: () => "threw"}),
		);
	const problem = (value: unknown): string | undefined => {
		const exit = validate(value);
		if (Exit.isFailure(exit)) return "the check threw";
		const result = exit.value;
		// A check that does not answer now is a no, never a wait.
		if (result instanceof Promise) {
			result.catch(() => undefined);
			return "the check did not answer at once";
		}
		return result.issues === undefined
			? undefined
			: result.issues.map((issue) => issue.message).join("; ");
	};
	return {
		check: (value): value is T => problem(value) === undefined,
		problem,
		json: undefined,
	};
}

/** Make a shape. Refuses a schema that converts. */
export const shapeOf = <T>(schema: ShapeSchema<T>): Shape<T> =>
	isStandard(schema) ? fromStandard(schema) : fromEffect(schema);

/** The description a declaration must carry. */
export function described(description: string): string {
	if (description.trim() === "") throw new Error("an input or output needs a description");
	return description;
}

/** Declare an input: a value the program is started with. */
export const input = <T>(schema: ShapeSchema<T>, description: string): Input<T> => ({
	direction: "input",
	description: described(description),
	shape: shapeOf(schema),
});

/** Declare an output: a value the program sends while it runs, to anyone who listens. */
export const output = <T>(schema: ShapeSchema<T>, description: string): Output<T> => ({
	direction: "output",
	description: described(description),
	shape: shapeOf(schema),
});

/** What fit answers. */
export type Fit = "fits" | "does_not_fit" | "cannot_tell";

/** Keys that say something about a shape to people and never change what fits. */
const NOTES = new Set(["description", "title", "examples", "default", "$comment", "documentation"]);
/** Keys whose value is a table of named schemas: the names are kept, each schema is cleaned. */
const TABLES = new Set(["properties", "$defs", "definitions", "patternProperties"]);

function bare(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(bare);
	if (node === null || typeof node !== "object") return node;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		if (NOTES.has(key)) continue;
		if (TABLES.has(key) && value !== null && typeof value === "object") {
			out[key] = Object.fromEntries(Object.entries(value).map(([name, s]) => [name, bare(s)]));
			continue;
		}
		out[key] = bare(value);
	}
	return out;
}

/**
 * Does an output's shape fit an input's shape? Exact: the same JSON Schema,
 * once the notes for people are taken out. More fields does not fit, fewer
 * does not fit. A shape with no JSON Schema answers `cannot_tell`.
 */
export function fit(
	from: {readonly shape: Shape<unknown>},
	into: {readonly shape: Shape<unknown>},
): Fit {
	const a = from.shape.json;
	const b = into.shape.json;
	if (a === undefined || b === undefined) return "cannot_tell";
	return structuralHash(bare(a)) === structuralHash(bare(b)) ? "fits" : "does_not_fit";
}
