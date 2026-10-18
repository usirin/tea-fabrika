import {posix} from "node:path";
import {z} from "zod";
import {RawIssue} from "./issue";

// The replay set (`replay/`): closed kamp-us/demlik issues, each with the
// report as filed and what its merged PR really changed. Here: the parts of a
// record triage is run from and scored against, and the pure rules that read it.

/** What a changed file is, by the replay README's table. */
export const FileKind = z.enum([
	"changeset",
	"type-test",
	"test",
	"generated",
	"docs",
	"src",
	"other",
]);
export type FileKind = z.infer<typeof FileKind>;

/** Where a fix lives: in the types, in what runs, in the docs, or more than one. */
export const Level = z.enum(["type", "runtime", "docs", "mixed"]);
export type Level = z.infer<typeof Level>;

/** One `replay/issues/<n>.json`, the fields triage is run from and scored against. */
export const ReplayIssue = z.object({
	number: z.number(),
	title: z.string(),
	labelsAtClose: z.object({type: z.string(), priority: z.string()}),
	useFor: z.array(z.enum(["triage", "lane"])),
	rawReport: z.string().nullable(),
	seed: z.object({from: z.string(), filedBy: z.enum(["agent", "human"])}),
	filesChanged: z.array(
		z.object({path: z.string(), additions: z.number(), deletions: z.number(), kind: FileKind}),
	),
	testsAdded: z.array(z.object({path: z.string(), status: z.string(), names: z.array(z.string())})),
	level: Level,
	preMonorepoLayout: z.boolean(),
	notes: z.array(z.string()),
	pr: z.object({number: z.number(), baseSha: z.string(), mergeSha: z.string()}),
});
export type ReplayIssue = z.infer<typeof ReplayIssue>;

/** One row of `replay/index.json`: it alone holds the commit the issue was filed on. */
export const ReplayRow = z.object({
	number: z.number(),
	shaAtFiling: z.string(),
	baseSha: z.string(),
});
export type ReplayRow = z.infer<typeof ReplayRow>;

export const ReplayIndex = z.object({source: z.string(), issues: z.array(ReplayRow)});

/**
 * What a file is, by its path, as the replay README sorts a PR's files. tea
 * is at the repo's root before the monorepo move, under `packages/tea` after.
 */
