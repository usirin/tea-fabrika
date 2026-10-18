import {Option, Schema} from "effect";

// The names a user of a repo's packages meets: what a criterion may name.
//
// A name is a user's when a published package shows it to them: the
// package's own name, its subpaths, its commands, and every name in code in
// its published docs (the README and the docs folder). That is where a user
// meets a CLI flag, a config key, an export, an environment variable or a
// file they write. A private function, an internal type or a source path
// shows up in none of them, so the plan's Check still sends it back.
//
//   userNames([{manifest: {name: "@acme/gate", bin: {gate: "./cli.js"}, exports: {".": "./i.js", "./rules": "./r.js"}},
//               docs: ["Run `gate --strict` with a `rules.json` that sets `decidedBy`."]}])
//   // ["--strict", "@acme/gate", "@acme/gate/rules", "decidedBy", "gate", "rules", "rules.json", "json"]  (in some order)
//
// Pure: the files are read by whoever gathers facts.

/** One package as its users meet it: its manifest, and the text of its published docs. */
export interface Published {
	/** The parsed package.json. */
	readonly manifest: unknown;
	/** Each published doc page's markdown. */
	readonly docs: readonly string[];
}

const Manifest = Schema.Struct({
	name: Schema.String,
	private: Schema.optional(Schema.Boolean),
	bin: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
	exports: Schema.optional(Schema.Unknown),
});

/** The names a manifest publishes: the package, its subpaths, its commands. None for a private package. */
function manifestNames(manifest: unknown): readonly string[] {
	const read = Schema.decodeUnknownOption(Manifest)(manifest);
	if (Option.isNone(read) || read.value.private === true) return [];
	const {name, bin, exports} = read.value;
	const commands =
		bin === undefined
			? []
			: typeof bin === "string"
				? [name.replace(/^@[^/]+\//, "")]
				: Object.keys(bin);
	const subpaths =
		exports !== null && typeof exports === "object"
			? Object.keys(exports)
					.filter((key) => key.startsWith("./"))
					.map((key) => `${name}${key.slice(1)}`)
			: [];
	return [name, ...commands, ...subpaths];
}

/** Every piece of code in a markdown page: fenced blocks and inline spans. */
function codeIn(markdown: string): readonly string[] {
	const fences = [...markdown.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1/gm)].map(
		(m) => m[2] ?? "",
	);
	const prose = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1/gm, " ");
	const spans = [...prose.matchAll(/(`+)([^`]+?)\1/g)].map((m) => m[2] ?? "");
	return [...fences, ...spans];
}

/** The names in one piece of code: whole tokens (`@acme/gate/rules`, `rules.json`, `--strict`) and the identifiers inside them. */
function namesInCode(code: string): readonly string[] {
	// Dots and slashes at either end are punctuation or a path's edge, not part of the name.
	const tokens = (code.match(/[@\w$./*-]+/g) ?? []).map((t) => t.replace(/^[./]+|[./]+$/g, ""));
	const words = code.match(/[A-Za-z_$][\w$]*/g) ?? [];
	return [...tokens, ...words].filter((t) => /[A-Za-z0-9]/.test(t));
}

/** The names a user meets, over every published package. Sorted, each once. */
export function userNames(packages: readonly Published[]): readonly string[] {
	const names = new Set<string>();
	for (const pkg of packages) {
		const published = manifestNames(pkg.manifest);
		if (published.length === 0) continue;
		for (const name of published) names.add(name);
		for (const page of pkg.docs)
			for (const code of codeIn(page)) for (const n of namesInCode(code)) names.add(n);
	}
	return [...names].sort();
}
