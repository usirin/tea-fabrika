import {applyCell, type Machine, type Sub} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {intentOf} from "../primitives.ts";
import {nameOf} from "../stages/outcome.ts";
import type {ShipFacts} from "../stages/ship/facts.ts";
import {
	DEFAULT_WAITS,
	enqueue,
	finish,
	MAX_MOVES,
	MAX_WAITS,
	merge,
	readShipFacts,
	rerunChecks,
	type Ship,
	type ShipCmd,
	type ShipMsg,
	ship,
} from "../stages/ship/machine.ts";
import type {Landing, ShipOutcome} from "../stages/ship/outcome.ts";
import {ReadyToMerge} from "../stages/ship/ready.ts";
import {C1, C2, CRITERIA, filed, metAt, ON_TIP, readyAt, rowOn} from "../stages/ship/scripted.ts";

// The ship machine's laws as property tests, on tea's own module (`@demlik/tea/pbt`, on
// fast-check). Experiment 121.
//
// A property folds a random list of Msgs through the machine, from its real `init`, and checks a
// law after every step. A list that breaks it is shrunk to a short one that still does.
//
//   TODAY  the five laws of `./ship.ts`, moved as they are: run 1 of experiment 121.
//   NEW    two laws experiment 119 found missing: which outcome a run gives, and a ready pull
//          request lands. Run 2 is TODAY and NEW together.
//   saved  one more property: a run started from a saved state, through `init`.
//
// `./ship.ts` keeps the same five laws in the search engine's form, for what still runs on the
// engine: the lanes world, the standard test and the promise check. It leaves with them.

// ---------------------------------------------------------------- the Msgs, and a planted copy

type MsgOf<T> = T extends Machine<infer _S, infer M, infer _C, infer _U, infer _X> ? M : never;
/** Every Msg the ship machine takes: its own, and the answer to each Cmd. */
export type AnyShipMsg = MsgOf<typeof ship>;
type Msg = AnyShipMsg;
export type ShipStep = Step<Ship, Msg, ShipCmd>;
/** The real ship machine, or a planted copy of it: any state that is a `Ship`. */
export type ShipLike<S extends Ship, U extends Sub> = Machine<S, Msg, ShipCmd, U, undefined>;
/** One reducer step, as a planted mistake in `./ship.ts` is written. */
export type ShipUpdate<S extends Ship> = (state: S, msg: Msg) => readonly [S, readonly ShipCmd[]];

/**
 * A machine around a planted mistake, so tea's runners can step it: every Msg goes to the one
 * function. tea's runners take only a machine, so each of the 16 Msg types is named here.
 */
export function planted<S extends Ship>(start: S, step: ShipUpdate<S>): ShipLike<S, never> {
	return {
		init: (loaded) => [loaded ?? start, []],
		update: {
			start: step,
			resume: step,
			ship_facts_ok: step,
			ship_facts_err: step,
			ship_rerun_checks_ok: step,
			ship_rerun_checks_err: step,
			ship_checks: step,
			ship_checks_overdue: step,
			ship_enqueue_ok: step,
			ship_enqueue_err: step,
			ship_merge_ok: step,
			ship_merge_err: step,
			ship_queue: step,
			ship_queue_overdue: step,
			ship_finish_ok: step,
			ship_finish_err: step,
		},
	};
}

// ---------------------------------------------------------------- generators

export const PR = "P";
/** Two heads: an answer names one, so half the answers fit what was asked. */
export const HEADS = ["A", "B"] as const;
const heads = fc.constantFrom(...HEADS);
const UNKNOWN = {_tag: "unknown" as const};

/**
 * One value eight times in nine, else one of the others: a read has ten such fields, so about a
 * third of reads are ready and about a third have one thing wrong.
 */
const mostly = <T>(usual: T, ...others: readonly [T, ...T[]]): fc.Arbitrary<T> =>
	fc.oneof(
		{weight: 8, arbitrary: fc.constant(usual)},
		{weight: 1, arbitrary: fc.constantFrom(...others)},
	);

type VerdictRow = ShipFacts["verdicts"][number];
/**
 * The verdict rows a read may find at `head`, by what they say: all met, the second failed,
 * judged only at another head, or judged on its old words.
 */
export const PROOFS = ["met", "failed", "other_head", "old_version"] as const;
type ProofKind = (typeof PROOFS)[number];
const rowsFor = (head: string, kind: ProofKind): readonly VerdictRow[] => {
	switch (kind) {
		case "met":
			return metAt(head);
		case "failed":
			return filed([rowOn(C1, head), rowOn(C2, head, "fail")]);
		case "other_head":
			return metAt(`${head}-before`);
		case "old_version":
			return filed([rowOn(C1, head), rowOn(C2, head, "pass", 1)]);
	}
};

const CLOSES: ShipFacts["ticket"] = {id: "o/r#1", link: "closes_it"};
const PART: ShipFacts["ticket"] = {id: "o/r#1", link: "part_of_it"};
type Review = NonNullable<ShipFacts["reviews"]>[number];
const review: fc.Arbitrary<Review> = fc.record({
	kind: fc.constantFrom("review-code" as const, "review-doc" as const),
	verdict: mostly<Review["verdict"]>("passed", "failed", "missing"),
});
/** One or two kinds of review, or none read. */
const reviews: fc.Arbitrary<ShipFacts["reviews"]> = fc.oneof(
	{
		weight: 9,
		arbitrary: fc
			.tuple(review, fc.array(review, {maxLength: 1}))
			.map(([first, rest]): readonly [Review, ...Review[]] => [first, ...rest]),
	},
	{weight: 1, arbitrary: fc.constant(null)},
);

