import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";

// Experiment 177, the Radix part: a theme as a choice of Radix scales (a gray and an accent), next
// to a theme as a full set of values. Today's version. The numbers are pure arithmetic on the
// values of @radix-ui/colors 3.0.0, kept whole in schemes/ (MIT), so no dependency is added.

type Look = "dark" | "light";
interface Scale {
	readonly light: readonly string[];
	readonly dark: readonly string[];
	readonly lightA: readonly string[];
	readonly darkA: readonly string[];
	readonly lightP3: readonly string[];
	readonly darkP3: readonly string[];
}

const FILE = readFileSync(join(import.meta.dirname, "schemes/radix-colors-3.0.0.json"), "utf8");
const {scales: SCALES} = JSON.parse(FILE) as {scales: Record<string, Scale>};

export const GRAYS = ["gray", "mauve", "slate", "sage", "olive", "sand"];
export const ACCENTS = Object.keys(SCALES).filter((name) => !GRAYS.includes(name));

const toLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
const channels = (hex: string) =>
	[1, 3, 5].map((at) => toLinear(Number.parseInt(hex.slice(at, at + 2), 16) / 255));

export const ratio = (a: string, b: string) => {
	const lum = (hex: string) => {
		const [r = 0, g = 0, bl = 0] = channels(hex);
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
	};
	const [x, y] = [lum(a), lum(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const oklab = (hex: string) => {
	const [r = 0, g = 0, b = 0] = channels(hex);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	] as const;
};
const far = (p: readonly number[], q: readonly number[]) =>
	Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0), (p[2] ?? 0) - (q[2] ?? 0));
const hue = (hex: string) => {
	const [, a = 0, b = 0] = oklab(hex);
	return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};
const hueGap = (x: number, y: number) => {
	const gap = Math.abs(x - y) % 360;
	return gap > 180 ? 360 - gap : gap;
};

const step = (name: string, look: Look, n: number): string => {
	const hex = SCALES[name]?.[look][n - 1];
	if (hex === undefined) throw new Error(`no ${name} ${look} ${n}`);
	return hex.toLowerCase();
};
const round = (x: number) => Math.round(x * 100) / 100;

/** Radix's own rule for text on step 9: white, except these five, which want a dark ink. */
const inkOnNine = (accent: string) =>
	["sky", "mint", "lime", "yellow", "amber"].includes(accent) ? "#111111" : "#ffffff";

/** The app's own grays today (window.css, --n-1 to --n-12) in OKLab, to compare with a scale. */
const TODAY = [
	[0.15, 0.003],
	[0.178, 0.004],
	[0.205, 0.004],
	[0.232, 0.004],
	[0.256, 0.004],
	[0.28, 0.004],
	[0.322, 0.004],
	[0.4, 0.004],
	[0.625, 0.004],
	[0.695, 0.004],
	[0.79, 0.002],
	[0.94, 0.001],
].map(([l = 0, c = 0]) => [
	l,
	c * Math.cos((260 * Math.PI) / 180),
	c * Math.sin((260 * Math.PI) / 180),
]);

/**
 * A pick, written out as a full set of values: the one shape a theme has. Three ways to map it:
 * - `naive`: step for step onto --n-1 to --n-12.
 * - `lift`: the same, but the two grays the app uses as text are moved until they read.
 * - `own`: as @radix-ui/themes 3.3.0 uses the steps. In dark, gray-1 behind and gray-2 for a panel;
 *   in light, white for both. Hover a3, selected a4, borders a5 to a8, faint text a10, secondary
 *   text a11, primary text 12. Alpha steps sit on whatever is behind them.
 */
