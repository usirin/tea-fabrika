// Experiment 138: the tracker's details, read off kamp-us/demlik's real history.
//
// The owner decided tickets start in our own tracker (docs/direction/tickets-start-in-our-tracker.md):
// a ticket is facts on the ledger (`filed`, `edited`, `approved` with a hash of the text it saw).
// This script measures, over every demlik issue and pull request:
//
//   part 1  what a ticket uses: labels, comments and who wrote them, edits, renames, links to
//           other tickets, task lists, images, milestones, assignees, parents
//   part 2  how often a yes would have gone stale: body edits and renames after the first
//           `ready-for:agent` label (and after a `pitch-approved` comment), each read by hand
//           (`138-truth.json`)
//   part 3  how pull requests name their issue, and how issues get closed
//   part 4  does triage answer the same when it sees the tracker's shape (title and body) as when
//           it also sees the comments that stood before triage? This repo's sort stage on both
//   part 5  the three facts as Effect Schemas, `covers`, and a property test of it (fast-check)
//
// Run with
//   node experiments/138-tracker-on-demlik.ts
//
//   STEP=fetch   every demlik issue and pull request through `gh api graphql` (read-only).
//                Writes only CACHE
//   STEP=count   parts 1 to 3 from CACHE and 138-truth.json, saved to RESULTS (numbers and issue
//                numbers only, no text, no logins)
//   STEP=edits   print each body edit and rename after the yes as a short diff, to read by hand.
//                LABEL=<kind> for one kind only
//   STEP=triage  part 4. ONLY=<n,n>, DRY=1 prints the estimate, PROMPT=1 prints the first
//                prompt pair, MAX_USD (default 10). Opus at effort medium, through the Agent SDK
//                with no tools; needs CLAUDE_CODE_OAUTH_TOKEN
//   STEP=props   part 5's property test. RUNS (default 2000)
//   (no STEP)    print the tables from RESULTS, then run the property test
//
// CACHE (default `runs/exp-138-cache`) holds issue text and logins and is never committed.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, `node:crypto` for sha256, as the other replay scripts do.
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {nextTry} from "@kampus/pipeline/combos";
import {Id, make} from "@kampus/pipeline/entity";
import {type Said, SortReply, saidOf} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import type {OpenPlan} from "@kampus/pipeline/stages/sort/services";
import {sorterOptions} from "@kampus/pipeline/stages/sort/sorter";
import {Option, Schema} from "effect";
import * as fc from "fast-check";
import {REPO_NOTE} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-138-cache");
const STEP = process.env.STEP ?? "tables";
const RESULTS = join(here, "results", "138-tracker-on-demlik.json");
const TRUTH = join(here, "138-truth.json");
const OWNER = "kamp-us";
const NAME = "demlik";
const only = process.env.ONLY?.split(",").map(Number);

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

// ================================================================ fetch

const ISSUES = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
issues(first:15,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
 pageInfo{hasNextPage endCursor}
 nodes{
  number title body state stateReason createdAt closedAt authorAssociation author{login __typename}
  labels(first:30){nodes{name}}
  milestone{title}
  assignees(first:10){totalCount}
  parent{number}
  subIssues(first:1){totalCount}
  reactions{totalCount}
  closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number merged}}
  comments(first:100){totalCount nodes{createdAt authorAssociation author{login __typename} body}}
  userContentEdits(first:100){totalCount nodes{editedAt diff editor{login}}}
  timelineItems(first:250,itemTypes:[LABELED_EVENT,UNLABELED_EVENT,RENAMED_TITLE_EVENT,CROSS_REFERENCED_EVENT,CLOSED_EVENT,REOPENED_EVENT,MILESTONED_EVENT,ASSIGNED_EVENT,CONNECTED_EVENT,SUB_ISSUE_ADDED_EVENT,PARENT_ISSUE_ADDED_EVENT]){
   totalCount
   nodes{
    __typename
    ... on LabeledEvent{createdAt label{name} actor{login}}
    ... on UnlabeledEvent{createdAt label{name} actor{login}}
    ... on RenamedTitleEvent{createdAt previousTitle currentTitle actor{login}}
    ... on CrossReferencedEvent{createdAt isCrossRepository source{__typename ... on Issue{number} ... on PullRequest{number}}}
    ... on ClosedEvent{createdAt stateReason closer{__typename ... on PullRequest{number merged} ... on Commit{oid}}}
    ... on ReopenedEvent{createdAt}
    ... on MilestonedEvent{createdAt}
    ... on AssignedEvent{createdAt}
    ... on ConnectedEvent{createdAt}
    ... on SubIssueAddedEvent{createdAt}
    ... on ParentIssueAddedEvent{createdAt}
   }
  }
 }
}}}`;

const PULLS = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
pullRequests(first:50,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
 pageInfo{hasNextPage endCursor}
 nodes{
  number title body state merged mergedAt createdAt authorAssociation author{login __typename}
  closingIssuesReferences(first:20){nodes{number}}
 }
}}}`;

type Page = {pageInfo: {hasNextPage: boolean; endCursor: string | null}; nodes: unknown[]};

async function pages(text: string, key: "issues" | "pullRequests"): Promise<unknown[]> {
	const out: unknown[] = [];
	let after: string | null = null;
	for (;;) {
		const args = ["api", "graphql", "-f", `query=${text}`, "-F", `owner=${OWNER}`];
		args.push("-F", `name=${NAME}`);
		if (after !== null) args.push("-F", `after=${after}`);
		const reply = JSON.parse(await gh(args)) as {data: unknown; errors?: unknown};
		if (reply.errors !== undefined) throw new Error(JSON.stringify(reply.errors).slice(0, 500));
		const page = (reply.data as {repository: Record<string, Page>}).repository[key] as Page;
		out.push(...page.nodes);
		process.stderr.write(`${key}: ${out.length}\n`);
		if (!page.pageInfo.hasNextPage) return out;
		after = page.pageInfo.endCursor;
	}
}

// ================================================================ the cache, typed