/** What a read may answer, field by field, each mostly the value that lets a merge on. */
export const facts: fc.Arbitrary<ShipFacts> = fc
	.record({
		head: heads,
		state: mostly<ShipFacts["state"]>("open", "merged", "closed", "draft"),
		ours: mostly(true, false),
		ticket: mostly<ShipFacts["ticket"]>(CLOSES, PART, "none"),
		approval: mostly<ShipFacts["approval"]>("not_needed", "given", "missing", "unknown"),
		reviews,
		checks: mostly<ShipFacts["checks"]>("green", "red", "pending", "stuck"),
		mergeable: mostly<ShipFacts["mergeable"]>("clean", "conflicts", "unknown"),
		comments: mostly<ShipFacts["comments"]>([], [{id: "c", by: "person"}], [{id: "c", by: "bot"}]),
		criteria: mostly<ShipFacts["criteria"]>(CRITERIA, null),
		proof: mostly<ProofKind>("met", "failed", "other_head", "old_version"),
	})
	.map(({proof, ...f}) => ({
		...f,
		main: ON_TIP,
		verdicts: f.criteria === null ? [] : rowsFor(f.head, proof),
	}));

// The Cmds an answer answers. The machine sends them; here they are made again from the head
// alone, the way the machine makes them, because a list of Msgs is drawn before it is folded.
const reads = readShipFacts({pr: PR});
const rerunOf = (head: string) =>
	rerunChecks({pr: PR, head, intent: intentOf("ship", PR, "rerun", head)});
const enqueueOf = (head: string) =>
	enqueue({ready: readyAt(PR, head), intent: intentOf("ship", PR, "enqueue", head)});
const mergeOf = (head: string) =>
	merge({ready: readyAt(PR, head), intent: intentOf("ship", PR, "merge", head)});
const finishOf = (head: string) => finish({pr: PR, intent: intentOf("ship", PR, "finish", head)});

const pr = fc.constant(PR);
type QueueMsg = Extract<ShipMsg, {readonly type: "ship_queue"}>;
/** One entry per Msg type: leaving one out does not compile. */
export const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {pr}),
	resume: arbConstantMsg("resume"),
	ship_facts_ok: facts.map((f) => readShipFacts.ok(reads, f, 0)),
	ship_facts_err: fc.constant(readShipFacts.err(reads, UNKNOWN, 0)),
	ship_rerun_checks_ok: heads.map((h) => rerunChecks.ok(rerunOf(h), [{run: 1, attempt: 1}], 0)),
	ship_rerun_checks_err: heads.map((h) => rerunChecks.err(rerunOf(h), UNKNOWN, 0)),
	ship_checks: arbRecordMsg("ship_checks", {pr, head: heads}),
	ship_checks_overdue: arbRecordMsg("ship_checks_overdue", {
		pr,
		head: heads,
		wait: fc.integer({min: 0, max: MAX_WAITS}),
	}),
	ship_enqueue_ok: fc
		.tuple(heads, fc.constantFrom("queued", "head_moved", "conflicts", "no_queue", "stale"))
		.map(([h, v]) => enqueue.ok(enqueueOf(h), v, 0)),
	ship_enqueue_err: heads.map((h) => enqueue.err(enqueueOf(h), UNKNOWN, 0)),
	ship_merge_ok: fc
		.tuple(heads, fc.constantFrom("merged", "head_moved", "conflicts", "stale", "behind"))
		.map(([h, reading]) =>
			merge.ok(mergeOf(h), reading === "merged" ? {reading, commit: `main-${h}`} : {reading}, 0),
		),
	ship_merge_err: heads.map((h) => merge.err(mergeOf(h), UNKNOWN, 0)),
	ship_queue: fc.oneof(
		heads.map((h): QueueMsg => ({
			type: "ship_queue",
			pr: PR,
			head: h,
			reading: "landed",
			commit: `main-${h}`,
		})),
		heads.map((h): QueueMsg => ({type: "ship_queue", pr: PR, head: h, reading: "ejected"})),
	),
	ship_queue_overdue: arbRecordMsg("ship_queue_overdue", {pr, head: heads}),
	ship_finish_ok: heads.map((h) => finish.ok(finishOf(h), null, 0)),
	ship_finish_err: heads.map((h) => finish.err(finishOf(h), UNKNOWN, 0)),
};

// ---------------------------------------------------------------- steering

/**
 * How often each Msg type is drawn. A read's answer most, since every path goes through one; then
 * the answers to the writes, which only fit half the time (two heads); `start` twice, since
 * nothing happens before it.
 */
export const WEIGHTS: Partial<Record<Msg["type"], number>> = {
	start: 2,
	ship_facts_ok: 4,
	ship_checks: 2,
	ship_enqueue_ok: 3,
	ship_merge_ok: 3,
	ship_queue: 2,
};
/** As long as experiment 118's walk of the ship machine. */
export const LENGTH = 60;
/**
 * The lists of Msgs. Not tea's `arbMsgSequence`: it takes no `size`, and at fast-check's default
 * size a list with `maxLength: 60` is drawn about ten long, so most runs never get past a read.
 */
