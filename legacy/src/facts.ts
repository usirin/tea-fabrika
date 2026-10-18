import {Cmd} from "@demlik/tea";
import {z} from "zod";
import {stem} from "./imports";

// Facts: what the code says about the names and paths a report mentions, found
// by code, never guessed. Triage gathers them before the enricher writes, so
// the enricher starts from where `replay` is defined and what it takes instead
// of digging for it. Everything here is pure; the layer that reads a repo is
// `src/code-facts.ts`.

/** What a report points at: names in backticks, file paths, and issue refs. */
export const Mentions = z.object({
	names: z.array(z.string()).readonly(),
	paths: z.array(z.string()).readonly(),
	/** `#N` refs, as written. Kept, not read: reading another issue is the tracker's. */
	refs: z.array(z.string()).readonly(),
});
export type Mentions = z.infer<typeof Mentions>;

/** Words a report puts in backticks that name no code of the repo's own. */
const NOT_CODE = new Set([
	"true",
	"false",
	"null",
	"undefined",
	"void",
	"never",
	"unknown",
	"any",
	"object",
	"string",
	"number",
	"boolean",
	"bigint",
	"symbol",
	"this",
	"new",
	"return",
	"const",
	"let",
	"var",
	"function",
	"class",
	"type",
	"interface",
	"import",
	"export",
	"default",
	"async",
	"await",
	"yield",
	"if",
	"else",
	"for",
	"while",
	"switch",
	"case",
	"break",
	"continue",
	"throw",
	"try",
	"catch",
	"finally",
	"typeof",
	"instanceof",
	"in",
	"of",
	"extends",
	"implements",
	"keyof",
	"readonly",
	"as",
	"is",
	"NaN",
	"Infinity",
]);

/** The extensions a mentioned file may have, so `machine.init` is not read as a file. */
const FILE_EXTENSIONS = new Set([
	"ts",
	"tsx",
	"mts",
	"cts",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"jsonc",
	"md",
	"mdx",
	"yaml",
	"yml",
	"toml",
	"css",
	"html",
	"sh",
	"txt",
	"sql",
]);

/** A span that is one path: no spaces, path-like segments, a known extension or a trailing slash. */
function asPath(span: string): string | null {
	const bare = span.replace(/:\d+(?::\d+)?$/, "").replace(/^\.\//, "");
	if (!/^[\w@.$/-]+$/.test(bare) || bare.includes("//")) return null;
	const last =
		bare
			.split("/")
			.filter((s) => s !== "")
			.at(-1) ?? "";
	const dot = last.lastIndexOf(".");
	const known = dot > 0 && FILE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
	if (known) return bare;
	return bare.includes("/") && bare.endsWith("/") ? bare : null;
}

/** The identifier a span names: `replay`, `CtxArg<Ctx>` and `replay(m, {})` all name their head. */
function asName(span: string): string | null {
	const head = /^([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?(?:\([\s\S]*\))?$/.exec(span)?.[1];
	if (head === undefined || head.length < 2 || NOT_CODE.has(head)) return null;
	return head;
}

const unique = (items: readonly string[]) => [...new Set(items)];

/**
 * What a report points at, in the order it says it. A backticked span is a
 * path when it looks like one, otherwise a name when it is one identifier
 * (a generic or a call names its head). A path outside backticks counts too;
 * a URL does not. Keywords, literals and one-letter names are left out.
 */
export function mentionsOf(text: string): Mentions {
	const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] ?? "").trim());
	const outside = text.replace(/`[^`\n]*`/g, " ").replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
	const barePaths = [
		...outside.matchAll(/(?:^|[\s(["'])((?:[\w@.-]+\/)+[\w@.-]+)(?=$|[\s)\]"',.:;!?])/gm),
	].map((m) => m[1] ?? "");
	const paths: string[] = [];
	const names: string[] = [];
	for (const span of spans) {
		const path = asPath(span);
		if (path !== null) paths.push(path);
		else {
			const name = asName(span);
			if (name !== null) names.push(name);
		}
	}
	for (const candidate of barePaths) {
		const path = asPath(candidate);
		if (path !== null) paths.push(path);
	}
	const refs = [...outside.matchAll(/(?:^|[^\w/&#])#(\d+)\b/g)].map((m) => `#${m[1]}`);
	return {names: unique(names), paths: unique(paths), refs: unique(refs)};
}

