import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

// Today's app takes the built-in `fabrika` and `fabrika-light` themes (docs/direction/themes.md,
// decided 2026-11-01; tracker ticket 144): Radix 3.0.0, gray slate, accent indigo. Every value
// below is a Radix step, read from experiments/177-themes/schemes/radix-colors-3.0.0.json, and
// named beside it; the one that is not a step is the dark desk, the note's one bend.
//
// The window's stylesheets are read, not drawn, as type-scale.test.ts reads them. A token's value
// in a look is found as the browser finds it: follow var() to the token it names, and take
// light-dark()'s first color in the light look and its second in the dark one. That is how
// theme.css's own comment says light is set. Contrast is WCAG 2.2's ratio, computed from the
// values, with an alpha color drawn over its background first, as rules.py does.

const WINDOW = join(import.meta.dirname, "window");
const CSS = readFileSync(join(WINDOW, "window.css"), "utf8");
const THEME = readFileSync(join(WINDOW, "theme.css"), "utf8");
const TERMINAL = readFileSync(join(WINDOW, "terminal.ts"), "utf8");
const MAIN = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");

type Look = "dark" | "light";
const LOOKS: readonly Look[] = ["dark", "light"];

// ---- the note's values -------------------------------------------------------------------------

/** The note's `[colors]` for `fabrika`, as written there. */
const DARK = {
	desk: "#0c0d0e", // not a step: nothing in slate is darker than 1
	ground: "#111113", // slate 1
	raised: "#18191b", // slate 2
	hover: "#ddeaf814", // slate a3
	edge: "#d3edf81d", // slate a4
	focus: "#d9edff5d", // slate a8
	text: "#edeef0", // slate 12
	faint: "#f1f7feb5", // slate a11
	turn: "#3e63dd", // indigo 9
	"on-turn": "#ffffff", // Radix's rule for text on step 9
	"turn-text": "#9eb1ff", // indigo 11
	done: "#71d083", // grass 11
	running: "#ffca16", // amber 11
	stuck: "#ff9592", // red 11
	closed: "#f1f7feb5", // slate a11: no hue, the word says closed
};

/** `fabrika-light`: the same pick, look light, with amber 12 for running and slate a9 for focus. */
const LIGHT = {
	desk: "#f9f9fb", // slate 2
	ground: "#fcfcfd", // slate 1
	raised: "#fcfcfd", // slate 1
	hover: "#0000330f", // slate a3
	edge: "#00002d17", // slate a4
	focus: "#00051d74", // slate a9: a8 reads 1.90
	text: "#1c2024", // slate 12
	faint: "#0007149f", // slate a11
	turn: "#3e63dd", // indigo 9
	"on-turn": "#ffffff",
	"turn-text": "#3a5bc7", // indigo 11
	done: "#2a7e3b", // grass 11
	running: "#4f3422", // amber 12: amber 11 reads 4.38
	stuck: "#ce2c31", // red 11
	closed: "#0007149f", // slate a11
};

/** The note's `[terminal]`, both looks. The palette is in ANSI order, 0 to 15. */
const TERMINALS = {
	dark: {
		foreground: "#edeef0", // slate 12
		background: "#111113", // slate 1
		cursor: "#edeef0", // slate 12
		selection: "#d9edfe25", // slate a5
		// slate 3; red, grass, amber, blue 9, purple 11, cyan 9; slate 12, slate 11; the six at 11; slate 12
		palette: [
			"#212225",
			"#e5484d",
			"#46a758",
			"#ffc53d",
			"#0090ff",
			"#d19dff",
			"#00a2c7",
			"#edeef0",
			"#b0b4ba",
			"#ff9592",
			"#71d083",
			"#ffca16",
			"#70b8ff",
			"#d19dff",
			"#4ccce6",
			"#edeef0",
		],
	},
	light: {
		foreground: "#1c2024", // slate 12
		background: "#fcfcfd", // slate 1
		cursor: "#1c2024", // slate 12
		selection: "#0009321f", // slate a5
		// slate 12; red, grass 11, amber 12, blue, purple, cyan 11; slate 8, slate 11;
		// red, grass 11, amber 12, blue 11, purple 9, cyan 11; slate 7
		palette: [
			"#1c2024",
			"#ce2c31",
			"#2a7e3b",
			"#4f3422",
			"#0d74ce",
			"#8145b5",
			"#107d98",
			"#b9bbc6",
			"#60646c",
			"#ce2c31",
			"#2a7e3b",
			"#4f3422",
			"#0d74ce",
			"#8e4ec6",
			"#107d98",
			"#cdced6",
		],
	},
} as const;

