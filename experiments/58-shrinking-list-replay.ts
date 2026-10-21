// A review list can only shrink: the rule of `docs/direction/a-review-list-can-only-shrink.md`,
// replayed over the review rounds experiment 54 read. What would it have done
// to each loop, what would it have locked out, and what became of that?
//
// Run with
//   LANES=<a repo's .fabrika folder> CACHE=<a folder> node experiments/58-shrinking-list-replay.ts
//
//   STEP=fetch   ask GitHub how each pull request ended, and the diff between
//                any two rounds experiment 54 did not compare (`gh`, read-only)
//   STEP=trees   CLONE=<a clone of the repo>: look for every quoted line in the
//                files at three commits: the round before, the round, and the
//                end. Reads git objects only (`git ls-tree`, `git grep`,
//                `git cat-file`); it fetches nothing and writes nothing there
//   STEP=read    CLONE=<the clone>: write the texts of the findings read by
//                hand into CACHE (five samples, each fixed)
//   STEP=fixed   CLONE=<the clone>: ask the small classifier "does this change
//                fix it?" where a quoted line changed (needs TYPESAFE_API_KEY;
//                DRY=1 prints the estimate and stops, TRY=5 asks five,
//                SHOW=1 prints each answer beside what the next reviewer did)
//   (no STEP)    print the tables from CACHE and the saved readings: no key,
//                no network
//
// CACHE is experiment 54's cache folder (default `runs/exp-54-cache`). It holds
// raw answers from GitHub and is never committed. `58-readings.json` holds the
// hand readings, `results/shrinking-list-replay.json` the counts, one row per
// loop and one per later-round finding, and `results/shrinking-list-fixed.json`
// the classifier's shares. None holds comment text.
import {execFile, execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {Posted} from "@kampus/fabrika/pipeline/verdict";
import {
	type FailedReview,
	type Item,
	loadRounds,
	shuffled,
	type VerdictEvent,
} from "./lib/review-rounds.ts";
import {type Checks, fetchChecks, fetchCompare, readChecks, readCompare} from "./lib/threads.ts";

const DATA = process.env.LANES;
const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-54-cache");
const REPO = process.env.REPO ?? "kamp-us/phoenix";
const STEP = process.env.STEP ?? "tables";
if (DATA === undefined || DATA === "") {
	console.error("LANES is not set: point it at a repo's .fabrika folder");
	process.exit(1);
}

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
const section = (title: string) => console.log(`\n\n## ${title}`);
const tally = <T>(list: readonly T[], key: (x: T) => string) => {
	const out = new Map<string, number>();
	for (const x of list) out.set(key(x), (out.get(key(x)) ?? 0) + 1);
	return out;
};
/**
 * A fixed sample: the `n` keys with the smallest hash. Unlike a shuffle of the
 * list, it stays put when a finding joins or leaves the list it is drawn from.
 */
function picked<T>(list: readonly T[], n: number, key: (x: T) => string): T[] {
	const hash = (text: string) => {
		let h = 2166136261 ^ 58;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		return h >>> 0;
	};
	return [...list]
		.sort((a, b) => hash(key(a)) - hash(key(b)) || key(a).localeCompare(key(b)))
		.slice(0, n);
}
/** A 95% interval for a share, by Wilson's formula: plain enough for a small sample. */
function interval(hits: number, n: number): string {
	if (n === 0) return "";
	const z = 1.96;
	const p = hits / n;
	const mid = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
	const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
	return `${Math.round(100 * Math.max(0, mid - half))}% to ${Math.round(100 * Math.min(1, mid + half))}%`;
}

// ---------------------------------------------------------------- the loops

const R = loadRounds({lanes: DATA, cache: CACHE, here});
const reviewOf = new Map<VerdictEvent, FailedReview>(R.reviews.map((r) => [r.event, r]));

/** One review round a reviewer really ran: a `PASS` line, or a `FAIL` line with a failing verdict behind it. */
interface Round {
	/** 1, 2, 3 over the rounds that ran. A `FAIL` line no reviewer wrote is not a round. */
	readonly n: number;
	readonly event: VerdictEvent;
	readonly failed: FailedReview | null;
	/** The commit the round judged. */
	readonly head: string | null;
}
/** One task's review rounds: a pull request on a single lane, a child issue on an epic. */
interface Loop {
	/** `<lane>/<task>`. */
	readonly id: string;
	readonly kind: "single" | "epic";
	readonly rounds: readonly Round[];
}
const headOfPosted = (p: Posted | undefined): string | null =>
	p?.marker.head ?? p?.marker.range?.tip ?? null;
const full = (sha: string | null): sha is string => sha !== null && sha.length === 40;
const loops: Loop[] = [];
{
	const byTask = new Map<string, VerdictEvent[]>();
	for (const e of R.events) {
		if (e.from !== "review") continue;
		if (e.polarity === "FAIL" && !reviewOf.has(e)) continue;
		const id = `${e.lane}/${e.task}`;
		byTask.set(id, [...(byTask.get(id) ?? []), e]);
	}
	for (const [id, events] of byTask) {
		const rounds = events.map((event, i): Round => {
			const failed = reviewOf.get(event) ?? null;
			const posted = failed === null ? R.matchOf(event) : failed.failed;
			return {n: i + 1, event, failed, head: headOfPosted(posted[0])};
		});
		loops.push({id, kind: (events[0] as VerdictEvent).kind, rounds});
	}
}
const multi = loops.filter((l) => l.rounds.length >= 2);

/** The pull request a loop's work ended in: the last one its lane names that GitHub knows as one. */
function pullOf(loop: Loop): number | null {
	const named = (R.ends.get(loop.id)?.pulls ?? []).filter((n) => R.threadOf(n)?.kind !== "issue");
	return named.at(-1) ?? null;
}

// ---------------------------------------------------------------- how each pull request ended

interface PullEnd {
	readonly state: "MERGED" | "CLOSED" | "OPEN";
	readonly head: string;
	readonly mergedAt: string | null;
}
const endsFile = join(CACHE, "pull-ends.json");
const pullEnds: Record<string, PullEnd | null> = existsSync(endsFile)
	? (JSON.parse(readFileSync(endsFile, "utf8")) as Record<string, PullEnd | null>)
	: {};

function gh(args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 400)}`)),
		);
	});
}

if (STEP === "fetch") {
	const [owner, name] = REPO.split("/");
	const wanted = [...new Set(multi.flatMap((l) => R.ends.get(l.id)?.pulls ?? []))].filter(
		(n) => pullEnds[String(n)] === undefined,
	);
	let queries = 0;
	for (let i = 0; i < wanted.length; i += 40) {
		const slice = wanted.slice(i, i + 40);
		const body = slice
			.map(
				(n) =>
					`n${n}: issueOrPullRequest(number: ${n}) { __typename ... on PullRequest { state headRefOid mergedAt } }`,
			)
			.join("\n");
		const out = JSON.parse(
			await gh([
				"api",
				"graphql",
				"-f",
				`query={ repository(owner: "${owner}", name: "${name}") { ${body} } }`,
			]),
		) as {
			data: {
				repository: Record<
					string,
					{
						__typename: string;
						state?: PullEnd["state"];
						headRefOid?: string;
						mergedAt?: string | null;
					} | null
				>;
			};
		};
		queries += 1;
		for (const n of slice) {
			const raw = out.data.repository[`n${n}`];
			pullEnds[String(n)] =
				raw?.__typename === "PullRequest" && raw.state !== undefined && raw.headRefOid !== undefined
					? {state: raw.state, head: raw.headRefOid, mergedAt: raw.mergedAt ?? null}
					: null;
		}
	}
	writeFileSync(endsFile, JSON.stringify(pullEnds));
	// The diff between two rounds, where experiment 54 did not ask: it compared failed rounds only.
	let compares = 0;
	for (const loop of multi) {
		for (let i = 1; i < loop.rounds.length; i++) {
			const [a, b] = [loop.rounds[i - 1]?.head ?? null, loop.rounds[i]?.head ?? null];
			if (
				loop.rounds[i]?.failed !== null &&
				full(a) &&
				full(b) &&
				a !== b &&
				(await fetchCompare(REPO, a, b, CACHE))
			)
				compares += 1;
		}
	}
	// The check runs at the round after a failed one: experiment 54 asked only at failed commits.
	let checks = 0;
	for (const loop of multi) {
		for (const round of loop.rounds) {
			const next = loop.rounds[round.n]?.head ?? null;
			if (round.failed !== null && full(round.head) && (await fetchChecks(REPO, round.head, CACHE)))
				checks += 1;
			if (round.failed !== null && full(next) && (await fetchChecks(REPO, next, CACHE)))
				checks += 1;
		}
	}
	console.log(
		`pull requests asked about ${wanted.length} in ${queries} queries; diffs between rounds fetched ${compares}; check runs fetched for ${checks} commits`,
	);
	process.exit(0);
}

// ---------------------------------------------------------------- findings, and what they quote

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
/** Experiment 54's reading of a quote: markdown marks off, white space squeezed. */
const norm = (text: string) => squeeze(text.replace(/[*_>]/g, ""));
/** The same with code marks off too: how a quote is looked for in a file. */
const bare = (text: string) => squeeze(text.replace(/[*_>`]/g, ""));
/** The code or text a finding quotes, as experiment 54 cut it: backticked spans and quoted sentences, paths and bare names left out. */
function quotesOf(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/`([^`\n]{15,240})`/g))
		if (/\s/.test(norm(m[1] as string)) && norm(m[1] as string).length >= 15)
			out.add(m[1] as string);
	for (const m of text.matchAll(/"([^"\n]{25,240})"/g)) out.add(m[1] as string);
	return [...out];
}

/** One finding of a failed round, as the walk counts it. */
interface Finding {
	/** The item's key from experiment 54: `<comment id>.<posted, seconds>#<n>`. */
	readonly key: string;
	readonly loop: Loop;
	readonly round: Round;
	readonly item: Item;
	/** The quotes, as written. */
	readonly quotes: readonly string[];
	readonly kind: string;
	readonly family: string;
}
/**
 * The findings of a failed round. A failing verdict counts its blocking
 * points; where the splitter cut none, the verdict stands as one finding by
 * its reason. A verdict that says its own files are clean has none.
 */
/**
 * A later round's verdict also lists what the repair fixed: "… Fixed.",
 * "Finding 1: CLEARED". The splitter cuts those as points, and they are not
 * findings. Read narrowly: the point ends on the one-word sentence "Fixed."
 * (or "Repaired.", "Cleared.", "Resolved."), or its heading ends ": CLEARED".
 * All 13 it drops were checked by eye. Other notes still get through, and the
 * hand readings count them.
 */
