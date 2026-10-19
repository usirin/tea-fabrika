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
// The ship machine never sees a criterion. What it reads is `reviews`, one
// row per kind of review owed at the head, and `checks`. So "every criterion
// met at the current head" can only be asked of it as "the last read showed
// every review row passed at this head, and the checks green there".

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

const base: ShipFacts = {
	head: "A",
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: code("passed"),
	checks: "green",
	mergeable: "clean",
	comments: [],
};

/** Every review row passed. Worked out here, not with the gate's own helper, so a slip there shows. */
const allPassed = (reviews: ShipFacts["reviews"]): boolean =>
	reviews?.every((k) => k.verdict === "passed") ?? false;

/** The facts a read may answer, at one head. `narrow`: seven profiles. `wide`: every field crossed. */
export function factsAt(head: string, size: "narrow" | "wide"): readonly ShipFacts[] {
	const at = (patch: Partial<ShipFacts>): ShipFacts => ({...base, head, ...patch});
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
		];
	const out: ShipFacts[] = [];
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
						...(["queued", "head_moved", "conflicts", "no_queue"] as const).map((v) =>
							enqueue.ok(cmd, v, 0),
						),
						enqueue.err(cmd, UNKNOWN, 0),
					];
				case "ship_merge":
					return [
						merge.ok(cmd, {reading: "merged", commit: `main-${cmd.head}`}, 0),
						merge.ok(cmd, {reading: "head_moved"}, 0),
						merge.ok(cmd, {reading: "conflicts"}, 0),
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
	return why;
}

/**
 * The last read the machine was waiting for. A read's answer that comes while
 * the machine is not reading (an echo of an old one) is not news to it, and it
 * ignores it; so does the law.
 */
const lastRead = (memory: ShipFacts | null, step: Step<Ship, AnyShipMsg, ShipCmd>) =>
	step.msg.type === "ship_facts_ok" && step.prev.phase === "reading" ? step.msg.value : memory;

/** The laws, for the real machine or a planted copy of it. */
export function shipLaws<S extends Ship>(): readonly Law<S, AnyShipMsg, ShipCmd>[] {
	return [
		watched<S, AnyShipMsg, ShipCmd, ShipFacts | null>(
			"merge only when the last read shows it ready",
			null,
			(memory, step) => {
				const read = lastRead(memory, step);
				for (const cmd of writes(step.cmds)) {
					if (read === null) return broke(`${cmd.type} with no read before it`);
					const why = notReady(read);
					if (why.length > 0)
						return broke(`${cmd.type} of ${cmd.head}, and the last read says ${why.join(", ")}`);
					if (cmd.head !== read.head)
						return broke(`${cmd.type} of ${cmd.head}, and the last read was at ${read.head}`);
				}
				return read;
			},
		),
		watched<S, AnyShipMsg, ShipCmd, {readonly head: string; readonly passed: boolean} | null>(
			"a review pass for another head never counts",
			null,
			(memory, step) => {
				const facts = lastRead(null, step);
				const read = facts === null ? memory : {head: facts.head, passed: allPassed(facts.reviews)};
				for (const cmd of writes(step.cmds))
					if (read === null || read.head !== cmd.head || !read.passed)
						return broke(
							`${cmd.type} of ${cmd.head}, and the last read ${read === null ? "never happened" : `said reviews ${read.passed ? "passed" : "not passed"} at ${read.head}`}`,
						);
				return read;
			},
		),
		watched<S, AnyShipMsg, ShipCmd, readonly string[]>(
			"only the head that was sent to the queue lands",
			[],
			(sent, step) => {
				const now = [...new Set([...sent, ...writes(step.cmds).map((c) => c.head)])].sort();
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
							? msg.cmd.head
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
			const odd = (Object.keys(base) as (keyof ShipFacts)[])
				.filter(
					(k) => k !== "head" && k !== "reviews" && structuralKey(f[k]) !== structuralKey(base[k]),
				)
				.map((k) => `${k} ${structuralKey(f[k])}`)
				.concat(
					f.reviews === null
						? ["reviews unread"]
						: f.reviews.filter((k) => k.verdict !== "passed").map((k) => `${k.kind} ${k.verdict}`),
				);
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

/** Skips the fresh read: once the checks settle, it queues the head it waited on. */
export const skipsTheRead: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) => {
	if (m.type !== "ship_checks" || s.phase !== "waiting" || m.head !== s.head)
		return shipUpdate(s, m);
	const asked = enqueue({pr: s.pr, head: s.head, intent: `ship/${s.pr}/enqueue/${s.head}`});
	const {pr, waits, moves, rerunFor, waited, head} = s;
	return [
		{pr, waits, moves, rerunFor, waited, head, landing: "whole", phase: "enqueueing", asked},
		[asked],
	];
};

/**
 * A ship that keeps the first review pass it saw, by pull request and not by
 * head, and takes it for a later read of another head.
 */
export type Keeping = Ship & {readonly kept?: ShipFacts};
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
		? shipUpdate(s, {...m, head: s.head})
		: shipUpdate(s, m);

/** A restart after the end reads again, as if the run were still going. */
export const actsAfterTheEnd: Update<Ship, AnyShipMsg, ShipCmd> = (s, m) =>
	s.phase === "over" && m.type === "resume" ? [s, [readShipFacts({pr: s.pr})]] : shipUpdate(s, m);