export const msgs: fc.Arbitrary<readonly Msg[]> = fc.array(arbMsg(table, {weights: WEIGHTS}), {
	maxLength: LENGTH,
	size: "max",
});

/** What the generator reaches on the real machine, counted over `numRuns` lists. */
export interface Reach {
	readonly runs: number;
	readonly steps: number;
	/** Msgs drawn, by type. */
	readonly sent: Readonly<Record<string, number>>;
	/** Of those, the ones the machine acted on: its state changed or it sent a Cmd. */
	readonly acted: Readonly<Record<string, number>>;
	/** Runs that reached each phase. */
	readonly phases: Readonly<Record<string, number>>;
	/** Runs that ended, by outcome. */
	readonly outcomes: Readonly<Record<string, number>>;
}

/** Hughes's rule: count what the inputs reach before trusting a pass. */
export function reach(numRuns: number, seed: number): Reach {
	const sent: Record<string, number> = {};
	const acted: Record<string, number> = {};
	const phases: Record<string, number> = {};
	const outcomes: Record<string, number> = {};
	const add = (to: Record<string, number>, key: string) => {
		to[key] = (to[key] ?? 0) + 1;
	};
	let steps = 0;
	for (const list of fc.sample(msgs, {numRuns, seed})) {
		const run = foldEvents(ship, undefined, null, list);
		const seen = new Set<string>(["idle"]);
		for (const s of run.steps) {
			steps++;
			add(sent, s.msg.type);
			if (s.cmds.length > 0 || JSON.stringify(s.prev) !== JSON.stringify(s.next))
				add(acted, s.msg.type);
			seen.add(s.next.phase);
		}
		for (const p of seen) add(phases, p);
		if (run.finalState.phase === "over") add(outcomes, nameOf(run.finalState.outcome));
	}
	return {runs: numRuns, steps, sent, acted, phases, outcomes};
}

// ---------------------------------------------------------------- the laws

/** A law said no. `why` is in words. */
export class Broke {
	readonly why: string;
	constructor(why: string) {
		this.why = why;
	}
}
const broke = (why: string): Broke => new Broke(why);

/**
 * A law. `each`: it looks at one step at a time (a `propertyInvariant`). `along`: it remembers
 * something along the run (a `propertyTrace`); `null`, it held.
 */
export type Law =
	| {readonly name: string; readonly each: (step: ShipStep) => string | null}
	| {
			readonly name: string;
			readonly along: (steps: readonly ShipStep[]) => {
				readonly at: number;
				readonly why: string;
			} | null;
	  };

const each = (name: string, check: (step: ShipStep) => string | null): Law => ({name, each: check});
/** A law that remembers: the memory before and one step in, the memory after, or what broke. */
function along<W>(name: string, start: W, step: (memory: W, step: ShipStep) => W | Broke): Law {
	return {
		name,
		along: (steps) => {
			let memory = start;
			for (const [at, s] of steps.entries()) {
				const after = step(memory, s);
				if (after instanceof Broke) return {at, why: after.why};
				memory = after;
			}
			return null;
		},
	};
}

/** Thrown inside a property when a law breaks, so fast-check reports the law's reason. */
export class LawBroken extends Error {
	readonly law: string;
	readonly why: string;
	/** The run up to the break, when the law saw all of it. */
	readonly steps: readonly ShipStep[];
	constructor(law: string, why: string, steps: readonly ShipStep[]) {
		super(`${law}: ${why}`);
		this.law = law;
		this.why = why;
		this.steps = steps;
	}
}

const writes = (cmds: readonly ShipCmd[]) =>
	cmds.flatMap((c) => (c.type === "ship_enqueue" || c.type === "ship_merge" ? [c] : []));

/** Every review row passed. Worked out here, not with the gate's own helper, so a slip there shows. */
const allPassed = (reviews: ShipFacts["reviews"]): boolean =>
	reviews?.every((k) => k.verdict === "passed") ?? false;

/** The latest row on its current version at the read's head, per criterion (`null`: none). */
const latest = (f: ShipFacts, criteria: readonly NonNullable<ShipFacts["criteria"]>[number][]) =>
	criteria.map(
		(c) =>
			f.verdicts.findLast(
				(v) => v.criterion === c.id && v.version === c.version && v.head === f.head,
			) ?? null,
	);

/** Each criterion with no passing row on its current version at its head, in words. */
function unproven(f: ShipFacts): readonly string[] {
	if (f.criteria === null) return ["the criteria are unread"];
	const rows = latest(f, f.criteria);
	return f.criteria.flatMap((c, i) =>
		rows[i]?.grade === "pass" ? [] : [`${c.id} v${c.version} is not met at ${f.head}`],
	);
}

/** What keeps facts from being ready to merge, in words. Empty: ready. */
export function notReady(f: ShipFacts): readonly string[] {
	const why: string[] = [];
	if (f.state !== "open") why.push(`it is ${f.state}`);
	if (!f.ours) why.push("it is not ours");
	if (f.reviews === null) why.push("the reviews owed are unread");
	for (const k of f.reviews ?? [])
		if (k.verdict !== "passed") why.push(`${k.kind} is ${k.verdict}`);
	if (f.checks !== "green") why.push(`checks are ${f.checks}`);
	if (f.mergeable !== "clean") why.push(`mergeable is ${f.mergeable}`);
	if (f.comments.length > 0) why.push("a comment is open");
	if (f.approval === "missing" || f.approval === "unknown") why.push(`approval is ${f.approval}`);
	why.push(...unproven(f));
	return why;
}

