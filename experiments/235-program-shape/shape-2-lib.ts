// Shape 2's library, as decided on 2026-11-08: inputs, events and outputs are values, and the
// machine's Msg is built from the inputs. next/ only. Elm's ports and Effect's `Rpc.make` are the
// known way: one typed value per message, made once, handed around by reference. tea is not
// changed: the machine is still tea's `Machine.make`, with its update table and `[model, cmds]`.
import {type CmdDef} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {type Brand, Schema} from "effect";
import {
	type Declaration,
	type Door,
	type FactSchema as EventSchema,
	type Output as OutputPart,
	type Refusal,
	type State,
	declare,
	parent,
	schemaTag,
	seal,
	writeErrs,
	writeFields,
} from "./lib-common.ts";

/** A schema that decodes and encodes without services. */
type Pure = Schema.Top & {readonly DecodingServices: never; readonly EncodingServices: never};

/** An input's fields. */
type Fields = {readonly [key: string]: Pure};

/** An input's Msg: its name as `type`, the door's `parent`, and its own fields. */
type MsgSchema<N extends string, F extends Fields> = Schema.Struct<
	{readonly type: Schema.Literal<N>; readonly parent: typeof parent} & F
>;

/**
 * What a person-only input's Msg carries in its type: the door let it in from a person. A type
 * only, as Effect's `Schema.brand` makes it; the Msg on the wire is plain data.
 */
type FromPerson = Brand.Brand<"FromPerson">;

/** A client's input: its name, its Msg schema, its words, and whether only a person may send it. */
export type Input<
	N extends string = string,
	S extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
	P extends boolean = boolean,
> = {
	readonly name: N;
	readonly schema: S;
	readonly description: string;
	readonly personOnly: P;
};

// One maker, two cases, each written one way: `personOnly` appears only as `true`. Left out, any
// client may send it. A person-only input's Msg is branded `FromPerson`.
function makeInput<const N extends string, const F extends Fields>(
	name: N,
	spec: {readonly fields: F; readonly description: string; readonly personOnly: true},
): Input<N, Schema.brand<MsgSchema<N, F>, "FromPerson">, true>;
function makeInput<const N extends string, const F extends Fields>(
	name: N,
	spec: {readonly fields: F; readonly description: string},
): Input<N, MsgSchema<N, F>, false>;
function makeInput(
	name: string,
	spec: {readonly fields: Fields; readonly description: string; readonly personOnly?: true},
): Omit<Input, "schema"> & {readonly schema: unknown} {
	const schema = Schema.Struct({type: Schema.Literal(name), parent, ...spec.fields});
	return {
		name,
		schema: spec.personOnly ? schema.pipe(Schema.brand("FromPerson")) : schema,
		description: spec.description,
		personOnly: spec.personOnly === true,
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

type WriteErr = {readonly _tag: (typeof writeErrs)[number]};
type WriteIn = Schema.Struct<typeof writeFields>["Type"];
type WriteDef<S extends EventSchema> = CmdDef<S["Type"]["_tag"], WriteIn, Schema.Json, WriteErr>;

/** The Msg an event's write takes: any input's, or, for a person-only event, a person's alone. */
type Cause<P extends boolean> = {readonly parent: string} & (P extends true ? FromPerson : unknown);

/**
 * An event's write Cmd. To tea it is a Cmd like any other: listed in `cmds`, answered by
 * `<event>_ok` and `<event>_err`. A step calls it with the input's Msg and the event.
 */
export type EventWrite<S extends EventSchema, P extends boolean> = WriteDef<S> &
	((msg: Cause<P>, event: S["Type"]) => ReturnType<WriteDef<S>>);

/** An event a program may write: its schema, who may cause it, and its write Cmd. */
export type Event<S extends EventSchema = EventSchema, P extends boolean = boolean> = {
	readonly schema: S;
	readonly personOnly: P;
	readonly write: EventWrite<S, P>;
};

/** Each event, by its write Cmd, so Program.make reads the events off the machine's `cmds`. */
const byWrite = new WeakMap<object, Event>();

// One maker, two cases: `personOnly` appears only as `true`. `stream` says where the event goes,
// once, so no step writes it.
function makeEvent<S extends EventSchema>(
	schema: S,
	spec: {readonly stream: (event: S["Type"]) => string; readonly personOnly: true},
): Event<S, true>;
function makeEvent<S extends EventSchema>(
	schema: S,
	spec: {readonly stream: (event: S["Type"]) => string},
): Event<S, false>;
function makeEvent<S extends EventSchema>(
	schema: S,
	spec: {readonly stream: (event: S["Type"]) => string; readonly personOnly?: true},
): Event<S> {
	const tag: S["Type"]["_tag"] = schemaTag(schema);
	const def = Cmd.make(tag, {input: Schema.Struct(writeFields), ok: Schema.Json, err: writeErrs});
	const call = (msg: {readonly parent: string}, event: S["Type"]) =>
		def({stream: spec.stream(event), write: seal(msg, event)});
	// The Cmd tea lists, called with a Msg and an event. Libfabrika makes it; no program does.
	const event: Event<S> = {
		schema,
		personOnly: spec.personOnly === true,
		write: Object.assign(call, def),
	};
	byWrite.set(event.write, event);
	return event;
}

export const Event = {make: makeEvent};

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

/** What Program.make needs of a machine: tea's machine, its model, Msg schema and Cmds. */
type ProgramMachine = {
	readonly model: Schema.Schema<unknown>;
	readonly msg: Schema.Schema<{readonly type: string}>;
	readonly cmds?: ReadonlyArray<object>;
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

/** The events a machine writes: the event writes among its `cmds`. No second list to keep. */
const eventsIn = (cmds: ReadonlyArray<object>): ReadonlyArray<Event> =>
	cmds.flatMap((cmd) => {
		const event = byWrite.get(cmd);
		return event === undefined ? [] : [event];
	});

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
			facts: eventsIn(spec.machine.cmds ?? []),
			view: spec.view,
			refuse: spec.refuse ?? (() => null),
			outputs: spec.outputs ?? [],
			wake: spec.wake ?? (() => null),
			state: spec.state,
		}),
	};
};

export const Program = {make};
