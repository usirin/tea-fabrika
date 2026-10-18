// The review rounds of today's fabrika, read back from the lane logs and the
// verdict comments experiment 54 cached. This is experiment 54's loading and
// labelling code, lifted into one function so a second experiment can stand on
// the same items and the same labels. Experiment 54's own script still holds
// its copy: it was not touched, so its tables stay as they were written.
//
// Nothing here calls GitHub or Jev. It reads a `.fabrika` folder, a cache
// folder of thread files, the codebook and the saved labels.
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {compileLane, isPark, parseLog, stageOf, walk} from "../../legacy/src/lane-log";
import {findingsIn, type Posted, postedIn, verdictsBetween} from "../../wip/src/verdict";
import {readClosers, readEdits, readThread, type Thread} from "./threads.ts";

/** One `PASS` or `FAIL` a reviewer wrote into a lane's log. */
export interface VerdictEvent {
	readonly lane: string;
	readonly kind: "single" | "epic";
	readonly task: string;
	readonly polarity: "PASS" | "FAIL";
	/** The state it was written in: `review`, `review:ui`, or `frozen`. */
	readonly from: string;
	/** Where the task went: a park here is the repair budget running out. */
	readonly to: string;
	/** 1 for the first verdict this task got in `review`, 2 for the second, and so on. */
	readonly round: number;
	readonly at: number;
	/** When the task's event before this one was written: the review started no earlier. */
	readonly since: number;
	readonly classes: readonly string[];
	/** Every pull request or issue the verdict's comments may be on. */
	readonly threads: readonly number[];
	readonly issue: number | null;
}

/** What one task's log says outside its verdicts. */
export interface TaskEnd {
	/** The state the task stood in when the log ends. */
	readonly state: string;
	/** Rounds a person granted after the repair budget ran out. */
	readonly cleared: readonly number[];
	/** The repair budget the lane declared: failed reviews before it stops for a person. */
	readonly budget: number;
	/** Events that sent the work back with no review finding: a lap, or a `FAIL` written outside review. */
	readonly laps: number;
	/** Every pull request the lane's log names, in order. Where it names none, the ones GitHub says closed the issue. */
	readonly pulls: readonly number[];
}

/** One failed review: a `FAIL` line and the verdicts the reviewer posted for it. */
export interface FailedReview {
	/** `<lane>/<task>/<round>`: stable across runs, and holds no text. */
	readonly id: string;
	readonly event: VerdictEvent;
	readonly failed: readonly Posted[];
	readonly passed: readonly Posted[];
}

/** One thing that gets a label: a failing verdict as a whole (`reason`), or one point of it (`finding`). */
export interface Item {
	/** `<comment id>.<posted, in seconds>#<n>`, `#0` for the reason: no text in it. */
	readonly key: string;
	readonly level: "reason" | "finding";
	readonly review: FailedReview;
	readonly posted: Posted;
	readonly blocking: boolean;
	readonly from: string;
	/** The whole item, white space squeezed. */
	readonly whole: string;
}

export interface Label {
	/** A kind of the codebook, or `unsure`. */
	readonly kind: string;
	/** The kind's family, or `unsure`. Known more often than the kind. */
	readonly family: string;
	readonly restsOn: string;
	readonly by: "hand" | "jev" | "none";
}

interface Codebook {
	readonly kind: {readonly choices: Readonly<Record<string, string>>};
	readonly reasons: Readonly<Record<string, string>>;
	readonly findings: Readonly<Record<string, string>>;
}
interface JevLabel {
	readonly kind: Readonly<Record<string, number>>;
	readonly restsOn: Readonly<Record<string, number>>;
}

export const FAMILY: Readonly<Record<string, string>> = {
	stale_text: "text",
	wrong_text: "text",
	prose_craft: "text",
	code_bug: "code",
	test_gap: "code",
	check_red: "checks",
	decision_conflict: "rules",
	record_keeping: "rules",
	convention: "rules",
	criterion_unmet: "ticket",
	pr_text: "ticket",
	carried: "none",
	not_a_finding: "none",
};
const FLOOR = 0.8;
const MIN = 60_000;

