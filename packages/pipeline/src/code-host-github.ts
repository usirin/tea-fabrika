import {Clock, Effect, Layer, Option, Schedule, Schema, Stream} from "effect";
import {everyOwner, ownersOf, parseCodeowners, teamOf} from "./codeowners.ts";
import {isMachines} from "./comments.ts";
import {CodeHost, type PullRequest} from "./services.ts";
import {sh} from "./sh.ts";
import {type Change, criteriaIn, deviationsIn} from "./stages/review/pack.ts";
import {RULES_FIELDS, RuleBlob, repoRulesOf, rulesAt} from "./stages/rules.ts";
import {Main, PrFacts, type Rerun, type ReviewKind} from "./stages/ship/facts.ts";
import {verdictsIn} from "./verdict.ts";

// `CodeHost` on GitHub, the read side only. Everything the ship gate needs
// about a pull request comes from GraphQL calls through `gh`, at one head
// commit. Nothing here writes: no enqueue, no label, no comment, no merge.
// The writes are in `code-host-github-writes.ts`, behind a service of their
// own.
//
// Two things here wait: the checks, and the merge queue. Each is a read asked
// again every `pollMs`, because GitHub does not push to a command-line tool.
// The queue's wait says `ejected` only on GitHub's own record of it, never on
// one "not in the queue" answer: see `queueStep`.
//
// Three calls, and one more when a team owns a protected file:
//   1. the head commit and the base branch's name
//   2. the pull request, with three files read beside it: the base branch's
//      `.github/CODEOWNERS`, and `.fabrika.jsonc` at the base and at the head
//   3. the members of each team the CODEOWNERS file names
//   4. main: where the head left the base branch, and where the branch is now
//      (REST `compare`, base...head)
//
// The review stage reads a pull request another way: `readChange`, further
// down, with its own list of calls. It reads at a commit the caller may name.
// A list of a repository's open pull requests, for the tracker, is one REST
// call: `readPullRequests`.
//
// Each fact is read the plainest honest way. Where the reading cannot say, the
// fact is `unknown`, never a guess. Where a value is less than it looks,
// `NOT_READ` says so, in words a person can read beside the facts.

const WHERE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid baseRefName } }
}`;

const QUERY = `
query($owner: String!, $name: String!, $number: Int!, $codeowners: String!, $baseConfig: String!, $headConfig: String!) {
  repository(owner: $owner, name: $name) {
    codeowners: object(expression: $codeowners) { ... on Blob { text } }
    baseConfig: object(expression: $baseConfig) { ... on Blob { text } }
    headConfig: object(expression: $headConfig) { ... on Blob { text } }
    pullRequest(number: $number) {
      state
      isDraft
      headRefOid
      body
      author { __typename login }
      mergeable
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      files(first: 100) { pageInfo { hasNextPage } nodes { path } }
      reviews(last: 100) { nodes { state author { __typename login } commit { oid } } }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { id isResolved comments(first: 50) { nodes { body author { __typename login } } } }
      }
      comments(last: 100) { nodes { createdAt body author { __typename login } } }
    }
  }
}`;

const TEAM = `
query($org: String!, $team: String!) {
  organization(login: $org) { team(slug: $team) { members(first: 100) { pageInfo { hasNextPage } nodes { login } } } }
}`;

/** `null`: the account is gone. */
const Author = Schema.NullOr(Schema.Struct({__typename: Schema.String, login: Schema.String}));
type Author = typeof Author.Type;

/** A file read beside the pull request. `null`: no such file. */
const Blob = Schema.NullOr(Schema.Struct({text: Schema.optional(Schema.NullOr(Schema.String))}));
const textOf = (blob: typeof Blob.Type): string | null => blob?.text ?? null;

/** The pull request as the query above answers. */
const Pr = Schema.Struct({
	state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
	isDraft: Schema.Boolean,
	headRefOid: Schema.String,
	body: Schema.String,
	author: Author,
	mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
	commits: Schema.Struct({
		nodes: Schema.Array(
			Schema.Struct({
				commit: Schema.Struct({
					oid: Schema.String,
					/** `null`: no check has reported on the commit. */
					statusCheckRollup: Schema.NullOr(
						Schema.Struct({
							state: Schema.Literals(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]),
						}),
					),
				}),
			}),
		),
	}),
	files: Schema.Struct({
		pageInfo: Schema.Struct({hasNextPage: Schema.Boolean}),
		nodes: Schema.Array(Schema.Struct({path: Schema.String})),
	}),
	reviews: Schema.Struct({
		nodes: Schema.Array(
			Schema.Struct({
				state: Schema.String,
				author: Author,
				commit: Schema.NullOr(Schema.Struct({oid: Schema.String})),
			}),
		),
	}),
	reviewThreads: Schema.Struct({
		pageInfo: Schema.Struct({hasNextPage: Schema.Boolean}),
		nodes: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				isResolved: Schema.Boolean,
				comments: Schema.Struct({
					nodes: Schema.Array(Schema.Struct({body: Schema.String, author: Author})),
				}),
			}),
		),
	}),
	comments: Schema.Struct({
		nodes: Schema.Array(
			Schema.Struct({createdAt: Schema.String, body: Schema.String, author: Author}),
		),
	}),
});
type Pr = typeof Pr.Type;

const Where = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.Struct({headRefOid: Schema.String, baseRefName: Schema.String}),
		}),
	}),
});

/**
 * Main, from a compare of the base branch with the head: the merge base is
 * where the head left main, the base commit is main's tip now. Only the two
 * shas are kept (`--jq`), not the files and commits around them.
 */
const MAIN_OF = "{tested: .merge_base_commit.sha, tip: .base_commit.sha}";
const mainArgs = (
	at: {readonly owner: string; readonly name: string},
	base: string,
	head: string,
) => ["api", `repos/${at.owner}/${at.name}/compare/${base}...${head}`, "--jq", MAIN_OF];
const Answer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			codeowners: Blob,
			baseConfig: Blob,
			headConfig: Blob,
			pullRequest: Pr,
		}),
	}),
});
const Team = Schema.Struct({
	data: Schema.Struct({
		organization: Schema.Struct({
			team: Schema.Struct({
				members: Schema.Struct({
					pageInfo: Schema.Struct({hasNextPage: Schema.Boolean}),
					nodes: Schema.Array(Schema.Struct({login: Schema.String})),
				}),
			}),
		}),
	}),
});

/**
 * What this reading cannot say, though the fact has a value. Shown beside the
 * facts wherever they are printed, so nobody takes a value for more than it is.
 */
export const NOT_READ: readonly string[] = [
	"reviews: which kinds a pull request needs is worked out here, by a copy of today's fabrika's rules (its file-to-kind map and its default governed folders) over the repo's own `.fabrika.jsonc`. It is not asked of fabrika, so the two can drift.",
	"reviews, approval: the first 100 changed files. With more, both read `unknown`.",
	"checks: every check on the head commit, required or not. `stuck` is never answered: nothing here says how long is too long.",
	"comments: unresolved review threads only. An agent that comments from a person's account with no hidden mark reads as that person.",
];

/** `owner`, `name` and the number, from a pull request's URL. */
export function prOf(
	url: string,
): {readonly owner: string; readonly name: string; readonly number: number} | null {
	const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(url);
	return m === null ? null : {owner: m[1] as string, name: m[2] as string, number: Number(m[3])};
}

const ISSUE = String.raw`(?:(?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)`;
/** GitHub's own closing words: close, fix, resolve, in their three forms. */
const CLOSES = new RegExp(
	String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+${ISSUE}`,
	"i",
);
const PART_OF = new RegExp(String.raw`\bpart of\s+${ISSUE}`, "i");
/** The end of a match of either: the ticket, as `#N`, `owner/name#N` or an issue's URL. */
const NAMED = /(?:([\w.-]+)\/([\w.-]+))?#(\d+)$|github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)$/;