const clearedNote = (text: string) =>
	/[.!?:)`*]\s+(?:Fixed|Repaired|Cleared|Resolved)\.\**\s*$/.test(text) ||
	(/:\s*CLEARED\b/.test(text) && !/PARTLY CLEARED/.test(text));
const clearedNotes: Item[] = [];
/** `asCut`: with the cleared notes left in, as the splitter cut them. Only the 60-finding reading uses it. */
function findingsOf(loop: Loop, round: Round, asCut = false): Finding[] {
	if (round.failed === null) return [];
	const items = R.itemsOf(round.failed);
	const out: Finding[] = [];
	for (const posted of round.failed.failed) {
		const mine = items.filter((i) => i.posted === posted);
		const cut = mine.filter(
			(i) => i.level === "finding" && i.blocking && R.labelOf(i).family !== "none",
		);
		const points = asCut ? cut : cut.filter((i) => !clearedNote(i.whole));
		if (!asCut) clearedNotes.push(...cut.filter((i) => clearedNote(i.whole)));
		const reason = mine.find((i) => i.level === "reason") as Item;
		const picked = points.length > 0 ? points : R.labelOf(reason).family === "none" ? [] : [reason];
		for (const item of picked) {
			const label = R.labelOf(item);
			// A verdict with no list is read from its most telling paragraph on, as experiment 54 labelled it.
			out.push({
				key: item.key,
				loop,
				round,
				item,
				quotes: quotesOf(item.whole),
				kind: label.kind,
				family: label.family,
			});
		}
	}
	return out;
}
const found = new Map<Round, Finding[]>();
for (const loop of multi)
	for (const round of loop.rounds) found.set(round, findingsOf(loop, round));
const findingsIn = (round: Round | undefined) =>
	round === undefined ? [] : (found.get(round) ?? []);
if (process.env.DETAIL === "cleared") {
	for (const i of clearedNotes)
		console.log(`${i.key}  ${i.whole.slice(0, 150)} … ${i.whole.slice(-70)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- a quote, looked for in the files at a commit

/** `<commit>|<quote, bare>` to the files that hold the quote there. */
const treesFile = join(CACHE, "trees-58.json");
const trees: Record<string, readonly string[]> = existsSync(treesFile)
	? (JSON.parse(readFileSync(treesFile, "utf8")) as Record<string, string[]>)
	: {};
const treeKey = (commit: string, quote: string) => `${commit}|${bare(quote)}`;
/** The files that hold a quote at a commit. `null`: never looked. */
const filesWith = (commit: string | null, quote: string): readonly string[] | null =>
	commit === null ? null : (trees[treeKey(commit, quote)] ?? null);

/** The commits a failed round's quotes are looked for at: the round before, the round, the round after, the end. */
function commitsOf(loop: Loop, round: Round): string[] {
	const pull = pullOf(loop);
	const end = pull === null ? null : (pullEnds[String(pull)]?.head ?? null);
	return [
		loop.rounds[round.n - 2]?.head ?? null,
		round.head,
		loop.rounds[round.n]?.head ?? null,
		end,
	].filter(full);
}

if (STEP === "trees") {
	const CLONE = process.env.CLONE;
	if (CLONE === undefined || CLONE === "") {
		console.error(
			"CLONE is not set: point it at a clone of the repo that holds the reviewed commits",
		);
		process.exit(1);
	}
	const git = (args: readonly string[], input?: string): Promise<Buffer> =>
		new Promise((resolve) => {
			const child = execFile(
				"git",
				["-C", CLONE, "--no-optional-locks", ...args],
				{
					maxBuffer: 512 * 1024 * 1024,
					encoding: "buffer",
					env: {...process.env, GIT_NO_LAZY_FETCH: "1"},
				},
				(_error, stdout) => resolve(stdout),
			);
			if (input !== undefined) child.stdin?.end(input);
		});
	const has = new Map<string, boolean>();
	const known = (commit: string) => {
		if (!has.has(commit)) {
			try {
				execFileSync("git", ["-C", CLONE, "cat-file", "-e", `${commit}^{commit}`], {
					stdio: "ignore",
					env: {...process.env, GIT_NO_LAZY_FETCH: "1"},
				});
				has.set(commit, true);
			} catch {
				has.set(commit, false);
			}
		}
		return has.get(commit) as boolean;
	};
	/**
	 * Up to three words of the quote, the longest first. A line wrap cannot
	 * break a word, so `git grep` narrows the files to those that hold all of
	 * them, and then each file is read whole.
	 */
	const anchorsOf = (quote: string) =>
		[...new Set([...quote.matchAll(/[A-Za-z0-9./:-]{4,}/g)].map((m) => m[0]))]
			.sort((a, b) => b.length - a.length)
			.slice(0, 3);
	const todo: {commit: string; quote: string}[] = [];
	const seen = new Set<string>();
	for (const loop of multi) {
		for (const round of loop.rounds) {
			for (const f of findingsIn(round)) {
				for (const commit of commitsOf(loop, round)) {
					for (const quote of f.quotes) {
						const key = treeKey(commit, quote);
						if (trees[key] !== undefined || seen.has(key) || !known(commit)) continue;
						seen.add(key);
						todo.push({commit, quote});
					}
				}
			}
		}
	}
	console.log(`quotes to look for: ${todo.length}`);
	let next = 0;
	let done = 0;
	let tooCommon = 0;
	await Promise.all(
		Array.from({length: 8}, async () => {
			while (next < todo.length) {
				const {commit, quote} = todo[next++] as {commit: string; quote: string};
				const anchors = anchorsOf(quote);
				const hits: string[] = [];
				if (anchors.length > 0) {
					const listed = (
						await git([
							"grep",
							"-l",
							"-I",
							"-F",
							"--all-match",
							...anchors.flatMap((a) => ["-e", a]),
							commit,
							"--",
						])
					)
						.toString("utf8")
						.split("\n")
						.filter((l) => l !== "")
						.map((l) => l.slice(commit.length + 1));
					// Words in more than 300 files are too common to read every file for.
					if (listed.length > 300) tooCommon += 1;
					const paths = listed.slice(0, 300);
					const want = bare(quote);
					const out = await git(
						["cat-file", "--batch"],
						paths.map((p) => `${commit}:${p}\n`).join(""),
					);
					let at = 0;
					for (const path of paths) {
						const eol = out.indexOf(10, at);
						if (eol === -1) break;
						const header = out.subarray(at, eol).toString("utf8");
						const size = Number(header.split(" ")[2]);
						if (Number.isNaN(size)) {
							at = eol + 1;
							continue;
						}
						if (bare(out.subarray(eol + 1, eol + 1 + size).toString("utf8")).includes(want))
							hits.push(path);
						at = eol + 1 + size + 1;
					}
				}
				trees[treeKey(commit, quote)] = hits;
				if (++done % 500 === 0) {
					writeFileSync(treesFile, JSON.stringify(trees));
					console.error(`looked for ${done} of ${todo.length}`);
				}
			}
		}),
	);
	writeFileSync(treesFile, JSON.stringify(trees));
	console.log(
		`looked for ${done}; words too common to read every file for: ${tooCommon}; commits not in the clone: ${[...has].filter(([, ok]) => !ok).length} of ${has.size}`,
	);
	process.exit(0);
}

// ---------------------------------------------------------------- where a later round's finding comes from

/**
 * Where a finding of round 2 or later stands under the rule.
 *
 *   raised before           an earlier round's verdict holds the quote      allowed
 *   a red check             CI or a guard is red: code's gate, not a reading allowed
 *   written by the repair   the quote is in lines written since the round before  allowed
 *   older text, not raised  the quote is in the files at the round before, and no earlier verdict holds it  locked out
 *   quotes no file line     the quote is in no file at either commit: a command, its output, the ticket  not placed
 *   nothing quoted          not placed
 */
type Place =
	| "raised before"
	| "a red check"
	| "written by the repair"
	| "older text, not raised"
	| "quotes no file line"
	| "nothing quoted";
const PLACES: readonly Place[] = [
	"raised before",
	"a red check",
	"written by the repair",
	"older text, not raised",
	"quotes no file line",
	"nothing quoted",
];
const ALLOWED: ReadonlySet<Place> = new Set<Place>([
	"raised before",
	"a red check",
	"written by the repair",
]);

/** Everything the reviewer posted in a round, as one text. */
const saidCache = new Map<Round, string>();
function saidIn(round: Round): string {
	const hit = saidCache.get(round);
	if (hit !== undefined) return hit;
	const posted =
		round.failed === null
			? R.matchOf(round.event)
			: [...round.failed.failed, ...round.failed.passed];
	const text = norm(posted.map((p) => p.body).join(" "));
	saidCache.set(round, text);
	return text;
}
/** The lines written between the round before and this one. `null`: no diff to read. */
function addedBefore(loop: Loop, round: Round): string | null {
	const [a, b] = [loop.rounds[round.n - 2]?.head ?? null, round.head];
	if (a !== null && a === b) return "";
	const compare = full(a) && full(b) ? readCompare(CACHE, a, b) : null;
	return compare === null || compare.missing
		? null
		: norm(compare.files.flatMap((f) => f.added).join(" "));
}
const placeCache = new Map<Finding, Place>();
function placeOf(f: Finding): Place {
	const hit = placeCache.get(f);
	if (hit !== undefined) return hit;
	const place = ((): Place => {
		if (f.kind === "check_red") return "a red check";
		if (f.quotes.length === 0) return "nothing quoted";
		const earlier = f.loop.rounds.slice(0, f.round.n - 1);
		if (f.quotes.some((q) => earlier.some((r) => saidIn(r).includes(norm(q)))))
			return "raised before";
		const added = addedBefore(f.loop, f.round);
		if (added !== null && f.quotes.some((q) => added.includes(norm(q))))
			return "written by the repair";
		const before = f.loop.rounds[f.round.n - 2]?.head ?? null;
		const inFiles = f.quotes.map((q) => ({
			before: filesWith(before, q) ?? [],
			now: filesWith(f.round.head, q) ?? [],
		}));
		// In a file now and not in that file one round ago: the repair wrote it, whatever the diff shows.
		if (inFiles.some((q) => q.now.some((path) => !q.before.includes(path))))
			return "written by the repair";
		if (inFiles.some((q) => q.before.length > 0)) return "older text, not raised";
		return "quotes no file line";
	})();
	placeCache.set(f, place);
	return place;
}

/** The findings of every round 2 and later that failed. */
const later = multi.flatMap((loop) => loop.rounds.slice(1).flatMap((round) => findingsIn(round)));

// ---------------------------------------------------------------- the walk

type End =
	| "as recorded"
	| "passes early"
	| "stops: the list is not shorter"
	| "goes on with a shorter list";
interface Lap {
	readonly round: number;
	readonly verdict: "PASS" | "FAIL";
	/** Findings the reviewer wrote this round. */
	readonly found: number;
	readonly allowed: number;
	readonly locked: number;
	/** The open list after this round, under the rule. */
	readonly list: number;
	/** Where each allowed finding of a later failed round stands. */
	readonly places: readonly Place[];
}
interface Walked {
	readonly loop: Loop;
	readonly laps: readonly Lap[];
	readonly end: End;
	/** The round where the rule and the record part ways. */
	readonly at: number | null;
	/** Recorded rounds after that one. */
	readonly after: number;
	/** A finding was locked out somewhere on the way. */
	readonly dropped: boolean;
	/** The round the rule parted on came after a `PASS`: a lap the list does not cover. */
	readonly afterPass: boolean;
}
/**
 * One loop under the rule. A finding that cannot be placed is counted as
 * allowed in the `lenient` walk and as locked out in the `strict` one: the
 * truth lies between the two.
 */
function walkLoop(
	loop: Loop,
	mode: "lenient" | "strict",
	stop: "not shorter" | "the same finding" | "not shorter twice" = "not shorter",
): Walked {
	const laps: Lap[] = [];
	const lockedOut = new Set<Finding>();
	let list: number | null = null;
	let dropped = false;
	let flat = 0;
	for (const round of loop.rounds) {
		const all = findingsIn(round);
		if (round.failed === null) {
			laps.push({
				round: round.n,
				verdict: "PASS",
				found: 0,
				allowed: 0,
				locked: 0,
				list: 0,
				places: [],
			});
			list = 0;
			continue;
		}
		if (list === null) {
			list = Math.max(1, all.length);
			laps.push({
				round: round.n,
				verdict: "FAIL",
				found: list,
				allowed: list,
				locked: 0,
				list,
				places: [],
			});
			continue;
		}
		const earlier = loop.rounds.slice(0, round.n - 1).flatMap((r) => findingsIn(r));
		let allowed = 0;
		const places: Place[] = [];
		for (const f of all) {
			const place = placeOf(f);
			// Raised before, but only as a finding the rule had locked out: it never entered the list.
			const raisedAs =
				place !== "raised before"
					? []
					: earlier.filter((g) =>
							f.quotes.some((q) =>
								norm(g.item.level === "reason" ? g.item.posted.body : g.item.whole).includes(
									norm(q),
								),
							),
						);
			const neverListed = raisedAs.length > 0 && raisedAs.every((g) => lockedOut.has(g));
			const ok = neverListed
				? false
				: ALLOWED.has(place)
					? true
					: place === "older text, not raised"
						? false
						: mode === "lenient";
			if (ok) {
				allowed += 1;
				places.push(place);
			} else lockedOut.add(f);
		}
		// A failed round with no finding of its own (every verdict says its files are clean) still failed: one finding, not placed.
		if (all.length === 0 && mode === "lenient") allowed = 1;
		const foundNow = Math.max(1, all.length);
		const locked = foundNow - allowed;
		const afterPass = loop.rounds[round.n - 2]?.failed === null;
		const lap: Lap = {
			round: round.n,
			verdict: "FAIL",
			found: foundNow,
			allowed,
			locked,
			list: allowed,
			places,
		};
		laps.push(lap);
		const rest = loop.rounds.length - round.n;
		if (allowed === 0)
			return {loop, laps, end: "passes early", at: round.n, after: rest, dropped: true, afterPass};
		// The other reading of the rule: a lap is wasted only when a finding already on the list comes back.
		// A third reading: one flat lap is let through, the second one stops.
		if (!afterPass && allowed >= list) flat += 1;
		const stops =
			stop === "not shorter"
				? allowed >= list
				: stop === "the same finding"
					? places.includes("raised before")
					: flat >= 2;
		if (!afterPass && stops)
			return {
				loop,
				laps,
				end: "stops: the list is not shorter",
				at: round.n,
				after: rest,
				dropped: dropped || locked > 0,
				afterPass,
			};
		if (locked > 0) dropped = true;
		list = allowed;
	}
	return {
		loop,
		laps,
		end: dropped ? "goes on with a shorter list" : "as recorded",
		at: null,
		after: 0,
		dropped,
		afterPass: false,
	};
}

// ---------------------------------------------------------------- what became of a locked-out finding

type Fate =
	| "changed before the merge"
	| "left as it was, and merged"
	| "the pull request was closed"
	| "the pull request is still open"
	| "no end to read";
const FATES: readonly Fate[] = [
	"changed before the merge",
	"left as it was, and merged",
	"the pull request was closed",
	"the pull request is still open",
	"no end to read",
];
/** The files a finding's quotes sit in at its round, or one round earlier when the repair had already moved them. */
function homesOf(f: Finding): {quote: string; files: readonly string[]}[] {
	const before = f.loop.rounds[f.round.n - 2]?.head ?? null;
	return f.quotes
		.map((quote) => ({
			quote,
			files:
				(filesWith(f.round.head, quote) ?? []).length > 0
					? (filesWith(f.round.head, quote) as readonly string[])
					: (filesWith(before, quote) ?? []),
		}))
		.filter((h) => h.files.length > 0);
}
/** `every`: each quoted line is gone from its file at the end, not only one of them. */
function fateOf(f: Finding): {fate: Fate; every: boolean} {
	const pull = pullOf(f.loop);
	const end = pull === null ? null : (pullEnds[String(pull)] ?? null);
	if (end === null) return {fate: "no end to read", every: false};
	if (end.state === "CLOSED") return {fate: "the pull request was closed", every: false};
	if (end.state === "OPEN") return {fate: "the pull request is still open", every: false};
	const homes = homesOf(f);
	const gone = homes.map((h) => {
		const atEnd = filesWith(end.head, h.quote);
		return atEnd === null ? null : h.files.some((path) => !atEnd.includes(path));
	});
	if (homes.length === 0 || gone.some((g) => g === null))
		return {fate: "no end to read", every: false};
	return gone.some((g) => g === true)
		? {fate: "changed before the merge", every: gone.every((g) => g === true)}
		: {fate: "left as it was, and merged", every: false};
}
const lockedOut = later.filter((f) => placeOf(f) === "older text, not raised");
/** The 30 read by hand: a fixed sample of the locked-out findings whose quoted text changed before the merge. */
const actedOn = lockedOut.filter((f) => fateOf(f).fate === "changed before the merge");
const readSample = [
	...picked(actedOn, 30, (f) => f.key),
	...picked(
		lockedOut.filter((f) => !actedOn.includes(f)),
		Math.max(0, 30 - actedOn.length),
		(f) => f.key,
	),
];
/** What the reviewer did one round after a finding: the other way to ask whether it was dealt with. */
function nextOf(
	f: Finding,
):
	| "no round followed"
	| "the next round passed"
	| "raised again"
	| "the next round failed on something else" {
	const next = f.loop.rounds[f.round.n];
	if (next === undefined) return "no round followed";
	if (next.failed === null) return "the next round passed";
	return f.quotes.some((q) => saidIn(next).includes(norm(q)))
		? "raised again"
		: "the next round failed on something else";
}

/** Hand readings: `<finding key>` to `real`, `wording` or `unclear`, and for section C `<finding key>` to a check's name or `reader`. */
interface Readings {
	readonly lockedOut: Readonly<Record<string, string>>;
	readonly recheck: Readonly<Record<string, string>>;
	readonly disagreements: Readonly<Record<string, string>>;
	readonly unplaced: Readonly<Record<string, string>>;
	readonly raisedBefore: Readonly<Record<string, string>>;
}
const readingsFile = join(here, "58-readings.json");
const readings: Readings = {
	lockedOut: {},
	recheck: {},
	disagreements: {},
	unplaced: {},
	raisedBefore: {},
	...(existsSync(readingsFile)
		? (JSON.parse(readFileSync(readingsFile, "utf8")) as Partial<Readings>)
		: {}),
};

/** "Raised before" only means an earlier verdict holds the same quote. 20 are read by hand to see what that is worth, a fixed sample. */
const raisedBefore = later.filter((f) => placeOf(f) === "raised before");
const raisedSample = picked(raisedBefore, 20, (f) => f.key);

/** The later-round findings no quote can place: 30 of them are placed by hand, a fixed sample. */
const unplaced = later.filter(
	(f) => placeOf(f) === "quotes no file line" || placeOf(f) === "nothing quoted",
);
const unplacedSample = picked(unplaced, 30, (f) => f.key);

/** Every finding of every failed review in the set, as the walk counts them: section C's ground. */
const everyFinding: Finding[] = (() => {
	const out: Finding[] = [];
	for (const loop of loops)
		for (const round of loop.rounds) out.push(...(found.get(round) ?? findingsOf(loop, round)));
	return out;
})();
/** The 60 read by hand were drawn before the cleared notes were dropped, so they are drawn from the points as cut. */
const everyCut: Finding[] = loops.flatMap((loop) =>
	loop.rounds.flatMap((round) => findingsOf(loop, round, true)),
);
const recheckSample = shuffled(everyCut, 58).slice(0, 60);

// ---------------------------------------------------------------- one round later: the quoted line, and what the next reviewer did

const textKind = (f: Finding) =>
	f.kind === "stale_text"
		? "stale text"
		: f.kind === "wrong_text"
			? "wrong text"
			: f.family === "text"
				? "text, kind unsure"
				: f.family === "code"
					? "code"
					: "other";
/** The findings of a failed round that another round followed. */
const followed = multi.flatMap((l) =>
	l.rounds
		.filter((r) => r.failed !== null && l.rounds[r.n] !== undefined)
		.flatMap((r) => findingsIn(r)),
);
/** Those whose quote sits in a file at the round's commit: the check can run. */
const tried = followed.flatMap((f) => {
	const next = f.loop.rounds[f.round.n] as Round;
	const homes = f.quotes
		.map((quote) => ({quote, files: filesWith(f.round.head, quote) ?? []}))
		.filter((h) => h.files.length > 0);
	if (homes.length === 0) return [];
	const after = homes.map((h) => filesWith(next.head, h.quote));
	if (after.some((a) => a === null)) return [];
	/** The files a quote was in at the round and is no longer in one round later. */
	const gone = [
		...new Set(
			homes.flatMap((h, i) =>
				h.files.filter((path) => !(after[i] as readonly string[]).includes(path)),
			),
		),
	];
	const changed = gone.length > 0;
	const again =
		next.failed !== null &&
		findingsIn(next).some((g) =>
			homes.some((h) =>
				norm(g.item.level === "reason" ? g.item.posted.body : g.item.whole).includes(norm(h.quote)),
			),
		);
	return [
		{
			f,
			next,
			homes,
			gone,
			code: changed ? "changed" : "still there",
			reviewer:
				next.failed === null ? "passed" : again ? "raised it again" : "failed on something else",
		},
	];
});

/** The quoted line stayed and the next reviewer did not raise it again: 24 of them are read by hand, a fixed sample. */
const stayed = tried.filter((t) => t.code === "still there" && t.reviewer !== "raised it again");
const staySample = picked(stayed, 24, (t) => t.f.key);

/** The change to one file between two commits, read from the clone. */
function diffOf(a: string, b: string, path: string, context = 1): string {
	const CLONE = process.env.CLONE;
	if (CLONE === undefined) return "";
	try {
		return execFileSync(
			"git",
			["-C", CLONE, "--no-optional-locks", "diff", `-U${context}`, a, b, "--", path],
			{
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				env: {...process.env, GIT_NO_LAZY_FETCH: "1"},
			},
		);
	} catch {
		return "";
	}
}
/** The hunks of that change that touch one of the quotes. */
const hunksOf = (a: string, b: string, path: string, quotes: readonly string[], context = 1) =>
	diffOf(a, b, path, context)
		.split(/\n(?=@@)/)
		.filter((hunk) => quotes.some((q) => bare(hunk).includes(bare(q).slice(0, 24))));

// ---------------------------------------------------------------- "is this one fixed?", asked of the small classifier

/**
 * The narrow question of a later round, asked where code cannot answer it: the
 * quoted line changed. The classifier reads the finding and the change to that
 * file, and nothing else. What the next round's reviewer did is the answer it
 * is held against.
 */
const fixedFile = join(here, "results", "shrinking-list-fixed.json");
const fixedAnswers: Record<string, Record<string, number>> = existsSync(fixedFile)
	? (
			JSON.parse(readFileSync(fixedFile, "utf8")) as {
				answers: Record<string, Record<string, number>>;
			}
		).answers
	: {};
const fixedQuestion = {
	type: "choice",
	instructions:
		"`finding` is one point from a code reviewer's failed verdict on a pull request. `quoted` is the line of the file the finding points at. `change` is what the author then changed in that file, as a diff. Choose whether the change fixes what the finding asks for.",
	criteria: {
		fixed:
			"The change does what the finding asks: the wrong or stale line is corrected, the missing part is added, or the code now behaves as the finding says it should.",
		not_fixed:
			"The change does not do what the finding asks: the line was only moved or reworded and still says the wrong thing, the fix is partial, or the change is about something else.",
		cannot_tell:
			"The diff is not enough to say: the fix depends on other files, on running the code, or on something the finding does not spell out.",
	},
};
const FLOOR = 0.8;

if (STEP === "fixed") {
	const wanted = tried.filter((t) => t.code === "changed" && fixedAnswers[t.f.key] === undefined);
	const todo =
		process.env.TRY === undefined ? wanted : shuffled(wanted, 58).slice(0, Number(process.env.TRY));
	const cases = todo.flatMap((t) => {
		// Only the files the quote left, and only the hunks that held it. A deleted file has no hunk to show.
		const parts = t.gone
			.slice(0, 2)
			.map((path) => ({
				path,
				hunks: hunksOf(
					t.f.round.head as string,
					t.next.head as string,
					path,
					t.homes.map((h) => h.quote),
					3,
				)
					.join("\n")
					.slice(0, 3000),
			}))
			.filter((p) => p.hunks !== "");
		if (parts.length === 0) return [];
		return [
			{
				t,
				state: {
					finding: (t.f.item.level === "reason" ? t.f.item.posted.body : t.f.item.whole).slice(
						0,
						2400,
					),
					quoted: t.homes.map((h) => h.quote.slice(0, 240)).slice(0, 3),
					change: parts.map((p) => `--- ${p.path}\n${p.hunks}`).join("\n"),
				},
			},
		];
	});
	const tokens = cases.reduce(
		(n, c) => n + (JSON.stringify(c.state).length + JSON.stringify(fixedQuestion).length) / 4,
		0,
	);
	console.log(
		`findings whose quoted line changed ${tried.filter((t) => t.code === "changed").length}; to ask ${cases.length} of ${wanted.length} waiting; about ${Math.round(tokens / 1000)}k tokens, about $${((tokens * 0.042) / 1e6).toFixed(3)} at $0.042 a million`,
	);
	if (process.env.DRY === "1" || cases.length === 0) process.exit(0);
	// The spend limit, checked against the estimate before the first call.
	const limit = Number(process.env.MAX_DOLLARS ?? "2");
	if ((tokens * 0.042) / 1e6 > limit) {
		console.error(`the estimate is over the limit of $${limit}: nothing asked`);
		process.exit(1);
	}
	const {askAll, pool} = await import("./lib/jev.ts");
	await pool(cases, 8, async (c) => {
		const answer = (await askAll({fixed: fixedQuestion}, c.state)).fixed as
			| {probabilities: Record<string, number>}
			| undefined;
		if (answer === undefined) throw new Error(`no answer for ${c.t.f.key}`);
		fixedAnswers[c.t.f.key] = Object.fromEntries(
			Object.entries(answer.probabilities).map(([k, p]) => [k, +p.toFixed(2)]),
		);
		if (process.env.SHOW === "1")
			console.log(
				`\n${c.t.f.key} ${c.t.f.item.posted.url}\n  the next reviewer: ${c.t.reviewer}\n  the classifier: ${JSON.stringify(fixedAnswers[c.t.f.key])}\n  ${c.state.finding.slice(0, 300).replace(/\n/g, " ")}\n  ${c.state.change.slice(0, 600).replace(/\n/g, "\n  ")}`,
			);
	});
	writeFileSync(
		fixedFile,
		`${JSON.stringify({
			note: "Experiment 58. The share the small classifier gave each choice when asked whether a change fixes a finding (the quoted line had changed one round later). Keys are experiment 54's item keys. No comment text.",
			floor: FLOOR,
			tokens: Math.round(
				tokens +
					((
						JSON.parse(existsSync(fixedFile) ? readFileSync(fixedFile, "utf8") : "{}") as {
							tokens?: number;
						}
					).tokens ?? 0),
			),
			answers: Object.fromEntries(
				Object.entries(fixedAnswers).sort(([a], [b]) => a.localeCompare(b)),
			),
		})}\n`.replace(/"(\d+\.\d+#\d+)":/g, '\n"$1":'),
	);
	process.exit(0);
}

if (STEP === "read") {
	const head = (f: Finding) =>
		`## ${f.key}  ${f.item.posted.url}\nloop ${f.loop.id}  rounds ${f.loop.rounds.map((r) => (r.failed === null ? "P" : "F")).join("")}  this is round ${f.round.n}  kind ${f.kind}/${f.family}  namespace ${f.item.posted.marker.namespace}\nreason: ${f.item.posted.marker.clause}`;
	const lockedView = readSample.map((f) => {
		const end = pullEnds[String(pullOf(f.loop))]?.head ?? "";
		const homes = homesOf(f);
		const diffs = [...new Set(homes.flatMap((h) => h.files))].slice(0, 3).map((path) => {
			const hunks = hunksOf(
				f.round.head as string,
				end,
				path,
				homes.filter((h) => h.files.includes(path)).map((h) => h.quote),
			);
			return `--- ${path}\n${hunks.join("\n").slice(0, 1800)}`;
		});
		return `${head(f)}\nin the record: ${fateOf(f).fate}; ${nextOf(f)}\nread so far: ${readings.lockedOut[f.key] ?? "-"}\n\n${f.item.level === "reason" ? f.item.posted.body.slice(0, 3500) : f.item.whole.slice(0, 3500)}\n\nquotes in files: ${homes.map((h) => `\`${h.quote.slice(0, 120)}\` in ${h.files.slice(0, 3).join(", ")}`).join("\n  ")}\n\nwhat changed there by the end:\n${diffs.join("\n")}`;
	});
	writeFileSync(
		join(CACHE, "read-58-locked-out.md"),
		lockedView.join("\n\n=================================================================\n\n"),
	);
	const recheckView = recheckSample.map(
		(f) =>
			`${head(f)}\nread so far: ${readings.recheck[f.key] ?? "-"}\n\n${(f.item.level === "reason" ? f.item.posted.body : f.item.whole).slice(0, 1600)}`,
	);
	writeFileSync(
		join(CACHE, "read-58-recheck.md"),
		recheckView.join("\n\n=================================================================\n\n"),
	);
	const stayedView = staySample.map(
		(t) =>
			`${head(t.f)}\nthe next round: ${t.reviewer}${t.next.failed === null ? "" : ` (${t.next.failed.failed.map((p) => p.marker.clause).join("; ")})`}\nread so far: ${readings.disagreements[t.f.key] ?? "-"}\n\n${(t.f.item.level === "reason" ? t.f.item.posted.body : t.f.item.whole).slice(0, 1800)}\n\nquotes still in their files one round later: ${t.homes.map((h) => `\`${h.quote.slice(0, 160)}\` in ${h.files.slice(0, 2).join(", ")}`).join("\n  ")}`,
	);
	writeFileSync(
		join(CACHE, "read-58-still-there.md"),
		stayedView.join("\n\n=================================================================\n\n"),
	);
	const unplacedView = unplacedSample.map((f) => {
		const before = f.loop.rounds[f.round.n - 2] as Round;
		const compare =
			full(before.head) && full(f.round.head)
				? readCompare(CACHE, before.head, f.round.head)
				: null;
		const earlier = f.loop.rounds
			.slice(0, f.round.n - 1)
			.flatMap((r) =>
				r.failed === null
					? [`round ${r.n}: PASS`]
					: findingsIn(r).map(
							(g) =>
								`round ${r.n}: ${(g.item.level === "reason" ? g.item.posted.marker.clause : g.item.whole).slice(0, 170)}`,
						),
			);
		return `${head(f)}\nplace: ${placeOf(f)}\nread so far: ${readings.unplaced[f.key] ?? "-"}\n\n${(f.item.level === "reason" ? f.item.posted.body : f.item.whole).slice(0, 1300)}\n\nearlier rounds (${earlier.length} points, the last 14 shown):\n  ${earlier.slice(-14).join("\n  ")}\n\nfiles the repair touched: ${
			before.head === f.round.head
				? "none: the same commit"
				: compare === null || compare.missing
					? "no diff to read"
					: compare.files
							.map((x) => x.path)
							.slice(0, 14)
							.join(", ")
		}`;
	});
	writeFileSync(
		join(CACHE, "read-58-unplaced.md"),
		unplacedView.join("\n\n=================================================================\n\n"),
	);
	// Each "raised before" finding beside the earlier text that holds its quote.
	const raisedView = raisedSample.map((f) => {
		const shared = f.quotes.flatMap((q) => {
			const hit = f.loop.rounds.slice(0, f.round.n - 1).find((r) => saidIn(r).includes(norm(q)));
			if (hit === undefined) return [];
			const text = saidIn(hit);
			const at = text.indexOf(norm(q));
			return [
				`\`${q.slice(0, 160)}\`\n    round ${hit.n} (${hit.failed === null ? "PASS" : "FAIL"}): …${text.slice(Math.max(0, at - 500), at + 400)}…`,
			];
		});
		return `${head(f)}\nread so far: ${readings.raisedBefore[f.key] ?? "-"}\n\n${(f.item.level === "reason" ? f.item.posted.body : f.item.whole).slice(0, 1200)}\n\nthe quotes an earlier round holds:\n  ${shared.slice(0, 2).join("\n  ")}`;
	});
	writeFileSync(
		join(CACHE, "read-58-raised-before.md"),
		raisedView.join("\n\n=================================================================\n\n"),
	);
	console.log(
		`locked-out findings whose quoted text changed before the merge: ${actedOn.length}; wrote ${readSample.length} to read-58-locked-out.md, ${recheckSample.length} to read-58-recheck.md and ${staySample.length} to read-58-still-there.md in the cache folder`,
	);
	process.exit(0);
}

