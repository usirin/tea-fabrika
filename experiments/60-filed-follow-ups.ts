// A builder in today's fabrika may land a pull request that leaves part of its
// ticket undone, if it says so under `## Deviations` and files a follow-up
// issue. The ticket closes on merge and the follow-up waits in the triage
// queue. This counts how often that happens and what became of each follow-up,
// over every merged pull request of two public repos.
//
// Run with
//   CACHE=<a folder> node experiments/60-filed-follow-ups.ts
//
//   STEP=fetch    page every pull request and every issue of both repos into
//                 CACHE, then the comments of the hand sample's threads
//                 (`gh api graphql`, read-only; nothing is written to GitHub).
//                 A page already in CACHE is never asked again, so a run that
//                 stopped half way picks up where it was
//   STEP=sample   write the texts of the hand sample into CACHE/sample, to read
//   (no STEP)     with a filled CACHE: count, save the answers and print the
//                 tables. With no CACHE: print the tables from the saved
//                 answers. No key and no network either way
//
// CACHE defaults to `runs/exp-60-cache`, holds raw API answers with whole
// bodies, and is never committed. `60-readings.json` holds what was sorted by
// hand. `results/filed-follow-ups.json` holds every number, and one row for
// each follow-up: ids, dates, labels and the one line that matched. No row
// holds an account name, a branch name or a whole body.
import {spawnSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {verdictsIn} from "../src/verdict.ts";
import {fetchThreads, readThread} from "./lib/threads.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-60-cache");
const STEP = process.env.STEP ?? "tables";
const REPOS = ["kamp-us/phoenix", "kamp-us/demlik"] as const;
const resultsFile = join(here, "results", "filed-follow-ups.json");
const readingsFile = join(here, "60-readings.json");
/** How many cases the hand sample holds. */
const SAMPLE = 36;
/** Two more, smaller hand samples, one for each gap label: gaps that were stated and never filed. */
const STATED_SAMPLE = 20;

