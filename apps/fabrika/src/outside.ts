import {Brand, Context, Effect, Schema} from "effect";
import {isDesk} from "./files.ts";

// What leaves the window: a link, to the person's own browser, and nothing else.
//
// The window never navigates and never opens a window of its own (main.ts refuses both, as
// Electron's security checklist asks). A link in a program's view is `<a target="_blank">`, so a
// click asks main for a new window. Main makes none, and hands the URL here. It goes on to the
// browser only when it is http or https and comes from the desk page of the app's own files. Any
// other scheme (file:, javascript:, the app's own fabrika:, a custom one) is refused, as the
// checklist's "do not use openExternal with untrusted content" asks: a ticket's body is written by
// people and agents alike.
//
//   outsideOf("https://example.com/a")   {kind: "open", url: "https://example.com/a"}
//   outsideOf("javascript:alert(1)")     {kind: "refused", why: "javascript: is not http or https"}
//
//   yield* openOutside({url: "https://example.com/a", from: DESK})   Browser.open, then "open"
//   yield* openOutside({url: "file:///etc/hosts", from: DESK})       refused; Browser is not asked
//
// It names no platform: main.ts gives `Browser` Electron's `shell.openExternal`, and a test a list.

/** A URL the person's own browser may open: http or https, as the URL parser writes it. */
export type Outside = string & Brand.Brand<"Outside">;
const Outside = Brand.nominal<Outside>();

/** What becomes of a URL a page asks to open: it opens outside, or it is refused, and why. */
export type Outward =
	| {readonly kind: "open"; readonly url: Outside}
	| {readonly kind: "refused"; readonly why: string};

const SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Whether `url` may open in the person's own browser: only http and https. It is opened as the URL
 * parser writes it back, so the URL checked is the URL opened, its scheme first.
 */
export const outsideOf = (url: string): Outward => {
	const parsed = URL.parse(url);
	if (parsed === null) return {kind: "refused", why: "not a URL"};
	if (!SCHEMES.has(parsed.protocol))
		return {kind: "refused", why: `${parsed.protocol} is not http or https`};
	return {kind: "open", url: Outside(parsed.href)};
};

/** The browser did not open a URL: the system had nothing to open it with, or said no. */
export class NotOpened extends Schema.TaggedError<NotOpened>()("NotOpened", {
	url: Schema.String,
	why: Schema.String,
}) {}

/** The person's own browser. It opens only an `Outside`: a URL `outsideOf` let through. */
export class Browser extends Context.Service<
	Browser,
	{readonly open: (url: Outside) => Effect.Effect<void, NotOpened>}
>()("@kampus/fabrika-app/Browser") {}

/** A page asks to open `url`, as a link's new window: from the desk page, http or https opens outside. */
export const openOutside = (asked: {readonly url: string; readonly from: string}) =>
	Effect.gen(function* () {
		const out: Outward = isDesk(asked.from)
			? outsideOf(asked.url)
			: {kind: "refused", why: `${asked.from} is not the app's own page`};
		if (out.kind === "open") yield* (yield* Browser).open(out.url);
		return out;
	});
