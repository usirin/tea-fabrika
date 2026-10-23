import {Schema} from "effect";
import {criteriaOf, type Folded} from "../../asks/rules.ts";
import {PLAN, type PlanId, type TaskId, ticketOf} from "../../ids.ts";
import {storyText} from "../plan/plan.ts";
import {Criterion} from "../review/pack.ts";
import type {TaskOutcome} from "./outcome.ts";

// What one task's build reads before it starts, from the ledger alone, and the gate on it. A task
// is built from the plan's book (../../criteria/book.ts), never from a ticket's text: its criteria
// are the live ones under its id, at their current versions.
//
//   the plan    approved, and not closed: an unapproved version only adds or rewords, so a build
//               waits for the owner's yes before it starts
//   the task    in the approved version, and not removed by the owner
//   the branch  `plan/<n>`, one per plan; where it stands now is the round's base. A plan with no
//               branch yet starts from main.

/** The plan's one branch: every task's commits land on it, and one pull request opens from it. */
export const planBranchOf = (plan: PlanId): string => `plan/${planNumberOf(plan)}`;

/** The number of the ticket a plan is named by: `o/r#700` is 700. */
export const planNumberOf = (plan: PlanId): number => Number(plan.slice(plan.indexOf("#") + 1));

/** The url of the issue a plan is named by. */
export const issueOf = (plan: PlanId): string => {
	const ticket = ticketOf(plan);
	const [repo, n] = ticket.split("#");
	return `https://github.com/${repo}/issues/${n}`;
};

export const TaskView = Schema.Struct({
	/** The plan's issue, as a url. */
	ticket: Schema.String,
	number: Schema.Finite,
	title: Schema.String,
	/** The plan's summary and stories, for the builder: why the task exists. */
	body: Schema.String,
	criteria: Schema.Array(Criterion),
	approved: Schema.Boolean,
	live: Schema.Boolean,
	closed: Schema.Boolean,
	branch: Schema.String,
	/** Where the branch stands now, or main's commit when it has none. `null`: neither could be read. */
	base: Schema.NullOr(Schema.String),
});
export type TaskView = typeof TaskView.Type;

/** Where the plan's branch and main stand on the code host. `null`: none, or not read. */
export interface Heads {
	readonly branch: string | null;
	readonly main: string | null;
}

/** One task's view, from the folded ledger and the two heads. Pure. */
export function taskViewOf(state: Folded, plan: PlanId, task: TaskId, heads: Heads): TaskView {
	const track = state.plans.get(plan);
	const approved = track?.approved?.data ?? null;
	const found = approved?.tasks.find((t) => t.id === task) ?? null;
	const lines =
		approved === null
			? []
			: [approved.summary.trim(), "", ...approved.stories.map((s) => `- ${storyText(s)}.`)];
	return {
		ticket: issueOf(plan),
		number: planNumberOf(plan),
		title: found?.title ?? `task ${task}`,
		body: lines.join("\n"),
		criteria: criteriaOf(state, plan, task).map((c) => ({
			id: c.id,
			version: c.version,
			text: c.text,
			checked: false,
			evidence: null,
		})),
		approved: approved !== null,
		live: found !== null && !(track?.removed.has(task) ?? false),
		closed: (track?.closed ?? null) !== null,
		branch: planBranchOf(plan),
		base: heads.branch ?? heads.main,
	};
}

/** The plan's own criteria now: those no task holds. Pure. */
export const planCriteriaOf = (state: Folded, plan: PlanId) =>
	(state.plans.get(plan)?.book.live ?? []).filter((e) => e.task === PLAN);

/** Go, with the criteria to build to; or the one reason not to. Pure. */
export type TaskGate =
	| {readonly answer: "go"; readonly criteria: readonly [Criterion, ...Criterion[]]}
	| {readonly answer: "stop"; readonly outcome: TaskOutcome};

export function taskGate(view: TaskView): TaskGate {
	if (view.closed) return {answer: "stop", outcome: {kind: "skip", why: "closed"}};
	if (!view.approved) return {answer: "stop", outcome: {kind: "skip", why: "not_approved"}};
	if (!view.live) return {answer: "stop", outcome: {kind: "skip", why: "removed"}};
	if (view.base === null) return {answer: "stop", outcome: {kind: "stuck", why: "read_failed"}};
	const [first, ...rest] = view.criteria;
	if (first === undefined) return {answer: "stop", outcome: {kind: "stuck", why: "no_criteria"}};
	return {answer: "go", criteria: [first, ...rest]};
}