/** Whether a report mentions anything the code can be asked about. Refs alone are not. */
export const asksTheCode = (m: Mentions): boolean => m.names.length > 0 || m.paths.length > 0;

/** Where a mentioned name is declared. */
export const Definition = z.object({
	/** Relative to the repo root. */
	file: z.string(),
	line: z.number(),
	exported: z.boolean(),
	/** The declaration up to its body, on one line, cut short when long. */
	signature: z.string(),
	/** The `name` of the package the file is in, or `null` when no package.json holds it. */
	package: z.string().nullable(),
	/**
	 * The package's export subpaths that publish this very declaration, each with
	 * its tier when the package keeps a tier table. Empty: exported from its file
	 * and published by none. `null`: not checked (not exported, or no package).
	 */
	published: z
		.array(z.object({subpath: z.string(), tier: z.string().nullable()}))
		.readonly()
		.nullable(),
	/**
	 * Who calls it, as `file:line` of each call, a few of them, and how many in
	 * all. `null` when the call graph does not hold it: a type, or a package the
	 * graph could not be built for.
	 */
	callers: z.object({total: z.number(), sample: z.array(z.string()).readonly()}).nullable(),
});
export type Definition = z.infer<typeof Definition>;

/**
 * One mentioned name. No definitions and nothing `more`: nothing at HEAD
 * declares it, often a sign of a stale report. No definitions and some `more`:
 * nothing exports it, and it is declared locally in many places, a common
 * variable name rather than one thing.
 */
export const NameFact = z.object({
	name: z.string(),
	/**
	 * The doc page whose code blocks call it, when the report does not name it
	 * itself; `null` when the report does.
	 */
	calledIn: z.string().nullable(),
	definitions: z.array(Definition).readonly(),
	/** Declarations found beyond the ones kept. */
	more: z.number(),
	/** How many files at HEAD hold the word at all. */
	mentionedIn: z.number(),
});
export type NameFact = z.infer<typeof NameFact>;

/** One mentioned path. `near` are files at HEAD it may have meant: the same path deeper down, or the same file name. */
export const PathFact = z.object({
	path: z.string(),
	exists: z.boolean(),
	near: z.array(z.string()).readonly(),
});
export type PathFact = z.infer<typeof PathFact>;

/**
 * One doc page a mentioned path is. Its `twins` are the tests that name the
 * page's path: they run or typecheck the code the page shows, so a rule about
 * the page is checked through them. The names its code blocks call are in the
 * pack's names, with `calledIn` set to the page.
 */
export const PageFact = z.object({
	/** Relative to the repo root. */
	page: z.string(),
	twins: z.array(z.string()).readonly(),
	/** Twins found beyond the ones kept. */
	more: z.number(),
});
export type PageFact = z.infer<typeof PageFact>;

/** Everything code found, in the order the report mentions it. Small: it goes into a prompt. */
export const FactsPack = z.object({
	names: z.array(NameFact).readonly(),
	paths: z.array(PathFact).readonly(),
	pages: z.array(PageFact).readonly(),
	refs: z.array(z.string()).readonly(),
});
export type FactsPack = z.infer<typeof FactsPack>;

/** The pack for a report that names nothing the code can be asked about. */
export const nothingToAsk = (m: Mentions): FactsPack => ({
	names: [],
	paths: [],
	pages: [],
	refs: m.refs,
});

/** Ask the code about what a report mentions. A failure only means the enricher reads the code itself. */
export const gatherFacts = Cmd.define("gather_facts", {
	input: z.object({mentions: Mentions}),
	ok: FactsPack,
	err: ["facts_failed"],
});

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether one line of code declares `name`: a function, a class, a variable,
 * a type, an interface, an enum or a namespace, exported or not. A method or
 * a property is not a declaration here.
 */
export function declares(line: string, name: string): {readonly exported: boolean} | null {
	const pattern = new RegExp(
		`^\\s*(export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:abstract\\s+)?` +
			`(?:function\\s*\\*?\\s*|(?:const|let|var|class|type|interface|enum|namespace)\\s+)${literal(name)}(?![\\w$])`,
	);
	const match = pattern.exec(line);
	return match === null ? null : {exported: match[1] !== undefined};
}

/**
 * The declaration that starts at `line` (counted from 1), up to its body, on
 * one line. A `{` opens the body when it follows a `)`, a `}`, a `]`, a `>`
 * or a name outside every bracket and type parameter list: `): {` is a return
 * type, `) {` a body, `=> {` an arrow's body. A type alias or a variable runs
 * to its `;`. Comments are dropped, and a long one is cut at `max` characters.
 */
