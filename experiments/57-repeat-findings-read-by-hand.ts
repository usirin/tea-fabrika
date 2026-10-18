// Experiment 54 said that 181 of 312 placed later-round findings quote text
// that was already in the pull request a round earlier and that no earlier
// review had raised. That number came from a rule of thumb. This draws 60 of
// the 181 with a fixed seed, lays each one out to be read by hand, and then
// asks Jev the same question.
//
// Run with
//   node experiments/57-repeat-findings-read-by-hand.ts
//
//   (no STEP)     print the tables from the readings and the saved answers: no
//                 key, no network, no cache
//   STEP=cases    draw the sample and write each case's text into CACHE/exp-57,
//                 to read. Needs CACHE (experiment 54's cache folder, after a
//                 run of that script with ORIGINS=1) and CLONE (a local clone
//                 of the repo that holds the reviewed commits). Git only, and
//                 read-only: `show`, `diff`, `grep`, `merge-base`
//   STEP=jev      ask Jev the same question on the sample (needs
//                 TYPESAFE_API_KEY, CACHE and CLONE). DRY=1 prints the cost and
//                 stops, TRY=<n> asks only the first n
//
// `57-readings.json` holds the bins, in the words Jev is also given, and the
// reading of each case, by hand. `results/repeat-findings-read-by-hand.json`
// holds one row per case (its link, the two commits, what git says about its
// quotes, the reading, Jev's shares) and the counts. Neither holds a line of
// any comment.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {findingsIn} from "../wip/src/verdict";
import {readThread} from "./lib/threads.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-54-cache");
const CLONE = process.env.CLONE ?? "";
const STEP = process.env.STEP ?? "tables";
/** The sample is the first 60 of the 181 after this shuffle. */
const SEED = 57;
const SAMPLE = 60;
/** The five bins the experiment set out with, and two the reading had to add. */
const BINS = [
	"missed",
	"made_by_fix",
	"written_by_fix",
	"new_from_outside",
	"raised_before",
	"not_a_problem",
	"cannot_tell",
] as const;
type Bin = (typeof BINS)[number];
/** The three bins that say the problem did not exist when the earlier review read the change. */
const NEW_SINCE: readonly Bin[] = ["made_by_fix", "written_by_fix", "new_from_outside"];
/** Jev's price, the one `lib/jev.ts` counts with, and this experiment's own limit. */
const DOLLARS_PER_TOKEN = 0.042 / 1_000_000;
const MAX_DOLLARS = 2;
/** The share at which experiment 54 took Jev's first choice as sure. */
const SURE = 0.8;

const resultsFile = join(here, "results", "repeat-findings-read-by-hand.json");
const readingsFile = join(here, "57-readings.json");

// ---------------------------------------------------------------- small tools

