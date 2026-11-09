// One stylesheet with its local `@import`s inlined, parsed by lightningcss (a real CSS parser).
// lightningcss lists each `@import` and `url()` it finds with the URL already decoded, and drops the
// imports from the printed sheet; this file follows the local imports itself, so it stays sync.
// A window's stylesheet is served from the brain's table, which holds scripts and stylesheets only,
// so any other local file a stylesheet names stops the build instead of answering 404 later.
// It runs inside a Rolldown hook, outside Effect: it reads files directly, and a throw fails the bundle.
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

const parse = (file: string) => {
	try {
		return transform({
			filename: file,
			code: readFileSync(file),
			analyzeDependencies: true,
			errorRecovery: false,
			visitor: {
				Rule: {
					import(rule) {
						// `layer` and `supports()` would need their own wrapper; a media query is not one.
						if ((rule.value.layer ?? rule.value.supports ?? null) !== null)
							throw new Error(unsupported);
					},
				},
			},
		});
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
