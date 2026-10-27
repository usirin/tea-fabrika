import {TABLE} from "./cells.table.ts";

// How ghostty-web lays text out in cells, so the editor counts cells as the terminal does. It is
// Ghostty's own `print` (src/terminal/Terminal.zig at 5714ed0, the Ghostty commit ghostty-web
// 0.4.0 is built from), with grapheme clustering on (mode 2027), as ghostty-web has it:
//
//   spot("tsh$ 漢字", 80)          9: a wide character takes two cells
//   spot("tsh$ é", 80)             6: the accent (U+0301) joins the e's cell
//   spot("tsh$ ©️", 80)            7: U+FE0F makes the © two cells wide
//   spot("tsh$ abc", 8)            8: the row is full, so the next character goes on the next row
//
// What it knows of each code point (its width, its grapheme class, and whether U+FE0E and U+FE0F
// change its width) is a table made from ghostty-web's own wasm (cells.table.ts, written by
// ../../table.ts). cells.test.ts checks that table against the wasm, code point by code point,
// and this layout against ghostty-web on many texts and widths.
//
// The rules, from Ghostty's `print`:
//
//   - A code point past U+00FF may join the cell before the cursor, as one grapheme, when
//     Ghostty's grapheme break rule says there is no break (`breaks`). Then it takes no cell.
//   - U+FE0F after a narrow emoji makes it wide; U+FE0E after a wide one makes it narrow. After
//     anything else, they are dropped.
//   - Otherwise a code point takes its width: one cell up to U+00FF, else the table's 0, 1 or 2.
//     One of width 0 that joined nothing is dropped.
//   - A wide character that does not fit the row's last cell leaves it blank and goes on the next
//     row. A character in the last cell leaves the cursor there, and the next one wraps first.

/** A code point's grapheme class, as Ghostty's break rule sees it. */
export const CLASSES = [
	"other",
	"L",
	"V",
	"T",
	"LV",
	"LVT",
	"prepend",
	// Unicode's Extend and SpacingMark: Ghostty's rule treats them the same.
	"extend",
	"zwj",
	"ri",
	// Extended_Pictographic.
	"pict",
	// Emoji_Modifier_Base: Extended_Pictographic too, and an emoji modifier joins it.
	"base",
	"modifier",
] as const;
export type Class = (typeof CLASSES)[number];

/** What Ghostty knows of a code point. */
export interface Facts {
	/** Cells it takes on its own: 0, 1 or 2. Ghostty gives one up to U+00FF whatever this says. */
	readonly width: number;
	readonly class: Class;
	/** U+FE0F makes it wide, and U+FE0E narrow (Unicode's emoji-variation-sequences.txt). */
	readonly vs: boolean;
}

/** Facts in one small number, as the table holds them: width, class, then `vs`. */
export const pack = (f: Facts): number =>
	f.width | (CLASSES.indexOf(f.class) << 2) | (f.vs ? 1 << 6 : 0);

const unpack = (n: number): Facts => ({
	width: n & 3,
	class: CLASSES[(n >> 2) & 15] ?? "other",
	vs: (n & (1 << 6)) !== 0,
});

// The table as text: a run of code points with the same facts is its length in base 36, then its
// facts, packed, as two capital letters (`AA` is 0, `AB` 1, `BA` 26). The runs cover U+0000 to
// U+10FFFF, in order.

/** The runs of a table's text: where each starts, and its facts. */
export const runsOf = (
	text: string,
): {readonly starts: readonly number[]; readonly facts: readonly Facts[]} => {
	const starts: number[] = [];
	const facts: Facts[] = [];
	let at = 0;
	for (const [, length = "", letters = ""] of text.matchAll(/([0-9a-z]+)([A-Z]{2})/g)) {
		starts.push(at);
		facts.push(unpack((letters.charCodeAt(0) - 65) * 26 + letters.charCodeAt(1) - 65));
		at += Number.parseInt(length, 36);
	}
	if (at !== 0x110000) throw new Error(`cells.table.ts: the runs cover ${at} code points, not all`);
	return {starts, facts};
};