const numberOf = (url: string | null): number | null => {
	const m = url === null ? null : /\/(?:pull|issues)\/(\d+)/.exec(url);
	return m === null ? null : Number(m[1]);
};
const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
/** The part of a verdict that says what is wrong, when it lists no findings: from its most telling paragraph on. */
function gistOf(body: string): string {
	const paragraphs = body
		.split(/\n\s*\n/)
		.filter((p) => !/^\s*\|/.test(p) && !/^#{1,4}\s/.test(p.trim()) && !/^\s*```/.test(p));
	const telling =
		/\bFAIL\b|\bblock|\bstale\b|contradict|\bbans?\b|banned|collid|duplicate|\bmissing\b|\bwrong\b|\bfalse\b|\bred\b|\bstill\b|does not|no longer|not met|unmet/gi;
	const scored = paragraphs.map((p, i) => ({
		i,
		score: (p.match(telling) ?? []).length / Math.max(1, p.length / 400),
	}));
	const best = [...scored].sort((a, b) => b.score - a.score)[0];
	return squeeze(paragraphs.slice(best === undefined || best.score === 0 ? 0 : best.i).join(" "));
}

/** A fixed shuffle, so a sample is the same on every run. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
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

/** Experiment 54's hand-labelled sample: the same 59 failed reviews, picked the same way. */
function sampleOf(all: readonly FailedReview[]): FailedReview[] {
	const start = Math.min(...all.map((r) => r.event.at));
	const week = (r: FailedReview) =>
		Math.min(7, Math.floor((r.event.at - start) / (7 * 24 * 60 * MIN)));
	const picked: FailedReview[] = [];
	for (let w = 0; w < 8; w++) {
		const pool = shuffled(
			all.filter((r) => week(r) === w),
			54 + w,
		);
		const want: ((r: FailedReview) => boolean)[] = [
			(r) => r.event.round >= 3,
			(r) => r.event.round === 2,
			(r) => r.event.kind === "epic",
			(r) => r.failed.some((p) => p.marker.namespace === "review-skill"),
			(r) => r.failed.some((p) => p.marker.namespace === "review-doc"),
			(r) => r.failed.some((p) => p.marker.namespace === "governance"),
			(r) => r.failed.some((p) => p.marker.namespace === "review-code") && r.event.round === 1,
			(r) => r.event.round === 1,
		];
		for (const fits of want) {
			const hit = pool.find((r) => fits(r) && !picked.includes(r));
			if (hit !== undefined) picked.push(hit);
		}
	}
	return picked;
}

export interface Rounds {
	/** Every verdict line of every lane, in the order the lanes were read. */
	readonly events: readonly VerdictEvent[];
	/** `<lane>/<task>` to what else the task's log says. */
	readonly ends: ReadonlyMap<string, TaskEnd>;
	/** The failed text reviews experiment 54 matched to a failing verdict. */
	readonly reviews: readonly FailedReview[];
	/** `FAIL` lines with no failing verdict behind them, and why. */
	readonly lost: readonly {
		readonly event: VerdictEvent;
		readonly why: "bookkeeping" | "no-thread" | "not-found";
	}[];
	readonly itemsOf: (review: FailedReview) => readonly Item[];
	readonly labelOf: (item: Item) => Label;
	/** The verdicts one event stands for, on the threads they may be on. */
	readonly matchOf: (event: VerdictEvent) => readonly Posted[];
	readonly threadOf: (n: number) => Thread | null;
}

/** Read every lane under `lanes` and match its verdict lines to the cached comments. */
export function loadRounds(opts: {
	readonly lanes: string;
	readonly cache: string;
	readonly here: string;
}): Rounds {
	const closers = readClosers(opts.cache);
	const events: VerdictEvent[] = [];
	const ends = new Map<string, TaskEnd>();
	for (const root of ["lanes", "lanes-archived"]) {
		const dir = join(opts.lanes, root);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir).sort()) {
			const folder = join(dir, name);
			if (!existsSync(join(folder, "workflow.json")) || !existsSync(join(folder, "events.jsonl")))
				continue;
			const compiled = compileLane(JSON.parse(readFileSync(join(folder, "workflow.json"), "utf8")));
			if (compiled === null) continue;
			const kind = compiled.id === "coder" ? "single" : "epic";
			const entries = parseLog(readFileSync(join(folder, "events.jsonl"), "utf8")).entries;
			const walked = walk(compiled, entries);
			const pullOf = (url: unknown): number[] => {
				const m = typeof url === "string" ? /\/pull\/(\d+)/.exec(url) : null;
				return m === null ? [] : [Number(m[1])];
			};
			const lanePulls = [
				...new Set(entries.flatMap((e) => [...pullOf(e.pr), ...pullOf(e.raw.comment)])),
			];
			for (const [task, steps] of Object.entries(walked.steps)) {
				const child = /^issue_(\d+)$/.exec(task);
				const issue =
					kind === "single" ? Number.parseInt(name, 10) : child === null ? null : Number(child[1]);
				let lastPull: number | null = null;
				let round = 0;
				let since = 0;
				let laps = 0;
				for (const step of steps) {
					const e = step.entry;
					const pull = numberOf(e.pr);
					if (pull !== null) lastPull = pull;
					const inReview = stageOf(step.from) === "review";
					const verdict =
						(e.event === "PASS" || e.event === "FAIL") && (inReview || step.from === "frozen");
					if (e.event === "LAP" || (e.event === "FAIL" && !verdict)) laps += 1;
					if (verdict) {
						const named = typeof e.raw.comment === "string" ? e.raw.comment : null;
						const threads = new Set<number>();
						for (const n of [pull, lastPull, numberOf(named), kind === "epic" ? issue : null])
							if (n !== null) threads.add(n);
						if (threads.size === 0 && issue !== null)
							for (const n of closers[String(issue)] ?? []) threads.add(n);
						if (step.from === "review") round += 1;
						events.push({
							lane: name,
							kind,
							task,
							polarity: e.event as "PASS" | "FAIL",
							from: step.from,
							to: step.to,
							round: step.from === "review" ? round : 1,
							at: e.at,
							since,
							classes: step.after.classes,
							threads: [...threads],
							issue: issue === null || Number.isNaN(issue) ? null : issue,
						});
					}
					since = e.at;
				}
				const last = walked.states[task];
				if (last !== undefined)
					ends.set(`${name}/${task}`, {
						state: last.state,
						cleared: last.cleared,
						budget: compiled.tasks[task]?.initial.maxRetries ?? 3,
						laps,
						pulls:
							lanePulls.length > 0 || issue === null ? lanePulls : (closers[String(issue)] ?? []),
					});
			}
		}
	}

	const threads = new Map<number, Thread | null>();
	const threadOf = (n: number): Thread | null => {
		if (threads.has(n)) return threads.get(n) ?? null;
		const read = readThread(opts.cache, n);
		const thread = read === null || read === "missing" ? null : read;
		threads.set(n, thread);
		return thread;
	};
	const postedCache = new Map<number, readonly Posted[]>();
	const postedOn = (n: number): readonly Posted[] => {
		const hit = postedCache.get(n);
		if (hit !== undefined) return hit;
		const edits = readEdits(opts.cache, n);
		const out = (threadOf(n)?.comments ?? []).flatMap((c) =>
			postedIn(
				{
					id: c.id,
					url: c.url,
					at: Date.parse(c.at),
					editedAt: c.editedAt === null ? null : Date.parse(c.editedAt),
					body: c.body,
				},
				edits?.[String(c.id)]?.map((v) => ({at: Date.parse(v.at), body: v.body})) ?? null,
			),
		);
		postedCache.set(n, out);
		return out;
	};
	const matchOf = (e: VerdictEvent): readonly Posted[] => {
		const seen = new Set<number>();
		return e.threads
			.flatMap((n) => verdictsBetween(postedOn(n), e.since, e.at))
			.filter((p) => !seen.has(p.commentId) && seen.add(p.commentId));
	};

	const reviews: FailedReview[] = [];
	const lost: {event: VerdictEvent; why: "bookkeeping" | "no-thread" | "not-found"}[] = [];
	for (const e of events) {
		if (e.polarity !== "FAIL" || e.from === "review:ui") continue;
		const matched = matchOf(e);
		const failed = matched.filter((p) => p.marker.polarity === "FAIL");
		if (failed.length > 0) {
			reviews.push({
				id: `${e.lane}/${e.task}/${e.from === "review" ? "" : `${e.from}-`}${e.round}`,
				event: e,
				failed,
				passed: matched.filter((p) => p.marker.polarity === "PASS"),
			});
			continue;
		}
		lost.push({
			event: e,
			why:
				e.at - e.since < 3 * MIN
					? "bookkeeping"
					: e.threads.length === 0
						? "no-thread"
						: "not-found",
		});
	}

	const itemCache = new Map<FailedReview, readonly Item[]>();
	const itemsOf = (review: FailedReview): readonly Item[] => {
		const hit = itemCache.get(review);
		if (hit !== undefined) return hit;
		const out = review.failed.flatMap((posted) => {
			const stem = `${posted.commentId}.${Math.floor(posted.at / 1000)}`;
			const found = findingsIn(posted.body).map(
				(f, i): Item => ({
					key: `${stem}#${i + 1}`,
					level: "finding",
					review,
					posted,
					blocking: f.blocking,
					from: f.from,
					whole: squeeze(f.text),
				}),
			);
			const detail = found.find((f) => f.blocking)?.whole ?? gistOf(posted.body);
			const reason: Item = {
				key: `${stem}#0`,
				level: "reason",
				review,
				posted,
				blocking: true,
				from: "reason",
				whole: detail,
			};
			return [reason, ...found];
		});
		itemCache.set(review, out);
		return out;
	};

	// Labels: by hand on experiment 54's sample, by Jev at its floor on the rest.
	const codebook = JSON.parse(
		readFileSync(join(opts.here, "54-codebook.json"), "utf8"),
	) as Codebook;
	const labelsFile = join(opts.here, "results", "why-reviews-fail-labels.json");
	const jevLabels: Record<string, JevLabel> = existsSync(labelsFile)
		? (JSON.parse(readFileSync(labelsFile, "utf8")) as {labels: Record<string, JevLabel>}).labels
		: {};
	const topOf = (shares: Readonly<Record<string, number>>): [string, number] =>
		Object.entries(shares).sort((a, b) => b[1] - a[1])[0] ?? ["unsure", 0];
	const commentOf = (key: string) => key.slice(0, key.indexOf("."));
	const indexOf = (key: string) => key.slice(key.indexOf("#") + 1);
	// A hand label is keyed by its comment, and a comment can hold a later round's verdict too: only the sampled review owns it.
	const sampled = new Set(sampleOf(reviews).map((r) => r.id));
	const labelOf = (item: Item): Label => {
		const raw = !sampled.has(item.review.id)
			? undefined
			: item.level === "reason"
				? codebook.reasons[commentOf(item.key)]
				: codebook.findings[`${commentOf(item.key)}#${indexOf(item.key)}`];
		const jev = jevLabels[item.key];
		const jevRests =
			jev === undefined
				? "unsure"
				: topOf(jev.restsOn)[1] >= FLOOR
					? topOf(jev.restsOn)[0]
					: "unsure";
		if (raw !== undefined) {
			const [kind, restsOn] = raw.split("/") as [string, string | undefined];
			return {kind, family: FAMILY[kind] ?? "unsure", restsOn: restsOn ?? jevRests, by: "hand"};
		}
		if (jev === undefined)
			return {kind: "unlabelled", family: "unlabelled", restsOn: "unlabelled", by: "none"};
		const [kind, kindP] = topOf(jev.kind);
		const families: Record<string, number> = {};
		for (const [k, p] of Object.entries(jev.kind))
			families[FAMILY[k] ?? "unsure"] = (families[FAMILY[k] ?? "unsure"] ?? 0) + p;
		const [family, familyP] = topOf(families);
		return {
			kind: kindP >= FLOOR ? kind : "unsure",
			family: familyP >= FLOOR ? family : "unsure",
			restsOn: jevRests,
			by: "jev",
		};
	};

	return {events, ends, reviews, lost, itemsOf, labelOf, matchOf, threadOf};
}

export {isPark};
