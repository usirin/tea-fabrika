import {Schema, SchemaAST} from "effect";
import {describe, expect, it} from "vitest";
import {Ask} from "./asks/ask.ts";
import {Fact} from "./asks/ledger.ts";
import {Book} from "./criteria/book.ts";
import {entity, Id, kindOf, madeAs, make, read, value} from "./entity.ts";

// Every ledger entity has an id (docs/direction/smallest-ledger-proof-to-grow.md).
//
// The ledger's schemas are walked from their roots, so nothing it keeps can
// be missed: a struct gets into the ledger only inside one of them. Each
// struct found must be made by `entity` (its `id` first, of its own kind) or
// by `value` (no id). A struct made any other way fails here, so a new shape
// cannot slip in without its answer to "a thing with a life, or a value?".
//
//   Fact   the ledger's events. An event is not a thing: what it holds is.
//   Book   a plan's criteria and their verdicts, as the criteria record keeps them.
//   Ask    what the ledger asks the owner: a question, and the one answer it takes.

const ROOTS = [
	{name: "fact", schema: Fact, own: true},
	{name: "book", schema: Book, own: true},
	{name: "ask", schema: Ask, own: false},
] as const;

interface Struct {
	readonly path: string;
	readonly ast: SchemaAST.Objects;
	/** The root's own container (an event, the book), not a thing it keeps. */
	readonly own: boolean;
}

/** The literal a union member is told apart by (`type`, `for`, `kind`, ...), for a readable path. */
const tagOf = (ast: SchemaAST.Objects): string | null => {
	for (const p of ast.propertySignatures)
		if (SchemaAST.isLiteral(p.type) && typeof p.type.literal === "string") return p.type.literal;
	return null;
};

/** Every struct under `ast`, each with the path to it. */
function structsIn(
	ast: SchemaAST.AST,
	path: string,
	own: boolean,
	seen: Set<SchemaAST.AST>,
): Struct[] {
	if (seen.has(ast)) return [];
	seen.add(ast);
	switch (ast._tag) {
		case "Objects":
			return [
				{path, ast, own},
				...ast.propertySignatures.flatMap((p) =>
					structsIn(p.type, `${path}.${String(p.name)}`, false, seen),
				),
				...ast.indexSignatures.flatMap((s) => structsIn(s.type, `${path}[key]`, false, seen)),
			];
		case "Union":
			return ast.types.flatMap((t) =>
				structsIn(t, SchemaAST.isObjects(t) ? `${path}(${tagOf(t) ?? "?"})` : path, own, seen),
			);
		case "Arrays":
			return [...ast.elements, ...ast.rest].flatMap((t) => structsIn(t, `${path}[]`, false, seen));
		case "Suspend":
			return structsIn(ast.thunk(), path, own, seen);
		case "Declaration":
			return ast.typeParameters.flatMap((t) => structsIn(t, path, false, seen));
		default:
			return [];
	}
}

/** What is wrong with one struct the ledger holds. `null`: it is an entity with its id, or a value. */
function problemOf(s: Struct): string | null {
	if (s.own) return null;
	const made = madeAs(s.ast);
	if (made === null)
		return `${s.path} is a struct made neither by entity(...) nor by value(...): if it stays the same thing through change, it is an entity and needs a typed id`;
	if ("value" in made) return null;
	const id = s.ast.propertySignatures.find((p) => p.name === "id");
	if (id === undefined) return `${s.path} is an entity of ${made.entity} with no id`;
	if (SchemaAST.isOptional(id.type))
		return `${s.path} is an entity of ${made.entity} whose id may be missing`;
	const kind = kindOf(id.type);
	return kind === made.entity
		? null
		: `${s.path} is an entity of ${made.entity} whose id is ${kind === null ? "not a typed id" : `a ${kind}`}`;
}

const found = ROOTS.flatMap((root) => structsIn(root.schema.ast, root.name, root.own, new Set()));

describe("every ledger entity has a typed id", () => {
	it("finds the ledger's structs by walking its schemas", () => {
		expect(found.length).toBeGreaterThan(20);
	});

	it("makes every struct the ledger holds an entity with a typed id of its kind, or a value", () => {
		expect(found.map(problemOf).filter((p) => p !== null)).toEqual([]);
	});

	it("holds exactly the entities decided: a new kind is a decision, not a side effect", () => {
		const kinds = new Set(
			found.flatMap((s) => {
				const made = madeAs(s.ast);
				return made !== null && "entity" in made ? [made.entity] : [];
			}),
		);
		expect([...kinds].sort()).toEqual([
			"AskId",
			"CriterionId",
			"QuestionId",
			"StoryId",
			"TaskId",
			"VerdictId",
		]);
	});

	// A lane is named by the seq of its "lane" fact; the ledger keeps its claims, not a struct of it.
	it("names a plan, a ticket and a lane, which it holds no struct of, only by their typed ids", () => {
		const idsIn = (ast: SchemaAST.AST): string[] => {
			const kind = kindOf(ast);
			if (kind !== null) return [kind];
			if (SchemaAST.isArrays(ast)) return [...ast.elements, ...ast.rest].flatMap(idsIn);
			if (SchemaAST.isUnion(ast)) return ast.types.flatMap(idsIn);
			return [];
		};
		const named = new Set(
			found.flatMap((s) => s.ast.propertySignatures.flatMap((p) => idsIn(p.type))),
		);
		expect([...named].sort()).toEqual([
			"AskId",
			"CriterionId",
			"LaneId",
			"PlanId",
			"QuestionId",
			"StoryId",
			"TaskId",
			"TicketId",
			"VerdictId",
		]);
	});
});

describe("the entity base", () => {
	const AId = Id("AId", /^a[1-9][0-9]*$/);
	const BId = Id("BId", /^b[1-9][0-9]*$/);
	const B = entity(BId, {a: AId, words: Schema.Array(value({text: Schema.String}))});

	it("makes an id only from text of its kind, and reads one or says null", () => {
		expect(make(AId)("a3")).toBe("a3");
		expect(() => make(AId)("b3")).toThrow();
		expect(read(AId)("a3")).toBe("a3");
		expect(read(AId)("a0")).toBeNull();
	});

	it("puts the id first, and marks the struct with its id's kind", () => {
		expect(Object.keys(B.fields)).toEqual(["id", "a", "words"]);
		expect(madeAs(B.ast)).toEqual({entity: "BId"});
		expect(kindOf(B.fields.id.ast)).toBe("BId");
	});

	it("keeps one kind's id out of another's place, though both are text", () => {
		const a = make(AId)("a1");
		const b = make(BId)("b1");
		const ok: typeof B.Type = {id: b, a, words: []};
		// @ts-expect-error: an AId where a BId is asked for
		const swapped: typeof B.Type = {id: a, a: b, words: []};
		// @ts-expect-error: plain text is not an id
		const plain: typeof B.Type = {id: "b1", a, words: []};
		expect([ok, swapped, plain].length).toBe(3);
	});

	it("gives an entity no second id and a value none", () => {
		// @ts-expect-error: the id is the one the entity is made with
		const twice = entity(AId, {id: Schema.String});
		// @ts-expect-error: a value has no id
		const valued = value({id: Schema.String});
		expect([twice, valued].length).toBe(2);
	});
});
