// What the terminal sends, cut into keys, and each key named by what it does. The names are GNU
// Readline's own ("Bindable Readline Commands" in its manual), and the keys are its default emacs
// keys, so a person who knows bash's line knows this one.
//
//   keysIn("ls\x1b[D\x01")       ["ls", "\x1b[D", "\x01"]    text, Left, Ctrl-A
//   keyOf("\x01")                {kind: "command", command: "beginning-of-line"}
//   keyOf("\x1bb")               {kind: "command", command: "backward-word"}       Alt-B: ESC, then b
//   keyOf("cou")                 {kind: "text", text: "cou"}
//   keyOf("\x1b[24~")            {kind: "unknown"}                                 F12: nothing
//
// A terminal sends Alt and a key as ESC and that key (readline's "meta"), and the arrows and Home,
// End and Delete as escape sequences: `ESC [` and numbers, then one letter or `~`.

import {defaults} from "../desk/keymap.ts";
import {promptKeys} from "./bindings.ts";

export interface KeyTable {
	readonly rows: readonly {
		readonly target?: {
			readonly program: string;
			readonly word: string;
			readonly mode: string | null;
		};
		readonly keys: readonly {readonly _tag: string; readonly key: string}[];
	}[];
}
export const editorRows = (keys: KeyTable) => [
	...new Map(
		keys.rows.map(
			(row) => [`${row.target?.program}.${row.target?.word}:${row.target?.mode}`, row] as const,
		),
	).values(),
];

export type Command =
	| "beginning-of-line"
	| "end-of-line"
	| "backward-char"
	| "forward-char"
	| "backward-word"
	| "forward-word"
	| "backward-delete-char"
	| "delete-char"
	| "kill-line"
	| "unix-line-discard"
	| "unix-word-rubout"
	| "kill-word"
	| "backward-kill-word"
	| "yank"
	| "transpose-chars"
	| "clear-screen"
	| "accept-line"
	| "previous-history"
	| "next-history"
	| "reverse-search-history"
	| "complete"
	/** Ctrl-C. Not readline's: the terminal's own interrupt key, which bash catches as readline does. */
	| "interrupt"
	/** Ctrl-D. On an empty line, the end of input; else `delete-char`, as readline treats it. */
	| "end-of-file";

export type Key =
	| {readonly kind: "text"; readonly text: string}
	| {readonly kind: "command"; readonly command: Command}
	| {readonly kind: "unknown"};

/** The kill commands: two in a row join in what Ctrl-Y puts back, as readline's kill ring does. */
export const KILLS: ReadonlySet<Command> = new Set<Command>([
	"kill-line",
	"unix-line-discard",
	"unix-word-rubout",
	"kill-word",
	"backward-kill-word",
]);

const ESC = "\x1b";

/** Terminal encodings normalize to key names before consulting the applied table. */
const NAMES: ReadonlyMap<string, string> = new Map([
	...Array.from(
		{length: 26},
		(_, i) => [String.fromCharCode(i + 1), `<c-${String.fromCharCode(i + 97)}>`] as const,
	),
	["\x1b", "<escape>"],
	["\r", "<enter>"],
	["\n", "<enter>"],
	["\t", "<tab>"],
	["\x7f", "<backspace>"],
	["\b", "<backspace>"],
	[`${ESC}[H`, "<home>"],
	[`${ESC}OH`, "<home>"],
	[`${ESC}[1~`, "<home>"],
	[`${ESC}[F`, "<end>"],
	[`${ESC}OF`, "<end>"],
	[`${ESC}[4~`, "<end>"],
	[`${ESC}[D`, "<arrowleft>"],
	[`${ESC}OD`, "<arrowleft>"],
	[`${ESC}[C`, "<arrowright>"],
	[`${ESC}OC`, "<arrowright>"],
	[`${ESC}b`, "<a-b>"],
	[`${ESC}[1;3D`, "<a-b>"],
	[`${ESC}[1;5D`, "<a-b>"],
	[`${ESC}f`, "<a-f>"],
	[`${ESC}[1;3C`, "<a-f>"],
	[`${ESC}[1;5C`, "<a-f>"],
	[`${ESC}[3~`, "<delete>"],
	[`${ESC}d`, "<a-d>"],
	[`${ESC}\x7f`, "<a-backspace>"],
	[`${ESC}[A`, "<arrowup>"],
	[`${ESC}OA`, "<arrowup>"],
	[`${ESC}[B`, "<arrowdown>"],
	[`${ESC}OB`, "<arrowdown>"],
]);

export const nameOfBytes = (raw: string): string | null =>
	NAMES.get(raw) ?? (raw.startsWith(ESC) && [...raw].length === 2 ? `<a-${raw.slice(1)}>` : null);

/** A character a line can hold: not a control character, not DEL, not one of the C1 controls. */
export const printable = (c: string): boolean => {
	const code = c.codePointAt(0) ?? 0;
	return code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f);
};

/**
 * What the terminal sent in one go, cut into keys: an escape sequence whole, ESC and one key (Alt
 * and that key) as one, a run of plain characters (typed fast, or pasted) as one, and each control
 * character alone.
 */
export function keysIn(raw: string): readonly string[] {
	const keys: string[] = [];
	const chars = [...raw];
	let text = "";
	const flush = () => {
		if (text !== "") keys.push(text);
		text = "";
	};
	for (let i = 0; i < chars.length; i += 1) {
		const c = chars[i] ?? "";
		if (printable(c)) {
			text += c;
			continue;
		}
		flush();
		const next = chars[i + 1];
		if (c !== ESC || next === undefined) {
			keys.push(c);
			continue;
		}
		if (next === "[") {
			// CSI: parameters, then one final character.
			let end = i + 2;
			while (end < chars.length && /[0-9;?]/.test(chars[end] ?? "")) end += 1;
			keys.push(chars.slice(i, end + 1).join(""));
			i = end;
			continue;
		}
		// SS3 (`ESC O` and one more), or Alt and one key.
		const length = next === "O" ? 3 : 2;
		keys.push(chars.slice(i, i + length).join(""));
		i += length - 1;
	}
	flush();
	return keys;
}

/** One key, as what it does. */
export function keyOf(
	raw: string,
	context?: {readonly keys: KeyTable; readonly mode: string | null},
): Key {
	if (raw === "\x03") return {kind: "command", command: "interrupt"};
	const name = nameOfBytes(raw);
	const rows = editorRows(context?.keys ?? defaults);
	const mode = context?.mode ?? null;
	const row = rows.find(
		(row) =>
			row.target?.program === "tsh" &&
			row.target.mode === mode &&
			row.keys.some((key) => key._tag === "alone" && key.key === name),
	);
	if (row?.target !== undefined && Object.hasOwn(promptKeys, row.target.word))
		return {kind: "command", command: row.target.word as Command};
	if (raw !== "" && [...raw].every(printable)) return {kind: "text", text: raw};
	return {kind: "unknown"};
}