/** What a proof must match, from one read: its head, its checks, its criteria, their rows. */
interface Wanted {
	readonly head: string;
	readonly checks: ShipFacts["checks"];
	readonly criteria: ShipFacts["criteria"];
	readonly rows: readonly (VerdictRow | null)[];
}
const wantedOf = (f: ShipFacts): Wanted => ({
	head: f.head,
	checks: f.checks,
	criteria: f.criteria,
	rows: latest(f, f.criteria ?? []),
});

/** Why a write's proof is not the last read's, in words. `null`: it is. */
function proofNotOf(ready: ReadyToMerge, read: Wanted): string | null {
	if (ReadyToMerge.revive(ready) === null) return "its proof does not prove its own criteria";
	if (read.criteria === null) return "the last read held no criteria";
	if (ready.head !== read.head)
		return `its proof is at ${ready.head}, the last read at ${read.head}`;
	if (read.checks !== "green") return `the checks at ${read.head} are ${read.checks}`;
	if (ready.criteria.length !== read.criteria.length)
		return `its proof holds ${ready.criteria.length} criteria, the last read ${read.criteria.length}`;
	for (const [i, c] of read.criteria.entries()) {
		const held = ready.criteria.find((k) => k.id === c.id);
		if (held === undefined || held.version !== c.version || held.text !== c.text)
			return `its proof does not hold ${c.id} as v${c.version}`;
		const carried = ready.rows.find((r) => r.criterion === c.id);
		const found = read.rows[i] ?? null;
		if (carried === undefined || found === null || found.grade !== "pass")
			return `${c.id} v${c.version} has no passing row at ${read.head}`;
		if (JSON.stringify(carried) !== JSON.stringify(found))
			return `its row for ${c.id} is not the one the last read found`;
	}
	return null;
}

/** The read this step brings, if the machine was waiting for it. `null`: none. */
const readIn = (step: ShipStep): ShipFacts | null =>
	step.msg.type === "ship_facts_ok" && step.prev.phase === "reading" ? step.msg.value : null;

/** The step that makes a run land: into `finishing`, or straight to a merged end. */
const landsOn = (step: ShipStep): boolean =>
	(step.next.phase === "finishing" && step.prev.phase !== "finishing") ||
	(step.next.phase === "over" &&
		step.next.outcome.kind === "done" &&
		step.prev.phase !== "over" &&
		step.prev.phase !== "finishing");

/** The head a landing step names, if any. */
const landedHead = ({msg}: ShipStep): string | null =>
	msg.type === "ship_queue" && msg.reading === "landed"
		? msg.head
		: msg.type === "ship_merge_ok" && msg.value.reading === "merged"
			? msg.cmd.ready.head
			: null;

/** "Only the head that was sent to the queue lands", from the heads already sent. */
const onlySentLands = (sent: readonly string[], step: ShipStep): readonly string[] | Broke => {
	const now = [...new Set([...sent, ...writes(step.cmds).map((c) => c.ready.head)])].sort();
	if (!landsOn(step)) return now;
	// A pull request found already merged by a read is not this run's landing.
	if (step.msg.type === "ship_facts_ok") return now;
	const head = landedHead(step);
	if (head === null || !sent.includes(head))
		return broke(
			`landed ${head ?? "on a Msg that names no head"}, and the heads sent were ${sent.join(", ") || "none"}`,
		);
	return now;
};

const endedSendsNothing = (step: ShipStep): string | null =>
	step.prev.phase === "over" && step.cmds.length > 0
		? `${step.cmds.map((c) => c.type).join(", ")} after the run ended`
		: null;

/** The five laws of `./ship.ts`, moved as they are. Run 1. */
export const TODAY: readonly Law[] = [
	along<{readonly head: string; readonly why: readonly string[]} | null>(
		"merge only when the last read shows it ready",
		null,
		(memory, step) => {
			const facts = readIn(step);
			const read = facts === null ? memory : {head: facts.head, why: notReady(facts)};
			for (const cmd of writes(step.cmds)) {
				if (read === null) return broke(`${cmd.type} with no read before it`);
				const head = cmd.ready.head;
				if (read.why.length > 0)
					return broke(`${cmd.type} of ${head}, and the last read says ${read.why.join(", ")}`);
				if (head !== read.head)
					return broke(`${cmd.type} of ${head}, and the last read was at ${read.head}`);
			}
			return read;
		},
	),
	along<Wanted | null>(
		"a merge carries a passing row per criterion, on its current version, at its head",
		null,
		(memory, step) => {
			const facts = readIn(step);
			const read = facts === null ? memory : wantedOf(facts);
			for (const cmd of writes(step.cmds)) {
				if (read === null) return broke(`${cmd.type} with no read before it`);
				const why = proofNotOf(cmd.ready, read);
				if (why !== null) return broke(`${cmd.type}: ${why}`);
			}
			return read;
		},
	),
	along<{readonly head: string; readonly passed: boolean} | null>(
		"a review pass for another head never counts",
		null,
		(memory, step) => {
			const facts = readIn(step);
			const read = facts === null ? memory : {head: facts.head, passed: allPassed(facts.reviews)};
			for (const cmd of writes(step.cmds))
				if (read === null || read.head !== cmd.ready.head || !read.passed)
					return broke(
						`${cmd.type} of ${cmd.ready.head}, and the last read ${read === null ? "never happened" : `said reviews ${read.passed ? "passed" : "not passed"} at ${read.head}`}`,
					);
			return read;
		},
	),
	along<readonly string[]>("only the head that was sent to the queue lands", [], onlySentLands),
	each("an ended run sends nothing", endedSendsNothing),
];

