import {Effect} from "effect";
import {described, type Input, type JsonSchema, type Output, type PayloadOf} from "./shape.ts";

// A program: the thing you start. It has a name, a sentence that says what it
// does, typed inputs and outputs, and `main`. It is not a machine. A machine
// is a data structure, a state and the rules that move it (tea's
// `defineMachine`). A program *uses* machines: `main` runs one or more of them
// with tea's Effect engine, and does the program's I/O.
//
//   const ship = defineProgram({
//     name: "ship",
//     description: "Puts pull requests in the merge queue, one after another.",
//     inputs: {prs: input(Urls, "The pull requests to ship.")},
//     outputs: {outcome: output(Shipped, "How one pull request ended.")},
//     main: ({prs}, send) =>
//       Effect.forEach(prs, (pr) => runShipMachine(pr).pipe(Effect.flatMap((o) => send("outcome", o)))),
//   });
//
//   start(ship, {prs: [url]}, {outcome: (o) => console.log(o)})
//   // Effect<Started, E, CodeHost | CodeHostWrites>: the services come from the caller's Layers
//
// Inputs are the values a program is started with, like Elm's flags: they are
// checked against their shapes before `main` runs, and a value that does not
// fit answers `bad_shape` and runs nothing. Outputs are one-way, like Elm's
// outgoing ports: `main` sends, whoever started it hears, nothing comes back.
// A program asks for services (`CodeHost`, `CodeHostWrites`, ...) through
// Effect's context and never makes a real connection itself: the caller
// provides them, so a test hands it fake Layers.

export type Inputs = Readonly<Record<string, Input<any>>>;
export type Outputs = Readonly<Record<string, Output<any>>>;

/** The values a program is started with: one per input, typed by its schema. */
export type Given<I extends Inputs> = {readonly [K in keyof I]: PayloadOf<I[K]>};

/** How `main` sends a value on one of its outputs. A value its output's shape refuses is a bug in the program, and dies. */
export type Send<O extends Outputs> = <K extends keyof O & string>(
	name: K,
	value: PayloadOf<O[K]>,
) => Effect.Effect<void>;

export interface Program<I extends Inputs, O extends Outputs, E, R> {
	readonly name: string;
	readonly description: string;
	readonly inputs: I;
	readonly outputs: O;
	/** The program itself: runs its machines, asks for its services, sends its outputs. */
	readonly main: (given: Given<I>, send: Send<O>) => Effect.Effect<void, E, R>;
}

export type AnyProgram = Program<any, any, any, any>;

/** Define a program. A blank name or description is refused here; `input` and `output` refuse a blank one of theirs. */
export function defineProgram<I extends Inputs, O extends Outputs, E = never, R = never>(
	program: Program<I, O, E, R>,
): Program<I, O, E, R> {
	if (program.name.trim() === "") throw new Error("a program needs a name");
	described(program.description);
	return program;
}

/** What `start` answers when `main` did not fail. */
export type Started =
	| {readonly kind: "ran"}
	/** `input`: the first input that did not fit, by name. `why`: what is wrong with it, in the schema's words. `main` never ran. */
	| {readonly kind: "bad_shape"; readonly input: string; readonly why: string};

export type BadShape = Extract<Started, {readonly kind: "bad_shape"}>;

/** The listeners of a run: at most one per output. An output with none is sent all the same, and nobody hears it. */
export type Hear<O extends Outputs> = {
	readonly [K in keyof O]?: (value: PayloadOf<O[K]>) => void;
};

/**
 * Read values from outside (a host's JSON, a command line) as a program's
 * inputs. It answers the inputs, typed, or the first one that does not fit.
 * A name the program does not declare does not fit either.
 */
export function readInputs<I extends Inputs>(
	program: {readonly name: string; readonly inputs: I},
	raw: unknown,
): {readonly kind: "given"; readonly given: Given<I>} | BadShape {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		return {kind: "bad_shape", input: "", why: "the inputs are not a table of named values"};
	const values = new Map(Object.entries(raw));
	for (const name of values.keys())
		if (!Object.hasOwn(program.inputs, name))
			return {kind: "bad_shape", input: name, why: `${program.name} has no input named ${name}`};
	for (const [name, declared] of Object.entries<Input<unknown>>(program.inputs)) {
		const why = declared.shape.problem(values.get(name));
		if (why !== undefined) return {kind: "bad_shape", input: name, why};
	}
	// Every declared input passed its own shape's check and no other name is
	// there. That is what `Given<I>` says; the compiler cannot add the checks up.
	return {kind: "given", given: raw as Given<I>};
}

/**
 * Start a program and run it to its end. Its inputs are checked first, even
 * typed ones, since a type cannot hold every check (a url's pattern): one that
 * does not fit answers `bad_shape`, and `main` never runs. Each value `main`
 * sends is checked against its output's shape, then handed to that output's
 * listener in `hear`, in the order it was sent.
 */
export const start = <I extends Inputs, O extends Outputs, E, R>(
	program: Program<I, O, E, R>,
	given: Given<I>,
	hear: Hear<O> = {},
): Effect.Effect<Started, E, R> =>
	Effect.suspend(() => {
		const read = readInputs(program, given);
		if (read.kind === "bad_shape") return Effect.succeed<Started>(read);
		const send: Send<O> = (name, value) =>
			Effect.suspend(() => {
				const declared: Output<unknown> | undefined = program.outputs[name];
				const why =
					declared === undefined ? "there is no such output" : declared.shape.problem(value);
				if (why !== undefined)
					return Effect.die(
						new Error(`${program.name} sent its output ${name} a value it does not take: ${why}`),
					);
				return Effect.sync(() => hear[name]?.(value));
			});
		return program.main(read.given, send).pipe(Effect.as<Started>({kind: "ran"}));
	});

/** One input or output, as a host shows it. */
export interface Listed {
	readonly name: string;
	readonly description: string;
	/** `undefined`: the shape gives no JSON Schema. */
	readonly schema: JsonSchema | undefined;
}

/** What a host shows of a program without reading its code: a man page. */
export interface Listing {
	readonly name: string;
	readonly description: string;
	readonly inputs: readonly Listed[];
	readonly outputs: readonly Listed[];
}

const listed = (declared: Readonly<Record<string, Input<unknown> | Output<unknown>>>) =>
	Object.entries(declared).map(([name, d]) => ({
		name,
		description: d.description,
		schema: d.shape.json,
	}));

export const listing = (program: AnyProgram): Listing => ({
	name: program.name,
	description: program.description,
	inputs: listed(program.inputs),
	outputs: listed(program.outputs),
});
