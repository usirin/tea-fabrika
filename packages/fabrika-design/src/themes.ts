// The two built-in themes, `fabrika` and `fabrika-light` (docs/direction/themes.md): Radix 3.0.0,
// gray slate, accent indigo. Every value is a Radix step, used for that step's job (color
// principles, principle 5), but for four bends, each written down with its reason:
// - the dark desk, `#0c0d0e`, is no step: nothing in slate is darker than 1;
// - turn-fg is white, Radix's rule for text on step 9, not a step;
// - border-faint is slate a4, a background step used as a line: a higher one was too loud on a full desk;
// - focus is slate a9 in both looks, dark and light, a solid step used as a line: a8 reads 1.90 on
//   the desk in light and 2.82 on a selected row in dark.
// The twenty-one global colors come from tokens/color/<token>.toml, each step and bend with its reason
// there: the token build writes them into theme-colors.ts and into tokens.css, so the stylesheet,
// the terminal and the window's frame cannot drift. The terminal's colors come from
// tokens/terminal.toml, written into the generated region below by src/build/themes.ts; its black
// (dark) and two whites (light) are fills, not text.
//
//   terminalTheme(fabrika).background   // "#111113", slate 1
//   fabrikaLight.colors.done            // "#203c25", grass 12
import {dark, light} from "./theme-colors.ts";

type Hex = `#${string}`;

/** Every global token, with the names supplied by the token build. */
type Colors = {readonly [Name in keyof typeof dark]: Hex};

/** The terminal's sixteen colors, in ANSI order: the eight, then their bright eight. */
type Palette = readonly [
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
	Hex,
];

interface Terminal {
	readonly foreground: Hex;
	readonly background: Hex;
	readonly cursor: Hex;
	readonly selection: Hex;
	readonly palette: Palette;
}

export interface Theme {
	readonly name: "fabrika" | "fabrika-light";
	readonly look: "dark" | "light";
	/** Where the values came from: a Radix pick, kept, since a new Radix version changes them. */
	readonly from: {
		readonly radix: {readonly version: "3.0.0"; readonly gray: "slate"; readonly accent: "indigo"};
	};
	readonly colors: Colors;
	readonly terminal: Terminal;
}

const RADIX = {radix: {version: "3.0.0", gray: "slate", accent: "indigo"}} as const;

const terminals = {
	// @generated terminal from tokens/terminal.toml by src/build/themes.ts; never edit by hand
	dark: {
		foreground: "#edeef0", // slate 12
		background: "#111113", // slate 1
		cursor: "#edeef0", // slate 12
		selection: "#d9edfe25", // slate a5
		palette: [
			"#212225", // slate 3
			"#e5484d", // red 9
			"#46a758", // grass 9
			"#ffc53d", // amber 9
			"#0090ff", // blue 9
			"#d19dff", // purple 11
			"#00a2c7", // cyan 9
			"#edeef0", // slate 12
			"#b0b4ba", // slate 11
			"#ff9592", // red 11
			"#71d083", // grass 11
			"#ffca16", // amber 11
			"#70b8ff", // blue 11
			"#d19dff", // purple 11
			"#4ccce6", // cyan 11
			"#edeef0", // slate 12
		],
	},
	light: {
		foreground: "#1c2024", // slate 12
		background: "#fcfcfd", // slate 1
		cursor: "#1c2024", // slate 12
		selection: "#0009321f", // slate a5
		palette: [
			"#1c2024", // slate 12
			"#ce2c31", // red 11
			"#2a7e3b", // grass 11
			"#4f3422", // amber 12
			"#0d74ce", // blue 11
			"#8145b5", // purple 11
			"#107d98", // cyan 11
			"#b9bbc6", // slate 8
			"#60646c", // slate 11
			"#ce2c31", // red 11
			"#2a7e3b", // grass 11
			"#4f3422", // amber 12
			"#0d74ce", // blue 11
			"#8e4ec6", // purple 9
			"#107d98", // cyan 11
			"#cdced6", // slate 7
		],
	},
	// @end generated terminal
} as const satisfies Readonly<Record<Theme["look"], Terminal>>;

