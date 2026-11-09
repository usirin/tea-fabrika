import type {Answer} from "./line.ts";

// A sketch, next/. The desk's `open`, typed: a literal line is checked by the compiler, and a
// line built at run time must say so, by going through `unchecked`. Either way the desk reads the
// line again at run time (./parse.ts), since the programs it has may not be the ones this was
// compiled against; `bad_line` stays in the Cmd's `err`.
//
//   open({line: "asks | ticket", from: "t1", via})             compiles
//   open({line: "asks | nope", from: "t1", via})               error: ... not assignable to type '"no program nope"'
//   open({line: unchecked(typed), from: "t1", via})            compiles; the desk checks it
//   open({line: typed, from: "t1", via})                       error: ... '"a line built at run time: pass it through unchecked(line)"'

/** How a press reached the command: the keybindings note's `Via`. */
type Via =
	| {readonly _tag: "key"; readonly keys: string}
	| {readonly _tag: "palette"}
	| {readonly _tag: "word"}
	| {readonly _tag: "click"};

declare const notChecked: unique symbol;
/** A line the compiler did not read. Only `unchecked` makes one. */
type Unchecked = string & {readonly [notChecked]: true};

/** Mark a line built at run time: the desk checks it when it opens, and may answer `bad_line`. */
export const unchecked = (line: string): Unchecked => line as Unchecked;

/** A string type with no hole in it: `"a | b"`, not `string` and not `` `a ${string}` ``. */
type Literal<S extends string> = Record<never, never> extends Record<S, true> ? false : true;

/** What `open` takes for a line: the line itself when it reads, else the reason, ArkType's way. */
type Checked<S extends string> = S extends Unchecked
	? S
	: Literal<S> extends false
		? "a line built at run time: pass it through unchecked(line)"
		: Answer<S> extends "ok"
			? S
			: Answer<S>;

interface Open<S extends string> {
	readonly line: Checked<S>;
	readonly from: string;
	readonly via: Via;
}

/** The Cmd's input as tea would get it. The Cmd itself is tea's `Cmd.define("open", ...)`, not built here. */
export const open = <const S extends string>(
	input: Open<S>,
): {readonly _tag: "open"; readonly line: string; readonly from: string; readonly via: Via} => ({
	_tag: "open",
	line: input.line,
	from: input.from,
	via: input.via,
});
