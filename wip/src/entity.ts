import {Schema, SchemaAST} from "effect";

// One base for everything the ledger keeps that stays the same thing through
// change (docs/direction/smallest-ledger-proof-to-grow.md, "Every ledger
// entity has an id"): an id of its own kind, then its fields.
//
//   const CriterionId = Id("CriterionId", /^c[1-9][0-9]*$/);
//   const Entry = entity(CriterionId, {task: TaskId, wordings: Schema.Array(Wording)});
//   const Wording = value({version: Version, text: Schema.String, by: By});
//
//   make(CriterionId)("c3")      // a CriterionId, or a throw: no book gives "x"
//   read(CriterionId)("c3")      // a CriterionId, or null
//
// An id is text, branded with its kind: a criterion's id is never taken where
// a verdict's is asked for, though both are text. A value has no id: equal
// content is the same thing (a commit, a reason, a fixture). Every struct the
// ledger holds is made by one of the two, and a test walks the ledger's
// schemas to hold that (./entity.test.ts): a struct made any other way fails
// it, so a new shape cannot slip in without its answer to "is this a thing
// with a life, or a value?".

const ID = "ledger/id";
const ENTITY = "ledger/entity";
const VALUE = "ledger/value";

/**
 * The id of kind `K`: text in `pattern`, branded `K`. Its type side only, so
 * the same schema serves a Cmd, a program's input and output, and a log read
 * back: each still checks it.
 */
export const Id = <const K extends string>(kind: OneKind<K>, pattern: RegExp) =>
	Schema.toType(
		Schema.String.check(Schema.isPattern(pattern)).pipe(Schema.brand<K>(kind)),
	).annotate({[ID]: kind});
export type Id<K extends string> = ReturnType<typeof Id<K>>;

/** One concrete kind, as `Schema.brand` asks: a single literal, never `string` or a union. */
type OneKind<K extends string> = Parameters<typeof Schema.brand<K>>[0];

/** An id from text, as a person or a log wrote it. Throws on text that is not one of its kind. */
export const make = <K extends string>(id: Id<K>): ((text: string) => Id<K>["Type"]) =>
	Schema.decodeUnknownSync(id);

/** An id from text, or `null`: it is not one of its kind. */
export const read = <K extends string>(id: Id<K>) => {
	const is = Schema.is(id);
	return (text: string): Id<K>["Type"] | null => (is(text) ? text : null);
};

/** A thing the ledger keeps that stays the same thing through change: `id` first, of its own kind, then its fields. */
export const entity = <const K extends string, const F extends NoId>(id: Id<K>, fields: F) =>
	Schema.Struct({id, ...fields}).annotate({[ENTITY]: kindOf(id.ast)});

/** A value: no id, and two with equal content are the same one. */
export const value = <const F extends NoId>(fields: F) =>
	Schema.Struct(fields).annotate({[VALUE]: true});

/** Fields with no `id`: an entity's id is the one it was made with, and a value has none. */
type NoId = Schema.Struct.Fields & {readonly id?: never};

/** The kind of id a schema is, or `null`: it is not an id. */
export function kindOf(ast: SchemaAST.AST): string | null {
	const kind = marks(ast)[ID];
	return typeof kind === "string" ? kind : null;
}

/** What a struct was made as: an entity of a kind, a value, or `null`: neither. */
export function madeAs(
	ast: SchemaAST.AST,
): {readonly entity: string} | {readonly value: true} | null {
	const m = marks(ast);
	const kind = m[ENTITY];
	if (typeof kind === "string") return {entity: kind};
	return m[VALUE] === true ? {value: true} : null;
}

/** Every mark on a node: its own, and the last check's, where `annotate` puts them on a checked one. */
const marks = (ast: SchemaAST.AST): Readonly<Record<string, unknown>> => ({
	...ast.annotations,
	...SchemaAST.resolve(ast),
});