// ---------------------------------------------------------------- tables

const results: Record<string, unknown> = {};
const laterFails = multi.flatMap((l) =>
	l.rounds
		.slice(1)
		.filter((r) => r.failed !== null)
		.map((round) => ({loop: l, round})),
);
const laterPasses = multi.flatMap((l) => l.rounds.slice(1).filter((r) => r.failed === null));
const withLaterFail = multi.filter((l) => l.rounds.slice(1).some((r) => r.failed !== null));
const pullState = (loop: Loop): string => {
	const pull = pullOf(loop);
	return pull === null ? "no pull request named" : (pullEnds[String(pull)]?.state ?? "not asked");
};
const linkOf = (f: Finding) =>
	`[#${/\/(\d+)#/.exec(f.item.posted.url)?.[1]}](${f.item.posted.url})`;

// What a round costs, from this repo's own field rows: runs of the same reviewer and builder on another repo.
const fieldRows = readFileSync(join(here, "..", "field", "runs.jsonl"), "utf8")
	.split("\n")
	.filter((l) => l.trim() !== "")
	.map((l) => JSON.parse(l) as {role: string; costUsd?: number});
const dollarsOf = (role: string) =>
	fieldRows
		.filter((r) => r.role === role && typeof r.costUsd === "number")
		.map((r) => r.costUsd as number);