// ---------------------------------------------------------------- small tools

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} (${pct(n, of)})`;
const nameOf = (repo: string) => repo.split("/")[1] ?? repo;
const ms = (iso: string) => Date.parse(iso);
const short = (text: string, most: number) =>
	text.length > most ? `${text.slice(0, most - 1)}…` : text;
function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
): void {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
class Tally {
	readonly counts = new Map<string, number>();
	add(key: string, by = 1): void {
		this.counts.set(key, (this.counts.get(key) ?? 0) + by);
	}
	get(key: string): number {
		return this.counts.get(key) ?? 0;
	}
	object(): Record<string, number> {
		return Object.fromEntries([...this.counts].sort((a, b) => b[1] - a[1]));
	}
}
/** The value a share `q` of the way through a sorted list (nearest rank). */
function at(sorted: readonly number[], q: number): number {
	if (sorted.length === 0) return Number.NaN;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
}
/** A spread, in the unit the values came in. */
interface Spread {
	readonly n: number;
	readonly p25: number;
	readonly median: number;
	readonly p75: number;
	readonly p90: number;
	readonly max: number;
}
function spreadOf(values: readonly number[]): Spread {
	const sorted = [...values].sort((a, b) => a - b);
	const round = (n: number) => (Number.isNaN(n) ? 0 : Math.round(n * 100) / 100);
	return {
		n: sorted.length,
		p25: round(at(sorted, 0.25)),
		median: round(at(sorted, 0.5)),
		p75: round(at(sorted, 0.75)),
		p90: round(at(sorted, 0.9)),
		max: round(at(sorted, 1)),
	};
}
/** Hours as a short text: minutes under an hour, days over two days. */
function span(hours: number): string {
	if (hours < 1) return `${Math.round(hours * 60)} min`;
	if (hours < 48) return `${hours.toFixed(1)} h`;
	return `${(hours / 24).toFixed(1)} d`;
}
const spreadCells = (s: Spread) =>
	s.n === 0
		? ["", "", "", "", ""]
		: [span(s.p25), span(s.median), span(s.p75), span(s.p90), span(s.max)];

// ---------------------------------------------------------------- what GitHub is asked

/** A pull request as one page of the cache holds it. */
interface RawPr {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly state: "MERGED" | "CLOSED" | "OPEN";
	readonly createdAt: string;
	readonly mergedAt: string | null;
	readonly closedAt: string | null;
	/** Read only to tell a lane branch (`build/<ticket>-…`) from the rest. Never saved. */
	readonly headRefName: string;
	readonly additions: number;
	readonly deletions: number;
	readonly changedFiles: number;
	readonly commits: {readonly totalCount: number};
	readonly comments: {readonly totalCount: number};
	/** Read only to tell a pull request into the main branch from one into an epic's branch. Never saved. */
	readonly baseRefName: string;
	/** Times the branch was force-pushed, and times it was put in the merge queue. */
	readonly forced: {readonly filteredCount: number};
	readonly queued: {readonly filteredCount: number};
	readonly closingIssuesReferences: {
		readonly nodes: readonly {
			readonly number: number;
			readonly repository: {readonly nameWithOwner: string};
		}[];
	};
}
interface RawEvent {
	readonly __typename: "LabeledEvent" | "UnlabeledEvent" | "ClosedEvent" | "ReopenedEvent";
	readonly createdAt: string;
	readonly label?: {readonly name: string};
	readonly stateReason?: string | null;
	readonly closer?: {
		readonly __typename: string;
		readonly number?: number;
		readonly merged?: boolean;
		readonly repository?: {readonly nameWithOwner: string};
	} | null;
}
interface RawIssue {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly state: "OPEN" | "CLOSED";
	readonly stateReason: string | null;
	readonly createdAt: string;
	readonly closedAt: string | null;
	readonly comments: {readonly totalCount: number};
	readonly labels: {readonly nodes: readonly {readonly name: string}[]};
	readonly timelineItems: {
		readonly pageInfo: {readonly hasNextPage: boolean};
		readonly nodes: readonly RawEvent[];
	};
}

const PRS = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:40, after:$after, orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title body state createdAt mergedAt closedAt headRefName
        additions deletions changedFiles
        commits{totalCount}
        comments{totalCount}
        baseRefName
        forced: timelineItems(itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){filteredCount}
        queued: timelineItems(itemTypes:[ADDED_TO_MERGE_QUEUE_EVENT]){filteredCount}
        closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}}
      }
    }
  }
}`;
const ISSUES = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    issues(first:50, after:$after, orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title body state stateReason createdAt closedAt
        comments{totalCount}
        labels(first:30){nodes{name}}
        timelineItems(first:80, itemTypes:[LABELED_EVENT,UNLABELED_EVENT,CLOSED_EVENT,REOPENED_EVENT]){
          pageInfo{hasNextPage}
          nodes{
            __typename
            ... on LabeledEvent{createdAt label{name}}
            ... on UnlabeledEvent{createdAt label{name}}
            ... on ReopenedEvent{createdAt}
            ... on ClosedEvent{createdAt stateReason closer{__typename ... on PullRequest{number merged repository{nameWithOwner}}}}
          }
        }
      }
    }
  }
}`;

interface Page {
	readonly pageInfo: {readonly hasNextPage: boolean; readonly endCursor: string | null};
	readonly nodes: readonly unknown[];
}
/** One read-only GraphQL call through `gh`, tried four times. */
function graphql(query: string, vars: Record<string, string | null>): Record<string, Page> {
	const args = ["api", "graphql", "-f", `query=${query}`];
	for (const [key, value] of Object.entries(vars))
		if (value !== null) args.push("-f", `${key}=${value}`);
	let last = "";
	for (let attempt = 0; attempt < 4; attempt++) {
		const run = spawnSync("gh", args, {encoding: "utf8", maxBuffer: 512 * 1024 * 1024});
		if (run.status === 0) {
			const out = JSON.parse(run.stdout) as {data?: {repository?: Record<string, Page>}};
			if (out.data?.repository !== undefined) return out.data.repository;
		}
		last = run.stderr.slice(0, 300);
	}
	throw new Error(`gh failed four times: ${last}`);
}

const pagesFile = (repo: string, kind: "prs" | "issues") =>
	join(CACHE, `${nameOf(repo)}-${kind}.jsonl`);

/** Page one kind of thing of one repo into the cache, one JSON object a line. Resumes from the saved cursor. */
function fetchPages(repo: string, kind: "prs" | "issues"): number {
	const [owner = "", name = ""] = repo.split("/");
	const file = pagesFile(repo, kind);
	const cursorFile = `${file}.cursor`;
	let after: string | null = existsSync(cursorFile) ? readFileSync(cursorFile, "utf8") : null;
	if (after === "done") return 0;
	if (after === null) writeFileSync(file, "");
	let calls = 0;
	for (;;) {
		const data = graphql(kind === "prs" ? PRS : ISSUES, {owner, name, after});
		const page = data[kind === "prs" ? "pullRequests" : "issues"];
		if (page === undefined) throw new Error("GitHub answered with no page");
		calls += 1;
		appendFileSync(file, page.nodes.map((node) => `${JSON.stringify(node)}\n`).join(""));
		after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : "done";
		writeFileSync(cursorFile, after ?? "done");
		if (calls % 20 === 0) console.error(`${repo} ${kind}: ${calls} pages`);
		if (after === "done" || after === null) return calls;
	}
}

function readPages<T>(repo: string, kind: "prs" | "issues"): readonly T[] {
	const file = pagesFile(repo, kind);
	if (!existsSync(`${file}.cursor`) || readFileSync(`${file}.cursor`, "utf8") !== "done")
		throw new Error(`${file} is not complete: run STEP=fetch first`);
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line) as T);
}

// ---------------------------------------------------------------- reading a pull request's text

/** The seven classes the pipeline names, with what this script takes as each one's label. */
const CLASSES = [
	{key: "scope", name: "Scope narrowing", match: /scope narrowing|\bclass 1\b/},
	{key: "adr", name: "Governing-ADR departure", match: /adr departure|\bclass 2\b/},
	{
		key: "defect",
		name: "Known defect left unfixed",
		match: /known defect|left unfixed|\bclass 3\b/,
	},
	{key: "declined", name: "Declined guidance", match: /declined guidance|\bclass 4\b/},
	{key: "guard", name: "Guard or gate bypassed", match: /gate bypassed|guard bypassed|\bclass 5\b/},
	{
		key: "test",
		name: "Pre-existing test or fixture changed",
		match: /test or fixture changed|\bclass 6\b/,
	},
	{key: "extra", name: "Out-of-scope change", match: /out-of-scope change|\bclass 7\b/},
] as const;
type ClassKey = (typeof CLASSES)[number]["key"] | "other";
const classNames: Record<string, string> = {
	...Object.fromEntries(CLASSES.map((c) => [c.key, c.name])),
	other: "No label of the seven",
};
/** The two classes that say something asked for was left undone. */
const GAP: readonly ClassKey[] = ["defect", "scope"];

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;
/** A line that links the pull request to its ticket: it ends the section, as the pipeline's own reader has it. */
const LINK_LINE =
	/^\s*(?:(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)|part of|refs?)\s+(?:[\w.-]+\/[\w.-]+)?#\d+/i;
const FOOTER = /Generated with \[Claude Code\]/;
const BULLET = /^(?:[-*]|\d+[.)])[ \t]+/;
const FIELD = /\*{0,2}\b(said|did|why|disposition)\*{0,2}[ \t]*[:/][ \t]*\*{0,2}/gi;

type Section =
	| {readonly kind: "absent"}
	| {readonly kind: "none"}
	| {readonly kind: "entries"; readonly entries: readonly string[]}
	| {readonly kind: "prose"};

/**
 * The Deviations section of a pull request body. Every heading whose text
 * starts with "Deviations" counts, at any level, so "## Deviations (repair
 * round 1)" does too; a body with two has them joined. The section runs to the
 * next heading, link line or footer. An entry is a top-level bullet or
 * numbered item with the lines under it; in a section with no bullets, a
 * paragraph that opens in bold.
 */
function sectionOf(body: string): Section {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	const kept: string[] = [];
	let found = false;
	let inside = false;
	let fence: string | null = null;
	for (const line of lines) {
		const mark = FENCE.exec(line)?.[1];
		if (mark !== undefined) {
			if (fence === null) fence = mark;
			else if (fence === mark) fence = null;
			if (inside) kept.push(line);
			continue;
		}
		if (fence === null) {
			const heading = HEADING.exec(line);
			if (heading !== null) {
				inside = /^deviations\b/i.test(heading[2] ?? "");
				if (inside) {
					found = true;
					kept.push("");
				}
				continue;
			}
			if (inside && (LINK_LINE.test(line) || FOOTER.test(line))) {
				inside = false;
				continue;
			}
		}
		if (inside) kept.push(line);
	}
	if (!found) return {kind: "absent"};
	const text = kept.join("\n").trim();
	const bullets: string[] = [];
	for (const line of kept) {
		if (BULLET.test(line)) bullets.push(line.replace(BULLET, ""));
		else if (bullets.length > 0) bullets[bullets.length - 1] += `\n${line}`;
	}
	if (bullets.length > 0) return {kind: "entries", entries: bullets.map((b) => b.trim())};
	if (/^\**_?none\b/i.test(text) || text === "") return {kind: "none"};
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p.startsWith("**"));
	return paragraphs.length > 0 ? {kind: "entries", entries: paragraphs} : {kind: "prose"};
}

/** What the builder said would become of one entry, as this script reads it. */
type Fate =
	/** A new issue, made while this pull request was being built. */
	| "filed"
	/** It names a ticket that was already there. */
	| "older"
	/** It says an issue was filed, and none could be found. */
	| "said"
	/** Stated in the pull request, and nothing else. */
	| "stated";

interface Ref {
	readonly repo: string;
	readonly number: number;
}
const REFS =
	/https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|\b([\w.-]+\/[\w.-]+)#(\d+)|#(\d+)/g;
function refsIn(text: string, repo: string): readonly Ref[] {
	const out: Ref[] = [];
	for (const m of text.matchAll(REFS)) {
		const where = m[1] ?? m[3] ?? repo;
		const number = Number(m[2] ?? m[4] ?? m[5]);
		if (!out.some((r) => r.repo === where && r.number === number)) out.push({repo: where, number});
	}
	return out;
}

/** Words that say an issue was made. */
const FILING =
	/\bfiled\b|\bfollow-up (?:issue|ticket)\b|\bfollow-up #\d+|\bopened (?:as )?#\d+|\bissue opened\b/i;
/** Words that hand the leftover to a ticket without saying one was made. */
const POINTING =
	/\bleft (?:to|for|with)\b|\bowned by\b|\bowns\b|\bbelongs (?:to|in)\b|\bdeferred to\b|\btracked (?:in|by|as|on)\b|\bnoted on\b|\brecorded on\b|\bremains open\b|\bstays open\b/i;
/** Words that make a filing sentence a wish, a question or a denial. */
const SOFT =
	/\bwhether\b|\bshould\b|\bwould\b|\bcould\b|\bif (?:it is |one is )?wanted\b|\bworth\b|\bright home\b|\bnot (?:yet )?filed\b|\bno (?:follow-up|ticket|issue|new issue)(?: was| is)? filed\b|\brather than filed\b|\bnothing filed\b|\bto be filed\b|\b(?:will|can|may|might) be filed\b|\bnot filing\b|\bfiled no\b|\bfiled (?:against|about|body|text|artifacts?)\b|\bas filed\b|\b(?:neither|none) is filed\b|\bno upstream issue filed\b/i;

interface Entry {
	readonly index: number;
	readonly klass: ClassKey;
	/** Whether the entry is in the four-field form: it has a Said and a Disposition. */
	readonly fields: boolean;
	readonly text: string;
	/** The sentences that decide `fate`, or the disposition when nothing in it decides. */
	readonly line: string;
	readonly filing: boolean;
	readonly pointing: boolean;
	readonly refs: readonly Ref[];
	/** Whether the Said field names a criterion of the ticket. A rough stand-in for "the ticket's own words". */
	readonly cites: boolean;
}
const CRITERION = /\bcriteri(?:on|a)\b|\bAC[ -]?#?\d|\bacceptance\b/i;
function entryOf(raw: string, index: number, repo: string): Entry {
	const flat = raw.replace(/\s+/g, " ").trim();
	const marks = [...flat.matchAll(FIELD)].map((m) => ({
		key: (m[1] ?? "").toLowerCase(),
		from: m.index,
		to: m.index + m[0].length,
	}));
	const lead = (
		marks[0] === undefined ? flat.slice(0, 160) : flat.slice(0, marks[0].from)
	).toLowerCase();
	const klass = CLASSES.find((c) => c.match.test(lead))?.key ?? "other";
	const dispositionAt = marks.findIndex((m) => m.key === "disposition");
	const mark = marks[dispositionAt];
	const disposition =
		mark === undefined ? null : flat.slice(mark.to, marks[dispositionAt + 1]?.from ?? flat.length);
	// Without a Disposition field the whole entry is read, a sentence at a time.
	const sentences = (disposition ?? flat).split(/(?<=[.;])\s+/);
	const filing = sentences.filter((s) => FILING.test(s) && !SOFT.test(s));
	const pointing = sentences.filter((s) => POINTING.test(s) && !FILING.test(s));
	const decides = [...filing, ...pointing];
	const saidAt = marks.findIndex((m) => m.key === "said");
	const saidMark = marks[saidAt];
	const said =
		saidMark === undefined ? "" : flat.slice(saidMark.to, marks[saidAt + 1]?.from ?? flat.length);
	return {
		index,
		klass,
		fields: disposition !== null && marks.some((m) => m.key === "said"),
		text: flat,
		line: short((decides.length > 0 ? decides.join(" ") : (disposition ?? "")).trim(), 280),
		filing: filing.length > 0,
		pointing: pointing.length > 0,
		refs: refsIn(decides.join(" "), repo),
		cites: CRITERION.test(said),
	};
}

/** The ticket a pull request is for, and whether merging it closes that ticket. */
interface Link {
	readonly parent: number | null;
	readonly how: "closes" | "part-of" | "none";
}
function linkOf(pr: RawPr, repo: string): Link {
	const closing = pr.closingIssuesReferences.nodes.filter(
		(n) => n.repository.nameWithOwner === repo,
	);
	const lane = /^build\/(\d+)-/.exec(pr.headRefName)?.[1];
	if (closing.length > 0) {
		const own = closing.find((n) => String(n.number) === lane) ?? closing[0];
		return {parent: own?.number ?? null, how: "closes"};
	}
	const part = /^\s*part of\s+#(\d+)/im.exec(pr.body)?.[1];
	if (part !== undefined) return {parent: Number(part), how: "part-of"};
	return {parent: lane === undefined ? null : Number(lane), how: "none"};
}

// ---------------------------------------------------------------- reading an issue's life

const NEEDS = "status:needs-triage";
/** The ticket a lane-filed issue names in its footer: the `build/<ticket>-…` branch, or "while building #<ticket>". */
function laneOf(body: string): number | null {
	const tail = body.slice(-600);
	const found = /branch `build\/(\d+)-/.exec(tail)?.[1] ?? /while building #(\d+)/.exec(tail)?.[1];
	return found === undefined ? null : Number(found);
}
const agentFiled = (body: string) => /Filed by an agent/.test(body.slice(-600));

