import {Schema} from "effect";
import {type Folded, foldsOf, latestOf, openAsks} from "../../asks/rules.ts";
import {type Current, currentOf, type Verdict} from "../../criteria/book.ts";
import {PLAN, type PlanId, TaskId, TicketId} from "../../ids.ts";
import {Item} from "../build/ticket.ts";

// What a plan's lane reads before each step, and the one pure choice of the next step
// (docs/direction/done-is-per-criterion.md, "One PR per plan"; a-project-is-a-parent-plan.md).
// Everything here comes from the ledger's facts and the code host as they are now: a lane taken
// over reads the same and chooses the same.
//
//   the owner first   a closed plan ends the lane; a plan not approved, or any ask of the plan
//                     still open (a new version, a stuck task), waits for the answer
//   no plan yet       the lane plans the ticket: version 1 goes to the owner like any other
//   a ticket folded   in by sort: the plan is planned again with it, and the new version goes to
//                     the owner, before any more work
//   a removed task   its commits come off the branch, by revert, before anything else
//   a task not done   a round on the first one: catch up with main, build, review. Done means
//                     every live criterion of the task passed at its current version, the last
//                     time it was judged
//   every task done   met at the head: the pull request, then ship. Not met: the last review over
//                     the whole book, after a catch-up. A criterion of the plan's own that it
//                     failed sends one round to the last task first

export const TaskState = Schema.Struct({
	task: TaskId,
	settled: Schema.Boolean,
	/** Its criteria that the last judgement failed, as the next round is told them. */
	open: Schema.Array(Item),
});
export type TaskState = typeof TaskState.Type;

export const PrState = Schema.Struct({
	url: Schema.String,
	state: Schema.Literals(["open", "merged"]),
	head: Schema.String,
});

export const LaneView = Schema.Struct({
	approved: Schema.Boolean,
	closed: Schema.Boolean,
	/** The plan's asks the owner has not answered, by id. */
	waiting: Schema.Array(Schema.String),
	/** The live tasks of the approved version, in its order. */
	tasks: Schema.Array(TaskState),
	removed: Schema.Array(TaskId),
	/** The plan's own criteria the last review over the whole book failed. */
	planOpen: Schema.Array(Item),
	/** The plan's branch now. `null`: none yet. */
	head: Schema.NullOr(Schema.String),
	/** Main has a commit the branch does not. */
	behind: Schema.Boolean,
	/** Every live criterion passed at `head`, at its current version. */
	met: Schema.Boolean,
	pr: Schema.NullOr(PrState),
	/** Every ticket the plan covers: its pull request closes each. */
	tickets: Schema.Array(Schema.String),
	/** The plan's newest version. */
	version: Schema.Finite,
	/** Tickets sort folded in that no version was planned with yet. */
	folds: Schema.Array(TicketId),
	title: Schema.String,
	summary: Schema.String,
});
export type LaneView = typeof LaneView.Type;

/** What the code host says, read beside the facts. */
export interface Outside {
	readonly head: string | null;
	readonly behind: boolean;
	readonly pr: typeof PrState.Type | null;
}

const latest = (verdicts: readonly Verdict[], c: Current) =>
	verdicts.findLast((v) => v.criterion === c.id && v.version === c.version) ?? null;

const itemOf = (c: Current, v: Verdict | null): Item => ({
	criterion: c.id,
	text: c.text,
	says: v === null ? "Not judged yet." : `Failed: ${v.proof}.`,
	where: [],
	wants: [],
});

/** The lane's view of one plan, from the folded ledger and the code host. Pure. */
export function laneViewOf(state: Folded, plan: PlanId, out: Outside): LaneView {
	const track = state.plans.get(plan);
	const approved = track?.approved?.data ?? null;
	const book = track?.book ?? null;
	const current = book === null ? [] : currentOf(book);
	const verdicts = book?.verdicts ?? [];
	const removed = [...(track?.removed ?? [])];
	const failing = (c: Current) => latest(verdicts, c)?.grade === "fail";
	const tasks = (approved?.tasks ?? [])
		.filter((t) => !removed.includes(t.id))
		.map((t): TaskState => {
			const own = current.filter((c) => c.task === t.id);
			return {
				task: t.id,
				settled: own.every((c) => latest(verdicts, c)?.grade === "pass"),
				open: own.filter(failing).map((c) => itemOf(c, latest(verdicts, c))),
			};
		});
	const head = out.head;
	const atHead = (c: Current) =>
		verdicts.findLast((v) => v.criterion === c.id && v.version === c.version && v.head === head);
	const met =
		head !== null && current.length > 0 && current.every((c) => atHead(c)?.grade === "pass");
	return {
		approved: approved !== null,
		closed: (track?.closed ?? null) !== null,
		waiting: openAsks(state)
			.filter(
				(a) => (a.for === "plan" || a.for === "stuck" || a.for === "check") && a.plan === plan,
			)
			.map((a) => a.id),
		tasks,
		removed,
		planOpen: current
			.filter((c) => c.task === PLAN && failing(c))
			.map((c) => itemOf(c, latest(verdicts, c))),
		head,
		behind: out.behind,
		met,
		pr: out.pr,
		tickets: [...(track?.tickets ?? [])],
		version: latestOf(state, plan)?.version ?? 0,
		folds: [...foldsOf(state, plan)],
		title: approved?.tasks[0]?.title ?? `plan ${plan}`,
		summary: approved?.summary ?? "",
	};
}

