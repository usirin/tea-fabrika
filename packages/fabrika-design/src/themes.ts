// The two built-in themes, `fabrika` and `fabrika-light` (docs/direction/themes.md): Radix 3.0.0,
// gray slate, accent indigo. Every value is a Radix step, used for that step's job (color
// principles, principle 5), but for five bends, each written down with its reason:
// - the dark desk, `#0c0d0e`, is no step: nothing in slate is darker than 1;
// - on-turn is white, Radix's rule for text on step 9, not a step;
// - edge is slate a4, a background step used as a line: a higher one was too loud on a full desk;
// - focus in light is slate a9, a solid step used as a line: a8 reads 1.90 on the desk;
// - the keyboard ring in dark is slate a9 too (tokens.css --focus): a8 reads 2.82 on a selected row.
// The terminal's black (dark) and two whites (light) are fills, not text. The package's stylesheet
// writes the same values as tokens (tokens.css :root); the terminal and the window's frame read
// them from here.
//
//   terminalTheme(fabrika).background   // "#111113", slate 1
//   fabrikaLight.colors.done            // "#203c25", grass 12

type Hex = `#${string}`;

/** The fifteen colors the note names. */
interface Colors {
	/** Behind the tiles. */
	readonly desk: Hex;
	/** A tile. */
	readonly ground: Hex;
	/** What opens over the desk. */
	readonly raised: Hex;
	readonly card: Hex;
	readonly hover: Hex;
	/** A tile's edge at rest: carries no fact, the bend color principles records. */
	readonly edge: Hex;
	/** The focused tile's edge. */
	readonly focus: Hex;
	readonly text: Hex;
	readonly faint: Hex;
	/** The turn fill: your turn, and nothing else. */
	readonly turn: Hex;
	readonly "on-turn": Hex;
	readonly "turn-text": Hex;
	readonly done: Hex;
	readonly running: Hex;
	readonly stuck: Hex;
	readonly closed: Hex;
}

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

export const fabrika: Theme = {
	name: "fabrika",
	look: "dark",
	from: RADIX,
	colors: {
		desk: "#0c0d0e", // not a step: nothing in slate is darker than 1
		ground: "#111113", // slate 1
		raised: "#18191b", // slate 2
		card: "#212225", // slate 3
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
	},
	terminal: {
		foreground: "#edeef0", // slate 12
		background: "#111113", // slate 1
		cursor: "#edeef0", // slate 12
		selection: "#d9edfe25", // slate a5
		palette: [
			"#212225", // black: slate 3, a fill
			"#e5484d", // red 9
			"#46a758", // grass 9
			"#ffc53d", // amber 9
			"#0090ff", // blue 9
			"#d19dff", // purple 11
			"#00a2c7", // cyan 9
			"#edeef0", // white: slate 12
			"#b0b4ba", // bright black: slate 11
			"#ff9592", // red 11
			"#71d083", // grass 11
			"#ffca16", // amber 11
			"#70b8ff", // blue 11
			"#d19dff", // purple 11
			"#4ccce6", // cyan 11
			"#edeef0", // bright white: slate 12
		],
	},
};

/**
 * The same pick, look light. Five colors are a step up from the plain mapping, each so it reads
 * 4.5:1 (3:1 for focus) where it sits: running amber 12, focus slate a9, and, approved 2026-11-01
 * from the design review, done grass 12, stuck red 12 and turn-text indigo a11, so the state words
 * read on a hovered and a selected row too.
 */
export const fabrikaLight: Theme = {
	name: "fabrika-light",
	look: "light",
	from: RADIX,
	colors: {
		desk: "#f9f9fb", // slate 2
		ground: "#fcfcfd", // slate 1
		raised: "#fcfcfd", // slate 1
		card: "#f0f0f3", // slate 3
		hover: "#0000330f", // slate a3
		edge: "#00002d17", // slate a4
		focus: "#00051d74", // slate a9: a8 reads 1.90
		text: "#1c2024", // slate 12
		faint: "#0007149f", // slate a11
		turn: "#3e63dd", // indigo 9
		"on-turn": "#ffffff",
		"turn-text": "#002bb7c5", // indigo a11: indigo 11 reads 4.47 on a selected row
		done: "#203c25", // grass 12: grass 11 reads 3.77 on a selected row
		running: "#4f3422", // amber 12: amber 11 reads 4.38
		stuck: "#641723", // red 12: red 11 reads 3.88 on a selected row
		closed: "#0007149f", // slate a11
	},
	terminal: {
		foreground: "#1c2024", // slate 12
		background: "#fcfcfd", // slate 1
		cursor: "#1c2024", // slate 12
		selection: "#0009321f", // slate a5
		// The terminal's colors sit on its own background, never on a row, so grass and red stay 11.
		palette: [
			"#1c2024", // black: slate 12
			"#ce2c31", // red 11
			"#2a7e3b", // grass 11
			"#4f3422", // amber 12
			"#0d74ce", // blue 11
			"#8145b5", // purple 11
			"#107d98", // cyan 11
			"#b9bbc6", // white: slate 8, a fill
			"#60646c", // bright black: slate 11
			"#ce2c31", // red 11
			"#2a7e3b", // grass 11
			"#4f3422", // amber 12
			"#0d74ce", // blue 11
			"#8e4ec6", // purple 9
			"#107d98", // cyan 11
			"#cdced6", // bright white: slate 7, a fill
		],
	},
};

/** A theme's terminal colors by ghostty-web's names (its `ITheme`), the palette in ANSI order. */
export const terminalTheme = ({terminal: t}: Theme) => {
	const [black, red, green, yellow, blue, magenta, cyan, white, ...b] = t.palette;
	const [
		brightBlack,
		brightRed,
		brightGreen,
		brightYellow,
		brightBlue,
		brightMagenta,
		brightCyan,
		brightWhite,
	] = b;
	return {
		foreground: t.foreground,
		background: t.background,
		cursor: t.cursor,
		selectionBackground: t.selection,
		black,
		red,
		green,
		yellow,
		blue,
		magenta,
		cyan,
		white,
		brightBlack,
		brightRed,
		brightGreen,
		brightYellow,
		brightBlue,
		brightMagenta,
		brightCyan,
		brightWhite,
	};
};

/** The system's look, as Electron's nativeTheme says it. */
interface Look {
	readonly shouldUseDarkColors: boolean;
}

/** The window's frame, what shows before the page draws and behind it as the window resizes. */
export const frameColor = (look: Look) =>
	(look.shouldUseDarkColors ? fabrika : fabrikaLight).colors.desk;

/**
 * Repaint a window's frame on each look change, as the page follows it with light-dark(), until the
 * window closes. Electron's nativeTheme and BrowserWindow fit these shapes, so this runs on Node.
 *
 *   followLook(nativeTheme, window);
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
) => {
	const paint = () => window.setBackgroundColor(frameColor(look));
	look.on("updated", paint);
	window.once("closed", () => look.off("updated", paint));
};