interface Life {
	/** When it entered the triage queue, or `null` when it never carried the label. */
	readonly entered: number | null;
	/** When it left the queue: the label came off, or it was closed with the label still on. */
	readonly left: number | null;
	readonly leftBy: "triaged" | "closed" | null;
	readonly closed: number | null;
	/** The merged pull request that closed it. */
	readonly by: number | null;
}
function lifeOf(issue: RawIssue, closers: ReadonlyMap<number, readonly RawPr[]>): Life {
	const events = issue.timelineItems.nodes;
	const enteredAt = events.find((e) => e.__typename === "LabeledEvent" && e.label?.name === NEEDS);
	const entered = enteredAt === undefined ? null : ms(enteredAt.createdAt);
	const closed = issue.closedAt === null ? null : ms(issue.closedAt);
	let left: number | null = null;
	let leftBy: Life["leftBy"] = null;
	if (entered !== null) {
		const off = events.find(
			(e) =>
				e.__typename === "UnlabeledEvent" && e.label?.name === NEEDS && ms(e.createdAt) >= entered,
		);
		if (off !== undefined && (closed === null || ms(off.createdAt) <= closed + 60_000)) {
			left = ms(off.createdAt);
			leftBy = "triaged";
		} else if (closed !== null) {
			left = closed;
			leftBy = "closed";
		}
	}
	// The closing pull request: the close event names it, or a merged one that closes this issue landed at that minute.
	let by: number | null = null;
	if (closed !== null) {
		const event = events.findLast((e) => e.__typename === "ClosedEvent");
		if (event?.closer?.__typename === "PullRequest" && event.closer.merged === true)
			by = event.closer.number ?? null;
		by ??=
			(closers.get(issue.number) ?? []).find(
				(pr) => pr.mergedAt !== null && Math.abs(ms(pr.mergedAt) - closed) <= 10 * 60_000,
			)?.number ?? null;
	}
	return {entered, left, leftBy, closed, by};
}

/** Why an issue was closed with no pull request, by the words of its last comment. The first that matches wins. */
const CLOSE_WHY = [
	{
		key: "sweep",
		name: "A bulk clean-up of the backlog, approved by the owner",
		match:
			/purge|kill[- ]sweep|kill batch|backlog (?:kill[- ])?sweep|closed in bulk|\baudit\b|\bbatch\b/i,
	},
	{
		key: "folded",
		name: "Folded into another ticket, or a duplicate of one",
		match: /duplicate|\bfold(?:ed|ing)?\b/i,
	},
	{
		key: "no_incident",
		name: "Triage closed it: a hardening idea with no incident behind it",
		match: /value[- ]bar|hardening[- ]with[- ]no[- ]incident/i,
	},
	{
		key: "gone",
		name: "The problem was already gone, or a later decision removed it",
		match: /superseded|mooted|premise is false|gap is closed|no longer|retired/i,
	},
	{
		key: "elsewhere",
		name: "Done inside another pull request",
		match: /\blanded\b|\bshipped\b|fixed on|delivered|satisfied by|^done\b/i,
	},
	{key: "ruling", name: "Closed on a person's ruling", match: /\bruling\b|\bruled\b|authori[sz]/i},
] as const;
const closeWhyNames: Record<string, string> = {
	...Object.fromEntries(CLOSE_WHY.map((c) => [c.key, c.name])),
	other: "Something else",
	unread: "No comment to read",
};
function closeWhyOf(repo: string, number: number): string {
	const thread = readThread(join(CACHE, `threads-${nameOf(repo)}`), number);
	if (thread === null || thread === "missing") return "unread";
	const last = thread.comments.filter((c) => !c.body.startsWith("<!--")).at(-1);
	if (last === undefined) return "unread";
	const text = last.body.replace(/\s+/g, " ").slice(0, 400);
	return CLOSE_WHY.find((c) => c.match.test(text))?.key ?? "other";
}

// ---------------------------------------------------------------- what is saved

/** One follow-up issue a merged pull request's Deviations entry points at. */
interface FollowUp {
	readonly repo: string;
	readonly pr: number;
	readonly merged: string;
	/** Which entry of the section, counted from 1. */
	readonly entry: number;
	readonly klass: ClassKey;
	/** The sentence of the entry that says an issue was filed. Public pull request text. */
	readonly line: string;
	/** Whether the entry's Said field names a criterion. */
	readonly cites: boolean;
	/** How the issue was found: named in the entry, or the one issue this lane filed that no entry names. */
	readonly how: "link" | "lane";
	readonly parent: number | null;
	/** Whether merging the pull request closed its ticket. */
	readonly closes: boolean;
	readonly issueRepo: string;
	readonly issue: number;
	readonly filed: string;
	readonly agentFiled: boolean;
	readonly state: string;
	readonly why: string | null;
	readonly labels: readonly string[];
	readonly entered: string | null;
	readonly left: string | null;
	readonly leftBy: "triaged" | "closed" | null;
	readonly closed: string | null;
	/** The merged pull request that closed the follow-up, with its size and how long it was open. */
	readonly by: number | null;
	readonly byLines: number | null;
	readonly byOpenHours: number | null;
	/** For one closed with no pull request: what its last comment gives as the reason, as one of `CLOSE_WHY`. */
	readonly closeWhy: string | null;
}
interface Partial {
	readonly repo: string;
	readonly pr: number;
	readonly merged: string;
	readonly parent: number;
	/** Whether it merged into the main branch. One into an epic's branch is a child of the epic, not a split ticket. */
	readonly intoMain: boolean;
	readonly parentState: string;
	readonly parentWhy: string | null;
	readonly parentClosed: string | null;
	readonly closedBy: number | null;
}
interface RepoCount {
	readonly repo: string;
	readonly prs: number;
	readonly merged: number;
	readonly closedUnmerged: number;
	readonly open: number;
	readonly lanes: number;
	readonly issues: number;
	readonly firstMerged: string;
	readonly lastMerged: string;
	/** Merged pull requests by what their Deviations section is. */
	readonly sections: Record<string, number>;
	readonly entries: number;
	readonly fourField: number;
	readonly classes: Record<string, number>;
	/** class → fate → entries. */
	readonly fates: Record<string, Record<string, number>>;
	/** Merged pull requests with a section, by how they link their ticket. */
	readonly links: Record<string, number>;
	/** Merged pull requests that close their ticket and carry at least one gap entry, by the most that came of it. */
	readonly gapPrs: Record<string, number>;
	/** Four-field entries under a gap label, keyed `fate/link`, and of them the ones whose Said names a criterion. */
	readonly gapSaid: Record<string, number>;
	readonly gapSaidCites: Record<string, number>;
	readonly truncatedTimelines: number;
}
interface Month {
	readonly month: string;
	readonly merged: number;
	readonly withSection: number;
	readonly withEntries: number;
	readonly entries: number;
	readonly gapEntries: number;
	readonly filed: number;
}
interface Wait {
	readonly name: string;
	readonly issues: number;
	readonly entered: number;
	readonly waiting: number;
	readonly hours: Spread;
	readonly within: Record<string, number>;
	readonly waitingAges: Spread;
}
interface Hold {
	readonly name: string;
	readonly prs: number;
	readonly openHours: Spread;
	readonly commits: Spread;
	readonly lines: Spread;
	/** Pull requests whose branch was force-pushed at least once. */
	readonly forced: number;
	/** Pull requests put in the merge queue more than once: the queue threw them out at least once. */
	readonly requeued: number;
}
/** One case of a hand sample: enough to find it again, and the text that was read. */
interface Case {
	readonly id: string;
	readonly repo: string;
	readonly pr: number;
	readonly entry: number;
	readonly klass: ClassKey;
	readonly parent: number | null;
	readonly issue: number | null;
	readonly line: string;
	readonly cites: boolean;
}
interface Saved {
	readonly fetched: string;
	readonly repos: readonly RepoCount[];
	readonly months: readonly Month[];
	readonly followUps: readonly FollowUp[];
	readonly saidFiled: readonly {
		readonly repo: string;
		readonly pr: number;
		readonly entry: number;
		readonly line: string;
	}[];
	readonly partials: readonly Partial[];
	readonly waits: readonly Wait[];
	readonly closes: readonly {
		readonly name: string;
		readonly issues: number;
		readonly fate: Record<string, number>;
		readonly toClose: Spread;
		readonly toBuilt: Spread;
	}[];
	readonly holds: readonly Hold[];
	readonly unmerged: {
		readonly withSection: number;
		readonly lanes: number;
		readonly lanesAll: number;
		readonly openHours: Spread;
	};
	readonly fixes: {
		readonly n: number;
		readonly lines: Spread;
		readonly openHours: Spread;
		readonly parentLines: Spread;
		readonly smaller: number;
	};
	readonly sample: readonly Case[];
	readonly statedSample: readonly Case[];
	readonly narrowedSample: readonly Case[];
	/** What the two stated samples were drawn from, by label: entries, and the pull requests that carry them. */
	readonly pools: Record<string, {readonly entries: number; readonly prs: number}>;
}

// ---------------------------------------------------------------- counting

