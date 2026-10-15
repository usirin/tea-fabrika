import {
	type AnyCmdDef,
	type BuiltinSub,
	type Cmd,
	type CmdOf,
	type DepKeyedSub,
	defineMachine,
	definePort,
	type Machine,
	type Port,
	type Settled,
	type Sub,
	type Transitions,
} from "@demlik/tea";
import {
	described,
	type Input,
	type JsonSchema,
	type PayloadOf,
	type Shape,
	type ShapeSchema,
	shapeOf,
} from "./shape.ts";

// tea-program: a tea machine with typed inputs and outputs, and a listing of
// them. It sits on @demlik/tea as it is published and changes nothing in it.
//
//   const announced = output("ship_announced", Outcome, "Every outcome, for anyone listening.");
//   const ship = defineProgram({
//     name: "ship",
//     description: "Puts one pull request at a time in the merge queue.",
//     inputs: {hand: input(PR, "A pull request to put in the merge queue.")},
//     outputs: [announced],
//     ...  // types, cmds, init, update, subs: as in defineMachine
//   });
//
// An input is an ordinary Msg, `{type: "hand", payload}`. Its type comes from
// the schema: the author writes no Msg type for it. An output is an ordinary
// Cmd, `announced(value)`, returned from `update` like any other. Its handler
// belongs to tea-program: it puts the value on a tea Port, so any number of
// listeners hear it, none is fine, and nothing comes back. Elm's outgoing port.
//
// A value that must arrive is not an output. It is the program's own
// `Cmd.define`d Cmd, and the host's handler for it calls `tell` (./tell.ts)
// and answers ok or err. Elm's Http with expectJson.

/** A declared output: a Cmd constructor, with the Port its value goes out on. */
export interface Output<N extends string, T> {
	(payload: T): OutCmd<N, T>;
	/** Its Cmd type and its name. (`name` is taken: a function's own, read-only.) */
	readonly type: N;
	readonly direction: "output";
	readonly description: string;
	readonly shape: Shape<T>;
	readonly port: Port<T>;
}

/** The Cmd an output builds. Hand-written, not `Cmd.define`d: it settles with no Msg, so no `_ok` or `_err` cell is owed. */
export type OutCmd<N extends string, T> = Cmd<N> & {readonly payload: T};

export type AnyOutput = Output<string, any>;
export type Inputs = Readonly<Record<string, Input<any>>>;

/** Declare an output. `name` is its Cmd type, and names its Port, so it is unique in the process. */
export function output<const N extends string, T>(
	name: N,
	schema: ShapeSchema<T>,
	description: string,
): Output<N, T> {
	const shape = shapeOf(schema);
	const build = (payload: T): OutCmd<N, T> => ({type: name, payload});
	return Object.assign(build, {
		type: name,
		direction: "output" as const,
		description: described(description),
		shape,
		port: definePort<T>(`program-output:${name}`),
	});
}

/** The Msgs a table of inputs brings in, one per input, typed by its schema. */
export type InputMsg<I extends Inputs> = {
	readonly [K in keyof I & string]: {readonly type: K; readonly payload: PayloadOf<I[K]>};
}[keyof I & string];

/** The Cmds a list of outputs sends. */
export type OutCmdOf<O extends AnyOutput> =
	O extends Output<infer N, infer T> ? OutCmd<N, T> : never;

/** A program: its machine, and what it takes in and sends out. */
export interface Program<
	S extends {type: string},
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	I extends Inputs,
	O extends AnyOutput,
> {
	readonly name: string;
	readonly description: string;
	readonly machine: Machine<S, M, C, U, undefined>;
	readonly inputs: I;
	readonly outputs: readonly O[];
}

export type AnyProgram = Program<any, any, any, any, any, any>;
export type StateOf<P> =
	P extends Program<infer S, infer _M, infer _C, infer _U, infer _I, infer _O> ? S : never;
export type MsgOf<P> =
	P extends Program<infer _S, infer M, infer _C, infer _U, infer _I, infer _O> ? M : never;
