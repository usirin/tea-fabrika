import {didYouMean} from "./did-you-mean.ts";
import {type At, type Token, words} from "./words.ts";

// The grammar of a tsh line: a small fixed one, read from the shell words
// (./words.ts). It knows no program: whether `ship` exists, whether `--mode`
// is one of its flags and whether `read` fits that flag is ./check.ts's, with
// the program list in hand. Here a line is only cut into statements, pipes
// and the parts of each command.
//
//   line       statement ((';' | '&' | '&&' | '||') statement)*
//              (&& and || chain on the status, as in a POSIX shell; a job cannot be part of a chain)
//   statement  builtin word* ['&']  |  pipeline ['&']
//   pipeline   command ('|' command)*
//   command    program part*
//   part       --flag value | --flag=value | input=value | >output | <input
//   value      word | $( pipeline )
//   help       program word* (--help | -h) [name] word*
//
//   ship --mode read pr=https://github.com/o/r/pull/1        flags are argv, `input=value` is told on stdin
//   review-scripted --rubrics r ... pr=$(…) | ship --mode read   a pipe: an output of the left into an input of the right
//   ship --mode read &                                       a job: the prompt comes back
//   tell %1 pr https://github.com/o/r/pull/2                 a built-in: plain words only
//   ship --mode --help                                        ship's help: every other word is left unread
//
// `>output` names the output a pipe or a `$(…)` takes, and `<input` the input
// a pipe feeds, when the shapes alone do not pick one.
//
// `--help` or `-h` anywhere in a command asks for the program's help, as GNU
// asks of `--help`: every other word of that command is left unread, so a
// half-typed line still answers. The word right after it, if any, names the
// one flag, input or output to show whole.

export type Value =
	| {readonly kind: "text"; readonly text: string; readonly at: At}
	| {readonly kind: "sub"; readonly pipeline: Pipeline; readonly at: At};

export interface Named {
	readonly name: string;
	readonly at: At;
}

/** A flag or an input given a value on the line. */
export interface Given extends Named {
	readonly value: Value;
}

export interface Command {
	readonly program: Named;
	readonly flags: readonly Given[];
	readonly told: readonly Given[];
	/** `>name`: the output a pipe or a `$(…)` takes from this command. */
	readonly out: Named | null;
	/** `<name`: the input a pipe into this command feeds. */
	readonly into: Named | null;
	/** `--help [name]` or `-h [name]`: show the program's help, or one flag, input or output of it whole, and run nothing. */
	readonly help: {readonly at: At; readonly name: Named | null} | null;
	readonly at: At;
}

/** The words that ask a program for its help, as on any Unix tool. */
export const HELP_WORDS: ReadonlySet<string> = new Set(["--help", "-h"]);

export interface Pipeline {
	readonly commands: readonly [Command, ...Command[]];
	/** Where each `|` stands, one fewer than the commands. */
	readonly bars: readonly At[];
	readonly at: At;
}

export const BUILTINS = [
	"jobs",
	"ps",
	"tell",
	"close",
	"stop",
	"attach",
	"programs",
	"help",
	"exit",
] as const;
export type Builtin = (typeof BUILTINS)[number];
const isBuiltin = (name: string): name is Builtin => (BUILTINS as readonly string[]).includes(name);

/** How a statement hangs on the one before: `&&` runs it only if that one ended with status 0, `||` only if not. */
export type Connector = "&&" | "||" | null;

/** A statement and its connector to the one before it. */
export type Statement = Bare & {readonly after: Connector};

type Bare =
	| {
			readonly kind: "run";
			readonly pipeline: Pipeline;
			readonly background: boolean;
			/** The statement's own text, as typed. */
			readonly text: string;
	  }
	| {
			readonly kind: "builtin";
			readonly name: Builtin;
			readonly args: readonly Named[];
			readonly background: boolean;
			readonly text: string;
			readonly at: At;
	  };

/** Why a line was not taken: where, what was wrong, and the closest known name when there is one. */
export interface Refused {
	readonly kind: "refused";
	readonly at: number;
	readonly why: string;
	readonly didYouMean?: string;
}

export type Parsed = {readonly kind: "parsed"; readonly statements: readonly Statement[]} | Refused;

const refused = (at: number, why: string, guess?: string): Refused => ({
	kind: "refused",
	at,
	why,
	...(guess === undefined ? {} : {didYouMean: guess}),
});

/** A stop in the walk: the parse is refused. Thrown inside this file only, and caught by `parse`. */
class Stop {
	readonly refusal: Refused;
	constructor(refusal: Refused) {
		this.refusal = refusal;
	}
}

