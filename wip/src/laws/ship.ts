import type {Row as BookRow} from "../criteria/book.ts";
import {criterionId} from "../ids.ts";
import type {ShipFacts} from "../stages/ship/facts.ts";
import {
	enqueue,
	finish,
	merge,
	readShipFacts,
	rerunChecks,
	type Ship,
	type ShipCmd,
	ship,
} from "../stages/ship/machine.ts";
import {ReadyToMerge} from "../stages/ship/ready.ts";
import {filed} from "../stages/ship/scripted.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	type Step,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The ship machine under every order of messages: its world, its laws, and
// one planted mistake per law.
//
// What the machine reads is `reviews`, one row per kind of review owed at the
// head, `checks`, and the ticket's criteria with every verdict row kept on
// them. "Every criterion met at the current head" is asked of it twice: the
// last read showed every review row passed and, for every criterion, a
// passing row on its current version at that head, with the checks green
// there; and the enqueue or merge it sends carries exactly those rows.

/** Every Msg the ship machine takes: its own, and the answer to each Cmd. */
export type AnyShipMsg = MsgOf<typeof ship>;
type Msg = AnyShipMsg;
const shipUpdate = stepOf<Ship, AnyShipMsg, ShipCmd>(ship);

export const PR = "P";
export const HEADS = ["A", "B"] as const;

/** The code review alone, with this verdict. */
const code = (verdict: "passed" | "failed" | "missing"): ShipFacts["reviews"] => [
	{kind: "review-code", verdict},
];

type Criteria = NonNullable<ShipFacts["criteria"]>;
type VerdictRow = ShipFacts["verdicts"][number];

const C1: Criteria[number] = {id: criterionId("c1"), version: 1, text: "every window opens"};
/** Reworded once: only a row on its version 2 counts. */
const C2: Criteria[number] = {
	id: criterionId("c2"),
	version: 2,
	text: "the door locks, from inside too",
};
const CRITERIA: Criteria = [C1, C2];
const row = (
	c: Criteria[number],
	head: string,
	grade: BookRow["grade"] = "pass",
	version = c.version,
): BookRow => ({criterion: c.id, version, head, grade, proof: `the review at ${head}`});
/** A passing verdict per criterion at `head`. */
const allMet = (head: string): readonly VerdictRow[] => filed(CRITERIA.map((c) => row(c, head)));

/**
 * The verdict rows a read may find at `head`, by what they say: all met, the
 * second failed, judged only at another head, or judged on its old words.
 */
const PROOFS = ["met", "failed", "other_head", "old_version"] as const;
type ProofKind = (typeof PROOFS)[number];
const rowsFor = (head: string, kind: ProofKind): readonly VerdictRow[] => {
	switch (kind) {
		case "met":
			return allMet(head);
		case "failed":
			return filed([row(C1, head), row(C2, head, "fail")]);
		case "other_head":
			return allMet(`${head}-before`);
		case "old_version":
			return filed([row(C1, head), row(C2, head, "pass", 1)]);
	}
};

const base: ShipFacts = {
	head: "A",
	state: "open",
	ours: true,
	ticket: {id: "o/r#1", link: "closes_it"},
	approval: "not_needed",
	reviews: code("passed"),
	checks: "green",
	mergeable: "clean",
	comments: [],
	criteria: CRITERIA,
	verdicts: allMet("A"),
};

/** Every review row passed. Worked out here, not with the gate's own helper, so a slip there shows. */
const allPassed = (reviews: ShipFacts["reviews"]): boolean =>
	reviews?.every((k) => k.verdict === "passed") ?? false;

/**
 * Each criterion of a read with no passing row on its current version at its
 * head, in words. Worked out here, not with `ReadyToMerge.of`, so a slip there
 * shows. The latest row on that version at that head is the one that counts.
 */
function unproven(f: ShipFacts): readonly string[] {
	if (f.criteria === null) return ["the criteria are unread"];
	return f.criteria.flatMap((c) => {
		const last = f.verdicts.findLast(
			(v) => v.criterion === c.id && v.version === c.version && v.head === f.head,
		);
		return last?.grade === "pass" ? [] : [`${c.id} v${c.version} is not met at ${f.head}`];
	});
}