/** Palette colors the built-ins mean as fills, not text: black in dark, the two whites in light. */
const FILLS: Record<Look, ReadonlySet<number>> = {dark: new Set([0]), light: new Set([7, 15])};

/**
 * Each token the window names, and its value in each look. A token the note names takes the
 * note's color; a raw step the note does not name takes the step Radix gives that job (ticket
 * 144's table). Tokens with no clear step yet (--text-secondary, --text-muted, --person-bg,
 * --agent-bg, --ty-*, --svc-*) are the owner's pick, so they are not pinned here; the text ones
 * still meet the contrast law below.
 */
const TOKENS: Record<string, Record<Look, string>> = {
	"--surface-sunken": {dark: DARK.desk, light: LIGHT.desk},
	"--surface": {dark: DARK.ground, light: LIGHT.ground},
	"--surface-raised": {dark: DARK.raised, light: LIGHT.raised},
	"--surface-hover": {dark: DARK.hover, light: LIGHT.hover},
	"--surface-selected": {dark: "#d9edfe25", light: "#0009321f"}, // slate a5: selected
	"--border-faint": {dark: DARK.edge, light: LIGHT.edge},
	"--border": {dark: "#d6ebfd30", light: "#00002f26"}, // slate a6: subtle border
	"--border-strong": {dark: "#d9edff40", light: "#00062e32"}, // slate a7: UI border
	"--wire": {dark: "#d9edff5d", light: "#00083046"}, // slate a8: strong border
	"--tile-focus": {dark: DARK.focus, light: LIGHT.focus},
	"--focus": {dark: "#dfebfd6d", light: "#00051d74"}, // slate a9: a8 is under 3:1 on the desk
	"--text-primary": {dark: DARK.text, light: LIGHT.text},
	"--text-faint": {dark: DARK.faint, light: LIGHT.faint},
	"--turn": {dark: DARK["turn-text"], light: LIGHT["turn-text"]},
	"--turn-fill": {dark: DARK.turn, light: LIGHT.turn},
	"--turn-fill-hover": {dark: "#5472e4", light: "#3358d4"}, // indigo 10: hovered solid
	"--turn-fg": {dark: DARK["on-turn"], light: LIGHT["on-turn"]},
	"--done": {dark: DARK.done, light: LIGHT.done},
	"--running": {dark: DARK.running, light: LIGHT.running},
	"--stuck": {dark: DARK.stuck, light: LIGHT.stuck},
	"--closed": {dark: DARK.closed, light: LIGHT.closed},
	// The names the counter's and tracker's windows use follow what they point at.
	"--ground": {dark: DARK.ground, light: LIGHT.ground},
	"--raised": {dark: DARK.raised, light: LIGHT.raised},
	"--hover": {dark: DARK.hover, light: LIGHT.hover},
	"--line": {dark: "#d6ebfd30", light: "#00002f26"},
	"--pick": {dark: "#d9edfe25", light: "#0009321f"},
	"--row-hi": {dark: DARK.hover, light: LIGHT.hover},
	"--row-on": {dark: "#d9edfe25", light: "#0009321f"},
	"--pop-bg": {dark: DARK.raised, light: LIGHT.raised},
	"--pop-edge": {dark: "#d6ebfd30", light: "#00002f26"},
	"--key": {dark: DARK.turn, light: LIGHT.turn},
	"--open": {dark: DARK.done, light: LIGHT.done},
	"--alert": {dark: DARK.stuck, light: LIGHT.stuck},
	"--faint": {dark: DARK.faint, light: LIGHT.faint},
	// Manti's selection was the raw --a-5; it takes slate a5, the terminal's selection.
	"--manti-selection-bg": {dark: TERMINALS.dark.selection, light: TERMINALS.light.selection},
};