/** A ticket as a body names it. `owner` and `name` are `null` for `#N`: the pull request's own repo. */
export interface TicketRef {
	readonly link: "closes_it" | "part_of_it";
	readonly owner: string | null;
	readonly name: string | null;
	readonly number: number;
}

/**
 * The ticket a body serves, by today's fabrika's rule: a closing word if the
 * body has one, else `Part of #N`. Any other mention (`Refs #N`, `Re: #N`)
 * serves no ticket. The first such line wins. `null`: none.
 */
export function ticketIn(body: string): TicketRef | null {
	const closes = CLOSES.exec(body);
	const found = closes ?? PART_OF.exec(body);
	const at = found === null ? null : NAMED.exec(found[0]);
	if (at === null) return null;
	const link = closes === null ? "part_of_it" : "closes_it";
	return {
		link,
		owner: at[1] ?? at[4] ?? null,
		name: at[2] ?? at[5] ?? null,
		number: Number(at[3] ?? at[6]),
	};
}

/**
 * The ticket a pull request's body serves, as `owner/name#N`, and how. A
 * bare `#N` is in the pull request's own repo, `at`. `none`: it names none.
 */
export const ticketOf = (
	body: string,
	at: {readonly owner: string; readonly name: string},
): PrFacts["ticket"] => {
	const ticket = ticketIn(body);
	return ticket === null
		? "none"
		: {
				id: `${ticket.owner ?? at.owner}/${ticket.name ?? at.name}#${ticket.number}`,
				link: ticket.link,
			};
};

/** Whether an account is one of a list. GitHub logins do not tell case apart. */
const isOneOf = (author: Author, logins: readonly string[]): boolean =>
	author !== null && logins.some((login) => login.toLowerCase() === author.login.toLowerCase());
/** Whether a commit, written whole or short, is this head. */
const isHead = (head: string, written: string): boolean =>
	written.length >= 7 && head.startsWith(written);

// ---------------------------------------------------------------- which reviews a pull request needs

/** `JSON.parse` that answers nothing, where the plain one throws. */
const parseJson = Option.liftThrowable((text: string): unknown => JSON.parse(text));

/** `.fabrika.jsonc` as a value: JSON with comments and trailing commas. `undefined`: it does not parse. */
export function parseJsonc(text: string): unknown {
	// Strings are kept whole; a comment is dropped; a comma before a closing bracket is dropped.
	const bare = text.replace(
		/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		(_all, string?: string) => string ?? "",
	);
	return Option.getOrUndefined(
		parseJson(
			bare.replace(/("(?:[^"\\\n]|\\.)*")|,(?=\s*[}\]])/g, (_all, string?: string) => string ?? ""),
		),
	);
}

/** The two keys of a repo's `.fabrika.jsonc` that say which reviews a change needs. */
export interface Rules {
	/** A change under one of these needs the governance review. */
	readonly governed: readonly string[];
	/** A change under one of these needs the rendered review. */
	readonly ui: readonly string[];
}

