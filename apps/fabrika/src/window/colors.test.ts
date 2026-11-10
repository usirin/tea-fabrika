import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {Palette} from "./pop.tsx";

// Today's app's colors, read against the design package (docs/direction/fabrika-design-package.md,
// decided 2026-11-02; P31). The package holds the built-in themes, the tokens and the Manti mapping,
// and holds its own laws (packages/fabrika-design/src/themes.test.ts). These are the app's: its old
// copies are gone, it reads the package by name, and its own rules (window.css, and the reset kept
// to Manti's parts, manti-reset.css) still read on the package's tokens. Laws A1 to A3 of the P31
// plan, and the palette's dim (the owner, 2026-11-06).
//
// The stylesheets are read, not drawn, in the order the page loads them: the package's tokens.css,
// then manti-reset.css, then window.css. A token's value in a look is found as the browser finds
// it: follow var() to the token it names, and take light-dark()'s first color in the light look and
// its second in the dark one. Contrast is WCAG 2.2's ratio, with an alpha color drawn over its
// background first, rounded to 8 bits a channel, as rules.py does.

const SRC = join(import.meta.dirname, "..");

/** The package's stylesheet, found by its name as the build finds it, never by a path. */
const TOKENS = readFileSync(
	fileURLToPath(import.meta.resolve("@kampus/fabrika-design/tokens.css")),
	"utf8",
);

const RESET = readFileSync(join(import.meta.dirname, "manti-reset.css"), "utf8");
const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8");
const TERMINAL = readFileSync(join(import.meta.dirname, "terminal.ts"), "utf8");
const MAIN = readFileSync(join(SRC, "main.ts"), "utf8");
const BUILD = readFileSync(join(SRC, "..", "build.ts"), "utf8");

type Look = "dark" | "light";
const LOOKS: readonly Look[] = ["dark", "light"];

/** The look's two text steps (color principles, decided 2026-11-02). */
const SLATE: Record<Look, {high: string; low: readonly string[]}> = {
	dark: {high: "#edeef0", low: ["#b0b4ba", "#f1f7feb5"]}, // slate 12; slate 11, slate a11
	light: {high: "#1c2024", low: ["#60646c", "#0007149f"]}, // slate 12; slate 11, slate a11
};

/**
 * The names the app keeps for its own rules, beside the package's (flag 5): each is another name
 * for a package token, so it follows that token's value.
 */
const FAINT = {dark: "#f1f7feb5", light: "#0007149f"}; // slate a11

