import {structuralHash} from "@demlik/tea";
import {Cause, Effect, Exit, Schema, SchemaAST} from "effect";
import {type Person, personOf} from "./person.ts";

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
/** A flag a line must give: it has no default, and its shape does not take `undefined`. */
export const mustBeGiven = (declared: Flag<unknown>): boolean =>
	declared.default === undefined && declared.shape.problem(undefined) !== undefined;
/**
 * When a value told to an input counts as taken: AMQP's two acknowledgement
 * modes. `auto`: once `serve` takes it out of the mailbox. `manual`: once its
 * handler says so, after it has saved the value; a pipe into it keeps the value in
 * its sender's outbox until then (./outbox.ts).
 */
export type Ack = "auto" | "manual";
/** A value a running program can be told at any time, like a line on stdin. */
export interface Input<T, A extends Ack = Ack, C extends boolean = boolean>
	extends Declared<"input", T> {
	readonly ack: A;
	/**
	 * A control input, like Akka's `ControlMessage`: a Ctrl-C, a cancel. Its
	 * values skip the run's mailbox. `main` handles each at once, beside the
	 * order, with a `fork` handler, and they count against a small bound of
	 * their own, so a full mailbox never refuses one. `false`: an ordinary
	 * input, whose values wait their turn in the mailbox.
	 */
	readonly control: C;
	/**
	 * `false` (`{writes: false}`): a value told to it changes no data, only what the run shows, as
	 * CQRS keeps a query apart from a command. Its MCP tool carries `readOnlyHint`.
	 */
	readonly writes: boolean;
	/** `true` (`{personOnly: true}`): only a person tells it. An agent's MCP tools have none for it. */
	readonly personOnly: boolean;
	/**
	 * `true`: it takes any value, and a pipe may feed it from any output that fits no typed
	 * input of the program (`anyInput`). Only `anyInput` sets it, always with `Schema.Unknown`.
	 */
	readonly any?: true;
}

/**
 * A program's mailbox capacity when it says none: the default
 * `mailbox-capacity` of Akka's bounded mailbox (experiment 79).
 */
export const CAPACITY = 1000;

/** `capacity`, if it is one a mailbox can hold: a whole number, 1 or more. Refused here otherwise, when the program is defined. */
export function capacityOf(capacity: number): number {
	if (!Number.isInteger(capacity) || capacity < 1)
		throw new Error(`a mailbox's capacity is a whole number, 1 or more, not ${capacity}`);
	return capacity;
}
/** A value a program sends while it runs. One-way: nothing comes back, but a pipe's ack into an input that acks. */
export interface Output<T> extends Declared<"output", T> {
	/**
	 * How tsh shows its values to a person at a terminal (./person.ts): one line each, one table,
	 * or nothing, as Rust's `Display` is to its `Debug`. Left out, tsh prints its short form
	 * (`shortOf`), which knows only the value's fields. A pipe, `$( )` and `tsh --json` never use it.
	 */
	readonly person?: Person<T>;
}

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
 * `{ack: "manual"}`: `main` is handed each value with the way to say it is
 * saved (a `Delivery`), and says so once it is. `{control: true}`: a control
 * input, handled at once beside the order ({@link Input}'s `control`).
 * `{writes: false}`: a query, which changes no data. `{personOnly: true}`: only a person tells it.
 *
 *   input(Line, "A line typed at the prompt.")                      // waits its turn in the mailbox
 *   input(Signal, "Ctrl-C: stops the foreground job.", {control: true})   // never waits behind a line
 *   input(Query, "Read tickets. Writes nothing.", {writes: false})        // its tool says it only reads
 *   input(Answer, "Answer an ask. A person only.", {personOnly: true})    // an agent has no tool for it
 */
export const input = <T, const A extends Ack = "auto", const C extends boolean = false>(
	schema: ShapeSchema<T>,
	description: string,
	options?: {
		readonly ack?: A;
		readonly control?: C;
		readonly writes?: false;
		readonly personOnly?: true;
	},
): Input<T, A, C> => ({
	direction: "input",
	description: described(description),
	shape: shapeOf(schema),
	// Left out, `A` is its default, "auto", and `C` is `false`.
	ack: options?.ack ?? ("auto" as A),
	control: options?.control ?? (false as C),
	writes: options?.writes ?? true,
	personOnly: options?.personOnly ?? false,
});

/**
 * Declare an input that takes any value: Elm's `Json.Decode.value`, JSON Schema's `{}`. A pipe
 * feeds it from an output that fits no typed input of the program, so a program can stand in a
 * line without caring what flows in it, as `cat > /dev/null` does on Unix. Its shape is
 * `Schema.Unknown`. A program that takes `Schema.Unknown` through `input` is fed only by an
 * output of that same shape: a plain `input` never takes anything by accident. It writes no
 * data, and no agent gets a tool for it: what it is sent goes unread.
 *
 *   inputs: {any: anyInput("Anything on a pipe. Being in the line is enough.")}
 *   // tsh> seq --to 3 | tally | trace     tally's total fits no typed input of trace: wired total → any
 */
export const anyInput = (description: string): Input<unknown, "auto", false> => ({
	...input(Schema.Unknown, description, {writes: false}),
	any: true,
});

/**
 * Declare an output: a value the program sends while it runs, to anyone who listens.
 * `{person}`: how tsh shows its values to a person ({@link Output}'s `person`, ./person.ts).
 *
 *   output(Comparison, "Two runs.", {person: {line: Comparison.toLine}})   // 77b-5 against 77b-6: …
 *   output(Schema.String, "The page as markdown.", {person: "none"})       // for a pipe or a window
 */
export const output = <T, const H extends string = never>(
	schema: ShapeSchema<T>,
	description: string,
	options?: {readonly person?: Person<T, H>},
): Output<T> => ({
	direction: "output",
	description: described(description),
	shape: shapeOf(schema),
	...(options?.person === undefined ? {} : {person: personOf(options.person)}),
});

/**
 * What fit answers. `takes_any`: the input takes any value (`anyInput`), and the output's shape
 * is not its own. A wiring picks a `fits` first, and a `takes_any` only when nothing fits.
 */
export type Fit = "fits" | "takes_any" | "does_not_fit" | "cannot_tell";

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
 * fewer does not fit. A shape with no JSON Schema answers `cannot_tell`. An
 * input made by `anyInput` answers `takes_any` for every other shape.
 */
export function fit(
	from: {readonly shape: Shape<unknown>},
	into: {readonly shape: Shape<unknown>; readonly any?: true},
): Fit {
	const a = from.shape.json;
	const b = into.shape.json;
	if (a === undefined || b === undefined) return into.any === true ? "takes_any" : "cannot_tell";
	const sent = structuralHash(bare(a));
	const taken = [b, ...membersOf(b)];
	if (taken.some((shape) => structuralHash(bare(shape)) === sent)) return "fits";
	return into.any === true ? "takes_any" : "does_not_fit";
}

/** The members of a union's JSON Schema; none for any other. */
function membersOf(json: unknown): ReadonlyArray<unknown> {
	if (json === null || typeof json !== "object" || !("anyOf" in json)) return [];
	return Array.isArray(json.anyOf) ? json.anyOf : [];
}