const At = Schema.String;
const Who = Schema.NullOr(Schema.Struct({login: Schema.String, __typename: Schema.String}));
const Event = Schema.Struct({
	__typename: Schema.String,
	createdAt: Schema.optional(At),
	label: Schema.optional(Schema.Struct({name: Schema.String})),
	previousTitle: Schema.optional(Schema.String),
	currentTitle: Schema.optional(Schema.String),
	isCrossRepository: Schema.optional(Schema.Boolean),
	source: Schema.optional(
		Schema.Struct({__typename: Schema.String, number: Schema.optional(Schema.Int)}),
	),
	stateReason: Schema.optional(Schema.NullOr(Schema.String)),
	closer: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				__typename: Schema.String,
				number: Schema.optional(Schema.Int),
				merged: Schema.optional(Schema.Boolean),
			}),
		),
	),
});
const Comment = Schema.Struct({
	createdAt: At,
	authorAssociation: Schema.String,
	author: Who,
	body: Schema.String,
});
type Comment = typeof Comment.Type;
const Revision = Schema.Struct({editedAt: At, diff: Schema.NullOr(Schema.String)});
const Issue = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: Schema.Literals(["OPEN", "CLOSED"]),
	stateReason: Schema.NullOr(Schema.String),
	createdAt: At,
	closedAt: Schema.NullOr(At),
	authorAssociation: Schema.String,
	author: Who,
	labels: Schema.Struct({nodes: Schema.Array(Schema.Struct({name: Schema.String}))}),
	milestone: Schema.NullOr(Schema.Struct({title: Schema.String})),
	assignees: Schema.Struct({totalCount: Schema.Int}),
	parent: Schema.NullOr(Schema.Struct({number: Schema.Int})),
	subIssues: Schema.Struct({totalCount: Schema.Int}),
	reactions: Schema.Struct({totalCount: Schema.Int}),
	closedByPullRequestsReferences: Schema.Struct({
		nodes: Schema.Array(Schema.Struct({number: Schema.Int, merged: Schema.Boolean})),
	}),
	comments: Schema.Struct({totalCount: Schema.Int, nodes: Schema.Array(Comment)}),
	userContentEdits: Schema.Struct({totalCount: Schema.Int, nodes: Schema.Array(Revision)}),
	timelineItems: Schema.Struct({totalCount: Schema.Int, nodes: Schema.Array(Event)}),
});
type Issue = typeof Issue.Type;
const Pull = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
	merged: Schema.Boolean,
	mergedAt: Schema.NullOr(At),
	createdAt: At,
	authorAssociation: Schema.String,
	closingIssuesReferences: Schema.Struct({
		nodes: Schema.Array(Schema.Struct({number: Schema.Int})),
	}),
});
type Pull = typeof Pull.Type;

const load = () => {
	const file = join(CACHE, "issues.json");
	if (!existsSync(file)) {
		console.error(`no ${file}: run STEP=fetch first`);
		process.exit(1);
	}
	const read = (name: string) => JSON.parse(readFileSync(join(CACHE, name), "utf8"));
	return {
		issues: Schema.decodeUnknownSync(Schema.Array(Issue))(read("issues.json")),
		pulls: Schema.decodeUnknownSync(Schema.Array(Pull))(read("pulls.json")),
	};
};

// ================================================================ small readers, all pure

const median = (xs: readonly number[]) => {
	const s = xs.toSorted((a, b) => a - b);
	return s.length === 0 ? 0 : (s[Math.floor((s.length - 1) / 2)] ?? 0);
};
const pctOf = (xs: readonly number[], p: number) => {
	const s = xs.toSorted((a, b) => a - b);
	return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0);
};
const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((100 * n) / d)}%`);
const labelsOf = (i: Issue) => i.labels.nodes.map((l) => l.name);
const events = (i: Issue, type: string) =>
	i.timelineItems.nodes.filter((e) => e.__typename === type);
const labelledAt = (i: Issue, name: string): string | undefined =>
	events(i, "LabeledEvent")
		.filter((e) => e.label?.name === name)
		.flatMap((e) => (e.createdAt === undefined ? [] : [e.createdAt]))
		.sort()[0];
/** Revisions oldest first. GitHub's oldest is the text as filed, at the filing time. */
const revisionsOf = (i: Issue) =>
	i.userContentEdits.nodes.toSorted((a, b) => a.editedAt.localeCompare(b.editedAt));

/** The closing words GitHub reads, and fabrika's `Part of #N` and demlik's `Refs #N`. */
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[ \t]*:?[ \t]*#(\d+)/gi;
const PART_OF = /\bpart of\b[ \t]*:?[ \t]*#(\d+)/gi;
const REFS = /\brefs?\b[ \t]*:?[ \t]*#(\d+)/gi;
const numbersIn = (re: RegExp, text: string) => [
	...new Set([...text.matchAll(re)].map((m) => Number(m[1]))),
];

/**
 * A comment, by what it is for, read off its first line; the patterns came from reading them.
 * `marker`: a machine-read line of today's fabrika (a claim, a verdict, an approval, a JSON row).
 * `lane_note`: a lane's status for people (stopped, parked, split). `closing_note`: what built or
 * closed it. `ruling`: an owner's call. `finding`: anything else, mostly more facts about the work.
 */
const COMMENT_KINDS = ["marker", "lane_note", "closing_note", "ruling", "finding"] as const;
type CommentKind = (typeof COMMENT_KINDS)[number];
const kindOf = (c: Comment): CommentKind => {
	const head = c.body.trimStart();
	if (
		/^<!--|^\{|^(review-[a-z]+|governance|lane-claim|decision-ruled|grill-round|pitch-approved|pitch-ruled|plan-approved|check-epic-plan|campaign-approve|build-deviations|lane|fabrika)[: ]/i.test(
			head,
		)
	)
		return "marker";
	if (
		/^(\*\*|## )?(Lane|Operator|Builder|Build|Driver)\b[^\n]*(parked|stopped|STOPPED|note|park)|^(\*\*)?(Builder )?STOPPED|^Build stopped|^Driver note|^Repair round|^Lane parked|^split into|^(\*\*)?Operator\b/i.test(
			head,
		)
	)
		return "lane_note";
	if (
		/^(Built|Shipped|Delivered|Fixed|Landed|Opened|PR:?|Folded|Closed|Closing|Superseded|Merged|Done|On hold|Reopening|Replaced)\b/i.test(
			head,
		)
	)
		return "closing_note";
	if (
		/^(\*\*)?Ruling|^Ruled|^Given in session|^All questions in this session|^Founder (direction|ruling)|^Shape the founders agreed/i.test(
			head,
		)
	)
		return "ruling";
	return "finding";
};

const IMAGE =
	/!\[[^\]]*\]\(|<img\b|user-attachments\/|githubusercontent\.com\/[^\s)]*\.(png|jpe?g|gif|webp)/i;
const TASK = /^\s*[-*] \[[ xX]\]/m;
const TICKET_MENTION = /(?:^|[\s(])#(\d+)\b|github\.com\/kamp-us\/demlik\/(?:issues|pull)\/(\d+)/g;

// ---------------------------------------------------------------- line diffs, for part 2

function lineDiff(a: readonly string[], b: readonly string[]) {
	const n = a.length;
	const m = b.length;
	// The longest common subsequence table, flat: lcs(i, j) is over a[i..] and b[j..].
	const dp = new Int32Array((n + 1) * (m + 1));
	const lcs = (i: number, j: number) => dp[i * (m + 1) + j] ?? 0;
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i * (m + 1) + j] =
				a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
	const gone: string[] = [];
	const added: string[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			i++;
			j++;
		} else if (lcs(i + 1, j) >= lcs(i, j + 1)) gone.push(a[i++] ?? "");
		else added.push(b[j++] ?? "");
	}
	gone.push(...a.slice(i));
	added.push(...b.slice(j));
	return {gone: gone.filter((l) => l.trim() !== ""), added: added.filter((l) => l.trim() !== "")};
}
const linesOf = (s: string) =>
	s
		.replace(/\r/g, "")
		.split("\n")
		.map((l) => l.trimEnd());
const isBox = (l: string) => /^\s*[-*] \[[ xX]\]/.test(l);
const isFrame = (l: string) =>
	/^#+ *Acceptance criteria/i.test(l) || l.trim() === "---" || /^<sub>/.test(l);

/**
 * A first reading of one edit, by its lines. `criteria`: only task-list lines (and their heading)
 * came or went. `plan`: plan-epic's plan or ledger. `ruling`: a ruling or amendment was written in.
 * `other`: anything else, read by hand in `138-truth.json`.
 */
