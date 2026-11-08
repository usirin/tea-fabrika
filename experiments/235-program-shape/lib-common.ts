// The parts shapes 2 and 3 share, next/ only. Both compile down to the declaration that the merged
// `stepper` already loads, so neither needs the runner or tea to change in order to step.
import {Cmd} from "@demlik/tea/effect";
import {Schema, SchemaAST} from "effect";
import {
	Input,
	Program as Merged,
	Write,
	type Refusal,
} from "../../next/packages/libfabrika/src/index.ts";

export type {Refusal};

/** The door's stamp: the envelope id of the input, put on every Msg the door lets in. */
export const parent = Write.cases.caused.fields.parent;

/** A fact as the ledger keeps it: a schema whose values carry their own `_tag`. */
type FactSchema = Schema.Codec<{readonly _tag: string}, unknown> & {
	readonly Type: {readonly _tag: string};
};

/** A fact a program may write, and whether only a person's input may cause it. */
export type Fact<S extends FactSchema = FactSchema, P extends boolean = boolean> = {
	readonly schema: S;
	readonly personOnly: P;
};

/** A fact's value. */
export type FactValue<F extends Fact> = F["schema"]["Type"];

function makeFact<S extends FactSchema>(schema: S, spec: {readonly who: "person"}): Fact<S, true>;
function makeFact<S extends FactSchema>(schema: S): Fact<S, false>;
function makeFact<S extends FactSchema>(schema: S, spec?: {readonly who: "person"}): Fact<S> {
	return {schema, personOnly: spec !== undefined};
}

/**
 * A write as the write Cmd takes it: branded, so only `caused` below makes one. A step that calls
 * the write Cmd itself, or puts another fact into a write it was handed, skipping its input's
 * writer and its person-only gate, does not compile. The brand is a type only; the saved Cmd holds
 * plain JSON. In libfabrika `caused` would stay inside the package; here the two shape libraries
 * import it, and neither passes it on.
 */
const Sealed = Write.pipe(Schema.brand("CausedWrite"));

/**
 * The one Cmd the runner itself performs: a checked write. Declared once, here, so no program
 * writes its name, its input or the runner's refusals again. Programs list it in `cmds`.
 */
const write = Cmd.make("write", {
	input: Schema.Struct({stream: Schema.String, write: Schema.toType(Sealed)}),
	ok: Schema.Json,
	err: ["not_delivered", "spent", "person_only", "ended", "not_granted", "bad_cmd", "forbidden"],
});
export type WriteDef = typeof write;
export type WriteCmd = ReturnType<WriteDef>;

/** A fact's maker and the write Cmd. A person-only fact says `{who: "person"}`; no other way. */
export const Fact = {make: makeFact, write};

/** A write the input `msg` caused: its parent is the door's stamp, never a value a client wrote. */
export const caused = (
	msg: {readonly parent: string},
	stream: string,
	fact: typeof Write.cases.caused.fields.fact.Type & {readonly _tag: string},
): WriteCmd =>
	write({stream, write: Sealed.make(Write.cases.caused.make({parent: msg.parent, fact}))});

/** One step of a saved model's shape. Its number is its place in the list: no `from` to get wrong. */
export type Upgrade = {readonly name: string; readonly run: (raw: unknown) => unknown};

/** Saved state with at least one upgrade. Left out, the shape is version 1 and has none. */
export type State = {readonly upgrades: readonly [Upgrade, ...ReadonlyArray<Upgrade>]};

/**
 * An output: a value picked from the model, sent each time it changes, as a source does (C8).
 * `null` means nothing to send now; any other value must be what `schema` says.
 */
export type Output<S, A = unknown> = {
	readonly name: string;
	readonly schema: Schema.Codec<A, unknown>;
	readonly description: string;
	readonly select: (model: S) => A | null;
};

/** One input as the door checks it. Read inputs stay out: they get their own word when a program needs one. */
export type Door = {
	readonly name: string;
	readonly schema: Schema.Codec<unknown, unknown>;
	readonly description: string;
	readonly personOnly: boolean;
};

/** The merged declaration the stepper and runner load. */
export type Declaration = typeof Merged.schema.Type;

/** Everything a shape knows, turned into the merged declaration, checked by its Schema. */
export const declare = (parts: {
	readonly name: string;
	readonly machine: {readonly model: Schema.Top; readonly msg: Schema.Top};
	readonly doors: ReadonlyArray<Door>;
	readonly facts: ReadonlyArray<Fact>;
	readonly view: (model: never) => unknown;
	readonly refuse: (model: never, msg: never) => Refusal | null;
	readonly outputs: ReadonlyArray<Output<never>>;
	readonly wake: (model: never) => number | null;
	readonly state: State | undefined;
}): Declaration => {
	const upgrades = parts.state?.upgrades ?? [];
	return Schema.decodeUnknownSync(Merged.schema)({
		name: parts.name,
		machine: parts.machine,
		state: {
			v: upgrades.length + 1,
			schema: parts.machine.model,
			upgrades: upgrades.map((u, i) => ({name: u.name, from: i + 1, run: u.run})),
		},
		msg: parts.machine.msg,
		view: {data: Schema.Json, select: parts.view},
		refuse: parts.refuse,
		inputs: Object.fromEntries(
			parts.doors.map((door) => [
				door.name,
				Input.cases.write.make({
					schema: door.schema,
					description: door.description,
					personOnly: door.personOnly,
				}),
			]),
		),
		outputs: Object.fromEntries(parts.outputs.map((o) => [o.name, o.schema])),
		writes: Object.fromEntries(
			parts.facts.map((f) => [factTag(f), {schema: f.schema, personOnly: f.personOnly}]),
		),
		wake: parts.wake,
	});
};

/** A fact schema's own `_tag`, read off its fields. */
const factTag = (fact: Fact): string => {
	const fields: unknown = "fields" in fact.schema ? fact.schema.fields : undefined;
	const tag =
		typeof fields === "object" && fields !== null && "_tag" in fields ? fields._tag : undefined;
	const literal =
		Schema.isSchema(tag) && SchemaAST.isLiteral(tag.ast) ? tag.ast.literal : undefined;
	if (typeof literal !== "string") throw new Error("a fact needs a TaggedStruct schema");
	return literal;
};
