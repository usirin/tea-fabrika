// A body as the window draws it: its text, with each http and https URL in it a link. The rule is
// GitHub's "extended autolink" (the GFM spec, as cmark-gfm runs it), for http and https only:
//
//   piecesOf("See https://example.com/a.")
//   // [{kind: "text", text: "See "}, {kind: "link", url: "https://example.com/a"},
//   //  {kind: "text", text: "."}]
//
//   a URL starts   at http:// or https://, in any case, with no letter just before it
//   its host       letters, digits, - _ and ., with at least one letter or digit, and no _ in
//                  its last two parts
//   it runs        to the next space, < or >
//   then its end is left out, again and again, while it is:
//     ? ! . , : * _ ~ ' " `     one of these
//     )                         a ) with more ) than ( in the URL
//     ;                         a ; and, when it ends an &name; such as &amp;, the whole &name;
//
// Two steps are not GitHub's. A > ends a URL too, as RFC 3986 (appendix C) has <> mark a URL in
// plain text, so <https://example.com> links https://example.com. And a ` at the end is left out,
// so a URL in Markdown's backticks does not take the backtick in.
//
// Markdown is not read yet: [text](https://example.com) shows as written, with its URL a link.
//
// Each step scans only the URL it is in, and a start inside a URL already linked is passed over,
// so a long body costs about its length, whatever an agent wrote in it.

/** A piece of a body: text as it was written, or a URL to link. */
export type Piece =
	| {readonly kind: "text"; readonly text: string}
	| {readonly kind: "link"; readonly url: string};

/** Where a URL may start: http:// or https://, in any case, with no ASCII letter just before it. */
const START = /(?<![a-z])https?:\/\//giu;

/** Left out at a URL's end: GitHub's trailing punctuation, and the backtick. */
const TRAILING = new Set(["?", "!", ".", ",", ":", "*", "_", "~", "'", '"', "`"]);

const ALNUM = /^[A-Za-z0-9]$/;

/** The body cut into text and links. Joined back, the pieces are the body. */
export const piecesOf = (body: string): readonly Piece[] => {
	const pieces: Piece[] = [];
	/** Where the text not placed yet starts. */
	let placed = 0;
	for (const start of body.matchAll(START)) {
		const from = start.index;
		// A start inside a URL already linked, such as a redirect's ?to=https://...
		if (from < placed) continue;
		const to = urlEnd(body, from, from + start[0].length);
		if (to === null) continue;
		if (from > placed) pieces.push({kind: "text", text: body.slice(placed, from)});
		pieces.push({kind: "link", url: body.slice(from, to)});
		placed = to;
	}
	if (placed < body.length) pieces.push({kind: "text", text: body.slice(placed)});
	return pieces;
};

/** Where the URL that starts at `from` ends, its host starting at `at`; or null, for no URL. */
const urlEnd = (body: string, from: number, at: number): number | null => {
	const host = /[\p{L}\p{N}\p{M}_.-]*/uy;
	host.lastIndex = at;
	const name = host.exec(body)?.[0] ?? "";
	if (!isHost(name)) return null;
	const stop = /[\s<>]/gu;
	stop.lastIndex = at + name.length;
	return trimmed(body, from, stop.exec(body)?.index ?? body.length);
};

/** A host GitHub links: at least one letter or digit, and no _ in its last two parts. */
const isHost = (host: string): boolean =>
	/[\p{L}\p{N}]/u.test(host) &&
	!host
		.split(".")
		.slice(-2)
		.some((part) => part.includes("_"));

/** The end of the URL `body[from, to)`, once what GitHub leaves out at its end is left out. */
const trimmed = (body: string, from: number, to: number): number => {
	let opens = 0;
	let closes = 0;
	for (let i = from; i < to; i += 1) {
		if (body[i] === "(") opens += 1;
		else if (body[i] === ")") closes += 1;
	}
	let end = to;
	while (end > from) {
		const last = body[end - 1] ?? "";
		if (TRAILING.has(last)) end -= 1;
		else if (last === ";") end = entityAt(body, from, end) ?? end - 1;
		else if (last === ")" && closes > opens) {
			end -= 1;
			closes -= 1;
		} else break;
	}
	return end;
};

/** Where the &name; that ends at `end` starts, or null when `body[.., end)` ends in no such one. */
const entityAt = (body: string, from: number, end: number): number | null => {
	let at = end - 2;
	while (at > from && ALNUM.test(body[at] ?? "")) at -= 1;
	return at < end - 2 && body[at] === "&" ? at : null;
};
