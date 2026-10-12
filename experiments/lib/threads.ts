// The comments on a pull request or an issue, read once from GitHub and kept
// on disk. Read-only: one GraphQL query for a handful of numbers, nothing is
// ever written to GitHub. A number already in the cache is never asked again.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

export interface ThreadComment {
	readonly id: number;
	readonly url: string;
	readonly at: string;
	readonly editedAt: string | null;
	/** The account that posted it, and whether GitHub calls it a bot. Never written to a result file. */
	readonly author: string;
	readonly bot: boolean;
	readonly body: string;
}
export interface ThreadReview {
	readonly url: string;
	readonly state: string;
	readonly at: string | null;
	readonly author: string;
	readonly bot: boolean;
	readonly body: string;
}
export interface Thread {
	readonly number: number;
	readonly kind: "pull" | "issue";
	readonly title: string;
	readonly state: string;
	readonly merged: boolean;
	readonly createdAt: string;
	readonly closedAt: string | null;
	readonly body: string;
	readonly additions: number | null;
	readonly deletions: number | null;
	readonly changedFiles: number | null;
	/** The first 100 changed paths of a pull request. */
	readonly files: readonly string[];
	readonly comments: readonly ThreadComment[];
	readonly reviews: readonly ThreadReview[];
}

const COMMENTS =
	"pageInfo { hasNextPage endCursor } nodes { databaseId url createdAt lastEditedAt author { login __typename } body }";
const FIELDS = `
  __typename
  ... on PullRequest {
    number title state merged createdAt closedAt body additions deletions changedFiles
    files(first: 100) { nodes { path } }
    comments(first: 100) { ${COMMENTS} }
    reviews(first: 50) { nodes { url state submittedAt author { login __typename } body } }
  }
  ... on Issue {
    number title state createdAt closedAt body
    comments(first: 100) { ${COMMENTS} }
  }`;