interface Loaded {
	readonly repo: string;
	readonly prs: readonly RawPr[];
	readonly issues: ReadonlyMap<number, RawIssue>;
	readonly lives: ReadonlyMap<number, Life>;
	/** Issues a lane filed, by the ticket the lane was building. */
	readonly laneFiled: ReadonlyMap<number, readonly RawIssue[]>;
}
function load(repo: string): Loaded {
	const prs = readPages<RawPr>(repo, "prs");
	const all = readPages<RawIssue>(repo, "issues");
	const closers = new Map<number, RawPr[]>();
	for (const pr of prs) {
		if (pr.state !== "MERGED") continue;
		for (const ref of pr.closingIssuesReferences.nodes) {
			if (ref.repository.nameWithOwner !== repo) continue;
			closers.set(ref.number, [...(closers.get(ref.number) ?? []), pr]);
		}
	}
	const laneFiled = new Map<number, RawIssue[]>();
	for (const issue of all) {
		const lane = laneOf(issue.body);
		if (lane !== null) laneFiled.set(lane, [...(laneFiled.get(lane) ?? []), issue]);
	}
	return {
		repo,
		prs,
		issues: new Map(all.map((issue) => [issue.number, issue])),
		lives: new Map(all.map((issue) => [issue.number, lifeOf(issue, closers)])),
		laneFiled,
	};
}

/** A new issue for this pull request: made from six hours before it opened to ten minutes after it merged, or by its lane. */
function isNew(issue: RawIssue, pr: RawPr, parent: number | null): boolean {
	const made = ms(issue.createdAt);
	const inWindow =
		made >= ms(pr.createdAt) - 6 * HOUR && made <= ms(pr.mergedAt ?? pr.createdAt) + 10 * 60_000;
	return (
		inWindow ||
		(parent !== null &&
			laneOf(issue.body) === parent &&
			made <= ms(pr.mergedAt ?? pr.createdAt) + 10 * 60_000)
	);
}

interface Read {
	readonly pr: RawPr;
	readonly repo: string;
	readonly link: Link;
	readonly section: Section;
	readonly entries: readonly (Entry & {readonly fate: Fate; readonly news: readonly Ref[]})[];
}