const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} (${pct(n, of)})`;
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
/** The same fixed shuffle experiment 54 uses. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
	const out = [...items];
	let state = seed;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}
/** A 95% Wilson interval for k of n, as two shares. */
function wilson(k: number, n: number): [number, number] {
	if (n === 0) return [0, 1];
	const z = 1.96;
	const p = k / n;
	const mid = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
	const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
	return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
const range = ([lo, hi]: [number, number], times = 1) =>
	`${(100 * lo * times).toFixed(0)}% to ${(100 * hi * times).toFixed(0)}%`;

// ---------------------------------------------------------------- what is saved

/** What git says about one finding's quotes. No text. */
interface Facts {
	/** Quotes the finding carries, by experiment 54's rule. */
	readonly quotes: number;
	/** How many of them are in a file at the earlier round's commit, and at this round's. */
	readonly atEarlier: number;
	readonly atThis: number;
	/** How many sit in a file the repair changed. */
	readonly inChangedFile: number;
	/** How many are in a verdict of any earlier round. Experiment 54 looked only at the round just before. */
	readonly inEarlierRounds: number;
	/** How many are in the pull request's text or the ticket's, as they read today. */
	readonly inPullOrTicket: number;
	/** Files the repair changed. */
	readonly repairFiles: number;
}
interface Row {
	readonly key: string;
	readonly url: string;
	readonly namespace: string;
	readonly round: number;
	readonly on: string;
	readonly earlierHead: string;
	readonly head: string;
	readonly facts: Facts;
	/** The reading by hand, copied in from `57-readings.json`. */
	reading?: Reading;
	/** The share Jev gave each bin. */
	jev?: Readonly<Record<string, number>>;
}
type Told = "yes" | "no" | "unclear";
interface Reading {
	readonly bin: Bin;
	readonly why: string;
	/** A close call: the other bin that was weighed. */
	readonly otherBin?: Bin;
	/** For `not_a_problem`: a note the reviewer says does not block, or text that is no finding at all. */
	readonly sub?: "note" | "not_a_finding";
	/** For a `missed` case: what the finding is about. */
	readonly about?: "code" | "tests" | "docs" | "pr_text";
	/** For a `missed` case: whether an earlier review's text names that file or part, or says it read it. */
	readonly readBefore?: Told;
	/** For a `missed` case: whether the problem was already in the first commit that was reviewed. */
	readonly atFirstHead?: Told;
	/** For a `missed` case: whether an earlier review failed the same kind of fault in another place. */
	readonly sameFaultElsewhere?: boolean;
}
interface Readings {
	readonly question: string;
	readonly bins: Readonly<Record<Bin, string>>;
	readonly readings: Readonly<Record<string, Reading>>;
}
interface Saved {
	population: number;
	/** The same facts over all 181, counted with no reading. */
	all?: Record<string, number>;
	/** What the calls to Jev cost so far: text sent, at four characters a token. */
	jevCost?: {calls: number; tokens: number; dollars: number};
	cases: Row[];
	[more: string]: unknown;
}
const saved: Saved = existsSync(resultsFile)
	? (JSON.parse(readFileSync(resultsFile, "utf8")) as Saved)
	: {population: 0, cases: []};
const save = () =>
	writeFileSync(resultsFile, `${JSON.stringify(saved)}\n`.replace(/\{"key":/g, '\n{"key":'));
const readings: Readings = existsSync(readingsFile)
	? (JSON.parse(readFileSync(readingsFile, "utf8")) as Readings)
	: {question: "", bins: {} as Record<Bin, string>, readings: {}};

// ---------------------------------------------------------------- the cases, from experiment 54's cache and git

interface VerdictText {
	readonly url: string;
	readonly namespace: string;
	readonly polarity: "PASS" | "FAIL";
	readonly clause: string;
	readonly body: string;
}
interface Origin {
	readonly key: string;
	readonly origin: string;
	readonly review: string;
	readonly round: number;
	readonly on: string;
	readonly thread: number;
	readonly verdict: VerdictText;
	readonly text: string;
	readonly quotes: readonly string[];
	readonly head: string | null;
	readonly earlier: readonly {
		readonly review: string;
		readonly round: number;
		readonly head: string | null;
		readonly verdicts: readonly VerdictText[];
	}[];
}

const norm = (text: string) => text.replace(/[*_>]/g, "").replace(/\s+/g, " ").trim();
const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)} […]` : text);

function git(...args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", CLONE, ...args], {
			encoding: "utf8",
			maxBuffer: 512 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}