const mean = (xs: readonly number[]) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const REVIEW_USD = mean(dollarsOf("reviewer"));
const BUILD_USD = mean(dollarsOf("builder"));

// A0. The loops.
{
	section("A0. The loops");
	const shapes = tally(multi, (l) => l.rounds.map((r) => (r.failed === null ? "P" : "F")).join(""));
	console.log(
		`tasks with a review round ${loops.length}; with two or more ${multi.length} (single lanes ${multi.filter((l) => l.kind === "single").length}, epic children ${multi.filter((l) => l.kind === "epic").length}); with a failed round after the first ${withLaterFail.length}`,
	);
	console.log(
		`rounds after the first: ${laterFails.length + laterPasses.length} (${laterPasses.length} PASS, ${laterFails.length} FAIL); FAIL lines no reviewer wrote, left out: ${R.lost.filter((l) => l.event.from === "review").length}`,
	);
	console.log(
		`shapes: ${[...shapes]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 14)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}, and ${Math.max(0, shapes.size - 14)} more`,
	);
	const ended = tally(multi, pullState);
	console.log(`how the pull request ended: ${[...ended].map(([k, v]) => `${k} ${v}`).join(", ")}`);
	console.log(
		`a reviewer run costs $${REVIEW_USD.toFixed(2)} on average over ${dollarsOf("reviewer").length} runs, a builder run $${BUILD_USD.toFixed(2)} over ${dollarsOf("builder").length} (field/runs.jsonl: this repo's machine on another repo)`,
	);
	results.loops = {
		tasks: loops.length,
		twoOrMoreRounds: multi.length,
		withALaterFail: withLaterFail.length,
		laterRounds: {pass: laterPasses.length, fail: laterFails.length},
		shapes: Object.fromEntries(shapes),
		pullRequestEnded: Object.fromEntries(ended),
		dollars: {
			review: +REVIEW_USD.toFixed(2),
			build: +BUILD_USD.toFixed(2),
			from: "field/runs.jsonl",
		},
	};
}

