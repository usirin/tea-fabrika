import {GlobalColors} from "@kampus/fabrika-design/theme-contract";
import {Exit, Schema} from "effect";
import {AppliedTheme} from "../messages.ts";

// Today's app, T343: the window's first paint (plan, "What the window gets"). The last theme the
// host applied is kept in the page's own storage, for paint only. Before the desk draws, it is
// read, checked as a complete applied theme and set on the root, so a person's Nord never starts
// as fabrika. The host's next value replaces it. Forced colors wins over the cache: nothing is set.
//
//   startTheme(localStorage, false)   true: the cached Nord is on the root, appearance "ready"
//   startTheme(localStorage, true)    false: forced colors; the system's colors stay
//   a cache that is not a complete applied theme: false, nothing set, and the cache removed

/** The one key the page keeps its last applied theme under. */
export const CACHE = "fabrika.theme";

const GLOBALS = Object.keys(GlobalColors.fields);

/**
 * Set each global color on the root, `--surface` and the rest, and the look light-dark() reads;
 * `null` takes every one off again, so the stylesheet's own values (and forced colors) show.
 */
export const paint = (theme: Pick<AppliedTheme, "colors" | "look"> | null): void => {
	const {style} = document.documentElement;
	for (const name of GLOBALS) {
		const value: unknown = theme === null ? undefined : Reflect.get(theme.colors, name);
		if (typeof value === "string") style.setProperty(`--${name}`, value);
		else style.removeProperty(`--${name}`);
	}
	if (theme === null) style.removeProperty("color-scheme");
	else style.setProperty("color-scheme", theme.look);
};

/** The first appearance is applied: the app may show the window (main.ts). */
export const markReady = (): void => {
	document.documentElement.dataset["appearance"] = "ready";
};

const decode = Schema.decodeUnknownExit(Schema.fromJsonString(AppliedTheme));

/** Paint the cached theme before the first draw. True when one was painted. */
export const startTheme = (
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
	forced: boolean,
): boolean => {
	if (forced) return false;
	const cached = storage.getItem(CACHE);
	if (cached === null) return false;
	const read = decode(cached, {onExcessProperty: "error"});
	if (Exit.isFailure(read)) {
		storage.removeItem(CACHE);
		return false;
	}
	paint(read.value);
	markReady();
	return true;
};
