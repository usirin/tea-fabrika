import {Schema, SchemaAST} from "effect";
import {describe, expect, expectTypeOf, it} from "vitest";
import {cases} from "./cases.ts";
import {programs} from "./desk.ts";
import {generate, nearby} from "./generate.ts";
import {generated} from "./generated.ts";
import type {Answer} from "./line.ts";
import {read} from "./parse.ts";
import type {Part} from "./register.ts";
import {AskId, TicketNumber} from "./schemas.ts";
import {type Spelling, spellingOf, spells} from "./spelling.ts";

// Two readers, one grammar, one spelling per value. The law: on every line, the compiler gives
// the run-time reader's answer, in the same words. No gaps are allowed.

type Case = {readonly line: string; readonly why: string};
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The lines where the compiler and the run-time reader differ: `never` when there are none. */
type Wrong<T extends readonly Case[]> = {
	[K in keyof T]: Same<Answer<T[K]["line"]>, T[K]["why"]> extends true
		? never
		: {line: T[K]["line"]; compiler: Answer<T[K]["line"]>; runtime: T[K]["why"]};
}[number];

describe("a line, read twice", () => {
	it("the compiler gives the run-time answer on every fixed line, 204's gaps included", () => {
		expectTypeOf<Wrong<typeof cases>>().toBeNever();
	});

	it("and on every generated line", () => {
		expectTypeOf<Wrong<typeof generated>>().toBeNever();
	});

	it.each(cases)("$line", (c) => {
		const got = read(c.line, programs);
		expect(got._tag === "line" ? "ok" : got.why).toBe(c.why);
	});

	it("the generated list is current: it is what the programs' parts give today", () => {
		expect(generate(programs)).toEqual(generated);
	});

	it("wires a line it takes", () => {
		expect(read("asks --ask a-approve-8 | ticket &", programs)).toEqual({
			_tag: "line",
			job: true,
			stages: [
				{program: "asks", flags: {ask: "a-approve-8"}, wire: {output: "ticket", input: "ticket"}},
				{program: "ticket", flags: {}, wire: null},
			],
		});
		expect(read("ticket --ticket 117", programs)).toMatchObject({
			stages: [{program: "ticket", flags: {ticket: 117}}],
		});
	});
});

const spelled: readonly [string, Schema.Top][] = [
	["TicketNumber", TicketNumber],
	["AskId", AskId],
];
const spellingFor = (s: Schema.Top): Spelling => {
	const spelling = spellingOf(s.ast);
	expect(spelling).toBeDefined();
	return spelling ?? [];
};

describe("one spelling per value", () => {
	it.each(spelled)("%s: every spelled text is a value, written back the same", (_, s) => {
		const spelling = spellingFor(s);
		const is = Schema.is(s);
		const texts = nearby(spelling).filter((t) => spells(spelling, t));
		expect(texts.length).toBeGreaterThan(3);
		for (const text of texts) {
			const value = is(text) ? text : Number(text);
			expect(is(value), text).toBe(true);
			expect(String(value), text).toBe(text);
		}
	});

	it.each(spelled)("%s: a run never holds the first character of the text after it", (_, s) => {
		const spelling = spellingFor(s);
		const holds = spelling.flatMap((piece, i) => {
			const next = spelling[i + 1];
			return typeof piece !== "string" && typeof next === "string"
				? [`${piece.of} holds ${next.slice(0, 1)}: ${piece.of.includes(next.slice(0, 1))}`]
				: [];
		});
		expect(holds.filter((h) => h.endsWith("true"))).toEqual([]);
	});

	it("every flag's checks are its spelling's: no check the compiler cannot see", () => {
		const hidden = (ast: SchemaAST.AST): boolean =>
			SchemaAST.isUnion(ast)
				? ast.types.some(hidden)
				: (ast.checks ?? []).some((c) => c.annotations?.spelling === undefined);
		const flags: [string, Part][] = Object.values(programs).flatMap((p) =>
			Object.entries(p.flags).map(([f, part]): [string, Part] => [`${p.name} --${f}`, part]),
		);
		expect(flags.length).toBe(2);
		expect(hidden(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).ast)).toBe(true);
		for (const [name, part] of flags) expect(hidden(part.schema.ast), name).toBe(false);
	});
});
