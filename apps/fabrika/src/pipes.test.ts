import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {TINTS} from "./desk/layout/index.ts";
import {PIPES} from "./pipes.ts";

// A tile's colors, as the window draws them (docs/direction/tile-guidelines.md and pipe-colors.md,
// decided 2026-11-01). A plain tile is slate; a tile in a pipe takes one of six colors on its title
// bar's wash and on its focus edge, and keeps slate for its resting edge and its text. Every value
// is a Radix 3.0.0 alpha step, read from the scales the themes study saved
// (experiments/177-themes/schemes/radix-colors-3.0.0.json), in both looks.
//
// The stylesheets are read, not drawn, as colors.test.ts reads them: a token is followed through var(),
// light-dark() gives its first color in the light look and its second in the dark one, and a pipe's
// rule (`[data-pipe="sky"]`) wins over :root. Contrast is WCAG 2.2's ratio, with an alpha color
// drawn over what it sits on first, rounded to 8 bits a channel, as the page draws it.

const CSS = readFileSync(join(import.meta.dirname, "window", "window.css"), "utf8");

/** The design package's tokens, found by its name as the build finds them (P31). */
const TOKENS = readFileSync(
	fileURLToPath(import.meta.resolve("@kampus/fabrika-design/tokens.css")),
	"utf8",
);

const RADIX: unknown = JSON.parse(
	readFileSync(
		join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			"experiments",
			"177-themes",
			"schemes",
			"radix-colors-3.0.0.json",
		),
		"utf8",
	),
);

type Look = "dark" | "light";
const LOOKS: readonly Look[] = ["dark", "light"];
/** A pipe's color, or slate for a tile in no pipe. */
type Scope = "slate" | (typeof PIPES)[number];
const SCOPES: readonly Scope[] = ["slate", ...PIPES];

// ---- Radix's steps -----------------------------------------------------------------------------

/** One Radix scale in one look: twelve hex colors, step 1 first. */
const scaleOf = (color: string, kind: "solid" | "alpha", look: Look): readonly string[] => {
	const key = kind === "alpha" ? `${look}A` : look;
	const scales =
		typeof RADIX === "object" && RADIX !== null && "scales" in RADIX ? RADIX.scales : undefined;
	const scale =
		typeof scales === "object" && scales !== null && color in scales
			? Object.entries(scales).find(([name]) => name === color)?.[1]
			: undefined;
	const steps =
		typeof scale === "object" && scale !== null
			? Object.entries(scale).find(([name]) => name === key)?.[1]
			: undefined;

	if (!Array.isArray(steps) || steps.length !== 12) {
		throw new Error(`no ${color} ${key} in Radix`);
	}

	return steps.map((s) => String(s).toLowerCase());
};

/** Step `n` (1 to 12) of a color's alpha scale. */
const alpha = (color: string, n: number, look: Look) => scaleOf(color, "alpha", look)[n - 1];

