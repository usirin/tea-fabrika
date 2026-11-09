// The contrast checker the token floors are judged by (design foundations, PR 2). WCAG 2.2's
// contrast ratio, with an alpha color drawn over its backdrop first and rounded to 8 bits a
// channel, as the page draws it and as rules.py does.
//
//   ratio("#ffffff", "#000000")    // 21
//   over("#dfebfd6d", "#111113")   // "#696e77": slate a9 dark, drawn over the dark ground
//   ratio("#dfebfd6d", "#111113")  // 3.68
//
// Colors are lowercase `#rrggbb` or `#rrggbbaa`. A backdrop is solid.
import {APCAcontrast, sRGBtoY} from "apca-w3";
import {Schema} from "effect";
import {fabrika, fabrikaLight} from "../themes.ts";

type Rgba = readonly [number, number, number, number];

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

const rgbaOf = (value: string): Rgba => {
	if (!HEX.test(value)) throw new Error(`not a #rrggbb or #rrggbbaa color: ${value}`);
	const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
	return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

const channel = (c: number) =>
	Math.round(c * 255)
		.toString(16)
		.padStart(2, "0");

/** A color drawn over a solid backdrop, as `#rrggbb`. A solid color comes back as it is. */
export const over = (top: string, bottom: string): string => {
	const [r, g, b, a] = rgbaOf(top);
	const [R, G, B, A] = rgbaOf(bottom);
	if (A !== 1) throw new Error(`a backdrop is solid: ${bottom}`);
	const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
	return `#${[mix(r, R), mix(g, G), mix(b, B)].map(channel).join("")}`;
};

/** An sRGB channel, gamma taken off. */
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.2's relative luminance of a solid color. */
const luminance = (color: string) => {
	const [r, g, b] = rgbaOf(color);
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** WCAG 2.2's contrast ratio of a color drawn on a solid backdrop, unrounded, 1 to 21. */
export const ratio = (fg: string, bg: string): number => {
	const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Signed APCA Lc from apca-w3 0.1.9, on the same drawn bytes as WCAG. */
export const measure = (fg: string, bg: string): {readonly wcag: number; readonly apca: number} => {
	const rgb = (color: string): [number, number, number] => {
		const [r, g, b] = rgbaOf(color);
		return [r, g, b].map((n) => Math.round(n * 255)) as [number, number, number];
	};
	return {
		wcag: ratio(fg, bg),
		apca: APCAcontrast(sRGBtoY(rgb(over(fg, bg))), sRGBtoY(rgb(bg))),
	};
};

interface Floor {
	readonly wcag: number;
	readonly apca: number;
}

/** Neither floor can excuse the other. Compare full readings, including exact boundaries. */
export const passes = (fg: string, bg: string, floor: Floor): boolean => {
	const reading = measure(fg, bg);
	return reading.wcag >= floor.wcag && Math.abs(reading.apca) >= floor.apca;
};

const Reading = Schema.Struct({wcag: Schema.Number, apca: Schema.Number});
const Change = Schema.TaggedUnion({
	moved: {
		token: Schema.String,
		on: Schema.String,
		was: Schema.String,
		now: Schema.String,
		from: Reading,
		to: Reading,
	},
	builtin: {
		token: Schema.String,
		was: Schema.String,
		now: Schema.String,
		why: Schema.Literal("past_cap"),
	},
});

interface Pair {
	readonly token: string;
	/** Topmost first, as in token TOML: hover/ground. */
	readonly on: string;
	readonly floor: Floor;
}

interface Theme {
	readonly look: string;
	readonly colors: object;
	readonly terminal: {readonly background: string; readonly cursor: string};
}

// Oklab's Cartesian a/b hold chroma and hue fixed, including around neutral colors.
// CSS Color 4 conversions. Values outside sRGB are refused, never channel-clipped.
const lab = (color: string): readonly [number, number, number] => {
	const [r, g, b] = rgbaOf(color).slice(0, 3).map(linear) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};

const inverse = [
	[4.0767416621, -3.3077115913, 0.2309699292],
	[-1.2684380046, 2.6097574011, -0.3413193965],
	[-0.0041960863, -0.7034186147, 1.707614701],
] as const;

function* intervals(values: readonly number[]) {
	let start: number | undefined;
	for (const end of values) {
		if (start !== undefined) yield [start, end] as const;
		start = end;
	}
}

/** All distinct 8-bit colors on this fixed-chroma/hue lightness path. */
const candidates = (color: string): readonly string[] => {
	const [, a, b] = lab(color);
	const offsets = [
		0.3963377774 * a + 0.2158037573 * b,
		-0.1055613458 * a - 0.0638541728 * b,
		-0.0894841775 * a - 1.291485548 * b,
	] as const;
	const curves = inverse.map((weights) => {
		const [x, y, z] = weights,
			[p, q, r] = offsets;
		const A = x + y + z;
		const B = 3 * (x * p + y * q + z * r);
		const C = 3 * (x * p ** 2 + y * q ** 2 + z * r ** 2);
		const D = x * p ** 3 + y * q ** 3 + z * r ** 3;
		return {A, B, C, at: (L: number) => ((A * L + B) * L + C) * L + D};
	});
	// A channel is cubic in L. Split at its derivative roots before finding byte boundaries.
	// No sampling interval can miss a narrow passing color between two rounded channel changes.
	const boundaries = new Set([0, 1]);
	for (const curve of curves) {
		const {A, B, C, at} = curve;
		const discriminant = 4 * B * B - 12 * A * C;
		const turns =
			discriminant < 0
				? []
				: [
						(-2 * B - Math.sqrt(discriminant)) / (6 * A),
						(-2 * B + Math.sqrt(discriminant)) / (6 * A),
					];
		const segments = [0, ...turns.filter((L) => L > 0 && L < 1), 1].sort((x, y) => x - y);
		for (const L of segments) boundaries.add(L);
		const levels = [0, ...Array.from({length: 255}, (_, i) => linear((i + 0.5) / 255)), 1];
		for (const [start, end] of intervals(segments)) {
			const ascending = at(start) < at(end);
			for (const level of levels) {
				if (level < Math.min(at(start), at(end)) || level > Math.max(at(start), at(end))) continue;
				let lo = start,
					hi = end;
				// Fifty-three bits are the precision of a JavaScript number, not a search grid.
				for (let bit = 0; bit < 53; bit++) {
					const mid = (lo + hi) / 2;
					if (at(mid) < level === ascending) lo = mid;
					else hi = mid;
				}
				boundaries.add((lo + hi) / 2);
			}
		}
	}
	const output = new Set<string>([color]);
	const serialize = (L: number) => {
		const rgb = curves.map(({at}) => at(L));
		if (rgb.some((n) => n < 0 || n > 1)) return;
		const encoded = rgb.map((n) => (n <= 0.0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055));
		output.add(`#${encoded.map(channel).join("")}${color.slice(7)}`);
	};
	const sorted = [...boundaries].sort((x, y) => x - y);
	for (const L of sorted) serialize(L);
	for (const [start, end] of intervals(sorted)) serialize((start + end) / 2);
	return [...output];
};

/** Resolve a hex value or a named alias. A cycle or missing value is an invalid contract. */
const resolve = (
	theme: Theme,
	name: string,
	seen: readonly string[] = [],
): {name: string; hex: string} => {
	if (name === "terminal.cursor") return resolve(theme, "cursor", seen);
	if (seen.includes(name)) throw new Error(`color alias cycle: ${name}`);
	const value: unknown =
		name === "cursor"
			? theme.terminal.cursor
			: name.startsWith("terminal.")
				? Reflect.get(theme.terminal, name.slice(9))
				: Reflect.get(theme.colors, name);
	if (typeof value !== "string") throw new Error(`no color: ${name}`);
	return HEX.test(value) ? {name, hex: value} : resolve(theme, value, [...seen, name]);
};

const backdrop = (theme: Theme, on: string): string => {
	const layers = on.split("/").map((name) => resolve(theme, name).hex);
	const bottom = layers.at(-1);
	if (bottom === undefined) throw new Error("a backdrop needs a base color");
	if (rgbaOf(bottom)[3] !== 1) throw new Error(`a backdrop is solid: ${on}`);
	return layers.slice(0, -1).reduceRight((under, top) => over(top, under), bottom);
};

/** Pure load/check/preview calculation. The written theme and all caller-owned values stay intact. */
export const check = <T extends Theme>(
	theme: T,
	pairs: readonly Pair[],
	settings: {readonly fix: "nudge" | "off"; readonly contrast: number},
	version: {readonly version: string; readonly cap: number},
) => {
	const proposed = {...theme, colors: {...theme.colors}, terminal: {...theme.terminal}};
	const floor = (pair: Pair): Floor =>
		pair.floor.apca >= 60
			? {...pair.floor, wcag: Math.max(pair.floor.wcag, settings.contrast)}
			: pair.floor;
	const changes: (typeof Change.Type)[] = [];
	const groups = new Map<string, Pair[]>();
	const fixed = new Set([
		"desk",
		"ground",
		"raised",
		"hover",
		"edge",
		"turn-fill",
		...pairs.flatMap(({on}) => on.split("/").map((name) => resolve(theme, name).name)),
	]);
	for (const pair of pairs) {
		const {name} = resolve(theme, pair.token);
		if (fixed.has(name) || (name.startsWith("terminal.") && name !== "terminal.cursor")) continue;
		groups.set(name, [...(groups.get(name) ?? []), pair]);
	}
	for (const [token, requirements] of groups) {
		const {hex: was} = resolve(theme, token);
		const backgrounds = requirements.map((pair) => ({pair, bg: backdrop(theme, pair.on)}));
		const failing = backgrounds.filter(({pair, bg}) => !passes(was, bg, floor(pair)));
		if (failing.length === 0) continue;
		const L = lab(was)[0];
		let best: {color: string; move: number} | undefined;
		for (const color of candidates(was)) {
			const move = Math.abs(lab(color)[0] - L);
			if (best !== undefined && move >= best.move) continue;
			if (backgrounds.every(({pair, bg}) => passes(color, bg, floor(pair)))) best = {color, move};
		}
		let now: string;
		if (best !== undefined && best.move <= version.cap) {
			now = best.color;
			for (const {pair, bg} of failing)
				changes.push(
					Change.cases.moved.make({
						token,
						on: pair.on,
						was,
						now,
						from: measure(was, bg),
						to: measure(now, bg),
					}),
				);
		} else {
			const builtin = theme.look === "light" ? fabrikaLight : fabrika;
			now = resolve(builtin, token).hex;
			changes.push(Change.cases.builtin.make({token, was, now, why: "past_cap"}));
		}
		if (token === "cursor" || token === "terminal.cursor")
			proposed.terminal = {...proposed.terminal, cursor: now};
		else Object.assign(proposed.colors, {[token]: now});
	}
	const shown = settings.fix === "off" ? theme : proposed;
	const failures = pairs.flatMap((pair) => {
		const fg = resolve(shown, pair.token).hex,
			bg = backdrop(shown, pair.on);
		return passes(fg, bg, floor(pair))
			? []
			: [
					{
						token: pair.token,
						on: pair.on,
						floor: floor(pair),
						reading: measure(fg, bg),
					},
				];
	});
	return {written: theme, shown, changes, failures, version: version.version};
};
