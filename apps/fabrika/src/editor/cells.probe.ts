import type {Ghostty, GhosttyTerminal} from "ghostty-web";
import {type Cell, type Class, type Facts, type Pen, pack, print} from "./cells.ts";

// What ghostty-web's wasm knows of each code point, found by writing it in a few places and
// reading the cells back. ghostty-web has no function that says a code point's width or class,
// so this asks its terminal, the one the app draws with. ../../table.ts writes the answers as
// cells.table.ts; cells.test.ts asks again and checks they are the same.
//
// Each probe is a short text written from a row's first cell. Its answer is one number read
// back: how many code points joined the first cell, or which cell the last "x" landed in.
//
//   "©" + c         c joins ©: c is Extend or ZWJ
//   "ᄀ" + c        c joins a Hangul L: c is L, V, LV or LVT, or Extend or ZWJ
//   c + "ğ"         ğ joins c: c is Prepend
//   c + "x"         the cell "x" lands in: c's width
//
// One probe a row, hundreds of rows a write: the wasm is called thousands of times, not millions.

const NAMES = [
	"width",
	"vs",
	"afterPict",
	"afterL",
	"afterLV",
	"afterLVT",
	"afterRi",
	"afterZwj",
	"afterBase",
	"between",
	"beforeOther",
	"beforeV",
	"beforeT",
	"beforeL",
	"beforeRi",
	"beforeModifier",
	"beforeZwj",
] as const;
type Name = (typeof NAMES)[number];

/** The answers of every probe of one code point. */
export type Answers = Readonly<Record<Name, number>>;

const P0 = "؀"; // ARABIC NUMBER SIGN: Prepend, one cell wide. Anything joins it.

/**
 * The text of one probe of `cp`. A code point past U+00FF of width 0 cannot sit in a cell alone,
 * so where one must start a cell, it goes after P0, which it joins.
 */
const textOf = (name: Name, cp: number, width: number): string => {
	const c = String.fromCodePoint(cp);
	const first = cp <= 0xff || width > 0 ? c : P0 + c;
	switch (name) {
		case "width":
			return `${c}x`;
		case "vs":
			return `${c}${width === 2 ? "︎" : "️"}x`;
		case "afterPict":
			return `©${c}`;
		case "afterL":
			return `ᄀ${c}`;
		case "afterLV":
			return `가${c}`;
		case "afterLVT":
			return `각${c}`;
		case "afterRi":
			return `🇹${c}`;
		case "afterZwj":
			return `😀‍${c}`;
		case "afterBase":
			return `☝${c}`;
		case "between":
			return `😀${c}😀`;
		case "beforeOther":
			return `${first}ğ`;
		case "beforeV":
			return `${first}ᅡ`;
		case "beforeT":
			return `${first}ᆨ`;
		case "beforeL":
			return `${first}ᄀ`;
		case "beforeRi":
			return `${first}🇹`;
		case "beforeModifier":
			return `${first}🏽`;
		case "beforeZwj":
			return `${first}‍😀`;
	}
};

/** Whether a probe's answer is the cell its last "x" is in; else, how many code points joined the first cell. */
const readsX = (name: Name): boolean => name === "width" || name === "vs";

/** Whether a probe can say anything of `cp`: one up to U+00FF never joins a cell before it. */
const asks = (name: Name, cp: number): boolean =>
	cp > 0xff || !(name.startsWith("after") || name === "between");

/** A control, which a terminal does not print: none is probed. */
const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

/** The class a code point's answers point to, by Ghostty's break rule (cells.ts). */
const classOf = (cp: number, a: Answers): Class => {
	// After © (a narrow emoji), only Extend and ZWJ join.
	if (cp > 0xff && a.afterPict > 0) return a.between === 2 ? "zwj" : "extend";
	// What joins after c: code points in the first cell past c, and past P0 when c follows it.
	const extra = cp <= 0xff || a.width > 0 ? 0 : 1;
	const joins = (n: number) => n > extra;
	if (joins(a.beforeOther)) return "prepend";
	if (joins(a.beforeModifier)) return "base";
	if (a.beforeZwj > extra + 1) return "pict";
	if (joins(a.beforeRi)) return "ri";
	if (joins(a.beforeL)) return "L";
	if (joins(a.beforeV) && joins(a.beforeT)) return a.afterLV > 0 ? "V" : "LV";
	if (joins(a.beforeT)) return a.afterL > 0 ? "LVT" : "T";
	if (a.afterBase > 0) return "modifier";
	return "other";
};

/** A code point's facts, from its answers. */
export const factsFrom = (cp: number, a: Answers): Facts => {
	if (isControl(cp)) return {width: 1, class: "other", vs: false};
	return {width: a.width, class: classOf(cp, a), vs: a.width > 0 && a.vs !== a.width};
};

/** Every code point's answers: NAMES.length numbers each, in NAMES's order. */
export interface Probed {
	readonly answers: Int8Array;
}

/** One code point's answers. */
export const answersOf = (probed: Probed, cp: number): Answers => {
	const at = cp * NAMES.length;
	const a = probed.answers;
	return {
		width: a[at] ?? 0,
		vs: a[at + 1] ?? 0,
		afterPict: a[at + 2] ?? 0,
		afterL: a[at + 3] ?? 0,
		afterLV: a[at + 4] ?? 0,
		afterLVT: a[at + 5] ?? 0,
		afterRi: a[at + 6] ?? 0,
		afterZwj: a[at + 7] ?? 0,
		afterBase: a[at + 8] ?? 0,
		between: a[at + 9] ?? 0,
		beforeOther: a[at + 10] ?? 0,
		beforeV: a[at + 11] ?? 0,
		beforeT: a[at + 12] ?? 0,
		beforeL: a[at + 13] ?? 0,
		beforeRi: a[at + 14] ?? 0,
		beforeModifier: a[at + 15] ?? 0,
		beforeZwj: a[at + 16] ?? 0,
	};
};

