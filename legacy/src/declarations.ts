import {access, readFile} from "node:fs/promises";
import {dirname, join, normalize} from "node:path";
import type {ApiChange} from "./surface";

// What a package publishes, read from the declaration files the compiler
// emits for it (`tsc --declaration --emitDeclarationOnly --removeComments`),
// one export-map entry at a time. Emitted files are regular: one statement
// per declaration, no comments, imports and re-exports spelled out. So a
// small reader follows them, with no compiler API (TypeScript 7 ships none):
// each published name gets its declaration text, plus the text of the
// unexported declarations in its file that it refers to, so a change to a
// private helper type still shows on the name that uses it.

/** What each export-map subpath publishes: every name, with its declaration text on one line. */
export type Surface = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The top-level statements of an emitted declaration file, each on one line. */
export function statementsOf(text: string): string[] {
	const statements: string[] = [];
	let depth = 0;
	let start = 0;
	let quote: string | null = null;
	const blockHead =
		/^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|class|namespace|module|enum|const\s+enum|global)\b/;
	const end = (at: number) => {
		const statement = text
			.slice(start, at + 1)
			.replace(/\s+/g, " ")
			.trim();
		if (statement !== "" && statement !== ";") statements.push(statement);
		start = at + 1;
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		if (quote !== null) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "{" || ch === "(" || ch === "[") depth++;
		else if (ch === "}" || ch === ")" || ch === "]") {
			depth--;
			if (depth === 0 && ch === "}" && blockHead.test(text.slice(start, i))) end(i);
		} else if (ch === ";" && depth === 0) end(i);
	}
	end(text.length - 1);
	return statements;
}

type Binding = {readonly name: string; readonly as: string};

/** `a, type b as c` read as bindings. */
const bindingsOf = (list: string): Binding[] =>
	list
		.split(",")
		.map((part) => part.trim().replace(/^type\s+/, ""))
		.filter((part) => part !== "")
		.map((part) => {
			const [name = part, as = name] = part.split(/\s+as\s+/);
			return {name, as};
		});

type Parsed =
	| {
			readonly kind: "decl";
			readonly name: string;
			readonly exported: boolean;
			readonly text: string;
	  }
	| {readonly kind: "from"; readonly from: string; readonly names: readonly Binding[] | "*"}
	| {readonly kind: "namespace_from"; readonly from: string; readonly as: string}
	| {readonly kind: "local"; readonly names: readonly Binding[]}
	| {readonly kind: "import"; readonly from: string; readonly names: readonly Binding[]}
	| {readonly kind: "other"};

const DECL =
	/^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const\s+enum|function|class|interface|type|namespace|module|enum|const|let|var)\s+([\w$]+)/;

function parse(statement: string): Parsed {
	let m = /^export \*(?: as ([\w$]+))? from ["']([^"']+)["']/.exec(statement);
	if (m !== null)
		return m[1] === undefined
			? {kind: "from", from: m[2] as string, names: "*"}
			: {kind: "namespace_from", from: m[2] as string, as: m[1]};
	m = /^export (?:type )?\{([^}]*)\}(?: from ["']([^"']+)["'])?/.exec(statement);
	if (m !== null)
		return m[2] === undefined
			? {kind: "local", names: bindingsOf(m[1] as string)}
			: {kind: "from", from: m[2], names: bindingsOf(m[1] as string)};
	m = /^export default ([\w$]+);?$/.exec(statement);
	if (m !== null) return {kind: "local", names: [{name: m[1] as string, as: "default"}]};
	m = /^import (?:type )?(.*?) from ["']([^"']+)["']/.exec(statement);
	if (m !== null) {
		const clause = m[1] as string;
		const star = /\* as ([\w$]+)/.exec(clause);
		const braces = /\{([^}]*)\}/.exec(clause);
		const first = /^([\w$]+)\s*(?:,|$)/.exec(clause);
		const names = [
			...(star === null ? [] : [{name: "*", as: star[1] as string}]),
			...(braces === null ? [] : bindingsOf(braces[1] as string)),
			...(first === null ? [] : [{name: "default", as: first[1] as string}]),
		];
		return {kind: "import", from: m[2] as string, names};
	}
	m = DECL.exec(statement);
	if (m !== null && m[2] !== "global") {
		// The name is what is compared, so `export`, `default` and `declare` are not part of its text.
		const text = statement
			.replace(/^export\s+/, "")
			.replace(/^default\s+/, "")
			.replace(/^declare\s+/, "");
		return {kind: "decl", name: m[2] as string, exported: m[1] !== undefined, text};
	}
	return {kind: "other"};
}