export const fromRadix = (
	gray: string,
	accent: string,
	look: Look,
	mode: "naive" | "lift" | "own" | "shift",
) => {
	const g = (n: number) => step(gray, look, n);
	const a = (n: number) => step(accent, look, n);
	const alpha = (n: number) => {
		const hex = SCALES[gray]?.[look === "dark" ? "darkA" : "lightA"][n - 1];
		if (hex === undefined) throw new Error(`no ${gray} alpha ${n}`);
		return hex.toLowerCase();
	};
	const tokens: Record<string, string> = {};
	for (let n = 1; n <= 12; n += 1) tokens[`--n-${n}`] = g(n);
	for (const n of [3, 5, 9, 10, 11]) tokens[`--a-${n}`] = a(n);
	tokens["--turn-fg"] = inkOnNine(accent);
	tokens["--done"] = step("grass", look, 11);
	tokens["--running"] = step("amber", look, 11);
	tokens["--stuck"] = step("red", look, 11);
	if (mode === "own") {
		tokens["--n-1"] = look === "dark" ? g(1) : "#ffffff";
		tokens["--n-2"] = look === "dark" ? g(2) : "#ffffff";
		tokens["--n-3"] = alpha(2);
		tokens["--n-4"] = alpha(3);
		tokens["--n-5"] = alpha(4);
		tokens["--border-faint"] = alpha(5);
		tokens["--n-6"] = alpha(6);
		tokens["--n-7"] = alpha(7);
		tokens["--n-8"] = alpha(8);
		tokens["--n-9"] = alpha(10);
		tokens["--n-10"] = alpha(11);
		tokens["--n-11"] = alpha(11);
		tokens["--n-12"] = g(12);
		// What opens over the desk must not show the desk through it: a solid panel, as Themes has.
		tokens["--pop-bg"] = look === "dark" ? g(2) : "#ffffff";
	}
	if (mode === "shift") {
		// `own`, one step darker, which is where the app's own look sits: gray-1 is the tile, gray-2
		// what is raised. The sunken ground has no Radix step, so it is the app's own value, a custom
		// color beside the scale, as Radix's docs say to add one.
		tokens["--n-1"] = "#0c0d0e";
		tokens["--n-2"] = g(1);
		tokens["--n-3"] = g(2);
		tokens["--n-4"] = alpha(3);
		tokens["--n-5"] = alpha(4);
		tokens["--border-faint"] = alpha(5);
		tokens["--n-6"] = alpha(6);
		tokens["--n-7"] = alpha(7);
		tokens["--n-8"] = alpha(8);
		tokens["--n-9"] = alpha(10);
		tokens["--n-10"] = alpha(11);
		tokens["--n-11"] = alpha(11);
		tokens["--n-12"] = g(12);
		tokens["--pop-bg"] = g(2);
	}
	if (mode === "lift") {
		// Stay on the gray's own road from 10 to 11, and stop where it reads on a raised surface.
		const mixed = (t: number) => {
			const [from, to] = [channels(g(10)), channels(g(11))];
			const out = from.map((u, i) => u + ((to[i] ?? 0) - u) * t);
			const enc = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);
			return `#${out
				.map((u) =>
					Math.round(enc(u) * 255)
						.toString(16)
						.padStart(2, "0"),
				)
				.join("")}`;
		};
		let t = 0;
		while (t < 1 && ratio(mixed(t), g(3)) < 4.5) t += 0.02;
		tokens["--n-9"] = mixed(t);
		tokens["--n-10"] = mixed(Math.min(1, t + 0.2));
	}
	const nine = (name: string) => step(name, look, 9);
	const eleven = (name: string) => step(name, look, 11);
	const theme = {
		format: 1,
		name: `Radix ${gray} ${accent}`,
		by: "Radix Colors 3.0.0",
		look,
		from: {
			format: "fabrika",
			hash: `sha256-${createHash("sha256").update(`${FILE}${gray}${accent}${look}`).digest("hex")}`,
		},
		ground: mode === "own" && look === "light" ? "#ffffff" : mode === "shift" ? g(1) : g(2),
		ink: g(12),
		turn: a(11),
		done: tokens["--done"],
		running: tokens["--running"],
		stuck: tokens["--stuck"],
		lines: ["amber", "blue", "teal", "violet", "ruby", "grass"].map(nine),
		services: ["blue", "plum", "cyan", "pink", "lime", "orange"].map(nine),
		tint: 30,
		terminal: {
			foreground: g(12),
			background: mode === "own" && look === "light" ? "#ffffff" : mode === "shift" ? g(1) : g(2),
			cursor: g(12),
			selectionBackground: g(5),
			selectionForeground: g(12),
			palette: [
				g(1),
				eleven("red"),
				eleven("grass"),
				eleven("amber"),
				eleven("blue"),
				eleven("plum"),
				eleven("cyan"),
				g(11),
				g(8),
				nine("red"),
				nine("grass"),
				nine("amber"),
				nine("blue"),
				nine("plum"),
				nine("cyan"),
				g(12),
			],
		},
	};
	return {theme, tokens};
};