const shown = new Map<string, string | null>();
/** A file at a commit, or `null` when it is not there. */
function fileAt(sha: string, path: string): string | null {
	const id = `${sha}:${path}`;
	if (!shown.has(id)) shown.set(id, git("show", id));
	return shown.get(id) ?? null;
}
/** A file's text with experiment 54's cleaning, and the line each cleaned offset came from. */
function indexOf(content: string): {text: string; lineAt: (offset: number) => number} {
	const starts: number[] = [];
	const lines: number[] = [];
	let text = "";
	content.split("\n").forEach((line, i) => {
		const clean = norm(line);
		if (clean === "") return;
		starts.push(text.length);
		lines.push(i + 1);
		text += `${clean} `;
	});
	return {
		text,
		lineAt: (offset) => {
			let at = 0;
			for (let i = 0; i < starts.length && (starts[i] as number) <= offset; i++) at = i;
			return lines[at] ?? 1;
		},
	};
}
interface Place {
	readonly path: string;
	readonly line: number;
}
/** Where a quote sits at a commit: first in the files given, then anywhere in the tree. */
function placeOf(quote: string, raw: string, sha: string, files: readonly string[]): Place | null {
	for (const path of files) {
		const content = fileAt(sha, path);
		if (content === null) continue;
		const index = indexOf(content);
		const at = index.text.indexOf(quote);
		if (at >= 0) return {path, line: index.lineAt(at)};
	}
	const hit = git("grep", "-n", "-I", "-F", "-e", raw, sha)?.split("\n")[0];
	const m = hit === undefined ? null : /^[0-9a-f]+:([^:]+):(\d+):/.exec(hit);
	return m === null ? null : {path: m[1] as string, line: Number(m[2])};
}
/** The quotes as the finding wrote them, before cleaning: the same two shapes experiment 54 cuts. */
function rawQuotesOf(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of text.matchAll(/`([^`\n]{15,240})`/g)) {
		const quote = norm(m[1] as string);
		if (/\s/.test(quote) && quote.length >= 15 && !out.has(quote))
			out.set(quote, (m[1] as string).trim());
	}
	for (const m of text.matchAll(/"([^"\n]{25,240})"/g))
		if (!out.has(norm(m[1] as string))) out.set(norm(m[1] as string), (m[1] as string).trim());
	return out;
}
/** Paths a finding names, with a line range when it gives one. */
function pathsIn(text: string): {path: string; from: number | null; to: number | null}[] {
	const out = new Map<string, {path: string; from: number | null; to: number | null}>();
	for (const m of text.matchAll(
		/((?:[\w.@-]+\/)+[\w.@[\]-]+\.[A-Za-z]{1,6})(?::(\d+)(?:[-–](\d+))?)?/g,
	)) {
		const path = m[1] as string;
		const had = out.get(path);
		if (had === undefined || (had.from === null && m[2] !== undefined))
			out.set(path, {
				path,
				from: m[2] === undefined ? null : Number(m[2]),
				to: m[3] === undefined ? (m[2] === undefined ? null : Number(m[2])) : Number(m[3]),
			});
	}
	return [...out.values()];
}

interface Gathered {
	readonly origin: Origin;
	readonly a: string;
	readonly b: string;
	readonly quotes: readonly {
		readonly quote: string;
		readonly raw: string;
		readonly atA: Place | null;
		readonly atB: Place | null;
		readonly earlierRound: number | null;
		readonly inPull: boolean;
		readonly inTicket: boolean;
		readonly nearestChange: number | null;
	}[];
	readonly changed: readonly string[];
	readonly named: readonly {path: string; from: number | null; to: number | null}[];
	readonly facts: Facts;
}

/** New-side line ranges the repair changed in one file. */
function changedLines(a: string, b: string, path: string): [number, number][] {
	const diff = git("diff", "-U0", a, b, "--", path) ?? "";
	return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => {
		const start = Number(m[1]);
		const count = m[2] === undefined ? 1 : Number(m[2]);
		return [start, start + Math.max(count, 1) - 1] as [number, number];
	});
}

function gather(origin: Origin): Gathered | null {
	const a = origin.earlier.at(-1)?.head ?? null;
	const b = origin.head;
	if (a === null || b === null) return null;
	const changed = (git("diff", "--name-only", a, b) ?? "")
		.split("\n")
		.filter((line) => line !== "");
	const base = git("merge-base", "origin/main", b)?.trim() ?? null;
	const inPull =
		base === null
			? []
			: (git("diff", "--name-only", base, b) ?? "").split("\n").filter((line) => line !== "");
	const named = pathsIn(origin.text);
	const files = [...new Set([...named.map((n) => n.path), ...changed, ...inPull])].slice(0, 400);
	const pull = readThread(CACHE, origin.thread);
	const pullText = pull === null || pull === "missing" ? "" : norm(pull.body);
	const issueNumber = Number.parseInt(origin.review, 10);
	const ticket =
		Number.isNaN(issueNumber) || issueNumber === origin.thread
			? null
			: readThread(CACHE, issueNumber);
	const ticketText = ticket === null || ticket === "missing" ? "" : norm(ticket.body);
	const quotes = [...rawQuotesOf(origin.text)].map(([quote, raw]) => {
		const atA = placeOf(quote, raw, a, files);
		const atB = placeOf(quote, raw, b, files);
		const said = origin.earlier.find((e) =>
			norm(e.verdicts.map((v) => v.body).join(" ")).includes(quote),
		);
		const lines = atB === null || !changed.includes(atB.path) ? [] : changedLines(a, b, atB.path);
		const nearest =
			atB === null || lines.length === 0
				? null
				: Math.min(
						...lines.map(([from, to]) =>
							atB.line < from ? from - atB.line : atB.line > to ? atB.line - to : 0,
						),
					);
		return {
			quote,
			raw,
			atA,
			atB,
			earlierRound: said?.round ?? null,
			inPull: pullText.includes(quote),
			inTicket: origin.on === "epic" ? pullText.includes(quote) : ticketText.includes(quote),
			nearestChange: nearest,
		};
	});
	const facts: Facts = {
		quotes: quotes.length,
		atEarlier: quotes.filter((q) => q.atA !== null).length,
		atThis: quotes.filter((q) => q.atB !== null).length,
		inChangedFile: quotes.filter((q) => q.atB !== null && changed.includes(q.atB.path)).length,
		inEarlierRounds: quotes.filter((q) => q.earlierRound !== null).length,
		inPullOrTicket: quotes.filter((q) => q.inPull || q.inTicket).length,
		repairFiles: changed.length,
	};
	return {origin, a, b, quotes, changed, named, facts};
}

/** A few lines of a file around a line, numbered. */
function around(sha: string, path: string, from: number, to: number, pad = 5): string {
	const content = fileAt(sha, path);
	if (content === null) return "(not in the tree at this commit)";
	const lines = content.split("\n");
	const start = Math.max(1, from - pad);
	const end = Math.min(lines.length, Math.max(to, from) + pad, start + 40);
	return lines
		.slice(start - 1, end)
		.map((line, i) => `${start + i}: ${cut(line, 260)}`)
		.join("\n");
}

/** One case, laid out to be read. It holds comment text, so it goes to the cache folder. */
function viewOf(g: Gathered, n: number): string {
	const o = g.origin;
	const out: string[] = [];
	out.push(`# case ${n}  ${o.key}  round ${o.round}  ${o.verdict.namespace}  ${o.on}`);
	out.push(
		`${o.verdict.url}\nearlier ${g.a.slice(0, 10)} -> this ${g.b.slice(0, 10)}  (review ${o.review})`,
	);
	out.push(`reason line: ${o.verdict.clause}`);
	out.push(`\n## The finding\n${cut(o.text, 2600)}`);
	out.push(`\n## Its quotes (${g.quotes.length})`);
	const place = (p: Place | null) => (p === null ? "nowhere" : `${p.path}:${p.line}`);
	g.quotes.slice(0, 8).forEach((q, i) => {
		const repair =
			q.atB === null
				? ""
				: g.changed.includes(q.atB.path)
					? ` | repair changed this file, nearest changed line ${q.nearestChange} away`
					: " | repair did not change this file";
		out.push(
			`${i + 1}. \`${cut(q.raw, 150)}\`\n   earlier: ${place(q.atA)} | this: ${place(q.atB)}${repair}${q.earlierRound === null ? "" : ` | IN A VERDICT OF ROUND ${q.earlierRound}`}${q.inPull ? " | in the pull request text (today's)" : ""}${q.inTicket ? " | in the ticket text" : ""}`,
		);
	});
	// Where to look: the quotes that were found, and the lines the finding names.
	const spots = new Map<string, {path: string; from: number; to: number}>();
	for (const name of g.named)
		if (name.from !== null)
			spots.set(name.path, {path: name.path, from: name.from, to: name.to ?? name.from});
	for (const q of g.quotes)
		if (q.atB !== null && !spots.has(q.atB.path))
			spots.set(q.atB.path, {path: q.atB.path, from: q.atB.line, to: q.atB.line});
	for (const spot of [...spots.values()].slice(0, 2)) {
		const now = around(g.b, spot.path, spot.from, spot.to);
		const was = around(g.a, spot.path, spot.from, spot.to);
		out.push(`\n## ${spot.path} at this commit\n${now}`);
		out.push(
			was === now
				? "(the same lines at the earlier commit)"
				: `\n## the same line numbers at the earlier commit\n${was}`,
		);
	}
	const interest = new Set([...spots.keys(), ...g.named.map((x) => x.path)]);
	out.push(
		`\n## The repair: ${g.changed.length} files changed. Named by the finding or holding a quote: ${g.changed.filter((p) => interest.has(p)).join(", ") || "none"}`,
	);
	out.push(
		cut((git("diff", "--stat=120", g.a, g.b) ?? "").split("\n").slice(0, 16).join("\n"), 1800),
	);
	let room = 110;
	for (const path of [
		...g.changed.filter((p) => interest.has(p)),
		...g.changed.filter((p) => !interest.has(p)),
	].slice(0, 4)) {
		if (room <= 0) break;
		const diff = (git("diff", "-U2", g.a, g.b, "--", path) ?? "").split("\n").slice(4);
		const take = diff.slice(0, Math.min(room, interest.has(path) ? 70 : 30));
		room -= take.length;
		out.push(
			`\n### diff of ${path}${take.length < diff.length ? ` (first ${take.length} of ${diff.length} lines)` : ""}\n${take.map((line) => cut(line, 240)).join("\n")}`,
		);
	}
	out.push("\n## Earlier rounds");
	const words = [...new Set([...interest].map((p) => p.split("/").pop() as string))];
	for (const e of o.earlier) {
		out.push(`\n### round ${e.round} at ${(e.head ?? "?").slice(0, 10)}`);
		for (const v of e.verdicts) {
			out.push(`- ${v.namespace} ${v.polarity}: ${cut(v.clause, 300)}`);
			if (v.polarity === "FAIL") {
				const found = findingsIn(v.body).filter((f) => f.blocking);
				if (found.length === 0) out.push(`    (no list) ${cut(squeeze(v.body), 500)}`);
				for (const [i, f] of found.slice(0, 6).entries())
					out.push(`    ${i + 1}. ${cut(squeeze(f.text), 420)}`);
			}
			const body = squeeze(v.body);
			let hits = 0;
			for (const word of words) {
				const at = body.indexOf(word);
				if (at < 0 || hits >= 2) continue;
				hits += 1;
				out.push(`    mentions ${word}: …${body.slice(Math.max(0, at - 160), at + 200)}…`);
			}
		}
	}
	return out.join("\n");
}