export const fabrika: Theme = {
	name: "fabrika",
	look: "dark",
	from: RADIX,
	colors: dark,
	terminal: terminals.dark,
};

/**
 * The same pick, look light. Five colors are a step up from the plain mapping, each so it reads
 * 4.5:1 (3:1 for focus) where it sits: running amber 12, focus slate a9, and, approved 2026-11-01
 * from the design review, done grass 12, stuck red 12 and turn-text indigo a11, so the state words
 * read on a hovered and a selected row too. Its terminal keeps grass and red at 11, since the
 * terminal's colors sit on its own background, never on a row.
 */
export const fabrikaLight: Theme = {
	name: "fabrika-light",
	look: "light",
	from: RADIX,
	colors: light,
	terminal: terminals.light,
};

/** A theme's terminal colors by ghostty-web's names (its `ITheme`), the palette in ANSI order. */
export const terminalTheme = ({
	terminal: t,
}: {
	readonly terminal: {
		readonly foreground: string;
		readonly background: string;
		readonly cursor: string;
		readonly selection: string;
		readonly palette: readonly string[];
	};
}) => {
	// Sixteen colors, in ANSI order. A missing one (never, for a decoded theme) draws as the text.
	const at = (i: number) => t.palette[i] ?? t.foreground;
	return {
		foreground: t.foreground,
		background: t.background,
		cursor: t.cursor,
		selectionBackground: t.selection,
		black: at(0),
		red: at(1),
		green: at(2),
		yellow: at(3),
		blue: at(4),
		magenta: at(5),
		cyan: at(6),
		white: at(7),
		brightBlack: at(8),
		brightRed: at(9),
		brightGreen: at(10),
		brightYellow: at(11),
		brightBlue: at(12),
		brightMagenta: at(13),
		brightCyan: at(14),
		brightWhite: at(15),
	};
};

/** The system's look, as Electron's nativeTheme says it. */
interface Look {
	readonly shouldUseDarkColors: boolean;
}

/** The window's frame, what shows before the page draws and behind it as the window resizes. */
export const frameColor = (look: Look) =>
	(look.shouldUseDarkColors ? fabrika : fabrikaLight).colors["surface-sunken"];

/** What the frame needs of an applied theme: its desk. */
interface Applied {
	readonly colors: {readonly "surface-sunken": string};
}

/**
 * Repaint a window's frame on each look change, as the page follows it with light-dark(), until the
 * window closes. Electron's nativeTheme and BrowserWindow fit these shapes, so this runs on Node.
 * `apply` paints an applied theme's desk at once; while one is applied, a named theme's look wins
 * over the OS. `apply(null)` (no theme, or forced colors) follows the OS with the built-ins again.
 *
 *   const frame = followLook(nativeTheme, window);
 *   frame.apply(theme);
 */
export const followLook = (
	look: Look & {
		readonly on: (event: "updated", fn: () => void) => unknown;
		readonly off: (event: "updated", fn: () => void) => unknown;
	},
	window: {
		readonly setBackgroundColor: (color: string) => void;
		readonly once: (event: "closed", fn: () => void) => unknown;
	},
): {readonly apply: (theme: Applied | null) => void} => {
	let applied: Applied | null = null;
	let open = true;
	const paint = () => {
		if (open) window.setBackgroundColor(applied?.colors["surface-sunken"] ?? frameColor(look));
	};
	const follow = () => {
		if (applied === null) paint();
	};
	look.on("updated", follow);
	window.once("closed", () => {
		open = false;
		look.off("updated", follow);
	});
	return {
		apply: (theme) => {
			applied = theme;
			paint();
		},
	};
};
