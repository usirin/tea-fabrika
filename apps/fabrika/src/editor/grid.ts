import {type Cell, type Pen, print} from "./cells.ts";

// A terminal's grid, for tests: what a run of bytes leaves on the screen, and where the cursor is.
// It knows only what the line editor writes (./screen.ts): text with a VT100's wrap at the last
// column, CR, LF, cursor up and right, clear to the end of the row, clear below, home and clear
// screen, the full reset a screen shown again starts with (tsh.ts), and the colors of a table
// (SGR, `m`), which leave nothing on the grid: it keeps text only. Anything else is drawn as
// the character it is, so a test sees it: a CSI sequence it does not know is written out as `^[[`
// and the rest.
//
//   gridOf("tsh$ seq\r\x1b[5C", 80)    {rows: ["tsh$ seq"], cursor: {row: 0, col: 5}}
//   gridOf("tsh$ seq\r\x1b[K", 80)     {rows: [""], cursor: {row: 0, col: 0}}
//   gridOf("old\n\x1bcnew", 80)        {rows: ["new"], cursor: {row: 0, col: 3}}
//   gridOf("漢字", 3)                  {rows: ["漢", "字"], cursor: {row: 1, col: 2}}
//
// Text takes cells as ghostty-web gives them (./cells.ts, `print`): a wide character two, and an
// accent none, as it joins the cell before it.

export interface Grid {
	/** Every row written, oldest first, with no trailing spaces. */
	readonly rows: readonly string[];
	/** Where the cursor is: a row of `rows`, and a column. */
	readonly cursor: {readonly row: number; readonly col: number};
}

/** A row as text: a blank cell is a space, and the second cell of a wide character is nothing. */
const textOf = (row: readonly Cell[]): string =>
	row
		.map((c) =>
			c.wide === "tail" ? "" : c.cps.length === 0 ? " " : String.fromCodePoint(...c.cps),
		)
		.join("")
		.trimEnd();

export function gridOf(bytes: string, cols: number, height = 24): Grid {
	const rows: Cell[][] = [[]];
	let y = 0;
	const rowAt = (r: number): Cell[] => {
		while (rows.length <= r) rows.push([]);
		return rows[r] ?? [];
	};
	// A character written in the last column leaves the cursor there, a wrap waiting: the next one
	// goes on a new row.
	const pen: Pen = {row: rowAt(0), x: 0, pending: false};
	const top = () => Math.max(0, rows.length - height);
	const moveTo = (r: number, x: number) => {
		y = r;
		pen.row = rowAt(r);
		pen.x = x;
		pen.pending = false;
	};
	const next = () => {
		y += 1;
		return rowAt(y);
	};
	const put = (c: string) => print(pen, c.codePointAt(0) ?? 0, cols, next);
	const chars = [...bytes];
	for (let i = 0; i < chars.length; i += 1) {
		const c = chars[i] ?? "";
		if (c === "\r") moveTo(y, 0);
		else if (c === "\n") moveTo(y + 1, pen.x);
		else if (c === "\x07") {
			// The bell: nothing on the screen.
		} else if (c === "\x1b" && chars[i + 1] === "c") {
			// A full reset: every row gone, scrollback too, the cursor home.
			rows.length = 0;
			moveTo(0, 0);
			i += 1;
		} else if (c === "\x1b" && chars[i + 1] === "[") {
			let end = i + 2;
			while (end < chars.length && /[0-9;]/.test(chars[end] ?? "")) end += 1;
			const n = Number(chars.slice(i + 2, end).join("") || "0");
			const final = chars[end];
			const known =
				["A", "C", "H", "K", "J", "m"].includes(final ?? "") && (final !== "K" || n === 0);
			if (!known) {
				for (const d of ["^", "[", "[", ...chars.slice(i + 2, end + 1)]) put(d);
				i = end;
				continue;
			}
			i = end;
			if (final === "A") moveTo(Math.max(top(), y - Math.max(1, n)), pen.x);
			else if (final === "C") moveTo(y, Math.min(cols - 1, pen.x + Math.max(1, n)));
			else if (final === "H") moveTo(top(), 0);
			else if (final === "K") {
				// To the end of the row, the cursor where it was.
				pen.row.length = Math.min(pen.row.length, pen.x);
				pen.pending = false;
			} else if (final === "J" && n === 2) {
				for (let r = top(); r < rows.length; r += 1) rowAt(r).length = 0;
				pen.pending = false;
			} else if (final === "J") {
				pen.row.length = Math.min(pen.row.length, pen.x);
				rows.length = y + 1;
				pen.pending = false;
			}
		} else put(c);
	}
	return {rows: rows.map(textOf), cursor: {row: y, col: pen.x}};
}