function compute(): Saved {
	const loaded = REPOS.map(load);
	const byRepo = new Map(loaded.map((l) => [l.repo, l]));
	const fetched = readFileSync(join(CACHE, "fetched.txt"), "utf8").trim();
	const now = ms(fetched);
	const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

	const reads: Read[] = [];
	const followUps: FollowUp[] = [];
	const saidFiled: {repo: string; pr: number; entry: number; line: string}[] = [];
	const partials: Partial[] = [];
	const repos: RepoCount[] = [];
	const months = new Map<
		string,
		{
			merged: number;
			withSection: number;
			withEntries: number;
			entries: number;
			gapEntries: number;
			filed: number;
		}
	>();

	for (const {repo, prs, issues, lives, laneFiled} of loaded) {
		const sections = new Tally();
		const classes = new Tally();
		const links = new Tally();
		const gapPrs = new Tally();
		const gapSaid = new Tally();
		const gapSaidCites = new Tally();
		const fates = new Map<string, Tally>();
		let entryCount = 0;
		let fourField = 0;
		const merged = prs.filter((pr) => pr.state === "MERGED");
		for (const pr of merged) {
			const month = (pr.mergedAt ?? "").slice(0, 7);
			const row = months.get(month) ?? {
				merged: 0,
				withSection: 0,
				withEntries: 0,
				entries: 0,
				gapEntries: 0,
				filed: 0,
			};
			months.set(month, row);
			row.merged += 1;
			const section = sectionOf(pr.body);
			sections.add(section.kind);
			if (section.kind === "absent") continue;
			row.withSection += 1;
			const link = linkOf(pr, repo);
			links.add(link.how);
			const read: Read["entries"][number][] = [];
			if (section.kind === "entries") {
				row.withEntries += 1;
				// An issue is one entry's follow-up, the first that names it.
				const taken = new Set<string>();
				section.entries.forEach((raw, i) => {
					const entry = entryOf(raw, i + 1, repo);
					const known = entry.refs.filter((ref) => {
						const there = byRepo.get(ref.repo)?.issues.get(ref.number);
						return there !== undefined && !(ref.repo === repo && ref.number === link.parent);
					});
					const news = known.filter((ref) => {
						const issue = byRepo.get(ref.repo)?.issues.get(ref.number);
						return (
							issue !== undefined &&
							isNew(issue, pr, link.parent) &&
							!taken.has(`${ref.repo}#${ref.number}`)
						);
					});
					for (const ref of news) taken.add(`${ref.repo}#${ref.number}`);
					const fate: Fate =
						entry.filing && news.length > 0
							? "filed"
							: known.length > 0
								? "older"
								: entry.filing
									? "said"
									: "stated";
					read.push({...entry, fate, news: fate === "filed" ? news : []});
				});
				// An entry that says "filed" with no number: the one issue this lane filed that no entry names.
				const unnamed =
					link.parent === null
						? []
						: (laneFiled.get(link.parent) ?? []).filter(
								(issue) => isNew(issue, pr, link.parent) && !taken.has(`${repo}#${issue.number}`),
							);
				const said = read.filter((entry) => entry.fate === "said");
				const only = unnamed[0];
				if (said.length === 1 && unnamed.length === 1 && only !== undefined) {
					const at = read.findIndex((entry) => entry.fate === "said");
					const entry = read[at];
					if (entry !== undefined)
						read[at] = {...entry, fate: "filed", news: [{repo, number: only.number}]};
				}
			}
			for (const entry of read) {
				entryCount += 1;
				if (entry.fields) fourField += 1;
				classes.add(entry.klass);
				const tally = fates.get(entry.klass) ?? new Tally();
				fates.set(entry.klass, tally);
				tally.add(entry.fate);
				row.entries += 1;
				if (GAP.includes(entry.klass)) row.gapEntries += 1;
				if (GAP.includes(entry.klass) && entry.fields) {
					gapSaid.add(`${entry.fate}/${link.how}`);
					if (entry.cites) gapSaidCites.add(`${entry.fate}/${link.how}`);
				}
				if (entry.fate === "filed") row.filed += 1;
				if (entry.fate === "said")
					saidFiled.push({repo, pr: pr.number, entry: entry.index, line: entry.line});
				for (const ref of entry.news) {
					const home = byRepo.get(ref.repo);
					const issue = home?.issues.get(ref.number);
					const life = home?.lives.get(ref.number);
					if (home === undefined || issue === undefined || life === undefined) continue;
					const fix = life.by === null ? undefined : home.prs.find((p) => p.number === life.by);
					followUps.push({
						repo,
						pr: pr.number,
						merged: pr.mergedAt ?? "",
						entry: entry.index,
						klass: entry.klass,
						line: entry.line,
						cites: entry.cites,
						how: entry.refs.some((r) => r.repo === ref.repo && r.number === ref.number)
							? "link"
							: "lane",
						parent: link.parent,
						closes: link.how === "closes",
						issueRepo: ref.repo,
						issue: ref.number,
						filed: issue.createdAt,
						agentFiled: agentFiled(issue.body),
						state: issue.state,
						why: issue.stateReason,
						labels: issue.labels.nodes.map((l) => l.name).sort(),
						entered: iso(life.entered),
						left: iso(life.left),
						leftBy: life.leftBy,
						closed: iso(life.closed),
						by: life.by,
						byLines: fix === undefined ? null : fix.additions + fix.deletions,
						byOpenHours:
							fix === undefined || fix.mergedAt === null
								? null
								: Math.round(((ms(fix.mergedAt) - ms(fix.createdAt)) / HOUR) * 100) / 100,
						closeWhy:
							life.closed !== null && life.by === null ? closeWhyOf(ref.repo, ref.number) : null,
					});
				}
			}
			reads.push({pr, repo, link, section, entries: read});
			// What a closing pull request with a gap entry left behind, at most.
			if (link.how === "closes") {
				const gaps = read.filter((entry) => GAP.includes(entry.klass));
				if (gaps.length === 0) gapPrs.add("no gap entry");
				else if (gaps.some((entry) => entry.fate === "filed"))
					gapPrs.add("a gap entry with a new issue");
				else if (gaps.some((entry) => entry.fate === "older"))
					gapPrs.add("a gap entry that names an older ticket");
				else if (gaps.some((entry) => entry.fate === "said"))
					gapPrs.add("a gap entry that says filed, no issue found");
				else gapPrs.add("gap entries stated only");
			}
			if (link.how === "part-of" && link.parent !== null) {
				const parent = issues.get(link.parent);
				const life = lives.get(link.parent);
				if (parent !== undefined && life !== undefined)
					partials.push({
						repo,
						pr: pr.number,
						merged: pr.mergedAt ?? "",
						parent: link.parent,
						intoMain: pr.baseRefName === "main",
						parentState: parent.state,
						parentWhy: parent.stateReason,
						parentClosed: parent.closedAt,
						closedBy: life.by,
					});
			}
		}
		const mergedTimes = merged.map((pr) => pr.mergedAt ?? "").sort();
		repos.push({
			repo,
			prs: prs.length,
			merged: merged.length,
			closedUnmerged: prs.filter((pr) => pr.state === "CLOSED").length,
			open: prs.filter((pr) => pr.state === "OPEN").length,
			lanes: merged.filter((pr) => pr.headRefName.startsWith("build/")).length,
			issues: issues.size,
			firstMerged: mergedTimes[0] ?? "",
			lastMerged: mergedTimes.at(-1) ?? "",
			sections: sections.object(),
			entries: entryCount,
			fourField,
			classes: classes.object(),
			fates: Object.fromEntries([...fates].map(([klass, tally]) => [klass, tally.object()])),
			links: links.object(),
			gapPrs: gapPrs.object(),
			gapSaid: gapSaid.object(),
			gapSaidCites: gapSaidCites.object(),
			truncatedTimelines: [...issues.values()].filter((i) => i.timelineItems.pageInfo.hasNextPage)
				.length,
		});
	}

	// ------------------------------------------------ waits: follow-ups beside other issues

	// One row for each distinct follow-up issue: the first entry that named it.
	const distinct = [...new Map(followUps.map((f) => [`${f.issueRepo}#${f.issue}`, f])).values()];
	const followKeys = new Set(distinct.map((f) => `${f.issueRepo}#${f.issue}`));
	const gapKeys = new Set(
		distinct.filter((f) => GAP.includes(f.klass)).map((f) => `${f.issueRepo}#${f.issue}`),
	);
	const since = Math.min(...distinct.map((f) => ms(f.filed)));
	interface Row {
		readonly key: string;
		readonly issue: RawIssue;
		readonly life: Life;
	}
	const everything: Row[] = loaded.flatMap((l) =>
		[...l.issues.values()].map((issue) => {
			const life = l.lives.get(issue.number);
			if (life === undefined) throw new Error("an issue with no life");
			return {key: `${l.repo}#${issue.number}`, issue, life};
		}),
	);
	const inPeriod = everything.filter((row) => ms(row.issue.createdAt) >= since);
	const groups: readonly (readonly [string, readonly Row[]])[] = [
		["Follow-ups a Deviations entry filed", inPeriod.filter((row) => followKeys.has(row.key))],
		["of them, under a gap label", inPeriod.filter((row) => gapKeys.has(row.key))],
		[
			"Other issues a build lane filed",
			inPeriod.filter((row) => !followKeys.has(row.key) && laneOf(row.issue.body) !== null),
		],
		[
			"Other issues an agent filed, outside a lane",
			inPeriod.filter(
				(row) =>
					!followKeys.has(row.key) && laneOf(row.issue.body) === null && agentFiled(row.issue.body),
			),
		],
		[
			"Every other issue",
			inPeriod.filter((row) => !followKeys.has(row.key) && !agentFiled(row.issue.body)),
		],
	];
	const waits: Wait[] = groups.map(([name, rows]) => {
		const entered = rows.filter((row) => row.life.entered !== null);
		const done = entered.flatMap((row) =>
			row.life.entered !== null && row.life.left !== null
				? [(row.life.left - row.life.entered) / HOUR]
				: [],
		);
		const waiting = entered.flatMap((row) =>
			row.life.entered !== null && row.life.left === null ? [(now - row.life.entered) / HOUR] : [],
		);
		return {
			name,
			issues: rows.length,
			entered: entered.length,
			waiting: waiting.length,
			hours: spreadOf(done),
			within: {
				"1h": done.filter((h) => h <= 1).length,
				"1d": done.filter((h) => h <= 24).length,
				"7d": done.filter((h) => h <= 168).length,
			},
			waitingAges: spreadOf(waiting),
		};
	});
	const closes = groups.map(([name, rows]) => {
		const fate = new Tally();
		for (const {issue, life} of rows) {
			if (issue.state === "OPEN")
				fate.add(
					issue.labels.nodes.some((l) => l.name === NEEDS)
						? "open, in the triage queue"
						: "open, triaged",
				);
			else if (life.by !== null) fate.add("closed by a merged pull request");
			else if (issue.stateReason === "COMPLETED") fate.add("closed as done, no pull request");
			else fate.add("closed as not planned");
		}
		return {
			name,
			issues: rows.length,
			fate: fate.object(),
			toClose: spreadOf(
				rows.flatMap(({issue, life}) =>
					life.closed === null ? [] : [(life.closed - ms(issue.createdAt)) / HOUR],
				),
			),
			toBuilt: spreadOf(
				rows.flatMap(({issue, life}) =>
					life.closed === null || life.by === null
						? []
						: [(life.closed - ms(issue.createdAt)) / HOUR],
				),
			),
		};
	});

	// ------------------------------------------------ the other side: what a pull request's own life shows

	const filedPrs = new Set(followUps.map((f) => `${f.repo}#${f.pr}`));
	const holdOf = (name: string, rows: readonly Read[]): Hold => ({
		name,
		prs: rows.length,
		openHours: spreadOf(
			rows.map(({pr}) => (ms(pr.mergedAt ?? pr.createdAt) - ms(pr.createdAt)) / HOUR),
		),
		commits: spreadOf(rows.map(({pr}) => pr.commits.totalCount)),
		lines: spreadOf(rows.map(({pr}) => pr.additions + pr.deletions)),
		forced: rows.filter(({pr}) => pr.forced.filteredCount > 0).length,
		requeued: rows.filter(({pr}) => pr.queued.filteredCount > 1).length,
	});
	const hasGap = (read: Read) => read.entries.some((entry) => GAP.includes(entry.klass));
	const holds: Hold[] = [
		holdOf("Every merged pull request with a Deviations section", reads),
		holdOf(
			"with a new issue filed from an entry",
			reads.filter((r) => filedPrs.has(`${r.repo}#${r.pr.number}`)),
		),
		holdOf(
			"with a gap entry, nothing filed",
			reads.filter((r) => hasGap(r) && !filedPrs.has(`${r.repo}#${r.pr.number}`)),
		),
		holdOf(
			"with no gap entry",
			reads.filter((r) => !hasGap(r) && !filedPrs.has(`${r.repo}#${r.pr.number}`)),
		),
		holdOf(
			"that is one part of its ticket (`Part of`)",
			reads.filter((r) => r.link.how === "part-of"),
		),
	];
	const unmergedAll = loaded.flatMap((l) => l.prs.filter((pr) => pr.state === "CLOSED"));
	const lanesAll = loaded.flatMap((l) => l.prs.filter((pr) => pr.headRefName.startsWith("build/")));
	const unmerged = {
		withSection: unmergedAll.filter((pr) => sectionOf(pr.body).kind !== "absent").length,
		lanes: unmergedAll.filter((pr) => pr.headRefName.startsWith("build/")).length,
		lanesAll: lanesAll.length,
		openHours: spreadOf(
			unmergedAll
				.filter((pr) => pr.headRefName.startsWith("build/"))
				.map((pr) => (ms(pr.closedAt ?? pr.createdAt) - ms(pr.createdAt)) / HOUR),
		),
	};
	// What the leftover cost when it was built: the pull request that closed the follow-up, beside the one that left it.
	const built = distinct.filter(
		(f) => f.by !== null && f.byLines !== null && f.byOpenHours !== null,
	);
	const parentLines = built.map((f) => {
		const pr = byRepo.get(f.repo)?.prs.find((p) => p.number === f.pr);
		return pr === undefined ? 0 : pr.additions + pr.deletions;
	});
	const fixes = {
		n: built.length,
		lines: spreadOf(built.map((f) => f.byLines ?? 0)),
		openHours: spreadOf(built.map((f) => f.byOpenHours ?? 0)),
		parentLines: spreadOf(parentLines),
		smaller: built.filter((f, i) => (f.byLines ?? 0) < (parentLines[i] ?? 0)).length,
	};

	// ------------------------------------------------ the hand samples, by a rule

	/** Every `step`-th case in merge order, starting half a step in, so the sample is spread evenly over time. */
	function everyNth<T>(rows: readonly T[], want: number): readonly T[] {
		if (rows.length <= want) return rows;
		const step = rows.length / want;
		return Array.from({length: want}, (_, i) => rows[Math.floor(step / 2 + i * step)]).filter(
			(row): row is T => row !== undefined,
		);
	}
	const ordered = [...followUps].sort(
		(a, b) => ms(a.merged) - ms(b.merged) || a.pr - b.pr || a.entry - b.entry,
	);
	// One case for each entry: an entry that filed two issues is read once, with its first.
	const oneEach = [...new Map(ordered.map((f) => [`${f.repo}#${f.pr}/${f.entry}`, f])).values()];
	const sample: Case[] = everyNth(oneEach, SAMPLE).map((f) => ({
		id: `${nameOf(f.repo)}#${f.pr}/${f.entry}`,
		repo: f.repo,
		pr: f.pr,
		entry: f.entry,
		klass: f.klass,
		parent: f.parent,
		issue: f.issue,
		line: f.line,
		cites: f.cites,
	}));
	/** The entries under one label that filed nothing, in the four-field form, on a pull request that closed its ticket. */
	const poolOf = (klass: ClassKey) =>
		reads
			.filter((r) => r.link.how === "closes")
			.flatMap((r) =>
				r.entries
					.filter((entry) => entry.klass === klass && entry.fate === "stated" && entry.fields)
					.map((entry) => ({read: r, entry})),
			)
			.sort(
				(a, b) =>
					ms(a.read.pr.mergedAt ?? "") - ms(b.read.pr.mergedAt ?? "") ||
					a.read.pr.number - b.read.pr.number,
			);
	const statedOf = (klass: ClassKey): Case[] =>
		everyNth(poolOf(klass), STATED_SAMPLE).map(({read, entry}) => ({
			id: `${nameOf(read.repo)}#${read.pr.number}/${entry.index}`,
			repo: read.repo,
			pr: read.pr.number,
			entry: entry.index,
			klass: entry.klass,
			parent: read.link.parent,
			issue: null,
			line: entry.line,
			cites: entry.cites,
		}));
	const statedSample = statedOf("defect");
	const narrowedSample = statedOf("scope");
	const pools = Object.fromEntries(
		GAP.map((klass) => {
			const pool = poolOf(klass);
			return [
				klass,
				{
					entries: pool.length,
					prs: new Set(pool.map(({read}) => `${read.repo}#${read.pr.number}`)).size,
				},
			];
		}),
	);

	return {
		fetched,
		repos,
		months: [...months]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([month, row]) => ({month, ...row})),
		followUps: ordered,
		saidFiled,
		partials,
		waits,
		closes,
		holds,
		unmerged,
		fixes,
		sample,
		statedSample,
		narrowedSample,
		pools,
	};
}

// ---------------------------------------------------------------- the steps that reach GitHub or write texts