export function signatureAt(text: string, line: number, max = 320): string {
	const lines = text.split("\n").slice(line - 1, line + 39);
	let out = "";
	let depth = 0;
	// Type parameters, kept apart: `<M extends { type: string }>` opens no body.
	let angles = 0;
	let last = "";
	let inBlock = false;
	scan: for (const raw of lines) {
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i] ?? "";
			const pair = raw.slice(i, i + 2);
			if (inBlock) {
				if (pair === "*/") {
					inBlock = false;
					i++;
				}
				continue;
			}
			if (pair === "/*") {
				inBlock = true;
				i++;
				continue;
			}
			if (pair === "//") break;
			if (ch === "{" && depth === 0 && angles <= 0 && /[)\]}>\w$]/.test(last)) break scan;
			if ("([{".includes(ch)) depth++;
			if (")]}".includes(ch)) depth--;
			if (ch === "<") angles++;
			if (ch === ">" && raw[i - 1] !== "=") angles--;
			out += ch;
			if (ch === ";" && depth <= 0) break scan;
			if (!/\s/.test(ch)) last = ch;
		}
		out += " ";
	}
	const flat = out
		.replace(/\s+/g, " ")
		.replace(/([([{<]) /g, "$1")
		.replace(/ ([)\]}>])/g, "$1")
		.replace(/,([)\]}>])/g, "$1")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Files whose declarations count: code, typed or not. */
export const CODE = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
/** Tests and fixtures: a declaration there is less likely the one meant, and a page's twin is one. */
export const isTest = (file: string) =>
	/(?:\.(?:test|spec)\.|(?:^|\/)__tests__\/|(?:^|\/)__fixtures__\/|(?:^|\/)fixtures?\/|(?:^|\/)tests?\/)/.test(
		file,
	);

/** A doc page: Markdown, whose fenced code may be someone's test. */
export const isDocPage = (path: string): boolean => /\.mdx?$/i.test(path);

/**
 * The doc pages HEAD holds for the mentioned paths: a page at HEAD as it is,
 * and a page not at HEAD as the same path deeper down, the way `near` found it.
 * A file of the same name elsewhere is not taken: `index.md` is everywhere.
 */
