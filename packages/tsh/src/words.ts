// The shell words of one tsh line: what a line is cut into before the
// grammar reads it. Every token keeps where it stands on the line, so a
// refusal can point at the character, and completion can tell which word the
// cursor is in.
//
//   words(`ship --mode read pr="https://x/pull/1" | review &`)
//   // word ship · word --mode · word read · word pr=https://x/pull/1 · op | · word review · op &
//
// The rules are a small part of a POSIX shell's:
//
//   - spaces and tabs part words; a new line is `;`
//   - `'…'` keeps everything inside as it is; `"…"` too, except that `\"` and
//     `\\` are one character; outside quotes `\` makes the next character
//     plain
//   - `|`, `&`, `;`, `$(`, `)`, `&&` and `||` are operators when they are not quoted
//   - `#` at the start of a word makes the rest of the line a comment
//
// There is no `$name`, no globbing, no `~`, no redirection to files: a tsh
// line names programs, flags and values, and nothing on the line reads the
// file system.

/** Where a token stands on the line: its first character, and one past its last. */
export interface At {
	readonly start: number;
	readonly end: number;
}

export type Op = "|" | "&" | ";" | "$(" | ")" | "&&" | "||";

export type Token =
	| (At & {readonly kind: "word"; readonly text: string})
	| (At & {readonly kind: "op"; readonly op: Op});

export interface Words {
	readonly tokens: readonly Token[];
	/** A quote was opened and not closed: the last word is still being typed. */
	readonly open: boolean;
	/** The cursor, at the end of the line, is on a new, empty word: after a space or an operator, or on an empty line. */
	readonly trailing: boolean;
}

const SPACE = new Set([" ", "\t"]);
const OPS = new Set(["|", "&", ";", ")", "\n"]);

/** Cut a line into words and operators. It never refuses: what does not make sense is the grammar's to say. */
export function words(line: string): Words {
	const tokens: Token[] = [];
	let at = 0;
	let open = false;
	while (at < line.length) {
		const c = line.charAt(at);
		if (SPACE.has(c)) {
			at += 1;
			continue;
		}
		if (c === "#") {
			// A comment runs to the end of the line, and the line goes on after it.
			const end = line.indexOf("\n", at);
			at = end === -1 ? line.length : end;
			continue;
		}
		if (c === "$" && line.charAt(at + 1) === "(") {
			tokens.push({kind: "op", op: "$(", start: at, end: at + 2});
			at += 2;
			continue;
		}
		if ((c === "&" || c === "|") && line.charAt(at + 1) === c) {
			tokens.push({kind: "op", op: c === "&" ? "&&" : "||", start: at, end: at + 2});
			at += 2;
			continue;
		}
		if (OPS.has(c)) {
			tokens.push({kind: "op", op: c === "\n" ? ";" : (c as Op), start: at, end: at + 1});
			at += 1;
			continue;
		}
		const start = at;
		let text = "";
		let quote: "'" | '"' | null = null;
		while (at < line.length) {
			const ch = line.charAt(at);
			if (quote === "'") {
				if (ch === "'") quote = null;
				else text += ch;
				at += 1;
				continue;
			}
			if (quote === '"') {
				if (ch === '"') quote = null;
				else if (ch === "\\" && (line.charAt(at + 1) === '"' || line.charAt(at + 1) === "\\")) {
					text += line.charAt(at + 1);
					at += 1;
				} else text += ch;
				at += 1;
				continue;
			}
			if (ch === "'" || ch === '"') {
				quote = ch;
				at += 1;
				continue;
			}
			if (ch === "\\") {
				// A `\` at the very end escapes nothing yet: it is still being typed.
				if (at + 1 < line.length) text += line.charAt(at + 1);
				at += 2;
				continue;
			}
			if (SPACE.has(ch) || OPS.has(ch) || (ch === "$" && line.charAt(at + 1) === "(")) break;
			text += ch;
			at += 1;
		}
		open = quote !== null;
		tokens.push({kind: "word", text, start, end: Math.min(at, line.length)});
	}
	const last = tokens.at(-1);
	return {
		tokens,
		open,
		trailing: last === undefined || last.kind === "op" || (!open && last.end < line.length),
	};
}