/** Fabrika's own default for `governedRoots`, copied from fabrika 0.9: used when a repo's config leaves the key out. */
const DEFAULT_GOVERNED = [".decisions/", ".claude/", ".github/", ".fabrika.jsonc"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** The rules one `.fabrika.jsonc` gives. `null`: the text is not a config this can read. */
export function rulesOf(text: string): Rules | null {
	const config = parseJsonc(text);
	if (!isRecord(config)) return null;
	const {governedRoots = DEFAULT_GOVERNED, uiSurfaces = []} = config;
	if (!Array.isArray(governedRoots) || !governedRoots.every((root) => typeof root === "string"))
		return null;
	if (
		!Array.isArray(uiSurfaces) ||
		!uiSurfaces.every((s) => isRecord(s) && typeof s.prefix === "string")
	)
		return null;
	return {governed: governedRoots, ui: uiSurfaces.map((s) => s.prefix as string)};
}

/**
 * Which of the three text reviews reads one file, by today's fabrika's path
 * rule (copied from fabrika 0.9): a file under a plugin or skill folder is
 * skill-page text, any other `.md` file is a doc, everything else is code.
 */
export function textKindOf(path: string): "review-code" | "review-doc" | "review-skill" {
	const skill =
		path.startsWith("claude-plugins/") ||
		path.startsWith(".claude/") ||
		path.startsWith("skills/") ||
		path === "SKILL.md" ||
		path.endsWith("/SKILL.md");
	return skill ? "review-skill" : path.endsWith(".md") ? "review-doc" : "review-code";
}

/**
 * The base's rules and the head's, together: a change cannot take itself out
 * of a review. A side with no config takes `declared`, the rules the
 * repository's fabrika.toml names in its place. `null`: a config does not
 * read, or one is not there and none is declared, so the rules are not known.
 */
export function rulesOfBoth(
	configs: readonly (string | null)[],
	declared: Rules | null = null,
): Rules | null {
	const rules = configs.map((text) => (text === null ? declared : rulesOf(text)));
	const known = rules.filter((r): r is Rules => r !== null);
	if (known.length !== configs.length || known.length === 0) return null;
	return {governed: known.flatMap((r) => r.governed), ui: known.flatMap((r) => r.ui)};
}

/**
 * The kinds of review a set of changed files needs, by today's fabrika's
 * rules (copied from fabrika 0.9, see `NOT_READ`). Each file is skill-page
 * text, a doc, or code; a file under a rendered page adds the rendered
 * review; a file under a governed folder adds the governance review.
 */
export function kindsNeeded(files: readonly string[], rules: Rules): readonly ReviewKind["kind"][] {
	const under = (path: string, roots: readonly string[]) =>
		roots.some((root) => (root.endsWith("/") ? path.startsWith(root) : path === root));
	const reads = (kind: ReturnType<typeof textKindOf>) => files.some((p) => textKindOf(p) === kind);
	const needs = {
		"review-code": reads("review-code"),
		"review-doc": reads("review-doc"),
		"review-skill": reads("review-skill"),
		"review-ui": files.some((p) => under(p, rules.ui) && !/\.(?:test|spec)\.tsx?$/.test(p)),
		// A governed root is a prefix, folder or not, as fabrika reads it.
		governance: files.some((p) => rules.governed.some((root) => p.startsWith(root))),
	};
	return (Object.keys(needs) as (keyof typeof needs)[]).filter((kind) => needs[kind]);
}

/**
 * The last verdict of each kind of review that binds to this head and was
 * posted by an account whose verdicts count. A verdict for an older commit is
 * not one for this head, however many passed there.
 */
export function verdictsAt(
	head: string,
	comments: Pr["comments"]["nodes"],
	reviewers: readonly string[],
): ReadonlyMap<string, "PASS" | "FAIL"> {
	const last = new Map<string, "PASS" | "FAIL">();
	for (const comment of [...comments].sort(
		(a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
	)) {
		if (!isOneOf(comment.author, reviewers)) continue;
		const [standing] = verdictsIn(comment.body);
		if (standing === undefined) continue;
		const at = standing.marker.head ?? standing.marker.range?.tip ?? null;
		if (at === null || !isHead(head, at)) continue;
		last.set(standing.marker.namespace, standing.marker.polarity);
	}
	return last;
}

/**
 * Each kind of review this pull request needs, and how it stands at the head.
 * A failing verdict of a kind it does not need is listed too: a review that
 * ran and failed is not passed over. `null`: what it needs cannot be told,
 * and a change that seems to need no review at all is one of those.
 */
export function reviewKindsOf(
	pr: Pr,
	configs: readonly (string | null)[],
	reviewers: readonly string[],
	declared: Rules | null = null,
): PrFacts["reviews"] {
	const files = pr.files.nodes.map((file) => file.path);
	const all = rulesOfBoth(configs, declared);
	if (all === null || files.length === 0 || pr.files.pageInfo.hasNextPage) return null;
	const verdicts = verdictsAt(pr.headRefOid, pr.comments.nodes, reviewers);
	const needed = kindsNeeded(files, all);
	const alsoFailed = [...verdicts].flatMap(([kind, verdict]) =>
		verdict === "FAIL" && !needed.includes(kind as ReviewKind["kind"])
			? [kind as ReviewKind["kind"]]
			: [],
	);
	const [first, ...rest] = [...needed, ...alsoFailed].map((kind): ReviewKind => {
		const verdict = verdicts.get(kind);
		return {
			kind,
			verdict: verdict === undefined ? "missing" : verdict === "PASS" ? "passed" : "failed",
		};
	});
	return first === undefined ? null : [first, ...rest];
}

// ---------------------------------------------------------------- the owner's approval

/** The words a repo's one owner leaves on their own pull request, with the commit they are for. */
const SELF_APPROVAL = /control-plane-self-approval @ ([0-9a-f]{7,40})/;

/**
 * Whose approval a pull request needs, from the base branch's CODEOWNERS:
 * nobody's when no changed file has an owner, else any one of the owners the
 * file names. `unknown`: no CODEOWNERS, so no boundary was declared, or more
 * changed files than were read.
 */
export function approvalNeeded(
	pr: Pr,
	codeowners: string | null,
):
	| {readonly kind: "not_needed" | "unknown"}
	| {readonly kind: "one_of"; readonly owners: readonly string[]} {
	if (codeowners === null) return {kind: "unknown"};
	const rows = parseCodeowners(codeowners);
	if (pr.files.nodes.some((file) => ownersOf(rows, file.path).length > 0))
		return {kind: "one_of", owners: everyOwner(rows)};
	return {
		kind: pr.files.pageInfo.hasNextPage || pr.files.nodes.length === 0 ? "unknown" : "not_needed",
	};
}

/**
 * Whether one of the owners approved this head, by today's fabrika's rule. A
 * repo's one owner on their own pull request approves with a comment that
 * names the commit. Anyone else: an approving review of this head by an owner
 * who did not open the pull request.
 */
export function approvedBy(pr: Pr, owners: readonly string[]): "given" | "missing" {
	const soleAuthor = owners.length === 1 && isOneOf(pr.author, owners);
	if (soleAuthor) {
		const said = pr.comments.nodes.some(
			(c) =>
				isOneOf(c.author, owners) && isHead(pr.headRefOid, SELF_APPROVAL.exec(c.body)?.[1] ?? ""),
		);
		return said ? "given" : "missing";
	}
	const approved = pr.reviews.nodes.some(
		(r) =>
			r.state === "APPROVED" &&
			r.commit?.oid === pr.headRefOid &&
			isOneOf(r.author, owners) &&
			r.author?.login.toLowerCase() !== pr.author?.login.toLowerCase(),
	);
	return approved ? "given" : "missing";
}

// ---------------------------------------------------------------- the facts

const CHECKS = {
	SUCCESS: "green",
	FAILURE: "red",
	ERROR: "red",
	PENDING: "pending",
	EXPECTED: "pending",
} as const;
const MERGEABLE = {MERGEABLE: "clean", CONFLICTING: "conflicts", UNKNOWN: "unknown"} as const;

/** Who is who, as settings of the run: nothing here names an account. */
export interface Accounts {
	/** The accounts the repo treats as its own: who may open a pull request this machine lands. */
	readonly own: readonly string[];
	/** The accounts whose review verdicts count. */
	readonly reviewers: readonly string[];
}

/**
 * What a repository's fabrika.toml declares for a file GitHub would read
 * (../setup.ts). Each is read only where that file is not there: a file at
 * the base still binds.
 */
export interface Declared {
	/**
	 * `none`: with no `.github/CODEOWNERS` at the base, a change needs no
	 * approval. Left out, or `codeowners`: with none, the approval is
	 * `unknown`, and ship stops.
	 */
	readonly approval?: "codeowners" | "none";
	/** The review rules for a side with no `.fabrika.jsonc`. Left out: that side's rules are not known. */
	readonly kinds?: Rules;
}

/**
 * Whose approval a pull request needs, with what the repository declared: a
 * CODEOWNERS file at the base binds whatever was declared; with none, a
 * declared `none` means nobody's.
 */
export function approvalDeclared(
	pr: Pr,
	codeowners: string | null,
	declared: Declared["approval"],
): ReturnType<typeof approvalNeeded> {
	if (codeowners === null && declared === "none") return {kind: "not_needed"};
	return approvalNeeded(pr, codeowners);
}

/** The facts in one answer. `null`: the answer does not hold them all at one head, and nothing is guessed. */
export function factsOf(
	pr: Pr,
	at: {readonly owner: string; readonly name: string},
	accounts: Accounts,
	approval: PrFacts["approval"],
	configs: readonly (string | null)[],
	main: Main,
	declared: Rules | null = null,
): PrFacts | null {
	const [last] = pr.commits.nodes;
	// The checks must be the head's own, and every thread must be in hand.
	if (
		last === undefined ||
		last.commit.oid !== pr.headRefOid ||
		pr.reviewThreads.pageInfo.hasNextPage
	)
		return null;
	const rollup = last.commit.statusCheckRollup;
	return {
		head: pr.headRefOid,
		state:
			pr.state === "MERGED"
				? "merged"
				: pr.state === "CLOSED"
					? "closed"
					: pr.isDraft
						? "draft"
						: "open",
		ours: isOneOf(pr.author, accounts.own),
		ticket: ticketOf(pr.body, at),
		approval,
		reviews: reviewKindsOf(pr, configs, accounts.reviewers, declared),
		// No check has reported: it cannot be told from "none will", so it waits.
		checks: rollup === null ? "pending" : CHECKS[rollup.state],
		mergeable: MERGEABLE[pr.mergeable],
		comments: pr.reviewThreads.nodes
			.filter((thread) => !thread.isResolved)
			.map((thread) => ({
				id: thread.id,
				// A thread a person wrote or joined is the person's. A bot account, or a comment with a machine's mark, is not one.
				by: thread.comments.nodes.some((c) => c.author?.__typename !== "Bot" && !isMachines(c.body))
					? ("person" as const)
					: ("bot" as const),
			})),
		main,
	};
}

const failed = Effect.fail({_tag: "unknown" as const});

/** One `gh` call, by its arguments: its stdout. */
export type Gh = (args: readonly string[]) => Effect.Effect<string, {readonly _tag: "unknown"}>;

/** One `gh` call whose stdout is JSON, decoded. Text that is not JSON, or JSON that does not fit, is the same failure as a call that broke. */
export const answerOf = <A>(gh: Gh, schema: Schema.Codec<A, unknown>, args: readonly string[]) =>
	Effect.gen(function* () {
		const out = yield* gh(args);
		const parsed = yield* Effect.try({
			try: () => JSON.parse(out) as unknown,
			catch: () => ({_tag: "unknown" as const}),
		});
		const answer = Schema.decodeUnknownOption(schema)(parsed);
		return Option.isNone(answer) ? yield* failed : answer.value;
	});

/** One GraphQL call, decoded. */
export const ask = <A>(
	gh: Gh,
	schema: Schema.Codec<A, unknown>,
	query: string,
	fields: Readonly<Record<string, string | number>>,
) => {
	// `-F` reads a number as a number; `-f` keeps a text as it is.
	const args = Object.entries(fields).flatMap(([name, value]) => [
		typeof value === "number" ? "-F" : "-f",
		`${name}=${value}`,
	]);
	return answerOf(gh, schema, ["api", "graphql", ...args, "-f", `query=${query}`]);
};

/**
 * The accounts behind a list of owners: an account is itself, a team is its
 * members. `null`: a team could not be read whole. A list missing one team is
 * not a shorter list, it is an unknown one.
 */
const accountsOf = (gh: Gh, owners: readonly string[]) =>
	Effect.forEach(
		owners,
		(owner) => {
			const team = teamOf(owner);
			if (team === null) return Effect.succeed<readonly string[] | null>([owner.replace(/^@/, "")]);
			return ask(gh, Team, TEAM, team).pipe(
				Effect.map(({data}) => data.organization.team.members),
				Effect.match({
					onSuccess: (m): readonly string[] | null =>
						m.pageInfo.hasNextPage ? null : m.nodes.map((n) => n.login),
					onFailure: () => null,
				}),
			);
		},
		// One team at a time, in the order the owners are listed.
		{concurrency: 1},
	).pipe(
		Effect.map((lists) =>
			lists.some((list) => list === null) ? null : lists.flatMap((list) => list ?? []),
		),
	);

/**
 * Read one pull request's facts through `gh`. An answer that does not parse,
 * does not fit, or does not hold the facts at one head is the same failure
 * as a call that broke: `unknown`, never a throw and never a guess.
 */
export const readPrFacts =
	(gh: Gh, accounts: Accounts, declared: Declared = {}) =>
	(url: string): Effect.Effect<PrFacts, {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = prOf(url);
			if (at === null) return yield* failed;
			const {headRefOid: head, baseRefName: base} = (yield* ask(gh, Where, WHERE, at)).data
				.repository.pullRequest;
			const {repository} = (yield* ask(gh, Answer, QUERY, {
				...at,
				// The protected files and their owners are the base branch's: a change cannot take itself out of them.
				codeowners: `${base}:.github/CODEOWNERS`,
				baseConfig: `${base}:.fabrika.jsonc`,
				headConfig: `${head}:.fabrika.jsonc`,
			})).data;
			const pr = repository.pullRequest;
			// The head moved between the two calls: the files beside it are another commit's.
			if (pr.headRefOid !== head) return yield* failed;
			const need = approvalDeclared(pr, textOf(repository.codeowners), declared.approval);
			const owners = need.kind === "one_of" ? yield* accountsOf(gh, need.owners) : null;
			const approval =
				need.kind !== "one_of" ? need.kind : owners === null ? "unknown" : approvedBy(pr, owners);
			// Where main is, beside the head: a compare that breaks is a read that breaks, never a guess that it is current.
			const main = yield* answerOf(gh, Main, mainArgs(at, base, head));
			const facts = factsOf(
				pr,
				at,
				accounts,
				approval,
				[textOf(repository.baseConfig), textOf(repository.headConfig)],
				main,
				declared.kinds ?? null,
			);
			const checked = facts === null ? Option.none() : Schema.decodeUnknownOption(PrFacts)(facts);
			return Option.isNone(checked) ? yield* failed : checked.value;
		});

// ---------------------------------------------------------------- the change, for a review

const CHANGE = `
query($owner: String!, $name: String!, $number: Int!, $head: GitObjectID!, $baseConfig: String!, $headConfig: String!, $claudeMd: String!, $agentsMd: String!) {
  repository(owner: $owner, name: $name) {
    baseConfig: object(expression: $baseConfig) { ... on Blob { text } }
    headConfig: object(expression: $headConfig) { ... on Blob { text } }
    ${RULES_FIELDS}
    pullRequest(number: $number) { state isDraft headRefOid baseRefOid body }
    commit: object(oid: $head) {
      ... on Commit {
        statusCheckRollup {
          contexts(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              __typename
              ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
              ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
            }
          }
        }
      }
    }
  }
}`;

const TICKET = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { body } }
}`;

/** One check on a commit: a check run, or a status another service set. `isRequired`: the base branch requires it of this pull request. */
const Context = Schema.Union([
	Schema.Struct({
		__typename: Schema.Literal("CheckRun"),
		name: Schema.String,
		status: Schema.String,
		conclusion: Schema.NullOr(Schema.String),
		isRequired: Schema.Boolean,
	}),
	Schema.Struct({
		__typename: Schema.Literal("StatusContext"),
		context: Schema.String,
		state: Schema.String,
		isRequired: Schema.Boolean,
	}),
]);
type Context = typeof Context.Type;
/** `null`: no check has reported on the commit. */
const Rollup = Schema.NullOr(
	Schema.Struct({
		contexts: Schema.Struct({
			pageInfo: Schema.Struct({hasNextPage: Schema.Boolean}),
			nodes: Schema.Array(Context),
		}),
	}),
);

const ChangeAnswer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			baseConfig: Blob,
			headConfig: Blob,
			claudeMd: RuleBlob,
			agentsMd: RuleBlob,
			pullRequest: Schema.Struct({
				state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
				isDraft: Schema.Boolean,
				headRefOid: Schema.String,
				baseRefOid: Schema.String,
				body: Schema.String,
			}),
			/** `null`: the repo has no such commit. */
			commit: Schema.NullOr(Schema.Struct({statusCheckRollup: Schema.optional(Rollup)})),
		}),
	}),
});
const TicketAnswer = Schema.Struct({
	data: Schema.Struct({repository: Schema.Struct({issue: Schema.Struct({body: Schema.String})})}),
});
/** GitHub's comparison of two commits: the files that differ, the first 300 of them. */
const Compared = Schema.Struct({files: Schema.Array(Schema.Struct({filename: Schema.String}))});
/** With this many files or more, a change's files, kinds and diff are not read. */
export const MOST_FILES = 300;

const GREEN = ["SUCCESS", "NEUTRAL", "SKIPPED"];
const RED = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];
/** How one check stands. A word this does not know waits: it is never taken for a pass. */
const standsAs = (word: string | null): "green" | "red" | "pending" =>
	word === null
		? "pending"
		: GREEN.includes(word)
			? "green"
			: RED.includes(word)
				? "red"
				: "pending";
const checkOf = (context: Context) =>
	context.__typename === "StatusContext"
		? {name: context.context, state: standsAs(context.state)}
		: {
				name: context.name,
				state: context.status === "COMPLETED" ? standsAs(context.conclusion) : ("pending" as const),
			};

/**
 * Which checks a review waits on. `required`: the ones the base branch
 * requires, as GitHub marks them. `every`: every check on the commit, for a
 * repository whose base branch requires none, where `required` would wait
 * for ever. A setting of the reader, like its accounts: a fact about the
 * repository, not about one review.
 */
export type Counted = "required" | "every";

/**
 * The checks of one commit that count, and how they stand together. A red one
 * is red however many more there are to read. With none red, a list that was
 * not read whole is `unknown`.
 */
export function checksOf(
	rollup: typeof Rollup.Type | undefined,
	counted: Counted = "required",
): Change["checks"] {
	if (rollup === null || rollup === undefined) return {state: "pending", required: []};
	const required = rollup.contexts.nodes
		.filter((context) => counted === "every" || context.isRequired)
		.map(checkOf);
	const has = (state: "red" | "pending") => required.some((check) => check.state === state);
	const state = has("red")
		? "red"
		: rollup.contexts.pageInfo.hasNextPage
			? "unknown"
			: required.length === 0 || has("pending")
				? "pending"
				: "green";
	return {state, required};
}

/**
 * Read one pull request at one commit, for a review. `asked`: the commit to
 * read, whole; `null` reads the head as it is now. Five calls:
 *   1. the head commit and the base branch's name
 *   2. the pull request, the checks of the commit, `.fabrika.jsonc` at the
 *      base and at the commit, and the repository's rules for agents
 *      (`CLAUDE.md`, `AGENTS.md`) at the base only
 *   3. the ticket the pull request's text names
 *   4. the files that differ between the base and the commit
 *   5. the same comparison as one diff
 * Calls 1 and 2 must answer, or the read fails. A part behind call 3, 4 or 5
 * that does not answer is `null` in the change, never a guess.
 */
export const readChange =
	(gh: Gh, counted: Counted = "required", declared: Rules | null = null) =>
	(url: string, asked: string | null): Effect.Effect<Change, {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = prOf(url);
			if (at === null || (asked !== null && !/^[0-9a-f]{40}$/.test(asked))) return yield* failed;
			const where = (yield* ask(gh, Where, WHERE, at)).data.repository.pullRequest;
			const head = asked ?? where.headRefOid;
			const {repository} = (yield* ask(gh, ChangeAnswer, CHANGE, {
				...at,
				head,
				baseConfig: `${where.baseRefName}:.fabrika.jsonc`,
				headConfig: `${head}:.fabrika.jsonc`,
				// The base's: a change cannot rewrite the rules it is held to.
				...rulesAt(where.baseRefName),
			})).data;
			const pr = repository.pullRequest;
			// No such commit, or the head moved between the two calls.
			if (repository.commit === null || (asked === null && pr.headRefOid !== head))
				return yield* failed;

			const ticket = ticketIn(pr.body);
			const criteria =
				ticket === null
					? null
					: yield* ask(gh, TicketAnswer, TICKET, {
							owner: ticket.owner ?? at.owner,
							name: ticket.name ?? at.name,
							number: ticket.number,
						}).pipe(
							Effect.match({
								onSuccess: (answer): Change["criteria"] =>
									criteriaIn(answer.data.repository.issue.body),
								onFailure: () => null,
							}),
						);

			// Three dots: from where the branch left its base, so the base's own later commits are not in it.
			const range = `repos/${at.owner}/${at.name}/compare/${pr.baseRefOid}...${head}`;
			const compared = yield* Effect.option(answerOf(gh, Compared, ["api", range]));
			const paths =
				Option.isSome(compared) && compared.value.files.length < MOST_FILES
					? compared.value.files.map((file) => file.filename)
					: null;
			const diff =
				paths === null
					? null
					: yield* gh(["api", range, "-H", "Accept: application/vnd.github.diff"]).pipe(
							Effect.match({onSuccess: (text): string | null => text, onFailure: () => null}),
						);
			const rules = rulesOfBoth(
				[textOf(repository.baseConfig), textOf(repository.headConfig)],
				declared,
			);

			return {
				pr: url,
				head,
				replay: asked !== null,
				state:
					pr.state === "MERGED"
						? "merged"
						: pr.state === "CLOSED"
							? "closed"
							: pr.isDraft
								? "draft"
								: "open",
				ticket:
					ticket === null
						? "none"
						: {
								id: `${ticket.owner ?? at.owner}/${ticket.name ?? at.name}#${ticket.number}`,
								link: ticket.link,
							},
				criteria,
				// A diff that did not come leaves the files without their text: neither is given.
				files:
					paths === null || diff === null
						? null
						: paths.map((path) => ({path, kind: textKindOf(path)})),
				kinds:
					paths === null || paths.length === 0 || rules === null ? null : kindsNeeded(paths, rules),
				diff,
				deviations: deviationsIn(pr.body),
				checks: checksOf(repository.commit.statusCheckRollup, counted),
				rules: repoRulesOf(repository),
			};
		});