export function kindOf(path: string, preMonorepoLayout: boolean): FileKind {
	const tea = preMonorepoLayout ? "" : "packages/tea/";
	if (path.startsWith(".changeset/")) return "changeset";
	if (path.endsWith(".test-d.ts")) return "type-test";
	if (path.startsWith(`${tea}docs/reference/`)) return "generated";
	if (
		/\.test\.[^/]+$/.test(path) ||
		/(^|\/)(test|test-helpers|__tests__)\//.test(path) ||
		path.startsWith(`${tea}src/docs/`)
	) {
		return "test";
	}
	if (path.endsWith(".md") || /(^|\/)examples\//.test(path)) return "docs";
	if (preMonorepoLayout ? path.startsWith("src/") : /^packages\/[^/]+\/src\//.test(path))
		return "src";
	return "other";
}

/** The kinds a scorer leaves out: a changeset and a generated page are not where a fix lives. */
export const isScored = (kind: FileKind): boolean => kind !== "changeset" && kind !== "generated";

/**
 * Where tea's files were when an issue was filed. Two issues (#333, #339) were
 * filed before tea moved to `packages/tea` and fixed after: the report and
 * the clone have `src/...` at the root, the PR has `packages/tea/src/...`.
 * `teaAtRoot` says the clone has no `packages/` folder.
 */
export interface Filing {
	/** The PR's changed files that existed at the commit the issue was filed on, as the PR names them. */
	readonly files: ReadonlySet<string>;
	readonly teaAtRoot: boolean;
}

/** The prefix a path at filing needs to read as the PR's path: `packages/tea/` when only the PR is after the move. */
const moved = (replay: ReplayIssue, teaAtRoot: boolean) =>
	teaAtRoot && !replay.preMonorepoLayout ? "packages/tea/" : "";

/** A path as the clone at filing has it, read the way the PR names it. */
export const toPrPath = (path: string, replay: ReplayIssue, teaAtRoot: boolean): string =>
	`${moved(replay, teaAtRoot)}${path.replace(/^\.\//, "")}`;

/** A path as the PR names it, read the way the clone at filing has it. */
export function toFilingPath(path: string, replay: ReplayIssue, teaAtRoot: boolean): string {
	const prefix = moved(replay, teaAtRoot);
	return prefix !== "" && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The package a replay's issue tests are written in: the one the PR changed
 * most files of, leaving out changesets and generated pages. A tie goes to the
 * package the report names more often, then to the first by name. Before the
 * monorepo move, tea is the repo itself ("."): `teaAtRoot` says the clone at
 * filing is from before it, whatever the PR's paths say.
 */
export function packageOf(replay: ReplayIssue, teaAtRoot = replay.preMonorepoLayout): string {
	if (replay.preMonorepoLayout || teaAtRoot) return ".";
	const counts = new Map<string, number>();
	for (const f of replay.filesChanged) {
		const match = /^packages\/([^/]+)\//.exec(f.path);
		if (match?.[1] === undefined || !isScored(f.kind)) continue;
		counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
	}
	const report = replay.rawReport ?? "";
	const mentions = (name: string) => report.split(name).length - 1;
	const [first] = [...counts.entries()].sort(
		([a, n], [b, m]) => m - n || mentions(b) - mentions(a) || a.localeCompare(b),
	);
	if (first === undefined) throw new Error(`#${replay.number} changes no file under packages/`);
	return `packages/${first[0]}`;
}

/**
 * Where the issue's tests go in its package: `test/` when the package keeps
 * its tests there (structure-sweep's vitest runs only `test/**`), else `src/`.
 */
export const testsFileFor = (id: string, hasTestDir: boolean): string =>
	posix.join(hasTestDir ? "test" : "src", `fabrika-${id}.test.ts`);

/**
 * The paths a Claude Code conversation's tools reached outside `root`, read
 * off its transcript (one JSON event per line): a Read's `file_path`, a Glob's
 * or Grep's `path`, and a Glob pattern that starts at `/` or `~`. A relative
 * path is inside the folder the agent ran in. A replay's clone holds only the
 * history up to the filing; anything outside it may hold the answer.
 */
export function pathsOutside(transcript: string, root: string): string[] {
	const inside = (p: string) => p === root || p.startsWith(`${root}/`);
	const outside = new Set<string>();
	for (const line of transcript.split("\n")) {
		if (line.trim() === "") continue;
		const event = JSON.parse(line) as {readonly message?: {readonly content?: unknown}};
		const content = event.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content as readonly {
			readonly type?: string;
			readonly input?: Record<string, unknown>;
		}[]) {
			if (block.type !== "tool_use" || block.input === undefined) continue;
			const {file_path, path, pattern} = block.input;
			for (const p of [file_path, path, pattern]) {
				if (typeof p !== "string" || !(p.startsWith("/") || p.startsWith("~"))) continue;
				if (!inside(p)) outside.add(p);
			}
		}
	}
	return [...outside].sort();
}

/**
 * The ticket triage starts from: the report as filed, and who filed it, as
 * `rawIssueFrom` would have built it from GitHub. Refused for an issue kept
 * for the lane only: its body is already triaged, so seeding from it hands
 * triage the answer.
 */
export function rawIssueOf(replay: ReplayIssue): RawIssue {
	if (!replay.useFor.includes("triage") || replay.rawReport === null) {
		throw new Error(
			`#${replay.number} is not for replaying triage: its report as filed is not kept`,
		);
	}
	return RawIssue.parse({
		id: String(replay.number),
		title: replay.title,
		body: replay.rawReport,
		filedBy: replay.seed.filedBy,
	});
}
