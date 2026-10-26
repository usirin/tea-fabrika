import {Effect, Exit} from "effect";
import {describe, expect, it} from "vitest";
import {DESK} from "./files.ts";
import {Browser, NotOpened, openOutside, outsideOf} from "./outside.ts";

// What leaves the window: a link's URL, to a browser that is only a list here. No test opens a
// real browser.

/** Ask to open each URL from `from`, with a browser that writes down what it is asked to open. */
const ask = (urls: readonly string[], from: string = DESK) => {
	const opened: string[] = [];
	const browser = Browser.of({
		open: (url) =>
			Effect.sync(() => {
				opened.push(url);
			}),
	});
	const outs = Effect.runSync(
		// One at a time, so the list is in the order asked.
		Effect.forEach(urls, (url) => openOutside({url, from}), {concurrency: 1}).pipe(
			Effect.provideService(Browser, browser),
		),
	);
	return {opened, outs};
};

describe("a URL a page asks to open", () => {
	it("opens in the browser when it is http or https, as the URL parser writes it", () => {
		const {opened, outs} = ask([
			"https://example.com/a?b=1#c",
			"http://localhost:3000/x",
			"HTTPS://EXAMPLE.COM/A",
		]);
		expect(opened).toEqual([
			"https://example.com/a?b=1#c",
			"http://localhost:3000/x",
			"https://example.com/A",
		]);
		expect(outs.map((o) => o.kind)).toEqual(["open", "open", "open"]);
	});

	it("is refused for any other scheme, and the browser is never asked", () => {
		const {opened, outs} = ask([
			"javascript:alert(1)",
			"file:///etc/hosts",
			"fabrika://app/desk.html",
			"mailto:a@example.com",
			"data:text/html,<script>alert(1)</script>",
			"vscode://file/etc/hosts",
			"ftp://example.com/",
			"about:blank",
			"not a url",
			"",
		]);
		expect(opened).toEqual([]);
		expect(outs).toEqual([
			{kind: "refused", why: "javascript: is not http or https"},
			{kind: "refused", why: "file: is not http or https"},
			{kind: "refused", why: "fabrika: is not http or https"},
			{kind: "refused", why: "mailto: is not http or https"},
			{kind: "refused", why: "data: is not http or https"},
			{kind: "refused", why: "vscode: is not http or https"},
			{kind: "refused", why: "ftp: is not http or https"},
			{kind: "refused", why: "about: is not http or https"},
			{kind: "refused", why: "not a URL"},
			{kind: "refused", why: "not a URL"},
		]);
	});

	it("is read for its scheme as the browser reads it: spaces, tabs and case do not hide one", () => {
		expect(outsideOf(" javascript:alert(1)").kind).toBe("refused");
		expect(outsideOf("java\tscript:alert(1)").kind).toBe("refused");
		expect(outsideOf("JavaScript:alert(1)").kind).toBe("refused");
		expect(outsideOf("\nhttps://example.com/").kind).toBe("open");
		expect(outsideOf("ht\ttps://example.com/")).toEqual({
			kind: "open",
			url: "https://example.com/",
		});
	});

	it("is refused from any page but the desk of the app's own files", () => {
		const from = ["https://example.com/", "fabrika://app/desk.js", "file:///desk.html", ""];
		for (const page of from) {
			const {opened, outs} = ask(["https://example.com/a"], page);
			expect(opened).toEqual([]);
			expect(outs[0]?.kind).toBe("refused");
		}
	});

	it("that the browser does not open fails with NotOpened, for main to say so", () => {
		const browser = Browser.of({
			open: (url) => Effect.fail(new NotOpened({url, why: "no app handles it"})),
		});
		const exit = Effect.runSyncExit(
			openOutside({url: "https://example.com/a", from: DESK}).pipe(
				Effect.provideService(Browser, browser),
				Effect.flip,
			),
		);
		expect(Exit.isSuccess(exit) ? exit.value : null).toEqual(
			new NotOpened({url: "https://example.com/a", why: "no app handles it"}),
		);
	});
});
