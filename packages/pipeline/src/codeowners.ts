// A repo's `.github/CODEOWNERS`, read as the list of protected files and who
// owns them. This is where today's fabrika reads the same thing from: a
// changed path a row covers needs an owner's approval, and the owners are
// whoever the rows name. Nothing here is a setting or a name written in code.
//
// The matching follows GitHub's own: the last row that covers a path decides
// its owners, a row with no owner takes them away, and any listed owner's
// approval is enough.

import {outcomesOf} from "./stages/outcome.ts";

export interface OwnerRow {
	readonly pattern: string;
	/** `@login` or `@org/team`, as written. */
	readonly owners: readonly string[];
}

/** The rows of a CODEOWNERS file, comments and blank lines left out. */
export function parseCodeowners(text: string): readonly OwnerRow[] {
	return text.split("\n").flatMap((raw) => {
		const [pattern, ...owners] = raw.replace(/#.*$/, "").trim().split(/\s+/);
		return pattern === undefined || pattern === "" ? [] : [{pattern, owners}];
	});
}

const segment = (text: string) =>
	text
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]");

/** A row's pattern as a test on a repo-relative path. */
export function matcherFor(pattern: string): RegExp {
	const directory = pattern.endsWith("/");
	const anchored = pattern.startsWith("/");
	const body = pattern.slice(anchored ? 1 : 0, directory ? -1 : undefined);
	const segments = body.split("/");
	const last = segments.at(-1) ?? "";
	// `**` stands for any number of folders, none included.
	const middle = segments
		.map((s) => (s === "**" ? "\u0000" : segment(s)))
		.join("/")
		.split("\u0000/")
		.join("(?:.*/)?")
		.split("\u0000")
		.join(".*");
	// A pattern with no slash in it matches at any depth.
	const prefix = anchored || body.includes("/") ? "^" : "^(?:.*/)?";
	// A folder covers what is under it. A name with a wildcard is one file; a plain name is the file or the folder.
	const suffix = directory ? "/.*$" : last.includes("*") || last.includes("?") ? "$" : "(?:/.*)?$";
	return new RegExp(`${prefix}${middle}${suffix}`);
}

/** Who owns a path: the last row that covers it. Empty: nobody. */
export function ownersOf(rows: readonly OwnerRow[], path: string): readonly string[] {
	let owners: readonly string[] = [];
	for (const row of rows) if (matcherFor(row.pattern).test(path)) owners = row.owners;
	return owners;
}

// ---------------------------------------------------------------- guarded files
//
// The same rows say which files are the exam (docs/direction/nobody-writes-their-own-exam.md):
// a change that touches one is the owner's to decide, never a builder's. The
// rows may come from `.github/CODEOWNERS` or from any other list of the same shape.

/** The changed paths a row covers with at least one owner: each needs an owner's approval. */
export const guarded = (rows: readonly OwnerRow[], paths: readonly string[]): readonly string[] =>
	paths.filter((path) => ownersOf(rows, path).length > 0);

const exam = outcomesOf({
	done: {},
	send: {},
	ask: {owner: ["check_change"]},
	skip: [],
	stuck: [],
});

/** A stage that touched the exam ends here: the owner is asked, with the files. Never none. */
export type CheckChange = Extract<typeof exam.schema.Type, {readonly kind: "ask"}> & {
	readonly files: readonly [string, ...string[]];
};

/** The guarded paths as the ask a stage ends on. `null`: none are guarded, so nothing to ask. */
export function checkChange(files: readonly string[]): CheckChange | null {
	const [first, ...rest] = files;
	return first === undefined
		? null
		: {kind: "ask", who: "owner", for: "check_change", files: [first, ...rest]};
}

/** Every owner the file names, each once: the people any one of whom may approve. */
export const everyOwner = (rows: readonly OwnerRow[]): readonly string[] => [
	...new Set(rows.flatMap((row) => row.owners)),
];

/** `@org/team` as its two parts. `null`: the owner is one account. */
export function teamOf(owner: string): {readonly org: string; readonly team: string} | null {
	const m = /^@([^/\s]+)\/([^/\s]+)$/.exec(owner);
	return m === null ? null : {org: m[1] as string, team: m[2] as string};
}