/** The text of a table, from each code point's facts, packed. */
export const tableOf = (packed: ArrayLike<number>): string => {
	let text = "";
	let from = 0;
	for (let cp = 1; cp <= packed.length; cp += 1) {
		if (cp < packed.length && packed[cp] === packed[from]) continue;
		const n = packed[from] ?? 0;
		text += (cp - from).toString(36) + String.fromCharCode(65 + Math.floor(n / 26), 65 + (n % 26));
		from = cp;
	}
	return text;
};

// Read on the first call, not on import: ../../table.ts imports this file to write a new table,
// and a table that is wrong must not stop it.
let runs: ReturnType<typeof runsOf> | undefined;

/** What Ghostty knows of `cp`: the run it falls in. */
export const factsOf = (cp: number): Facts => {
	runs ??= runsOf(TABLE);
	const {starts, facts} = runs;
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((starts[mid] ?? 0) <= cp) lo = mid;
		else hi = mid - 1;
	}
	return facts[lo] ?? {width: 1, class: "other", vs: false};
};

// --- Ghostty's grapheme break rule (src/unicode/grapheme.zig, from utf8proc) ---

interface BreakState {
	pict: boolean;
	ri: boolean;
}

const isPict = (k: Class) => k === "pict" || k === "base";

/** Whether there is a grapheme break between two code points of these classes. */
const breaks = (k1: Class, k2: Class, state: BreakState): boolean => {
	// GB11 remembers an emoji seen in the cluster.
	if (!state.pict && isPict(k1)) state.pict = true;
	// GB6, GB7, GB8: Hangul syllables.
	if (k1 === "L" && (k2 === "L" || k2 === "V" || k2 === "LV" || k2 === "LVT")) return false;
	if ((k1 === "LV" || k1 === "V") && (k2 === "V" || k2 === "T")) return false;
	if ((k1 === "LVT" || k1 === "T") && k2 === "T") return false;
	// GB9, GB9a, GB9b.
	if (k2 === "extend" || k2 === "zwj") return false;
	if (k1 === "prepend") return false;
	// GB12, GB13: flags are pairs of regional indicators.
	if (k1 === "ri" && k2 === "ri") {
		const second = state.ri;
		state.ri = !second;
		return second;
	}
	// GB11: an emoji, ZWJ, an emoji.
	if (state.pict && k1 === "zwj" && isPict(k2)) {
		state.pict = false;
		return false;
	}
	// UTS #51: a skin tone joins an emoji that takes one.
	if (k1 === "base" && k2 === "modifier") return false;
	return true;
};

/** Whether `cp` starts a new grapheme after the code points of a cell. */
const breaksAfter = (cluster: readonly number[], cp: number): boolean => {
	const state: BreakState = {pict: false, ri: false};
	let k1 = factsOf(cluster[0] ?? 0).class;
	for (const c of cluster.slice(1)) {
		const k2 = factsOf(c).class;
		breaks(k1, k2, state);
		k1 = k2;
	}
	return breaks(k1, factsOf(cp).class, state);
};

// --- Ghostty's print ---

/**
 * How a cell sits in a wide character: `wide` holds it, `tail` is the second cell behind it, and
 * `head` is a row's last cell left blank because a wide character did not fit there.
 */
export type Wide = "narrow" | "wide" | "tail" | "head";

/** One cell: the code points drawn in it, none when blank, and its part in a wide character. */
export interface Cell {
	readonly cps: readonly number[];
	readonly wide: Wide;
}

export const BLANK: Cell = {cps: [], wide: "narrow"};

/** Where printing is: the cursor's row, its column, and whether a wrap waits for the next character. */
export interface Pen {
	row: Cell[];
	x: number;
	pending: boolean;
}

const VS15 = 0xfe0e;
const VS16 = 0xfe0f;

