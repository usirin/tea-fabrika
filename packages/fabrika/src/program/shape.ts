import {structuralHash} from "@demlik/tea";
import {Cause, Effect, Exit, Schema, SchemaAST} from "effect";

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
export interface Declared<D extends "flag" | "input" | "output", T> {
	readonly direction: D;
	readonly description: string;
	readonly shape: Shape<T>;
}
/** A value a program is started with, once, like argv. */
export interface Flag<T> extends Declared<"flag", T> {
	/** What a run is started with when the flag is not given. Left out: it must be given, unless its shape takes `undefined`. */
	readonly default?: {readonly value: T};
}
/**
 * When a value told to an input counts as taken: AMQP's two acknowledgement
 * modes. `auto`: once `main` reads it off the line. `manual`: once `main`
 * says so, after it has saved the value; a pipe into it keeps the value in
 * its sender's outbox until then (./outbox.ts).
 */
export type Ack = "auto" | "manual";
/** A value a running program can be told at any time, like a line on stdin. */
export interface Input<T, A extends Ack = Ack> extends Declared<"input", T> {
	readonly ack: A;
	/**
	 * How many values its line holds that `main` has not read yet, from every
	 * writer: Akka's `mailbox-capacity`. A `tell` past it fails `Full`; `offer`,
	 * a pipe and `call` wait for room. A whole number, 1 or more.
	 */
	readonly capacity: number;
}

/**
 * An input's capacity when its program does not say one: the default
 * `mailbox-capacity` of Akka's bounded mailbox (experiment 79).
 */
export const CAPACITY = 1000;

/** `capacity`, if it is one a line can hold: a whole number, 1 or more. Refused here otherwise, when the program is defined. */
export function capacityOf(capacity: number): number {
	if (!Number.isInteger(capacity) || capacity < 1)
		throw new Error(`an input's capacity is a whole number, 1 or more, not ${capacity}`);
	return capacity;
}
/** A value a program sends while it runs. One-way: nothing comes back, but a pipe's ack into an input that acks. */
export type Output<T> = Declared<"output", T>;

/** The payload type a declaration carries. */
export type PayloadOf<D> = D extends {readonly shape: Shape<infer T>} ? T : never;

/**
 * An Effect schema as JSON Schema, in the one shape the Agent SDK takes: a
 * single object, closed to fields it does not name, with the parts it refers
 * to under `$defs`. Effect hands back a document (`dialect`, `schema`,
 * `definitions`), which Claude Code refuses as it comes, so it is unwrapped.
 */
export const jsonSchemaOf = (schema: Schema.Top): JsonSchema => {
	const {schema: root, definitions} = Schema.toJsonSchemaDocument(schema, {
		onExcessProperty: "error",
	});
	return Object.keys(definitions).length === 0 ? {...root} : {...root, $defs: definitions};
};

// Asked as "not Effect", never as "has `~standard`": `Schema.toStandardSchemaV1`
// (which tea's Effect `Cmd.define` calls) sets `~standard` on the Effect schema it is given.
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
		json: jsonSchemaOf(schema),
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

/**
 * Declare a flag: a value the program is started with, once. `{default}`:
 * the value a run is started with when the flag is not given.
 */
export const flag = <T>(
	schema: ShapeSchema<T>,
	description: string,
	options?: {readonly default: NoInfer<T>},
): Flag<T> => {
	const declared: Flag<T> = {
		direction: "flag",
		description: described(description),
		shape: shapeOf(schema),
	};
	return options === undefined ? declared : defaulted(declared, options.default);
};

/** The same flag, with `value` as its default. A value that does not fit the flag's shape is refused here. */
export function defaulted<T>(declared: Flag<T>, value: T): Flag<T> {
	const why = declared.shape.problem(value);
	if (why !== undefined) throw new Error(`a default must fit its flag: ${why}`);
	return {...declared, default: {value}};
}

/**
 * Declare an input: a value a running program can be told at any time.
 * `{ack: "manual"}`: `main` reads each value with the way to say it is saved
 * (a `Delivery`), and says so once it is. `{capacity}`: how many unread
 * values its line holds, `CAPACITY` when left out; one that is not a whole
 * number, 1 or more, is refused here.
 *
 *   input(Line, "A line typed at the prompt.", {capacity: 16})   // the 17th unread tell fails `Full`
 */
export const input = <T, const A extends Ack = "auto">(
	schema: ShapeSchema<T>,
	description: string,
	options?: {readonly ack?: A; readonly capacity?: number},
): Input<T, A> => ({
	direction: "input",
	description: described(description),
	shape: shapeOf(schema),
	// Left out, `A` is its default, "auto".
	ack: options?.ack ?? ("auto" as A),
	capacity: capacityOf(options?.capacity ?? CAPACITY),
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
 * once the notes for people are taken out, or the same as one member of an
 * input that is a union (`anyOf`), since a union takes each of its members,
 * as a TypeScript union takes each of its members. More fields does not fit,
 * fewer does not fit. A shape with no JSON Schema answers `cannot_tell`.
 */
export function fit(
	from: {readonly shape: Shape<unknown>},
	into: {readonly shape: Shape<unknown>},
): Fit {
	const a = from.shape.json;
	const b = into.shape.json;
	if (a === undefined || b === undefined) return "cannot_tell";
	const sent = structuralHash(bare(a));
	const taken = [b, ...membersOf(b)];
	return taken.some((shape) => structuralHash(bare(shape)) === sent) ? "fits" : "does_not_fit";
}

/** The members of a union's JSON Schema; none for any other. */
function membersOf(json: unknown): ReadonlyArray<unknown> {
	if (json === null || typeof json !== "object" || !("anyOf" in json)) return [];
	return Array.isArray(json.anyOf) ? json.anyOf : [];
}
