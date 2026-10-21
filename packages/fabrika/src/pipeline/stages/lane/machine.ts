import {defineMachine, type Sub} from "@demlik/tea";
import {Schema} from "effect";
import {Owner, PLAN, PlanId, TaskId, TicketId} from "../../ids.ts";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import {inert} from "../build/body.ts";
import {Item} from "../build/ticket.ts";
import {Settings} from "../review/reviewer.ts";
import {issueOf} from "../task/view.ts";
import type {LaneOutcome} from "./outcome.ts";
import {type LaneAt, LaneView, next, START} from "./view.ts";

// A plan's lane: the parent that takes an approved plan to one pull request
// (docs/direction/a-project-is-a-parent-plan.md; done-is-per-criterion.md, "One PR per plan").
// It runs no agent. Every piece of work is a child under a name made from the lane's counts, so a
// lane taken over starts no child twice: one already there is the one.
//
//   reading    the facts and the code host (./view.ts), then `next`, pure
//   waiting    on the owner: a Sub that watches the plan's asks until one is answered
//   starting   one child, with its job: an Act. The child is a hosted stage of its own:
//              `catchup` (the branch takes main in, or a removed task's commits come out),
//              `build` (one task, one commit on the plan's branch), `review` (one task's criteria,
//              or the whole book), `ship`
//   running    a Sub that waits for the child's outcome row
//   noting     after a task's review, a last review that did not pass, or a ship run that did not
//              merge: one `reviewed` fact, so the stall rule counts it (./view.ts). No count of the
//              lane's own ever stops it
//   planning   after a ticket was folded in and a `plan` child planned again: its draft as the
//              plan's next version, which waits on the owner like any other
//   opening    the plan's one pull request, and the last review's verdict on it: one Act, keyed
//   over       the outcome
//
// One round of a task is three children in a row: catch-up, build, review. The last review over the
// whole book is two: catch-up, review. The pull request opens only once every live criterion passed
// at the head, so the code host's checks run once, on the head that merges.

const Unknown = ["unknown"] as const;

export const LaneJob = Schema.Struct({
	plan: PlanId,
	/** The settings every agent child is started with. */
	settings: Settings,
	/** One child's dollar cap. */
	usd: Schema.Finite,
	/** The rubric folder reviews read. */
	rubrics: Schema.String,
	/** The first commit date, in seconds: each child's is this plus a number from its name. */
	at: Schema.Finite,
});
export type LaneJob = typeof LaneJob.Type;

export const KIDS = ["plan", "catchup", "build", "review", "ship"] as const;
export type KidKind = (typeof KIDS)[number];