function gh(args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 400)}`)),
		);
	});
}

interface RawComment {
	databaseId: number;
	url: string;
	createdAt: string;
	lastEditedAt: string | null;
	author: {login: string; __typename: string} | null;
	body: string;
}
const comment = (c: RawComment): ThreadComment => ({
	id: c.databaseId,
	url: c.url,
	at: c.createdAt,
	editedAt: c.lastEditedAt,
	author: c.author?.login ?? "",
	bot: c.author?.__typename === "Bot",
	body: c.body,
});

async function graphql(query: string): Promise<Record<string, unknown>> {
	const out = JSON.parse(await gh(["api", "graphql", "-f", `query=${query}`])) as {
		data?: Record<string, unknown>;
	};
	if (out.data === undefined) throw new Error("GitHub answered with no data");
	return out.data;
}

/** The comments past the first hundred. */
async function restOf(
	repo: string,
	number: number,
	kind: "pull" | "issue",
	cursor: string,
): Promise<ThreadComment[]> {
	const [owner, name] = repo.split("/");
	const out: ThreadComment[] = [];
	let after: string | null = cursor;
	while (after !== null) {
		const field = kind === "pull" ? "pullRequest" : "issue";
		const data = await graphql(
			`{ repository(owner: "${owner}", name: "${name}") { t: ${field}(number: ${number}) { comments(first: 100, after: "${after}") { ${COMMENTS} } } } }`,
		);
		const page = (
			(data.repository as Record<string, unknown>).t as {
				comments: {pageInfo: {hasNextPage: boolean; endCursor: string}; nodes: RawComment[]};
			}
		).comments;
		out.push(...page.nodes.map(comment));
		after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
	}
	return out;
}

/** One text a comment has held, and when it was given that text. */
export interface Version {
	readonly at: string;
	readonly body: string;
}
const editsFile = (cache: string, number: number) => join(cache, `edits-${number}.json`);

/** Every text each edited comment of a thread has held, oldest first, by comment id. `null` when never fetched. */
export function readEdits(
	cache: string,
	number: number,
): Readonly<Record<string, readonly Version[]>> | null {
	const file = editsFile(cache, number);
	return existsSync(file)
		? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Version[]>)
		: null;
}

/**
 * GitHub keeps what an edited comment said before. Fetch that for the edited
 * comments of these threads, so a verdict that a later one overwrote can
 * still be read. Returns how many queries it made.
 */
export async function fetchEdits(
	repo: string,
	numbers: readonly number[],
	cache: string,
	batch = 6,
): Promise<number> {
	const [owner, name] = repo.split("/");
	const todo = [...new Set(numbers)].filter((n) => !existsSync(editsFile(cache, n)));
	let queries = 0;
	const fields = (after: string | null) =>
		`comments(first: 100${after === null ? "" : `, after: "${after}"`}) { pageInfo { hasNextPage endCursor } nodes { databaseId lastEditedAt userContentEdits(first: 30) { nodes { editedAt diff } } } }`;
	type Page = {
		pageInfo: {hasNextPage: boolean; endCursor: string};
		nodes: {
			databaseId: number;
			lastEditedAt: string | null;
			userContentEdits: {nodes: {editedAt: string; diff: string | null}[]} | null;
		}[];
	};
	const keep = (into: Record<string, Version[]>, page: Page) => {
		for (const c of page.nodes) {
			if (c.lastEditedAt === null) continue;
			const versions = (c.userContentEdits?.nodes ?? []).flatMap((e) =>
				e.diff === null ? [] : [{at: e.editedAt, body: e.diff}],
			);
			into[String(c.databaseId)] = versions.reverse();
		}
	};
	for (let i = 0; i < todo.length; i += batch) {
		const slice = todo.slice(i, i + batch);
		const body = slice
			.map(
				(n) =>
					`n${n}: issueOrPullRequest(number: ${n}) { ... on PullRequest { ${fields(null)} } ... on Issue { ${fields(null)} } }`,
			)
			.join("\n");
		const data = (await graphql(`{ repository(owner: "${owner}", name: "${name}") { ${body} } }`))
			.repository as Record<string, {comments: Page} | null>;
		queries += 1;
		for (const n of slice) {
			const edits: Record<string, Version[]> = {};
			let page = data[`n${n}`]?.comments ?? null;
			while (page !== null) {
				keep(edits, page);
				if (!page.pageInfo.hasNextPage) break;
				const more = (
					await graphql(
						`{ repository(owner: "${owner}", name: "${name}") { t: issueOrPullRequest(number: ${n}) { ... on PullRequest { ${fields(page.pageInfo.endCursor)} } ... on Issue { ${fields(page.pageInfo.endCursor)} } } } }`,
					)
				).repository as {t: {comments: Page} | null};
				queries += 1;
				page = more.t?.comments ?? null;
			}
			writeFileSync(editsFile(cache, n), JSON.stringify(edits));
		}
	}
	return queries;
}

/** The pull requests GitHub says closed each issue, for lanes whose log names none. Cached as one file. */
export async function fetchClosers(
	repo: string,
	issues: readonly number[],
	cache: string,
): Promise<Readonly<Record<string, readonly number[]>>> {
	mkdirSync(cache, {recursive: true});
	const file = join(cache, "closers.json");
	const known = existsSync(file)
		? (JSON.parse(readFileSync(file, "utf8")) as Record<string, number[]>)
		: {};
	const todo = [...new Set(issues)].filter((n) => known[String(n)] === undefined);
	const [owner, name] = repo.split("/");
	for (let i = 0; i < todo.length; i += 20) {
		const slice = todo.slice(i, i + 20);
		const body = slice
			.map(
				(n) =>
					`n${n}: issue(number: ${n}) { closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number } } }`,
			)
			.join("\n");
		const data = (await graphql(`{ repository(owner: "${owner}", name: "${name}") { ${body} } }`))
			.repository as Record<
			string,
			{closedByPullRequestsReferences: {nodes: {number: number}[]}} | null
		>;
		for (const n of slice)
			known[String(n)] =
				data[`n${n}`]?.closedByPullRequestsReferences.nodes.map((p) => p.number) ?? [];
	}
	writeFileSync(file, JSON.stringify(known));
	return known;
}

/** What `fetchClosers` saved, or nothing. */
export function readClosers(cache: string): Readonly<Record<string, readonly number[]>> {
	const file = join(cache, "closers.json");
	return existsSync(file)
		? (JSON.parse(readFileSync(file, "utf8")) as Record<string, number[]>)
		: {};
}

/** What changed between two commits: each file, and the lines the change added to it. */
export interface Compare {
	readonly files: readonly {readonly path: string; readonly added: readonly string[]}[];
	/** GitHub could not compare them (a commit it no longer has). */
	readonly missing: boolean;
}
const compareFile = (cache: string, base: string, head: string) =>
	join(cache, `compare-${base.slice(0, 12)}-${head.slice(0, 12)}.json`);

export function readCompare(cache: string, base: string, head: string): Compare | null {
	const file = compareFile(cache, base, head);
	return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Compare) : null;
}

/** Fetch the diff between two commits once (REST, read-only). Returns whether it made a request. */
export async function fetchCompare(
	repo: string,
	base: string,
	head: string,
	cache: string,
): Promise<boolean> {
	const file = compareFile(cache, base, head);
	if (existsSync(file)) return false;
	let saved: Compare;
	try {
		const raw = JSON.parse(await gh(["api", `repos/${repo}/compare/${base}...${head}`])) as {
			files?: {filename: string; patch?: string}[];
		};
		saved = {
			missing: false,
			files: (raw.files ?? []).map((f) => ({
				path: f.filename,
				added: (f.patch ?? "")
					.split("\n")
					.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
					.map((line) => line.slice(1)),
			})),
		};
	} catch {
		saved = {missing: true, files: []};
	}
	writeFileSync(file, JSON.stringify(saved));
	return true;
}

/** The check runs GitHub holds for one commit: the last attempt of each. */
export interface Checks {
	readonly runs: readonly {
		readonly name: string;
		readonly conclusion: string | null;
		readonly startedAt: string | null;
		readonly completedAt: string | null;
	}[];
	/** GitHub did not answer for this commit. */
	readonly missing: boolean;
}
const checksFile = (cache: string, sha: string) => join(cache, `checks-${sha.slice(0, 16)}.json`);

export function readChecks(cache: string, sha: string): Checks | null {
	const file = checksFile(cache, sha);
	return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Checks) : null;
}

/** Fetch one commit's check runs once (REST, read-only). Returns whether it made a request. */
export async function fetchChecks(repo: string, sha: string, cache: string): Promise<boolean> {
	const file = checksFile(cache, sha);
	if (existsSync(file)) return false;
	let saved: Checks;
	try {
		const raw = JSON.parse(
			await gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]),
		) as {
			check_runs?: {
				name: string;
				conclusion: string | null;
				started_at: string | null;
				completed_at: string | null;
			}[];
		};
		saved = {
			missing: false,
			runs: (raw.check_runs ?? []).map((r) => ({
				name: r.name,
				conclusion: r.conclusion,
				startedAt: r.started_at,
				completedAt: r.completed_at,
			})),
		};
	} catch {
		saved = {missing: true, runs: []};
	}
	writeFileSync(file, JSON.stringify(saved));
	return true;
}

const fileOf = (cache: string, number: number) => join(cache, `thread-${number}.json`);

/** A thread from the cache, or `null` when it was never fetched. A number GitHub does not know is cached as `missing`. */
export function readThread(cache: string, number: number): Thread | "missing" | null {
	const file = fileOf(cache, number);
	if (!existsSync(file)) return null;
	const saved = JSON.parse(readFileSync(file, "utf8")) as Thread | {missing: true};
	return "missing" in saved ? "missing" : saved;
}

/** Fetch every number not yet in the cache, `batch` to a query. Returns how many queries it made. */
export async function fetchThreads(
	repo: string,
	numbers: readonly number[],
	cache: string,
	batch = 6,
): Promise<number> {
	mkdirSync(cache, {recursive: true});
	const [owner, name] = repo.split("/");
	const todo = [...new Set(numbers)].filter((n) => !existsSync(fileOf(cache, n)));
	let queries = 0;
	for (let i = 0; i < todo.length; i += batch) {
		const slice = todo.slice(i, i + batch);
		const body = slice
			.map((n) => `n${n}: issueOrPullRequest(number: ${n}) { ${FIELDS} }`)
			.join("\n");
		const data = await graphql(`{ repository(owner: "${owner}", name: "${name}") { ${body} } }`);
		queries += 1;
		const repoData = data.repository as Record<string, Record<string, unknown> | null>;
		for (const n of slice) {
			const raw = repoData[`n${n}`];
			if (raw === null || raw === undefined) {
				writeFileSync(fileOf(cache, n), JSON.stringify({missing: true}));
				continue;
			}
			const kind = raw.__typename === "PullRequest" ? "pull" : "issue";
			const page = raw.comments as {
				pageInfo: {hasNextPage: boolean; endCursor: string};
				nodes: RawComment[];
			};
			const comments = page.nodes.map(comment);
			if (page.pageInfo.hasNextPage) {
				comments.push(...(await restOf(repo, n, kind, page.pageInfo.endCursor)));
				queries += 1;
			}
			const reviews = (
				(
					raw.reviews as
						| {
								nodes: {
									url: string;
									state: string;
									submittedAt: string | null;
									author: {login: string; __typename: string} | null;
									body: string;
								}[];
						  }
						| undefined
				)?.nodes ?? []
			).map(
				(r): ThreadReview => ({
					url: r.url,
					state: r.state,
					at: r.submittedAt,
					author: r.author?.login ?? "",
					bot: r.author?.__typename === "Bot",
					body: r.body,
				}),
			);
			const thread: Thread = {
				number: n,
				kind,
				title: String(raw.title ?? ""),
				state: String(raw.state ?? ""),
				merged: raw.merged === true,
				createdAt: String(raw.createdAt ?? ""),
				closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
				body: String(raw.body ?? ""),
				additions: typeof raw.additions === "number" ? raw.additions : null,
				deletions: typeof raw.deletions === "number" ? raw.deletions : null,
				changedFiles: typeof raw.changedFiles === "number" ? raw.changedFiles : null,
				files: ((raw.files as {nodes: {path: string}[]} | undefined)?.nodes ?? []).map(
					(f) => f.path,
				),
				comments,
				reviews,
			};
			writeFileSync(fileOf(cache, n), JSON.stringify(thread));
		}
		if (queries % 20 === 0)
			console.error(`fetched ${Math.min(i + batch, todo.length)} of ${todo.length}`);
	}
	return queries;
}