// ---------------------------------------------------------------- the two waits

const CHECKS_NOW = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { headRefOid commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } }
  }
}`;
const ChecksNow = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.Struct({
				headRefOid: Schema.String,
				commits: Schema.Struct({
					nodes: Schema.Array(
						Schema.Struct({
							commit: Schema.Struct({
								oid: Schema.String,
								statusCheckRollup: Schema.NullOr(Schema.Struct({state: Schema.String})),
							}),
						}),
					),
				}),
			}),
		}),
	}),
});
/** One run of a workflow, as GitHub's REST API answers. `run_attempt`: which try it is on. */
const RunNow = Schema.Struct({status: Schema.String, run_attempt: Schema.Number});

/**
 * Whether the checks of `head` have settled, read once. A head that is no
 * longer this one counts as settled: this wait is over, and the fresh read
 * that follows finds the new head. A re-run has settled only when each run
 * started again has finished a later try than the one it was on: until
 * then GitHub still shows the old red run, which must not be taken for the
 * answer. A read that fails says "not yet".
 */
export const checksSettledNow = (
	gh: Gh,
	url: string,
	head: string,
	after: readonly Rerun[],
): Effect.Effect<boolean> =>
	Effect.gen(function* () {
		const at = prOf(url);
		if (at === null) return false;
		const pr = (yield* ask(gh, ChecksNow, CHECKS_NOW, at)).data.repository.pullRequest;
		if (pr.headRefOid !== head) return true;
		const [last] = pr.commits.nodes;
		const state = last?.commit.oid === head ? last.commit.statusCheckRollup?.state : undefined;
		// No check has reported, or one is still running or still expected.
		if (state === undefined || state === "PENDING" || state === "EXPECTED") return false;
		for (const {run, attempt} of after) {
			const now = yield* answerOf(gh, RunNow, [
				"api",
				`repos/${at.owner}/${at.name}/actions/runs/${run}`,
			]);
			if (now.run_attempt <= attempt || now.status !== "completed") return false;
		}
		return true;
	}).pipe(Effect.match({onSuccess: (settled) => settled, onFailure: () => false}));

const QUEUE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { state isInMergeQueue mergeCommit { oid } } }
}`;
/** The same read, with GitHub's own record of each time the pull request went into the merge queue and came out of it. */
const QUEUE_RECORD = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      isInMergeQueue
      mergeCommit { oid }
      timelineItems(last: 20, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes { __typename ... on AddedToMergeQueueEvent { createdAt } ... on RemovedFromMergeQueueEvent { createdAt reason } }
      }
    }
  }
}`;

const QueueStands = {
	state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
	isInMergeQueue: Schema.Boolean,
	mergeCommit: Schema.NullOr(Schema.Struct({oid: Schema.String})),
};
/**
 * One time the pull request went into the merge queue or came out of it, as
 * GitHub recorded it. `reason`: why it came out. GitHub writes a "removed"
 * event for a merge too, with the reason `merged`; a pull request thrown out
 * has another one (`failed_checks`, `merge_conflict`, `manual`).
 */
const QueueEvent = Schema.Struct({
	__typename: Schema.Literals(["AddedToMergeQueueEvent", "RemovedFromMergeQueueEvent"]),
	createdAt: Schema.String,
	reason: Schema.optional(Schema.NullOr(Schema.String)),
});
type QueueEvent = typeof QueueEvent.Type;
const QueueNow = Schema.Struct({
	data: Schema.Struct({repository: Schema.Struct({pullRequest: Schema.Struct(QueueStands)})}),
});
const QueueRecordNow = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.Struct({
				...QueueStands,
				timelineItems: Schema.Struct({nodes: Schema.Array(Schema.NullOr(QueueEvent))}),
			}),
		}),
	}),
});

/** How a pull request left the merge queue. `commit`: the commit on the base branch. */
export type LeftQueue =
	| {readonly reading: "landed"; readonly commit: string}
	| {readonly reading: "ejected"};
const EJECTED: LeftQueue = {reading: "ejected"};

/**
 * Where a pull request stands with the merge queue, in one read. `events`:
 * GitHub's record of its times in and out, oldest first. `null`: that record
 * could not be read.
 */
export interface QueueRead {
	readonly state: "OPEN" | "CLOSED" | "MERGED";
	readonly inQueue: boolean;
	/** The commit GitHub made on the base branch. `null`: none, or not named yet. */
	readonly commit: string | null;
	readonly events: readonly QueueEvent[] | null;
}

/** What one wait on the queue keeps from a read to the next. */
export interface QueueWatch {
	/**
	 * The date of the newest event on the first read of the record. That read
	 * is made as the wait opens, right after our enqueue, so an event dated up
	 * to here is from before it. `null`: the record was empty then.
	 * `undefined`: the record has not been read yet.
	 */
	readonly before: number | null | undefined;
	/** The reads in a row that showed it open and out of the queue, with no record to say why: how many, and when the first one was. */
	readonly out: {readonly reads: number; readonly since: number} | null;
}
/** A wait that has read nothing yet. */
export const OPENED: QueueWatch = {before: undefined, out: null};

/**
 * When "open and out of the queue" alone counts as thrown out. Only used
 * while the record cannot be read: that many reads in a row, the first and
 * the last at least `outMs` apart.
 */
export interface OutLimits {
	readonly outPolls: number;
	readonly outMs: number;
}
export const DEFAULT_OUT: OutLimits = {outPolls: 3, outMs: 90_000};

/**
 * One read of the queue, weighed with what the reads before it showed.
 * `left: null`: not known yet, so the wait goes on.
 *
 * - Merged is `landed`, with the commit GitHub made on the base branch.
 * - `ejected` needs GitHub's own word that the pull request came out without
 *   merging: it is closed, or the newest event of the record is a "removed"
 *   one, dated after our enqueue, with a reason other than `merged`.
 * - "Open and not in the queue" is not that word. GitHub can answer it for a
 *   moment right after an enqueue, while the pull request is in the queue.
 *   It counts only while the record cannot be read, and only past `limits`.
 */
export function queueStep(
	limits: OutLimits,
	watch: QueueWatch,
	read: QueueRead,
	now: number,
): {readonly watch: QueueWatch; readonly left: LeftQueue | null} {
	// Merged, and GitHub has not named the commit yet: not an answer yet.
	if (read.state === "MERGED")
		return {watch, left: read.commit === null ? null : {reading: "landed", commit: read.commit}};
	if (read.state === "CLOSED") return {watch, left: EJECTED};
	if (read.events !== null) {
		const dates = read.events.map((event) => Date.parse(event.createdAt));
		const before =
			watch.before !== undefined ? watch.before : dates.length === 0 ? null : Math.max(...dates);
		const last = read.events.at(-1);
		const thrownOut =
			last?.__typename === "RemovedFromMergeQueueEvent" &&
			// No reason given is not a word that it came out without merging.
			typeof last.reason === "string" &&
			last.reason !== "merged" &&
			(before === null || Date.parse(last.createdAt) > before);
		return {watch: {before, out: null}, left: thrownOut ? EJECTED : null};
	}
	if (read.inQueue) return {watch: {...watch, out: null}, left: null};
	const out = {reads: (watch.out?.reads ?? 0) + 1, since: watch.out?.since ?? now};
	return {
		watch: {...watch, out},
		left: out.reads >= limits.outPolls && now - out.since >= limits.outMs ? EJECTED : null,
	};
}

/**
 * Where the pull request stands with the queue, read once. The record of its
 * times in and out is asked for in the same call. When that call fails, the
 * plain read is asked alone, and the answer says the record could not be
 * read. `null`: neither call answered.
 */
export const queueNow = (gh: Gh, url: string): Effect.Effect<QueueRead | null> =>
	Effect.gen(function* () {
		const at = prOf(url);
		if (at === null) return null;
		const stands = (pr: typeof QueueNow.Type.data.repository.pullRequest) => ({
			state: pr.state,
			inQueue: pr.isInMergeQueue,
			commit: pr.mergeCommit?.oid ?? null,
		});
		const whole = yield* Effect.option(ask(gh, QueueRecordNow, QUEUE_RECORD, at));
		if (Option.isSome(whole)) {
			const pr = whole.value.data.repository.pullRequest;
			return {...stands(pr), events: pr.timelineItems.nodes.filter((event) => event !== null)};
		}
		return {
			...stands((yield* ask(gh, QueueNow, QUEUE, at)).data.repository.pullRequest),
			events: null,
		};
	}).pipe(Effect.match({onSuccess: (read): QueueRead | null => read, onFailure: () => null}));

/** A read asked now and then every `every` ms, until it has an answer. It says that answer once and ends. */
const until = <A>(every: number, read: Effect.Effect<A | null>): Stream.Stream<A> =>
	Stream.fromEffectSchedule(read, Schedule.spaced(every)).pipe(
		Stream.filter((answer): answer is A => answer !== null),
		Stream.take(1),
	);

/** How the pull request leaves the queue: each read weighed with the ones before it, in a watch this one wait owns. A read that failed is not counted. */
const leftQueue = (
	gh: Gh,
	url: string,
	every: number,
	limits: OutLimits,
): Stream.Stream<LeftQueue> =>
	Stream.suspend(() => {
		let watch = OPENED;
		return until(
			every,
			Effect.gen(function* () {
				const read = yield* queueNow(gh, url);
				if (read === null) return null;
				const next = queueStep(limits, watch, read, yield* Clock.currentTimeMillis);
				watch = next.watch;
				return next.left;
			}),
		);
	});

/** How the two waits ask. Each is a setting of the run. */
export interface Polling extends Partial<OutLimits> {
	/** How often a wait asks again. 30 seconds when left out. */
	readonly pollMs?: number;
	/** Which checks a review waits on. `required` when left out. */
	readonly checks?: Counted;
}

/** `owner` and `name`, from a repository's URL, `https://github.com/<owner>/<name>`. */
export function repoOf(url: string): {readonly owner: string; readonly name: string} | null {
	const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/.exec(url);
	return m === null ? null : {owner: m[1] as string, name: m[2] as string};
}