const EDIT_KINDS = ["criteria", "plan", "ruling", "other"] as const;
type EditKind = (typeof EDIT_KINDS)[number];
function firstReading(gone: readonly string[], added: readonly string[]): EditKind {
	const all = [...gone, ...added].join("\n");
	if (/## Plan \(plan-epic\)|Task ledger|^\| *#?\d+ *\|/m.test(all)) return "plan";
	if (/Ruled|Ruling|ruled|Amended|amended|Amendment/.test(added.join("\n"))) return "ruling";
	const rest = [...gone, ...added].filter((l) => !isBox(l) && !isFrame(l));
	return [...gone, ...added].some(isBox) && rest.length === 0 ? "criteria" : "other";
}

/** One body edit or rename after a yes. */
interface Late {
	readonly n: number;
	readonly at: string;
	readonly what: "body" | "title";
	readonly kind: EditKind;
	readonly gone: readonly string[];
	readonly added: readonly string[];
	/** Hours after the yes. */
	readonly hours: number;
	/** Before the first pull request that names the ticket was opened, or after it. */
	readonly when: "before_pr" | "after_pr" | "no_pr";
}

const keyOf = (l: {n: number; at: string}) => `${l.n}@${l.at}`;

// ================================================================ the hand reading

/** What an `other` edit was, read by hand. `meaningful`: it changes what is asked or built. */
const Reading = Schema.Struct({
	meaningful: Schema.Boolean,
	what: Schema.Literals([
		"scope",
		"criteria",
		"bundle",
		"ruling",
		"format",
		"wording",
		"revert",
		"meta",
	]),
	why: Schema.String,
});
const Truth = Schema.Struct({
	note: Schema.String,
	edits: Schema.Record(Schema.String, Reading),
});
const truth = existsSync(TRUTH)
	? Schema.decodeUnknownSync(Truth)(JSON.parse(readFileSync(TRUTH, "utf8")))
	: {note: "", edits: {}};

// ================================================================ parts 1 to 3

/** The pull requests that name a ticket, by how. Pure. */
function linksOf(pulls: readonly Pull[]) {
	const by = new Map<number, {closes: Pull[]; partOf: Pull[]; refs: Pull[]}>();
	const at = (n: number) => {
		const got = by.get(n) ?? {closes: [], partOf: [], refs: []};
		by.set(n, got);
		return got;
	};
	for (const p of pulls) {
		for (const n of numbersIn(CLOSING, p.body)) at(n).closes.push(p);
		for (const n of numbersIn(PART_OF, p.body)) at(n).partOf.push(p);
		for (const n of numbersIn(REFS, p.body)) at(n).refs.push(p);
	}
	return by;
}

/** Built: closed as done, and a merged pull request closed it or names it. */
function isBuilt(i: Issue, links: ReturnType<typeof linksOf>): boolean {
	if (i.state !== "CLOSED" || i.stateReason !== "COMPLETED") return false;
	const l = links.get(i.number);
	return (
		i.closedByPullRequestsReferences.nodes.some((p) => p.merged) ||
		events(i, "ClosedEvent").some(
			(e) => e.closer?.__typename === "PullRequest" && e.closer.merged,
		) ||
		(l !== undefined && [...l.closes, ...l.partOf].some((p) => p.merged))
	);
}

/** The first pull request that names the ticket, closing or `Part of`, when it was opened. */
const firstPrAt = (i: Issue, links: ReturnType<typeof linksOf>): string | undefined => {
	const l = links.get(i.number);
	return l === undefined ? undefined : [...l.closes, ...l.partOf].map((p) => p.createdAt).sort()[0];
};

/** Every body edit and rename after `yes`. Pure. */
function lateEdits(i: Issue, yes: string, prAt: string | undefined): Late[] {
	const out: Late[] = [];
	const hours = (t: string) => (Date.parse(t) - Date.parse(yes)) / 3_600_000;
	const when = (t: string) => (prAt === undefined ? "no_pr" : t < prAt ? "before_pr" : "after_pr");
	const revs = revisionsOf(i);
	for (const [k, r] of revs.entries()) {
		const before = revs[k - 1];
		if (before === undefined) continue;
		if (r.editedAt <= yes || r.diff === null || before.diff === null) continue;
		const {gone, added} = lineDiff(linesOf(before.diff), linesOf(r.diff));
		out.push({
			n: i.number,
			at: r.editedAt,
			what: "body",
			kind: firstReading(gone, added),
			gone,
			added,
			hours: hours(r.editedAt),
			when: when(r.editedAt),
		});
	}
	for (const e of events(i, "RenamedTitleEvent")) {
		if (e.createdAt === undefined || e.createdAt <= yes) continue;
		out.push({
			n: i.number,
			at: e.createdAt,
			what: "title",
			kind: "other",
			gone: [e.previousTitle ?? ""],
			added: [e.currentTitle ?? ""],
			hours: hours(e.createdAt),
			when: when(e.createdAt),
		});
	}
	return out;
}

/** Is this late edit meaningful: does it change what is asked or built? */
const meaningful = (l: Late): boolean | undefined =>
	l.kind === "other" ? truth.edits[keyOf(l)]?.meaningful : true;

function count() {
	const {issues, pulls} = load();
	const links = linksOf(pulls);
	const built = issues.filter((i) => isBuilt(i, links));
	const isPull = new Set(pulls.map((p) => p.number));

	// ---------------- part 1: what a ticket uses
	const families: Record<string, number> = {};
	for (const i of issues)
		for (const name of new Set(
			labelsOf(i).map((l) => (l.includes(":") ? `${l.split(":")[0]}:` : l)),
		))
			families[name] = (families[name] ?? 0) + 1;
	const commentsPer = issues.map((i) => i.comments.totalCount);
	const assoc: Record<string, number> = {};
	const accounts = new Set<string>();
	const kinds = Object.fromEntries(COMMENT_KINDS.map((k) => [k, 0])) as Record<CommentKind, number>;
	for (const i of issues) {
		assoc[`issue:${i.authorAssociation}`] = (assoc[`issue:${i.authorAssociation}`] ?? 0) + 1;
		if (i.author !== null) accounts.add(i.author.login);
		for (const c of i.comments.nodes) {
			assoc[`comment:${c.authorAssociation}`] = (assoc[`comment:${c.authorAssociation}`] ?? 0) + 1;
			if (c.author !== null) accounts.add(c.author.login);
			kinds[kindOf(c)]++;
		}
	}
	/** On a built ticket, the comments that stood before its first pull request opened. */
	const beforeBuild = Object.fromEntries(
		COMMENT_KINDS.map((k) => [k, {comments: 0, tickets: 0}]),
	) as Record<CommentKind, {comments: number; tickets: number}>;
	const findingTickets: number[] = [];
	const rulingTickets: number[] = [];
	/** A finding or ruling before the build, and the body edited after it, before the build: carried into the text. */
	let carried = 0;
	let notCarried = 0;
	/** The same comments, by whether they came before the ticket's ready-for:agent label or after it. */
	const beforeYes = {finding: 0, ruling: 0};
	const afterYes = {finding: 0, ruling: 0};
	for (const i of built) {
		const prAt = firstPrAt(i, links) ?? i.closedAt ?? "9999";
		const seen = new Set<CommentKind>();
		for (const c of i.comments.nodes) {
			if (c.createdAt >= prAt) continue;
			const k = kindOf(c);
			beforeBuild[k].comments++;
			seen.add(k);
			if (k === "finding" || k === "ruling") {
				const yes = labelledAt(i, "ready-for:agent");
				if (yes === undefined || c.createdAt < yes) beforeYes[k]++;
				else afterYes[k]++;
				const edited = i.userContentEdits.nodes.some(
					(e) => e.editedAt > c.createdAt && e.editedAt < prAt,
				);
				if (edited) carried++;
				else notCarried++;
			}
		}
		for (const k of seen) beforeBuild[k].tickets++;
		if (seen.has("finding")) findingTickets.push(i.number);
		if (seen.has("ruling")) rulingTickets.push(i.number);
	}
	const share = (pick: (i: Issue) => boolean) => ({
		all: issues.filter(pick).length,
		built: built.filter(pick).length,
	});
	const bodyMentions = (i: Issue) =>
		[...i.body.matchAll(TICKET_MENTION)]
			.map((m) => Number(m[1] ?? m[2]))
			.filter((n) => n !== i.number);
	const uses = {
		anyLabel: share((i) => i.labels.nodes.length > 0),
		anyComment: share((i) => i.comments.totalCount > 0),
		rulingComment: share((i) => i.comments.nodes.some((c) => kindOf(c) === "ruling")),
		findingComment: share((i) => i.comments.nodes.some((c) => kindOf(c) === "finding")),
		bodyEdited: share((i) => i.userContentEdits.totalCount > 1),
		renamed: share((i) => events(i, "RenamedTitleEvent").length > 0),
		mentionsInBody: share((i) => bodyMentions(i).some((n) => !isPull.has(n))),
		crossReferenced: share((i) =>
			events(i, "CrossReferencedEvent").some((e) => e.source?.__typename === "Issue"),
		),
		taskList: share((i) => TASK.test(i.body)),
		criteriaHeading: share((i) => /^#+ *Acceptance criteria/im.test(i.body)),
		image: share((i) => IMAGE.test(i.body) || i.comments.nodes.some((c) => IMAGE.test(c.body))),
		milestone: share((i) => i.milestone !== null),
		assignee: share((i) => i.assignees.totalCount > 0),
		parent: share((i) => i.parent !== null),
		children: share((i) => i.subIssues.totalCount > 0),
		reactions: share((i) => i.reactions.totalCount > 0),
	};
	const truncated = issues
		.filter(
			(i) =>
				i.comments.totalCount > 100 ||
				i.userContentEdits.totalCount > 100 ||
				i.timelineItems.totalCount > 250,
		)
		.map((i) => i.number);

	// ---------------- part 2: late edits
	const late: Late[] = [];
	const yesTickets: number[] = [];
	const pitchLate: Late[] = [];
	const pitchTickets: number[] = [];
	/** Today's fabrika's epic plan approval, `plan-approved: #N @ <digest>`: one per digest it approved. */
	const planApproved: {n: number; markers: number; digests: number}[] = [];
	for (const i of issues) {
		const prAt = firstPrAt(i, links);
		const yes = labelledAt(i, "ready-for:agent");
		if (yes !== undefined) {
			yesTickets.push(i.number);
			late.push(...lateEdits(i, yes, prAt));
		}
		const approvals = i.comments.nodes.filter((c) => /^plan-approved:/.test(c.body.trimStart()));
		if (approvals.length > 0) {
			const digests = new Set(approvals.map((c) => /@ ([0-9a-f]+)/.exec(c.body)?.[1]));
			planApproved.push({n: i.number, markers: approvals.length, digests: digests.size});
		}
		const pitch = i.comments.nodes.find((c) => /^pitch-approved/.test(c.body))?.createdAt;
		if (pitch !== undefined) {
			pitchTickets.push(i.number);
			pitchLate.push(...lateEdits(i, pitch, prAt));
		}
	}
	const unread = late.filter((l) => meaningful(l) === undefined).map(keyOf);
	const ticketsWith = (ls: readonly Late[], pick: (l: Late) => boolean) =>
		new Set(ls.filter(pick).map((l) => l.n)).size;
	/** Under v1, criteria, plans and rulings are facts of their own, not the ticket's text. */
	const textOnly = (l: Late) => l.kind === "other";
	const byKind = Object.fromEntries(
		EDIT_KINDS.map((k) => [k, late.filter((l) => l.kind === k).length]),
	);
	const otherWhat: Record<string, number> = {};
	for (const l of late.filter(textOnly)) {
		const w = truth.edits[keyOf(l)]?.what ?? "unread";
		otherWhat[w] = (otherWhat[w] ?? 0) + 1;
	}
	const fired = {
		/** Hash over the whole body as GitHub holds it: criteria, plans and rulings inside. */
		wholeBody: ticketsWith(late, (l) => l.what === "body"),
		/** Hash over title and whole body. */
		titleAndWholeBody: ticketsWith(late, () => true),
		/** v1's split: criteria, plan and ruling are facts of their own; the hash is title + body text. */
		titleAndText: ticketsWith(late, textOnly),
		bodyTextOnly: ticketsWith(late, (l) => textOnly(l) && l.what === "body"),
		/** Of v1's, the ones a person would have wanted: the edit changed the ask. */
		titleAndTextMeaningful: ticketsWith(late, (l) => textOnly(l) && meaningful(l) === true),
		titleAndTextCosmetic: ticketsWith(late, (l) => textOnly(l) && meaningful(l) === false),
		/**
		 * v1's, meaningful, and more than an hour after the label: today the label is triage's stamp
		 * and its session often goes on writing for minutes; the owner's yes on a plan comes later.
		 */
		titleAndTextMeaningfulAfterHour: ticketsWith(
			late,
			(l) => textOnly(l) && meaningful(l) === true && l.hours >= 1,
		),
		/** Only a cosmetic edit after the yes: a new yes asked for nothing. */
		onlyCosmetic: [...new Set(late.filter(textOnly).map((l) => l.n))].filter((n) =>
			late.filter((l) => l.n === n && textOnly(l)).every((l) => meaningful(l) === false),
		).length,
	};
	const whenOf = (ls: readonly Late[]) => ({
		before_pr: ls.filter((l) => l.when === "before_pr").length,
		after_pr: ls.filter((l) => l.when === "after_pr").length,
		no_pr: ls.filter((l) => l.when === "no_pr").length,
	});
	const partTwo = {
		yesTickets: yesTickets.length,
		edits: late.length,
		bodyEdits: late.filter((l) => l.what === "body").length,
		renames: late.filter((l) => l.what === "title").length,
		renamesMeaningful: late.filter((l) => l.what === "title" && meaningful(l) === true).length,
		byKind,
		otherWhat,
		when: whenOf(late),
		whenByKind: Object.fromEntries(
			EDIT_KINDS.map((k) => [k, whenOf(late.filter((l) => l.kind === k))]),
		),
		whenText: whenOf(late.filter(textOnly)),
		textWithinHour: late.filter((l) => textOnly(l) && l.hours < 1).length,
		hoursMedian: Math.round(median(late.map((l) => l.hours)) * 10) / 10,
		within10Min: late.filter((l) => l.hours < 1 / 6).length,
		fired,
		pitch: {
			tickets: pitchTickets.length,
			edits: pitchLate.length,
			byKind: Object.fromEntries(
				EDIT_KINDS.map((k) => [k, pitchLate.filter((l) => l.kind === k).length]),
			),
			firedWholeBody: ticketsWith(pitchLate, () => true),
			firedText: ticketsWith(pitchLate, textOnly),
		},
		planApproved,
		otherEdits: late.filter(textOnly).map(keyOf),
		unread,
	};

	// ---------------- part 3: how pull requests name their issue
	const merged = pulls.filter((p) => p.merged);
	const linkShape = (p: Pull) => {
		const c = numbersIn(CLOSING, p.body).length;
		if (c > 1) return "closes_many";
		if (c === 1) return "closes_one";
		if (numbersIn(PART_OF, p.body).length > 0) return "part_of";
		if (numbersIn(REFS, p.body).length > 0) return "refs_only";
		return "none";
	};
	const shapes: Record<string, number> = {};
	for (const p of merged) shapes[linkShape(p)] = (shapes[linkShape(p)] ?? 0) + 1;
	const closesAPull = merged.filter((p) => numbersIn(CLOSING, p.body).some((n) => isPull.has(n)));
	const ghAgrees = merged.filter((p) => {
		const said = numbersIn(CLOSING, p.body)
			.filter((n) => !isPull.has(n))
			.sort();
		const gh = p.closingIssuesReferences.nodes.map((x) => x.number).sort();
		return said.join() === gh.join();
	}).length;
	const done = issues.filter((i) => i.state === "CLOSED" && i.stateReason === "COMPLETED");
	const closedBy = {byMergedPr: 0, byHandAfterMergedPr: 0, byHandNoPr: 0, byCommit: 0};
	const byHandAfter: number[] = [];
	for (const i of done) {
		const last = events(i, "ClosedEvent").at(-1);
		if (last?.closer?.__typename === "PullRequest") closedBy.byMergedPr++;
		else if (last?.closer?.__typename === "Commit") closedBy.byCommit++;
		else {
			const l = links.get(i.number);
			const named = l !== undefined && [...l.closes, ...l.partOf, ...l.refs].some((p) => p.merged);
			if (named) {
				closedBy.byHandAfterMergedPr++;
				byHandAfter.push(i.number);
			} else closedBy.byHandNoPr++;
		}
	}
	const manyTickets = merged.filter(
		(p) =>
			new Set([
				...numbersIn(CLOSING, p.body),
				...numbersIn(PART_OF, p.body),
				...numbersIn(REFS, p.body),
			]).size > 1,
	).length;
	const partThree = {
		pulls: pulls.length,
		merged: merged.length,
		shapes,
		closesAPullNumber: closesAPull.map((p) => p.number),
		githubAgreesWithBody: ghAgrees,
		namesMoreThanOneTicket: manyTickets,
		done: done.length,
		closedBy,
		byHandAfter,
		ticketsWithManyClosingPrs: [...links.entries()].filter(
			([, l]) => l.closes.filter((p) => p.merged).length > 1,
		).length,
	};

	// ---------------- part 4's draw: tickets that had comments before triage
	const triageDraw = issues.flatMap((i) => {
		const at = triageAt(i);
		if (at === undefined) return [];
		const before = i.comments.nodes.filter((c) => c.createdAt < at).length;
		return before > 0 ? [{n: i.number, comments: before}] : [];
	});
	const triaged = issues.filter((i) => triageAt(i) !== undefined).length;

	const saved = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {};
	const results = {
		...saved,
		counted: {
			issues: issues.length,
			open: issues.filter((i) => i.state === "OPEN").length,
			built: built.length,
			truncated,
			accounts: accounts.size,
			assoc,
			labelFamilies: families,
			comments: {
				total: commentsPer.reduce((a, b) => a + b, 0),
				median: median(commentsPer),
				p90: pctOf(commentsPer, 0.9),
				max: Math.max(...commentsPer),
				medianBuilt: median(built.map((i) => i.comments.totalCount)),
				kinds,
				beforeBuild,
				findingTickets,
				rulingTickets,
				carriedIntoBody: carried,
				notCarriedIntoBody: notCarried,
				beforeYes,
				afterYes,
			},
			uses,
		},
		partTwo,
		partThree,
		triage: {...saved.triage, triaged, withCommentsBefore: triageDraw},
	};
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(`saved ${RESULTS}`);
	if (unread.length > 0)
		console.log(`${unread.length} "other" edits not read by hand yet: STEP=edits LABEL=other`);
}

/** When triage first answered: its claim comment or its first label. */
function triageAt(i: Issue): string | undefined {
	const label = ["status:triaged", "ready-for:agent", "ready-for:human", "closed-by-triage"]
		.flatMap((name) => {
			const at = labelledAt(i, name);
			return at === undefined ? [] : [at];
		})
		.sort()[0];
	const claim = i.comments.nodes.find((c) => /fabrika-triage-claim/.test(c.body))?.createdAt;
	return [label, claim].filter((t): t is string => t !== undefined).sort()[0];
}

function printEdits() {
	const {issues, pulls} = load();
	const links = linksOf(pulls);
	const want = process.env.LABEL;
	for (const i of issues) {
		const yes = labelledAt(i, "ready-for:agent");
		if (yes === undefined) continue;
		for (const l of lateEdits(i, yes, firstPrAt(i, links))) {
			if (want !== undefined && l.kind !== want) continue;
			const read = truth.edits[keyOf(l)];
			console.log(
				`\n=== ${keyOf(l)} ${l.what} [${l.kind}] ${l.when} +${l.hours.toFixed(1)} h${read === undefined ? "" : ` read: ${read.what}`}`,
			);
			for (const line of l.gone.slice(0, 6)) console.log(`- ${line.slice(0, 160)}`);
			for (const line of l.added.slice(0, 6)) console.log(`+ ${line.slice(0, 160)}`);
		}
	}
}

// ================================================================ part 4: triage on both forms

const FORMS = ["tracker", "github"] as const;
type Form = (typeof FORMS)[number];
const SUMMARY = 300;
const MODEL = "opus";
/** Opus's list price per token, for the estimate only; what a call cost is read from the SDK. */
const OPUS_IN = 5 / 1e6;
const OPUS_OUT = 25 / 1e6;

const firstText = (i: Issue) => revisionsOf(i)[0]?.diff ?? i.body;
/** The body as it stood at `t`: the newest revision at or before it. */
const bodyAt = (i: Issue, t: string) =>
	revisionsOf(i)
		.filter((r) => r.editedAt <= t && r.diff !== null)
		.at(-1)?.diff ?? i.body;
const titleAt = (i: Issue, t: string) => {
	const later = events(i, "RenamedTitleEvent").find(
		(e) => e.createdAt !== undefined && e.createdAt > t,
	);
	return later?.previousTitle ?? i.title;
};

/**
 * The brief for one ticket as triage stood at it. `tracker`: title and body as they stood, as the
 * tracker's form holds them. `github`: the same, plus every comment that stood before triage, with
 * its author's association, as a GitHub issue page shows it. The sort brief has no comment slot,
 * so the comments go under the body, inside the ticket's fence. Pure.
 */
function briefOf(issues: readonly Issue[], i: Issue, form: Form): Brief {
	const at = triageAt(i) ?? i.createdAt;
	const closedBy = (x: Issue) => x.closedAt !== null && x.closedAt <= at;
	const before = issues
		.filter((x) => x.number !== i.number && x.createdAt < at)
		.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
	const plans: OpenPlan[] = before
		.filter((x) => !closedBy(x))
		.map((x) => {
			const text = firstText(x)
				.replace(/<!--[\s\S]*?-->/g, "")
				.replace(/^#+ .*$/gm, "")
				.replace(/\s+/g, " ")
				.trim();
			return {
				number: x.number,
				tickets: [x.number],
				summary: `${titleAt(x, at)}. ${text.length > SUMMARY ? `${text.slice(0, SUMMARY)}…` : text}`,
				approved: false,
			};
		});
	const comments = i.comments.nodes.filter((c) => c.createdAt < at);
	const body = bodyAt(i, at);
	const withComments =
		form === "tracker" || comments.length === 0
			? body
			: [
					body.trimEnd(),
					"",
					"---",
					"",
					"## Comments",
					"",
					...comments.flatMap((c) => [
						`### Comment by a ${c.authorAssociation.toLowerCase()}, ${c.createdAt.slice(0, 10)}`,
						"",
						c.body.trimEnd(),
						"",
					]),
				].join("\n");
	return {
		ticket: {
			url: `https://github.com/${OWNER}/${NAME}/issues/${i.number}`,
			number: i.number,
			state: "open",
			title: titleAt(i, at),
			body: withComments,
		},
		context: {
			earlier: before.map((x) => ({
				number: x.number,
				title: titleAt(x, at),
				state: closedBy(x) ? ("closed" as const) : ("open" as const),
				reason: null,
			})),
			plans,
		},
		note: REPO_NOTE,
	};
}

const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	input: Schema.Number,
	output: Schema.Number,
	cached: Schema.Number,
});
type Try = typeof Try.Type;
const SortRun = Schema.Struct({tries: Schema.Array(Try)});
type SortRun = typeof SortRun.Type;
const readReply = reader(SortReply);

async function callOnce(prompt: string, cwd: string): Promise<Omit<Try, "problems">> {
	const started = Date.now();
	const options = sorterOptions({model: MODEL, effort: "medium", budget: 1, note: ""}, cwd);
	for await (const message of query({
		prompt,
		options: {...options, outputFormat: {type: "json_schema", schema: jsonSchema(SortReply)}},
	})) {
		if (message.type === "result") {
			const u = message.usage;
			const answer =
				message.subtype === "success" ? readReply(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				input: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
				output: u.output_tokens,
				cached: u.cache_read_input_tokens ?? 0,
			};
		}
	}
	throw new Error("no result");
}

/** One sort as the machine runs it: a try, the Check, and one more try told the problems. */
async function sortOnce(brief: Brief, cwd: string): Promise<SortRun> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let k = 1; k <= 2; k++) {
		const got = await callOnce(promptFor(brief, note), cwd);
		const problems = got.answer === null ? [] : sortProblems(got.answer, brief);
		tries.push({...got, problems: [...problems]});
		if (got.answer === null) break;
		const next = nextTry(problems, k, 2);
		if (next.go !== "again") break;
		note = next.note;
	}
	return {tries};
}

