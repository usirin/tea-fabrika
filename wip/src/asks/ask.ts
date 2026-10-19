import {Schema} from "effect";
import {Plan} from "../stages/plan/plan.ts";

// What the core asks the owner, and what it takes back. The core's own words:
// it emits an `Ask` and takes an `Answer`, and never knows who shows the one
// or gets the other (docs/direction/packs-are-programs.md). Elm's ports work
// the same way: the app owns the value types on both sides of a port.
//
//   {id: "plan:https://github.com/o/r/issues/7@1", at: 3, for: "plan", plan: ..., version: 1, data: {...}, since: null, ...}
//   {id: ..., answer: {kind: "approve"}}
//
// Three things wait on the owner, each with its own answers:
//
//   plan     approve | change one line | no, with a reason
//   stuck    remove the task | keep going N rounds | reword a criterion
//   ruling   the answer, with its branch: a lasting rule or a one-off, and
//            whether something must be built

/** An earlier version of a plan the owner approved: what a changed plan is shown against. */
export const Approved = Schema.Struct({version: Schema.Int, data: Plan});
export type Approved = typeof Approved.Type;

/** The owner approves building a plan (docs/direction/sort-answers-yes-or-no.md, "Who approves building"). */
export const PlanAsk = Schema.Struct({
	for: Schema.Literal("plan"),
	/** The plan's name: the first ticket it covers. */
	plan: Schema.String,
	tickets: Schema.Array(Schema.String),
	/** 1 for the first plan, one more for each new one. */
	version: Schema.Int,
	data: Plan,
	/** The version last approved, or `null`: none was. A changed plan is shown as what changed since it. */
	since: Schema.NullOr(Approved),
	/** What the plan's Check still found. Not a gate: the owner's look is the answer key for now. */
	problems: Schema.Array(Schema.String),
});
export type PlanAsk = typeof PlanAsk.Type;

/** A task the stall rule ran out on (docs/direction/done-is-per-criterion.md, "A stuck task"). */
export const StuckAsk = Schema.Struct({
	for: Schema.Literal("stuck"),
	plan: Schema.String,
	/** The task's place in the plan, from 1. */
	task: Schema.Int,
	title: Schema.String,
	/** The criteria of the task, as lines, for a reword to name. */
	criteria: Schema.Array(Schema.Struct({key: Schema.String, text: Schema.String})),
	/** How many were open after each review round of this task, oldest first. */
	open: Schema.Array(Schema.Int),
	/** `no_progress`: two rounds in a row left the list no shorter. `ran_out`: the rounds a "keep going" gave are spent, and the list is no shorter. */
	why: Schema.Literals(["no_progress", "ran_out"]),
	/** 1 the first time this task is stuck, one more each time after. */
	time: Schema.Int,
});
export type StuckAsk = typeof StuckAsk.Type;

/** A ticket sort sent to the owner to rule on (sort-answers-yes-or-no.md, "The ruling route"). */
export const RulingAsk = Schema.Struct({
	for: Schema.Literal("ruling"),
	ticket: Schema.String,
	/** The question, in one or two sentences. */
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	/** Why sort sent it here. */
	why: Schema.String,
});
export type RulingAsk = typeof RulingAsk.Type;

const Asked = {
	/** Stable: the same ask always has the same id, so a second hearing of it is known. */
	id: Schema.String,
	/** Its place in the ledger: the fact that raised it. Oldest first is smallest first. */
	at: Schema.Int,
};

export const Ask = Schema.Union([
	Schema.Struct({...Asked, ...PlanAsk.fields}),
	Schema.Struct({...Asked, ...StuckAsk.fields}),
	Schema.Struct({...Asked, ...RulingAsk.fields}),
]);
export type Ask = typeof Ask.Type;

/** The answers to a plan. `change`: one line, as the owner wants it; the planner writes the next version with it. */
export const PlanAnswer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("approve")}),
	Schema.Struct({kind: Schema.Literal("change"), line: Schema.String, to: Schema.String}),
	Schema.Struct({kind: Schema.Literal("no"), why: Schema.String.check(Schema.isNonEmpty())}),
]);
export type PlanAnswer = typeof PlanAnswer.Type;

