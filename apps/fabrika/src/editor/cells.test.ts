import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import fc from "fast-check";
import {Ghostty, type GhosttyTerminal} from "ghostty-web";
import {beforeAll, describe, expect, it} from "vitest";
import {
	type Answers,
	answersOf,
	modelAnswersOf,
	type Probed,
	packedFrom,
	probeAll,
} from "./cells.probe.ts";
import {TABLE} from "./cells.table.ts";
import {BLANK, type Cell, cells, factsOf, type Pen, pack, print, spot, tableOf} from "./cells.ts";

// The layout of cells.ts against ghostty-web's wasm, the terminal the app draws with:
//
//   the table    asked of the wasm again, code point by code point, it is the same
//   the facts    code points with the same facts answer every probe alike (cells.probe.ts), and
//                the layout answers them as the wasm does
//   the layout   on random texts of hard characters, at widths from 1 to 10, the cells and the
//                cursor are the wasm's
//
// The wasm file is read with node:fs: a test's thin edge, where Effect's FileSystem buys nothing.

let fresh: () => Ghostty;

beforeAll(async () => {
	const wasm = readFileSync(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));
	const compiled = await WebAssembly.compile(wasm);
	fresh = () => new Ghostty(new WebAssembly.Instance(compiled, {env: {log: () => {}}}));
});

describe("the layout, by hand", () => {
	it("gives a wide character two cells, an accent none, and an emoji with U+FE0F two", () => {
		expect(spot("tsh$ 漢字", 80)).toBe(9);
		expect(spot("tsh$ é", 80)).toBe(6);
		expect(spot("tsh$ ©", 80)).toBe(6);
		expect(spot("tsh$ ©️", 80)).toBe(7);
		expect(cells("👍🏽")).toBe(2);
		expect(cells("🇹🇷")).toBe(2);
		expect(cells("👨‍👩‍👧")).toBe(2);
	});

	it("counts a full row's waiting wrap as the next row's first cell", () => {
		expect(spot("tsh$ abc", 8)).toBe(8);
		expect(spot("tsh$ ab", 8)).toBe(7);
	});

	it("puts a wide character that does not fit the last cell on the next row", () => {
		expect(spot("tsh$ ab漢", 8)).toBe(10);
	});
});

describe("the table and the facts", () => {
	let probed: Probed;

	beforeAll(() => {
		probed = probeAll(fresh);
	});

	it("is what ghostty-web's wasm answers, code point by code point", () => {
		expect(tableOf(packedFrom(probed))).toBe(TABLE.replace(/\s/g, ""));
	});

	/** What the layout knows of a code point: its facts, and whether `print` takes it apart. */
	const groupOf = (cp: number): string => {
		const apart =
			cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)
				? "control"
				: cp <= 0xff
					? "latin1"
					: cp === 0xfe0e || cp === 0xfe0f
						? String(cp)
						: cp >= 0xd800 && cp <= 0xdfff
							? "surrogate"
							: "";
		return `${pack(factsOf(cp))} ${apart}`;
	};

	it("answers every probe alike for code points of one group, and as the layout does", () => {
		const first = new Map<string, number>();
		const unlike: string[] = [];
		const same = (a: Answers, b: Answers) => JSON.stringify(a) === JSON.stringify(b);
		for (let cp = 0; cp < 0x110000; cp += 1) {
			const group = groupOf(cp);
			const one = first.get(group);
			if (one === undefined) first.set(group, cp);
			else if (unlike.length < 5 && !same(answersOf(probed, one), answersOf(probed, cp)))
				unlike.push(`U+${cp.toString(16)} is not like U+${one.toString(16)}`);
		}
		expect(unlike).toEqual([]);
		const wrong = [...first.values()].flatMap((cp) => {
			const wasm = answersOf(probed, cp);
			const model = modelAnswersOf(cp, wasm.width);
			return same(wasm, model)
				? []
				: [`U+${cp.toString(16)}: ${JSON.stringify(model)}, the wasm: ${JSON.stringify(wasm)}`];
		});
		expect(wrong).toEqual([]);
	});
});

describe("the layout on random texts", () => {
	/** A cell as ghostty-web gives it: its first code point, its width, and how many joined it. */
	type Seen = readonly [codepoint: number, width: number, joined: number];
	const WIDTH = {narrow: 1, wide: 2, tail: 0, head: 0} as const;
	const HEIGHT = 40;

	const seenOf = (c: Cell): Seen => [c.cps[0] ?? 0, WIDTH[c.wide], Math.max(0, c.cps.length - 1)];

	/** The rows and the cursor cells.ts gives `text`, as ghostty-web reports them. */
	const laidOut = (text: string, cols: number) => {
		const rows: Cell[][] = [[]];
		const pen: Pen = {row: rows[0] ?? [], x: 0, pending: false};
		const next = () => {
			const row: Cell[] = [];
			rows.push(row);
			return row;
		};
		for (const c of text) print(pen, c.codePointAt(0) ?? 0, cols, next);
		const all = Array.from({length: HEIGHT}, (_, y) =>
			Array.from({length: cols}, (_, x) => seenOf(rows[y]?.[x] ?? BLANK)),
		);
		return {rows: all, cursor: {x: pen.x, y: rows.length - 1}};
	};

	// A new terminal for each text, never freed, and a new wasm memory every 200 (see
	// editor.laws.test.ts for why).
	let memory: {readonly ghostty: Ghostty; made: number} | null = null;
	const terminal = (cols: number): GhosttyTerminal => {
		if (memory === null || memory.made >= 200) memory = {ghostty: fresh(), made: 0};
		memory.made += 1;
		return memory.ghostty.createTerminal(cols, HEIGHT);
	};

	const onGhostty = (text: string, cols: number) => {
		const t = terminal(cols);
		t.write(text);
		const rows = Array.from({length: HEIGHT}, (_, y) =>
			(t.getLine(y) ?? []).map((c): Seen => [c.codepoint, c.width, c.grapheme_len]),
		);
		const {x, y} = t.getCursor();
		return {rows, cursor: {x, y}};
	};

	/** Characters where Ghostty's rules meet: emoji and their parts, Hangul, flags, marks, a lone surrogate. */
	const HARD = [
		"a",
		" ",
		"#",
		"©",
		"☝",
		"😀",
		"🏽",
		"‍",
		"️",
		"︎",
		"́",
		"ᄀ",
		"ᅡ",
		"ᆨ",
		"가",
		"각",
		"🇹",
		"🇷",
		"؀",
		"ः",
		"漢",
		"​",
		"\ud800",
	];

	it("gives the cells and the cursor ghostty-web gives", () => {
		fc.assert(
			fc.property(
				fc.string({unit: fc.constantFrom(...HARD), minLength: 1, maxLength: 24}),
				fc.integer({min: 1, max: 10}),
				(text, cols) => {
					expect(laidOut(text, cols)).toEqual(onGhostty(text, cols));
				},
			),
			{seed: 22, numRuns: 1000},
		);
	});
});
