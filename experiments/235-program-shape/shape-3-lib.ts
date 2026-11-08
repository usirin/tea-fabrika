// Shape 3's library: one record per input, holding its fields, words, gate, refusal and step, and
// one per Cmd, holding its two answers. Program.make builds the tea machine from them. next/ only.
// The known way is Redux Toolkit's `createSlice` (the reducers' keys make the action types) and
// XState v5's `setup`, which fixes the types first so every named part is checked. tea is not
// changed: the machine it builds is tea's own `Machine.make`, which a parent can still step.
import type {AnyCmdDef, CmdOf, Machine as TeaMachine, Settled, Sub} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {
	type Declaration,
	type Door,
	type Fact,
	type FactValue,
	type Output,
	type Refusal,
	type State,
	type WriteCmd,
	type WriteDef,
	Fact as Facts,
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

/** What one step returns: the next model and the Cmds to run. Both always written, as Elm does. */
export type Next<S, C> = {readonly model: S; readonly cmds: ReadonlyArray<C>};

/** What an input's step gets: its fields and the door's `parent`. Its name is its key. */
type Got<F extends Fields> = Schema.Struct<F>["Type"] & {readonly parent: string};

/** A write the input causes, under its own stamp. Only the facts its sender may cause fit. */
type Writer<A> = (stream: string, fact: A) => WriteCmd;

/** Marks a record `input` made, so a hand-written one, which skips the gate, does not compile. */
declare const made: unique symbol;

/** One input, as Program.make keeps it. `G` is its fields, kept so the Msg type can be built. */
type Spec<S, C, G extends Fields = Fields> = {
	readonly [made]: true;
	readonly fields: G;
	readonly description: string;
	readonly personOnly: boolean;
	refuse(model: S, msg: Got<Fields>): Refusal | null;
	update(model: S, msg: Got<Fields>, write: Writer<FactValue<Fact>>): Next<S, C>;
};

/** Any Msg, as the built table takes it: the runner decoded it before the table sees it. */
type Raw = Got<Fields> & {readonly value: unknown; readonly error: unknown; readonly at: number};

/** A Cmd's two answers. */
type Answers<S, C, D> = D extends AnyCmdDef
	? Settled<D> extends infer M
		? {
				readonly ok: (
					model: S,
					value: Extract<M, {readonly value: unknown}>["value"],
				) => Next<S, C>;
				readonly err: (
					model: S,
					error: Extract<M, {readonly error: unknown}>["error"],
				) => Next<S, C>;
			}
		: never
	: never;

type Plain = Fact<Fact["schema"], false>;

/** The Msg each input makes: its key as `type`, the door's `parent`, its fields. */
type InputMsg<I> = {
	readonly [K in keyof I & string]: I[K] extends {readonly fields: infer G extends Fields}
		? {readonly type: K} & Got<G>
		: never;
}[keyof I & string];

/** A list with at least one item: an optional list is left out, never written empty. */
type Some<T> = readonly [T, ...ReadonlyArray<T>];

/**
 * Fixes the model, the facts and the Cmds first, as XState's `setup` does, so that each input's
 * step below is checked against them. `input` makes one input; `make` makes the program.
 */
const over = <
	S,
	const F extends Some<Fact> = never,
	const D extends Some<AnyCmdDef> = never,
>(parts: {
	readonly model: Schema.Schema<S>;
	/** The facts it writes. Left out, it writes none. */
	readonly facts?: F;
	/** The Cmds it runs, beside the runner's write. Left out, it runs none. */
	readonly cmds?: D;
}) => {
	type C = CmdOf<D[number]> | ([F] extends [never] ? never : WriteCmd);
	type Person = FactValue<F[number]>;
	type Anyone = FactValue<Extract<F[number], Plain>>;
	const facts: ReadonlyArray<Fact> = parts.facts ?? [];
	const defs: ReadonlyArray<AnyCmdDef> = [
		...(parts.cmds ?? []),
		...(facts.length > 0 ? [Facts.write] : []),
	];

	// Two cases, each written one way: `who` appears only as "person". A plain input's `write`
	// takes only facts that are not person-only.
	function input<const G extends Fields>(spec: {
		readonly fields: G;
		readonly description: string;
		readonly who: "person";
		readonly refuse?: (model: S, msg: Got<G>) => Refusal | null;
		readonly update: (model: S, msg: Got<G>, write: Writer<Person>) => Next<S, C>;
	}): Spec<S, C, G>;
	function input<const G extends Fields>(spec: {
		readonly fields: G;
		readonly description: string;
		readonly refuse?: (model: S, msg: Got<G>) => Refusal | null;
		readonly update: (model: S, msg: Got<G>, write: Writer<Anyone>) => Next<S, C>;
	}): Spec<S, C, G>;
	function input(spec: {
		readonly fields: Fields;
		readonly description: string;
		readonly who?: "person";
		refuse?(model: S, msg: Got<Fields>): Refusal | null;
		update(model: S, msg: Got<Fields>, write: Writer<FactValue<Fact>>): Next<S, C>;
	}): Spec<S, C> {
		// The one place a Spec is made: the brand exists only in its type.
		const one: Omit<Spec<S, C>, typeof made> = {
			fields: spec.fields,
			description: spec.description,
			personOnly: spec.who === "person",
			refuse: (model, msg) => spec.refuse?.(model, msg) ?? null,
			update: (model, msg, write) => spec.update(model, msg, write),
		};
		return one as Spec<S, C>;
	}

	const make = <
		const I extends Readonly<Record<string, Spec<S, C>>>,
		V extends Schema.Json,
		const O extends Readonly<Record<string, Omit<Output<S>, "name">>>,
	>(
		spec: {
			readonly name: string;
			readonly init: (saved: S | null) => Next<S, C>;
			readonly inputs: I;
			readonly view: (model: S) => V;
			/** Its outputs, by name. Left out, it has none; `{}` does not compile. */
			readonly outputs?: O & (keyof O extends never ? never : unknown);
			/** When the runner should wake it, and the step it takes then. Left out, it never wakes. */
			readonly wake?: {
				readonly at: (model: S) => number | null;
				readonly update: (model: S, at: number) => Next<S, C>;
			};
			readonly state?: State;
		} & ([D | F] extends [never]
			? {readonly answers?: never}
			: {
					/** Every Cmd's two answers, by its name. A missing or extra name does not compile. */
					readonly answers: {readonly [K in D[number] as K["cmdType"]]: Answers<S, C, K>} & ([
						F,
					] extends [never]
						? unknown
						: {readonly write: Answers<S, C, WriteDef>});
				}),
	): Program<
		S,
		InputMsg<I>,
		C | never,
		V,
		D[number] | ([F] extends [never] ? never : WriteDef)
	> => {
		const names = Object.keys(spec.inputs);
		const structs = names.map((name) =>
			Schema.Struct({type: Schema.Literal(name), parent, ...spec.inputs[name]?.fields}),
		);
		const timer = Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number});
		const msg = Schema.Union(spec.wake === undefined ? structs : [...structs, timer]);
		const tuple = (next: Next<S, C>) => [next.model, next.cmds] as const;
		const cells: Record<string, (model: S, m: Raw) => readonly [S, ReadonlyArray<C>]> = {};
		for (const name of names) {
			const one = spec.inputs[name];
			if (one === undefined) continue;
			cells[name] = (model, m) =>
				tuple(one.update(model, m, (stream, fact) => caused(m, stream, fact)));
		}
		for (const def of defs) {
			const answer: unknown =
				spec.answers === undefined
					? undefined
					: Object.getOwnPropertyDescriptor(spec.answers, def.cmdType)?.value;
			if (!isAnswer<S, C>(answer)) throw new Error(`no answers for ${def.cmdType}`);
			cells[def.okType] = (model, m) => tuple(answer.ok(model, m.value));
			cells[def.errType] = (model, m) => tuple(answer.err(model, m.error));
		}
		const wake = spec.wake;
		if (wake !== undefined) cells["timer"] = (model, m) => tuple(wake.update(model, m.at));
		// The one untyped join: tea's Machine.make types a table written by hand, and this table is
		// built from the records above, which carry the types instead. `Built` below says what it is.
		// oxlint-disable-next-line fabrika/no-type-assertions -- the table is built, not written: its types come from the records
		const machine = Machine.make({
			model: parts.model,
			msg,
			cmds: defs,
			init: ((loaded: S | null) => tuple(spec.init(loaded))) as never,
			update: cells as never,
		}) as unknown as Built<S, InputMsg<I>, C, D[number] | ([F] extends [never] ? never : WriteDef)>;
		const doors: ReadonlyArray<Door> = names.flatMap((name, i) => {
			const one = spec.inputs[name];
			const schema = structs[i];
			return one === undefined || schema === undefined
				? []
				: [{name, schema, description: one.description, personOnly: one.personOnly}];
		});
		const refuse = (model: S, m: Raw & {readonly type: string}): Refusal | null => {
			const one: Spec<S, C> | undefined = Object.hasOwn(spec.inputs, m.type)
				? spec.inputs[m.type]
				: undefined;
			return one === undefined ? null : one.refuse(model, m);
		};
		const outputs = Object.entries(spec.outputs ?? {}).map(([name, o]) => ({name, ...o}));
		return {
			name: spec.name,
			machine,
			view: spec.view,
			outputs,
			declared: declare({
				name: spec.name,
				machine,
				doors,
				facts,
				view: spec.view,
				refuse,
				outputs,
				wake: wake?.at ?? (() => null),
				state: spec.state,
			}),
		};
	};

	return {input, make};
};

const isAnswer = <S, C>(
	u: unknown,
): u is {
	readonly ok: (model: S, value: unknown) => Next<S, C>;
	readonly err: (model: S, error: unknown) => Next<S, C>;
} =>
	typeof u === "object" &&
	u !== null &&
	"ok" in u &&
	typeof u.ok === "function" &&
	"err" in u &&
	typeof u.err === "function";

/** The tea machine Program.make builds: tea's own type, so a parent steps it and laws fold it. */
type Built<S, M extends {readonly type: string}, C, D extends AnyCmdDef> = TeaMachine<
	S,
	M | Settled<D>,
	Extract<C, {readonly type: string}>,
	Sub<never>,
	unknown
> & {readonly model: Schema.Schema<S>; readonly msg: Schema.Schema<M>};

/** The program, with the tea machine it built. */
export type Program<S, M extends {readonly type: string}, C, V, D extends AnyCmdDef> = {
	readonly name: string;
	readonly machine: Built<S, M, C, D>;
	readonly view: (model: S) => V;
	readonly outputs: ReadonlyArray<Output<S>>;
	/** What the runner loads. */
	readonly declared: Declaration;
};

export const Program = {over};