/** The facts a read may answer, at one head. `narrow`: eleven profiles. `wide`: every field crossed. */
export function factsAt(head: string, size: "narrow" | "wide"): readonly ShipFacts[] {
	const at = (patch: Partial<ShipFacts>): ShipFacts => ({
		...base,
		head,
		verdicts: allMet(head),
		...patch,
	});
	if (size === "narrow")
		return [
			at({}),
			at({reviews: code("failed")}),
			// One kind passed, another failed: the gate must read every row.
			at({
				reviews: [
					{kind: "review-code", verdict: "passed"},
					{kind: "review-doc", verdict: "failed"},
				],
			}),
			at({reviews: code("missing")}),
			at({checks: "red"}),
			at({checks: "pending"}),
			at({state: "merged"}),
			// Every review passed, but one criterion is not proven at this head on its current words.
			at({verdicts: rowsFor(head, "failed")}),
			at({verdicts: rowsFor(head, "other_head")}),
			at({verdicts: rowsFor(head, "old_version")}),
			at({criteria: null, verdicts: []}),
		];
	const out: ShipFacts[] = [];
	// The proof crossed with the fields a merge also needs; each other field is crossed below with all met.
	for (const kind of PROOFS)
		for (const checks of ["green", "red", "pending"] as const)
			for (const mergeable of ["clean", "unknown"] as const)
				out.push(at({verdicts: rowsFor(head, kind), checks, mergeable}));
	for (const reviews of [code("passed"), code("failed"), code("missing"), null])
		for (const checks of ["green", "red", "pending", "stuck"] as const)
			for (const mergeable of ["clean", "conflicts", "unknown"] as const)
				for (const approval of ["not_needed", "missing", "unknown"] as const)
					for (const comments of [
						[],
						[{id: "c", by: "person" as const}],
						[{id: "c", by: "bot" as const}],
					])
						for (const state of ["open", "merged", "closed"] as const)
							for (const ours of [true, false])
								out.push(
									at({
										reviews,
										checks,
										mergeable,
										approval,
										comments,
										state,
										ours,
									}),
								);
	return out;
}

export interface ShipWorldOptions {
	readonly heads?: readonly string[];
	readonly facts?: "narrow" | "wide";
	readonly echoes?: boolean;
}

const UNKNOWN = {_tag: "unknown" as const};

export function shipWorld(options: ShipWorldOptions = {}): World<Ship, AnyShipMsg, ShipCmd> {
	const heads = options.heads ?? HEADS;
	const size = options.facts ?? "narrow";
	const facts = heads.flatMap((head) => factsAt(head, size));
	return {
		outside: (s) => {
			const waits = "waited" in s ? [s.waited, s.waited - 1] : [0];
			return [
				{type: "start", pr: PR},
				{type: "resume"},
				...heads.flatMap((head): Msg[] => [
					{type: "ship_checks", pr: PR, head},
					{type: "ship_queue", pr: PR, head, reading: "landed", commit: `main-${head}`},
					{type: "ship_queue", pr: PR, head, reading: "ejected"},
					{type: "ship_queue_overdue", pr: PR, head},
					...waits.map((wait): Msg => ({type: "ship_checks_overdue", pr: PR, head, wait})),
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "ship_facts":
					return [
						...facts.map((f) => readShipFacts.ok(cmd, f, 0)),
						readShipFacts.err(cmd, UNKNOWN, 0),
					];
				case "ship_rerun_checks":
					return [rerunChecks.ok(cmd, [{run: 1, attempt: 1}], 0), rerunChecks.err(cmd, UNKNOWN, 0)];
				case "ship_enqueue":
					return [
						...(["queued", "head_moved", "conflicts", "no_queue", "stale"] as const).map((v) =>
							enqueue.ok(cmd, v, 0),
						),
						enqueue.err(cmd, UNKNOWN, 0),
					];
				case "ship_merge":
					return [
						merge.ok(cmd, {reading: "merged", commit: `main-${cmd.ready.head}`}, 0),
						merge.ok(cmd, {reading: "head_moved"}, 0),
						merge.ok(cmd, {reading: "conflicts"}, 0),
						merge.ok(cmd, {reading: "stale"}, 0),
						merge.err(cmd, UNKNOWN, 0),
					];
				case "ship_finish":
					return [finish.ok(cmd, null, 0), finish.err(cmd, UNKNOWN, 0)];
			}
		},
		restart: (msg) => msg.type === "resume",
		...(options.echoes === undefined ? {} : {echoes: options.echoes}),
	};
}

const writes = (cmds: readonly ShipCmd[]) =>
	cmds.flatMap((c) => (c.type === "ship_enqueue" || c.type === "ship_merge" ? [c] : []));

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

/**
 * What a proof must match, from one read: its head, its checks, its criteria
 * now, and for each the latest row on its current version at that head
 * (`null`: none). Only this is kept, not the whole read.
 */
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
	rows: (f.criteria ?? []).map(
		(c) =>
			f.verdicts.findLast(
				(v) => v.criterion === c.id && v.version === c.version && v.head === f.head,
			) ?? null,
	),
});

