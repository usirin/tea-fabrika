// Shape 2's library: inputs and outputs are values, and the machine's Msg is built from the
// inputs. next/ only. Elm's ports and Effect's `Rpc.make` are the known way: one typed value per
// message, made once, handed around by reference. tea is not changed: the machine is still
// tea's `Machine.make`, with its update table and its `[model, cmds]` return.
import {Schema} from "effect";
import {
	type Declaration,
	type Door,
	type Fact,
	type FactValue,
	type Output as OutputPart,
	type Refusal,
	type State,
	type WriteCmd,
	caused,
	declare,
	parent,
} from "./lib-common.ts";

export {Fact} from "./lib-common.ts";

/** An input's fields: schemas that decode and encode without services. */
type Fields = {
	readonly [key: string]: Schema.Top & {
		readonly DecodingServices: never;
		readonly EncodingServices: never;
	};
};

/** An input's Msg: its name as `type`, the door's `parent`, and its own fields. */
type MsgFields<N extends string, F extends Fields> = {
	readonly type: Schema.Literal<N>;
	readonly parent: typeof parent;
} & F;

/** A client's input: its name, what it carries, its words, who may send it, what it may cause. */
export type Input<
	N extends string = string,
	F extends Fields = Fields,
	P extends boolean = boolean,
	C extends ReadonlyArray<Fact> = ReadonlyArray<Fact>,
> = {
	readonly name: N;
	readonly schema: Schema.Struct<MsgFields<N, F>>;
	readonly description: string;
	readonly personOnly: P;
	readonly causes: C;
	/** The write this input causes: only one of its own facts, under the door's stamp. */
	write(
		msg: {readonly type: N; readonly parent: string},
		stream: string,
		fact: FactValue<C[number]>,
	): WriteCmd;
};

type Facts = readonly [Fact, ...ReadonlyArray<Fact>];
type Plain = Fact<Fact["schema"], false>;
type PlainFacts = readonly [Plain, ...ReadonlyArray<Plain>];

// One maker, four cases, each written one way: `who` appears only as "person", and `causes` only
// when it names a fact. A plain input may cause only facts that are not person-only.
function makeInput<const N extends string, const F extends Fields, const C extends Facts>(
	name: N,
	spec: {
		readonly fields: F;
		readonly description: string;
		readonly who: "person";
		readonly causes: C;
	},
): Input<N, F, true, C>;
function makeInput<const N extends string, const F extends Fields, const C extends PlainFacts>(
	name: N,
	spec: {readonly fields: F; readonly description: string; readonly causes: C},
): Input<N, F, false, C>;
function makeInput<const N extends string, const F extends Fields>(
	name: N,
	spec: {readonly fields: F; readonly description: string; readonly who: "person"},
): Input<N, F, true, readonly []>;
function makeInput<const N extends string, const F extends Fields>(
	name: N,
	spec: {readonly fields: F; readonly description: string},
): Input<N, F, false, readonly []>;
function makeInput(
	name: string,
	spec: {
		readonly fields: Fields;
		readonly description: string;
		readonly who?: "person";
		readonly causes?: Facts;
	},
): Input {
	const causes = spec.causes ?? [];
	return {
		name,
		schema: Schema.Struct({type: Schema.Literal(name), parent, ...spec.fields}),
		description: spec.description,
		personOnly: spec.who === "person",
		causes,
		write: caused,
	};
}

/** The inputs, as one Msg schema the machine takes. It keeps the inputs for Program.make. */
export type Inputs<T extends ReadonlyArray<Input>> = Schema.Codec<
	T[number]["schema"]["Type"],
	T[number]["schema"]["Encoded"]
> & {readonly inputs: T};

const group = <const T extends readonly [Input, ...ReadonlyArray<Input>]>(inputs: T): Inputs<T> => {
	const union = Schema.Union(inputs.map((i) => i.schema));
	return Object.assign(Schema.make<typeof union>(union.ast), {inputs});
};

export const Input = {make: makeInput, group};

/** An output: a name, its schema and words, and what it sends, picked from the model. */
export type Output<S, A = unknown> = OutputPart<S, A>;
export const Output = {
	make: <S, A>(
		name: string,
		spec: {
			readonly schema: Schema.Codec<A, unknown>;
			readonly description: string;
			/** What it sends now, as `schema` says, or `null` for nothing. */
			readonly select: (model: S) => NoInfer<A> | null;
		},
	): Output<S, A> => ({name, ...spec}),
};

/** What Program.make needs of a machine: tea's machine, its model and its Msg schema. */
type ProgramMachine = {
	readonly model: Schema.Schema<unknown>;
	readonly msg: Schema.Schema<{readonly type: string}>;
	readonly update: object;
	readonly init: (loaded: never, ctx: never) => readonly [unknown, ReadonlyArray<unknown>];
};
type MachineModel<T extends ProgramMachine> = T["model"]["Type"];

/** The program: its machine and what only a program has. Every empty part is left out. */
export type Program<T extends ProgramMachine, I extends ReadonlyArray<Input>, V> = {
	readonly name: string;
	readonly machine: T;
	readonly inputs: Inputs<I>;
	readonly view: (model: MachineModel<T>) => V;
	readonly outputs: ReadonlyArray<Output<MachineModel<T>>>;
	/** What the runner loads. */
	readonly declared: Declaration;
};

const make = <
	T extends ProgramMachine,
	const I extends ReadonlyArray<Input>,
	V extends Schema.Json,
>(spec: {
	readonly name: string;
	readonly machine: T;
	/** The same group the machine's `msg` is: tsc checks the Msg types, the load checks it is one value. */
	readonly inputs: Inputs<I> & Schema.Schema<T["msg"]["Type"]>;
	readonly view: (model: MachineModel<T>) => V;
	/** A pure check of a fresh input against the model. Left out, nothing is refused. */
	readonly refuse?: (model: MachineModel<T>, msg: I[number]["schema"]["Type"]) => Refusal | null;
	readonly outputs?: readonly [Output<MachineModel<T>>, ...ReadonlyArray<Output<MachineModel<T>>>];
	/** When the runner should wake it. Left out, it never wakes. */
	readonly wake?: (model: MachineModel<T>) => number | null;
	readonly state?: State;
}): Program<T, I, V> => {
	if (spec.inputs !== spec.machine.msg) throw new Error("inputs must be the machine's own msg");
	const doors: ReadonlyArray<Door> = spec.inputs.inputs;
	const facts = [...new Set(spec.inputs.inputs.flatMap((one) => one.causes))];
	return {
		name: spec.name,
		machine: spec.machine,
		inputs: spec.inputs,
		view: spec.view,
		outputs: spec.outputs ?? [],
		declared: declare({
			name: spec.name,
			machine: spec.machine,
			doors,
			facts,
			view: spec.view,
			refuse: spec.refuse ?? (() => null),
			outputs: spec.outputs ?? [],
			wake: spec.wake ?? (() => null),
			state: spec.state,
		}),
	};
};

export const Program = {make};