export function pagesOf(paths: readonly PathFact[]): readonly string[] {
	return unique(
		paths.flatMap((p) => {
			const bare = p.path.replace(/^\.\//, "");
			if (!isDocPage(bare)) return [];
			return p.exists ? [bare] : p.near.filter((f) => f.endsWith(`/${bare}`));
		}),
	);
}

/** The body of every fenced ts or tsx block on a page, in page order. */
export function codeBlocksOf(markdown: string): readonly string[] {
	const fence =
		/^[ \t]*(`{3,}|~{3,})[ \t]*(?:ts|tsx|typescript|mts|cts)(?![\w-])[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
	return [...markdown.matchAll(fence)].map((m) => m[2] ?? "");
}

/**
 * The names some code takes from elsewhere, in the order it first uses them:
 * every name it imports by name (`a as b` is `a`, the exported one), and every
 * bare call of a name it does not declare itself. A method call is not one.
 */
export function namesCalledIn(code: string): readonly string[] {
	const imported = [
		...code.matchAll(
			/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'][^"'\n]+["']/g,
		),
	].flatMap((m) =>
		(m[1] ?? "").split(",").flatMap((spec) => {
			const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/.exec(spec);
			return named?.[1] === undefined
				? []
				: [{at: m.index, name: named[1], local: named[2] ?? named[1]}];
		}),
	);
	// What the code declares itself, imports under their own names included.
	const declared = new Set([
		...[
			...code.matchAll(/(?:function\s*\*?\s*|(?:const|let|var|class)\s+)([A-Za-z_$][\w$]*)/g),
		].map((m) => m[1] ?? ""),
		...imported.map((i) => i.local),
	]);
	const called = [...code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/g)]
		.map((m) => ({at: m.index, name: m[1] ?? ""}))
		.filter((c) => !declared.has(c.name));
	return unique(
		[...imported, ...called]
			.sort((a, b) => a.at - b.at)
			.map((c) => c.name)
			.filter((name) => name.length >= 2 && !NOT_CODE.has(name)),
	);
}

/**
 * Whether a text names `path` as a path of its own: right after a quote, a
 * backtick, a space, a bracket or a `./`, so `../../docs/a.md` names
 * `docs/a.md` and `other/docs/a.md` does not.
 */
export function namesPath(text: string, path: string): boolean {
	return new RegExp(`(?:^|[\\s"'\`(\\[<{,=:]|\\./)${literal(path)}(?![\\w-])`).test(text);
}

/** A file's path inside the package in `pkgDir`: `packages/a/docs/x.md` is `docs/x.md` in `packages/a`. */
export const pathInPackage = (file: string, pkgDir: string | null): string =>
	pkgDir === null || pkgDir === "" ? file : file.slice(pkgDir.length + 1);

/**
 * A page's twins among the lines that hold its path: the tests that name it.
 * Inside its package a page goes by its package-relative path (`docs/a.md`),
 * the way a package's own tests write it; anywhere, by its path from the repo
 * root. Tests named like the page come first.
 */
export function twinsOf(
	page: string,
	pkgDir: string | null,
	lines: readonly {readonly file: string; readonly text: string}[],
): readonly string[] {
	const local = pathInPackage(page, pkgDir);
	const inPackage = (file: string) =>
		pkgDir === null || pkgDir === "" || file.startsWith(`${pkgDir}/`);
	const twins = lines
		.filter((l) => CODE.test(l.file) && isTest(l.file))
		.filter((l) => namesPath(l.text, page) || (inPackage(l.file) && namesPath(l.text, local)))
		.map((l) => l.file);
	return unique(twins).sort(
		(a, b) => Number(stem(b) === stem(page)) - Number(stem(a) === stem(page)) || a.localeCompare(b),
	);
}

const quote = (subpath: string) => JSON.stringify(subpath);

function definitionLine(d: Definition): string {
	const where = `${d.file}:${d.line}`;
	const from = d.package === null ? "" : `, in ${d.package}`;
	const published =
		d.published === null
			? ""
			: d.published.length === 0
				? ", published by none of its package's exports"
				: `, published as ${d.published.map((p) => (p.tier === null ? quote(p.subpath) : `${quote(p.subpath)} (${p.tier})`)).join(", ")}`;
	return `${where}, ${d.exported ? "exported" : "not exported"}${from}${published}`;
}

function callersLine(d: Definition): string {
	if (d.callers === null)
		return "callers: not in the call graph (a type, or a package it could not be built for)";
	if (d.callers.total === 0) return "callers: none found";
	const rest = d.callers.total - d.callers.sample.length;
	return `callers: ${d.callers.total}, e.g. ${d.callers.sample.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

/**
 * The pack as the enricher reads it: one short block per name, one line per
 * path and per doc page. It says what code found and nothing more.
 */
export function factsBrief(pack: FactsPack): string {
	const names = pack.names.flatMap((n) => {
		const name =
			n.calledIn === null
				? `\`${n.name}\``
				: `\`${n.name}\` (not in the report; a code block of \`${n.calledIn}\` calls it)`;
		if (n.definitions.length === 0) {
			return [
				n.more === 0
					? `- ${name}: nothing at HEAD declares it; the word is in ${n.mentionedIn} file(s)`
					: `- ${name}: nothing exports it; declared locally in ${n.more} places, a common local name; the word is in ${n.mentionedIn} file(s)`,
			];
		}
		const more = n.more > 0 ? ` (${n.more} more declarations left out)` : "";
		return n.definitions.flatMap((d, i) => [
			`- ${name}${i === 0 ? more : ""}: ${definitionLine(d)}`,
			`    ${d.signature}`,
			`    ${callersLine(d)}`,
		]);
	});
	const paths = pack.paths.map((p) =>
		p.exists
			? `- \`${p.path}\`: exists`
			: `- \`${p.path}\`: not at HEAD${p.near.length === 0 ? "" : `; maybe ${p.near.map((f) => `\`${f}\``).join(", ")}`}`,
	);
	const pages = pack.pages.map((p) =>
		p.twins.length === 0
			? `- doc page \`${p.page}\`: no test names it`
			: `- doc page \`${p.page}\`: twin(s), tests that name it and run or typecheck its code: ${p.twins.map((f) => `\`${f}\``).join(", ")}${p.more > 0 ? `, and ${p.more} more` : ""}`,
	);
	const refs =
		pack.refs.length === 0 ? [] : [`- also referenced: ${pack.refs.join(", ")} (not read)`];
	const lines = [...names, ...paths, ...pages, ...refs];
	return lines.length === 0 ? "The report names no code, path or file." : lines.join("\n");
}