/** The whole space of picks, measured: what a choice of scales gives for free, and what it cannot. */
export const audit = (
	shared: Record<string, {ground: string; ink: string; terminal: {palette: readonly string[]}}>,
) => {
	const looks: Look[] = ["dark", "light"];
	const span = (xs: number[]) => [round(Math.min(...xs)), round(Math.max(...xs))];

	const grayText: Record<string, Record<string, number[]>> = {};
	for (const look of looks) {
		grayText[look] = {};
		for (const ink of [9, 10, 11, 12]) {
			for (const on of [1, 2, 3, 5]) {
				const row = GRAYS.map((name) => ratio(step(name, look, ink), step(name, look, on)));
				(grayText[look] as Record<string, number[]>)[`${ink} on ${on}`] = span(row);
			}
		}
	}

	const accentText: Record<string, unknown> = {};
	const solids: Record<string, unknown> = {};
	for (const look of looks) {
		const rows = ACCENTS.flatMap((accent) =>
			GRAYS.map((gray) => ratio(step(accent, look, 11), step(gray, look, 3))),
		);
		accentText[look] = {
			"accent 11 on gray 3": span(rows),
			picks: rows.length,
			under45: rows.filter((x) => x < 4.5).length,
		};
		const best = ACCENTS.map((accent) => ({
			accent,
			best: ratio(inkOnNine(accent), step(accent, look, 9)),
		}));
		solids[look] = {
			radixInkOnNine: span(best.map((x) => x.best)),
			under45: best.filter((x) => x.best < 4.5).map((x) => `${x.accent} ${round(x.best)}`),
		};
	}

	// "The accent means your turn and nothing else": a pick can land on a status color.
	const clashes = (look: Look) =>
		ACCENTS.flatMap((accent) =>
			Object.entries({stuck: "red", running: "amber", done: "grass"}).flatMap(([meaning, scale]) =>
				hueGap(hue(step(accent, look, 9)), hue(step(scale, look, 9))) < 25
					? [`${accent}~${meaning}`]
					: [],
			),
		);

	// A color a screen with wide gamut shows and a hex cannot hold.
	const encoded = (u: number) => toLinear(Math.abs(u)) * Math.sign(u);
	const outOfHex = (css: string) => {
		const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).slice(-3).map(Number).map(encoded);
		const srgb = [
			1.2249 * r - 0.2247 * g,
			-0.042 * r + 1.0419 * g,
			-0.0197 * r - 0.0786 * g + 1.0979 * b,
		];
		return srgb.some((u) => u < -0.002 || u > 1.002);
	};
	const wide = Object.fromEntries(
		looks.map((look) => {
			const key = look === "dark" ? "darkP3" : "lightP3";
			const accents = ACCENTS.map((name) => (SCALES[name]?.[key] ?? []).filter(outOfHex).length);
			const grays = GRAYS.map((name) => (SCALES[name]?.[key] ?? []).filter(outOfHex).length);
			return [
				look,
				{
					accentSteps: accents.reduce((x, y) => x + y, 0),
					of: accents.length * 12,
					graySteps: grays.reduce((x, y) => x + y, 0),
				},
			];
		}),
	);

	// Can a shared theme be said as a pick? The nearest Radix value to each of its colors.
	const allGrays = GRAYS.flatMap((name) => looks.flatMap((look) => SCALES[name]?.[look] ?? []));
	const all = Object.keys(SCALES).flatMap((name) =>
		looks.flatMap((look) => SCALES[name]?.[look] ?? []),
	);
	const nearest = (hex: string, pool: readonly string[]) =>
		Math.min(...pool.map((other) => far(oklab(hex), oklab(other.toLowerCase()))));
	const sharedThemes = Object.fromEntries(
		Object.entries(shared).map(([name, theme]) => {
			const palette = theme.terminal.palette.map((hex) => nearest(hex, all));
			return [
				name,
				{
					ground: round(nearest(theme.ground, allGrays) * 100) / 100,
					ink: round(nearest(theme.ink, allGrays) * 100) / 100,
					paletteWorst: round(Math.max(...palette) * 100) / 100,
					paletteOver02: palette.filter((x) => x > 0.02).length,
				},
			];
		}),
	);

	const nearToday = TODAY.map(
		(lab, i) => round(far(lab, oklab(step("slate", "dark", i + 1))) * 100) / 100,
	);
	// Which gray sits nearest the app's own look, and how colored each is: the app's chroma is 0.004.
	const chroma = (hex: string) => {
		const [, x = 0, y = 0] = oklab(hex);
		return Math.hypot(x, y);
	};
	const graysVersusToday = Object.fromEntries(
		GRAYS.map((name) => {
			const gaps = TODAY.map((lab, i) => far(lab, oklab(step(name, "dark", i + 1))));
			const inks = [1, 2, 3, 5].map((n) => chroma(step(name, "dark", n)));
			return [
				name,
				{
					meanFar: Math.round((gaps.reduce((x, y) => x + y, 0) / gaps.length) * 1000) / 1000,
					groundChroma: inks.map((c) => Math.round(c * 1000) / 1000),
				},
			];
		}),
	);
	const lightness = TODAY.map((lab, i) => [
		round(lab[0] ?? 0),
		round(oklab(step("slate", "dark", i + 1))[0]),
	]);
	const pick = (look: Look) => {
		const {theme} = fromRadix("slate", "indigo", look, "own");
		const bg = theme.terminal.background;
		return {
			ink: round(ratio(theme.terminal.foreground, bg)),
			under3: theme.terminal.palette.filter((hex) => ratio(hex, bg) < 3).length,
			under45: theme.terminal.palette.filter((hex) => ratio(hex, bg) < 4.5).length,
		};
	};
	return {
		scales: Object.keys(SCALES).length,
		grays: GRAYS.length,
		accents: ACCENTS.length,
		picks: GRAYS.length * ACCENTS.length * 2,
		grayText,
		accentText,
		solids,
		clashesDark: clashes("dark"),
		wide,
		sharedThemes,
		slateVersusToday: {far: nearToday, lightness},
		graysVersusToday,
		terminal: {dark: pick("dark"), light: pick("light")},
	};
};
