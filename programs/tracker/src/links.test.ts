import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Piece, piecesOf} from "./links.ts";

// Which part of a body is a link: GitHub's autolink rule, for http and https only.

/** The URLs a body links, in order. */
const links = (body: string): readonly string[] =>
	piecesOf(body).flatMap((p) => (p.kind === "link" ? [p.url] : []));

describe("a URL in a body", () => {
	it("is cut out of the text around it, which stays as written", () => {
		expect(piecesOf("See https://example.com/a for it.")).toEqual([
			{kind: "text", text: "See "},
			{kind: "link", url: "https://example.com/a"},
			{kind: "text", text: " for it."},
		]);
		expect(piecesOf("https://example.com")).toEqual([{kind: "link", url: "https://example.com"}]);
		expect(piecesOf("no links here")).toEqual([{kind: "text", text: "no links here"}]);
		expect(piecesOf("")).toEqual([]);
	});

	it("is http or https, in any case, and never another scheme", () => {
		expect(links("http://commonmark.org and HTTPS://EXAMPLE.COM/A")).toEqual([
			"http://commonmark.org",
			"HTTPS://EXAMPLE.COM/A",
		]);
		expect(
			links(
				"javascript:alert(1) file:///etc/hosts ftp://foo.bar.baz mailto:a@b.c fabrika://app/desk.html data:text/html,hi",
			),
		).toEqual([]);
	});

	it("starts with no letter just before it", () => {
		expect(links("xhttps://example.com")).toEqual([]);
		expect(links("1https://example.com (https://example.org)")).toEqual([
			"https://example.com",
			"https://example.org",
		]);
	});

	it("leaves out GitHub's trailing punctuation, and keeps it inside", () => {
		expect(links("https://www.commonmark.org/a.b.")).toEqual(["https://www.commonmark.org/a.b"]);
		expect(links("Is it https://example.com/a?")).toEqual(["https://example.com/a"]);
		expect(links("https://a.com, https://b.com: and https://c.com!")).toEqual([
			"https://a.com",
			"https://b.com",
			"https://c.com",
		]);
		expect(links("**https://example.com/a** and _https://example.com/b_")).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(links(`"https://example.com/a" 'https://example.com/b'`)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(links("https://example.com/~a/b.c?d=e,f!")).toEqual([
			"https://example.com/~a/b.c?d=e,f",
		]);
	});

	it("keeps a ) that closes a ( in it, and leaves out one that does not", () => {
		expect(links("Visit https://encrypted.google.com/search?q=Markup+(business)")).toEqual([
			"https://encrypted.google.com/search?q=Markup+(business)",
		]);
		expect(links("(Visit https://encrypted.google.com/search?q=Markup+(business))")).toEqual([
			"https://encrypted.google.com/search?q=Markup+(business)",
		]);
		expect(links("https://www.google.com/search?q=(business))+ok")).toEqual([
			"https://www.google.com/search?q=(business))+ok",
		]);
		expect(links("https://www.google.com/search?q=Markup+(business)))")).toEqual([
			"https://www.google.com/search?q=Markup+(business)",
		]);
		expect(links("[the spec](https://github.github.com/gfm/)")).toEqual([
			"https://github.github.com/gfm/",
		]);
	});

	it("leaves out a trailing ;, and an &name; at its end", () => {
		expect(links("https://www.google.com/search?q=commonmark&hl=en")).toEqual([
			"https://www.google.com/search?q=commonmark&hl=en",
		]);
		expect(piecesOf("https://www.google.com/search?q=commonmark&hl;")).toEqual([
			{kind: "link", url: "https://www.google.com/search?q=commonmark"},
			{kind: "text", text: "&hl;"},
		]);
		expect(links("https://example.com/a; then")).toEqual(["https://example.com/a"]);
	});

	it("ends at a space, a < or a >", () => {
		expect(piecesOf("https://www.commonmark.org/he<lp")).toEqual([
			{kind: "link", url: "https://www.commonmark.org/he"},
			{kind: "text", text: "<lp"},
		]);
		expect(links("<https://example.com/a>")).toEqual(["https://example.com/a"]);
		expect(links("one https://a.com\ttwo\nhttps://b.com/x three")).toEqual([
			"https://a.com",
			"https://b.com/x",
		]);
	});

	it("leaves out a backtick at its end, so a URL in Markdown's backticks links", () => {
		expect(links("run `https://example.com/a` again")).toEqual(["https://example.com/a"]);
	});

	it("has a host with a letter or digit, and no _ in the host's last two parts", () => {
		expect(
			links("https://www._xxx.yyy.zzz https://www.xxx.yyy._zzz https://www.xxx._yyy.zzz"),
		).toEqual(["https://www._xxx.yyy.zzz"]);
		expect(links("http://localhost:3000/a http://127.0.0.1:8080/ https://münchen.de/")).toEqual([
			"http://localhost:3000/a",
			"http://127.0.0.1:8080/",
			"https://münchen.de/",
		]);
		expect(links("https:// http://. https://-/ https://[::1]/ https://?q")).toEqual([]);
	});

	it("is one link when a URL holds another, as a redirect's", () => {
		expect(links("https://a.com/go?to=https://b.com/x")).toEqual([
			"https://a.com/go?to=https://b.com/x",
		]);
	});
});

// Bodies built from the characters the rule turns on, so the odd cases come up often.
const bits = fc.constantFrom(
	"https://",
	"http://",
	"HTTP://",
	"a",
	"é",
	"1",
	"_",
	"-",
	".",
	",",
	"?",
	"(",
	")",
	";",
	"&amp",
	"&",
	"<",
	">",
	"`",
	"'",
	" ",
	"\n",
	"/",
	":",
	"x.com",
);
const bodies = fc.array(bits, {maxLength: 40}).map((b) => b.join(""));

const join = (pieces: readonly Piece[]) =>
	pieces.map((p) => (p.kind === "text" ? p.text : p.url)).join("");

describe("a body cut into pieces", () => {
	it("is the body again when the pieces are joined", () => {
		fc.assert(fc.property(fc.oneof(bodies, fc.string()), (body) => join(piecesOf(body)) === body));
	});

	it("has no empty text and no two texts in a row", () => {
		fc.assert(
			fc.property(bodies, (body) =>
				piecesOf(body).every(
					(p, i, all) => p.kind === "link" || (p.text !== "" && all[i + 1]?.kind !== "text"),
				),
			),
		);
	});

	it("links only http or https URLs with a host, no space, < or >, and nothing GitHub leaves out at the end", () => {
		fc.assert(
			fc.property(bodies, (body) =>
				links(body).every(
					(url) =>
						/^https?:\/\/[\p{L}\p{N}\p{M}_.-]*[\p{L}\p{N}]/iu.test(url) &&
						!/[\s<>]/u.test(url) &&
						!/[?!.,:*_~'"`;]$/u.test(url) &&
						!(url.endsWith(")") && url.split(")").length > url.split("(").length),
				),
			),
		);
	});

	it("links a URL alone as itself", () => {
		fc.assert(
			fc.property(bodies, (body) =>
				links(body).every((url) => {
					const alone = piecesOf(url);
					return alone.length === 1 && alone[0]?.kind === "link" && alone[0].url === url;
				}),
			),
		);
	});

	it("costs about the body's length, however it is built", () => {
		const big = 200_000;
		expect(links(`https://a.com/${")".repeat(big)}`)).toEqual(["https://a.com/"]);
		expect(links("https://_".repeat(big / 9))).toEqual([]);
		expect(links(`https://a.com/${"&a;".repeat(big / 3)}`)).toEqual(["https://a.com/"]);
		expect(links("https://a.com/(".repeat(big / 15))).toHaveLength(1);
		expect(links("https://a.com ".repeat(big / 14))).toHaveLength(Math.floor(big / 14));
	});
});
