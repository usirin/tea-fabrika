// A terminal's grid, for tests: what a run of bytes leaves on the screen, and where the cursor is.
// It knows only what the line editor writes (./screen.ts): text with a VT100's wrap at the last
// column, CR, LF, cursor up and right, clear to the end of the row, clear below, home and clear
// screen. Anything else is drawn as the character it is, so a test sees it: a CSI sequence it does
// not know is written out as `^[[` and the rest.
//
//   gridOf("tsh$ seq\r\x1b[5C", 80)    {rows: ["tsh$ seq"], cursor: {row: 0, col: 5}}
//   gridOf("tsh$ seq\r\x1b[K", 80)     {rows: [""], cursor: {row: 0, col: 0}}

export interface Grid {
	/** Every row written, oldest first, with no trailing spaces. */
	readonly rows: readonly string[];
	/** Where the cursor is: a row of `rows`, and a column. */
	readonly cursor: {readonly row: number; readonly col: number};
}

export function gridOf(bytes: string, cols: number, height = 24): Grid {
	const rows: string[][] = [[]];
	let row = 0;
	let col = 0;
	// A character written in the last column leaves the cursor there; the next one goes on a new row.
	let waiting = false;
	const top = () => Math.max(0, rows.length - height);
	const down = () => {
		row += 1;
		if (row >= rows.length) rows.push([]);
	};
	const put = (c: string) => {
		if (waiting) {
			down();
			col = 0;
			waiting = false;
		}
		const line = rows[row] ?? [];
		while (line.length < col) line.push(" ");
		line[col] = c;
		rows[row] = line;
		if (col === cols - 1) waiting = true;
		else col += 1;
	};
	const chars = [...bytes];
	for (let i = 0; i < chars.length; i += 1) {
		const c = chars[i] ?? "";
		if (c === "\r") {
			col = 0;
			waiting = false;
		} else if (c === "\n") {
			down();
			waiting = false;
		} else if (c === "\x07") {
			// The bell: nothing on the screen.
		} else if (c === "\x1b" && chars[i + 1] === "[") {
			let end = i + 2;
			while (end < chars.length && /[0-9;]/.test(chars[end] ?? "")) end += 1;
			const n = Number(chars.slice(i + 2, end).join("") || "0");
			const final = chars[end];
			const known = ["A", "C", "H", "K", "J"].includes(final ?? "") && (final !== "K" || n === 0);
			if (!known) {
				for (const d of ["^", "[", "[", ...chars.slice(i + 2, end + 1)]) put(d);
				i = end;
				continue;
			}
			i = end;
			waiting = false;
			if (final === "A") row = Math.max(top(), row - Math.max(1, n));
			else if (final === "C") col = Math.min(cols - 1, col + Math.max(1, n));
			else if (final === "H") {
				row = top();
				col = 0;
			} else if (final === "K") {
				// To the end of the row, the cursor where it was.
				rows[row] = (rows[row] ?? []).slice(0, col);
			} else if (final === "J" && n === 2) {
				for (let r = top(); r < rows.length; r += 1) rows[r] = [];
			} else if (final === "J") {
				rows[row] = (rows[row] ?? []).slice(0, col);
				rows.length = row + 1;
			}
		} else put(c);
	}
	return {rows: rows.map((r) => r.join("").trimEnd()), cursor: {row, col}};
}