// ---------------------------------------------------------------- the two new laws

/** The landing the last read that said go would give, and the commit it landed as. */
interface Expect {
	readonly landing: Landing;
	readonly commit: string | null;
}

const stuck = (why: Extract<ShipOutcome, {kind: "stuck"}>["why"]): ShipOutcome => ({
	kind: "stuck",
	why,
});
const send = (why: Extract<ShipOutcome, {kind: "send"; to: "builder"}>["why"]): ShipOutcome => ({
	kind: "send",
	to: "builder",
	why,
});
const landingOf = (f: ShipFacts): Landing =>
	f.ticket !== "none" && f.ticket.link === "part_of_it" ? "part" : "whole";
const done = (landing: Landing, commit: string, cleanup: "done" | "failed" | "not_run") => ({
	kind: "done" as const,
	part: landing === "part",
	commit,
	cleanup,
});

/**
 * What a read in `reading` calls for, worked out here line by line in the gate's order, not with
 * the gate: an end, or `go` on to the enqueue with its landing, or `on` (wait, or run the red
 * checks again).
 */
function readCalls(
	s: Extract<Ship, {phase: "reading"}>,
	f: ShipFacts,
): ShipOutcome | {readonly go: Landing} | "on" {
	if (f.state === "merged") return done(landingOf(f), f.head, "not_run");
	if (f.state !== "open") return {kind: "skip", why: f.state};
	if (!f.ours) return {kind: "skip", why: "not_ours"};
	if (f.mergeable === "conflicts") return send("conflicts");
	if (f.reviews === null) return stuck("reviews_unknown");
	if (f.reviews.some((k) => k.verdict === "failed")) return send("review_failed");
	if (f.reviews.some((k) => k.verdict === "missing"))
		return {kind: "send", to: "reviewer", why: "no_review"};
	if (f.criteria === null) return stuck("criteria_unknown");
	const rows = latest(f, f.criteria);
	if (rows.some((r) => r?.grade === "fail")) return send("review_failed");
	if (rows.some((r) => r === null)) return {kind: "send", to: "reviewer", why: "no_review"};
	if (f.checks === "red") return s.rerunFor === f.head ? send("checks_red") : "on";
	if (f.comments.some((c) => c.by === "person"))
		return {kind: "ask", who: "commenter", for: "comment"};
	if (f.comments.length > 0) return send("bot_comment");
	if (f.approval === "missing") return {kind: "ask", who: "owner", for: "approval"};
	if (f.approval === "unknown") return stuck("approval_unknown");
	if (f.checks === "pending") return s.waited >= MAX_WAITS ? stuck("checks_stuck") : "on";
	if (f.checks === "stuck") return stuck("checks_stuck");
	if (f.mergeable === "unknown") return stuck("merge_unknown");
	return {go: landingOf(f)};
}

/** Moved under a write: read again, unless it has moved too often. */
const movedCalls = (s: {readonly moves: number}): ShipOutcome | null =>
	s.moves >= MAX_MOVES ? stuck("head_moving") : null;

/**
 * The outcome this step must end the run with, or `null`: it must not end it. Only a Msg the
 * phase waits for, answering what it asked, may end a run.
 */
function calls(prev: Ship, msg: Msg, memory: Expect): ShipOutcome | null {
	switch (prev.phase) {
		case "idle":
		case "over":
			return null;
		case "reading": {
			if (msg.type === "ship_facts_err") return stuck("read_failed");
			if (msg.type !== "ship_facts_ok") return null;
			const called = readCalls(prev, msg.value);
			return called === "on" || "go" in called ? null : called;
		}
		case "rerunning":
			if (msg.type === "ship_rerun_checks_ok" && msg.cmd.intent === prev.asked.intent)
				return prev.waited >= MAX_WAITS ? stuck("checks_stuck") : null;
			if (msg.type === "ship_rerun_checks_err" && msg.cmd.intent === prev.asked.intent)
				return send("checks_red");
			return null;
		case "waiting":
			return msg.type === "ship_checks_overdue" &&
				msg.pr === prev.pr &&
				msg.head === prev.head &&
				msg.wait === prev.waited
				? stuck("checks_stuck")
				: null;
		case "enqueueing":
			if (msg.type === "ship_enqueue_err" && msg.cmd.intent === prev.asked.intent)
				return stuck("enqueue_failed");
			if (msg.type !== "ship_enqueue_ok" || msg.cmd.intent !== prev.asked.intent) return null;
			if (msg.value === "conflicts") return send("conflicts");
			return msg.value === "head_moved" || msg.value === "stale" ? movedCalls(prev) : null;
		case "merging":
			if (msg.type === "ship_merge_err" && msg.cmd.intent === prev.asked.intent)
				return stuck("merge_failed");
			if (msg.type !== "ship_merge_ok" || msg.cmd.intent !== prev.asked.intent) return null;
			switch (msg.value.reading) {
				case "merged":
					return null;
				case "conflicts":
					return send("conflicts");
				case "behind":
					return send("behind");
				case "head_moved":
				case "stale":
					return movedCalls(prev);
			}
			break;
		case "queued": {
			const here =
				"pr" in msg && msg.pr === prev.pr && "head" in msg && msg.head === prev.ready.head;
			if (!here) return null;
			if (msg.type === "ship_queue_overdue") return stuck("queue_silent");
			return msg.type === "ship_queue" && msg.reading === "ejected" ? send("ejected") : null;
		}
		case "finishing":
			if (memory.commit === null) return null;
			if (msg.type === "ship_finish_ok") return done(memory.landing, memory.commit, "done");
			if (msg.type === "ship_finish_err") return done(memory.landing, memory.commit, "failed");
			return null;
	}
}