// ---- reading the stylesheet --------------------------------------------------------------------

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet with every @media block taken out: what draws with no preference set. */
const outsideMedia = (css: string) => {
	let out = "";
	let at = 0;

	for (const m of css.matchAll(/@media[^{]*\{/g)) {
		if ((m.index ?? 0) < at) {
			continue;
		}

		out += css.slice(at, m.index);
		let depth = 1;
		let i = (m.index ?? 0) + m[0].length;

		while (i < css.length && depth > 0) {
			if (css[i] === "{") {
				depth += 1;
			}

			if (css[i] === "}") {
				depth -= 1;
			}

			i += 1;
		}

		at = i;
	}

	return out + css.slice(at);
};

/** The body of every @media block whose query matches. */
const insideMedia = (css: string, query: RegExp) => {
	const bodies: string[] = [];

	for (const m of css.matchAll(/@media([^{]*)\{/g)) {
		if (!query.test(m[1] ?? "")) {
			continue;
		}

		let depth = 1;
		const from = (m.index ?? 0) + m[0].length;
		let i = from;

		while (i < css.length && depth > 0) {
			if (css[i] === "{") {
				depth += 1;
			}

			if (css[i] === "}") {
				depth -= 1;
			}

			i += 1;
		}

		bodies.push(css.slice(from, i - 1));
	}

	return bodies.join("\n");
};

/** Each innermost rule: its selectors, split at commas, and its declarations. */
const rulesOf = (css: string) =>
	[...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
		selectors: selector.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
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

const BASE = rulesOf(outsideMedia(uncommented(CSS)));

/** The page's :root, the package's tokens.css then window.css, as the page loads them. */
const ROOT = new Map(
	[...rulesOf(outsideMedia(uncommented(TOKENS))), ...BASE]
		.filter((r) => r.selectors.includes(":root"))
		.flatMap((r) => [...r.says]),
);

/** Does this selector pick out one pipe's tiles: `[data-pipe="sky"]`, alone or on a class. */
const pipeIn = (selector: string) => /\[data-pipe=["']?([a-z]+)["']?\]/.exec(selector)?.[1];

/** The tokens one pipe's rules set, in the stylesheet's order. */
const pipeTokens = (pipe: string) =>
	new Map(
		BASE.filter((r) => r.selectors.some((s) => pipeIn(s) === pipe)).flatMap((r) =>
			[...r.says].filter(([name]) => name.startsWith("--")),
		),
	);

/** What a tile in this scope sees: its pipe's tokens over :root's. */
const tokensOf = (scope: Scope) =>
	scope === "slate" ? ROOT : new Map([...ROOT, ...pipeTokens(scope)]);

/** A value's parts split at its top-level commas: `light-dark(a, b)` gives a and b. */
const argsOf = (inner: string) => {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;

	for (let i = 0; i < inner.length; i += 1) {
		if (inner[i] === "(") {
			depth += 1;
		}

		if (inner[i] === ")") {
			depth -= 1;
		}

		if (inner[i] === "," && depth === 0) {
			parts.push(inner.slice(from, i).trim());
			from = i + 1;
		}
	}

	parts.push(inner.slice(from).trim());
	return parts;
};

/** `#abc` and `#ABCDEF80` as Radix writes them: lowercase, two digits a channel. */
const hexOf = (value: string) => {
	const digits = value.slice(1).toLowerCase();
	return digits.length === 3 || digits.length === 4
		? `#${[...digits].map((d) => d + d).join("")}`
		: `#${digits}`;
};

/** A token's value for a tile in `scope`, in `look`: var() followed, light-dark() picked. */
const tokenIn = (
	name: string,
	look: Look,
	scope: Scope,
	seen: readonly string[] = [],
): string | undefined => {
	if (seen.includes(name)) {
		throw new Error(`var() loop: ${[...seen, name].join(" -> ")}`);
	}

	const value = tokensOf(scope).get(name);
	return value === undefined ? undefined : valueIn(value, look, scope, [...seen, name]);
};

const valueIn = (
	value: string,
	look: Look,
	scope: Scope,
	seen: readonly string[],
): string | undefined => {
	const v = value.trim();
	const named = /^var\((--[\w-]+)\)$/.exec(v);

	if (named?.[1] !== undefined) {
		return tokenIn(named[1], look, scope, seen);
	}

	const pair = /^light-dark\((.*)\)$/.exec(v);

	if (pair?.[1] !== undefined) {
		const [light = "", dark = ""] = argsOf(pair[1]);
		return valueIn(look === "light" ? light : dark, look, scope, seen);
	}

	return /^#[0-9a-f]{3,8}$/i.test(v) ? hexOf(v) : v;
};

/** A token as a color, or a thrown error that names it: a missing token fails its law loudly. */
const colorIn = (name: string, look: Look, scope: Scope) => {
	const value = tokenIn(name, look, scope);

	if (value === undefined || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
		throw new Error(`${name} for ${scope} in ${look} is not a color: ${value ?? "(not set)"}`);
	}

	return value;
};

// ---- WCAG contrast -----------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

const rgbaOf = (value: string): readonly [number, number, number, number] => {
	const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
	return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

/** A color drawn over a solid one, rounded to 8 bits a channel, as the page draws it. */
const over = (top: string, bottom: Rgb): Rgb => {
	const [r, g, b, a] = rgbaOf(top);
	const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
	return [mix(r, bottom[0]), mix(g, bottom[1]), mix(b, bottom[2])];
};

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** WCAG 2.2's contrast ratio of a color drawn on a solid background. */
const ratio = (fg: string, bg: Rgb) => {
	const [hi = 0, lo = 0] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/** The tile's ground, and its title bar at rest and focused, drawn over it. */
const groundsOf = (look: Look, scope: Scope) => {
	const ground = over(colorIn("--surface", look, scope), [0, 0, 0]);
	return {
		ground,
		rest: over(colorIn("--tile-wash", look, scope), ground),
		focused: over(colorIn("--tile-wash-on", look, scope), ground),
	};
};

// ---- the laws ----------------------------------------------------------------------------------

describe("the six pipe colors", () => {
	it("are sky, pink, teal, violet, lime and plum, in the order new pipes take them", () => {
		expect(PIPES).toEqual(["sky", "pink", "teal", "violet", "lime", "plum"]);
		expect(PIPES).toHaveLength(TINTS.length);
	});

	it("each have one rule in the stylesheet, and no other pipe does", () => {
		const named = new Set(BASE.flatMap((r) => r.selectors.flatMap((s) => pipeIn(s) ?? [])));
		expect([...named].sort()).toEqual([...PIPES].sort());
	});
});

describe("a tile's colors are Radix steps, in both looks", () => {
	it.each(LOOKS)(
		"a plain tile is slate: a2 at rest, a3 focused, edge a4, text a11 and 12, %s",
		(look) => {
			const got = {
				wash: tokenIn("--tile-wash", look, "slate"),
				washOn: tokenIn("--tile-wash-on", look, "slate"),
				edge: tokenIn("--tile-edge", look, "slate"),
				hover: tokenIn("--tile-edge-hover", look, "slate"),
				edgeOn: tokenIn("--tile-edge-on", look, "slate"),
				text: tokenIn("--tile-text", look, "slate"),
				textOn: tokenIn("--tile-text-on", look, "slate"),
			};
			expect(got).toEqual({
				wash: alpha("slate", 2, look),
				washOn: alpha("slate", 3, look),
				edge: alpha("slate", 4, look),
				hover: alpha("slate", 7, look),
				// The one focus token, slate a9 in both looks (design language call 4, 2026-11-07): a8
				// reads 1.90 on the desk in light and 2.82 on a selected row in dark.
				edgeOn: alpha("slate", 9, look),
				text: alpha("slate", 11, look),
				textOn: scaleOf("slate", "solid", look)[11],
			});
		},
	);

	it.each(LOOKS)(
		"a pipe takes its own a2, a3 and a7, and keeps slate's edge and text, %s",
		(look) => {
			const got = PIPES.map((pipe) => ({
				pipe,
				wash: tokenIn("--tile-wash", look, pipe),
				washOn: tokenIn("--tile-wash-on", look, pipe),
				hover: tokenIn("--tile-edge-hover", look, pipe),
				edge: tokenIn("--tile-edge", look, pipe),
				text: tokenIn("--tile-text", look, pipe),
				textOn: tokenIn("--tile-text-on", look, pipe),
			}));
			const want = PIPES.map((pipe) => ({
				pipe,
				wash: alpha(pipe, 2, look),
				washOn: alpha(pipe, 3, look),
				hover: alpha(pipe, 7, look),
				edge: alpha("slate", 4, look),
				text: alpha("slate", 11, look),
				textOn: scaleOf("slate", "solid", look)[11],
			}));
			expect(got).toEqual(want);
		},
	);

	// The note's dark values are a8. Light has no picked step: the laws below pick it, since light
	// sky's and lime's a8 to a10 are pale fills that read under 3:1 on the ground.
	it.each(LOOKS)("a pipe's focus edge is a step of its own color, a8 in dark, %s", (look) => {
		const off = PIPES.flatMap((pipe) => {
			const edge = tokenIn("--tile-edge-on", look, pipe);
			const steps = scaleOf(pipe, "alpha", look);

			if (look === "dark") {
				return edge === alpha(pipe, 8, look) ? [] : [`${pipe} ${edge}`];
			}

			return edge !== undefined && steps.indexOf(edge) >= 7 ? [] : [`${pipe} ${edge}`];
		});
		expect(off).toEqual([]);
	});

	it.each(LOOKS)("a pipe's loud edge, when set, is a step of its own color, %s", (look) => {
		const off = PIPES.flatMap((pipe) => {
			const loud = tokenIn("--tile-edge-loud", look, pipe);

			if (!pipeTokens(pipe).has("--tile-edge-loud")) {
				return [];
			}

			return loud !== undefined && scaleOf(pipe, "alpha", look).includes(loud)
				? []
				: [`${pipe} ${loud}`];
		});
		expect(off).toEqual([]);
	});
});

// WCAG 2.2 1.4.3: text reads 4.5:1. The name at rest and the id are slate a11; the letter and the
// focused name are slate 12. Both sit on the title's wash, at rest and focused, in every color.
describe("a title bar's text reads 4.5:1 on its wash", () => {
	it.each(LOOKS)("in every color, at rest and focused, %s", (look) => {
		const under = SCOPES.flatMap((scope) => {
			const {rest, focused} = groundsOf(look, scope);
			const pairs = [
				["a11 on rest", colorIn("--tile-text", look, scope), rest],
				["12 on rest", colorIn("--tile-text-on", look, scope), rest],
				["a11 on focused", colorIn("--tile-text", look, scope), focused],
				["12 on focused", colorIn("--tile-text-on", look, scope), focused],
			] as const;
			return pairs.flatMap(([name, fg, bg]) => {
				const r = ratio(fg, bg);
				return r < 4.5 ? [`${scope} ${name} ${r.toFixed(2)}`] : [];
			});
		});
		expect(under).toEqual([]);
	});
});

/**
 * WCAG 2.2 1.4.11: a needed state reads 3:1. The focus edge does, on the ground. Where it crosses
 * the focused title (20px), one dark value is under it, named in the note: violet 2.92. It passes
 * along the rest of the tile; a look at the built app settles it. Slate was the second at 2.99
 * until its edge moved to a9 (design language call 4, 2026-11-07), which lifts it over 3:1. A new
 * one fails, and so does violet sinking lower.
 */
const NAMED_UNDER: ReadonlyMap<string, number> = new Map([["dark violet", 2.92]]);

describe("a focus edge reads 3:1", () => {
	it.each(LOOKS)("on the tile's ground, in every color, %s", (look) => {
		const under = SCOPES.flatMap((scope) => {
			const r = ratio(colorIn("--tile-edge-on", look, scope), groundsOf(look, scope).ground);
			return r < 3 ? [`${scope} ${r.toFixed(2)}`] : [];
		});
		expect(under).toEqual([]);
	});

	it.each(LOOKS)("on the focused title, but for the two the note names, %s", (look) => {
		const under = SCOPES.flatMap((scope) => {
			const r = ratio(colorIn("--tile-edge-on", look, scope), groundsOf(look, scope).focused);
			const floor = NAMED_UNDER.get(`${look} ${scope}`);
			// A named one holds at the value the note printed, to two places.
			const low = floor === undefined ? r < 3 : Math.round(r * 100) / 100 < floor;
			return low ? [`${scope} ${r.toFixed(2)}`] : [];
		});
		expect(under).toEqual([]);
	});
});

// The tile's tokens point at the theme's names, so a brought theme repaints a tile (themes.md).
// Only a wash and a pipe's own edges hold a color: a pipe is not in a theme, on purpose, and slate
// a2 has no theme name yet (the plan's gap for the themes plan).
describe("a tile's tokens point at the theme", () => {
	it("by var(), for every edge, focus and text, never a hex", () => {
		expect({
			"--tile-edge": ROOT.get("--tile-edge"),
			"--tile-edge-on": ROOT.get("--tile-edge-on"),
			"--tile-edge-hover": ROOT.get("--tile-edge-hover"),
			"--tile-text": ROOT.get("--tile-text"),
			"--tile-text-on": ROOT.get("--tile-text-on"),
			"--tile-wash-on": ROOT.get("--tile-wash-on"),
		}).toEqual({
			"--tile-edge": "var(--border-faint)",
			"--tile-edge-on": "var(--focus)",
			"--tile-edge-hover": "var(--border-strong)",
			"--tile-text": "var(--text-faint)",
			"--tile-text-on": "var(--text-primary)",
			"--tile-wash-on": "var(--surface-hover)",
		});
		const raw = [...ROOT]
			.filter(([name]) => name.startsWith("--tile-") && name !== "--tile-wash")
			.filter(([, value]) => !/^var\(--[\w-]+\)$/.test(value));
		expect(raw).toEqual([]);
	});

	it("lets a pipe set only its washes and its own edges, as hex", () => {
		const OWN = [
			"--tile-wash",
			"--tile-wash-on",
			"--tile-edge-hover",
			"--tile-edge-on",
			"--tile-edge-loud",
		];
		const COLOR = /^(#[0-9a-f]{6,8}|light-dark\(\s*#[0-9a-f]{6,8}\s*,\s*#[0-9a-f]{6,8}\s*\))$/i;
		const off = PIPES.flatMap((pipe) =>
			[...pipeTokens(pipe)]
				.filter(([name, value]) => !OWN.includes(name) || !COLOR.test(value))
				.map(([name, value]) => `${pipe} ${name}: ${value}`),
		);
		expect(off).toEqual([]);
	});

	it("under more contrast, still by var() for a tile in no pipe", () => {
		const more = rulesOf(insideMedia(uncommented(CSS), /prefers-contrast:\s*more/));
		const raw = more
			.filter((r) => r.selectors.every((s) => pipeIn(s) === undefined))
			.flatMap((r) => [...r.says])
			.filter(([name]) => name.startsWith("--tile-"))
			.filter(([, value]) => !/^var\(--[\w-]+\)$/.test(value));
		expect(raw).toEqual([]);
	});
});