/** Write one cell at the cursor, clearing the other half of a wide character it writes over. */
const put = (pen: Pen, cell: Cell): void => {
	const {row, x} = pen;
	const was = row[x];
	if (was?.wide === "wide" && row[x + 1] !== undefined) row[x + 1] = BLANK;
	if (was?.wide === "tail" && x > 0) row[x - 1] = BLANK;
	while (row.length < x) row.push(BLANK);
	row[x] = cell;
};

const wrap = (pen: Pen, next: () => Cell[]): void => {
	pen.row = next();
	pen.x = 0;
	pen.pending = false;
};

/**
 * Join `cp` to the cell before the cursor, if there is no grapheme break: true when it is done
 * with `cp`, joined or dropped. Ghostty's quirk is kept: with a wrap waiting, the cell it looks
 * at is the one before the last cell, not the last cell.
 */
const joined = (pen: Pen, cp: number, cols: number): boolean => {
	const left = pen.row[pen.x - 1]?.wide === "tail" ? 2 : 1;
	const at = pen.x - left;
	const prev = pen.row[at];
	if (prev === undefined || prev.cps.length === 0 || breaksAfter(prev.cps, cp)) return false;
	if (cp === VS16 || cp === VS15) {
		const base = prev.cps[0] ?? 0;
		if (!factsOf(base).vs) return true;
		if (cp === VS16 && prev.wide !== "wide") {
			// Drawn again, wide: the cell keeps only its first code point, then U+FE0F.
			pen.x = at;
			put(pen, {cps: [base], wide: "wide"});
			pen.x += 1;
			put(pen, {cps: [], wide: "tail"});
			if (pen.x === cols - 1) pen.pending = true;
			else pen.x += 1;
		}
		if (cp === VS15 && prev.wide === "wide") {
			pen.row[at] = {...prev, wide: "narrow"};
			pen.row[at + 1] = {...(pen.row[at + 1] ?? BLANK), wide: "narrow"};
			if (pen.x === cols - 1) pen.pending = false;
			else pen.x -= 1;
		}
	}
	const cell = pen.row[at] ?? BLANK;
	pen.row[at] = {...cell, cps: [...cell.cps, cp]};
	return true;
};

/** Print one code point at the pen, as Ghostty does. `next` is the row a wrap goes to. */
export const print = (pen: Pen, code: number, cols: number, next: () => Cell[]): void => {
	// A string goes to the terminal as UTF-8, where a lone surrogate is U+FFFD.
	const cp = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
	if (cp > 0xff && pen.x > 0 && joined(pen, cp, cols)) return;
	const width = cp <= 0xff ? 1 : factsOf(cp).width;
	if (width === 0) return;
	if (pen.pending) wrap(pen, next);
	if (width === 1) put(pen, {cps: [cp], wide: "narrow"});
	else if (cols > 1) {
		if (pen.x === cols - 1) {
			put(pen, {cps: [], wide: "head"});
			wrap(pen, next);
		}
		put(pen, {cps: [cp], wide: "wide"});
		pen.x += 1;
		put(pen, {cps: [], wide: "tail"});
	} else put(pen, BLANK);
	if (pen.x === cols - 1) pen.pending = true;
	else pen.x += 1;
};

/**
 * Where the cursor is after `text`, written from a row's first cell on rows `cols` wide: as a
 * count of cells, `row * cols + column`. A wrap that waits counts as the next row's first cell,
 * where the next character goes.
 */
export const spot = (text: string, cols: number): number => {
	let rows = 0;
	const pen: Pen = {row: [], x: 0, pending: false};
	const next = () => {
		rows += 1;
		return [];
	};
	for (const c of text) print(pen, c.codePointAt(0) ?? 0, cols, next);
	return pen.pending ? (rows + 1) * cols : rows * cols + pen.x;
};

/** How many cells `text` takes on a row with no end. */
export const cells = (text: string): number => spot(text, Number.MAX_SAFE_INTEGER);