const said = (r: SortRun | undefined): string => {
	const a = r?.tries.at(-1)?.answer;
	if (a === null || a === undefined) return "none";
	const s: Said = saidOf(a.sort);
	return s === "fold" && a.sort.answer === "yes" && a.sort.next === "plan"
		? `fold #${a.sort.partOf}`
		: s === "duplicate" && a.sort.answer === "duplicate"
			? `duplicate #${a.sort.of}`
			: s;
};
const usdOfRun = (r: SortRun) => r.tries.reduce((s, t) => s + t.usd, 0);

async function sortStep() {
	const {issues} = load();
	const results = JSON.parse(readFileSync(RESULTS, "utf8"));
	const draw: {n: number; comments: number}[] = results.triage.withCommentsBefore;
	// REPEAT=1: a second run of each case, kept apart under `repeats`, to tell a real difference
	// from the model's own noise.
	const key = process.env.REPEAT === "1" ? "repeats" : "runs";
	const runs: Record<string, Partial<Record<Form, SortRun>>> = results.triage[key] ?? {};
	const spentBefore = [results.triage.runs ?? {}, results.triage.repeats ?? {}]
		.flatMap((k: Record<string, Partial<Record<Form, SortRun>>>) => Object.values(k))
		.flatMap((r) => Object.values(r))
		.reduce((s: number, r) => s + usdOfRun(r as SortRun), 0);
	const byN = new Map(issues.map((i) => [i.number, i]));
	const todo = draw
		.filter((d) => only === undefined || only.includes(d.n))
		.flatMap((d) => FORMS.filter((f) => runs[d.n]?.[f] === undefined).map((f) => ({n: d.n, f})));
	const briefs = todo.flatMap((t) => {
		const i = byN.get(t.n);
		return i === undefined ? [] : [{...t, i, brief: briefOf(issues, i, t.f)}];
	});
	const chars = briefs.reduce((s, b) => s + promptFor(b.brief, null).length, 0);
	const estimate = (chars / 4) * OPUS_IN + briefs.length * 600 * OPUS_OUT;
	console.log(
		`${briefs.length} calls, about ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at opus's list price before the cache and before second tries`,
	);
	if (process.env.PROMPT === "1" && briefs[0] !== undefined) {
		console.log(
			promptFor(briefOf(issues, briefs[0].i, "github"), null).split("# Earlier tickets")[0],
		);
	}
	if (process.env.DRY === "1") return;
	const MAX_USD = Number(process.env.MAX_USD ?? 10);
	const already = spentBefore;
	let spent = already;
	const cwd = mkdtempSync(join(tmpdir(), "exp-138-"));
	for (const b of briefs) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}, the cap`);
			break;
		}
		const r = await sortOnce(b.brief, cwd);
		spent += usdOfRun(r);
		runs[b.n] = {...runs[b.n], [b.f]: r};
		results.triage[key] = runs;
		writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
		console.log(`#${b.n} ${b.f}: ${said(r)} ($${usdOfRun(r).toFixed(3)}, ${r.tries.length} tries)`);
	}
	console.log(`spent $${(spent - already).toFixed(2)} this run, $${spent.toFixed(2)} in all`);
}

