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

/**
 * `fabrika-light`: the same pick, look light, with amber 12 for running and slate a9 for focus.
 * The owner approved three more on 2026-11-01 (the design review), so each state word reads 4.5:1
 * on a hovered and a selected row too: grass 12, red 12 and indigo a11.
 */
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
	"turn-text": "#002bb7c5", // indigo a11: indigo 11 reads 4.47 on a selected row
	done: "#203c25", // grass 12: grass 11 reads 4.34 on a hovered row
	running: "#4f3422", // amber 12: amber 11 reads 4.38
	stuck: "#641723", // red 12: red 11 reads 4.46 on a hovered row
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
 * still meet the contrast law and the two text steps below.
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
	// are selected, in a tile (the ground) and in what opens over the desk (raised). So every token a
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

	// Color principles rule 5: each value is a Radix step, used for that step's job. A line's step
	// (a4 to a8) and the turn fill (9, 10) are not text steps, so no line or fill is a `color:`.
	// Approved 2026-11-01: wire and border-strong text takes --text-faint (slate a11), key text --turn.
	const LINES_AND_FILLS = [
		"--border-faint",
		"--border",
		"--border-strong",
		"--wire",
		"--line",
		"--pop-edge",
		"--tile-focus",
		"--focus",
		"--turn-fill",
		"--turn-fill-hover",
		"--key",
	];

	it("finds the tokens the window uses as text, and no line or fill token among them", () => {
		expect(USED_AS_TEXT).toEqual(
			expect.arrayContaining(["--text-primary", "--text-faint", "--turn"]),
		);
		expect(USED_AS_TEXT.filter((name) => LINES_AND_FILLS.includes(name))).toEqual([]);
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

// The owner's ruling of 2026-11-02: text uses Radix's two text steps only. Step 12 is the main line
// (titles, names), step 11 or a11 (where the look needs it to pass) is everything quieter. Rank
// comes from weight and size, never a third gray, and a title is always step 12.
describe("text takes Radix's two text steps, and a title is step 12, in both looks", () => {
	const SLATE: Record<Look, {high: string; low: readonly string[]}> = {
		dark: {high: "#edeef0", low: ["#b0b4ba", "#f1f7feb5"]}, // slate 12; slate 11, slate a11
		light: {high: "#1c2024", low: ["#60646c", "#0007149f"]}, // slate 12; slate 11, slate a11
	};

	// The tokens with a hue: state words and the turn. Every other token set as `color:` is a gray.
	const HUES = ["--turn", "--done", "--running", "--stuck", "--open", "--alert"];
	const GRAYS = [
		...new Set([
			"--text-primary",
			"--text-secondary",
			"--text-muted",
			"--text-faint",
			...[...uncommented(CSS + THEME).matchAll(/(?<![\w-])color:\s*var\((--[\w-]+)\)/g)]
				.map(([, name = ""]) => name)
				.filter((name) => name !== "--turn-fg" && !HUES.includes(name)),
		]),
	].sort();

	it.each(LOOKS)("every gray text token is slate 12 or the look's one low step, %s", (look) => {
		const values = GRAYS.map((name) => [name, tokenIn(name, look)] as const);
		const steps = new Set(values.map(([, value]) => value));
		expect({
			offSteps: values
				.filter(([, value]) => value !== SLATE[look].high && !SLATE[look].low.includes(value))
				.map(([name, value]) => `${name} ${value}`),
			high: steps.has(SLATE[look].high),
			low: [...steps].filter((value) => value !== SLATE[look].high).sort(),
		}).toEqual({offSteps: [], high: true, low: [expect.any(String)]});
	});

	const RULES = rulesOf(CSS);

	/**
	 * The color an element is drawn in: the first selector in its chain (its own rules, then each
	 * parent's) whose rule sets `color`, the last such rule winning, as the cascade does.
	 */
	const colorOf = (chain: readonly string[], look: Look) => {
		for (const selector of chain) {
			const sets = RULES.filter(
				(r) => r.selector.split(",").some((s) => s.trim() === selector) && r.says.has("color"),
			);
			const last = sets[sets.length - 1];
			if (last !== undefined) return valueIn(last.says.get("color") ?? "", look);
		}
		return `(no color for ${chain.join(" in ")})`;
	};

	// Each main line the window draws, with the selectors its color comes from (found in window.css,
	// the app's window components and programs/*/src/window.tsx).
	const TITLES: Record<string, readonly string[]> = {
		"a tracker ticket row's title": [".tracker-title", ".tracker .tracker-list button"],
		"a tracker pull request row's title": [
			".tracker-title",
			".tracker-list a.tracker-pull-request",
		],
		"an asks or jobs row's title": [".pop-row .t"],
		"a palette command's name": [".pop-cmd .name", ".pop-cmd"],
		"a selected palette command's name": [".pop-cmd.on .name", ".pop-cmd .name", ".pop-cmd.on"],
		"a pop's title": [".pop-title"],
		"a trace row's name": [".trace-view .wf-name"],
		"the ticket's title": [".ticket-view .tk-title"],
		"a tracker ticket page's title": [".tracker h2", ".tracker"],
		"a map node's name": [".map-view .node-h .n"],
		"a map frame's name": [".map-view .frame-h .n"],
		"a map chip's name": [".map-view .chip .n"],
		"a runs track's name": [".runs-view .trk-h .n"],
		"a markdown heading": [".markdown h1"],
	};

	it.each(LOOKS)("every title and main line is slate 12, %s", (look) => {
		const got = Object.fromEntries(
			Object.entries(TITLES).map(([what, chain]) => [what, colorOf(chain, look)]),
		);
		const want = Object.fromEntries(Object.keys(TITLES).map((what) => [what, SLATE[look].high]));
		expect(got).toEqual(want);
	});

	// Color principles' step table: 11 is a name at rest, 12 a name when focused. A row set aside
	// ("later") is a state, not a rank, so its title stays at the low step; its dashed ring is the
	// second cue (pop.test.ts), so color is never alone. The tile's title bar, 11 unfocused and 12
	// focused, is the same rule and is not a main line here; it has its own test below.
	it.each(LOOKS)("a set-aside row's title stays at the low step, %s", (look) => {
		expect(SLATE[look].low).toContain(
			colorOf(['.pop-row[data-icon="later"] .t', ".pop-row .t"], look),
		);
	});

	// The same table's name row, on a tile: the title bar's name is step 11 at rest and step 12 when
	// its tile is focused, so the focused tile reads apart from the others by more than its edge.
	it.each(LOOKS)(
		"a tile's title bar is the low step at rest and slate 12 when focused, %s",
		(look) => {
			const rest = colorOf([".titlebar"], look);
			expect({
				restIsLow: SLATE[look].low.includes(rest),
				focused: colorOf([".tile.focused .titlebar", ".titlebar"], look),
			}).toEqual({restIsLow: true, focused: SLATE[look].high});
		},
	);

	// Radix's TextField draws typed text at step 12 and its placeholder at the low step, and its
	// SegmentedControl draws the pressed segment at 12. A control's own text, typed or pressed, is
	// what a person reads, so it is step 12, and typed text never looks like the placeholder.
	const CONTROLS: Record<string, readonly string[]> = {
		"text typed in the tracker's find": [".tracker .tracker-find input", ".tracker-find"],
		"text typed in the composer's line": [".tracker .tracker-composer input"],
		"text typed in the composer's box": [".tracker .tracker-composer textarea"],
		"a pressed tracker segment": [
			'.tracker .tracker-shows button[aria-pressed="true"]',
			".tracker .tracker-shows button",
		],
		"a pressed hint button": [
			'.tracker .tracker-hint button[aria-pressed="true"]',
			".tracker .tracker-hint button",
		],
	};

	it.each(LOOKS)("typed text and a pressed segment are slate 12, %s", (look) => {
		const got = Object.fromEntries(
			Object.entries(CONTROLS).map(([what, chain]) => [what, colorOf(chain, look)]),
		);
		const want = Object.fromEntries(Object.keys(CONTROLS).map((what) => [what, SLATE[look].high]));
		expect(got).toEqual(want);
	});

	it.each(LOOKS)("typed text is not drawn in the placeholder's color, %s", (look) => {
		const placeholder = colorOf([".tracker input::placeholder"], look);
		const typed = [
			colorOf(CONTROLS["text typed in the tracker's find"] ?? [], look),
			colorOf(CONTROLS["text typed in the composer's line"] ?? [], look),
			colorOf(CONTROLS["text typed in the composer's box"] ?? [], look),
		];
		expect({placeholderIsLow: SLATE[look].low.includes(placeholder)}).toEqual({
			placeholderIsLow: true,
		});
		expect(typed.filter((color) => color === placeholder)).toEqual([]);
	});

	// --ink was an old name that pointed at --text-secondary, so when that became the low step every
	// rule through --ink went quiet with it, titles and typed text included. Each rule names the
	// text token it means.
	it("window.css names no --ink, so each rule names its own text token", () => {
		const uses = [...uncommented(CSS).matchAll(/--ink(?![\w-])/g)].length;
		expect({uses}).toEqual({uses: 0});
	});

	// Two text steps only: an opacity under 1 on a box of text draws a third gray. A part may still
	// fade when it is out of reach (WCAG 1.4.3 does not hold an inactive part to contrast), when it
	// holds no text, or in an animation. Each such rule is named here with its reason; any other
	// opacity between 0 and 1 is a third gray.
	const FADES: Record<string, string> = {
		".tracker button:disabled": "a disabled button: an inactive part",
		".desk.lost .workspace": "the link is down: the desk is out of reach till it is back",
		".desk.lost .topbar .right > .fb": "the link is down: the top bar's asks are out of reach",
		".runs-view .wait": "a waiting bar's striped fill, no text",
		".runs-view .wait.done": "a waiting bar's striped fill, no text",
		".trace-view .wf-span": "a trace bar's fill, aria-hidden, no text",
	};

	it("no rule dims text with an opacity under 1, past the named fades", () => {
		const keyframe = /^(from|to|[\d.]+%)$/;
		const dims = rulesOf(CSS)
			.filter((r) => !keyframe.test(r.selector) && !Object.hasOwn(FADES, r.selector))
			.flatMap((r) => {
				const value = Number(r.says.get("opacity"));
				return value > 0 && value < 1 ? [`${r.selector} { opacity: ${String(value)} }`] : [];
			});
		expect(dims).toEqual([]);
	});

	// A row: its title, and the quieter text beside it.
	const ROWS: Record<string, {title: readonly string[]; beside: readonly (readonly string[])[]}> = {
		"a tracker ticket row": {
			title: TITLES["a tracker ticket row's title"] ?? [],
			beside: [[".tracker-number"], [".tracker-sub"]],
		},
		"an asks or jobs row": {
			title: TITLES["an asks or jobs row's title"] ?? [],
			beside: [[".pop-row .s"], [".pop-row .side"]],
		},
		"a palette command": {
			title: TITLES["a palette command's name"] ?? [],
			beside: [[".pop-cmd .word"]],
		},
		"a trace row": {
			title: TITLES["a trace row's name"] ?? [],
			beside: [[".view .faint"]],
		},
	};

	it.each(LOOKS)(
		"a row's title reads at least as strong as the text beside it, at rest, hovered and selected, %s",
		(look) => {
			const states = ["--surface", "--surface-raised"].flatMap((page) => [
				[`rest on ${page}`, tokenIn(page, look)] as const,
				...["--surface-hover", "--surface-selected"].map(
					(row) =>
						[
							`${row} over ${page}`,
							hexFrom(over(tokenIn(row, look), tokenIn(page, look))),
						] as const,
				),
			]);
			const beaten = Object.entries(ROWS).flatMap(([row, {title, beside}]) =>
				states.flatMap(([state, bg]) => {
					const strong = ratio(colorOf(title, look), bg);
					return beside.flatMap((chain) => {
						const quiet = ratio(colorOf(chain, look), bg);
						return quiet > strong
							? [
									`${row}, ${state}: ${chain.join(" in ")} ${quiet.toFixed(2)} > title ${strong.toFixed(2)}`,
								]
							: [];
					});
				}),
			);
			expect(beaten).toEqual([]);
		},
	);
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

	// main.ts is Electron's entry and starts the app when it loads, so no test imports it. This reads
	// the desk window's maker instead: the frame follows the look only if it hands its window to
	// followLook (themes.frame.test.ts holds what followLook does). A seam main.ts calls would let a
	// test run it; until one exists, the call is pinned as written.
	it("main.ts hands the desk window to followLook, so its frame follows the look", () => {
		const code = MAIN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
		const maker = /const deskWindow = [\s\S]*?\n};/.exec(code)?.[0] ?? "";
		expect(maker).toMatch(/\bfollowLook\(\s*nativeTheme\s*,\s*window\s*\)/);
	});
});