// A1. Where a later round's findings come from.
{
	section("A1. Findings of round 2 and later, placed");
	const roundsWith = (p: Place) =>
		new Set(later.filter((f) => placeOf(f) === p).map((f) => f.round)).size;
	table(
		`${later.length} findings in ${laterFails.length} failed rounds after the first`,
		["Where the finding stands", "Under the rule", "Findings", "Share", "Failed rounds with one"],
		PLACES.map((p) => [
			p,
			ALLOWED.has(p) ? "allowed" : p === "older text, not raised" ? "locked out" : "not placed",
			later.filter((f) => placeOf(f) === p).length,
			pct(later.filter((f) => placeOf(f) === p).length, later.length),
			roundsWith(p),
		]),
	);
	const placed = later.filter(
		(f) => ALLOWED.has(placeOf(f)) || placeOf(f) === "older text, not raised",
	);
	console.log(
		`\nof the ${placed.length} placed: allowed ${share(placed.filter((f) => ALLOWED.has(placeOf(f))).length, placed.length)}, locked out ${share(placed.filter((f) => !ALLOWED.has(placeOf(f))).length, placed.length)}`,
	);
	const byLevel = tally(later, (f) => f.item.level);
	console.log(
		`findings cut by the splitter ${byLevel.get("finding") ?? 0}; failing verdicts with no list, counted as one finding ${byLevel.get("reason") ?? 0}; failed rounds with no finding of their own ${laterFails.filter((x) => findingsIn(x.round).length === 0).length}`,
	);
	console.log(
		`points left out because they only say an earlier finding is fixed ("… Fixed.", ": CLEARED"): ${new Set(clearedNotes.map((i) => i.key)).size}`,
	);
	const quoted = later.filter((f) => f.quotes.length > 0);
	const inFiles = quoted.filter((f) =>
		f.quotes.some(
			(q) =>
				(filesWith(f.round.head, q) ?? []).length > 0 ||
				(filesWith(f.loop.rounds[f.round.n - 2]?.head ?? null, q) ?? []).length > 0,
		),
	);
	console.log(
		`findings that quote something ${quoted.length}; a quote is in a file at the round's commit or the one before ${share(inFiles.length, quoted.length)}`,
	);
	for (const p of PLACES)
		console.log(
			`  kinds, ${p}: ${[
				...tally(
					later.filter((f) => placeOf(f) === p),
					(f) => f.family,
				),
			]
				.sort((a, b) => b[1] - a[1])
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`,
		);
	for (const p of PLACES)
		console.log(
			`  examples, ${p}: ${shuffled(
				later.filter((f) => placeOf(f) === p),
				58,
			)
				.slice(0, 4)
				.map(linkOf)
				.join(" ")}`,
		);
	// The half no quote can place, placed by hand on a sample.
	const HAND: Record<string, string> = {
		before: "raised in an earlier round",
		repair: "about what the repair wrote or did",
		old: "about older text or code nobody had raised",
		none: "not a finding: a note, a cleared point, a pointer to another verdict",
		unclear: "cannot tell",
		"not read": "not read",
	};
	const hand = unplacedSample.map(
		(f) => (readings.unplaced[f.key] ?? "not read").split(":")[0] as string,
	);
	table(
		`${unplacedSample.length} of the ${unplaced.length} findings no quote can place, placed by hand (a fixed sample)`,
		["By hand", "Under the rule", "Findings", "Share", "95% interval"],
		Object.keys(HAND)
			.filter((k) => k !== "not read" || hand.includes(k))
			.map((k) => [
				HAND[k] as string,
				k === "before" || k === "repair" ? "allowed" : k === "old" ? "locked out" : "",
				hand.filter((h) => h === k).length,
				pct(hand.filter((h) => h === k).length, unplacedSample.length),
				interval(hand.filter((h) => h === k).length, unplacedSample.length),
			]),
	);
	results.unplacedReadByHand = {
		n: unplacedSample.length,
		of: unplaced.length,
		...Object.fromEntries(tally(hand, (h) => h)),
	};
	// "Raised before" only means an earlier verdict holds the same quote. Is it the same finding?
	const SAME: Record<string, string> = {
		same: "the same finding, still open",
		repair: "a new finding about what the repair wrote",
		old: "a new finding about older text nobody had raised",
		none: "not a finding: a note, a cleared point, praise",
		unclear: "cannot tell",
		"not read": "not read",
	};
	const again = raisedSample.map(
		(f) => (readings.raisedBefore[f.key] ?? "not read").split(":")[0] as string,
	);
	table(
		`${raisedSample.length} of the ${raisedBefore.length} findings placed "raised before", read by hand (a fixed sample)`,
		["By hand", "Under the rule", "Findings", "Share", "95% interval"],
		Object.keys(SAME)
			.filter((k) => k !== "not read" || again.includes(k))
			.map((k) => [
				SAME[k] as string,
				k === "same" || k === "repair" ? "allowed" : k === "old" ? "locked out" : "",
				again.filter((h) => h === k).length,
				pct(again.filter((h) => h === k).length, raisedSample.length),
				interval(again.filter((h) => h === k).length, raisedSample.length),
			]),
	);
	results.raisedBeforeReadByHand = {
		n: raisedSample.length,
		of: raisedBefore.length,
		...Object.fromEntries(tally(again, (h) => h)),
	};
	results.places = Object.fromEntries(
		PLACES.map((p) => [
			p,
			{findings: later.filter((f) => placeOf(f) === p).length, rounds: roundsWith(p)},
		]),
	);
}

