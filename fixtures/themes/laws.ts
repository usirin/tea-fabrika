// Today's app, T343. Test inputs and independent arithmetic, never a product dependency.
// fast-check is used here because these include deliberately invalid inputs without a schema.
import fc from "fast-check";

export const RUNS = {seed: 119120, numRuns: 150};
export const solid = fc
	.integer({min: 0, max: 0xffffff})
	.map((n) => `#${n.toString(16).padStart(6, "0")}`);
export const alpha = fc
	.tuple(solid, fc.integer({min: 0, max: 255}))
	.map(([c, a]) => `${c}${a.toString(16).padStart(2, "0")}`);
export const hex = fc.oneof(solid, alpha);
export const name = fc.stringMatching(/^[a-z][a-z0-9]{0,12}(-[a-z0-9]{1,8})?$/);
export const gray = (n: number) => `#${n.toString(16).padStart(2, "0").repeat(3)}`;
export const channels = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
export const opacity = (c: string) => (c.length === 9 ? Number.parseInt(c.slice(7), 16) / 255 : 1);
export const rgbHex = (rgb: readonly number[]) =>
	`#${rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
export const composite = (top: string, bottom: string) => {
	const a = opacity(top);
	const under = channels(bottom);
	return rgbHex(channels(top).map((n, i) => n * a + under[i]! * (1 - a)));
};
// Stacks are bottom first; rounding occurs at each drawn layer, as in the decided checker.
export const flatten = (stack: readonly string[]) =>
	stack.slice(1).reduce((under, top) => composite(top, under), stack[0]!);
const linear = (n: number) =>
	n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4;
const luminance = (c: string) =>
	channels(c).reduce((s, n, i) => s + linear(n) * [0.2126, 0.7152, 0.0722][i]!, 0);
export const wcag = (fg: string, bg: string) => {
	const a = luminance(composite(fg, bg));
	const b = luminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
// Independent implementation of the published SAPC 0.0.98G-4g equations, apca-w3 0.1.9.
// https://github.com/Myndex/apca-w3/blob/master/src/apca-w3.js (checked 2026-11-09).
export const apca = (fg: string, bg: string) => {
	const y = (c: string) =>
		channels(c).reduce((s, n, i) => s + (n / 255) ** 2.4 * [0.2126729, 0.7151522, 0.072175][i]!, 0);
	const soft = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
	const text = soft(y(composite(fg, bg))),
		ground = soft(y(bg));
	if (Math.abs(ground - text) < 0.0005) return 0;
	const delta =
		ground > text ? (ground ** 0.56 - text ** 0.57) * 1.14 : (ground ** 0.65 - text ** 0.62) * 1.14;
	return ground > text
		? (delta < 0.1 ? 0 : delta - 0.027) * 100
		: (delta > -0.1 ? 0 : delta + 0.027) * 100;
};
export const reading = (fg: string, bg: string) => ({wcag: wcag(fg, bg), apca: apca(fg, bg)});
export const meets = (fg: string, bg: string, floor = {wcag: 4.5, apca: 60}) =>
	wcag(fg, bg) >= floor.wcag && Math.abs(apca(fg, bg)) >= floor.apca;
// CSS Color 4 Oklab matrices. Retain a/b instead of hue near achromatic colors.
// https://www.w3.org/TR/css-color-4/#color-conversion-code
export const lab = (c: string) => {
	const [r, g, b] = channels(c).map(linear) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	] as const;
};

// Bound every Oklab coordinate in an output byte's rounding cell. A lightness move
// can shift two RGB bytes when re-encoded from the *rounded* L near a gamut edge.
// Interval arithmetic avoids assuming that round-trip stays within one byte.
export const labBounds = (color: string) => {
	const rgb = channels(color).map((n) => [linear(Math.max(0, n - 0.5)), linear(Math.min(255, n + 0.5))]);
	const combine = (weights: readonly number[], values: readonly (readonly number[])[]) => [
		weights.reduce((sum, w, i) => sum + w * values[i]![w < 0 ? 1 : 0]!, 0),
		weights.reduce((sum, w, i) => sum + w * values[i]![w < 0 ? 0 : 1]!, 0),
	];
	const lms = [
		[0.4122214708, 0.5363325363, 0.0514459929],
		[0.2119034982, 0.6806995451, 0.1073969566],
		[0.0883024619, 0.2817188376, 0.6299787005],
	].map((weights) => combine(weights, rgb).map(Math.cbrt));
	return [
		[0.2104542553, 0.793617785, -0.0040720468],
		[1.9779984951, -2.428592205, 0.4505937099],
		[0.0259040371, 0.7827717662, -0.808675766],
	].map((weights) => combine(weights, lms));
};
export const globalNames = [
	"desk",
	"ground",
	"raised",
	"hover",
	"edge",
	"focus",
	"text",
	"faint",
	"turn-fill",
	"on-turn",
	"turn-text",
	"done",
	"running",
	"stuck",
	"closed",
] as const;
export const colors = fc.record({
	desk: hex,
	ground: hex,
	raised: hex,
	hover: hex,
	edge: hex,
	focus: hex,
	text: hex,
	faint: hex,
	"turn-fill": hex,
	"on-turn": hex,
	"turn-text": hex,
	done: hex,
	running: hex,
	stuck: hex,
	closed: hex,
});
export const terminal = fc.record({
	foreground: hex,
	background: solid,
	cursor: hex,
	selection: hex,
	palette: fc.array(hex, {minLength: 16, maxLength: 16}),
});
export const complete = fc.record({
	format: fc.constant(1),
	name,
	look: fc.constantFrom("dark", "light"),
	colors,
	terminal,
});

// Inverse Oklab matrix, used only to prepare independent fixture inputs.
export const fromLab = (L: number, a: number, b: number) => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	if (lin.some((n) => n < 0 || n > 1)) return null;
	return rgbHex(
		lin.map((n) => 255 * (n <= 0.0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055)),
	);
};
export const mix = (bg: string, fg: string, t: number) => {
	const [L0, a0, b0] = lab(bg),
		[L1, a1, b1] = lab(fg);
	const c0 = Math.hypot(a0, b0),
		c1 = Math.hypot(a1, b1);
	const h0 = Math.atan2(b0, a0),
		h1 = Math.atan2(b1, a1);
	const delta = ((h1 - h0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
	const c = c0 + (c1 - c0) * t,
		h = h0 + delta * t;
	const result = fromLab(L0 + (L1 - L0) * t, c * Math.cos(h), c * Math.sin(h));
	if (result === null) throw new Error("fixture ladder left sRGB; review mapping before clipping");
	return result;
};