/**
 * Read the declaration files under one emit folder: what a file exports, by
 * name, following re-exports and imports the way the compiler does. A name
 * from another package is kept as where it comes from.
 */
function reader() {
	const cache = new Map<string, ReadonlyMap<string, string>>();
	// Files being read right now: a file reached again through its own re-exports adds nothing.
	const reading = new Set<string>();

	const resolve = async (from: string, specifier: string): Promise<string | null> => {
		if (!specifier.startsWith(".")) return null;
		const base = normalize(join(dirname(from), specifier)).replace(
			/\.(?:js|mjs|cjs|ts|mts|cts)$/,
			"",
		);
		for (const candidate of [`${base}.d.ts`, `${base}.d.mts`, join(base, "index.d.ts")]) {
			if (
				await access(candidate).then(
					() => true,
					() => false,
				)
			)
				return candidate;
		}
		return null;
	};

	/** One file at a time: `reading` is shared, so the caller awaits each before the next. */
	async function exportsOf(file: string): Promise<ReadonlyMap<string, string>> {
		const known = cache.get(file);
		if (known !== undefined) return known;
		if (reading.has(file)) return new Map();
		reading.add(file);
		try {
			const read = await readExports(file);
			cache.set(file, read);
			return read;
		} finally {
			reading.delete(file);
		}
	}

	async function readExports(file: string): Promise<ReadonlyMap<string, string>> {
		const parsed = statementsOf(await readFile(file, "utf8")).map(parse);
		const decls = new Map<string, string[]>();
		for (const p of parsed)
			if (p.kind === "decl") decls.set(p.name, [...(decls.get(p.name) ?? []), p.text]);
		const exportedHere = new Set(
			parsed.flatMap((p) => (p.kind === "decl" && p.exported ? [p.name] : [])),
		);
		const imports = new Map(
			parsed.flatMap((p) =>
				p.kind === "import"
					? p.names.map((b) => [b.as, {from: p.from, name: b.name}] as const)
					: [],
			),
		);

		/** A local declaration, with the unexported declarations of this file it refers to, each once. */
		const textOf = (name: string): string => {
			const seen = new Set([name]);
			const parts: string[] = [];
			const queue = [name];
			while (queue.length > 0) {
				const next = queue.shift() as string;
				const texts = decls.get(next) ?? [];
				parts.push(...texts);
				for (const id of new Set(texts.join(" ").match(/[A-Za-z_$][\w$]*/g) ?? [])) {
					if (!seen.has(id) && decls.has(id) && !exportedHere.has(id)) {
						seen.add(id);
						queue.push(id);
					}
				}
			}
			return parts.join(" ");
		};

		/** What `name`, bound in this file, stands for: its declaration here, or what the file it was imported from exports. */
		const bound = async (name: string): Promise<string | undefined> => {
			if (decls.has(name)) return textOf(name);
			const imported = imports.get(name);
			if (imported === undefined) return undefined;
			const target = await resolve(file, imported.from);
			if (target === null) return `from "${imported.from}": ${imported.name}`;
			if (imported.name === "*") return namespaceText(await exportsOf(target));
			return (await exportsOf(target)).get(imported.name);
		};

		const out = new Map<string, string>();
		const stars: ReadonlyMap<string, string>[] = [];
		for (const p of parsed) {
			if (p.kind === "decl" && p.exported) out.set(p.name, textOf(p.name));
			if (p.kind === "local") {
				for (const b of p.names) {
					const text = await bound(b.name);
					if (text !== undefined) out.set(b.as, text);
				}
			}
			if (p.kind === "from" || p.kind === "namespace_from") {
				const target = await resolve(file, p.from);
				const theirs = target === null ? null : await exportsOf(target);
				if (p.kind === "namespace_from")
					out.set(p.as, theirs === null ? `from "${p.from}": *` : namespaceText(theirs));
				else if (p.names === "*") {
					if (theirs !== null) stars.push(theirs);
				} else {
					for (const b of p.names) {
						const text = theirs === null ? `from "${p.from}": ${b.name}` : theirs.get(b.name);
						if (text !== undefined) out.set(b.as, text);
					}
				}
			}
		}
		// A name a file spells out wins over one an `export *` brings, as in the compiler; `default` never comes through a star.
		for (const theirs of stars) {
			for (const [name, text] of theirs)
				if (name !== "default" && !out.has(name)) out.set(name, text);
		}
		return out;
	}

	return {exportsOf};
}