// ---- reading the stylesheets -------------------------------------------------------------------

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Each innermost rule of a stylesheet: its selector and its declarations. */
const rulesOf = (css: string) =>
	[...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
		selector: selector.trim().replace(/\s+/g, " "),
		says: new Map(
			body
				.split(";")
				.map((d) => {
					const at = d.indexOf(":");
					return [
						d.slice(0, at).trim(),
						d
							.slice(at + 1)
							.trim()
							.replace(/\s+/g, " "),
					] as const;
				})
				.filter(([name]) => name !== ""),
		),
	}));

/** The page's :root, window.css then theme.css, as the page loads them. */
const ROOT = new Map(
	[...rulesOf(CSS), ...rulesOf(THEME)]
		.filter((r) => r.selector === ":root")
		.flatMap((r) => [...r.says]),
);

/** A value's parts split at its top-level commas: `light-dark(a, b)` gives a and b. */
const argsOf = (inner: string) => {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < inner.length; i += 1) {
		if (inner[i] === "(") depth += 1;
		if (inner[i] === ")") depth -= 1;
		if (inner[i] === "," && depth === 0) {
			parts.push(inner.slice(from, i).trim());
			from = i + 1;
		}
	}
	parts.push(inner.slice(from).trim());
	return parts;
};

/** `#abc` and `#ABCDEF80` as the note writes them: lowercase, two digits a channel. */
const hexOf = (value: string) => {
	const digits = value.slice(1).toLowerCase();
	return digits.length === 3 || digits.length === 4
		? `#${[...digits].map((d) => d + d).join("")}`
		: `#${digits}`;
};