// A2. Each later failed round on its own, then each loop walked.
const walks = {
	lenient: multi.map((l) => walkLoop(l, "lenient")),
	strict: multi.map((l) => walkLoop(l, "strict")),
};
{
	section("A2. What the rule would have done");
	const count = (x: {loop: Loop; round: Round}, test: (p: Place) => boolean) =>
		findingsIn(x.round).filter((f) => test(placeOf(f))).length;
	const nothingAllowed = (mode: "lenient" | "strict") =>
		laterFails.filter(
			(x) =>
				count(x, (p) => ALLOWED.has(p) || (mode === "lenient" && p !== "older text, not raised")) +
					(mode === "lenient" && findingsIn(x.round).length === 0 ? 1 : 0) ===
				0,
		);
	const anyLocked = laterFails.filter((x) => count(x, (p) => p === "older text, not raised") > 0);
	const onlyAllowed = laterFails.filter(
		(x) =>
			findingsIn(x.round).length > 0 && findingsIn(x.round).every((f) => ALLOWED.has(placeOf(f))),
	);
	table(
		`The ${laterFails.length} failed rounds after the first, each on its own`,
		["In the round", "Failed rounds", "Share"],
		[
			[
				"nothing allowed is left, counting what cannot be placed as allowed: the rule passes",
				nothingAllowed("lenient").length,
				pct(nothingAllowed("lenient").length, laterFails.length),
			],
			[
				"nothing allowed is left, counting what cannot be placed as locked out: the rule passes",
				nothingAllowed("strict").length,
				pct(nothingAllowed("strict").length, laterFails.length),
			],
			[
				"at least one finding is locked out",
				anyLocked.length,
				pct(anyLocked.length, laterFails.length),
			],
			[
				"every finding is allowed: the rule changes nothing",
				onlyAllowed.length,
				pct(onlyAllowed.length, laterFails.length),
			],
		],
	);

	const ENDS: readonly End[] = [
		"as recorded",
		"passes early",
		"stops: the list is not shorter",
		"goes on with a shorter list",
	];
	const some = (mode: "lenient" | "strict") =>
		walks[mode].filter((w) => withLaterFail.includes(w.loop));
	table(
		`The ${withLaterFail.length} loops with a failed round after the first, walked under the rule`,
		["The loop", "Not placed counts as allowed", "Not placed counts as locked out"],
		ENDS.map((e) => [
			e,
			share(some("lenient").filter((w) => w.end === e).length, withLaterFail.length),
			share(some("strict").filter((w) => w.end === e).length, withLaterFail.length),
		]),
	);
	for (const mode of ["lenient", "strict"] as const) {
		const early = some(mode).filter((w) => w.end === "passes early");
		const stops = some(mode).filter((w) => w.end === "stops: the list is not shorter");
		const saved = early.reduce((n, w) => n + w.after, 0);
		const savedStops = stops.reduce((n, w) => n + w.after, 0);
		console.log(
			`\n${mode}: passes early in ${early.length} loops (${early.filter((w) => w.afterPass).length} of them on a round that came after a PASS), at round ${[
				...tally(early, (w) => String(w.at)),
			]
				.sort()
				.map(([k, v]) => `${k}: ${v}`)
				.join(", ")}`,
		);
		console.log(
			`  recorded rounds after that point: ${saved} (${early.filter((w) => w.after === 0).length} loops had none: the record ends there too); each is a repair build and a review, about $${(saved * (REVIEW_USD + BUILD_USD)).toFixed(0)} at $${(REVIEW_USD + BUILD_USD).toFixed(2)} a round`,
		);
		console.log(
			`  the findings locked out on the round it passes: ${early.reduce((n, w) => n + (w.laps.at(-1)?.locked ?? 0), 0)}`,
		);
		console.log(
			`  stops in ${stops.length} loops, at round ${[...tally(stops, (w) => String(w.at))]
				.sort()
				.map(([k, v]) => `${k}: ${v}`)
				.join(
					", ",
				)}; recorded rounds after the stop: ${savedStops}; the record went on to: ${[...tally(stops, (w) => pullState(w.loop))].map(([k, v]) => `${k} ${v}`).join(", ")}`,
		);
		console.log(
			`  list at the stop, before to after: ${[
				...tally(stops, (w) => `${w.laps.at(-2)?.list}→${w.laps.at(-1)?.list}`),
			]
				.sort((a, b) => b[1] - a[1])
				.map(([k, v]) => `${k} ×${v}`)
				.join(", ")}`,
		);
		// Is the list at the stop the old list, or a new one of the same length?
		const whatStops = (w: Walked) => {
			const places = w.laps.at(-1)?.places ?? [];
			return places.includes("raised before")
				? "a finding raised before is on it"
				: places.some((p) => p === "written by the repair" || p === "a red check")
					? "only findings on the repair's lines or a red check"
					: "only findings that cannot be placed";
		};
		console.log(
			`  the list at the stop: ${[...tally(stops, whatStops)]
				.sort((a, b) => b[1] - a[1])
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`,
		);
		console.log(
			`  after the stop, the record: ${[...tally(stops, (w) => (w.after === 0 ? "ends there too" : w.loop.rounds.slice(w.at as number).every((r) => r.failed === null) ? "passes on the next round" : "fails again before it passes or ends"))].map(([k, v]) => `${k} ${v}`).join(", ")}`,
		);
	}
	// The other stop: only a finding that comes back ends the loop; a new one on the repair's lines joins the list.
	const same = {
		lenient: withLaterFail.map((l) => walkLoop(l, "lenient", "the same finding")),
		strict: withLaterFail.map((l) => walkLoop(l, "strict", "the same finding")),
	};
	table(
		`The same ${withLaterFail.length} loops, where the loop stops only when a finding raised before comes back`,
		["The loop", "Not placed counts as allowed", "Not placed counts as locked out"],
		ENDS.map((e) => [
			e === "stops: the list is not shorter" ? "stops: a finding came back" : e,
			share(same.lenient.filter((w) => w.end === e).length, withLaterFail.length),
			share(same.strict.filter((w) => w.end === e).length, withLaterFail.length),
		]),
	);
	console.log(
		`\nstops at round ${[
			...tally(
				same.strict.filter((w) => w.end === "stops: the list is not shorter"),
				(w) => String(w.at),
			),
		]
			.sort()
			.map(([k, v]) => `${k}: ${v}`)
			.join(", ")}; after such a stop the record: ${[
			...tally(
				same.strict.filter((w) => w.end === "stops: the list is not shorter"),
				(w) =>
					w.after === 0
						? "ends there too"
						: w.loop.rounds.slice(w.at as number).every((r) => r.failed === null)
							? "passes on the next round"
							: "fails again before it passes or ends",
			),
		]
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	results.sameFindingStop = Object.fromEntries(
		(["lenient", "strict"] as const).map((mode) => [
			mode,
			Object.fromEntries(ENDS.map((e) => [e, same[mode].filter((w) => w.end === e).length])),
		]),
	);
	// A third stop: the first lap that leaves the list no shorter is let through, the second one stops.
	const twice = {
		lenient: withLaterFail.map((l) => walkLoop(l, "lenient", "not shorter twice")),
		strict: withLaterFail.map((l) => walkLoop(l, "strict", "not shorter twice")),
	};
	const afterStop = (w: Walked) =>
		w.after === 0
			? "ends there too"
			: w.loop.rounds.slice(w.at as number).every((r) => r.failed === null)
				? "passes on the next round"
				: "fails again before it passes or ends";
	table(
		`The same ${withLaterFail.length} loops, where one lap that leaves the list no shorter is let through and the second one stops`,
		["The loop", "Not placed counts as allowed", "Not placed counts as locked out"],
		ENDS.map((e) => [
			e === "stops: the list is not shorter" ? "stops: the second lap that did not shorten it" : e,
			share(twice.lenient.filter((w) => w.end === e).length, withLaterFail.length),
			share(twice.strict.filter((w) => w.end === e).length, withLaterFail.length),
		]),
	);
	for (const mode of ["lenient", "strict"] as const) {
		const stops = twice[mode].filter((w) => w.end === "stops: the list is not shorter");
		console.log(
			`${mode}: stops at round ${[...tally(stops, (w) => String(w.at))]
				.sort()
				.map(([k, v]) => `${k}: ${v}`)
				.join(
					", ",
				)}; after such a stop the record: ${[...tally(stops, afterStop)].map(([k, v]) => `${k} ${v}`).join(", ")}`,
		);
	}
	results.secondFlatLapStop = Object.fromEntries(
		(["lenient", "strict"] as const).map((mode) => [
			mode,
			Object.fromEntries(ENDS.map((e) => [e, twice[mode].filter((w) => w.end === e).length])),
		]),
	);
	results.rule = Object.fromEntries(
		(["lenient", "strict"] as const).map((mode) => [
			mode,
			{
				roundsWithNothingAllowed: nothingAllowed(mode).length,
				loops: Object.fromEntries(
					ENDS.map((e) => [e, some(mode).filter((w) => w.end === e).length]),
				),
				roundsAfterAnEarlyPass: some(mode)
					.filter((w) => w.end === "passes early")
					.reduce((n, w) => n + w.after, 0),
				roundsAfterAStop: some(mode)
					.filter((w) => w.end === "stops: the list is not shorter")
					.reduce((n, w) => n + w.after, 0),
			},
		]),
	);
	results.rounds = {
		laterFailed: laterFails.length,
		withALockedOutFinding: anyLocked.length,
		everyFindingAllowed: onlyAllowed.length,
	};
}

// A3. Today's cap on the same loops.
{
	section("A3. Today's round cap on the same loops");
	// A `FAIL` in review that lands in a park is the repair budget running out.
	const spent = new Map<string, VerdictEvent[]>();
	for (const e of R.events)
		if (e.polarity === "FAIL" && e.from === "review" && /^(?:frozen|human:)/.test(e.to))
			spent.set(`${e.lane}/${e.task}`, [...(spent.get(`${e.lane}/${e.task}`) ?? []), e]);
	const capped = multi.filter((l) => spent.has(l.id));
	const roundAt = (l: Loop, e: VerdictEvent) => l.rounds.filter((r) => r.event.at <= e.at).length;
	const first = capped.map((l) =>
		roundAt(l, (spent.get(l.id) as VerdictEvent[])[0] as VerdictEvent),
	);
	console.log(
		`loops where the repair budget ran out at least once: ${capped.length}; at round ${[
			...tally(first, String),
		]
			.sort()
			.map(([k, v]) => `${k}: ${v}`)
			.join(
				", ",
			)}; a person granted another round in ${capped.filter((l) => (R.ends.get(l.id)?.cleared.length ?? 0) > 0).length}; the budget ran out more than once in ${capped.filter((l) => (spent.get(l.id) as VerdictEvent[]).length > 1).length}`,
	);
	console.log(
		`declared budgets over the ${multi.length} loops: ${[...tally(multi, (l) => String(R.ends.get(l.id)?.budget))].map(([k, v]) => `${k} failed reviews: ${v}`).join(", ")}`,
	);
	console.log(
		`how those ${capped.length} ended: ${[...tally(capped, pullState)].map(([k, v]) => `${k} ${v}`).join(", ")}; the task's last state: ${[...tally(capped, (l) => R.ends.get(l.id)?.state ?? "")].map(([k, v]) => `${k} ${v}`).join(", ")}`,
	);
	for (const mode of ["lenient", "strict"] as const) {
		const mine = walks[mode].filter((w) => capped.includes(w.loop));
		const stops = walks[mode].filter((w) => w.end === "stops: the list is not shorter");
		const sooner = mine.filter(
			(w) =>
				w.at !== null &&
				w.at <= roundAt(w.loop, (spent.get(w.loop.id) as VerdictEvent[])[0] as VerdictEvent),
		);
		console.log(
			`${mode}: on the ${capped.length} capped loops the rule ${[...tally(mine, (w) => w.end)].map(([k, v]) => `${k} ${v}`).join(", ")}; it parts from the record at or before the round the cap fired in ${sooner.length}`,
		);
		console.log(
			`  of the ${stops.length} loops the rule stops, the cap also fired in ${stops.filter((w) => capped.includes(w.loop)).length}; in the other ${stops.filter((w) => !capped.includes(w.loop)).length} the record went on for ${stops.filter((w) => !capped.includes(w.loop)).reduce((n, w) => n + w.after, 0)} more rounds`,
		);
	}
	results.cap = {
		loops: capped.length,
		firedAtRound: Object.fromEntries(tally(first, String)),
		cleared: capped.filter((l) => (R.ends.get(l.id)?.cleared.length ?? 0) > 0).length,
	};
}

