// One stylesheet with its local `@import`s inlined by lightningcss's own bundler, which keeps the
// cascade: layer order, source order, and a refusal when a remote import follows a bundled one.
// Each file it reads is checked first (`check`), since the bundler would keep a local `url()` and
// wrap a `layer` or `supports()` import that the build does not accept.
// A window's stylesheet is served from the brain's table, which holds scripts and stylesheets only,
// so any other local file a stylesheet names stops the build instead of answering 404 later.
import {Buffer} from "node:buffer";
import {readFileSync, realpathSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {Effect} from "effect";
import {bundleAsync, transform} from "lightningcss";

/** A reference to a scheme (`https:`, `data:`), a host (`//`) or a fragment is not a local file. */
const remote = (ref: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref);
const unsupported = "unsupported @import condition";

// lightningcss names the bad token in its message; the build's errors name what is broken.
const parseError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	const known = message.match(/(?:unsupported @import condition|stylesheet [^:]*)$/)?.[0];
	if (known !== undefined) return new Error(known);
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

// One file's own checks, run as the bundler reads it: the token errors, the import conditions it
// cannot keep, and any local file a `url()` names.
const check = (file: string, text: string) => {
	const at = offsets(text),
		starts: number[] = [],
		imports: number[] = [];
	// oxlint-disable-next-line fabrika/no-raw-try-catch -- runs in the bundler's read callback, which fails by throwing
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
		for (const dependency of result.dependencies ?? [])
			if (dependency.type === "url" && !remote(dependency.url))
				throw new Error("stylesheet references a file");
	} catch (error) {
		throw parseError(error);
	}
};

// The bundler drops an import it has already entered, so a cycle is found from the edges it resolved.
const cyclic = (edges: ReadonlyMap<string, ReadonlySet<string>>) => {
	const done = new Set<string>(),
		open = new Set<string>();
	const visit = (file: string): boolean => {
		if (open.has(file)) return true;
		if (done.has(file)) return false;
		open.add(file);
		const found = [...(edges.get(file) ?? [])].some(visit);
		open.delete(file);
		done.add(file);
		return found;
	};
	return [...edges.keys()].some(visit);
};

export const inlineStylesheet = Effect.fn("build.css")(function* (file: string) {
	const edges = new Map<string, Set<string>>();
	// oxlint-disable-next-line fabrika/no-promises -- edge: lightningcss takes a resolver only in bundleAsync
	const result = yield* Effect.tryPromise({
		try: () =>
			bundleAsync({
				filename: realpathSync(file),
				errorRecovery: false,
				resolver: {
					resolve: (specifier, from) => {
						if (remote(specifier)) return {external: specifier};
						const path = realpathSync(resolve(dirname(from), specifier));
						edges.set(from, (edges.get(from) ?? new Set()).add(path));
						return path;
					},
					read: (path) => {
						const text = readFileSync(path, "utf8");
						check(path, text);
						return text;
					},
				},
			}),
		catch: parseError,
	});
	if (cyclic(edges)) return yield* Effect.fail(new Error("stylesheet imports itself"));
	return result.code.toString();
});