/** What a ticket asks for, cut to read: its opening, then its criteria section, or its checkbox lines when it has none. */
function criteriaOf(body: string): string {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	const from = lines.findIndex((line) =>
		/^#{1,6}\s.*(?:acceptance|criteria|done when)/i.test(line),
	);
	const opening = short(lines.slice(0, 10).join("\n"), 600);
	if (from === -1) {
		const boxes = lines.filter((line) => /^\s*[-*] \[[ x]\]/.test(line));
		return `${opening}\n…\n${short(boxes.join("\n"), 2800)}`;
	}
	const rest = lines.slice(from + 1);
	const to = rest.findIndex((line) => /^#{1,6}\s/.test(line));
	return `${opening}\n…\n${lines[from]}\n${short(rest.slice(0, to === -1 ? rest.length : to).join("\n"), 2800)}`;
}

/** The one case that started the question. It is read by hand too, outside the counted sample when the rule does not draw it. */
const KNOWN = {repo: "kamp-us/demlik", pr: 634, entry: 2} as const;

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	for (const repo of REPOS) {
		for (const kind of ["prs", "issues"] as const) {
			const calls = fetchPages(repo, kind);
			console.error(`${repo} ${kind}: ${calls} new pages`);
		}
	}
	if (!existsSync(join(CACHE, "fetched.txt")))
		writeFileSync(join(CACHE, "fetched.txt"), `${new Date().toISOString()}\n`);
	// The threads the hand sample is read from: each pull request, its ticket and its follow-up.
	const draft = compute();
	for (const repo of REPOS) {
		const cases = [...draft.sample, ...draft.statedSample, ...draft.narrowedSample].filter(
			(c) => c.repo === repo,
		);
		const numbers = cases.flatMap((c) => [
			c.pr,
			...(c.parent === null ? [] : [c.parent]),
			...(c.issue === null ? [] : [c.issue]),
		]);
		if (repo === KNOWN.repo) numbers.push(KNOWN.pr);
		// Every follow-up's own thread too: its last comment says why it was closed.
		numbers.push(...draft.followUps.filter((f) => f.issueRepo === repo).map((f) => f.issue));
		const queries = await fetchThreads(repo, numbers, join(CACHE, `threads-${nameOf(repo)}`));
		console.error(`${repo}: ${queries} thread queries`);
	}
	process.exit(0);
}

if (STEP === "sample") {
	const draft = compute();
	const loaded = new Map(REPOS.map((repo) => [repo as string, load(repo)]));
	mkdirSync(join(CACHE, "sample"), {recursive: true});
	const extra = draft.followUps.find(
		(f) => f.repo === KNOWN.repo && f.pr === KNOWN.pr && f.entry === KNOWN.entry,
	);
	const cases: readonly (Case & {readonly pile: string})[] = [
		...draft.sample.map((c) => ({...c, pile: "filed"})),
		...draft.statedSample.map((c) => ({...c, pile: "stated"})),
		...(extra === undefined ||
		draft.sample.some((c) => c.repo === extra.repo && c.pr === extra.pr && c.entry === extra.entry)
			? []
			: [
					{
						id: `${nameOf(extra.repo)}#${extra.pr}/${extra.entry}`,
						repo: extra.repo,
						pr: extra.pr,
						entry: extra.entry,
						klass: extra.klass,
						parent: extra.parent,
						issue: extra.issue,
						line: extra.line,
						cites: extra.cites,
						pile: "known",
					},
				]),
		// Added last, so the files of the first three piles keep their numbers.
		...draft.narrowedSample.map((c) => ({...c, pile: "narrowed"})),
	];
	cases.forEach((c, i) => {
		const home = loaded.get(c.repo);
		const pr = home?.prs.find((p) => p.number === c.pr);
		if (home === undefined || pr === undefined) return;
		const section = sectionOf(pr.body);
		const entry = section.kind === "entries" ? (section.entries[c.entry - 1] ?? "") : "";
		const parent = c.parent === null ? undefined : home.issues.get(c.parent);
		const follow = c.issue === null ? undefined : home.issues.get(c.issue);
		const threads = join(CACHE, `threads-${nameOf(c.repo)}`);
		const thread = readThread(threads, c.pr);
		const out: string[] = [
			`# ${c.pile} ${i + 1}: ${c.id}  class=${c.klass}`,
			"",
			`PR #${pr.number}: ${pr.title}`,
			`opened ${pr.createdAt}, merged ${pr.mergedAt}, link=${linkOf(pr, c.repo).how}`,
			"",
			"## The entry",
			"",
			entry,
			"",
		];
		out.push("## The other entries (leads only)", "");
		if (section.kind === "entries")
			out.push(...section.entries.map((e, n) => `${n + 1}. ${short(e.replace(/\s+/g, " "), 140)}`));
		out.push(
			"",
			`## The ticket #${c.parent}: ${parent?.title ?? "(not found)"}`,
			"",
			criteriaOf(parent?.body ?? ""),
			"",
		);
		if (follow !== undefined) {
			const life = home.lives.get(follow.number);
			out.push(
				`## The follow-up #${follow.number}: ${follow.title}`,
				"",
				`filed ${follow.createdAt}, state ${follow.state} ${follow.stateReason ?? ""}, closed ${follow.closedAt ?? "-"}, labels ${follow.labels.nodes.map((l) => l.name).join(", ")}, closed by ${life?.by ?? "-"}`,
				"",
				short(follow.body, 900),
				"",
			);
			const followThread = readThread(threads, follow.number);
			if (followThread !== null && followThread !== "missing") {
				out.push("### Its last comments", "");
				for (const comment of followThread.comments
					.filter((x) => !x.body.startsWith("<!--"))
					.slice(-2))
					out.push(`- ${comment.at}: ${short(comment.body.replace(/\s+/g, " "), 400)}`);
				out.push("");
			}
		}
		out.push("## The verdicts on the pull request", "");
		if (thread !== null && thread !== "missing") {
			for (const comment of thread.comments) {
				const verdicts = verdictsIn(comment.body);
				const first = verdicts[0];
				if (first === undefined) {
					if (!comment.body.startsWith("<!--"))
						out.push(`- comment ${comment.at}: ${short(comment.body.replace(/\s+/g, " "), 160)}`);
					continue;
				}
				for (const verdict of verdicts) {
					const lines = verdict.body.split("\n");
					const plain = lines.filter((line) => /\[PASS\]/.test(line)).length;
					out.push(
						`### ${verdict.marker.namespace}: ${verdict.marker.polarity}${verdict.superseded ? " (superseded)" : ""}, ${comment.at} — ${short(verdict.marker.clause, 300)} (${plain} plain [PASS] rows)`,
					);
					// A row that is not a plain PASS, and any line about what was left.
					const keep = lines.filter(
						(line) =>
							(/\[(?:PASS|FAIL|N\/A|PARTIAL)[^\]]*\]/.test(line) && !/\[PASS\]/.test(line)) ||
							/named limit|follow-up|known defect|left unfixed|scope narrowing|not fixed|founder|owner|ruling/i.test(
								line,
							) ||
							(c.issue !== null && line.includes(String(c.issue))),
					);
					out.push(...keep.slice(0, 7).map((line) => short(line, 380)), "");
				}
			}
		}
		const ticketThread = c.parent === null ? null : readThread(threads, c.parent);
		out.push("## Comments on the ticket while the pull request was open", "");
		if (ticketThread !== null && ticketThread !== "missing") {
			for (const comment of ticketThread.comments) {
				if (
					ms(comment.at) < ms(pr.createdAt) - DAY ||
					ms(comment.at) > ms(pr.mergedAt ?? pr.createdAt) + DAY
				)
					continue;
				if (comment.body.startsWith("<!--")) continue;
				out.push(`- ${comment.at}: ${short(comment.body.replace(/\s+/g, " "), 220)}`);
			}
		}
		if (parent !== undefined) {
			const human = parent.timelineItems.nodes.filter((e) => e.label?.name === "ready-for:human");
			out.push(
				"",
				`ready-for:human events on the ticket: ${human.map((e) => `${e.__typename} ${e.createdAt}`).join("; ") || "none"}`,
			);
		}
		const file = join(
			CACHE,
			"sample",
			`${c.pile}-${String(i + 1).padStart(2, "0")}-${nameOf(c.repo)}-${c.pr}-${c.entry}.md`,
		);
		writeFileSync(file, `${out.join("\n")}\n`);
	});
	console.log(`wrote ${cases.length} cases into ${join(CACHE, "sample")}`);
	process.exit(0);
}

// ---------------------------------------------------------------- the tables

const cached = existsSync(join(CACHE, "fetched.txt"));
if (!cached && !existsSync(resultsFile)) {
	console.log("No saved answers yet, and no cache. Run with STEP=fetch first.");
	process.exit(1);
}
const saved: Saved = cached ? compute() : (JSON.parse(readFileSync(resultsFile, "utf8")) as Saved);
if (cached) writeFileSync(resultsFile, `${JSON.stringify(saved, null, "\t")}\n`);

console.log(
	cached
		? `Counted from the cache, as GitHub stood at ${saved.fetched}. Saved.`
		: `Printed from the saved answers, as GitHub stood at ${saved.fetched}.`,
);

// ------------------------------------------------ 1. how often

const total = (pick: (repo: RepoCount) => number) =>
	saved.repos.reduce((n, repo) => n + pick(repo), 0);