function origins(): Origin[] {
	const file = join(CACHE, "origins.json");
	if (!existsSync(file) || CLONE === "") {
		console.error(
			"this step needs CACHE (with origins.json from experiment 54 run with ORIGINS=1) and CLONE (a local clone of the repo)",
		);
		process.exit(1);
	}
	return (JSON.parse(readFileSync(file, "utf8")) as Origin[])
		.filter((o) => o.origin === "there before, not raised")
		.sort((x, y) => x.key.localeCompare(y.key));
}

if (STEP === "cases") {
	const all = origins();
	const gathered = all.map(gather);
	const kept = gathered.filter((g): g is Gathered => g !== null);
	const sum = (pick: (f: Facts) => boolean) => kept.filter((g) => pick(g.facts)).length;
	saved.population = all.length;
	saved.all = {
		findings: all.length,
		withBothCommits: kept.length,
		aQuoteInAFileAtTheEarlierCommit: sum((f) => f.atEarlier > 0),
		aQuoteInAFileAtThisCommit: sum((f) => f.atThis > 0),
		noQuoteInAnyFileAtEitherCommit: sum((f) => f.atEarlier === 0 && f.atThis === 0),
		aQuoteInAFileTheRepairChanged: sum((f) => f.inChangedFile > 0),
		aQuoteInAVerdictOfAnEarlierRound: sum((f) => f.inEarlierRounds > 0),
		aQuoteInThePullOrTicketText: sum((f) => f.inPullOrTicket > 0),
	};
	const picked = shuffled(all, SEED).slice(0, SAMPLE);
	const dir = join(CACHE, "exp-57");
	mkdirSync(dir, {recursive: true});
	const had = new Map(saved.cases.map((row) => [row.key, row]));
	saved.cases = picked.flatMap((origin, i) => {
		const g = gathered[all.indexOf(origin)] ?? null;
		if (g === null) return [];
		writeFileSync(join(dir, `case-${String(i + 1).padStart(2, "0")}.md`), viewOf(g, i + 1));
		const row: Row = {
			key: origin.key,
			url: origin.verdict.url,
			namespace: origin.verdict.namespace,
			round: origin.round,
			on: origin.on,
			earlierHead: g.a,
			head: g.b,
			facts: g.facts,
		};
		const jev = had.get(origin.key)?.jev;
		return [jev === undefined ? row : {...row, jev}];
	});
	save();
	console.log(`the ${all.length} findings: ${JSON.stringify(saved.all)}`);
	console.log(`wrote ${saved.cases.length} cases into the cache folder, under exp-57`);
	process.exit(0);
}