// ================================================================ part 5: the three facts, a sketch

// A sketch, not in packages/: the tracker's three facts, the ticket folded from them, and the check
// that a yes still covers the ticket. The direction note's sketch hashed `sha256(title, body)`; a
// plain join of two strings lets "ab" + "c" and "a" + "bc" share a hash, so the text is hashed as
// a JSON pair.

/** A tracker ticket: a team key and a number, Linear's style (`demlik-1`), a guess the note keeps open. */
const TicketId = Id("TrackerTicketId", /^[a-z]+-[1-9][0-9]*$/);
type TicketId = typeof TicketId.Type;
const MemberId = Id("MemberId", /^[a-z][\w-]*$/);
const PlanId = Id("TrackerPlanId", /^p-[1-9][0-9]*$/);
/** The text a yes saw, as `sha256:<hex>`. A value: equal text, equal hash. */
const TextHash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/)).pipe(
	Schema.brand("TextHash"),
);
type TextHash = typeof TextHash.Type;
const Title = Schema.String.check(Schema.isMinLength(1));

/** A member files a ticket. */
const Filed = Schema.Struct({
	fact: Schema.Literal("filed"),
	ticket: TicketId,
	by: MemberId,
	title: Title,
	body: Schema.String,
});
/**
 * A member changes the title, the body, or both. An edit that names neither is refused: it would
 * be a fact that changes nothing. (Three structs in a union would not do: a struct drops keys it
 * does not know, so an edit of both would decode as the title-only one and lose its body.)
 */
