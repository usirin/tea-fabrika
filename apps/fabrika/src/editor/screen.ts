import {Shell} from "@kampus/fabrika";
import {cells, spot} from "./cells.ts";

// The bytes the line editor writes to the terminal: text, and a few VT100 cursor moves. Pure, so
// the editor's tests read them back with a grid (./grid.ts), not by eye.
//
//   draw("tsh$ seq", 8, 80)      clear below, write it and a blank, and leave the cursor 8 cells in
//   back(8, 80)                  "\r": back to the prompt's first cell, on the same row
//   back(85, 80)                 "\r\x1b[1A": a row up as well, the line wrapped once
//   shown("a\x1b]0;x\x07b")      "a^[]0;x^Gb": a program's text cannot move the cursor or retitle the window
//
//   redrawRow("tsh$ seq", 5)     "\r\x1b[K", write it and a blank, and leave the cursor 5 cells in: one row only
//
// The editor redraws the whole prompt line on each change, as linenoise does: back to its first
// cell, clear to the end of the screen, write it again. A line longer than the terminal is wide
// wraps onto more rows, and `back` counts them. A line that fits its one row, before and after a
// change, is cleared to the end of that row only (`redrawRow`): a terminal then has one changed
// row to draw, not every row under the prompt (experiment 143).
//
// Cells are counted as ghostty-web counts them (`spot`, ./cells.ts): a wide character takes two,
// an accent joins the cell before it. `at` is a cursor's place in the line as `spot` counts it,
// `row * cols + column` from the prompt's first cell.
//
// A width change: the editor writes nothing. The terminal reflows the line, which is one line to
// it, wrapped where the row ends, and carries the cursor with its cell, as fish leaves it to a
// terminal that reflows. The next redraw goes back to the prompt by the new width. For that the
// cursor always sits on a cell that was written, so a blank goes after the line: ghostty-web
// 0.4.0 does not carry a cursor on a cell never written. readline writes a space at a full row's
// end for a like reason, to know where the cursor is.

export const PROMPT = "tsh$ ";

const CSI = "\x1b[";

export {cells, spot};

const up = (rows: number) => (rows > 0 ? `${CSI}${rows}A` : "");
const right = (cols: number) => (cols > 0 ? `${CSI}${cols}C` : "");

/** From the cursor at `at`, back to the prompt's first cell. */
export const back = (at: number, cols: number): string => `\r${up(Math.floor(at / cols))}`;

/**
 * Write `text` from the cursor, which is on the prompt's first cell, clearing everything below it
 * first, and leave the cursor at `at`. Blanks go after the line up to the cursor's cell: one, or
 * two when a U+FE0E after the cursor took a cell back from a wide emoji before it.
 */
export const draw = (text: string, at: number, cols: number): string => {
	const end = spot(text, cols);
	const blanks = Math.max(1, at + 1 - end);
	const rows = Math.floor((end + blanks - 1) / cols) - Math.floor(at / cols);
	return `${CSI}J${text}${" ".repeat(blanks)}${up(rows)}\r${right(at % cols)}`;
};

/**
 * Whether `text` fits one row `cols` wide, with room for the cursor after it, and has no
 * character at or past U+1100, where wide characters start (Unicode's East Asian Width). The
 * guard is from when `cells` gave a wide character one cell. `cells` is right now, but the row
 * path was tested with the guard (the laws in editor.laws.test.ts), so it stays.
 */
export const fitsRow = (text: string, cols: number): boolean =>
	cells(text) < cols && [...text].every((c) => (c.codePointAt(0) ?? 0) < 0x1100);

/**
 * Write `text` and a blank over the row the cursor is on, from its first cell, clearing the rest
 * of the row, and leave the cursor at `at`. For a line that fits its row (`fitsRow`), drawn over
 * a line that fit it too: nothing else of the line is on another row.
 */
export const redrawRow = (text: string, at: number): string => `\r${CSI}K${text} \r${right(at)}`;

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
 * How the app's terminal draws a table's tones, in its own palette (window/window.css), as 24-bit
 * color: strong is the first ink and bold, muted the faint text, faint the wire's gray, accent the
 * "your turn" blue, warning the amber. Plain text keeps the terminal's own ink, the second.
 */
const PALETTE: Shell.Palette = {
	strong: "1;38;2;235;235;236", // --n-12, --text-primary
	muted: "38;2;134;136;138", // --n-9, --text-faint
	faint: "38;2;93;95;98", // between --n-8 and --n-9: a header is read, but last
	accent: "38;2;164;189;245", // --a-11, --turn
	warning: "38;2;229;190;119", // --running
};

/**
 * A table tsh printed, laid out at `cols` and painted in the app's palette. Every text goes
 * through `shown` first, so a cell can no more move the cursor than a printed line can; the only
 * escapes in it are the colors put here.
 */
export const table = (t: Shell.Table, cols: number): string =>
	Shell.paint(
		Shell.tableLines(t, cols).map((line) => line.map((s) => ({...s, text: shown(s.text)}))),
		PALETTE,
		NEWLINE,
	);

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
			if (item !== undefined) row.push(item + " ".repeat(width - cells(item)));
		}
		rows.push(row.join("").trimEnd());
	}
	return rows.map((row) => `${row}${NEWLINE}`).join("");
};