// ---------------------------------------------------------------- Jev, on the same cases

/** The least text that still lets the question be answered: the finding, what earlier reviews failed, and what git says. */
function stateOf(g: Gathered): object {
	const o = g.origin;
	const nearest = g.quotes.map((q) => q.nearestChange).filter((n): n is number => n !== null);
	const changedIt = (path: string) => g.changed.some((p) => p === path || p.endsWith(`/${path}`));
	return {
		finding: cut(squeeze(o.text), 700),
		reason_line_of_this_review: cut(o.verdict.clause, 200),
		round: o.round,
		earlier_failed_reviews: o.earlier
			.flatMap((e) =>
				e.verdicts
					.filter((v) => v.polarity === "FAIL")
					.map((v) => ({
						round: e.round,
						reason_line: cut(v.clause, 160),
						findings: findingsIn(v.body)
							.filter((f) => f.blocking)
							.slice(0, 4)
							.map((f) => cut(squeeze(f.text), 160)),
					})),
			)
			.slice(-6),
		what_git_says: {
			quotes_in_the_finding: g.quotes.length,
			quotes_in_a_file_at_the_earlier_commit: g.facts.atEarlier,
			quotes_in_a_file_the_repair_changed: g.facts.inChangedFile,
			lines_from_a_quote_to_the_nearest_line_the_repair_changed:
				nearest.length === 0 ? null : Math.min(...nearest),
			files_the_finding_names: g.named.length,
			files_it_names_that_the_repair_changed: g.named.filter((name) => changedIt(name.path)).length,
			files_the_repair_changed: g.changed.length,
		},
	};
}