/** A value in a look: var() followed, light-dark() picked. Anything else comes back as written. */
const valueIn = (value: string, look: Look, seen: readonly string[] = []): string => {
	const v = value.trim();
	const named = /^var\((--[\w-]+)\)$/.exec(v);
	if (named?.[1] !== undefined) return tokenIn(named[1], look, seen);
	const pair = /^light-dark\((.*)\)$/.exec(v);
	if (pair?.[1] !== undefined) {
		const [light = "", dark = ""] = argsOf(pair[1]);
		return valueIn(look === "light" ? light : dark, look, seen);
	}
	if (/^#[0-9a-f]{3,8}$/i.test(v)) return hexOf(v);
	return v;
};

const tokenIn = (name: string, look: Look, seen: readonly string[] = []): string => {
	if (seen.includes(name)) throw new Error(`var() loop: ${[...seen, name].join(" -> ")}`);
	const value = ROOT.get(name);
	if (value === undefined) return `(no ${name} in :root)`;
	return valueIn(value, look, [...seen, name]);
};

// ---- WCAG contrast -----------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

/** An oklch() color, as today's ramps are written, in sRGB (Björn Ottosson's OKLab matrices). */
const fromOklch = (value: string): Rgba | undefined => {
	const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
	if (m === null) return undefined;
	const L = Number(m[1]) / (m[2] === "%" ? 100 : 1);
	const C = Number(m[3]);
	const H = (Number(m[4]) * Math.PI) / 180;
	const a = C * Math.cos(H);
	const b = C * Math.sin(H);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const gamma = (x: number) => {
		const c = Math.min(1, Math.max(0, x));
		return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
	};
	return [
		gamma(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
		gamma(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
		gamma(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
		1,
	];
};

const rgbaOf = (value: string): Rgba => {
	if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
		const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
		return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
	}
	const lch = fromOklch(value);
	if (lch !== undefined) return lch;
	throw new Error(`not a color this test computes: ${value}`);
};

/** An alpha color drawn over a solid one, rounded to 8 bits a channel, as the page draws it. */
const over = (top: string, bottom: string): Rgba => {
	const [r, g, b, a] = rgbaOf(top);
	const [R, G, B] = rgbaOf(bottom);
	const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
	return [mix(r, R), mix(g, G), mix(b, B), 1];
};

const luminance = ([r, g, b]: Rgba) => {
	const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const hexFrom = ([r, g, b]: Rgba) =>
	`#${[r, g, b]
		.map((c) =>
			Math.round(c * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/** WCAG 2.2's contrast ratio of a color drawn on a background (which may itself be drawn over one). */
const ratio = (fg: string, bg: string, under?: string) => {
	const ground = under === undefined ? rgbaOf(bg) : over(bg, under);
	const ink = over(fg, hexFrom(ground));
	const [hi, lo] = [luminance(ink), luminance(ground)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Each pair under its bar, as `fg on bg 2.95 < 3`. Empty when every pair reads. */
const under = (pairs: readonly (readonly [string, string, string, number])[]) =>
	pairs.flatMap(([name, fg, bg, bar]) => {
		const r = ratio(fg, bg);
		return r < bar ? [`${name} ${r.toFixed(2)} < ${bar}`] : [];
	});

// ---- the window's stylesheets ------------------------------------------------------------------

describe("the window's colors are fabrika's, in both looks", () => {
	it.each(LOOKS)("every named token takes its Radix value, %s", (look) => {
		const got = Object.fromEntries(Object.keys(TOKENS).map((name) => [name, tokenIn(name, look)]));
		const want = Object.fromEntries(Object.entries(TOKENS).map(([name, v]) => [name, v[look]]));
		expect(got).toEqual(want);
	});

	it("follows the system's look, so the light values can show", () => {
		expect(ROOT.get("color-scheme")).toBe("light dark");
	});

	it("keeps no hand-made ramp: no --n-* or --a-* step, defined or used", () => {
		const ramps = (css: string) => [...uncommented(css).matchAll(/--[na]-\d+\b/g)].map(([m]) => m);
		expect({window: ramps(CSS), theme: ramps(THEME)}).toEqual({window: [], theme: []});
	});

	// A gray is an oklch() color with next to no chroma; today's ramp has 0.001 to 0.004, and
	// --turn-fg 0. The hues left (--ty-*, --svc-*, --line-*) are 0.06 and up, and wait on the owner.
	it("keeps no oklch() gray", () => {
		const grays = (css: string) =>
			[...uncommented(css).matchAll(/oklch\(\s*[\d.]+%?\s+([\d.]+)\s+[\d.]+\s*\)/g)]
				.filter(([, chroma]) => Number(chroma) < 0.02)
				.map(([m]) => m);
		expect({window: grays(CSS), theme: grays(THEME)}).toEqual({window: [], theme: []});
	});

	it("draws the two dashed outlines (the map's not-built marks) in --wire", () => {
		const map = rulesOf(CSS).filter((r) => r.selector.startsWith(".map-view"));
		const dashed = map.flatMap((r) =>
			[...r.says]
				.filter(([name, value]) => name === "outline" && value.includes("dashed"))
				.map(([, value]) => `${r.selector} { outline: ${value} }`),
		);
		expect(dashed).toEqual([
			".map-view .legend .nbl { outline: 1px dashed var(--wire) }",
			".map-view .spot.nb { outline: 1px dashed var(--wire) }",
		]);
	});
});

// WCAG 2.2: 4.5:1 for text (1.4.3), 3:1 for a line or a part a person must see (1.4.11). Every
// text token is held to 4.5:1, large or not. The backgrounds are the note's: text on the desk,
// the ground and raised; the turn fill and the tile's focus line on the ground; on-turn on the
// fill, and on the fill as it hovers. The keyboard ring sits anywhere, a hovered row included.
describe("every text and line reads on what it sits on, in both looks", () => {
	const TEXT = [
		"--text-primary",
		"--text-secondary",
		"--text-muted",
		"--text-faint",
		"--turn",
		"--done",
		"--running",
		"--stuck",
		"--closed",
	];
	const PAGES = ["--surface-sunken", "--surface", "--surface-raised"];

	it.each(LOOKS)(
		"text and state words read 4.5:1 on the desk, the ground and raised, %s",
		(look) => {
			const pairs = TEXT.flatMap((fg) =>
				PAGES.map((bg) => [`${fg} on ${bg}`, tokenIn(fg, look), tokenIn(bg, look), 4.5] as const),
			);
			expect(under(pairs)).toEqual([]);
		},
	);

	// The note checks text on three backgrounds. The window draws more than that: rows hover and
	// are selected, in a tile (the ground) and in what opens over the desk (raised), and some lines'
	// tokens (--wire, --border-strong) and the turn fill (--key) are used as text. So every token a
	// stylesheet sets as `color:` is held to 4.5:1 on each of those. --turn-fg sits only on the turn
	// fill, so it has its own test below.
	const USED_AS_TEXT = [
		...new Set(
			[...uncommented(CSS + THEME).matchAll(/(?<![\w-])color:\s*var\((--[\w-]+)\)/g)].map(
				([, name = ""]) => name,
			),
		),
	]
		.filter((name) => name !== "--turn-fg")
		.sort();

	it("finds the tokens the window uses as text, lines and the turn fill among them", () => {
		expect(USED_AS_TEXT).toEqual(expect.arrayContaining(["--wire", "--border-strong", "--key"]));
	});

	it.each(LOOKS)(
		"every token used as text reads 4.5:1 on the desk, ground and raised, %s",
		(look) => {
			const pairs = USED_AS_TEXT.flatMap((fg) =>
				PAGES.map((bg) => [`${fg} on ${bg}`, tokenIn(fg, look), tokenIn(bg, look), 4.5] as const),
			);
			expect(under(pairs)).toEqual([]);
		},
	);

	it.each(LOOKS)(
		"every token used as text reads 4.5:1 on hovered and selected rows, %s",
		(look) => {
			const rows = ["--surface-hover", "--surface-selected"].flatMap((row) =>
				["--surface", "--surface-raised"].map(
					(page) =>
						[
							`${row} over ${page}`,
							hexFrom(over(tokenIn(row, look), tokenIn(page, look))),
						] as const,
				),
			);
			const pairs = USED_AS_TEXT.flatMap((fg) =>
				rows.map(([where, bg]) => [`${fg} on ${where}`, tokenIn(fg, look), bg, 4.5] as const),
			);
			expect(under(pairs)).toEqual([]);
		},
	);

	it("on-turn reads 4.5:1 on the turn fill, at rest in both looks and hovered in light", () => {
		expect(
			under([
				...LOOKS.map(
					(look) =>
						[
							`--turn-fg on --turn-fill, ${look}`,
							tokenIn("--turn-fg", look),
							tokenIn("--turn-fill", look),
							4.5,
						] as const,
				),
				[
					"--turn-fg on --turn-fill-hover, light",
					tokenIn("--turn-fg", "light"),
					tokenIn("--turn-fill-hover", "light"),
					4.5,
				],
			]),
		).toEqual([]);
	});

	// Known exception, decided 2026-11-01: the hovered fill keeps Radix's indigo 10, and white on
	// it reads 4.28 in dark, under 4.5:1 (tracker ticket 153). Any change to the pair shows here.
	it("on-turn on the hovered turn fill, dark, is indigo 10 at exactly 4.28:1", () => {
		const fill = tokenIn("--turn-fill-hover", "dark");
		expect(fill).toBe("#5472e4");
		expect(ratio(tokenIn("--turn-fg", "dark"), fill).toFixed(2)).toBe("4.28");
	});

	it.each(LOOKS)("the focus lines and the turn fill read 3:1, %s", (look) => {
		const ground = tokenIn("--surface", look);
		const ring = tokenIn("--focus", look);
		const hovered = (page: string) =>
			hexFrom(over(tokenIn("--surface-hover", look), tokenIn(page, look)));
		expect(
			under([
				["--tile-focus on --surface", tokenIn("--tile-focus", look), ground, 3],
				["--turn-fill on --surface", tokenIn("--turn-fill", look), ground, 3],
				...PAGES.map((bg) => [`--focus on ${bg}`, ring, tokenIn(bg, look), 3] as const),
				["--focus on a hovered row", ring, hovered("--surface"), 3],
				["--focus on a hovered row on the desk", ring, hovered("--surface-sunken"), 3],
				[
					"--focus on a selected row",
					ring,
					hexFrom(over(tokenIn("--surface-selected", look), ground)),
					3,
				],
			]),
		).toEqual([]);
	});
});

// ---- one set of values for the window, the terminal and the window's frame ---------------------

describe("the themes module holds the note's values", () => {
	it("fabrika is the note's dark pick", async () => {
		const {fabrika} = await import("./themes.ts");
		expect({name: fabrika.name, look: fabrika.look}).toEqual({name: "fabrika", look: "dark"});
		expect(fabrika.colors).toEqual(DARK);
		expect(fabrika.terminal).toEqual(TERMINALS.dark);
	});

	it("fabrika-light is the same pick, look light", async () => {
		const {fabrikaLight} = await import("./themes.ts");
		expect({name: fabrikaLight.name, look: fabrikaLight.look}).toEqual({
			name: "fabrika-light",
			look: "light",
		});
		expect(fabrikaLight.colors).toEqual(LIGHT);
		expect(fabrikaLight.terminal).toEqual(TERMINALS.light);
	});

	it("gives the terminal its colors by ghostty-web's names, palette in ANSI order", async () => {
		const {fabrika, fabrikaLight, terminalTheme} = await import("./themes.ts");
		const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
		const named = (t: (typeof TERMINALS)[Look]) => ({
			foreground: t.foreground,
			background: t.background,
			cursor: t.cursor,
			...Object.fromEntries(names.map((n, i) => [n, t.palette[i]])),
			...Object.fromEntries(
				names.map((n, i) => [`bright${n[0]?.toUpperCase()}${n.slice(1)}`, t.palette[i + 8]]),
			),
		});
		expect(terminalTheme(fabrika)).toMatchObject(named(TERMINALS.dark));
		expect(terminalTheme(fabrikaLight)).toMatchObject(named(TERMINALS.light));
	});

	it.each(LOOKS)("the terminal reads: text 4.5:1, cursor 3:1, fills aside, %s", async (look) => {
		const {fabrika, fabrikaLight} = await import("./themes.ts");
		const t = (look === "dark" ? fabrika : fabrikaLight).terminal;
		expect(
			under([
				["foreground", t.foreground, t.background, 4.5],
				["cursor", t.cursor, t.background, 3],
				...t.palette.flatMap((c, i) =>
					FILLS[look].has(i) ? [] : [[`palette ${i}`, c, t.background, 4.5] as const],
				),
			]),
		).toEqual([]);
	});
});

/** A color written straight into code: `#` and 3, 4, 6 or 8 hex digits, comments gone. */
const literalsIn = (ts: string) =>
	[
		...ts
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "")
			.matchAll(/["'`]#[0-9a-f]{3,8}["'`]/gi),
	].map(([m]) => m);

describe("the terminal and the window's frame take their colors from the themes module", () => {
	it("terminal.ts writes no color of its own and reads the themes module", () => {
		expect(literalsIn(TERMINAL)).toEqual([]);
		expect(TERMINAL).toMatch(/from "\.\.\/themes\.ts"/);
	});

	it("main.ts writes no color of its own and reads the themes module", () => {
		expect(literalsIn(MAIN)).toEqual([]);
		expect(MAIN).toMatch(/from "\.\/themes\.ts"/);
	});
});