table(
	"1. Merged pull requests and their Deviations section",
	[
		"Repo",
		"Merged",
		"First to last merge",
		"With a section",
		"Says None",
		"With entries",
		"Prose only",
		"Entries",
		"In the four-field form",
		"From a lane branch",
	],
	saved.repos.map((r) => {
		const withSection = r.merged - (r.sections.absent ?? 0);
		return [
			r.repo,
			r.merged,
			`${r.firstMerged.slice(0, 10)} to ${r.lastMerged.slice(0, 10)}`,
			share(withSection, r.merged),
			share(r.sections.none ?? 0, withSection),
			share(r.sections.entries ?? 0, withSection),
			r.sections.prose ?? 0,
			r.entries,
			share(r.fourField, r.entries),
			r.lanes,
		];
	}),
);
table(
	"1b. By the month the pull request merged, both repos",
	[
		"Month",
		"Merged",
		"With a section",
		"With entries",
		"Entries",
		"Under a gap label",
		"Entries that filed a new issue",
	],
	saved.months.map((m) => [
		m.month,
		m.merged,
		m.withSection,
		m.withEntries,
		m.entries,
		m.gapEntries,
		m.filed,
	]),
);

const fateNames: Record<Fate, string> = {
	filed: "Filed a new issue",
	older: "Names an older ticket",
	said: "Says filed, none found",
	stated: "Stated only",
};
const FATES: readonly Fate[] = ["filed", "older", "said", "stated"];
const classKeys: readonly ClassKey[] = [...CLASSES.map((c) => c.key), "other"];
const fateCount = (klass: string, fate: Fate) => total((r) => r.fates[klass]?.[fate] ?? 0);
table(
	"2. Entries by their label and by what the builder said would become of them, both repos",
	["Label", "Entries", ...FATES.map((f) => fateNames[f])],
	[
		...classKeys.map((klass) => {
			const n = total((r) => r.classes[klass] ?? 0);
			return [classNames[klass] ?? klass, n, ...FATES.map((f) => share(fateCount(klass, f), n))];
		}),
		[
			"All",
			total((r) => r.entries),
			...FATES.map((f) =>
				share(
					classKeys.reduce((n, k) => n + fateCount(k, f), 0),
					total((r) => r.entries),
				),
			),
		],
	],
);
const gapRows = [
	"no gap entry",
	"gap entries stated only",
	"a gap entry that names an older ticket",
	"a gap entry that says filed, no issue found",
	"a gap entry with a new issue",
];
table(
	"2b. Merged pull requests that close their ticket, by the most a gap entry left behind",
	["What the pull request carries", ...saved.repos.map((r) => r.repo), "Both"],
	gapRows.map((name) => {
		const all = total((r) => r.gapPrs[name] ?? 0);
		const of = total((r) => r.links.closes ?? 0);
		return [
			name,
			...saved.repos.map((r) => share(r.gapPrs[name] ?? 0, r.links.closes ?? 0)),
			share(all, of),
		];
	}),
);
const HOWS = ["closes", "part-of", "none"] as const;
const howNames: Record<(typeof HOWS)[number], string> = {
	closes: "The pull request closes its ticket",
	"part-of": "It is one part (`Part of`)",
	none: "It names no ticket",
};
const citing = (
	fate: Fate | null,
	how: (typeof HOWS)[number] | null,
	pick: (r: RepoCount) => Record<string, number>,
) =>
	total((r) =>
		Object.entries(pick(r)).reduce((n, [key, count]) => {
			const [f, h] = key.split("/");
			return (fate === null || f === fate) && (how === null || h === how) ? n + count : n;
		}, 0),
	);
table(
	"2c. Gap-label entries in the four-field form whose Said field names a criterion (a rough stand-in, see the write-up)",
	["What the builder said would become of it", ...HOWS.map((h) => howNames[h]), "All"],
	[...FATES, null].map((fate) => [
		fate === null ? "All" : fateNames[fate],
		...[...HOWS, null].map((how) =>
			share(
				citing(fate, how, (r) => r.gapSaidCites),
				citing(fate, how, (r) => r.gapSaid),
			),
		),
	]),
);

// ------------------------------------------------ 3. the follow-ups

const distinctFollowUps = [
	...new Map(saved.followUps.map((f) => [`${f.issueRepo}#${f.issue}`, f])).values(),
];
const fetchedAt = ms(saved.fetched);
console.log(
	`\n3. ${saved.followUps.length} entry-to-issue links, from ${new Set(saved.followUps.map((f) => `${f.repo}#${f.pr}`)).size} pull requests, to ${distinctFollowUps.length} distinct issues; ${saved.followUps.filter((f) => f.how === "lane").length} found through the lane, not a number. ${saidFiledCount()} more entries say filed with no issue found.`,
);
function saidFiledCount(): number {
	return saved.saidFiled.length;
}
console.log(
	`   First ${saved.followUps[0]?.merged.slice(0, 10)}, last ${saved.followUps.at(-1)?.merged.slice(0, 10)}. ${distinctFollowUps.filter((f) => f.agentFiled).length} of the ${distinctFollowUps.length} issues carry the "Filed by an agent" footer. ${saved.followUps.filter((f) => !f.closes).length} links are from a pull request that did not close its ticket.`,
);
function fateOf(f: FollowUp): string {
	if (f.state === "OPEN")
		return f.labels.includes(NEEDS) ? "open, in the triage queue" : "open, triaged";
	if (f.by !== null) return "closed by a merged pull request";
	return f.why === "COMPLETED" ? "closed as done, no pull request" : "closed as not planned";
}
const fateOrder = [
	"closed by a merged pull request",
	"closed as done, no pull request",
	"closed as not planned",
	"open, triaged",
	"open, in the triage queue",
];
const hoursTo = (from: string, to: string | null) =>
	to === null ? null : (ms(to) - ms(from)) / HOUR;
function fateTable(
	title: string,
	groups: readonly (readonly [string, readonly FollowUp[]])[],
): void {
	table(
		title,
		["State today", ...groups.map(([name, rows]) => `${name} (${rows.length})`)],
		fateOrder.map((fate) => [
			fate,
			...groups.map(([, rows]) =>
				share(rows.filter((f) => fateOf(f) === fate).length, rows.length),
			),
		]),
	);
}
const gapFollowUps = distinctFollowUps.filter((f) => GAP.includes(f.klass));
fateTable("3a. What became of each follow-up issue", [
	["All follow-ups", distinctFollowUps],
	["Under a gap label", gapFollowUps],
	["Under another label", distinctFollowUps.filter((f) => !GAP.includes(f.klass))],
	...saved.repos.map((r) => [r.repo, distinctFollowUps.filter((f) => f.repo === r.repo)] as const),
]);
fateTable(
	"3a, by the stand-in of table 2c. The same, by whether the entry's Said field names a criterion",
	[
		["Names a criterion", distinctFollowUps.filter((f) => f.cites)],
		["of them, the ticket closed", distinctFollowUps.filter((f) => f.cites && f.closes)],
		["Names none", distinctFollowUps.filter((f) => !f.cites)],
	],
);
function timeTable(title: string, rows: readonly FollowUp[]): void {
	const triage = rows.flatMap((f) =>
		f.entered !== null && f.left !== null ? [hoursTo(f.entered, f.left) ?? 0] : [],
	);
	const closed = rows.flatMap((f) => (f.closed === null ? [] : [hoursTo(f.filed, f.closed) ?? 0]));
	const built = rows.flatMap((f) =>
		f.closed === null || f.by === null ? [] : [hoursTo(f.filed, f.closed) ?? 0],
	);
	const dropped = rows.flatMap((f) =>
		f.closed === null || f.by !== null ? [] : [hoursTo(f.filed, f.closed) ?? 0],
	);
	const open = rows.flatMap((f) => (f.state === "OPEN" ? [(fetchedAt - ms(f.filed)) / HOUR] : []));
	table(
		title,
		["Span", "Issues", "25%", "Median", "75%", "90%", "Longest"],
		[
			["Filed to out of the triage queue", spreadOf(triage)] as const,
			["Filed to closed, any way", spreadOf(closed)] as const,
			["Filed to closed by a merged pull request", spreadOf(built)] as const,
			["Filed to closed with no pull request", spreadOf(dropped)] as const,
			["Still open: age today", spreadOf(open)] as const,
		].map(([name, s]) => [name, s.n, ...spreadCells(s)]),
	);
}
timeTable("3b. How long, all follow-ups", distinctFollowUps);
timeTable("3c. How long, follow-ups under a gap label", gapFollowUps);
const openOnes = distinctFollowUps.filter((f) => f.state === "OPEN");
const openLabels = new Tally();
for (const f of openOnes)
	for (const label of f.labels) if (/^(status:|ready-for:|p\d$)/.test(label)) openLabels.add(label);
console.log(
	`\n   The ${openOnes.length} still open carry: ${Object.entries(openLabels.object())
		.map(([k, n]) => `${k} ${n}`)
		.join(", ")}.`,
);
console.log(
	`   Never carried ${NEEDS}: ${distinctFollowUps.filter((f) => f.entered === null).length}. Left the queue by being closed, label still on: ${distinctFollowUps.filter((f) => f.leftBy === "closed").length}.`,
);

const noPr = distinctFollowUps.filter((f) => f.closed !== null && f.by === null);
const whyKeys = [...CLOSE_WHY.map((c) => c.key as string), "other", "unread"];
table(
	`3d. The ${noPr.length} follow-ups closed with no pull request, by the reason in the last comment`,
	["Reason", "Follow-ups", "Closed as not planned", "Closed as done", "Filed to closed, median"],
	whyKeys.flatMap((key) => {
		const rows = noPr.filter((f) => f.closeWhy === key);
		if (rows.length === 0) return [];
		const hours = spreadOf(rows.map((f) => hoursTo(f.filed, f.closed) ?? 0));
		return [
			[
				closeWhyNames[key] ?? key,
				share(rows.length, noPr.length),
				rows.filter((f) => f.why !== "COMPLETED").length,
				rows.filter((f) => f.why === "COMPLETED").length,
				span(hours.median),
			],
		];
	}),
);