/** What the law remembers after a step: the landing a go gave, the commit it landed as. */
function remember(memory: Expect, {prev, msg}: ShipStep): Expect {
	if (prev.phase === "reading" && msg.type === "ship_facts_ok") {
		const called = readCalls(prev, msg.value);
		return typeof called === "object" && "go" in called
			? {landing: called.go, commit: null}
			: memory;
	}
	if (prev.phase === "queued" && msg.type === "ship_queue" && msg.reading === "landed")
		return msg.pr === prev.pr && msg.head === prev.ready.head
			? {...memory, commit: msg.commit}
			: memory;
	if (
		prev.phase === "merging" &&
		msg.type === "ship_merge_ok" &&
		msg.cmd.intent === prev.asked.intent &&
		msg.value.reading === "merged"
	)
		return {...memory, commit: msg.value.commit};
	return memory;
}

/** An outcome in words, with a done's commit and tidy-up. */
const said = (o: ShipOutcome): string =>
	o.kind === "done" ? `${nameOf(o)} as ${o.commit}, cleanup ${o.cleanup}` : nameOf(o);

/** Which outcome a run gives: the one the step that ends it calls for, and no step ends it early. */
const givesItsOutcome = along<Expect>(
	"a run ends with the outcome its last step calls for",
	{landing: "whole", commit: null},
	(memory, step) => {
		const {prev, msg, next} = step;
		if (prev.phase === "over")
			return next.phase === "over" && said(next.outcome) === said(prev.outcome)
				? memory
				: broke(`an ended run changed: ${said(prev.outcome)}, then ${next.phase}`);
		const wanted = calls(prev, msg, memory);
		const got = next.phase === "over" ? said(next.outcome) : null;
		if (wanted === null && got !== null)
			return broke(`${msg.type} in ${prev.phase} ended it ${got}; it should not end it`);
		if (wanted !== null && got !== said(wanted))
			return broke(
				`${msg.type} in ${prev.phase} should end it ${said(wanted)}; it ${got === null ? `went to ${next.phase}` : `ended ${got}`}`,
			);
		const after = remember(memory, step);
		// The tidy-up's outcome names the commit it landed as: a run tidying up after no landing has none.
		if (next.phase === "finishing" && prev.phase !== "finishing" && after.commit === null)
			return broke(`${msg.type} in ${prev.phase} went on to the tidy-up, and nothing landed`);
		return after;
	},
);

/** Msgs that change nothing on the way of a ready pull request: none is for the phase it is in. */
const NOISE = [
	"start",
	"resume",
	"checks",
	"checks_overdue",
	"rerun_ok",
	"rerun_err",
	"queue_other",
	"queue_overdue_other",
	"enqueue_other",
	"merge_other",
] as const;
type Noise = (typeof NOISE)[number];
const noiseOf = (kind: Noise, head: string): Msg => {
	const other = head === "A" ? "B" : "A";
	switch (kind) {
		case "start":
			return {type: "start", pr: PR};
		case "resume":
			return {type: "resume"};
		case "checks":
			return {type: "ship_checks", pr: PR, head};
		case "checks_overdue":
			return {type: "ship_checks_overdue", pr: PR, head, wait: 1};
		case "rerun_ok":
			return rerunChecks.ok(rerunOf(head), [{run: 1, attempt: 1}], 0);
		case "rerun_err":
			return rerunChecks.err(rerunOf(head), UNKNOWN, 0);
		case "queue_other":
			return {type: "ship_queue", pr: PR, head: other, reading: "landed", commit: `main-${other}`};
		case "queue_overdue_other":
			return {type: "ship_queue_overdue", pr: PR, head: other};
		case "enqueue_other":
			return enqueue.ok(enqueueOf(other), "conflicts", 0);
		case "merge_other":
			return merge.ok(mergeOf(other), {reading: "conflicts"}, 0);
	}
};

/** A read that lets a merge on: every line of the gate clear, the rows met at its head. */
export const ready: fc.Arbitrary<ShipFacts> = fc
	.record({
		head: heads,
		ticket: fc.constantFrom(CLOSES, PART),
		approval: fc.constantFrom<ShipFacts["approval"]>("not_needed", "given"),
		kinds: fc.subarray<Review["kind"]>(["review-doc", "review-skill"]),
		// Older rows first: a fail at another head, or on the old words, does not count.
		before: fc.subarray([rowOn(C2, "Z", "fail"), rowOn(C2, "A", "fail", 1)]),
	})
	.map(({head, ticket, approval, kinds, before}): ShipFacts => ({
		head,
		state: "open",
		ours: true,
		ticket,
		approval,
		reviews: [
			{kind: "review-code", verdict: "passed"},
			...kinds.map((kind) => ({kind, verdict: "passed" as const})),
		],
		checks: "green",
		mergeable: "clean",
		comments: [],
		main: ON_TIP,
		criteria: CRITERIA,
		verdicts: filed([...before, rowOn(C1, head), rowOn(C2, head)]),
	}));