/**
 * Why a write's proof is not the last read's, in words. `null`: it is. The
 * proof must name the read's head, hold the read's criteria as they are now,
 * and carry for each the latest row on its current version at that head, a
 * pass, as the read found it; and the checks there must be green.
 */
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

/**
 * The read this step brings, if the machine was waiting for it. `null`: none.
 * A read's answer that comes while the machine is not reading (an echo of an
 * old one) is not news to it, and it ignores it; so does each law.
 */
const readIn = (step: Step<Ship, AnyShipMsg, ShipCmd>): ShipFacts | null =>
	step.msg.type === "ship_facts_ok" && step.prev.phase === "reading" ? step.msg.value : null;

/** The laws, for the real machine or a planted copy of it. */
export function shipLaws<S extends Ship>(): readonly Law<S, AnyShipMsg, ShipCmd>[] {
	return [
		// It keeps only what it needs of the last read: the explorer tells two runs apart by what each law keeps.
		watched<
			S,
			AnyShipMsg,
			ShipCmd,
			{readonly head: string; readonly why: readonly string[]} | null
		>("merge only when the last read shows it ready", null, (memory, step) => {
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
		}),
		watched<S, AnyShipMsg, ShipCmd, Wanted | null>(
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
		watched<S, AnyShipMsg, ShipCmd, {readonly head: string; readonly passed: boolean} | null>(
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
		watched<S, AnyShipMsg, ShipCmd, readonly string[]>(
			"only the head that was sent to the queue lands",
			[],
			(sent, step) => {
				const now = [...new Set([...sent, ...writes(step.cmds).map((c) => c.ready.head)])].sort();
				// The step that makes it land: into `finishing`, or straight to a merged end.
				const lands =
					(step.next.phase === "finishing" && step.prev.phase !== "finishing") ||
					(step.next.phase === "over" &&
						step.next.outcome.kind === "done" &&
						step.prev.phase !== "over" &&
						step.prev.phase !== "finishing");
				if (!lands) return now;
				const {msg} = step;
				const head =
					msg.type === "ship_queue" && msg.reading === "landed"
						? msg.head
						: msg.type === "ship_merge_ok" && msg.value.reading === "merged"
							? msg.cmd.ready.head
							: null;
				// A pull request found already merged by a read is not this run's landing.
				if (msg.type === "ship_facts_ok") return now;
				if (head === null || !sent.includes(head))
					return broke(
						`landed ${head ?? "on a Msg that names no head"}, and the heads sent were ${sent.join(", ") || "none"}`,
					);
				return now;
			},
		),
		law<S, AnyShipMsg, ShipCmd>("an ended run sends nothing", (step) =>
			step.prev.phase === "over" && step.cmds.length > 0
				? `${step.cmds.map((c) => c.type).join(", ")} after the run ended`
				: null,
		),
	];
}

/** One Msg in a few words, for a breaking sequence. */
export function showShipMsg(m: AnyShipMsg): string {
	switch (m.type) {
		case "ship_facts_ok": {
			const f = m.value;
			const own = ["head", "reviews", "criteria", "verdicts"];
			const odd = (Object.keys(base) as (keyof ShipFacts)[])
				.filter((k) => !own.includes(k) && structuralKey(f[k]) !== structuralKey(base[k]))
				.map((k) => `${k} ${structuralKey(f[k])}`)
				.concat(
					f.reviews === null
						? ["reviews unread"]
						: f.reviews.filter((k) => k.verdict !== "passed").map((k) => `${k.kind} ${k.verdict}`),
				)
				.concat(proofText(f));
			return `read at ${f.head}: ${odd.length === 0 ? "ready" : odd.join(", ")}`;
		}
		case "ship_enqueue_ok":
		case "ship_merge_ok":
		case "ship_rerun_checks_ok":
		case "ship_finish_ok":
			return `${m.type} ${structuralKey(m.value)}`;
		case "ship_checks":
		case "ship_queue_overdue":
			return `${m.type} at ${m.head}`;
		case "ship_queue":
			return `queue says ${m.reading} at ${m.head}`;
		case "ship_checks_overdue":
			return `checks clock at ${m.head}, wait ${m.wait}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}
const structuralKey = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** A read's verdict rows in a few words: nothing when all are met at its head. */
const proofText = (f: ShipFacts): readonly string[] => {
	if (f.criteria === null) return ["criteria unread"];
	const kind = PROOFS.find((k) => structuralKey(rowsFor(f.head, k)) === structuralKey(f.verdicts));
	switch (kind) {
		case "met":
			return [];
		case "failed":
			return ["c2 failed"];
		case "other_head":
			return ["rows at another head"];
		case "old_version":
			return ["c2 judged on v1"];
		default:
			return [`rows ${structuralKey(f.verdicts)}`];
	}
};

export const shipInit: Ship = {phase: "idle"};
export const shipStep: Update<Ship, AnyShipMsg, ShipCmd> = shipUpdate;

// ---------------------------------------------------------------- planted mistakes

type Row = NonNullable<ShipFacts["reviews"]>[number];
const letThrough = (k: Row): Row => (k.verdict === "missing" ? {...k, verdict: "passed"} : k);

/** The gate forgets one line: a missing review is let through. */
export const forgetsMissingReview: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) =>
	m.type === "ship_facts_ok" && m.value.reviews?.some((k) => k.verdict === "missing")
		? shipUpdate(s, {
				...m,
				value: {
					...m.value,
					reviews: [letThrough(m.value.reviews[0]), ...m.value.reviews.slice(1).map(letThrough)],
				},
			})
		: shipUpdate(s, m);

/**
 * A planted mistake that keeps a read beside the machine's state. `kept`: the
 * first review pass it saw. `seen`: the last read.
 */
export type Keeping = Ship & {readonly kept?: ShipFacts; readonly seen?: ShipFacts};

/**
 * Skips the fresh read: once the checks settle, it takes the rows of the read
 * before the wait for its proof, calls the checks green, and queues the head.
 */
export const skipsTheRead: Update<Keeping, AnyShipMsg, ShipCmd> = (s, m) => {
	const seen = m.type === "ship_facts_ok" ? m.value : s.seen;
	if (
		m.type !== "ship_checks" ||
		s.phase !== "waiting" ||
		m.head !== s.head ||
		seen?.criteria == null
	) {
		const [next, cmds] = shipUpdate(s, m);
		return [seen === undefined ? next : {...next, seen}, cmds];
	}
	const r = ReadyToMerge.of({
		pr: s.pr,
		head: s.head,
		criteria: seen.criteria,
		verdicts: seen.verdicts,
		checks: {head: s.head, state: "green"},
	});
	if (!("ready" in r)) return shipUpdate(s, m);
	const asked = enqueue({ready: r.ready, intent: `ship/${s.pr}/enqueue/${s.head}`});
	const {pr, waits, moves, rerunFor, waited} = s;
	return [
		{
			pr,
			waits,
			moves,
			rerunFor,
			waited,
			ready: r.ready,
			landing: "whole",
			phase: "enqueueing",
			asked,
		},
		[asked],
	];
};

/**
 * Matches a row to its criterion by id alone: a row on old words is taken as
 * one on the current words, so a reworded criterion is merged unjudged.
 */
export const takesAnOldVersion: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) => {
	if (m.type !== "ship_facts_ok" || m.value.criteria === null) return shipUpdate(s, m);
	const now = m.value.criteria;
	const verdicts = m.value.verdicts.map((v) => ({
		...v,
		version: now.find((c) => c.id === v.criterion)?.version ?? v.version,
	}));
	return shipUpdate(s, {...m, value: {...m.value, verdicts}});
};
export const keepsAnOldPass: Update<Keeping, AnyShipMsg, ShipCmd> = (s, m) => {
	const kept = s.kept;
	const msg =
		m.type === "ship_facts_ok" && kept !== undefined && kept.head !== m.value.head
			? {...m, value: {...m.value, reviews: kept.reviews}}
			: m;
	const [next, cmds] = shipUpdate(s, msg);
	const keep =
		m.type === "ship_facts_ok" && allPassed(m.value.reviews) && kept === undefined ? m.value : kept;
	return [keep === undefined ? next : {...next, kept: keep}, cmds];
};

/** The queue's Listen is not checked against the head: any head that lands counts. */
export const landsAnyHead: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) =>
	m.type === "ship_queue" && s.phase === "queued"
		? shipUpdate(s, {...m, head: s.ready.head})
		: shipUpdate(s, m);

/** A restart after the end reads again, as if the run were still going. */
export const actsAfterTheEnd: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) =>
	s.phase === "over" && m.type === "resume" ? [s, [readShipFacts({pr: s.pr})]] : shipUpdate(s, m);