const Edited = Schema.Struct({
	fact: Schema.Literal("edited"),
	ticket: TicketId,
	by: MemberId,
	title: Schema.optionalKey(Title),
	body: Schema.optionalKey(Schema.String),
}).check(
	Schema.makeFilter(
		(e) => e.title !== undefined || e.body !== undefined || "an edit changes the title or the body",
	),
);
/** The owner's yes on a plan, naming the text it saw. */
const Approved = Schema.Struct({
	fact: Schema.Literal("approved"),
	ticket: TicketId,
	by: MemberId,
	plan: PlanId,
	text: TextHash,
});
const Fact = Schema.Union([Filed, Edited, Approved]);
type Fact = typeof Fact.Type;
type Approved = typeof Approved.Type;
interface Ticket {
	readonly id: TicketId;
	readonly title: string;
	readonly body: string;
}

/** The text a yes binds: title and body, hashed as a pair. Pure. */
const textOf = (t: {readonly title: string; readonly body: string}): TextHash =>
	Schema.decodeSync(TextHash)(
		`sha256:${createHash("sha256")
			.update(JSON.stringify([t.title, t.body]))
			.digest("hex")}`,
	);

/** One ticket as its facts leave it. `undefined`: never filed. A fact before `filed` is ignored. Pure. */
const ticketOf = (facts: readonly Fact[], id: TicketId): Ticket | undefined =>
	facts.reduce<Ticket | undefined>((t, f) => {
		if (f.ticket !== id) return t;
		if (f.fact === "filed") return t ?? {id, title: f.title, body: f.body};
		if (f.fact === "edited" && t !== undefined)
			return {id, title: f.title ?? t.title, body: f.body ?? t.body};
		return t;
	}, undefined);

