import type * as Pierre from "@pierre/highlights";

// A code block's colors: its text read by @pierre/highlights, Pierre's highlighter, into lines of
// spans, each with a color from one theme. The window draws each span as a React element with its
// text as a child, so the code is never HTML (`codeToTokens`, never `codeToHtml`).
//
//   const colors = await loadColors();       null only if it could not load
//   colors("const a = 1;", "ts")
//   // [[{text: "const ", color: "#f47067", italic: false, bold: false},
//   //   {text: "a ", color: null, ...}, {text: "= ", color: "#f47067", ...},
//   //   {text: "1", color: "#6cb6ff", ...}, {text: ";", color: null, ...}]]
//   colors("a b", "nope")    null: a language it does not know is drawn plain
//
// The highlighter is one WebAssembly module, about 280 KiB, that compiles as it is imported. So
// it is imported once, the first time a block asks for colors, never as the window opens: the
// window draws the text plain at once and colors it when it is ready.

/** A run of code in one color. `color` null: the page's own ink. */
export interface Span {
	readonly text: string;
	readonly color: string | null;
	readonly italic: boolean;
	readonly bold: boolean;
}
type Line = readonly Span[];

/** A code block's lines of spans, or null when its language is not one the highlighter knows. */
export type Colors = (code: string, lang: string) => readonly Line[] | null;

/** What of @pierre/highlights the colors use. */
type Highlights = Pick<typeof Pierre, "isSupportedLanguage" | "codeToTokens">;

/**
 * A line this long or longer is one span in the ink, as Shiki does: a minified file in a block
 * would otherwise be thousands of elements. The lexer still reads it, so the lines after it keep
 * their colors.
 */
const LONGEST = 1000;

/** Shiki's font flags, as the tokens carry them. */
const ITALIC = 1;
const BOLD = 2;

/** The highlighter's names for no language at all. A block in one needs no colors to load. */
const PLAIN = new Set(["plain", "plaintext", "text", "txt"]);

/** Whether a block's language could have colors: it names one, and not plain text. */
export const wantsColors = (lang: string | null): lang is string =>
	lang !== null && lang !== "" && !PLAIN.has(lang.toLowerCase());

/** The colors, from the highlighter and one theme. The theme's own ink is left to the page. */
export const colorsOf =
	(highlights: Highlights, theme: Pierre.Theme): Colors =>
	(code, lang) => {
		if (!wantsColors(lang) || !highlights.isSupportedLanguage(lang)) return null;
		const {tokens, fg} = highlights.codeToTokens(code, {
			lang,
			theme,
			tokenizeMaxLineLength: LONGEST,
		});
		return tokens.map((line) =>
			line.map((token) => ({
				text: token.content,
				color: token.color === undefined || token.color === fg ? null : token.color,
				italic: ((token.fontStyle ?? 0) & ITALIC) !== 0,
				bold: ((token.fontStyle ?? 0) & BOLD) !== 0,
			})),
		);
	};

// One highlighter for the page, as the WebAssembly is one module: a store the window reads with
// React's `useSyncExternalStore`, so the window itself holds no state. `loading` is null until a
// block first asks; `colors` is null until the load is done, and for good if it failed, as on a
// page without WebAssembly: every block then stays plain.
let loading: Promise<Colors | null> | null = null;
let colors: Colors | null = null;
const listeners = new Set<() => void>();

/** The colors, once loaded; null before. */
export const colorsNow = (): Colors | null => colors;

/** Calls `listener` when the colors load. Returns the call that stops it. */
export const onColors = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/**
 * Loads the highlighter and its theme, once: the first call imports them, a later one gets the
 * same load. GitHub's dark dimmed theme: low-glare colors made for a gray ground like the app's,
 * and every color in it reads at 6.7:1 or more on the code block's ground.
 */
export const loadColors = (): Promise<Colors | null> => {
	loading ??= Promise.all([
		import("@pierre/highlights"),
		import("@pierre/highlights/themes/github-dark-dimmed"),
	]).then(
		([highlights, theme]) => {
			colors = colorsOf(highlights, theme.default);
			for (const listener of listeners) listener();
			return colors;
		},
		(cause: unknown) => {
			console.warn("markdown: code stays plain, the highlighter did not load", cause);
			return null;
		},
	);
	return loading;
};