/** The probing terminal: rows wide enough for any probe (six cells at most), and many of them. */
const COLS = 8;
const ROWS = 500;

// ghostty-web 0.4.0 runs out of room for graphemes after a few hundred such writes to one
// terminal, the screen cleared between them: a write then fails with "memory access out of
// bounds" (seen 2026-10-25). So a new terminal every 100 writes, and a new WebAssembly memory
// every 20 terminals.
const WRITES_PER_TERMINAL = 100;
const TERMINALS_PER_MEMORY = 20;

type Cells = ReturnType<GhosttyTerminal["getViewport"]>;

const answerOn = (cells: Cells, y: number, x: boolean): number => {
	if (!x) return cells[y * COLS]?.grapheme_len ?? 0;
	for (let i = COLS - 1; i >= 0; i -= 1) if (cells[y * COLS + i]?.codepoint === 0x78) return i;
	return -1;
};

/**
 * Write probes, one a row from the top, on a terminal that is new often enough to stay clear of
 * ghostty-web's memory bugs, and read the cells back. A spare row under them shows a probe that
 * took two rows, which would put every answer after it on the wrong row.
 */
const probingTerminal = (fresh: () => Ghostty) => {
	let ghostty = fresh();
	let t = ghostty.createTerminal(COLS, ROWS + 1);
	let writes = 0;
	let terminals = 0;
	return (texts: readonly string[]): Cells => {
		if (writes === WRITES_PER_TERMINAL) {
			terminals += 1;
			if (terminals === TERMINALS_PER_MEMORY) {
				ghostty = fresh();
				terminals = 0;
			}
			t = ghostty.createTerminal(COLS, ROWS + 1);
			writes = 0;
		}
		writes += 1;
		t.write(`\x1b[H\x1b[2J${texts.join("\r\n")}`);
		if (t.getCursor().y !== texts.length - 1) throw new Error("a probe took more than one row");
		// The cells come from the render state, which getCursor made fresh.
		return t.getViewport();
	};
};

/** Ask ghostty-web every probe of every code point, U+0000 to U+10FFFF. `fresh` makes a new wasm memory. */
export const probeAll = (fresh: () => Ghostty): Probed => {
	const write = probingTerminal(fresh);
	const answers = new Int8Array(0x110000 * NAMES.length);
	let texts: string[] = [];
	let slots: number[] = [];
	let xs: boolean[] = [];
	const flush = () => {
		const cells = write(texts);
		for (let y = 0; y < texts.length; y += 1)
			answers[slots[y] ?? 0] = answerOn(cells, y, xs[y] ?? false);
		texts = [];
		slots = [];
		xs = [];
	};
	const ask = (cp: number, n: number, width: number) => {
		const name = NAMES[n] ?? "width";
		if (isControl(cp) || !asks(name, cp)) return;
		texts.push(textOf(name, cp, width));
		slots.push(cp * NAMES.length + n);
		xs.push(readsX(name));
		if (texts.length === ROWS) flush();
	};
	// Widths first: where a probe puts a code point of width 0 depends on it.
	for (let cp = 0x100; cp < 0x110000; cp += 1) ask(cp, 0, 1);
	if (texts.length > 0) flush();
	for (let cp = 0; cp <= 0xff; cp += 1) answers[cp * NAMES.length] = 1;
	for (let cp = 0; cp < 0x110000; cp += 1) {
		const width = answers[cp * NAMES.length] ?? 1;
		for (let n = 1; n < NAMES.length; n += 1) ask(cp, n, width);
	}
	if (texts.length > 0) flush();
	return {answers};
};

/** Every code point's facts, packed as the table holds them. */
export const packedFrom = (probed: Probed): Uint8Array => {
	const packed = new Uint8Array(0x110000);
	for (let cp = 0; cp < 0x110000; cp += 1) packed[cp] = pack(factsFrom(cp, answersOf(probed, cp)));
	return packed;
};

/** What the layout of cells.ts answers to the probes of `cp`, on rows as wide as the probing terminal's. */
export const modelAnswersOf = (cp: number, width: number): Answers => {
	const answer = (name: Name): number => {
		if (isControl(cp) || !asks(name, cp)) return name === "width" ? 1 : 0;
		const row: Cell[] = [];
		const pen: Pen = {row, x: 0, pending: false};
		for (const c of textOf(name, cp, width)) print(pen, c.codePointAt(0) ?? 0, COLS, () => []);
		if (readsX(name)) return row.findLastIndex((cell) => cell.cps[0] === 0x78);
		return Math.max(0, (row[0]?.cps.length ?? 0) - 1);
	};
	return {
		width: answer("width"),
		vs: answer("vs"),
		afterPict: answer("afterPict"),
		afterL: answer("afterL"),
		afterLV: answer("afterLV"),
		afterLVT: answer("afterLVT"),
		afterRi: answer("afterRi"),
		afterZwj: answer("afterZwj"),
		afterBase: answer("afterBase"),
		between: answer("between"),
		beforeOther: answer("beforeOther"),
		beforeV: answer("beforeV"),
		beforeT: answer("beforeT"),
		beforeL: answer("beforeL"),
		beforeRi: answer("beforeRi"),
		beforeModifier: answer("beforeModifier"),
		beforeZwj: answer("beforeZwj"),
	};
};