/** Does this yes still cover the ticket as it stands? Same ticket, same text. Pure. */
const covers = (yes: Approved, now: Ticket): boolean =>
	yes.ticket === now.id && yes.text === textOf(now);

/** In the property test every ticket is filed first, so a missing one is the test's own bug. */
const unfiled = (): never => {
	throw new Error("the test reads a ticket it never filed");
};

/** Equal as data, whatever order the keys came in. */
const same = (a: object, b: object) => {
	const sorted = (o: object) =>
		JSON.stringify(Object.entries(o).toSorted(([x], [y]) => x.localeCompare(y)));
	return sorted(a) === sorted(b);
};

function props(runs: number) {
	const id = (n: number) => make(TicketId)(`demlik-${n + 1}`);
	const owner = make(MemberId)("owner");
	const plan = make(PlanId)("p-1");
	const text = fc.string({unit: "grapheme", maxLength: 40});
	const title = fc.string({unit: "grapheme", minLength: 1, maxLength: 20});
	const ticket = fc.nat(50).map(id);
	const filed = fc
		.record({ticket, title, body: text})
		.map((r) => ({fact: "filed" as const, by: owner, ...r}));
	const editOf = (t: TicketId) =>
		fc
			.record({title, body: text}, {requiredKeys: []})
			.filter((e) => e.title !== undefined || e.body !== undefined)
			.map((e): Fact => ({fact: "edited", ticket: t, by: owner, ...e}));
	const approve = (t: Ticket): Approved => ({
		fact: "approved",
		ticket: t.id,
		by: owner,
		plan,
		text: textOf(t),
	});
	const check = <T>(name: string, prop: fc.IProperty<T>) => {
		const out = fc.check(prop, {numRuns: runs, seed: 138});
		const failed = out.failed ? `: ${fc.defaultReportMessage(out)}` : "";
		console.log(`${out.failed ? "FAIL" : "ok  "} ${name} (${out.numRuns} runs)${failed}`);
		return !out.failed;
	};
	const results = [
		check(
			"an untouched ticket is always covered, whatever edits came before the yes",
			fc.property(
				filed.chain((f) => fc.tuple(fc.constant(f), fc.array(editOf(f.ticket), {maxLength: 4}))),
				([f, edits]) => {
					const facts: Fact[] = [f, ...edits];
					const yes = approve(ticketOf(facts, f.ticket) ?? unfiled());
					return covers(yes, ticketOf([...facts, yes], f.ticket) ?? unfiled());
				},
			),
		),
		check(
			"an edit after the yes that changes the text is never covered",
			fc.property(
				filed.chain((f) =>
					fc.tuple(fc.constant(f), fc.array(editOf(f.ticket), {minLength: 1, maxLength: 4})),
				),
				([f, edits]) => {
					const yes = approve(ticketOf([f], f.ticket) ?? unfiled());
					const now = ticketOf([f, yes, ...edits], f.ticket) ?? unfiled();
					fc.pre(now.title !== f.title || now.body !== f.body);
					return !covers(yes, now);
				},
			),
		),
		check(
			"an edit that puts the text back is covered again (demlik #430 added and removed the same lines in 35 s)",
			fc.property(
				filed.chain((f) => fc.tuple(fc.constant(f), editOf(f.ticket))),
				([f, away]) => {
					const yes = approve(ticketOf([f], f.ticket) ?? unfiled());
					const back: Fact = {
						fact: "edited",
						ticket: f.ticket,
						by: owner,
						title: f.title,
						body: f.body,
					};
					return covers(yes, ticketOf([f, yes, away, back], f.ticket) ?? unfiled());
				},
			),
		),
		check(
			"a yes never covers another ticket, even one with the same text",
			fc.property(title, text, ticket, ticket, (t, b, x, y) => {
				fc.pre(x !== y);
				return !covers(approve({id: x, title: t, body: b}), {id: y, title: t, body: b});
			}),
		),
		check(
			"moving text between title and body changes the hash",
			fc.property(title, text, text, (t, mid, b) => {
				fc.pre(mid.length > 0);
				return textOf({title: t, body: `${mid}${b}`}) !== textOf({title: `${t}${mid}`, body: b});
			}),
		),
		check(
			"every fact the test makes decodes as itself (no key dropped)",
			fc.property(
				filed.chain((f) => fc.tuple(fc.constant(f), editOf(f.ticket))),
				([f, e]) => [f, e].every((x) => same(Schema.decodeUnknownSync(Fact)(x), x)),
			),
		),
	];
	// A planted mistake: a hash over the body only. The second property must catch it with a rename.
	const bodyOnly = (yes: Approved, now: Ticket) =>
		yes.ticket === now.id && yes.text === textOf({title: "", body: now.body});
	const approveBody = (t: Ticket): Approved => ({
		...approve(t),
		text: textOf({title: "", body: t.body}),
	});
	const planted = fc.check(
		fc.property(
			filed.chain((f) =>
				fc.tuple(fc.constant(f), fc.array(editOf(f.ticket), {minLength: 1, maxLength: 4})),
			),
			([f, edits]) => {
				const yes = approveBody(ticketOf([f], f.ticket) ?? unfiled());
				const now = ticketOf([f, yes, ...edits], f.ticket) ?? unfiled();
				fc.pre(now.title !== f.title || now.body !== f.body);
				return !bodyOnly(yes, now);
			},
		),
		{numRuns: runs, seed: 138},
	);
	console.log(
		`${planted.failed ? "ok  " : "FAIL"} the planted body-only hash is caught${planted.failed ? `, by a title-only edit: ${JSON.stringify(planted.counterexample?.[0]?.[1])}` : " by nothing"}`,
	);
	if (!planted.failed) process.exitCode = 1;
	const bad = [
		{fact: "edited", ticket: "demlik-1", by: "owner"},
		{fact: "filed", ticket: "demlik-1", by: "owner", title: "", body: "x"},
		{fact: "approved", ticket: "demlik-1", by: "owner", plan: "p-1", text: "sha256:nothex"},
		{fact: "filed", ticket: "kamp-us/demlik#1", by: "owner", title: "t", body: ""},
	];
	const refused = bad.filter((b) => Option.isNone(Schema.decodeUnknownOption(Fact)(b))).length;
	console.log(
		`${refused === bad.length ? "ok  " : "FAIL"} the schema refuses an empty edit, an empty title, a bad hash and a GitHub-style id (${refused} of ${bad.length})`,
	);
	if (results.some((r) => !r) || refused !== bad.length) process.exitCode = 1;
}

