// The bytes the line editor writes to the terminal: text, and a few VT100 cursor moves. Pure, so
// the editor's tests read them back with a grid (./grid.ts), not by eye.
//
//   draw("tsh$ seq", 8, 80)      clear below, write it, and leave the cursor 8 cells in
//   back(8, 80)                  "\r": back to the prompt's first cell, on the same row
//   back(85, 80)                 "\r\x1b[1A": a row up as well, the line wrapped once
//   shown("a\x1b]0;x\x07b")      "a^[]0;x^Gb": a program's text cannot move the cursor or retitle the window
//
// The editor redraws the whole prompt line on each change, as linenoise does: back to its first
// cell, clear to the end of the screen, write it again. A line longer than the terminal is wide
// wraps onto more rows, and `back` counts them. Every character is one cell for now: a wide one
// (CJK, most emoji) puts the cursor off by one cell per character.

export const PROMPT = "tsh$ ";

const CSI = "\x1b[";

/** How many cells a text takes: one per code point. */
export const cells = (text: string): number => [...text].length;

const up = (rows: number) => (rows > 0 ? `${CSI}${rows}A` : "");
const right = (cols: number) => (cols > 0 ? `${CSI}${cols}C` : "");

/** From `at` cells past the prompt's first cell, back to that cell. */
export const back = (at: number, cols: number): string => `\r${up(Math.floor(at / cols))}`;

/**
 * Write `text` from the cursor, which is on the prompt's first cell, clearing everything below it
 * first, and leave the cursor `at` cells in.
 */
export const draw = (text: string, at: number, cols: number): string => {
	const end = cells(text);
	// A row filled to its last cell leaves the cursor waiting on it: a new row puts it where `end` says.
	const wrap = end > 0 && end % cols === 0 ? "\r\n" : "";
	const rows = Math.floor(end / cols) - Math.floor(at / cols);
	return `${CSI}J${text}${wrap}${up(rows)}\r${right(at % cols)}`;
};

/** Clear the screen, as Ctrl-L does: the cursor goes to the top row, and the rows above stay in the scrollback. */
export const CLEAR = `${CSI}H${CSI}2J`;

/** A new row, from the end of the current one. */
export const NEWLINE = "\r\n";

/** The terminal's bell. */
export const BELL = "\x07";

/** Clear from the cursor to the end of the screen. */
export const CLEAR_BELOW = `${CSI}J`;

/**
 * A text from a program, made safe to show: each control character is written as `^` and a letter,
 * as `cat -v` does, so no text can move the cursor, clear the screen or retitle the window. A tab
 * stays a tab, and a new line becomes a new row.
 */
export const shown = (text: string): string =>
	[...text]
		.map((c) => {
			if (c === "\n") return NEWLINE;
			if (c === "\t") return c;
			const code = c.codePointAt(0) ?? 0;
			if (code < 0x20 || code === 0x7f) return `^${String.fromCharCode(code ^ 0x40)}`;
			if (code >= 0x80 && code <= 0x9f) return "\u{fffd}";
			return c;
		})
		.join("");

/**
 * Candidates in columns, down then across, as readline lists them on a second Tab. Each row ends
 * with a new row.
 */
export const columns = (items: readonly string[], cols: number): string => {
	const width = Math.max(...items.map(cells)) + 2;
	const across = Math.max(1, Math.floor(cols / width));
	const down = Math.ceil(items.length / across);
	const rows: string[] = [];
	for (let r = 0; r < down; r += 1) {
		const row: string[] = [];
		for (let c = 0; c < across; c += 1) {
			const item = items[c * down + r];
			if (item !== undefined) row.push(item.padEnd(width));
		}
		rows.push(row.join("").trimEnd());
	}
	return rows.map((row) => `${row}${NEWLINE}`).join("");
};
