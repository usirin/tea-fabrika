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

/** Each key, as the terminal sends it, and the command readline's emacs keys bind it to. */
const BOUND: ReadonlyMap<string, Command> = new Map<string, Command>([
	["\x01", "beginning-of-line"],
	[`${ESC}[H`, "beginning-of-line"],
	[`${ESC}OH`, "beginning-of-line"],
	[`${ESC}[1~`, "beginning-of-line"],
	["\x05", "end-of-line"],
	[`${ESC}[F`, "end-of-line"],
	[`${ESC}OF`, "end-of-line"],
	[`${ESC}[4~`, "end-of-line"],
	["\x02", "backward-char"],
	[`${ESC}[D`, "backward-char"],
	[`${ESC}OD`, "backward-char"],
	["\x06", "forward-char"],
	[`${ESC}[C`, "forward-char"],
	[`${ESC}OC`, "forward-char"],
	[`${ESC}b`, "backward-word"],
	[`${ESC}[1;3D`, "backward-word"],
	[`${ESC}[1;5D`, "backward-word"],
	[`${ESC}f`, "forward-word"],
	[`${ESC}[1;3C`, "forward-word"],
	[`${ESC}[1;5C`, "forward-word"],
	["\x7f", "backward-delete-char"],
	["\x08", "backward-delete-char"],
	[`${ESC}[3~`, "delete-char"],
	["\x0b", "kill-line"],
	["\x15", "unix-line-discard"],
	["\x17", "unix-word-rubout"],
	[`${ESC}d`, "kill-word"],
	[`${ESC}\x7f`, "backward-kill-word"],
	["\x19", "yank"],
	["\x14", "transpose-chars"],
	["\x0c", "clear-screen"],
	["\r", "accept-line"],
	["\n", "accept-line"],
	["\x10", "previous-history"],
	[`${ESC}[A`, "previous-history"],
	[`${ESC}OA`, "previous-history"],
	["\x0e", "next-history"],
	[`${ESC}[B`, "next-history"],
	[`${ESC}OB`, "next-history"],
	["\x12", "reverse-search-history"],
	["\t", "complete"],
	["\x03", "interrupt"],
	["\x04", "end-of-file"],
]);

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
export function keyOf(raw: string): Key {
	const command = BOUND.get(raw);
	if (command !== undefined) return {kind: "command", command};
	if (raw !== "" && [...raw].every(printable)) return {kind: "text", text: raw};
	return {kind: "unknown"};
}