// ================================================================ tables

function tables() {
	if (!existsSync(RESULTS)) {
		console.log("no results yet: STEP=fetch, then STEP=count");
		return;
	}
	const r = JSON.parse(readFileSync(RESULTS, "utf8"));
	const c = r.counted;
	console.log(`\n# Part 1: what a demlik ticket uses (${c.issues} issues, ${c.built} built)\n`);
	console.log(
		`accounts that filed or commented: ${c.accounts}; associations: ${JSON.stringify(c.assoc)}`,
	);
	console.log("| used | all tickets | built tickets |");
	console.log("|---|---|---|");
	for (const [k, v] of Object.entries(c.uses) as [string, {all: number; built: number}][])
		console.log(
			`| ${k} | ${v.all} (${pct(v.all, c.issues)}) | ${v.built} (${pct(v.built, c.built)}) |`,
		);
	console.log(
		`\ncomments: ${c.comments.total} in all, median ${c.comments.median} a ticket (built ${c.comments.medianBuilt}), 90th percentile ${c.comments.p90}, most ${c.comments.max}`,
	);
	console.log(`comment kinds: ${JSON.stringify(c.comments.kinds)}`);
	console.log(
		`on built tickets, before the first pull request: ${JSON.stringify(c.comments.beforeBuild)}`,
	);
	console.log(`label families: ${JSON.stringify(c.labelFamilies)}`);

	const t = r.partTwo;
	console.log(`\n# Part 2: edits after the yes (${t.yesTickets} tickets got ready-for:agent)\n`);
	console.log(
		`${t.edits} edits after the yes: ${t.bodyEdits} body, ${t.renames} renames; first reading ${JSON.stringify(t.byKind)}; "other" read by hand ${JSON.stringify(t.otherWhat)}`,
	);
	console.log(
		`when: ${JSON.stringify(t.when)}; text edits only: ${JSON.stringify(t.whenText)}; median ${t.hoursMedian} h after the yes, ${t.within10Min} within 10 minutes`,
	);
	console.log("| the hash covers | tickets a new yes is asked of | share |");
	console.log("|---|---|---|");
	for (const [k, v] of Object.entries(t.fired) as [string, number][])
		console.log(`| ${k} | ${v} | ${pct(v, t.yesTickets)} |`);
	console.log(`pitch-approved: ${JSON.stringify(t.pitch)}`);
	if (t.unread.length > 0) console.log(`not read by hand: ${t.unread.join(", ")}`);

	const p = r.partThree;
	console.log(
		`\n# Part 3: how pull requests name their issue (${p.merged} merged of ${p.pulls})\n`,
	);
	console.log("| body names | merged pull requests |");
	console.log("|---|---|");
	for (const [k, v] of Object.entries(p.shapes) as [string, number][])
		console.log(`| ${k} | ${v} (${pct(v, p.merged)}) |`);
	console.log(
		`GitHub's closing list matches the body's closing words on ${p.githubAgreesWithBody} of ${p.merged}; a "Closes #N" naming a pull request: ${p.closesAPullNumber.length}; naming more than one ticket: ${p.namesMoreThanOneTicket}`,
	);
	console.log(`${p.done} tickets closed as done: ${JSON.stringify(p.closedBy)}`);

	const g = r.triage;
	console.log(`\n# Part 4: triage on the tracker's shape and on the GitHub page\n`);
	console.log(
		`${g.withCommentsBefore.length} of ${g.triaged} triaged tickets had a comment before triage`,
	);
	const runs: Record<string, Partial<Record<Form, SortRun>>> = g.runs ?? {};
	const repeats: Record<string, Partial<Record<Form, SortRun>>> = g.repeats ?? {};
	let usd = 0;
	let tokens = {input: 0, output: 0, cached: 0};
	let same = 0;
	let both = 0;
	console.log("| ticket | comments before triage | tracker | GitHub page |");
	console.log("|---|---|---|---|");
	for (const d of g.withCommentsBefore as {n: number; comments: number}[]) {
		const pair = runs[d.n];
		if (pair === undefined) continue;
		const again = repeats[d.n] ?? {};
		for (const run of [...Object.values(pair), ...Object.values(again)] as SortRun[]) {
			usd += usdOfRun(run);
			for (const x of run.tries)
				tokens = {
					input: tokens.input + x.input,
					output: tokens.output + x.output,
					cached: tokens.cached + x.cached,
				};
		}
		if (pair.tracker !== undefined && pair.github !== undefined) {
			both++;
			if (said(pair.tracker) === said(pair.github)) same++;
		}
		const twice = (f: Form) =>
			again[f] === undefined ? said(pair[f]) : `${said(pair[f])}, then ${said(again[f])}`;
		console.log(`| #${d.n} | ${d.comments} | ${twice("tracker")} | ${twice("github")} |`);
	}
	console.log(
		`same answer on ${same} of ${both}; spent $${usd.toFixed(2)}, ${JSON.stringify(tokens)}`,
	);
	if (process.env.WHY === "1")
		for (const [n, pair] of Object.entries(runs))
			for (const f of FORMS)
				console.log(`#${n} ${f}: ${pair[f]?.tries.at(-1)?.answer?.sort.why ?? ""}`);
}

// ================================================================ main

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const issues = await pages(ISSUES, "issues");
	writeFileSync(join(CACHE, "issues.json"), JSON.stringify(issues));
	const pulls = await pages(PULLS, "pullRequests");
	writeFileSync(join(CACHE, "pulls.json"), JSON.stringify(pulls));
	console.log(`cached ${issues.length} issues and ${pulls.length} pull requests in ${CACHE}`);
} else if (STEP === "count") count();
else if (STEP === "edits") printEdits();
else if (STEP === "triage") await sortStep();
else if (STEP === "props") props(Number(process.env.RUNS ?? 2000));
else {
	tables();
	console.log("\n# Part 5: covers, property test\n");
	props(Number(process.env.RUNS ?? 2000));
}
