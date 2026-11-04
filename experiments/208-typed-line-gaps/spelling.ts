import {Schema, SchemaAST} from "effect";

// A sketch, next/. How a value is spelled on a line, said once. One spelling is read three ways:
//
//   the compiler      Spells<"0", P>                false: the type reader in ./line.ts
//   the run time      spells(P, "0")                false: the run-time reader in ./parse.ts
//   the value check   Schema.is(TicketNumber)(0)    false: the schema's own check reads String(0)
//
// ArkType's way: one definition, read by a type-level parser and a run-time one. Effect's and Zod's
// template literals keep one list of parts too, but their type is TypeScript's own template
// literal, which has no "one or more digits", so the type stays looser than the check
// (experiments/208-typed-line-gaps.md). Here the type reader walks the spelling itself.
//
//   const P = [run(DIGITS, {first: "123456789", most: 15})];   a digit 1-9, then up to 14 digits
//   const Q = ["a-", run(`${LOWER}_`, {most: 32}), "-", run(DIGITS, {most: 15})];
//
// A piece is fixed text, or a run of characters from a set. A run takes as many as it can, up to
// `most`, and never gives one back. So a run must not hold the first character of the text after
// it; ./agree.test.ts checks every spelling for that.

/** A run of characters: the first from `first`, the rest from `of`, `most` in all. */
export interface Run {
	readonly of: string;
	readonly first: string;
	readonly most: number;
}

/** One piece of a spelling: fixed text, or a run. */
export type Piece = string | Run;
export type Spelling = readonly Piece[];

export const DIGITS = "0123456789";
export const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** A run of `of`, at least one and at most `most`; the first from `first` when it is given. */
export function run<const O extends string, const M extends number>(
	of: O,
	bound: {readonly most: M},
): {readonly of: O; readonly first: O; readonly most: M};
export function run<const O extends string, const F extends string, const M extends number>(
	of: O,
	bound: {readonly first: F; readonly most: M},
): {readonly of: O; readonly first: F; readonly most: M};
export function run(of: string, bound: {readonly first?: string; readonly most: number}): Run {
	return {of, first: bound.first ?? of, most: bound.most};
}

/** Does `text` follow `spelling`, all of it? The run-time reader, step for step as `Spells`. */
export const spells = (spelling: Spelling, text: string): boolean => {
	let i = 0;
	for (const piece of spelling) {
		if (typeof piece === "string") {
			if (!text.startsWith(piece, i)) return false;
			i += piece.length;
			continue;
		}
		const head = text[i];
		if (head === undefined || !piece.first.includes(head)) return false;
		i += 1;
		for (let n = 1; n < piece.most; n += 1) {
			const next = text[i];
			if (next === undefined || !piece.of.includes(next)) break;
			i += 1;
		}
	}
	return i === text.length;
};

// --- the type reader, step for step as `spells`

type Chars<S extends string> = S extends `${infer C}${infer R}` ? C | Chars<R> : never;

/** Does the literal V follow P, all of it? `true` or `false`. */
export type Spells<V extends string, P extends Spelling> = P extends readonly [
	infer H,
	...infer R extends Spelling,
]
	? H extends string
		? V extends `${H}${infer Rest}`
			? Spells<Rest, R>
			: false
		: H extends Run
			? V extends `${infer C}${infer Rest}`
				? C extends Chars<H["first"]>
					? Take<Rest, R, Chars<H["of"]>, H["most"], [C]>
					: false
				: false
			: false
	: V extends ""
		? true
		: false;

/** A run, after its first character: take from `Of` while it can, up to `Most`, then go on. */
type Take<
	V extends string,
	P extends Spelling,
	Of extends string,
	Most extends number,
	N extends unknown[],
> = N["length"] extends Most
	? Spells<V, P>
	: V extends `${infer C}${infer Rest}`
		? C extends Of
			? Take<Rest, P, Of, Most, [...N, C]>
			: Spells<V, P>
		: Spells<V, P>;

// --- the spelling in a schema: in its type for the compiler, in an annotation for the run time

declare const spelled: unique symbol;
/** A value that has a spelling. Only the type sees it; at run time the schema's check is the proof. */
export interface Spelled<P extends Spelling> {
	readonly [spelled]: P;
}

declare module "effect/Schema" {
	namespace Annotations {
		interface Annotations {
			/** How a value of this schema is spelled on a line: the one rule, read by ./parse.ts. */
			readonly spelling?: Spelling | undefined;
		}
	}
}

/** A brand's name, as `Schema.brand` takes it: one name, not a union. */
type BrandName<B extends string> = Parameters<typeof Schema.brand<B>>[0];

/** A string id, by its spelling: the type, the check and the error's name all come from here. */
export const spelledText = <const B extends string, const P extends Spelling>(
	name: BrandName<B>,
	spelling: P,
) =>
	Schema.String.pipe(
		Schema.refine((s: string): s is string & Spelled<P> => spells(spelling, s), {spelling}),
		Schema.brand<B>(name),
	).annotate({identifier: name});

/**
 * A number, by its spelling: a number is one when JavaScript writes it as the spelling says. The
 * base is `Schema.Number`, not `Schema.Finite`: the spelling's check is the only one, so no check
 * hides from the compiler (`Infinity` is not spelled, so it is refused all the same).
 */
export const spelledNumber = <const B extends string, const P extends Spelling>(
	name: BrandName<B>,
	spelling: P,
) =>
	Schema.Number.pipe(
		Schema.refine((n: number): n is number & Spelled<P> => spells(spelling, String(n)), {
			spelling,
		}),
		Schema.brand<B>(name),
	).annotate({identifier: name});

/** The spelling a schema carries, through `UndefinedOr`; none when it has no spelling. */
export const spellingOf = (ast: SchemaAST.AST): Spelling | undefined => {
	if (SchemaAST.isUnion(ast)) {
		for (const member of ast.types) {
			const found = spellingOf(member);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	for (const check of ast.checks ?? []) {
		const found = check.annotations?.spelling;
		if (found !== undefined) return found;
	}
	return undefined;
};