/** One open pull request as REST's list answers it: only what a list shows. */
const Listed = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	// A link that is not GitHub's own is not a pull request's page: the answer is not read.
	html_url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\//)),
	draft: Schema.optional(Schema.Boolean),
	updated_at: Schema.String,
});

/** The most open pull requests read: one page. */
export const MOST_PULL_REQUESTS = 100;

/**
 * A repository's open pull requests, newest first: one REST call,
 * `GET /repos/{owner}/{name}/pulls?state=open`. More than one page reads the
 * first only.
 */
export const readPullRequests =
	(gh: Gh) =>
	(repo: string): Effect.Effect<readonly PullRequest[], {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = repoOf(repo);
			if (at === null) return yield* failed;
			const listed = yield* answerOf(gh, Schema.Array(Listed), [
				"api",
				`repos/${at.owner}/${at.name}/pulls?state=open&per_page=${MOST_PULL_REQUESTS}`,
			]);
			return listed.map((pr): PullRequest => ({
				number: pr.number,
				title: pr.title,
				url: pr.html_url,
				draft: pr.draft ?? false,
				at: Date.parse(pr.updated_at) || 0,
			}));
		});

/** The read side over one `gh`. */
export const codeHostOn = (
	gh: Gh,
	config: Accounts & Polling & {readonly declared?: Declared},
): CodeHost["Service"] => {
	const every = config.pollMs ?? 30_000;
	const limits = {
		outPolls: config.outPolls ?? DEFAULT_OUT.outPolls,
		outMs: config.outMs ?? DEFAULT_OUT.outMs,
	};
	const declared = config.declared ?? {};
	return {
		prFacts: readPrFacts(gh, config, declared),
		change: readChange(gh, config.checks, declared.kinds ?? null),
		pullRequests: readPullRequests(gh),
		checksSettled: (pr, head, after) =>
			until(
				every,
				Effect.map(checksSettledNow(gh, pr, head, after), (settled) => (settled ? true : null)),
			).pipe(Stream.map(() => undefined)),
		// The Listen opens once the enqueue is confirmed, so the first read here is the one right after it.
		leftQueue: (pr) => leftQueue(gh, pr, every, limits),
	};
};

/**
 * `CodeHost` on GitHub. The accounts are settings of the run, and so are
 * `pollMs`, `outPolls` and `outMs`, and what the repository `declared` in
 * place of a file it lacks. `gh`: the GitHub CLI to run, for a test that
 * stands one in.
 */
export const gitHubCodeHost = (
	config: Accounts & Polling & {readonly gh?: string; readonly declared?: Declared},
) =>
	Layer.succeed(
		CodeHost,
		codeHostOn((args) => sh(config.gh ?? "gh", args), config),
	);