/** A namespace's text: every name it holds, in order, so a change inside it shows on the namespace. */
const namespaceText = (exports: ReadonlyMap<string, string>): string =>
	`{ ${[...exports]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([n, t]) => `${n}: ${t}`)
		.join("; ")} }`;

/** The first path a condition object leads to, preferring `types`. */
function targetOf(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value !== "object" || value === null) return null;
	const conditions = value as Record<string, unknown>;
	for (const key of ["types", "import", "default", ...Object.keys(conditions)]) {
		const found = key in conditions ? targetOf(conditions[key]) : null;
		if (found !== null) return found;
	}
	return null;
}

/**
 * The export-map entries of a package, each with the declaration file it
 * publishes in `emitted`. The map points into the build's folder (`dist/x.d.ts`);
 * the emit folder holds the same tree from the source root, so the build folder
 * is dropped. A subpath with a wildcard, or with no file in the emit, is left out.
 */
export async function entriesOf(
	exportsField: unknown,
	emitted: string,
): Promise<readonly {readonly subpath: string; readonly file: string}[]> {
	const map =
		typeof exportsField === "string" ||
		(typeof exportsField === "object" &&
			exportsField !== null &&
			!Object.keys(exportsField).some((k) => k.startsWith(".")))
			? {".": exportsField}
			: ((exportsField ?? {}) as Record<string, unknown>);
	const entries: {subpath: string; file: string}[] = [];
	for (const [subpath, value] of Object.entries(map)) {
		const target = targetOf(value);
		if (subpath.includes("*") || target === null) continue;
		const stem = target.replace(/^\.\//, "").replace(/(?:\.d)?\.(?:js|mjs|cjs|ts|mts|cts)$/, "");
		const [, ...rest] = stem.split("/");
		for (const candidate of [rest.join("/"), stem, stem.replace(/^src\//, "")]) {
			const file = join(emitted, `${candidate}.d.ts`);
			if (
				candidate !== "" &&
				(await access(file).then(
					() => true,
					() => false,
				))
			) {
				entries.push({subpath, file});
				break;
			}
		}
	}
	return entries;
}

/** What each entry of a package publishes, read from its emit folder. */
export async function surfaceOf(exportsField: unknown, emitted: string): Promise<Surface> {
	const {exportsOf} = reader();
	const surface = new Map<string, ReadonlyMap<string, string>>();
	for (const e of await entriesOf(exportsField, emitted))
		surface.set(e.subpath, await exportsOf(e.file));
	return surface;
}

/**
 * Every name whose declaration differs between two surfaces, by subpath. The
 * same difference in several subpaths is one change that names them all.
 */
export function compareSurfaces(before: Surface, after: Surface): ApiChange[] {
	const changes = new Map<string, ApiChange>();
	for (const subpath of new Set([...before.keys(), ...after.keys()])) {
		const was = before.get(subpath) ?? new Map<string, string>();
		const now = after.get(subpath) ?? new Map<string, string>();
		for (const name of new Set([...was.keys(), ...now.keys()])) {
			const b = was.get(name) ?? null;
			const a = now.get(name) ?? null;
			if (b === a) continue;
			const kind = b === null ? "added" : a === null ? "removed" : "changed";
			const key = JSON.stringify([name, b, a]);
			const known = changes.get(key);
			changes.set(key, {
				name,
				kind,
				before: b,
				after: a,
				subpaths: [...(known?.subpaths ?? []), subpath],
			});
		}
	}
	return [...changes.values()].sort(
		(x, y) => x.name.localeCompare(y.name) || x.kind.localeCompare(y.kind),
	);
}