/** A ready pull request's run: which way it lands, how the tidy-up goes, and noise between. */
export const readyRuns = fc.record({
	facts: ready,
	queue: fc.boolean(),
	tidy: fc.boolean(),
	noise: fc.array(fc.array(fc.constantFrom(...NOISE), {maxLength: 3}), {
		minLength: 5,
		maxLength: 5,
	}),
});
export type ReadyRun = typeof readyRuns extends fc.Arbitrary<infer T> ? T : never;

/**
 * One ready run, folded. Each answer answers the Cmd the machine really sent: a list drawn before
 * the fold cannot, and tea's `arbGuidedSequence`, which would, is not built yet. `null`: it landed
 * as it should.
 */
export function landsWhenReady<S extends Ship, U extends Sub>(
	machine: ShipLike<S, U>,
	run: ReadyRun,
): string | null {
	const head = run.facts.head;
	let [state] = machine.init(null, undefined);
	const sent: ShipCmd[] = [];
	const step = (m: Msg) => {
		const [next, cmds] = applyCell<S, Msg, ShipCmd>(machine, state, m);
		state = next;
		sent.push(...cmds);
	};
	const noise = (i: number) => {
		for (const kind of run.noise[i] ?? []) step(noiseOf(kind, head));
	};
	step({type: "start", pr: PR});
	noise(0);
	const read = sent.findLast((c) => c.type === "ship_facts");
	if (read?.type !== "ship_facts") return "it never read";
	step(readShipFacts.ok(read, run.facts, 0));
	noise(1);
	const queued = sent.findLast((c) => c.type === "ship_enqueue");
	if (queued?.type !== "ship_enqueue") return `a ready read at ${head} sent no enqueue`;
	if (run.queue) {
		step(enqueue.ok(queued, "queued", 0));
		noise(2);
		step({type: "ship_queue", pr: PR, head, reading: "landed", commit: `main-${head}`});
	} else {
		step(enqueue.ok(queued, "no_queue", 0));
		noise(2);
		const merged = sent.findLast((c) => c.type === "ship_merge");
		if (merged?.type !== "ship_merge") return "no merge queue, and it sent no merge";
		step(merge.ok(merged, {reading: "merged", commit: `main-${head}`}, 0));
	}
	noise(3);
	const tidy = sent.findLast((c) => c.type === "ship_finish");
	if (tidy?.type !== "ship_finish") return "it landed and sent no tidy-up";
	step(run.tidy ? finish.ok(tidy, null, 0) : finish.err(tidy, UNKNOWN, 0));
	noise(4);
	const wanted = said(done(landingOf(run.facts), `main-${head}`, run.tidy ? "done" : "failed"));
	const got = state.phase === "over" ? said(state.outcome) : `still ${state.phase}`;
	return got === wanted ? null : `a ready run at ${head} should end ${wanted}; it ${got}`;
}

// ---------------------------------------------------------------- a run from a saved state

const TAMPER = ["none", "moved", "short"] as const;
/** A kept proof, as it was or edited in storage: moved to another head, or a row dropped. */
const proofOf = (head: string, tamper: (typeof TAMPER)[number]): ReadyToMerge => {
	const r = readyAt(PR, head);
	if (tamper === "moved") return {...r, head: head === "A" ? "B" : "A"};
	if (tamper === "short") return {...r, rows: [r.rows[0]]};
	return r;
};
const PHASES = [
	"reading",
	"rerunning",
	"waiting",
	"enqueueing",
	"merging",
	"queued",
	"finishing",
	"over",
] as const;

/**
 * A state as storage may hand it back: any phase, its counts anywhere in range, its proofs as kept
 * or edited, and the Cmd in flight for its own head or, unless `agree`, for the other. Read back
 * through JSON, as a store reads it.
 */
export const savedState = (agree: boolean): fc.Arbitrary<Ship> =>
	fc
		.record({
			phase: fc.constantFrom(...PHASES),
			moves: fc.integer({min: 0, max: MAX_MOVES}),
			waited: fc.integer({min: 0, max: MAX_WAITS}),
			rerunFor: fc.constantFrom(null, ...HEADS),
			head: heads,
			asks: agree ? fc.constant(null) : heads,
			tamper: fc.constantFrom(...TAMPER),
			landing: fc.constantFrom<Landing>("whole", "part"),
		})
		.map(({phase, moves, waited, rerunFor, head, asks: other, tamper, landing}): Ship => {
			const asks = other ?? head;
			const sofar = {pr: PR, waits: DEFAULT_WAITS, moves, rerunFor, waited};
			const ready = proofOf(head, tamper);
			const kept = ((): Ship => {
				switch (phase) {
					case "reading":
						return {...sofar, phase, asked: reads};
					case "rerunning":
						return {...sofar, phase, head, asked: rerunOf(head)};
					case "waiting":
						return {...sofar, phase, head, after: []};
					case "enqueueing":
						return {...sofar, phase, ready, landing, asked: enqueueOf(asks)};
					case "merging":
						return {...sofar, phase, ready, landing, asked: mergeOf(asks)};
					case "queued":
						return {pr: PR, waits: DEFAULT_WAITS, phase, ready, landing};
					case "finishing":
						return {
							pr: PR,
							waits: DEFAULT_WAITS,
							phase,
							commit: `main-${head}`,
							landing,
							asked: finishOf(head),
						};
					case "over":
						return {pr: PR, waits: DEFAULT_WAITS, phase, outcome: stuck("read_failed")};
				}
			})();
			return JSON.parse(JSON.stringify(kept));
		});