// A4. Does the list shrink in the record?
{
	section("A4. List length, round by round, in the record");
	const lengthOf = (round: Round) =>
		round.failed === null ? 0 : Math.max(1, findingsIn(round).length);
	const byRound = [1, 2, 3, 4, 5].map((n) => {
		const at = multi.flatMap((l) => l.rounds.filter((r) => (n === 5 ? r.n >= 5 : r.n === n)));
		const fails = at
			.filter((r) => r.failed !== null)
			.map(lengthOf)
			.sort((a, b) => a - b);
		return [
			n === 5 ? "5 and later" : n,
			at.length,
			at.length - fails.length,
			fails.length,
			fails.length === 0 ? "" : mean(fails).toFixed(2),
			fails.length === 0 ? "" : (fails[Math.floor((fails.length - 1) / 2)] as number),
			fails.length === 0 ? "" : (fails.at(-1) as number),
		];
	});
	table(
		`Findings a round, over the ${multi.length} loops with two or more rounds`,
		["Round", "Rounds", "PASS", "FAIL", "Mean findings in a FAIL", "Median", "Most"],
		byRound,
	);
	const steps = multi.flatMap((l) =>
		l.rounds
			.slice(1)
			.flatMap((r) =>
				(l.rounds[r.n - 2] as Round).failed === null
					? []
					: [{from: lengthOf(l.rounds[r.n - 2] as Round), to: lengthOf(r), round: r}],
			),
	);
	const how = (s: {from: number; to: number}) =>
		s.to === 0
			? "to none: PASS"
			: s.to < s.from
				? "shorter, still failing"
				: s.to === s.from
					? "the same length"
					: "longer";
	const order = ["to none: PASS", "shorter, still failing", "the same length", "longer"];
	table(
		`From one failed round to the next round (${steps.length} steps)`,
		[
			"The list went",
			"Steps",
			"Share",
			"Where the round before had one finding",
			"Where it had two or more",
		],
		order.map((o) => [
			o,
			steps.filter((s) => how(s) === o).length,
			pct(steps.filter((s) => how(s) === o).length, steps.length),
			steps.filter((s) => how(s) === o && s.from === 1).length,
			steps.filter((s) => how(s) === o && s.from > 1).length,
		]),
	);
	// The same, counting only what the rule allows into the list.
	const allowedOf = (round: Round) =>
		findingsIn(round).filter((f) => ALLOWED.has(placeOf(f))).length;
	const failSteps = steps.filter((s) => s.to > 0);
	const ruleHow = (s: {from: number; round: Round}) => {
		const [low, high] = [
			allowedOf(s.round),
			findingsIn(s.round).filter((f) => placeOf(f) !== "older text, not raised").length +
				(findingsIn(s.round).length === 0 ? 1 : 0),
		];
		return high === 0
			? "none allowed"
			: high < s.from
				? "shorter"
				: low >= s.from
					? "not shorter"
					: "depends on what cannot be placed";
	};
	console.log(
		`\nthe ${failSteps.length} steps that ended in another FAIL, counting only what the rule lets into the list: ${[...tally(failSteps, ruleHow)].map(([k, v]) => `${k} ${share(v, failSteps.length)}`).join(", ")}`,
	);
	results.listLength = {
		byRound,
		steps: Object.fromEntries(order.map((o) => [o, steps.filter((s) => how(s) === o).length])),
		failStepsUnderTheRule: Object.fromEntries(tally(failSteps, ruleHow)),
	};
}