export type CmdOfProgram<P> =
	P extends Program<infer _S, infer _M, infer C, infer _U, infer _I, infer _O> ? C : never;
export type SubOf<P> =
	P extends Program<infer _S, infer _M, infer _C, infer U, infer _I, infer _O> ? U : never;
export type InputsOf<P> =
	P extends Program<infer _S, infer _M, infer _C, infer _U, infer I, infer _O> ? I : never;
export type OutputsOf<P> =
	P extends Program<infer _S, infer _M, infer _C, infer _U, infer _I, infer O> ? O : never;

/** The spec `defineProgram` takes. */
export interface ProgramSpec<
	S extends {type: string},
	M extends {type: string},
	D extends AnyCmdDef,
	I extends Inputs,
	O extends AnyOutput,
	U extends Sub,
> {
	readonly name: string;
	readonly description: string;
	readonly inputs: I;
	readonly outputs: readonly O[];
	readonly types: {readonly model: S; readonly msg: M; readonly sub?: U};
	readonly cmds: readonly D[];
	readonly init: NoInfer<(loaded: S | null) => readonly [S, readonly (CmdOf<D> | OutCmdOf<O>)[]]>;
	readonly update: NoInfer<Transitions<S, M | InputMsg<I> | Settled<D>, CmdOf<D> | OutCmdOf<O>>>;
	readonly subs?: NoInfer<
		ReadonlyArray<DepKeyedSub<S, U | BuiltinSub<M | InputMsg<I> | Settled<D>>>>
	>;
}

/**
 * Define a program. Everything `defineMachine` takes, in its transitions form,
 * plus `inputs`, `outputs`, a name and a description.
 *
 * The update table's Msg is the author's own Msgs, the inputs' Msgs and the
 * settled Msgs of `cmds`; its Cmd is `cmds`' Cmds and the outputs' Cmds. Only
 * the first is written by hand.
 */
export function defineProgram<
	S extends {type: string},
	M extends {type: string},
	D extends AnyCmdDef,
	I extends Inputs,
	O extends AnyOutput,
	U extends Sub = Sub<never>,
>(
	spec: ProgramSpec<S, M, D, I, O, U>,
): Program<S, M | InputMsg<I> | Settled<D>, CmdOf<D> | OutCmdOf<O>, U, I, O>;
// The body is typed loosely on purpose. tea's `update` slot is a conditional
// type on the state (`[S] extends [{type: string}] ? Transitions : never`),
// which stays unresolved for a generic S, and its overloads take a machine's
// Cmd union from `cmds` alone. So a wrapper that adds Cmds of its own cannot
// hand the typed spec to `defineMachine`; the signature above is the promise.
export function defineProgram(spec: ProgramSpec<any, any, any, any, any, any>): AnyProgram {
	described(spec.description);
	const machine: Machine<any, any, any, any, undefined> = defineMachine({
		types: {model: spec.types.model, msg: spec.types.msg, ctx: undefined},
		cmds: spec.cmds,
		init: spec.init,
		update: spec.update,
		...(spec.subs === undefined ? {} : {subs: spec.subs}),
	});
	return {
		name: spec.name,
		description: spec.description,
		machine,
		inputs: spec.inputs,
		outputs: spec.outputs,
	};
}

/** One line of a program's listing. */
export interface Listed {
	readonly name: string;
	readonly direction: "input" | "output";
	readonly description: string;
	readonly schema: JsonSchema | undefined;
}

/** What a program takes in and sends out, as data: a man page. */
export const listing = (program: AnyProgram): readonly Listed[] => [
	...Object.entries<Input<unknown>>(program.inputs).map(([name, d]) => ({
		name,
		direction: d.direction,
		description: d.description,
		schema: d.shape.json,
	})),
	...program.outputs.map((o: AnyOutput) => ({
		name: o.type,
		direction: o.direction,
		description: o.description,
		schema: o.shape.json,
	})),
];