/** Any saved state: the Cmd in flight may name the other head. */
export const saved = savedState(false);

/** The proofs a kept state holds: its own, and the one in the Cmd in flight. */
const proofsIn = (s: Ship): readonly ReadyToMerge[] =>
	s.phase === "enqueueing" || s.phase === "merging"
		? [s.ready, s.asked.ready]
		: s.phase === "queued"
			? [s.ready]
			: [];

/**
 * A run from a saved state, in words. `null`: it held. A kept proof that no longer proves its
 * criteria ends the run at once; no write leaves with a proof that does not prove its own; an ended
 * run sends nothing; only a head that was sent lands. The laws that need the last read are not
 * asked: a run read back from storage has no read of its own yet.
 */
export function fromSaved(kept: Ship, list: readonly Msg[]): string | null {
	const run = foldEvents(ship, undefined, kept, list);
	const first = run.states[0];
	const refused = proofsIn(kept).some((p) => ReadyToMerge.revive(p) === null);
	if (refused && (first?.phase !== "over" || nameOf(first.outcome) !== "stuck:proof_refused"))
		return `a kept proof that does not prove its criteria was read back as ${first?.phase}`;
	// The heads this run sent before it was saved: the write in flight, or the head in the queue.
	let sent: readonly string[] =
		kept.phase === "enqueueing" || kept.phase === "merging"
			? [kept.asked.ready.head]
			: kept.phase === "queued"
				? [kept.ready.head]
				: [];
	for (const step of run.steps) {
		for (const cmd of writes(step.cmds))
			if (ReadyToMerge.revive(cmd.ready) === null)
				return `${cmd.type} of ${cmd.ready.head} with a proof that does not prove its criteria`;
		const ended = endedSendsNothing(step);
		if (ended !== null) return ended;
		const after = onlySentLands(sent, step);
		if (after instanceof Broke) return `${after.why}, after ${step.msg.type}`;
		sent = after;
	}
	return null;
}

// ---------------------------------------------------------------- the properties

export interface Opts {
	readonly numRuns: number;
	readonly seed: number;
}

/** One law as a property on `machine`. It throws `LawBroken` when the law breaks. */
export function holds<S extends Ship, U extends Sub>(
	machine: ShipLike<S, U>,
	law: Law,
	opts: Opts,
	list: fc.Arbitrary<readonly Msg[]> = msgs,
): void {
	if ("each" in law)
		propertyInvariant(
			machine,
			undefined,
			list,
			(step) => {
				const why = law.each(step);
				if (why !== null) throw new LawBroken(law.name, why, [step]);
				return true;
			},
			opts,
		);
	else
		propertyTrace(
			machine,
			undefined,
			list,
			(steps) => {
				const broken = law.along(steps);
				if (broken !== null)
					throw new LawBroken(law.name, broken.why, steps.slice(0, broken.at + 1));
				return true;
			},
			opts,
		);
}

const LANDS = "a ready pull request lands";
/** "A ready pull request lands", as a property on `machine`. fast-check's own: see `landsWhenReady`. */
export function lands<S extends Ship, U extends Sub>(machine: ShipLike<S, U>, opts: Opts): void {
	fc.assert(
		fc.property(readyRuns, (run) => {
			const why = landsWhenReady(machine, run);
			if (why !== null) throw new LawBroken(LANDS, why, []);
		}),
		opts,
	);
}

export const SAVED = "a run from a saved state";
/**
 * The run from a saved state, on the real machine. fast-check's own: in tea's runners `loaded` is
 * one value. `agree` keeps the Cmd in flight on the state's own head.
 */
export function fromSavedState(opts: Opts, agree = false): void {
	fc.assert(
		fc.property(savedState(agree), msgs, (kept, list) => {
			const why = fromSaved(kept, list);
			if (why !== null) throw new LawBroken(SAVED, why, []);
		}),
		opts,
	);
}

/** One property: a name, and how to run it on a machine. It throws when it breaks. */
export interface Property {
	readonly name: string;
	readonly run: <S extends Ship, U extends Sub>(machine: ShipLike<S, U>, opts: Opts) => void;
}
const lawProperty = (law: Law): Property => ({
	name: law.name,
	run: (machine, opts) => holds(machine, law, opts),
});

/** Run 1: today's five laws, moved as they are. */
export const RUN_1: readonly Property[] = TODAY.map(lawProperty);
/** New: which outcome a run gives. */
export const GIVES_ITS_OUTCOME: Property = lawProperty(givesItsOutcome);
/** New: a ready pull request lands. */
export const LANDS_WHEN_READY: Property = {name: LANDS, run: lands};
/** The two laws experiment 119 found missing. Run 2 is these with `RUN_1`. */
export const NEW: readonly Property[] = [GIVES_ITS_OUTCOME, LANDS_WHEN_READY];
export const RUN_2: readonly Property[] = [...RUN_1, ...NEW];