// ------------------------------------------------ 7. the wait beside other issues

table(
	`7. Time in ${NEEDS}, for issues filed since the first follow-up`,
	[
		"Issues",
		"All",
		"Entered the queue",
		"Still in it",
		"25%",
		"Median",
		"75%",
		"90%",
		"Longest",
		"Out within an hour",
		"Within a day",
	],
	saved.waits.map((w) => [
		w.name,
		w.issues,
		w.entered,
		w.waiting,
		...spreadCells(w.hours),
		share(w.within["1h"] ?? 0, w.hours.n),
		share(w.within["1d"] ?? 0, w.hours.n),
	]),
);
table(
	"7b. What became of the same issues",
	["Issues", "All", ...fateOrder, "Median filed to closed by a pull request", "90%"],
	saved.closes.map((c) => [
		c.name,
		c.issues,
		...fateOrder.map((fate) => share(c.fate[fate] ?? 0, c.issues)),
		c.toBuilt.n === 0 ? "" : span(c.toBuilt.median),
		c.toBuilt.n === 0 ? "" : span(c.toBuilt.p90),
	]),
);

// ------------------------------------------------ 6. the other side

table(
	"6. A pull request's own life, by what its Deviations section holds",
	[
		"Merged pull requests",
		"Count",
		"Open, median",
		"Open, 90%",
		"Open, longest",
		"Commits, median",
		"Commits, 90%",
		"Changed lines, median",
		"Force-pushed",
		"Queued more than once",
	],
	saved.holds.map((h) => [
		h.name,
		h.prs,
		span(h.openHours.median),
		span(h.openHours.p90),
		span(h.openHours.max),
		h.commits.median,
		h.commits.p90,
		h.lines.median,
		share(h.forced, h.prs),
		share(h.requeued, h.prs),
	]),
);
console.log(
	`\n   Closed without merging: ${total((r) => r.closedUnmerged)} of ${total((r) => r.prs)} pull requests; ${saved.unmerged.withSection} of them carry a Deviations section, and ${saved.unmerged.lanes} of ${saved.unmerged.lanesAll} lane-branch pull requests ended that way (open for a median ${span(saved.unmerged.openHours.median)}, 90% ${span(saved.unmerged.openHours.p90)}).`,
);
console.log(
	`   The leftover, when it was built: ${saved.fixes.n} follow-ups were closed by a merged pull request. That pull request changed a median ${saved.fixes.lines.median} lines (90%: ${saved.fixes.lines.p90}) and was open a median ${span(saved.fixes.openHours.median)} (90%: ${span(saved.fixes.openHours.p90)}). The pull request that left the gap changed a median ${saved.fixes.parentLines.median} lines. The fix was the smaller of the two in ${share(saved.fixes.smaller, saved.fixes.n)}.`,
);
// ------------------------------------------------ 6b. the pipeline's other way: land one part, keep the ticket open

// One row for each ticket: its first part to merge.
const partialParents = [
	...new Map([...saved.partials].reverse().map((p) => [`${p.repo}#${p.parent}`, p])).values(),
];
const lagOf = (p: Partial) =>
	p.parentClosed === null ? null : (ms(p.parentClosed) - ms(p.merged)) / HOUR;
function partialFate(p: Partial): string {
	const lag = lagOf(p);
	if (lag === null) return "still open";
	if (p.parentWhy !== "COMPLETED") return "closed as not planned";
	if (p.closedBy !== null && p.closedBy !== p.pr) return "closed by a later merged pull request";
	return lag <= 1 ? "closed by hand within the hour" : "closed by hand later";
}
const partialOrder = [
	"closed by hand within the hour",
	"closed by a later merged pull request",
	"closed by hand later",
	"closed as not planned",
	"still open",
];
table(
	`6b. "Part of" pull requests: ${saved.partials.length} merged (${saved.partials.filter((p) => !p.intoMain).length} not into the main branch), for ${partialParents.length} tickets. What became of the ticket`,
	[
		"The ticket",
		"Tickets",
		"First part merged to ticket closed, median",
		"90%",
		"Longest",
		"Open today: age since the part merged, median",
		"Longest",
	],
	partialOrder.map((fate) => {
		const rows = partialParents.filter((p) => partialFate(p) === fate);
		const lags = spreadOf(rows.flatMap((p) => lagOf(p) ?? []));
		const ages = spreadOf(
			rows.flatMap((p) => (p.parentClosed === null ? [(fetchedAt - ms(p.merged)) / HOUR] : [])),
		);
		return [
			fate,
			share(rows.length, partialParents.length),
			lags.n === 0 ? "" : span(lags.median),
			lags.n === 0 ? "" : span(lags.p90),
			lags.n === 0 ? "" : span(lags.max),
			ages.n === 0 ? "" : span(ages.median),
			ages.n === 0 ? "" : span(ages.max),
		];
	}),
);

// ------------------------------------------------ 4 and 5. the hand sort

/** One case as a person read it: a word per question, from the bins of the same name, and a note. */
type Reading = Readonly<Record<string, string>>;
interface Readings {
	readonly rule: string;
	/** Question → answer → what the answer means. */
	readonly bins: Record<string, Record<string, string>>;
	readonly filed: Record<string, Reading>;
	readonly stated: Record<string, Reading>;
	readonly narrowed: Record<string, Reading>;
	readonly known: Record<string, Reading>;
}
if (!existsSync(readingsFile)) {
	console.log("\nNo hand readings yet (60-readings.json).");
	process.exit(0);
}
const readings = JSON.parse(readFileSync(readingsFile, "utf8")) as Readings;
function handTable(
	title: string,
	cases: readonly Case[],
	labels: Readings["filed"],
	questions: readonly string[],
): void {
	const read = cases.filter((c) => labels[c.id] !== undefined);
	console.log(`\n${title}: ${read.length} of ${cases.length} cases read.`);
	for (const question of questions) {
		const tally = new Tally();
		for (const c of read) tally.add(labels[c.id]?.[question] ?? "?");
		table(
			`   ${question}`,
			["Reading", "Cases", "What it means"],
			Object.entries(tally.object()).map(([key, n]) => [
				key,
				share(n, read.length),
				readings.bins[question]?.[key] ?? "",
			]),
		);
	}
	const cross = new Tally();
	for (const c of read) cross.add(`${classNames[c.klass]} → ${labels[c.id]?.part ?? "?"}`);
	table(
		"   the builder's label beside the hand reading of `part`",
		["Label → reading", "Cases"],
		Object.entries(cross.object()),
	);
}
handTable("4 and 5. The filed sample", saved.sample, readings.filed, [
	"part",
	"why",
	"review",
	"failed",
	"asked",
]);
const poolLine = (klass: string) =>
	`drawn from ${saved.pools[klass]?.entries ?? 0} such entries on ${saved.pools[klass]?.prs ?? 0} pull requests`;
handTable(
	`4, second sample. Known defects that were stated and not filed (${poolLine("defect")})`,
	saved.statedSample,
	readings.stated,
	["part", "why", "tracked"],
);
handTable(
	`4, third sample. Scope narrowings that were stated and not filed (${poolLine("scope")})`,
	saved.narrowedSample,
	readings.narrowed,
	["part", "why", "tracked"],
);
// The stand-in of table 2c beside the hand reading: does "the Said field names a criterion" find the cases read as a criterion's own words?
const ownWords = (part: string | undefined) => part?.startsWith("a") === true;
table(
	"4c. The stand-in of table 2c, checked against the hand reading",
	[
		"Sample",
		"Read",
		"Read as a criterion's own words",
		"of them the stand-in says yes",
		"Read as something else",
		"of them the stand-in says yes",
	],
	(
		[
			["filed", saved.sample, readings.filed],
			["known defects, stated", saved.statedSample, readings.stated],
			["scope narrowings, stated", saved.narrowedSample, readings.narrowed],
		] as const
	).map(([name, cases, labels]) => {
		const read = cases.filter((c) => labels[c.id] !== undefined);
		const own = read.filter((c) => ownWords(labels[c.id]?.part));
		const rest = read.filter((c) => !ownWords(labels[c.id]?.part));
		return [
			name,
			read.length,
			own.length,
			own.filter((c) => c.cites).length,
			rest.length,
			rest.filter((c) => c.cites).length,
		];
	}),
);
// What became of the follow-up, by the hand reading of whether it was the ticket's own.
const followUpOf = new Map(
	saved.followUps.map((f) => [`${nameOf(f.repo)}#${f.pr}/${f.entry}/${f.issue}`, f]),
);
const sampleFates = saved.sample.flatMap((c) => {
	const followUp = followUpOf.get(`${c.id}/${c.issue}`);
	const reading = readings.filed[c.id];
	return followUp === undefined || reading === undefined ? [] : [{reading, followUp}];
});
for (const question of ["part", "why", "review"]) {
	const answers = [...new Set(sampleFates.map((s) => s.reading[question] ?? "?"))].sort();
	table(
		`4b. The filed sample: what became of the follow-up, by the hand reading of \`${question}\``,
		["Reading", "Cases", ...fateOrder, "Filed to built, median"],
		[...answers, "all"].map((answer) => {
			const rows = sampleFates
				.filter((s) => answer === "all" || s.reading[question] === answer)
				.map((s) => s.followUp);
			const built = spreadOf(
				rows.flatMap((f) => (f.by === null ? [] : (hoursTo(f.filed, f.closed) ?? []))),
			);
			return [
				answer,
				rows.length,
				...fateOrder.map((fate) => rows.filter((f) => fateOf(f) === fate).length),
				built.n === 0 ? "" : span(built.median),
			];
		}),
	);
}