// B. What became of the locked-out findings.
{
	section("B. What the rule would have locked out, and what became of it");
	const fates = tally(lockedOut, (f) => fateOf(f).fate);
	table(
		`The ${lockedOut.length} locked-out findings (the quote is in the files one round earlier, and no earlier verdict holds it)`,
		["In the record", "Findings", "Share"],
		FATES.map((x) => [x, fates.get(x) ?? 0, pct(fates.get(x) ?? 0, lockedOut.length)]),
	);
	console.log(
		`\nchanged before the merge, with every quoted line gone and not only one: ${actedOn.filter((f) => fateOf(f).every).length} of ${actedOn.length}`,
	);
	console.log(
		`kinds of the ${lockedOut.length}: ${[
			...tally(lockedOut, (f) => (f.kind === "unsure" ? `${f.family}, kind unsure` : f.kind)),
		]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	console.log(
		`in ${new Set(lockedOut.map((f) => f.round)).size} failed rounds of ${new Set(lockedOut.map((f) => f.loop)).size} loops; by round: ${[
			...tally(lockedOut, (f) => String(Math.min(4, f.round.n))),
		]
			.sort()
			.map(([k, v]) => `${k === "4" ? "4 and later" : k}: ${v}`)
			.join(", ")}`,
	);
	// A first review that was only a red check read nothing else: its list is not the whole list.
	const onlyRed = (l: Loop) => {
		const first = findingsIn(l.rounds.find((r) => r.failed !== null));
		return first.length > 0 && first.every((f) => f.kind === "check_red");
	};
	const redFirst = withLaterFail.filter(onlyRed);
	console.log(
		`loops whose first failed review was nothing but a red check: ${multi.filter(onlyRed).length} of ${multi.length}; with a failed round after it ${redFirst.length}; later findings in those that are not a red check: ${later.filter((f) => redFirst.includes(f.loop) && f.kind !== "check_red").length} (locked out ${lockedOut.filter((f) => redFirst.includes(f.loop)).length}, not placed ${unplaced.filter((f) => redFirst.includes(f.loop)).length})`,
	);
	results.redCheckFirst = {
		loops: multi.filter(onlyRed).length,
		withALaterFail: redFirst.length,
		laterFindingsNotARedCheck: later.filter(
			(f) => redFirst.includes(f.loop) && f.kind !== "check_red",
		).length,
	};
	console.log(
		`one round later, by what the reviewer did: ${[...tally(lockedOut, nextOf)]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	const said = (f: Finding) => (readings.lockedOut[f.key] ?? "not read").split(":")[0] as string;
	const verdicts = ["real", "wording", "unclear", "none", "not read"];
	const NAMES: Record<string, string> = {
		real: "a real defect a user or maintainer would care about",
		wording: "wording or style",
		unclear: "cannot tell",
		none: "not a finding",
		"not read": "not read",
	};
	// The sample is fixed: up to 30 whose quoted text changed, filled from the rest when there are fewer.
	// A finding I read while the lookups were still running, and that the sample no longer holds, is counted beside it.
	const inSample = {
		changed: readSample.filter((f) => actedOn.includes(f)),
		stayed: readSample.filter((f) => !actedOn.includes(f)),
	};
	const alsoRead = lockedOut.filter(
		(f) => !readSample.includes(f) && readings.lockedOut[f.key] !== undefined,
	);
	const count = (set: readonly Finding[], v: string) => set.filter((f) => said(f) === v).length;
	table(
		`${readSample.length} of the ${lockedOut.length} locked-out findings, read by hand: a fixed sample of ${inSample.changed.length} of the ${actedOn.length} whose quoted text changed${inSample.stayed.length === 0 ? "" : `, and ${inSample.stayed.length} of the rest`}`,
		["Reading", "In the sample", "Share", "95% interval", "Also read, outside the sample"],
		verdicts
			.filter((v) => v !== "not read" || count(readSample, v) > 0)
			.map((v) => [
				NAMES[v] as string,
				count(readSample, v),
				pct(count(readSample, v), readSample.length),
				interval(count(readSample, v), readSample.length),
				count(alsoRead, v),
			]),
	);
	console.log(
		`\nalso read: ${alsoRead.length} (${alsoRead.filter((f) => actedOn.includes(f)).length} whose quoted text changed, ${alsoRead.filter((f) => !actedOn.includes(f)).length} whose quoted text stayed)`,
	);
	// Where each real one came from, by a word in my note. The four do not overlap.
	const everyRead = [...readSample, ...alsoRead];
	const notes = everyRead
		.map((f) => readings.lockedOut[f.key] ?? "")
		.filter((r) => r.startsWith("real"));
	const FROM: readonly (readonly [string, RegExp])[] = [
		["another place with the same fault as an earlier finding", /\bsibling\b/],
		["old text the repair itself made false", /made false by the repair/],
		["on lines the repair wrote, so the placing is wrong", /the repair wrote/],
		["the base branch moved under the pull request", /the base moved/],
		["there for the first review to see, and not a twin of an earlier finding", /first review/],
	];
	const from = FROM.map(
		([name, test]) => [name, notes.filter((r) => test.test(r)).length] as const,
	);
	console.log(
		`\nof the ${notes.length} real ones, in the sample or beside it: ${from.map(([name, n]) => `${name} ${n}`).join("; ")}; could not tell ${notes.length - from.reduce((n, x) => n + x[1], 0)}`,
	);
	const realOnes = everyRead.filter((f) => said(f) === "real");
	console.log(
		`the real ones by family: ${[...tally(realOnes, (f) => f.family)]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	results.lockedOutRealFrom = Object.fromEntries(from);
	for (const v of ["real", "wording", "unclear", "none"])
		console.log(
			`  ${v}: ${everyRead
				.filter((f) => said(f) === v)
				.map(linkOf)
				.join(" ")}`,
		);
	results.lockedOut = {
		findings: lockedOut.length,
		fates: Object.fromEntries(fates),
		oneRoundLater: Object.fromEntries(tally(lockedOut, nextOf)),
		everyQuoteGone: actedOn.filter((f) => fateOf(f).every).length,
		readByHand: {
			n: readSample.length,
			quotedTextChanged: actedOn.length,
			...Object.fromEntries(verdicts.map((v) => [v, count(readSample, v)])),
		},
	};
}

// C. How far code goes: two checks run on the recorded commits, and a reading of 60 findings.
{
	section("C. How far code goes");
	const kindRow = (f: Finding) =>
		f.kind !== "unsure" ? f.kind : f.family !== "unsure" ? `${f.family}, kind unsure` : "unsure";
	const kinds = tally(everyFinding, kindRow);
	console.log(
		`findings in the whole set, as the walk counts them: ${everyFinding.length} in ${new Set(everyFinding.map((f) => f.round)).size} failed reviews; by kind: ${[
			...kinds,
		]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${share(v, everyFinding.length)}`)
			.join(", ")}`,
	);

	// Check 1: is the quoted line still in its file one round later?
	console.log(
		`\ncheck 1, the quoted line: findings of a failed round that another round followed ${followed.length}; they quote something ${followed.filter((f) => f.quotes.length > 0).length}; a quote is in a file at the round's commit, so the check can run ${tried.length}`,
	);
	const cols = ["raised it again", "failed on something else", "passed"];
	const rowsOf = (set: typeof tried) =>
		["still there", "changed"].map((code) => [
			`the quoted line is ${code}`,
			...cols.map((c) => set.filter((t) => t.code === code && t.reviewer === c).length),
		]);
	for (const group of ["stale text", "wrong text", "text, kind unsure", "code", "other"]) {
		const set = tried.filter((t) => textKind(t.f) === group);
		table(
			`${group}: ${set.length} findings, by what the next round's reviewer did`,
			["One round later", ...cols],
			rowsOf(set),
		);
	}
	table(`all kinds: ${tried.length} findings`, ["One round later", ...cols], rowsOf(tried));
	const still = tried.filter((t) => t.code === "still there");
	const moved = tried.filter((t) => t.code === "changed");
	console.log(
		`\n"still there" means still open: the reviewer raised it again in ${share(still.filter((t) => t.reviewer === "raised it again").length, still.length)}; "changed" means closed: the reviewer did not raise it again in ${share(moved.filter((t) => t.reviewer !== "raised it again").length, moved.length)}`,
	);
	const agree = tried.filter(
		(t) => (t.code === "still there") === (t.reviewer === "raised it again"),
	);
	console.log(
		`the check and the reviewer agree on ${share(agree.length, tried.length)}; on stale text alone ${share(agree.filter((t) => textKind(t.f) === "stale text").length, tried.filter((t) => textKind(t.f) === "stale text").length)}`,
	);
	const WHY: Record<string, string> = {
		proof:
			"the quote is proof, not the faulty line: a rule, the code a doc is held against, a check's name, a line the fix leaves alone",
		elsewhere: "the quote is a short string that also sits in a file the finding is not about",
		beside: "the quote is the faulty line, and the fix was made beside it or in another file",
		open: "the quote is the faulty line and it was left: the finding was dropped, ruled out, or moved to a ticket",
		none: "not a finding: a note or a cleared point",
		"not read": "not read",
	};
	const why = staySample.map(
		(t) => (readings.disagreements[t.f.key] ?? "not read").split(":")[0] as string,
	);
	table(
		`The quoted line stayed and the next reviewer did not raise it again (${stayed.length}): ${staySample.length} read by hand (a fixed sample)`,
		["Why", "Findings", "Share", "95% interval"],
		Object.keys(WHY)
			.filter((k) => k !== "not read" || why.includes(k))
			.map((k) => [
				WHY[k] as string,
				why.filter((w) => w === k).length,
				pct(why.filter((w) => w === k).length, staySample.length),
				interval(why.filter((w) => w === k).length, staySample.length),
			]),
	);
	if (process.env.DETAIL === "1")
		for (const t of stayed)
			console.log(
				`  ${t.f.key} ${t.f.item.posted.url} round ${t.f.round.n} of ${t.f.loop.rounds.length} ${textKind(t.f)} -> ${t.reviewer}`,
			);

	// Check 2: is a check red at the commit, by GitHub's own record?
	const OWN = /governance verdict|governance-root diff|governance floor|^ci-required$/i;
	const RED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
	const redAt = (head: string | null): "red" | "green" | "no runs" => {
		const checks: Checks | null = full(head) ? readChecks(CACHE, head) : null;
		if (checks === null || checks.missing || checks.runs.length === 0) return "no runs";
		return checks.runs.some(
			(c) => c.conclusion !== null && RED.has(c.conclusion) && !OWN.test(c.name),
		)
			? "red"
			: "green";
	};
	const reds = everyFinding.filter((f) => f.kind === "check_red");
	const redRounds = [...new Set(reds.map((f) => f.round))];
	const atRound = tally(redRounds, (r) => redAt(r.head));
	console.log(
		`\ncheck 2, the check runs: findings labelled a red check ${reds.length}, in ${redRounds.length} failed rounds; GitHub's record at that commit: ${[...atRound].map(([k, v]) => `${k} ${v}`).join(", ")}`,
	);
	const names = (r: Round) => (r.failed?.failed ?? []).map((p) => p.body).join(" ");
	const notCi = redRounds.filter((r) => redAt(r.head) === "green");
	console.log(
		`  where the record is green (${notCi.length}), the verdict names: a guard run by hand ${notCi.filter((r) => /guard [\w-]+ check|portability-guard|fabrika guard/i.test(names(r))).length}, a conflict with the base ${notCi.filter((r) => /conflicts? with (?:main|the base)|merge conflict|not mergeable|CONFLICTING/i.test(names(r))).length}, a re-run or a flake ${notCi.filter((r) => /re-?run|flak/i.test(names(r))).length}`,
	);
	const nextOf = redRounds.flatMap((r) => {
		const loop = multi.find((l) => l.rounds.includes(r));
		const next = loop?.rounds[r.n];
		return next === undefined || redAt(r.head) !== "red"
			? []
			: [
					{
						r,
						next,
						code: redAt(next.head),
						reviewer:
							next.failed === null
								? "passed"
								: findingsIn(next).some((f) => f.kind === "check_red")
									? "red again"
									: "failed on something else",
					},
				];
	});
	table(
		`One round after a red check that GitHub also has on record (${nextOf.length} rounds)`,
		["GitHub's record one round later", "red again", "failed on something else", "passed"],
		["red", "green", "no runs"].map((c) => [
			c,
			...["red again", "failed on something else", "passed"].map(
				(v) => nextOf.filter((x) => x.code === c && x.reviewer === v).length,
			),
		]),
	);

	// Check 3: where the quoted line changed, the small classifier's "is it fixed?" against the next reviewer.
	const asked = tried.filter((t) => t.code === "changed" && fixedAnswers[t.f.key] !== undefined);
	const sayOf = (key: string) => {
		const [choice, p] = Object.entries(fixedAnswers[key] ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [
			"unsure",
			0,
		];
		return p >= FLOOR ? choice : "unsure";
	};
	const SAYS = ["fixed", "not_fixed", "cannot_tell", "unsure"];
	if (asked.length > 0) {
		table(
			`check 3, the small classifier: ${asked.length} findings whose quoted line changed, asked "does this change fix it?"`,
			[`The classifier, at ${FLOOR} and up`, ...cols],
			SAYS.map((s) => [
				s.replace("_", " "),
				...cols.map((c) => asked.filter((t) => sayOf(t.f.key) === s && t.reviewer === c).length),
			]),
		);
		const sure = asked.filter((t) => sayOf(t.f.key) === "fixed" || sayOf(t.f.key) === "not_fixed");
		const right = sure.filter(
			(t) => (sayOf(t.f.key) === "not_fixed") === (t.reviewer === "raised it again"),
		);
		console.log(
			`\nsure of fixed or not fixed on ${share(sure.length, asked.length)}; where sure, it sides with the reviewer on ${share(right.length, sure.length)}; of the ${asked.filter((t) => t.reviewer === "raised it again").length} the reviewer raised again it said not fixed on ${asked.filter((t) => t.reviewer === "raised it again" && sayOf(t.f.key) === "not_fixed").length} and fixed on ${asked.filter((t) => t.reviewer === "raised it again" && sayOf(t.f.key) === "fixed").length}`,
		);
	}

	// The reading: 60 findings, a fixed shuffle of the whole set.
	const hows = ["code", "half", "reader", "none", "not read"];
	const said = recheckSample.map((f) => readings.recheck[f.key] ?? "not read");
	const count = Object.fromEntries(
		hows.map((h) => [h, said.filter((s) => s.split(":")[0] === h).length]),
	);
	const NAMES: Record<string, string> = {
		code: "code alone can say open or fixed",
		half: "code can say still open; once the line changes it takes a reader",
		reader: "a reader either way",
		none: "not a finding: a note or a cleared point the splitter cut as one",
		"not read": "not read",
	};
	table(
		`${recheckSample.length} findings of the whole set, read by hand: can the next round check this one again with no reader?`,
		["Reading", "Findings", "Share", "95% interval"],
		hows
			.filter((h) => h !== "not read" || (count[h] ?? 0) > 0)
			.map((h) => [
				NAMES[h] as string,
				count[h] ?? 0,
				pct(count[h] ?? 0, recheckSample.length),
				interval(count[h] ?? 0, recheckSample.length),
			]),
	);
	console.log(
		`\nthe checks named in the reading: ${[
			...tally(
				said.filter((s) => s.includes(":")),
				(s) => s,
			),
		]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	console.log(
		`the kinds of the sample, by label: ${[...tally(recheckSample, kindRow)]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	results.code = {
		findings: everyFinding.length,
		byKind: Object.fromEntries(kinds),
		quotedLine: {
			followed: followed.length,
			canRun: tried.length,
			table: Object.fromEntries(
				["still there", "changed"].map((c) => [
					c,
					Object.fromEntries(
						cols.map((v) => [v, tried.filter((t) => t.code === c && t.reviewer === v).length]),
					),
				]),
			),
			agree: agree.length,
			stayedReadByHand: {n: staySample.length, ...Object.fromEntries(tally(why, (w) => w))},
		},
		redCheck: {
			findings: reds.length,
			rounds: redRounds.length,
			githubAtTheRound: Object.fromEntries(atRound),
			oneRoundLater: nextOf.length,
		},
		readByHand: {n: recheckSample.length, ...count},
		classifier: {
			asked: asked.length,
			table: Object.fromEntries(
				SAYS.map((s) => [
					s,
					Object.fromEntries(
						cols.map((c) => [
							c,
							asked.filter((t) => sayOf(t.f.key) === s && t.reviewer === c).length,
						]),
					),
				]),
			),
		},
	};
}

// DETAIL=<a pull request number>: its loops, round by round, with where each finding stands.
if (/^\d+$/.test(process.env.DETAIL ?? "")) {
	section(`Pull request ${process.env.DETAIL}, round by round`);
	for (const l of multi.filter((x) => String(pullOf(x)) === process.env.DETAIL)) {
		const [lenient, strict] = [
			walks.lenient.find((w) => w.loop === l) as Walked,
			walks.strict.find((w) => w.loop === l) as Walked,
		];
		console.log(
			`\nloop ${l.id}: lenient ${lenient.end}${lenient.at === null ? "" : ` at round ${lenient.at}`} (list ${lenient.laps.map((x) => x.list).join(", ")}); strict ${strict.end}${strict.at === null ? "" : ` at round ${strict.at}`} (list ${strict.laps.map((x) => x.list).join(", ")})`,
		);
		for (const r of l.rounds) {
			console.log(
				`  round ${r.n} ${r.failed === null ? "PASS" : "FAIL"} at ${r.head?.slice(0, 8) ?? "?"}`,
			);
			for (const p of r.failed?.failed ?? [])
				console.log(`    verdict ${p.marker.namespace}: ${p.marker.clause.slice(0, 160)} ${p.url}`);
			for (const f of findingsIn(r))
				console.log(
					`    finding ${f.key} [${r.n === l.rounds.find((x) => x.failed !== null)?.n ? "the first list" : placeOf(f)}] ${f.kind}: ${(f.item.level === "reason" ? f.item.posted.body : f.item.whole).slice(0, 200).replace(/\s+/g, " ")}`,
				);
		}
	}
}

// What is kept: the counts above, one row per loop and one per later-round finding. No comment text.
const rowOfLoop = (l: Loop) => {
	const [lenient, strict] = [
		walks.lenient.find((w) => w.loop === l) as Walked,
		walks.strict.find((w) => w.loop === l) as Walked,
	];
	return {
		id: l.id,
		kind: l.kind,
		pull: pullOf(l),
		ended: pullState(l),
		rounds: l.rounds.map((r) => (r.failed === null ? "P" : "F")).join(""),
		found: l.rounds.map((r) => (r.failed === null ? 0 : Math.max(1, findingsIn(r).length))),
		lenient: {end: lenient.end, at: lenient.at, list: lenient.laps.map((x) => x.list)},
		strict: {end: strict.end, at: strict.at, list: strict.laps.map((x) => x.list)},
	};
};
results.loopRows = withLaterFail.map(rowOfLoop);
results.findingRows = later.map((f) => ({
	key: f.key,
	loop: f.loop.id,
	round: f.round.n,
	kind: f.kind,
	family: f.family,
	place: placeOf(f),
	...(placeOf(f) === "older text, not raised"
		? {fate: fateOf(f).fate, read: readings.lockedOut[f.key]?.split(":")[0] ?? null}
		: {}),
}));
writeFileSync(
	join(here, "results", "shrinking-list-replay.json"),
	`${JSON.stringify({repo: REPO, note: "Experiment 58. Keys are experiment 54's item keys: <comment id>.<posted, seconds>#<n>. No comment text.", ...results})}\n`.replace(
		/\{"(?:id|key)":/g,
		(m) => `\n${m}`,
	),
);
