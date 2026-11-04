import type {Brand} from "effect";
import type {Register} from "./register.ts";
import type {Spelled, Spells} from "./spelling.ts";

// Experiment 204's type reader, with one change: a flag's value is checked against its spelling
// (./spelling.ts), so `ticket --ticket 0` is refused here as at run time.
//
// A sketch, next/. A tsh line read by the compiler, ArkType's way: the line is a string literal
// type, a chain of conditional types walks it, and the answer is the literal "ok" or a message
// as a string literal type. `open` puts the message where the line should go, so the editor says
// it (./open.ts). ./parse.ts reads the same grammar at run time; ./agree.test.ts holds the two to
// the same answers.
//
//   line     command ('|' command)* ['&']
//   command  program part*
//   part     --flag value | --flag=value | >output | <input
//
//   Answer<"asks | ticket">                 "ok"
//   Answer<"asks | nope">                   "no program nope"
//   Answer<"ticket | tracker">              "ticket | tracker: no output fits an input"
//
// Words are split on spaces only. `|` and `&` are words even with no space around them.
// Everything is tail-recursive, so TypeScript's limit is 1000 steps, not 50.

type Programs = Register;
type Name = keyof Programs & string;
type Flags<N extends Name> = Programs[N]["flags"];
type Inputs<N extends Name> = Programs[N]["inputs"];
type Outputs<N extends Name> = Programs[N]["outputs"];
type Get<T, K> = K extends keyof T ? T[K] : never;
type TypeOf<P> = P extends {readonly schema: {readonly Type: infer T}} ? T : never;

// --- words

type Spread<
	S extends string,
	Op extends string,
	Done extends string = "",
> = S extends `${infer A}${Op}${infer B}` ? Spread<B, Op, `${Done}${A} ${Op} `> : `${Done}${S}`;

type Words<S extends string, Done extends string[] = []> = S extends `${infer W} ${infer Rest}`
	? Words<Rest, W extends "" ? Done : [...Done, W]>
	: S extends ""
		? Done
		: [...Done, S];

type Commands<
	W extends string[],
	Now extends string[] = [],
	Done extends string[][] = [],
> = W extends [infer H extends string, ...infer R extends string[]]
	? H extends "|"
		? Commands<R, [], [...Done, Now]>
		: Commands<R, [...Now, H], Done>
	: [...Done, Now];

// --- one command

/** What a checked command leaves for the pipe check: its program and what it named. */
interface Seen {
	readonly name: Name;
	readonly out: string | null;
	readonly into: string | null;
}

type Command<C extends string[]> = C extends [infer N extends string, ...infer P extends string[]]
	? N extends `-${string}` | `>${string}` | `<${string}` | "&"
		? `expected a program name, not ${N}`
		: N extends Name
			? Parts<N, P>
			: `no program ${N}`
	: never;

type Parts<
	N extends Name,
	P extends string[],
	Out extends string | null = null,
	Into extends string | null = null,
	Given extends string = never,
> = P extends [infer H extends string, ...infer R extends string[]]
	? H extends `--${infer F}=${infer V}`
		? FlagThen<N, F, V, R, Out, Into, Given>
		: H extends `--${infer F}`
			? R extends [infer V extends string, ...infer R2 extends string[]]
				? FlagThen<N, F, V, R2, Out, Into, Given>
				: `${N} --${F} needs a value`
			: H extends `>${infer O}`
				? O extends keyof Outputs<N>
					? Out extends null
						? Parts<N, R, O, Into, Given>
						: `${N} names an output twice`
					: `${N} has no output >${O}`
				: H extends `<${infer I}`
					? I extends keyof Inputs<N>
						? Into extends null
							? Parts<N, R, Out, I, Given>
							: `${N} names an input twice`
						: `${N} has no input <${I}`
					: `${N} does not take ${H}: a flag is --name value`
	: {name: N; out: Out; into: Into};

type FlagThen<
	N extends Name,
	F extends string,
	V extends string,
	R extends string[],
	Out extends string | null,
	Into extends string | null,
	Given extends string,
> = F extends keyof Flags<N>
	? [F] extends [Given]
		? `${N} --${F} is given twice`
		: Takes<V, TypeOf<Flags<N>[F]>> extends true
			? Parts<N, R, Out, Into, Given | F>
			: `${N} --${F}: ${V} does not fit ${NameOf<TypeOf<Flags<N>[F]>>}`
	: `${N} has no flag --${F}`;

/**
 * Can V be typed for a value of type T? A spelled value: when V follows the spelling, the same
 * one the run-time reader and the schema's check read. Free text or fixed words: when V is one.
 * 204 read a number as `${number}` here, out of sight of its checks; that was the gap.
 */
type Takes<V extends string, T> = [Exclude<T, undefined>] extends [Spelled<infer P>]
	? Spells<V, P>
	: V extends Exclude<T, undefined>
		? true
		: false;

type NameOf<T> = Exclude<T, undefined> extends Brand.Brand<infer K> ? K : "text";

// --- one pipe

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Member<A, B> = B extends unknown ? Same<A, B> : never;
/** As the run-time fit: the same shape, or the same as one member of a union. */
type Fits<A, B> = Same<A, B> extends true ? true : true extends Member<A, B> ? true : false;

type Pairs<L extends Seen, R extends Seen> = {
	[O in (L["out"] extends string ? L["out"] : keyof Outputs<L["name"]>) & string]: {
		[I in (R["into"] extends string ? R["into"] : keyof Inputs<R["name"]>) & string]: Fits<
			TypeOf<Get<Outputs<L["name"]>, O>>,
			TypeOf<Get<Inputs<R["name"]>, I>>
		> extends true
			? `${O}>${I}`
			: never;
	}[(R["into"] extends string ? R["into"] : keyof Inputs<R["name"]>) & string];
}[(L["out"] extends string ? L["out"] : keyof Outputs<L["name"]>) & string];

type IsUnion<T, All = T> = T extends unknown ? ([All] extends [T] ? false : true) : never;

type Label<S extends Seen, Mark extends string, Named extends string | null> = Named extends string
	? `${S["name"]} ${Mark}${Named}`
	: S["name"];

type Pipe<L extends Seen, R extends Seen> = [Pairs<L, R>] extends [never]
	? `${Label<L, ">", L["out"]>} | ${Label<R, "<", R["into"]>}: no output fits an input`
	: true extends IsUnion<Pairs<L, R>>
		? `${Label<L, ">", L["out"]>} | ${Label<R, "<", R["into"]>}: more than one way fits, name one with >output or <input`
		: "ok";

// --- the line

type Walk<C extends string[][], Before extends Seen | null = null> = C extends [
	infer H extends string[],
	...infer R extends string[][],
]
	? H extends []
		? "a | needs a command on each side"
		: Command<H> extends infer Got
			? Got extends Seen
				? Before extends Seen
					? Pipe<Before, Got> extends "ok"
						? Walk<R, Got>
						: Pipe<Before, Got>
					: Walk<R, Got>
				: Got
			: never
	: "ok";

type Job<W extends string[]> = W extends [...infer Head extends string[], "&"] ? Head : W;

type Read<W extends string[]> = W extends []
	? "a line needs a program"
	: "&" extends Job<W>[number]
		? "& goes only at the end of a line"
		: Walk<Commands<Job<W>>>;

/** The compiler's answer for one line: "ok", or why not, in words. */
export type Answer<S extends string> = Read<Words<Spread<Spread<S, "|">, "&">>>;