if (STEP === "jev") {
	const byKey = new Map(origins().map((o) => [o.key, o]));
	const waiting = saved.cases.filter((row) => row.jev === undefined);
	const todo = process.env.TRY === undefined ? waiting : waiting.slice(0, Number(process.env.TRY));
	const questions = {
		bin: {type: "choice", instructions: readings.question, criteria: readings.bins},
	};
	const asks = todo.flatMap((row) => {
		const origin = byKey.get(row.key);
		const g = origin === undefined ? null : gather(origin);
		return g === null ? [] : [{row, state: stateOf(g)}];
	});
	const tokens = asks.reduce(
		(n, ask) => n + JSON.stringify({model: "jev-latest", questions, state: ask.state}).length / 4,
		0,
	);
	const had = saved.jevCost ?? {calls: 0, tokens: 0, dollars: 0};
	console.log(
		`${asks.length} calls to make, about ${Math.round(tokens)} tokens, about $${(tokens * DOLLARS_PER_TOKEN).toFixed(4)}. Spent so far $${had.dollars.toFixed(4)}. The limit is $${MAX_DOLLARS}.`,
	);
	if (process.env.DRY === "1" || asks.length === 0) process.exit(0);
	if (had.dollars + tokens * DOLLARS_PER_TOKEN > MAX_DOLLARS) {
		console.error("that would pass the limit, so nothing was asked");
		process.exit(1);
	}
	process.env.MAX_DOLLARS ??= String(MAX_DOLLARS);
	const {askAll, pool} = await import("./lib/jev.ts");
	await pool(asks, 6, async ({row, state}) => {
		const answer = (await askAll(questions, state)).bin as
			| {probabilities: Record<string, number>}
			| undefined;
		if (answer === undefined) throw new Error(`Jev did not answer for ${row.key}`);
		row.jev = Object.fromEntries(
			Object.entries(answer.probabilities).map(([bin, p]) => [bin, Math.round(p * 1000) / 1000]),
		);
	});
	const total = Math.round(had.tokens + tokens);
	saved.jevCost = {
		calls: had.calls + asks.length,
		tokens: total,
		dollars: Math.round(total * DOLLARS_PER_TOKEN * 1e6) / 1e6,
	};
	save();
	for (const {row} of asks) {
		const top = Object.entries(row.jev ?? {}).sort((x, y) => y[1] - x[1]);
		console.log(
			`${row.key}  by hand ${readings.readings[row.key]?.bin ?? "?"}  Jev ${top
				.slice(0, 3)
				.map(([bin, p]) => `${bin} ${p.toFixed(2)}`)
				.join(", ")}`,
		);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- the tables: no key, no network, no cache

const rows = saved.cases;
const unread = rows.filter((row) => readings.readings[row.key] === undefined);
if (rows.length === 0 || unread.length > 0) {
	console.error(
		rows.length === 0
			? "no cases are saved: run STEP=cases first"
			: `${unread.length} cases have no reading in 57-readings.json`,
	);
	process.exit(1);
}
for (const row of rows) row.reading = readings.readings[row.key];
const of = (row: Row) => row.reading as Reading;
const n = rows.length;
const how = (pick: (row: Row) => boolean) => rows.filter(pick).length;
const tally = <T>(items: readonly T[], key: (item: T) => string) => {
	const out: Record<string, number> = {};
	for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
	return out;
};

// Findings come in clumps: one review, or one pull request, can hold several of
// the 60. Wilson counts each as its own draw. This redraws whole pull requests.
const pullOf = (row: Row) => /\/(?:pull|issues)\/(\d+)/.exec(row.url)?.[1] ?? row.key;
const clumps = Object.values(
	rows.reduce<Record<string, Row[]>>((out, row) => {
		const pull = pullOf(row);
		const clump = out[pull] ?? [];
		out[pull] = clump;
		clump.push(row);
		return out;
	}, {}),
);
function byPull(pick: (row: Row) => boolean): [number, number] {
	let state = SEED;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const shares: number[] = [];
	for (let i = 0; i < 10_000; i++) {
		let hit = 0;
		let all = 0;
		for (let j = 0; j < clumps.length; j++) {
			const clump = clumps[Math.floor(next() * clumps.length)] as Row[];
			all += clump.length;
			hit += clump.filter(pick).length;
		}
		shares.push(hit / all);
	}
	shares.sort((x, y) => x - y);
	return [shares[250] as number, shares[9749] as number];
}

// What experiment 54 counted: 181 of the findings it could place.
const fiftyFour = (
	JSON.parse(readFileSync(join(here, "results", "why-reviews-fail.json"), "utf8")) as {
		rounds: {origins: Record<string, {findings: number}>};
	}
).rounds.origins;
const placed = ["raised before", "written by the repair", "there before, not raised"].reduce(
	(sum, name) => sum + (fiftyFour[name]?.findings ?? 0),
	0,
);
const thereBefore = fiftyFour["there before, not raised"]?.findings ?? 0;
const scale = thereBefore / placed;

console.log(
	`${n} of the ${saved.population} findings experiment 54 called "there before, not raised" (${pct(thereBefore, placed)} of the ${placed} it placed), drawn with seed ${SEED}. ${clumps.length} pull requests, ${new Set(rows.map((row) => row.key.split("#")[0])).size} verdicts.`,
);

const line = (name: string, pick: (row: Row) => boolean) => {
	const k = how(pick);
	return [
		name,
		k,
		pct(k, n),
		range(wilson(k, n)),
		range(byPull(pick)),
		`${(100 * scale * (k / n)).toFixed(0)}% (${range(wilson(k, n), scale)})`,
	];
};
const head = [
	"",
	"cases",
	"share of the 60",
	"95% Wilson",
	"95% redrawing pull requests",
	`share of the ${placed} placed`,
];
table(
	"1. The 60, by bin",
	head,
	BINS.map((bin) => line(bin, (row) => of(row).bin === bin)),
);
const strict = (row: Row) => of(row).bin === "missed" && of(row).sameFaultElsewhere !== true;
table("2. The same, in the groups that matter", head, [
	line("missed", (row) => of(row).bin === "missed"),
	line("missed, and no earlier review failed that kind of fault", strict),
	line("new since the earlier review", (row) => NEW_SINCE.includes(of(row).bin)),
	line("raised before", (row) => of(row).bin === "raised_before"),
	line("not a problem", (row) => of(row).bin === "not_a_problem"),
	line("cannot tell", (row) => of(row).bin === "cannot_tell"),
]);
const notProblem = rows.filter((row) => of(row).bin === "not_a_problem");
const close = rows.filter((row) => of(row).otherBin !== undefined);
console.log(
	`\nnot a problem: ${JSON.stringify(tally(notProblem, (row) => of(row).sub ?? "?"))}. close calls: ${close.map((row) => `${of(row).bin} over ${of(row).otherBin}`).join("; ") || "none"}.`,
);

const missed = rows.filter((row) => of(row).bin === "missed");
const abouts = ["code", "tests", "docs", "pr_text"] as const;
const tolds = ["yes", "no", "unclear"] as const;
table(
	`3. The ${missed.length} missed: what it was about, and whether an earlier review's text names that file or part`,
	[
		"about",
		"cases",
		...tolds.map((t) => `earlier review read it: ${t}`),
		"same kind of fault failed elsewhere before",
	],
	[
		...abouts.map((about) => [about, missed.filter((row) => of(row).about === about)] as const),
		["all", missed] as const,
	].map(([about, set]) => [
		about,
		set.length,
		...tolds.map((t) => set.filter((row) => of(row).readBefore === t).length),
		set.filter((row) => of(row).sameFaultElsewhere === true).length,
	]),
);
console.log(
	`\nalready in the first commit that was reviewed: ${JSON.stringify(tally(missed, (row) => of(row).atFirstHead ?? "?"))}`,
);

// The draw holds fewer cases with a quote found in a file than the 181 do, and
// those are the cases that are most often `missed`. This weighs the two halves
// of the sample by their size among the 181.
const found = (row: Row) => row.facts.atEarlier > 0;
const foundInAll = saved.all?.aQuoteInAFileAtTheEarlierCommit ?? 0;
const halves = [
	{weight: foundInAll / saved.population, set: rows.filter(found)},
	{weight: 1 - foundInAll / saved.population, set: rows.filter((row) => !found(row))},
].filter((half) => half.set.length > 0);
const weighed = halves.reduce(
	(sum, half) =>
		sum +
		(half.weight * half.set.filter((row) => of(row).bin === "missed").length) / half.set.length,
	0,
);
const weighedError = Math.sqrt(
	halves.reduce((sum, half) => {
		const p = half.set.filter((row) => of(row).bin === "missed").length / half.set.length;
		return sum + (half.weight ** 2 * p * (1 - p)) / half.set.length;
	}, 0),
);
const weighedRange: [number, number] = [
	weighed - 1.96 * weighedError,
	weighed + 1.96 * weighedError,
];
console.log(
	`a quote found in a file at the earlier commit: ${how(found)} of the ${n} drawn, ${foundInAll} of the ${saved.population}. Weighed by that, missed is ${(100 * weighed).toFixed(0)}% of the ${saved.population} (${range(weighedRange)}), which is ${(100 * scale * weighed).toFixed(0)}% of the ${placed} placed (${range(weighedRange, scale)}).`,
);

const roundOf = (row: Row) =>
	row.round <= 1
		? "1, after a restart"
		: row.round === 2
			? "2"
			: row.round === 3
				? "3"
				: "4 and later";
table(
	"4. By round, by reviewer, and by what git found",
	["", "cases", "missed", "new since", "raised before", "not a problem"],
	[
		...["2", "3", "4 and later", "1, after a restart"].map(
			(r) => [`round ${r}`, (row: Row) => roundOf(row) === r] as const,
		),
		...[...new Set(rows.map((row) => row.namespace))]
			.sort()
			.map((ns) => [ns, (row: Row) => row.namespace === ns] as const),
		["a quote is in a file at the earlier commit", (row: Row) => row.facts.atEarlier > 0] as const,
		[
			"no quote is in a file at either commit",
			(row: Row) => row.facts.atEarlier === 0 && row.facts.atThis === 0,
		] as const,
	].map(([name, pick]) => {
		const set = rows.filter(pick);
		const k = (bins: readonly Bin[]) =>
			share(set.filter((row) => bins.includes(of(row).bin)).length, set.length);
		return [
			name,
			set.length,
			k(["missed"]),
			k(NEW_SINCE),
			k(["raised_before"]),
			k(["not_a_problem"]),
		];
	}),
);
if (saved.all !== undefined) {
	table(
		`5. What git says about all ${saved.population}, with no reading`,
		["", "findings", "share"],
		Object.entries(saved.all).map(([name, k]) => [
			name.replace(/([A-Z])/g, " $1").toLowerCase(),
			k,
			pct(k, saved.population),
		]),
	);
}

// Jev against the reading by hand.
const asked = rows.filter((row) => row.jev !== undefined);
const groupOf = (bin: string) => (NEW_SINCE.includes(bin as Bin) ? "new since" : bin);
const jevTop = (row: Row) =>
	Object.entries(row.jev ?? {}).sort((x, y) => y[1] - x[1])[0] ?? ["none", 0];
if (asked.length > 0) {
	const scored = (set: readonly Row[]) => {
		const same = set.filter((row) => jevTop(row)[0] === of(row).bin).length;
		const sameGroup = set.filter((row) => groupOf(jevTop(row)[0]) === groupOf(of(row).bin)).length;
		const mean =
			set.reduce((sum, row) => sum + (row.jev?.[of(row).bin] ?? 0), 0) / Math.max(set.length, 1);
		return [set.length, share(same, set.length), share(sameGroup, set.length), mean.toFixed(2)];
	};
	table(
		`6. Jev on the same ${asked.length} cases, against the reading by hand`,
		[
			"bin by hand",
			"cases",
			"Jev's first choice is the same bin",
			"the same group",
			"the share Jev gave the hand's bin",
		],
		[
			...BINS.filter((bin) => asked.some((row) => of(row).bin === bin)).map((bin) => [
				bin,
				...scored(asked.filter((row) => of(row).bin === bin)),
			]),
			["all", ...scored(asked)],
		],
	);
	const picked = tally(asked, (row) => jevTop(row)[0]);
	table(
		"7. What Jev chose",
		["bin", "by hand", "by Jev"],
		BINS.map((bin) => [bin, asked.filter((row) => of(row).bin === bin).length, picked[bin] ?? 0]),
	);
	const wrong = Object.entries(
		tally(
			asked.filter((row) => jevTop(row)[0] !== of(row).bin),
			(row) => `${of(row).bin} read as ${jevTop(row)[0]}`,
		),
	).sort((x, y) => y[1] - x[1]);
	console.log(`\nwhere they differ: ${wrong.map(([name, k]) => `${name} ${k}`).join("; ")}`);
	const asRaised = asked.filter(
		(row) => of(row).bin === "missed" && jevTop(row)[0] === "raised_before",
	);
	console.log(
		`missed read as raised_before: ${asRaised.length}, and in ${asRaised.filter((row) => of(row).sameFaultElsewhere === true).length} of them an earlier review had failed the same kind of fault in another place.`,
	);
	const sure = asked.filter((row) => jevTop(row)[1] >= SURE);
	console.log(
		`Jev gave its first choice ${SURE} or more on ${share(sure.length, asked.length)}, and on those the bin is the same in ${share(sure.filter((row) => jevTop(row)[0] === of(row).bin).length, sure.length)}.`,
	);
	const jevMissed = asked.filter((row) => jevTop(row)[0] === "missed").length;
	console.log(
		`Jev's own count of missed: ${share(jevMissed, asked.length)}, ${range(wilson(jevMissed, asked.length))}. By hand on the same cases: ${share(asked.filter((row) => of(row).bin === "missed").length, asked.length)}.`,
	);
	if (saved.jevCost !== undefined)
		console.log(
			`Jev: ${saved.jevCost.calls} calls, about ${saved.jevCost.tokens} tokens sent, about $${saved.jevCost.dollars.toFixed(4)}.`,
		);
}

const k = (bin: Bin) => how((row) => of(row).bin === bin);
const counts = Object.fromEntries(BINS.map((bin) => [bin, k(bin)]));
saved.sample = {seed: SEED, size: n, pullRequests: clumps.length};
saved.counts = counts;
saved.missed = {
	cases: missed.length,
	shareOfSample: missed.length / n,
	wilson: wilson(missed.length, n),
	redrawingPullRequests: byPull((row) => of(row).bin === "missed"),
	placedByExperiment54: placed,
	thereBeforeByExperiment54: thereBefore,
	shareOfPlaced: scale * (missed.length / n),
	shareOfPlacedWilson: wilson(missed.length, n).map((x) => x * scale),
	weighedByQuoteFound: {
		shareOfSample: weighed,
		range: weighedRange,
		shareOfPlaced: scale * weighed,
		shareOfPlacedRange: weighedRange.map((x) => x * scale),
	},
	noEarlierReviewFailedThatKindOfFault: how(strict),
	about: tally(missed, (row) => of(row).about ?? "?"),
	earlierReviewReadIt: tally(missed, (row) => of(row).readBefore ?? "?"),
	alreadyInTheFirstReviewedCommit: tally(missed, (row) => of(row).atFirstHead ?? "?"),
};
if (asked.length > 0) {
	saved.jevAgreement = {
		cases: asked.length,
		sameBin: asked.filter((row) => jevTop(row)[0] === of(row).bin).length,
		sameGroup: asked.filter((row) => groupOf(jevTop(row)[0]) === groupOf(of(row).bin)).length,
		jevMissed: asked.filter((row) => jevTop(row)[0] === "missed").length,
		sure: asked.filter((row) => jevTop(row)[1] >= SURE).length,
		sureSameBin: asked.filter((row) => jevTop(row)[1] >= SURE && jevTop(row)[0] === of(row).bin)
			.length,
	};
}
save();
