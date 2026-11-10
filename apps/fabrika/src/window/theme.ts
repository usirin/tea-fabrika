import {applyCell, defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {fabrika, fabrikaLight} from "@kampus/fabrika-design";
import {check, ratio} from "@kampus/fabrika-design/contrast";
import type {GlobalColors} from "@kampus/fabrika-design/theme-contract";
import {repair} from "@kampus/fabrika-design/theme-contract";
import {Schema} from "effect";
import type {ThemePolicy} from "../messages.ts";
import {AppliedTheme, type ThemeReport} from "../messages.ts";
import {CACHE, paint} from "./theme-start.ts";

// Today's app, T343 PR 1: the window's appearance (plan, "What the window gets"). The page holds
// one applied theme, as Elm's parent holds its model: the host's theme message and the system's
// forced colors are its two messages, and one step applies the colors. Programs read global CSS
// tokens; a canvas reads `readColors()` and hears `onTheme`.
//
//   applyAppearance({_tag: "theme", value, version})   the host's next value: painted, cached
//   applyAppearance({_tag: "forced", on: true})        system colors: nothing set on the root,
//                                                      a canvas reads Canvas and CanvasText
//   applyAppearance({_tag: "cached", value})           the start's cached theme, until the host's
//   readColors()      {colors, terminal}: what a canvas draws now
//   onTheme(hear)     hear() once per applied change; the answer unsubscribes
//   correctCell(fg, bg, system)  a drawn terminal cell's text, moved the least lightness that
//                     passes both text floors under the person's theme-fix and theme-contrast;
//                     under forced colors, the system's text or background, whichever reads
//   themeWord(report, policy)  the one quiet word for the bottom line, or null for a clean load
//
// A named theme's look wins over the OS: while one is applied, a look change moves nothing.

/** What the window is told of its appearance. */
export type Appearance =
	| {
			readonly _tag: "theme";
			readonly value: AppliedTheme;
			readonly version: string;
			readonly policy?: ThemePolicy | undefined;
	  }
	| {readonly _tag: "forced"; readonly on: boolean}
	/**
	 * The last applied theme from the page's cache (theme-start.ts), before the host's first value:
	 * the latest choice the page knows, so leaving forced colors goes back to it, not to fabrika's.
	 */
	| {readonly _tag: "cached"; readonly value: AppliedTheme};

/** The applied theme and the system's override. */
export interface Look {
	/** The host's last theme, or none yet: then fabrika's own in the system's look. */
	readonly theme: AppliedTheme | null;
	readonly version: string | null;
	readonly policy: ThemePolicy;
	/** Forced colors is on: the system's colors win over the theme and its cache. */
	readonly forced: boolean;
}

export type LookMsg = {readonly type: "appearance"; readonly next: Appearance};

const Done = Schema.Null;
/** Set the theme's colors on the root, or `null`: take them off. */
const paintCmd = Cmd.make("paint", {
	input: Schema.Struct({theme: Schema.NullOr(AppliedTheme)}),
	ok: Done,
	err: [],
});
/** Keep the theme for the next start's first paint (theme-start.ts). */
const cacheCmd = Cmd.make("cache", {
	input: Schema.Struct({theme: AppliedTheme}),
	ok: Done,
	err: [],
});
/** Tell each canvas reader the drawn colors changed. */
const notifyCmd = Cmd.make("notify", {input: Schema.Struct({}), ok: Done, err: []});
export type LookCmd =
	| ReturnType<typeof paintCmd>
	| ReturnType<typeof cacheCmd>
	| ReturnType<typeof notifyCmd>;

const DEFAULTS: ThemePolicy = {fix: "nudge", contrast: 4.5};

export const lookMachine = defineMachine({
	types: {model: {} as Look, msg: {} as LookMsg},
	cmds: [paintCmd, cacheCmd, notifyCmd],
	init: () => [{theme: null, version: null, policy: DEFAULTS, forced: false}, []],
	update: {
		appearance: (s, {next}): readonly [Look, readonly LookCmd[]] => {
			if (next._tag === "forced") {
				const theme = next.on ? null : s.theme;
				return [{...s, forced: next.on}, [paintCmd({theme}), notifyCmd({})]];
			}
			// The cache is for paint only: the host's value, once it came, wins, and it is not
			// cached again.
			if (next._tag === "cached") {
				if (s.theme !== null) return [s, []];
				return [
					{...s, theme: next.value},
					[...(s.forced ? [] : [paintCmd({theme: next.value})]), notifyCmd({})],
				];
			}
			const look: Look = {
				...s,
				theme: next.value,
				version: next.version,
				policy: next.policy ?? DEFAULTS,
			};
			return [
				look,
				[
					cacheCmd({theme: next.value}),
					...(s.forced ? [] : [paintCmd({theme: next.value})]),
					notifyCmd({}),
				],
			];
		},
		paint_ok: noop,
		paint_err: noop,
		cache_ok: noop,
		cache_err: noop,
		notify_ok: noop,
		notify_err: noop,
	},
});

let look: Look = lookMachine.init(null, undefined)[0];
const hearers = new Set<() => void>();
/** Corrected cells by `fg bg`, for the theme and policy now: a screen has few distinct pairs. */
const corrected = new Map<string, string>();
const CORRECTED_KEPT = 4096;

/** Step the appearance by one message, and carry out what it says. */
export const applyAppearance = (next: Appearance): void => {
	const [after, cmds] = applyCell<Look, LookMsg, LookCmd>(lookMachine, look, {
		type: "appearance",
		next,
	});
	look = after;
	corrected.clear();
	for (const c of cmds) {
		if (c.type === "paint") paint(c.theme);
		else if (c.type === "cache") {
			try {
				localStorage.setItem(CACHE, JSON.stringify(c.theme));
			} catch {
				// Storage full or refused: the next start paints from the host, a moment later.
			}
		} else for (const hear of [...hearers]) hear();
	}
};

/** Hear each applied change, until the answer is called. */
export const onTheme = (hear: () => void): (() => void) => {
	hearers.add(hear);
	return () => {
		hearers.delete(hear);
	};
};

/** A theme is applied, so a system look change moves nothing. */
export const themeApplied = (): boolean => look.theme !== null && !look.forced;

/** Forced colors' system color for each global's job (CSS Color 4, system colors). */
const SYSTEM: Readonly<Record<keyof typeof GlobalColors.fields, string>> = {
	"surface-sunken": "Canvas",
	surface: "Canvas",
	"surface-raised": "Canvas",
	"surface-hover": "Canvas",
	"surface-selected": "SelectedItem",
	scrim: "Canvas",
	"border-faint": "CanvasText",
	border: "CanvasText",
	"border-strong": "CanvasText",
	wire: "CanvasText",
	focus: "Highlight",
	"text-primary": "CanvasText",
	"text-faint": "GrayText",
	closed: "GrayText",
	done: "CanvasText",
	running: "CanvasText",
	stuck: "CanvasText",
	"turn-fill": "Highlight",
	"turn-fill-hover": "Highlight",
	"turn-fg": "HighlightText",
	"turn-text": "LinkText",
};
const SYSTEM_TERMINAL = {
	foreground: "CanvasText",
	background: "Canvas",
	cursor: "CanvasText",
	selection: "Highlight",
	palette: Array.from({length: 16}, (_, i) => (i === 0 ? "Canvas" : "CanvasText")),
};

const LIGHT = "(prefers-color-scheme: light)";
/** fabrika's own, in the system's look, until the host sends a theme. */
const builtin = () =>
	typeof window !== "undefined" && window.matchMedia(LIGHT).matches ? fabrikaLight : fabrika;

/** What a canvas draws now: the applied theme, fabrika's own, or the system's colors. */
export const readColors = (): {
	readonly colors: Readonly<Record<string, string>>;
	readonly terminal: {
		readonly foreground: string;
		readonly background: string;
		readonly cursor: string;
		readonly selection: string;
		readonly palette: readonly string[];
	};
} => {
	if (look.forced) return {colors: SYSTEM, terminal: SYSTEM_TERMINAL};
	const theme = look.theme ?? builtin();
	return {colors: theme.colors, terminal: theme.terminal};
};

/** The text floor a drawn cell is held to: WCAG 4.5 (or the person's higher setting) and Lc 60. */
const CELL = [{token: "text-primary", on: "terminal.background", floor: {wcag: 4.5, apca: 60}}];

/** The system's two terminal colors under forced colors, as the canvas draws them (`#rrggbb`). */
export interface SystemCell {
	readonly text: string;
	readonly back: string;
}

/**
 * A drawn cell's text, as ghostty-web's patched `correctForeground` asks after inverse, selection
 * and faint fixed its colors: unchanged when it reads, else the shared checker's least lightness
 * move, or past the cap that look's built-in text. `fix = "off"` draws as given.
 *
 * Under forced colors a terminal reads the system's colors, as the CSS does (plan, "What the window
 * gets"): every cell's text is the system's, its text color or its background color, whichever
 * reads on the cell's drawn background. A program's own RGB, a faint cell or a palette entry never
 * draws a third color then. `system` is that pair as the terminal drew it; without it, as given.
 *
 *   correctCell("#d0d0d0", "#ffffff", {text: "#000000", back: "#ffffff"})   "#000000"
 *   correctCell("#d0d0d0", "#000000", {text: "#000000", back: "#ffffff"})   "#ffffff"
 */
export const correctCell = (fg: string, bg: string, system?: SystemCell): string => {
	if (look.forced)
		return system === undefined
			? fg
			: ratio(system.text, bg) >= ratio(system.back, bg)
				? system.text
				: system.back;
	if (look.policy.fix === "off") return fg;
	const key = `${fg} ${bg}`;
	const known = corrected.get(key);
	if (known !== undefined) return known;
	const cell = {
		look: look.theme?.look ?? builtin().look,
		colors: {"text-primary": fg},
		terminal: {background: bg, cursor: bg},
	};
	const shown = check(cell, CELL, look.policy, repair).shown.colors["text-primary"];
	if (corrected.size >= CORRECTED_KEPT) corrected.clear();
	corrected.set(key, shown);
	return shown;
};

/**
 * The one quiet word the bottom line says once for a load (themes.md point 4): what moved, what
 * took fabrika's own past the cap, what still fails, and a file that did not apply. Names and
 * counts only: no color value, no path. Under `theme-fix = "off"` nothing moved and nothing took
 * fabrika's (the report's changes are what nudge would do), so it says what would.
 *
 *   theme "dusk": 2 colors moved, 1 uses fabrika's
 *   theme "dusk": 2 colors would move, 1 would use fabrika's, 9 pairs fail    (off)
 *   theme "nord": not applied, using fabrika
 */
export const themeWord = (report: ThemeReport, policy?: ThemePolicy): string | null => {
	const off = policy?.fix === "off";
	const moved = new Set(report.changes.flatMap((c) => (c._tag === "moved" ? [c.token] : []))).size;
	const builtins = new Set(report.changes.flatMap((c) => (c._tag === "builtin" ? [c.token] : [])))
		.size;
	const failing = new Set(report.failures.map((f) => `${f.token} ${f.on}`)).size;
	const colors = moved === 1 ? "color" : "colors";
	const parts = [
		...(moved === 0 ? [] : [`${moved} ${colors} ${off ? "would move" : "moved"}`]),
		...(builtins === 0
			? []
			: [`${builtins} ${off ? "would use" : builtins === 1 ? "uses" : "use"} fabrika's`]),
		...(failing === 0 ? [] : [`${failing} ${failing === 1 ? "pair fails" : "pairs fail"}`]),
		...(report.diagnostics.length === 0
			? []
			: [
					report.diagnostics.some((d) => d.file !== "fabrika.toml")
						? "not applied, using fabrika"
						: "a setting was not read, using its default",
				]),
	];
	return parts.length === 0 ? null : `theme "${report.name}": ${parts.join(", ")}`;
};