/** Read one line. A line with nothing but spaces, comments and `;` is no statements. */
export function parse(line: string): Parsed {
	const {tokens, open} = words(line);
	if (open) return refused(line.length, "a quote is not closed");
	let i = 0;
	const peek = (): Token | undefined => tokens[i];
	const isOp = (t: Token | undefined, op: string): boolean => t?.kind === "op" && t.op === op;
	const stopAt = (at: number, why: string, guess?: string): never => {
		throw new Stop(refused(at, why, guess));
	};
	const startOf = (t: Token | undefined) => t?.start ?? line.length;

	const value = (flagEnd: number, name: string): Value => {
		const t = peek();
		if (t?.kind === "word") {
			i += 1;
			return {kind: "text", text: t.text, at: {start: t.start, end: t.end}};
		}
		if (isOp(t, "$(")) return sub();
		// `map --hlep` at the end of a line is a slip for --help, not a flag missing its value.
		return stopAt(
			startOf(t) === line.length ? flagEnd : startOf(t),
			`${name} needs a value`,
			didYouMean(name, ["--help"]),
		);
	};

	const sub = (): Value => {
		const open = peek();
		const start = startOf(open);
		i += 1;
		if (isOp(peek(), ")")) stopAt(startOf(peek()), "$( ) is empty: put a command in it");
		const inner = pipeline();
		const close = peek();
		if (!isOp(close, ")")) return stopAt(start, "no ) closes this $(");
		i += 1;
		return {kind: "sub", pipeline: inner, at: {start, end: close?.end ?? line.length}};
	};

	const command = (): Command => {
		const first = peek();
		if (first?.kind !== "word") return stopAt(startOf(first), "expected a program name");
		if (/^[-<>]/.test(first.text) || first.text.includes("="))
			stopAt(first.start, `expected a program name, not ${first.text}`);
		i += 1;
		const program = {name: first.text, at: {start: first.start, end: first.end}};
		const help = helpIn();
		if (help !== null)
			return {
				program,
				flags: [],
				told: [],
				out: null,
				into: null,
				help: help.help,
				at: {start: first.start, end: help.end},
			};
		const flags: Given[] = [];
		const told: Given[] = [];
		let out: Named | null = null;
		let into: Named | null = null;
		let end = first.end;
		for (let t = peek(); t !== undefined; t = peek()) {
			if (t.kind === "op") {
				if (t.op === "$(") stopAt(t.start, "a $( ) gives a value: put it after --flag or input=");
				break;
			}
			i += 1;
			const at = {start: t.start, end: t.end};
			const text = t.text;
			/** The value glued to `name=`: the rest of the word, or a `$( )` right after it. */
			const glued = (rest: string, name: string): Value => {
				if (rest === "" && isOp(peek(), "$(") && peek()?.start === t.end) return sub();
				if (rest === "") return stopAt(t.end, `${name} needs a value after =`);
				return {kind: "text", text: rest, at: {start: t.end - rest.length, end: t.end}};
			};
			if (text.startsWith("--")) {
				const eq = text.indexOf("=");
				const name = eq === -1 ? text.slice(2) : text.slice(2, eq);
				if (name === "") stopAt(t.start, "a flag needs a name after --");
				const nameAt = {start: t.start, end: t.start + 2 + name.length};
				flags.push({
					name,
					at: nameAt,
					value: eq === -1 ? value(t.end, `--${name}`) : glued(text.slice(eq + 1), `--${name}`),
				});
			} else if (text.startsWith(">") || text.startsWith("<")) {
				const name = text.slice(1);
				if (name === "") stopAt(t.start, `${text} needs a name: >output or <input, with no space`);
				if (text.startsWith(">")) out = {name, at};
				else into = {name, at};
			} else if (text.includes("=") && !text.startsWith("=")) {
				const eq = text.indexOf("=");
				const name = text.slice(0, eq);
				told.push({
					name,
					at: {start: t.start, end: t.start + eq},
					value: glued(text.slice(eq + 1), name),
				});
			} else
				stopAt(
					t.start,
					`expected --flag value, input=value, >output or <input, not ${text === "" ? "an empty word" : text}`,
				);
			end = tokens[i - 1]?.end ?? end;
		}
		return {program, flags, told, out, into, help: null, at: {start: first.start, end}};
	};

	/**
	 * A `--help` or `-h` among the words of the command that starts here, and
	 * the word after it, if any: what to show whole (mode, --mode, pr, >found).
	 * When there is one, the walk steps past the whole command, its `$( )`s
	 * too, unread. `null`: the command asks for no help, and nothing is read.
	 */
	const helpIn = (): {help: NonNullable<Command["help"]>; end: number} | null => {
		let depth = 0;
		let asked: number | null = null;
		let j = i;
		for (; j < tokens.length; j++) {
			const t = tokens[j];
			if (t?.kind === "op") {
				if (t.op === "$(") depth += 1;
				else if (t.op === ")" && depth > 0) depth -= 1;
				else if (depth === 0) break;
			} else if (t !== undefined && depth === 0 && asked === null && HELP_WORDS.has(t.text))
				asked = j;
		}
		const word = asked === null ? undefined : tokens[asked];
		if (asked === null || word === undefined) return null;
		const next = asked + 1 < j ? tokens[asked + 1] : undefined;
		const name =
			next?.kind === "word" && !HELP_WORDS.has(next.text)
				? {name: next.text, at: {start: next.start, end: next.end}}
				: null;
		i = j;
		return {
			help: {at: {start: word.start, end: word.end}, name},
			end: tokens[j - 1]?.end ?? word.end,
		};
	};

	const pipeline = (): Pipeline => {
		const head = command();
		const commands: [Command, ...Command[]] = [head];
		const bars: At[] = [];
		while (isOp(peek(), "|")) {
			const bar = peek();
			bars.push({start: startOf(bar), end: bar?.end ?? line.length});
			i += 1;
			commands.push(command());
		}
		const last = commands.at(-1) ?? head;
		return {commands, bars, at: {start: head.at.start, end: last.at.end}};
	};

	const statement = (): Bare => {
		const first = peek();
		if (first?.kind === "word" && isBuiltin(first.text)) {
			i += 1;
			const args: Named[] = [];
			for (let t = peek(); t?.kind === "word"; t = peek()) {
				args.push({name: t.text, at: {start: t.start, end: t.end}});
				i += 1;
			}
			const next = peek();
			if (next !== undefined && (isOp(next, "|") || isOp(next, "$(") || isOp(next, ")")))
				stopAt(
					next.start,
					`${first.text} is built in: it takes plain words, not ${next.kind === "op" ? next.op : ""}`,
				);
			const background = isOp(peek(), "&");
			const end = args.at(-1)?.at.end ?? first.end;
			return {
				kind: "builtin",
				name: first.text,
				args,
				background,
				text: line.slice(first.start, end),
				at: {start: first.start, end},
			};
		}
		const piped = pipeline();
		if (isOp(peek(), ")")) stopAt(startOf(peek()), "a ) with no $( before it");
		return {
			kind: "run",
			pipeline: piped,
			background: isOp(peek(), "&"),
			text: line.slice(piped.at.start, piped.at.end),
		};
	};

	const statements: Statement[] = [];
	// A Stop is the walk's own refusal; anything else thrown is a bug and goes on up.
	const walk = (): Parsed => {
		let after: Connector = null;
		let connectorAt = 0;
		while (i < tokens.length) {
			if (after === null && isOp(peek(), ";")) {
				i += 1;
				continue;
			}
			if (after !== null && isOp(peek(), ";"))
				stopAt(connectorAt, `${after} needs a command after it`);
			for (const op of ["&", "&&", "||"] as const)
				if (isOp(peek(), op)) stopAt(startOf(peek()), `${op} needs a command before it`);
			const one = statement();
			statements.push({...one, after});
			const t = peek();
			const chained = isOp(t, "&&") || isOp(t, "||");
			// A chain runs here, each step on the last one's status: no part of it is a job.
			if (one.background && (after !== null || chained))
				stopAt(
					startOf(t),
					"a job (&) cannot be part of an && or || chain: tsh runs a chain here, each step on the last one's status",
				);
			if (t === undefined) break;
			if (chained) {
				after = isOp(t, "&&") ? "&&" : "||";
				connectorAt = t.start;
				i += 1;
				if (i >= tokens.length) stopAt(connectorAt, `${after} needs a command after it`);
				continue;
			}
			after = null;
			if (isOp(t, ";") || isOp(t, "&")) {
				i += 1;
				continue;
			}
			stopAt(t.start, `expected ; or the end of the line, not ${t.kind === "op" ? t.op : t.text}`);
		}
		return {kind: "parsed", statements};
	};
	return caught(walk);
}

function caught(walk: () => Parsed): Parsed {
	try {
		return walk();
	} catch (stop) {
		if (stop instanceof Stop) return stop.refusal;
		throw stop;
	}
}