/** Where a lane is in one piece of work. */
export const Flow = Schema.Union([
	Schema.Struct({
		flow: Schema.Literal("round"),
		task: TaskId,
		round: Schema.Finite,
		open: Schema.Array(Item),
		step: Schema.Literals(["catchup", "build", "review"]),
		head: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({
		flow: Schema.Literal("final"),
		round: Schema.Finite,
		step: Schema.Literals(["catchup", "review"]),
		head: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({flow: Schema.Literal("drop"), task: TaskId}),
	Schema.Struct({flow: Schema.Literal("ship"), run: Schema.Finite, pr: Schema.String}),
	/** Plan version `version`, with the tickets folded in since the last. */
	Schema.Struct({
		flow: Schema.Literal("plan"),
		version: Schema.Finite,
		folds: Schema.Array(TicketId),
	}),
]);
export type Flow = typeof Flow.Type;

/** A child's name: the lane's, then where in the plan it works. The last part is its kind. */
export function kidOf(lane: string, f: Flow): string {
	switch (f.flow) {
		case "round":
			return `${lane}:${f.task}:r${f.round}:${f.step}`;
		case "final":
			return `${lane}:final:r${f.round}:${f.step}`;
		case "drop":
			return `${lane}:${f.task}:drop:catchup`;
		case "ship":
			return `${lane}:s${f.run}:ship`;
		case "plan":
			return `${lane}:v${f.version}:plan`;
	}
}

/** A child's kind, from its name. `null`: not a child's name. */
export const kindOf = (kid: string): KidKind | null => {
	const last = kid.slice(kid.lastIndexOf(":") + 1);
	return (KIDS as readonly string[]).includes(last) ? (last as KidKind) : null;
};

/** A number from a child's name, the same on every host: its commits' date is the lane's plus it. */
export const offsetOf = (kid: string): number => {
	let h = 0x811c9dc5;
	for (let k = 0; k < kid.length; k++) {
		h ^= kid.charCodeAt(k);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h % 100_000;
};

/** The job a child is started on. Pure. */
export function jobFor(lane: string, job: LaneJob, f: Flow): unknown {
	const kid = kidOf(lane, f);
	const at = job.at + offsetOf(kid);
	const agent = {settings: job.settings, usd: job.usd};
	switch (f.flow) {
		case "drop":
			return {plan: job.plan, drop: f.task, ...agent, at};
		case "ship":
			return {pr: f.pr};
		case "plan":
			return {ticket: issueOf(job.plan), tries: 2, ...agent};
		case "round":
			if (f.step === "catchup") return {plan: job.plan, drop: null, ...agent, at};
			if (f.step === "build")
				return {plan: job.plan, task: f.task, round: f.round, open: f.open, ...agent, at};
			return {plan: job.plan, task: f.task, head: f.head, rubrics: job.rubrics, ...agent};
		case "final":
			if (f.step === "catchup") return {plan: job.plan, drop: null, ...agent, at};
			return {plan: job.plan, task: "plan", head: f.head, rubrics: job.rubrics, ...agent};
	}
}

/** How a child ended, as the lane reads its outcome row. */
export const KidEnd = Schema.Struct({
	outcome: Schema.Struct({kind: Schema.String, why: Schema.optionalKey(Schema.String)}),
	head: Schema.optionalKey(Schema.NullOr(Schema.String)),
	open: Schema.optionalKey(Schema.Array(Item)),
});
export type KidEnd = typeof KidEnd.Type;

export const readLane = gather("lane_read", {
	input: Schema.Struct({plan: PlanId, pr: Schema.NullOr(Schema.String)}),
	ok: LaneView,
	err: Unknown,
});

export const startKid = act("lane_start", {
	input: Schema.Struct({
		kid: Schema.String,
		/** The child's dollar cap, on its spec. `null`: none (it runs no agent). */
		usd: Schema.NullOr(Schema.Finite),
		job: Schema.Unknown,
	}),
	ok: Schema.Struct({started: Schema.Boolean}),
	err: Unknown,
});

/**
 * One count for the stall rule. `task`: the list it counts in, a task's or the whole plan's
 * (`plan`: the last reviews and the ship runs). `kid`: the child whose end it counts, so each child
 * is counted once.
 */
export const noteRound = act("lane_note", {
	input: Schema.Struct({plan: PlanId, task: Owner, kid: Schema.String, open: Schema.Int}),
	ok: Schema.Struct({}),
	err: Unknown,
});

export const openPr = act("lane_open", {
	input: Schema.Struct({
		plan: PlanId,
		head: Schema.String,
		title: Schema.String,
		body: Schema.String,
	}),
	ok: Schema.Struct({url: Schema.String}),
	err: Unknown,
});

/** The plan child's draft as the plan's next version, its ids kept where its words were, for the owner. */
export const notePlan = act("lane_planned", {
	input: Schema.Struct({plan: PlanId, kid: Schema.String, folds: Schema.Array(TicketId)}),
	ok: Schema.Struct({}),
	err: ["unknown", "no_plan"],
});

type ReadCmd = ReturnType<typeof readLane>;
type StartCmd = ReturnType<typeof startKid>;
type NoteCmd = ReturnType<typeof noteRound>;
type OpenCmd = ReturnType<typeof openPr>;
type PlannedCmd = ReturnType<typeof notePlan>;
export type LaneCmd = ReadCmd | StartCmd | NoteCmd | OpenCmd | PlannedCmd;

export type KidSub = Sub<"lane_kid", {readonly kid: string}>;
export type OwnerSub = Sub<"lane_owner", {readonly plan: PlanId; readonly asks: readonly string[]}>;
export type LaneSub = KidSub | OwnerSub;

export const LaneReport = Schema.Struct({
	rounds: Schema.Record(Schema.String, Schema.Finite),
	finals: Schema.Finite,
	pr: Schema.NullOr(Schema.String),
	/** What stopped it, in words. */
	problems: Schema.Array(Schema.String),
});
export type LaneReport = typeof LaneReport.Type;

type Held = {
	readonly lane: string;
	readonly job: LaneJob;
	readonly at: LaneAt;
	/** The plan's pull request, once opened. */
	readonly pr: string | null;
};

export type Lane =
	| {readonly phase: "idle"}
	| (Held & {readonly phase: "reading"; readonly asked: ReadCmd})
	| (Held & {readonly phase: "waiting"; readonly asks: readonly string[]})
	| (Held & {readonly phase: "starting"; readonly flow: Flow; readonly asked: StartCmd})
	| (Held & {readonly phase: "running"; readonly flow: Flow; readonly kid: string})
	| (Held & {readonly phase: "noting"; readonly asked: NoteCmd})
	| (Held & {readonly phase: "planning"; readonly asked: PlannedCmd})
	| (Held & {readonly phase: "opening"; readonly asked: OpenCmd})
	| (Held & {readonly phase: "over"; readonly outcome: LaneOutcome; readonly report: LaneReport});

export type LaneMsg =
	| {readonly type: "start"; readonly lane: string; readonly job: LaneJob}
	| {readonly type: "resume"}
	| {readonly type: "kid_over"; readonly kid: string; readonly end: KidEnd}
	| {readonly type: "owner_moved"};

type Step = readonly [Lane, readonly LaneCmd[]];
const stay = (s: Lane): Step => [s, []];
const held = (s: Held): Held => ({lane: s.lane, job: s.job, at: s.at, pr: s.pr});

const read = (s: Held): Step => {
	const asked = readLane({plan: s.job.plan, pr: s.pr});
	return [{...held(s), phase: "reading", asked}, [asked]];
};

const over = (s: Held, outcome: LaneOutcome, problems: readonly string[] = []): Step => [
	{
		...held(s),
		phase: "over",
		outcome,
		report: {rounds: s.at.rounds, finals: s.at.finals, pr: s.pr, problems},
	},
	[],
];

/** Start the child a flow is at. */
const start = (s: Held, flow: Flow): Step => {
	const kid = kidOf(s.lane, flow);
	const asked = startKid({
		kid,
		usd: flow.flow === "ship" ? null : s.job.usd,
		job: jobFor(s.lane, s.job, flow),
		intent: intentOf("lane", kid),
	});
	return [{...held(s), phase: "starting", flow, asked}, [asked]];
};

const stuckOf = (f: Flow) => {
	switch (f.flow) {
		case "drop":
			return "catchup_failed";
		case "ship":
			return "ship_failed";
		case "plan":
			return "plan_failed";
		default:
			return f.step === "catchup"
				? "catchup_failed"
				: f.step === "build"
					? "build_failed"
					: "review_failed";
	}
};

/**
 * The pull request's text: what the plan does, and the line that closes each ticket it covers.
 * The summary is the planner's words, made inert: the tickets it closes come from the ledger, never
 * from a "Fixes #2" a planner wrote. Pure.
 */
export const prBody = (v: LaneView): string =>
	[
		inert(v.summary.trim()),
		"",
		...v.tickets.map((t) => `Closes #${t.slice(t.indexOf("#") + 1)}`),
	].join("\n");

/** How many a review left open, as the stall rule counts them. */
const openCount = (end: KidEnd) =>
	end.outcome.kind === "done" ? 0 : Math.max(1, end.open?.length ?? 1);

/** Count a child's end for the stall rule, in the list `task` names, then read again. */
const note = (s: Held, task: Owner, f: Flow, open: number): Step => {
	const kid = kidOf(s.lane, f);
	const asked = noteRound({
		plan: s.job.plan,
		task,
		kid,
		open,
		intent: intentOf("lane", kid, "reviewed"),
	});
	return [{...held(s), phase: "noting", asked}, [asked]];
};

export const kidSub = listen("lane_kid", (s: Lane) =>
	s.phase === "running" ? {kid: s.kid} : null,
);
export const ownerSub = listen("lane_owner", (s: Lane) =>
	s.phase === "waiting" ? {plan: s.job.plan, asks: s.asks} : null,
);

/** What the lane does on a child's end. */
function afterKid(s: Held, f: Flow, end: KidEnd): Step {
	const kind = end.outcome.kind;
	const why = end.outcome.why ?? kind;
	// A review that could not see a criterion met (`unseen`) judged the work, not itself: a round
	// with work left open, which the stall rule counts and takes to the owner, a task's or a last
	// review's alike. Any other stuck child stops the lane.
	const unseen =
		(f.flow === "round" || f.flow === "final") &&
		f.step === "review" &&
		kind === "stuck" &&
		why === "unseen";
	if (kind === "stuck" && !unseen)
		return over(s, {kind: "stuck", why: stuckOf(f)}, [`${kidOf(s.lane, f)}: ${why}`]);
	const head = (now: string | null) => (kind === "done" ? (end.head ?? now) : now);
	switch (f.flow) {
		case "drop":
			return read({...s, at: {...s.at, dropped: [...s.at.dropped, f.task]}});
		// A ship run that did not merge leaves one thing open, the pull request, as in the one-ticket
		// loop (../operate/stop.ts, `shipItems`): run after run of it stops shrinking, and asks.
		case "ship":
			return kind === "done" ? read(s) : note(s, PLAN, f, 1);
		case "plan": {
			const asked = notePlan({
				plan: s.job.plan,
				kid: kidOf(s.lane, f),
				folds: f.folds,
				intent: intentOf("lane", kidOf(s.lane, f), "planned"),
			});
			return [{...held(s), phase: "planning", asked}, [asked]];
		}
		// A last review that passed is no count of its own: the ship run after it is, as a round
		// that passed and was sent back by the ship counts in the one-ticket loop. So a ship sent back
		// for main moving on, then a passing last review, then the same again, still asks.
		case "final":
			if (f.step === "catchup") return start(s, {...f, step: "review", head: head(f.head)});
			return kind === "done" ? read(s) : note(s, PLAN, f, openCount(end));
		case "round":
			if (f.step === "catchup") return start(s, {...f, step: "build", head: head(f.head)});
			if (f.step === "build")
				return kind === "done" ? start(s, {...f, step: "review", head: head(f.head)}) : read(s);
			if (kind === "skip") return over(s, {kind: "stuck", why: "review_failed"}, [why]);
			return note(s, f.task, f, openCount(end));
	}
}

export const lane = defineMachine({
	types: {model: {} as Lane, msg: {} as LaneMsg, sub: {} as LaneSub, ctx: undefined},
	cmds: [readLane, startKid, noteRound, openPr, notePlan],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	subs: [kidSub, ownerSub],
	update: {
		start: (s, m): Step =>
			s.phase === "idle" ? read({lane: m.lane, job: m.job, at: START, pr: null}) : stay(s),
		resume: (s): Step =>
			s.phase === "reading" ||
			s.phase === "starting" ||
			s.phase === "noting" ||
			s.phase === "planning" ||
			s.phase === "opening"
				? [s, [s.asked]]
				: stay(s),
		lane_read_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const v = m.value;
			const n = next(s.at, v);
			switch (n.go) {
				case "done":
					return over(s, {kind: "done", part: false, pr: n.pr, head: n.head});
				case "skip":
					return over(s, {kind: "skip", why: n.why});
				case "stuck":
					return over(s, {kind: "stuck", why: n.why});
				case "wait":
					return [{...held(s), phase: "waiting", asks: n.asks}, []];
				case "plan":
					return start(s, {flow: "plan", version: n.version, folds: n.folds});
				case "drop":
					return start(s, {flow: "drop", task: n.task});
				case "round": {
					const at = {
						...s.at,
						rounds: {...s.at.rounds, [n.task]: n.round},
						fixedAt: n.fix ? s.at.finals : s.at.fixedAt,
					};
					return start(
						{...s, at},
						{
							flow: "round",
							task: n.task,
							round: n.round,
							open: n.open,
							step: "catchup",
							head: v.head,
						},
					);
				}
				case "final":
					return start(
						{...s, at: {...s.at, finals: n.round}},
						{flow: "final", round: n.round, step: "catchup", head: v.head},
					);
				case "ship":
					return start({...s, at: {...s.at, ships: n.run}}, {flow: "ship", run: n.run, pr: n.pr});
				case "open": {
					// `met` is never true without a head.
					const head = v.head ?? "";
					const asked = openPr({
						plan: s.job.plan,
						head,
						title: v.title,
						body: prBody(v),
						intent: intentOf("lane", s.lane, "open"),
					});
					return [{...held(s), phase: "opening", asked}, [asked]];
				}
			}
		},
		lane_read_err: (s): Step =>
			s.phase === "reading" ? over(s, {kind: "stuck", why: "read_failed"}) : stay(s),
		lane_start_ok: (s): Step =>
			s.phase === "starting"
				? [{...held(s), phase: "running", flow: s.flow, kid: kidOf(s.lane, s.flow)}, []]
				: stay(s),
		lane_start_err: (s): Step =>
			s.phase === "starting"
				? over(s, {kind: "stuck", why: stuckOf(s.flow)}, [`${kidOf(s.lane, s.flow)} did not start`])
				: stay(s),
		kid_over: (s, m): Step =>
			s.phase === "running" && m.kid === s.kid ? afterKid(held(s), s.flow, m.end) : stay(s),
		lane_planned_ok: (s): Step => (s.phase === "planning" ? read(s) : stay(s)),
		lane_planned_err: (s, m): Step =>
			s.phase === "planning"
				? over(s, {kind: "stuck", why: "plan_failed"}, [
						m.error._tag === "no_plan" ? "planning again gave no plan" : "the plan was not kept",
					])
				: stay(s),
		lane_note_ok: (s): Step => (s.phase === "noting" ? read(s) : stay(s)),
		lane_note_err: (s): Step =>
			s.phase === "noting" ? over(s, {kind: "stuck", why: "read_failed"}) : stay(s),
		lane_open_ok: (s, m): Step => (s.phase === "opening" ? read({...s, pr: m.value.url}) : stay(s)),
		lane_open_err: (s): Step =>
			s.phase === "opening" ? over(s, {kind: "stuck", why: "open_failed"}) : stay(s),
		owner_moved: (s): Step => (s.phase === "waiting" ? read(s) : stay(s)),
	},
});