/**
 * The answers to a stuck task. `keep_going` always has a limit, in rounds.
 * `reword` names a criterion and says it again; it goes back to open.
 */
export const StuckAnswer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("remove")}),
	Schema.Struct({
		kind: Schema.Literal("keep_going"),
		rounds: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 10})),
	}),
	Schema.Struct({
		kind: Schema.Literal("reword"),
		line: Schema.String,
		when: Schema.String,
		result: Schema.String,
	}),
]);
export type StuckAnswer = typeof StuckAnswer.Type;

/**
 * A ruling. `rule`: a lasting rule (it is also written as a decision record)
 * or a one-off call (the answer on the ticket is enough). `build`: the ruling
 * starts a plan. Every mix of the two is a real answer, so none is refused.
 */
export const RulingAnswer = Schema.Struct({
	kind: Schema.Literal("rule"),
	answer: Schema.String.check(Schema.isNonEmpty()),
	rule: Schema.Literals(["lasting", "one_off"]),
	build: Schema.Boolean,
});
export type RulingAnswer = typeof RulingAnswer.Type;

export const AnswerBody = Schema.Union([PlanAnswer, StuckAnswer, RulingAnswer]);
export type AnswerBody = typeof AnswerBody.Type;

/** An answer, under the id of the ask it answers. */
export const Answer = Schema.Struct({id: Schema.String, answer: AnswerBody});
export type Answer = typeof Answer.Type;

/** Which answers each kind of ask takes. */
export const KINDS = {
	plan: ["approve", "change", "no"],
	stuck: ["remove", "keep_going", "reword"],
	ruling: ["rule"],
} as const satisfies Record<Ask["for"], readonly AnswerBody["kind"][]>;

/** What the core does next with an answer it took. */
export const Next = Schema.Union([
	/** The plan is approved: build it. */
	Schema.Struct({do: Schema.Literal("build"), version: Schema.Int}),
	/** The planner writes the next version with this line as the owner wants it. */
	Schema.Struct({do: Schema.Literal("replan"), line: Schema.String, to: Schema.String}),
	/** The plan's tickets close, with the reason. */
	Schema.Struct({do: Schema.Literal("close"), why: Schema.String}),
	/** The task leaves the plan; the rest of it goes on. */
	Schema.Struct({do: Schema.Literal("remove_task"), task: Schema.Int}),
	/** The task goes on, for at most this many review rounds. */
	Schema.Struct({do: Schema.Literal("keep_going"), task: Schema.Int, rounds: Schema.Int}),
	/** The criterion is said again, and is open again. */
	Schema.Struct({
		do: Schema.Literal("reopen"),
		task: Schema.Int,
		line: Schema.String,
		text: Schema.String,
	}),
	/** The ruling is saved on the ticket. `record`: write a decision record. `plan`: plan what it says to build. */
	Schema.Struct({do: Schema.Literal("ruled"), record: Schema.Boolean, plan: Schema.Boolean}),
]);
export type Next = typeof Next.Type;

/** An answer the core took, with the ask it answered and what it does next. */
export const Settled = Schema.Struct({ask: Ask, answer: AnswerBody, next: Next});
export type Settled = typeof Settled.Type;

/** An answer the core did not take, and why. Nothing was saved. */
export const Refused = Schema.Struct({id: Schema.String, why: Schema.String});
export type Refused = typeof Refused.Type;

/** A short title for an ask, for a list. */
export function titleOf(ask: Ask): string {
	switch (ask.for) {
		case "plan":
			return ask.since === null
				? `Approve the plan for ${ask.plan}`
				: `Approve what changed in the plan for ${ask.plan} (v${ask.since.version} to v${ask.version})`;
		case "stuck":
			return `Task ${ask.task} of ${ask.plan} is stuck: ${ask.title}`;
		case "ruling":
			return `Rule on ${ask.ticket}`;
	}
}
