import {fabrika, fabrikaLight, type Theme} from "@kampus/fabrika-design";
import type {Shell} from "@kampus/fabrika-old";
import {describe, expect, it} from "vitest";
import {statusRow, table} from "./screen.ts";

it("cuts a long status to one row and keeps the text before the ellipsis", () => {
	expect(statusRow("reading a.txt and b.txt", 12)).toBe("\x1b[90mreading a.…\x1b[39m");
});

// The colors a table is printed in (tracker ticket 144). The line editor runs in the host, and its
// bytes go to every terminal on the desk, while a look is each viewer's own. So a table names its
// colors by the terminal's palette, 0 to 15, or not at all, and each viewer's terminal draws them
// in its own theme (docs/direction/themes.md, what a third-party program gets, point 6: tones or
// palette indexes, never 24-bit colors). A color the bytes fix for one look is near white on white
// in the other.
//
// The law: every tone printed reads 4.5:1 (WCAG 2.2, 1.4.3) on the terminal's background, in both
// built-ins, worked out from the SGR codes as the terminal draws them. Faint (SGR 2) is drawn at
// half alpha over the background, as ghostty-web 0.4's renderer does (`globalAlpha = 0.5`).

const TONES = ["strong", "muted", "faint", "accent", "warning", "plain"] as const;

/** A column headed by a tone's name. */
const column = (tone: (typeof TONES)[number]) => ({header: tone, align: "left" as const});

/** One row with a cell in each tone, so every tone the palette has is printed. */
const everyTone: Shell.Table = {
	title: "Experiments",
	note: "newest first",
	total: 1,
	// The first column written out, so the list is never empty, as a table's columns must not be.
	columns: [column("strong"), ...TONES.slice(1).map(column)],
	cut: 0,
	rows: [TONES.map((tone) => ({text: `${tone}-cell`, tone}))],
	hints: [{line: "experiments --all", for: "for every row"}],
};

type Fg =
	| {readonly _tag: "default"}
	| {readonly _tag: "index"; readonly n: number}
	| {readonly _tag: "rgb"; readonly hex: string};

interface Pen {
	readonly fg: Fg;
	readonly bold: boolean;
	readonly faint: boolean;
}

const PLAIN: Pen = {fg: {_tag: "default"}, bold: false, faint: false};

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** The pen after one SGR sequence's parameters. */
const penAfter = (pen: Pen, params: string): Pen => {
	const ps = params === "" ? [0] : params.split(";").map(Number);
	let next = pen;
	for (let i = 0; i < ps.length; i += 1) {
		const p = ps[i] ?? 0;
		if (p === 0) next = PLAIN;
		else if (p === 1) next = {...next, bold: true};
		else if (p === 2) next = {...next, faint: true};
		else if (p === 22) next = {...next, bold: false, faint: false};
		else if (p >= 30 && p <= 37) next = {...next, fg: {_tag: "index", n: p - 30}};
		else if (p >= 90 && p <= 97) next = {...next, fg: {_tag: "index", n: p - 90 + 8}};
		else if (p === 39) next = {...next, fg: {_tag: "default"}};
		else if (p === 38 && ps[i + 1] === 5) {
			next = {...next, fg: {_tag: "index", n: ps[i + 2] ?? 0}};
			i += 2;
		} else if (p === 38 && ps[i + 1] === 2) {
			const [r = 0, g = 0, b = 0] = ps.slice(i + 2, i + 5);
			next = {...next, fg: {_tag: "rgb", hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`}};
			i += 4;
		}
	}
	return next;
};

/**
 * Each run of visible text, the pen it was printed with, and whether a reset came right after.
 * Split on SGR sequences, the capture holds each one's parameters: text at even places, those at odd.
 */
const runsOf = (bytes: string) => {
	const runs: {text: string; pen: Pen; reset: boolean}[] = [];
	// oxlint-disable-next-line eslint/no-control-regex -- SGR escapes are what it reads.
	const parts = bytes.split(/\x1b\[([\d;]*)m/);
	let pen = PLAIN;
	parts.forEach((part, i) => {
		if (i % 2 === 1) pen = penAfter(pen, part);
		else if (part.trim() !== "") {
			const after = parts[i + 1];
			runs.push({text: part.trim(), pen, reset: after === "0" || after === ""});
		}
	});
	return runs;
};

const rgbOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

const luminance = (hex: string) => {
	const [r = 0, g = 0, b = 0] = rgbOf(hex).map((c) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a: string, b: string) => {
	const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/** A color at half alpha over a background, rounded to 8 bits, as a faint glyph is drawn. */
const halfOver = (fg: string, bg: string) => {
	const f = rgbOf(fg);
	const b = rgbOf(bg);
	return `#${f.map((c, i) => hex2(Math.round(((c + (b[i] ?? 0)) / 2) * 255))).join("")}`;
};

/** The color a pen draws in a theme's terminal. */
const drawn = (pen: Pen, theme: Theme) => {
	const t = theme.terminal;
	const fg =
		pen.fg._tag === "default"
			? t.foreground
			: pen.fg._tag === "index"
				? (t.palette[pen.fg.n] ?? "#000000")
				: pen.fg.hex;
	return pen.faint ? halfOver(fg, t.background) : fg;
};

const bytes = table(everyTone, 200);

describe("a table's colors come from the viewer's theme", () => {
	it("keeps its shape: each tone is started, its text, then a reset; plain is left as it is", () => {
		const runs = runsOf(bytes);
		const shape = (text: string) => {
			const run = runs.find((r) => r.text === text);
			return {colored: run !== undefined && run.pen !== PLAIN, reset: run?.reset};
		};
		expect(shape("Experiments")).toEqual({colored: true, reset: true});
		for (const tone of TONES.filter((t) => t !== "plain"))
			expect(shape(`${tone}-cell`)).toEqual({colored: true, reset: true});
		expect(shape("plain-cell").colored).toBe(false);
	});

	it("draws strong text bold", () => {
		expect(runsOf(bytes).find((r) => r.text === "Experiments")?.pen.bold).toBe(true);
	});

	it("names its colors by the terminal's palette, 0 to 15, never as 24-bit or 256-color", () => {
		const fixed = runsOf(bytes)
			.filter(({pen}) => pen.fg._tag === "rgb" || (pen.fg._tag === "index" && pen.fg.n > 15))
			.map(({text}) => text);
		expect(fixed).toEqual([]);
	});

	it.each([fabrika, fabrikaLight])("prints every tone at 4.5:1 or more, in $name", (theme) => {
		const bg = theme.terminal.background;
		const low = runsOf(bytes).flatMap(({text, pen}) => {
			const r = ratio(drawn(pen, theme), bg);
			return r < 4.5 ? [`${text} ${r.toFixed(2)}`] : [];
		});
		expect(low).toEqual([]);
	});
});