/** What the lane has done so far: the counts its kids' names are made from. */
export const LaneAt = Schema.Struct({
	/** Rounds started, per task. */
	rounds: Schema.Record(Schema.String, Schema.Finite),
	/** Last reviews over the whole book started. */
	finals: Schema.Finite,
	/** The `finals` count when a round last went to the plan's own criteria. -1: never. */
	fixedAt: Schema.Finite,
	/** Removed tasks whose commits came off the branch. */
	dropped: Schema.Array(TaskId),
	/** Ship runs started. */
	ships: Schema.Finite,
});
export type LaneAt = typeof LaneAt.Type;

export const START: LaneAt = {rounds: {}, finals: 0, fixedAt: -1, dropped: [], ships: 0};

/** How many last reviews a lane starts before it stops: each found the plan short. */
export const MOST_FINALS = 4;
/** How many rounds one task gets before the lane stops: the stall rule asks the owner long before. */
export const MOST_ROUNDS = 12;
/** How many ship runs a lane starts on one met head before it stops: each ended with the PR not merged. */
export const MOST_SHIPS = 3;

export type Next =
	| {readonly go: "done"; readonly pr: string; readonly head: string}
	| {readonly go: "closed"}
	| {readonly go: "wait"; readonly asks: readonly string[]}
	| {readonly go: "plan"; readonly version: number; readonly folds: readonly TicketId[]}
	| {readonly go: "drop"; readonly task: TaskId}
	| {
			readonly go: "round";
			readonly task: TaskId;
			readonly round: number;
			readonly open: readonly Item[];
			/** It goes to the plan's own criteria the last review failed. */
			readonly fix: boolean;
	  }
	| {readonly go: "final"; readonly round: number}
	| {readonly go: "open"}
	| {readonly go: "ship"; readonly pr: string; readonly run: number}
	| {readonly go: "stuck"; readonly why: "no_end" | "read_failed"};

/** The next step, from what the lane has done and what it reads now. Pure. */
export function next(at: LaneAt, v: LaneView): Next {
	if (v.pr?.state === "merged") return {go: "done", pr: v.pr.url, head: v.pr.head};
	if (v.closed) return {go: "closed"};
	if (v.waiting.length > 0) return {go: "wait", asks: v.waiting};
	// No version yet: the lane plans the first itself, and it waits on the owner as any other.
	if (!v.approved)
		return v.version === 0
			? {go: "plan", version: 1, folds: v.folds}
			: {go: "stuck", why: "read_failed"};
	if (v.folds.length > 0) return {go: "plan", version: v.version + 1, folds: v.folds};
	const drop = v.removed.find((t) => !at.dropped.includes(t));
	if (drop !== undefined) return {go: "drop", task: drop};
	const todo = v.tasks.find((t) => !t.settled);
	if (todo !== undefined) {
		const round = (at.rounds[todo.task] ?? 0) + 1;
		if (round > MOST_ROUNDS) return {go: "stuck", why: "no_end"};
		return {go: "round", task: todo.task, round, open: todo.open, fix: false};
	}
	if (v.met && !v.behind) {
		if (v.pr === null) return {go: "open"};
		if (at.ships >= MOST_SHIPS) return {go: "stuck", why: "no_end"};
		return {go: "ship", pr: v.pr.url, run: at.ships + 1};
	}
	const last = v.tasks.at(-1);
	if (v.planOpen.length > 0 && at.fixedAt !== at.finals && last !== undefined)
		return {
			go: "round",
			task: last.task,
			round: (at.rounds[last.task] ?? 0) + 1,
			open: v.planOpen,
			fix: true,
		};
	if (at.finals >= MOST_FINALS) return {go: "stuck", why: "no_end"};
	return {go: "final", round: at.finals + 1};
}