const ALIASES: Record<string, Record<Look, string>> = {
	"--text-secondary": FAINT,
	"--text-muted": FAINT,
	"--faint": FAINT,
	"--ground": {dark: "#111113", light: "#fcfcfd"}, // slate 1
	"--raised": {dark: "#18191b", light: "#fcfcfd"}, // slate 2; slate 1
	"--pop-bg": {dark: "#18191b", light: "#fcfcfd"},
	"--hover": {dark: "#ddeaf814", light: "#0000330f"}, // slate a3
	"--row-hi": {dark: "#ddeaf814", light: "#0000330f"},
	"--pick": {dark: "#d9edfe25", light: "#0009321f"}, // slate a5
	"--row-on": {dark: "#d9edfe25", light: "#0009321f"},
	"--line": {dark: "#d6ebfd30", light: "#00002f26"}, // slate a6
	"--pop-edge": {dark: "#d6ebfd30", light: "#00002f26"},
	"--key": {dark: "#3e63dd", light: "#3e63dd"}, // indigo 9
	"--open": {dark: "#71d083", light: "#203c25"}, // grass 11; grass 12
	"--alert": {dark: "#ff9592", light: "#641723"}, // red 11; red 12
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

/** Every rule the page draws with, in the order it loads them. */
const PAGE = [...rulesOf(TOKENS), ...rulesOf(RESET), ...rulesOf(CSS)];
/** The page's :root: tokens.css, then window.css's, as the page loads them. */
const ROOT = new Map(PAGE.filter((r) => r.selector === ":root").flatMap((r) => [...r.says]));
/** The app's own rules. */
const RULES = rulesOf(CSS);

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
	const mix = /^color-mix\(\s*in oklab\s*,(.*)\)$/.exec(v);
	if (mix?.[1] !== undefined) return mixIn(v, mix[1], look, seen);
	if (/^#[0-9a-f]{3,8}$/i.test(v)) return hexOf(v);
	return v;
};

/**
 * `color-mix(in oklab, a p%, b)` as CSS Color 5 mixes two solid colors: the percents filled in
 * and scaled to 100, then a straight mix in OKLab. A mix with alpha (such as `transparent`) is
 * premultiplied in CSS and not read here: it comes back as written, so a test that needs it fails.
 */
const mixIn = (v: string, inner: string, look: Look, seen: readonly string[]): string => {
	const parts = argsOf(inner).map((part) => {
		const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(part);
		const color = valueIn(m?.[1] ?? "", look, seen);
		const solid = /^#[0-9a-f]{6}$|^oklch\(/.test(color);
		return {lab: solid ? toOklab(rgbaOf(color)) : undefined, at: m?.[2]};
	});
	const [a, b] = parts;
	if (parts.length !== 2 || a?.lab === undefined || b?.lab === undefined) return v;
	const pa = a.at === undefined ? (b.at === undefined ? 50 : 100 - Number(b.at)) : Number(a.at);
	const pb = b.at === undefined ? 100 - pa : Number(b.at);
	const t = pa / (pa + pb);
	const [al, aa, ab] = a.lab;
	const [bl, ba, bb] = b.lab;
	return hexFrom(fromOklab(al * t + bl * (1 - t), aa * t + ba * (1 - t), ab * t + bb * (1 - t)));
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
	const C = Number(m[3]);
	const H = (Number(m[4]) * Math.PI) / 180;
	return fromOklab(Number(m[1]) / (m[2] === "%" ? 100 : 1), C * Math.cos(H), C * Math.sin(H));
};

/** An OKLab color in sRGB, clamped to the gamut. */
const fromOklab = (L: number, a: number, b: number): Rgba => {
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

/** An sRGB channel, gamma taken off. */
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const luminance = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** An sRGB color in OKLab, the inverse of fromOklab (Björn Ottosson's matrices). */
const toOklab = ([r, g, b]: Rgba): readonly [number, number, number] => {
	const [R, G, B] = [lin(r), lin(g), lin(b)];
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};

const hexFrom = ([r, g, b]: Rgba) =>
	`#${[r, g, b]
		.map((c) =>
			Math.round(c * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/** WCAG 2.2's contrast ratio of a color drawn on a solid background. */
const ratio = (fg: string, bg: string) => {
	const ground = rgbaOf(bg);
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

/** Code with its comments gone: `/* *\/` blocks, and `//` to the line's end but not in a URL. */
const codeOf = (code: string) =>
	code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---- A1: no second copy ------------------------------------------------------------------------

describe("A1: the app keeps no second copy of the design", () => {
	it("has no themes.ts and no theme.css of its own", () => {
		expect({
			themes: existsSync(join(SRC, "themes.ts")),
			theme: existsSync(join(import.meta.dirname, "theme.css")),
		}).toEqual({themes: false, theme: false});
	});

	it("window.css's :root defines none of the names tokens.css defines", () => {
		const ours = new Set(
			rulesOf(TOKENS)
				.filter((r) => r.selector === ":root")
				.flatMap((r) => [...r.says.keys()]),
		);
		const again = rulesOf(CSS)
			.filter((r) => r.selector === ":root")
			.flatMap((r) => [...r.says.keys()])
			.filter((name) => ours.has(name));
		expect(again).toEqual([]);
	});

	it("manti-reset.css sets no token: it is the reset kept to Manti's parts, and only that", () => {
		const tokens = rulesOf(RESET).flatMap((r) =>
			[...r.says.keys()].filter((name) => name.startsWith("--")),
		);
		expect(tokens).toEqual([]);
	});
});

// ---- A2: the app reads the package -------------------------------------------------------------

/** A color written straight into code: `#` and 3, 4, 6 or 8 hex digits, comments gone. */
const literalsIn = (ts: string) =>
	[...codeOf(ts).matchAll(/["'`]#[0-9a-f]{3,8}["'`]/gi)].map(([m]) => m);

describe("A2: the terminal, the window's frame and the build read the package", () => {
	it("terminal.ts writes no color of its own and reads @kampus/fabrika-design", () => {
		expect(literalsIn(TERMINAL)).toEqual([]);
		expect(TERMINAL).toMatch(/from "@kampus\/fabrika-design"/);
	});

	it("main.ts writes no color of its own and reads @kampus/fabrika-design", () => {
		expect(literalsIn(MAIN)).toEqual([]);
		expect(MAIN).toMatch(/from "@kampus\/fabrika-design"/);
	});

	// main.ts is Electron's entry and starts the app when it loads, so no test imports it. This reads
	// the desk window's maker instead: the frame follows the look only if it hands its window to
	// followLook (the package's themes.frame.test.ts holds what followLook does).
	it("main.ts hands the desk window to followLook, so its frame follows the look", () => {
		const maker = /const deskWindow = [\s\S]*?\n};/.exec(codeOf(MAIN))?.[0] ?? "";
		expect(maker).toMatch(/\bfollowLook\(\s*nativeTheme\s*,\s*window\s*\)/);
	});

	// The page's one stylesheet, dist/window.css, is written from a template of what build.ts read.
	// Each part is followed to the file it names (through one const, as MANTI_CSS is), and the
	// package's tokens come before the reset and the app's rules, so the app's rules win.
	it("build.ts writes Manti's, React Flow's, the package's tokens, the reset, then window.css", () => {
		const code = codeOf(BUILD);
		const fileOf = (id: string) => {
			const read = new RegExp(`const ${id}\\s*=\\s*yield\\*\\s*([^;]*);`).exec(code)?.[1] ?? "";
			const named = /"([^"]+)"/.exec(read)?.[1];
			if (named !== undefined) return named;
			const constant = /\(([A-Z_]+)\)/.exec(read)?.[1] ?? "";
			return (
				new RegExp(`const ${constant}\\s*=\\s*"([^"]+)"`).exec(code)?.[1] ?? `(${id}: ${read})`
			);
		};
		const template = /at\("dist\/window\.css"\),\s*`([^`]*)`/.exec(code)?.[1] ?? "";
		expect([...template.matchAll(/\$\{(\w+)\}/g)].map(([, id = ""]) => fileOf(id))).toEqual([
			"@manti-ui/styles/index.css",
			"@xyflow/react/dist/base.css",
			"@kampus/fabrika-design/tokens.css",
			"src/window/manti-reset.css",
			"src/window/window.css",
		]);
	});
});

// ---- A3: the app's rules still read ------------------------------------------------------------

describe("A3: the app's colors are the package's, in both looks", () => {
	it.each(LOOKS)("each name the app keeps follows the package token it names, %s", (look) => {
		const got = Object.fromEntries(Object.keys(ALIASES).map((name) => [name, tokenIn(name, look)]));
		const want = Object.fromEntries(Object.entries(ALIASES).map(([name, v]) => [name, v[look]]));
		expect(got).toEqual(want);
	});

	it("keeps no hand-made ramp: no --n-* or --a-* step, defined or used", () => {
		const ramps = (css: string) => [...uncommented(css).matchAll(/--[na]-\d+\b/g)].map(([m]) => m);
		expect({window: ramps(CSS), reset: ramps(RESET)}).toEqual({window: [], reset: []});
	});

	// A gray is an oklch() color with next to no chroma. The hues left (--ty-*, --svc-*) are 0.06
	// and up, and wait on their own ticket.
	it("keeps no oklch() gray", () => {
		const grays = (css: string) =>
			[...uncommented(css).matchAll(/oklch\(\s*[\d.]+%?\s+([\d.]+)\s+[\d.]+\s*\)/g)]
				.filter(([, chroma]) => Number(chroma) < 0.02)
				.map(([m]) => m);
		expect({window: grays(CSS), reset: grays(RESET)}).toEqual({window: [], reset: []});
	});

	it("draws the two dashed outlines (the map's not-built marks) in --wire", () => {
		const map = RULES.filter((r) => r.selector.startsWith(".map-view"));
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

// WCAG 2.2: 4.5:1 for text (1.4.3). The package holds its own tokens to it; these hold every token
// the page sets as `color:` on the pages and rows it may sit on, and each rule's own text on the
// background it sets.
describe("A3: every text the app draws reads on what it sits on, in both looks", () => {
	const PAGES = ["--surface-sunken", "--surface", "--surface-raised"];

	const USED_AS_TEXT = [
		...new Set(
			[...uncommented(TOKENS + RESET + CSS).matchAll(/(?<![\w-])color:\s*var\((--[\w-]+)\)/g)].map(
				([, name = ""]) => name,
			),
		),
	]
		.filter((name) => name !== "--turn-fg")
		.sort();

	// Color principles rule 5: each value is a Radix step, used for that step's job. A line's step
	// (a4 to a8) and the turn fill (9, 10) are not text steps, so no line or fill is a `color:`.
	// Approved 2026-11-01: wire and border-strong text takes --text-faint (slate a11), key text the
	// turn's text token, --turn-text since `turn` split (design language call 4, 2026-11-07).
	const LINES_AND_FILLS = [
		"--border-faint",
		"--border",
		"--border-strong",
		"--wire",
		"--line",
		"--pop-edge",
		"--focus",
		"--turn-fill",
		"--turn-fill-hover",
		"--key",
	];

	it("finds the tokens the window uses as text, and no line or fill token among them", () => {
		expect(USED_AS_TEXT).toEqual(
			expect.arrayContaining(["--text-primary", "--text-faint", "--turn-text"]),
		);
		expect(USED_AS_TEXT.filter((name) => LINES_AND_FILLS.includes(name))).toEqual([]);
	});

	it.each(LOOKS)(
		"the names the app keeps for text read 4.5:1 on the desk, ground and raised, %s",
		(look) => {
			const pairs = ["--text-secondary", "--text-muted"].flatMap((fg) =>
				PAGES.map((bg) => [`${fg} on ${bg}`, tokenIn(fg, look), tokenIn(bg, look), 4.5] as const),
			);
			expect(under(pairs)).toEqual([]);
		},
	);

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

	// A rule that sets its own background, such as a button on the indigo fill, draws its text on
	// that instead, so each rule that sets both a `color` and a one-color `background` is held to
	// 4.5:1 on its own background. A background with alpha is drawn over the ground and over raised.
	const PAINTS = PAGE.flatMap((r) => {
		const fg = r.says.get("color");
		const bg = r.says.get("background-color") ?? r.says.get("background");
		return fg === undefined || bg === undefined ? [] : [{selector: r.selector, fg, bg}];
	});
	const COLOR = /^(#[0-9a-f]{6}([0-9a-f]{2})?|oklch\([^()]*\))$/;
	// A background that draws no fill: the text sits on whatever is under it, which the page and row
	// checks above hold it to.
	const NO_FILL = new Set(["transparent", "none"]);

	it("finds the rules that set their own text and background, the turn fill's button among them", () => {
		expect(PAINTS.map((p) => p.selector)).toContain(".tracker button.tracker-primary");
	});

	it("reads color-mix in oklab as CSS does: white and black half and half is OKLab's middle gray", () => {
		expect(valueIn("color-mix(in oklab, #ffffff 50%, #000000)", "dark")).toBe("#636363");
		expect(valueIn("color-mix(in oklab, #000000, #ffffff 50%)", "dark")).toBe("#636363");
	});

	// A color this test cannot read would be skipped by the check below, so it fails here instead.
	it.each(LOOKS)("every rule's own text and background are colors this test reads, %s", (look) => {
		const unread = PAINTS.flatMap(({selector, fg, bg}) => {
			const ink = valueIn(fg, look);
			const fill = valueIn(bg, look);
			if (NO_FILL.has(fill)) return [];
			return [
				...(COLOR.test(ink) ? [] : [`${selector}: color ${fg} reads as ${ink}`]),
				...(COLOR.test(fill) ? [] : [`${selector}: background ${bg} reads as ${fill}`]),
			];
		});
		expect(unread).toEqual([]);
	});

	it.each(LOOKS)("a rule's text reads 4.5:1 on the background it sets, %s", (look) => {
		const pairs = PAINTS.flatMap(({selector, fg, bg}) => {
			const ink = valueIn(fg, look);
			const fill = valueIn(bg, look);
			if (!COLOR.test(ink) || !COLOR.test(fill)) return [];
			return ["--surface", "--surface-raised"].map(
				(page) =>
					[
						`${selector}: ${fg} on ${bg} over ${page}`,
						ink,
						hexFrom(over(fill, tokenIn(page, look))),
						4.5,
					] as const,
			);
		});
		expect(under(pairs)).toEqual([]);
	});
});

// The owner's ruling of 2026-11-02: text uses Radix's two text steps only. Step 12 is the main line
// (titles, names), step 11 or a11 (where the look needs it to pass) is everything quieter. Rank
// comes from weight and size, never a third gray, and a title is always step 12.
describe("A3: text takes Radix's two text steps, and a title is step 12, in both looks", () => {
	// The tokens with a hue: state words and the turn. Every other token set as `color:` is a gray.
	const HUES = ["--turn-text", "--done", "--running", "--stuck", "--open", "--alert"];
	const GRAYS = [
		...new Set([
			"--text-primary",
			"--text-secondary",
			"--text-muted",
			"--text-faint",
			...[...uncommented(TOKENS + RESET + CSS).matchAll(/(?<![\w-])color:\s*var\((--[\w-]+)\)/g)]
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
	// second cue (pop.test.ts), so color is never alone.
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
	// SegmentedControl draws the pressed segment at 12.
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
	// rule through --ink went quiet with it. Each rule names the text token it means.
	it("window.css names no --ink, so each rule names its own text token", () => {
		const uses = [...uncommented(CSS).matchAll(/--ink(?![\w-])/g)].length;
		expect({uses}).toEqual({uses: 0});
	});

	// Two text steps only: an opacity under 1 on a box of text draws a third gray. A part may still
	// fade when it is out of reach (WCAG 1.4.3 does not hold an inactive part to contrast), when it
	// holds no text, or in an animation. Each such rule is named here with its reason.
	const FADES: Record<string, string> = {
		".tracker button:disabled": "a disabled button: an inactive part",
		".desk.lost .workspace": "the link is down: the desk is out of reach till it is back",
		".desk.lost .topbar .right > .fb": "the link is down: the top bar's asks are out of reach",
		".trace-view .wf-span": "a trace bar's fill, aria-hidden, no text",
	};

	it("no rule dims text with an opacity under 1, past the named fades", () => {
		const keyframe = /^(from|to|[\d.]+%)$/;
		const dims = RULES.filter(
			(r) => !keyframe.test(r.selector) && !Object.hasOwn(FADES, r.selector),
		).flatMap((r) => {
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

// Color principles rule 2: a color means one thing, and the accent says your turn. The accent is
// the turn fill (indigo 9), its hover (indigo 10), and every token that is only another name for
// one of them, such as --key. Each rule that draws with one is listed here with the turn it marks.
describe("A3: the accent fill says your turn and nothing else", () => {
	/** The turn fill, its hover, and every :root name that points at one of them, however far. */
	const ACCENT = (() => {
		const names = new Set(["--turn-fill", "--turn-fill-hover"]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const [name, value] of ROOT) {
				const to = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
				if (to !== undefined && names.has(to) && !names.has(name)) {
					names.add(name);
					grew = true;
				}
			}
		}
		return names;
	})();

	const TURNS: Record<string, string> = {
		".tracker-fact-asked": "an ask put to the owner, in a ticket's history",
		".tracker-fact-answered": "the owner's answer to that ask: the turn, taken",
		".tracker-ask": "an open ask's box: it waits on the owner",
		".view .btn.turn": "the button that takes your turn",
		".view .btn.turn:hover": "the same button, hovered",
		".view .m.p.you": "your turn on a person's mark",
		".ticket-view .turnc.you": "the turn card when the turn is yours",
		".ticket-view .meter i.you": "your share of the turn meter",
		".map-view .spot.you": "the map's spot that waits on you",
		".trace-view .tv-bar.waiting":
			"a lane's wait on a person, not yet answered: a bar that waits on you",
		".udot": "the top bar's dot for an ask you have not seen: it waits on you",
		".view .dot.you": "the map's ring on the spot that waits on you",
	};

	it("finds the accent's names, --key among them", () => {
		expect([...ACCENT].sort()).toEqual(
			expect.arrayContaining(["--key", "--manti-accent-fill", "--turn-fill", "--turn-fill-hover"]),
		);
	});

	// Accent uses outside a turn that were there when this law came in (2026-11-02). This list only
	// shrinks: a new accent use fails, and so does an entry whose rule is gone.
	const PENDING = "owner call pending";
	const KNOWN: Record<string, string> = {
		"button:hover { border-color }": `hover border: ${PENDING}`,
		".tracker button.tracker-primary { background }": `Radix solid primary, ${PENDING}`,
		'.tracker .tracker-hint button[aria-pressed="true"] { border-color }': `pressed hint border, ${PENDING}`,
	};

	/** Each accent use outside the turn rules, as `selector { property }`. */
	const OFF = PAGE.filter((r) => r.selector !== ":root")
		.flatMap((r) =>
			[...r.says]
				.filter(([, value]) =>
					[...value.matchAll(/var\((--[\w-]+)\)/g)].some(([, name = ""]) => ACCENT.has(name)),
				)
				.flatMap(([property]) =>
					r.selector
						.split(",")
						.map((s) => s.trim())
						.filter((s) => !Object.hasOwn(TURNS, s))
						.map((s) => `${s} { ${property} }`),
				),
		)
		.sort();

	it("no new rule draws with the accent fill outside your turn", () => {
		expect(OFF.filter((use) => !Object.hasOwn(KNOWN, use))).toEqual([]);
	});

	it("the known accent uses only shrink: each listed one is still in the stylesheets", () => {
		expect(Object.keys(KNOWN).filter((use) => !OFF.includes(use))).toEqual([]);
	});
});

// ---- one meaning per token (design language call 4, decided 2026-11-07) ------------------------

/** A stylesheet's `@media` blocks whose query matches, cut out, and their bodies, kept apart. */
const splitMedia = (css: string, query: RegExp) => {
	const inside: string[] = [];
	let outside = "";
	let from = 0;
	for (const m of css.matchAll(/@media([^{]*)\{/g)) {
		if (!query.test(m[1] ?? "") || (m.index ?? 0) < from) continue;
		let depth = 1;
		const open = (m.index ?? 0) + m[0].length;
		let i = open;
		while (i < css.length && depth > 0) {
			if (css[i] === "{") depth += 1;
			if (css[i] === "}") depth -= 1;
			i += 1;
		}
		outside += css.slice(from, m.index);
		inside.push(css.slice(open, i - 1));
		from = i;
	}
	return {inside: inside.join("\n"), outside: outside + css.slice(from)};
};

// Focus is one slate token everywhere: every keyboard ring and every focused edge draws in --focus,
// the top bar's and the tracker's included. A tile and a strip draw theirs in --tile-edge-on, the
// tile's own name for it (tile guidelines), which a pipe sets to its own color. A rule that draws
// no indicator (`outline: none` where something else shows focus) names no color, so it passes.
describe("every focus indicator draws in the one focus token", () => {
	const FORCED = /forced-colors:\s*active/;
	const app = uncommented(RESET + CSS);
	/** The properties that draw a ring or an edge. */
	const INDICATOR =
		/^(outline|outline-color|border|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color|border-(top|right|bottom|left|block|inline)(-(start|end))?|box-shadow)$/;
	const FOCUS = /:focus(-visible|-within)?(?![\w-])/;
	/** A value that draws nothing, so it names no color. Anything else must name the token. */
	const PLAIN = /^(none|0|auto|inherit|initial|unset|revert)$/;

	const focusRules = (css: string) =>
		rulesOf(css).filter((r) => r.selector.split(",").some((s) => FOCUS.test(s)));

	const drawn = (rules: ReturnType<typeof rulesOf>) =>
		rules.flatMap((r) =>
			[...r.says]
				.filter(([name, value]) => INDICATOR.test(name) && !PLAIN.test(value))
				.map(([name, value]) => ({selector: r.selector, name, value})),
		);

	it("finds the focus rules, the tracker's and the top bar's among them", () => {
		const selectors = focusRules(splitMedia(app, FORCED).outside).flatMap((r) =>
			r.selector.split(",").map((s) => s.trim()),
		);
		expect(selectors).toEqual(
			expect.arrayContaining([
				".fb:focus-visible",
				".strip:focus-visible",
				".tracker input:focus-visible",
				".tracker-find:focus-within",
				".tracker .tracker-composer textarea:focus",
				".tracker-list a.tracker-pull-request:focus-visible",
			]),
		);
	});

	it("draws each ring and focused edge in --focus, or --tile-edge-on on a tile or strip", () => {
		const off = drawn(focusRules(splitMedia(app, FORCED).outside)).filter(({selector, value}) => {
			const tile = selector.split(",").every((s) => /\.(tile|strip)(?![\w-])/.test(s));
			const token = tile ? "--tile-edge-on" : "--focus";
			return !new RegExp(`var\\(${token}\\)`).test(value);
		});
		expect(off.map(({selector, name, value}) => `${selector} { ${name}: ${value} }`)).toEqual([]);
	});

	// Forced colors drop the theme, and the page must draw in the system's colors there: focus is a
	// 2px Highlight, the one place a focus rule names no token. This holds it to that and only that.
	it("under forced colors, a focus rule draws in Highlight and names no token", () => {
		const forced = drawn(focusRules(splitMedia(app, FORCED).inside));
		expect(forced.length).toBeGreaterThan(0);
		expect(
			forced
				.filter(({value}) => !/\bHighlight\b/.test(value) || /var\(/.test(value))
				.map(({selector, name, value}) => `${selector} { ${name}: ${value} }`),
		).toEqual([]);
	});

	// T245 B: build.ts copies these declarations unchanged. This checks the replacement's
	// geometry only; e2e.ts's trackerFocus checks what wins the cascade and forced colors.
	it("a tracker row's replacement focus shadow spans all four sides at 2px", () => {
		const off = focusRules(splitMedia(app, FORCED).outside).filter((rule) => {
			if (!rule.selector.includes(".tracker-list") || !rule.says.has("box-shadow")) return false;
			if (/^(none|0)$/.test(rule.says.get("box-shadow") ?? "")) return false;
			const shadows = argsOf(rule.says.get("box-shadow") ?? "");
			return !shadows.some((shadow) => {
				const lengths = shadow
					.replace(/var\([^)]*\)/g, "")
					.match(/-?\d+(?:\.\d+)?(?:px)?\b/g)
					?.map(Number.parseFloat);
				return (
					lengths?.length === 4 &&
					lengths[0] === 0 &&
					lengths[1] === 0 &&
					lengths[2] === 0 &&
					lengths[3] === 2 &&
					shadow.includes("var(--focus)")
				);
			});
		});
		expect(off.map((rule) => rule.selector)).toEqual([]);
	});
});

// `turn` split in two (call 4): --turn-fill is the fill, --turn-text the turn's text. A token
// means one thing, so the text token is only ever a `color`, never a fill, a ring or an edge.
// The wider check, every text token by its TOML `type`, comes with the token build (PR 2).
describe("the turn's text token is only ever text", () => {
	/** --turn-text and every :root name that points at it, however far. */
	const TEXT = (() => {
		const names = new Set(["--turn-text"]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const [name, value] of ROOT) {
				const to = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
				if (to !== undefined && names.has(to) && !names.has(name)) {
					names.add(name);
					grew = true;
				}
			}
		}
		return names;
	})();

	const uses = PAGE.filter((r) => r.selector !== ":root").flatMap((r) =>
		[...r.says]
			.filter(([, value]) =>
				[...value.matchAll(/var\((--[\w-]+)\)/g)].some(([, name = ""]) => TEXT.has(name)),
			)
			.map(([property]) => `${r.selector} { ${property} }`),
	);

	it("finds --turn-text used as text", () => {
		expect(uses.filter((use) => use.endsWith("{ color }")).length).toBeGreaterThan(0);
	});

	it("names --turn-text in no property but color", () => {
		expect(uses.filter((use) => !use.endsWith("{ color }"))).toEqual([]);
	});
});

// ---- the palette has no dim (the owner, 2026-11-06) --------------------------------------------

// The Cmd-K palette opens over the desk with no dim behind it, as Linear's and Discord's do
// (measured from Linear's public video: its Cmd-K has no dim, its create-issue dialog dims to about
// 26% black). The desk stays inert under the palette (layers L4): a press outside it lands on a
// backdrop of the palette's own and closes it, never on a tile under it; the backdrop paints
// nothing. A real dialog keeps a dim, the package's --scrim, a Radix black alpha step.
describe("the palette opens with no dim behind it", () => {
	const html = renderToStaticMarkup(
		createElement(Palette, {
			id: "pop-palette",
			label: "Commands",
			chip: "t2 · ticket",
			query: "",
			sections: [],
			at: 0,
			count: "0 commands",
			onQuery: () => {},
			onMove: () => {},
			onRun: () => {},
			onClose: () => {},
		}),
	);
	/** What the palette draws before its dialog box: the classes of each element behind it. */
	const behind = (() => {
		const box = html.lastIndexOf("<", html.indexOf('role="dialog"'));
		return [...html.slice(0, Math.max(box, 0)).matchAll(/<(\w+)([^>]*)>/g)].map(
			([, , attrs = ""]) => ({
				classes: (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter((c) => c !== ""),
				hidden: /aria-hidden="true"/.test(attrs),
			}),
		);
	})();
	/** The app's rules whose last compound selector names one of these classes. */
	const rulesFor = (classes: readonly string[]) =>
		RULES.filter((r) =>
			r.selector.split(",").some((s) => {
				const last =
					s
						.trim()
						.split(/\s+|>|\+|~/)
						.pop() ?? "";
				return classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last));
			}),
		);

	// L4: today the backdrop is what keeps a press outside the palette off the desk.
	it("keeps a backdrop behind the palette that covers the window, so a press never reaches a tile", () => {
		const covers = behind.filter(
			(el) =>
				el.hidden &&
				rulesFor(el.classes).some(
					(r) =>
						/^(absolute|fixed)$/.test(r.says.get("position") ?? "") && r.says.get("inset") === "0",
				),
		);
		expect(covers.length).toBe(1);
	});

	it("paints nothing behind the palette: no background, shadow or blur", () => {
		const paint = behind.flatMap((el) =>
			rulesFor(el.classes).flatMap((r) =>
				[...r.says]
					.filter(
						([name, value]) =>
							((name === "background" || name === "background-color") &&
								!["transparent", "none"].includes(value)) ||
							name === "box-shadow" ||
							name === "backdrop-filter",
					)
					.map(([name, value]) => `${r.selector} { ${name}: ${value} }`),
			),
		);
		expect(paint).toEqual([]);
	});

	// The dim waits for a real dialog: a rule that paints it is named here with its dialog. None
	// does today, since the palette was its only user.
	const DIMS: Record<string, string> = {};

	it("no rule in the app paints the scrim or Manti's overlay but a named dialog's", () => {
		const dims = PAGE.filter((r) => r.selector !== ":root")
			.filter((r) => [...r.says.values()].some((v) => /var\(--(scrim|manti-overlay)\)/.test(v)))
			.map((r) => r.selector)
			.filter((selector) => !Object.hasOwn(DIMS, selector));
		expect(dims).toEqual([]);
	});
});
