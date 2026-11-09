// One stylesheet with its local `@import`s inlined, parsed by lightningcss (a real CSS parser).
// lightningcss lists each `@import` and `url()` it finds with the URL already decoded, and drops the
// imports from the printed sheet; this file follows the local imports itself, so it stays sync.
// A window's stylesheet is served from the brain's table, which holds scripts and stylesheets only,
// so any other local file a stylesheet names stops the build instead of answering 404 later.
// It runs inside a Rolldown hook, outside Effect: it reads files directly, and a throw fails the bundle.
import {Buffer} from "node:buffer";
import {readFileSync, realpathSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {type ImportDependency, transform} from "lightningcss";

/** A reference to a scheme (`https:`, `data:`), a host (`//`) or a fragment is not a local file. */
const remote = (ref: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref);
const quoted = (url: string) =>
	`"${url.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

type Sheet = {readonly imports: ReadonlyArray<string>; readonly body: string};
const unsupported = "unsupported @import condition";

// lightningcss names the bad token in its message; the build's errors name what is broken.
const parseError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	if (message === unsupported) return new Error(unsupported);
	if (message.includes("BadString")) return new Error("stylesheet has a broken string");
	if (message.includes("BadUrl")) return new Error("stylesheet has a broken url()");
	return new Error(`stylesheet has a broken @import: ${message}`);
};

// lightningcss reports a rule's start as a 0-based line and a 1-based UTF-16 column, and counts
// LF, CRLF, CR and form feed as one line break each, as CSS input preprocessing does.
const offsets = (text: string) => {
	const starts = [0];
	for (const m of text.matchAll(/\r\n|[\n\r\f]/g)) starts.push(m.index + m[0].length);
	return ({line, column}: {readonly line: number; readonly column: number}) =>
		(starts[line] ?? text.length) + column - 1;
};

// 1.33.0 gives `layer: null` both for no layer and for a bare `layer`, so the import's own raw text
// is printed alone, where the printer writes the url as one string and keeps the bare keyword.
const bareLayer = (rule: string) =>
	/^@import "(?:[^"\\]|\\.)*" layer[ ;]/.test(
		transform({filename: "import.css", code: Buffer.from(rule)}).code.toString(),
	);

const parse = (file: string) => {
	const text = readFileSync(file, "utf8"),
		at = offsets(text),
		starts: number[] = [],
		imports: number[] = [];
	try {
		const result = transform({
			filename: file,
			code: Buffer.from(text),
			analyzeDependencies: true,
			errorRecovery: false,
			visitor: {
				Rule(rule) {
					// Neither has a place in the source to start from.
					if (rule.type === "ignored" || rule.type === "custom") return;
					const start = at(rule.value.loc);
					starts.push(start);
					if (rule.type !== "import") return;
					// `layer` and `supports()` would need their own wrapper; a media query is not one.
					if ((rule.value.layer ?? rule.value.supports ?? null) !== null)
						throw new Error(unsupported);
					imports.push(start);
				},
			},
		});
		for (const start of imports) {
			const end = Math.min(text.length, ...starts.filter((next) => next > start));
			if (bareLayer(text.slice(start, end))) throw new Error(unsupported);
		}
		return result;
	} catch (error) {
		throw parseError(error);
	}
};

const local = (dependency: ImportDependency, file: string, seen: ReadonlySet<string>): Sheet => {
	const child = inline(resolve(dirname(file), dependency.url), seen);
	if (dependency.media === null) return child;
	if (child.imports.length > 0) throw new Error(unsupported);
	return {imports: [], body: `@media ${dependency.media} {\n${child.body}\n}`};
};

const inline = (path: string, seen: ReadonlySet<string>): Sheet => {
	const file = realpathSync(path);
	if (seen.has(file)) throw new Error("stylesheet imports itself");
	const inside = new Set([...seen, file]),
		{code, dependencies = []} = parse(file);
	let body = code.toString();
	const imports: string[] = [],
		parts: string[] = [];
	for (const dependency of dependencies) {
		if (dependency.type === "url") {
			if (!remote(dependency.url)) throw new Error("stylesheet references a file");
			body = body.replaceAll(`"${dependency.placeholder}"`, quoted(dependency.url));
		} else if (dependency.type === "import") {
			const media = dependency.media === null ? "" : ` ${dependency.media}`;
			if (remote(dependency.url)) imports.push(`@import url(${quoted(dependency.url)})${media};`);
			else {
				const child = local(dependency, file, inside);
				imports.push(...child.imports);
				parts.push(child.body);
			}
		}
	}
	return {imports, body: [...parts, body].filter((part) => part.trim() !== "").join("\n")};
};

export const inlineStylesheet = (file: string) => {
	const {imports, body} = inline(file, new Set());
	return [...imports, body].join("\n");
};
