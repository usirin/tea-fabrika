import {Schema} from "effect";
import {Stated} from "../criteria/book.ts";
import {entity, value} from "../entity.ts";
import {AskId, CriterionId, Owner, PLAN, PlanId, TaskId, TicketId} from "../ids.ts";
import {Plan} from "../stages/plan/plan.ts";

// What the core asks the owner, and what it takes back. The core's own words:
// it emits an `Ask` and takes an `Answer`, and never knows who shows the one
// or gets the other (docs/direction/packs-are-programs.md). Elm's ports work
// the same way: the app owns the value types on both sides of a port.
//
//   {id: "plan:o/r#7@1", at: 3, for: "plan", plan: "o/r#7", version: 1, data: {...}, since: null, ...}
//   {id: "plan:o/r#7@1", answer: {kind: "approve"}}
//
// An ask is an entity, under an `AskId` (../ids.ts). It takes one answer,
// kept under the same id: the answer is the ask's, so it needs no id of its
// own. Four things wait on the owner, each with its own answers:
//
//   plan     approve | change one line | no, with a reason
//   stuck    remove the task | keep going N rounds | reword a criterion
//   ruling   the answer, with its branch: a lasting rule or a one-off, and
//            whether something must be built
//   check    yes | no, with a note: a look at one build that someone who
//            heard it asked for, with what they attached

/** An earlier version of a plan the owner approved: what a changed plan is shown against. */
export const Approved = value({version: Schema.Int, data: Plan});
export type Approved = typeof Approved.Type;

/** Its place in the ledger: the fact that raised it. Oldest first is smallest first. */
const at = Schema.Int;

/** The owner approves building a plan (docs/direction/sort-answers-yes-or-no.md, "Who approves building"). */
export const PlanAsk = entity(AskId, {
	at,
	for: Schema.Literal("plan"),
	/** The plan's id: the first ticket it covers. */
	plan: PlanId,
	tickets: Schema.Array(TicketId),
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
export const StuckAsk = entity(AskId, {
	at,
	for: Schema.Literal("stuck"),
	plan: PlanId,
	/**
	 * The task, or `plan`: the whole plan's list, which its last reviews and ship runs count. That
	 * one is no task to remove: it takes keep going or a reword.
	 */
	task: Owner,
	title: Schema.String,
	/** The criteria of the task now, each under its id and version, for a reword to name. */
	criteria: Schema.Array(Stated),
	/** How many were open after each review round of this task, oldest first. */
	open: Schema.Array(Schema.Int),
	/** `no_progress`: two rounds in a row left the list no shorter, or three in a row brought no new lowest. `ran_out`: the rounds a "keep going" gave are spent, and the list is no shorter. */
	why: Schema.Literals(["no_progress", "ran_out"]),
	/** 1 the first time this task is stuck, one more each time after. */
	time: Schema.Int,
});
export type StuckAsk = typeof StuckAsk.Type;

/** A ticket sort sent to the owner to rule on (sort-answers-yes-or-no.md, "The ruling route"). */
export const RulingAsk = entity(AskId, {
	at,
	for: Schema.Literal("ruling"),
	ticket: TicketId,
	/** The question, in one or two sentences. */
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	/** Why sort sent it here. */
	why: Schema.String,
});
export type RulingAsk = typeof RulingAsk.Type;

/** A file a check points the owner at: a picture, a video, a log. The core only carries it. */
export const Attachment = value({
	/** What it shows, in a few words: "before", "after", "the new page, 30 seconds". */
	label: Schema.String,
	/** Where it is: a path or url, as the one who made it wrote it. */
	ref: Schema.String,
});
export type Attachment = typeof Attachment.Type;

/**
 * A yes-or-no look at one build of one task, raised by anyone who hears the
 * build (an add-on pack, a script). The core does not know what is looked
 * at: it carries the question and the attachments as it got them, and holds
 * the build until the owner answers.
 */
export const CheckAsk = entity(AskId, {
	at,
	for: Schema.Literal("check"),
	plan: PlanId,
	task: TaskId,
	/** Which build of the task, from 1: one more each time it goes back to build. */
	build: Schema.Int,
	/** Who raised it, in their own words. Shown, never acted on. */
	by: Schema.String,
	question: Schema.String,
	attachments: Schema.Array(Attachment),
});
export type CheckAsk = typeof CheckAsk.Type;

/** Every ask. Its id is stable: the same ask always has the same id, so a second hearing of it is known. */
export const Ask = Schema.Union([PlanAsk, StuckAsk, RulingAsk, CheckAsk]);
export type Ask = typeof Ask.Type;

/**
 * The answers to a plan. `change`: one line, as the owner wants it; the
 * planner writes the next version with it. A task's or criterion's line is
 * its id.
 */
export const PlanAnswer = Schema.Union([
	value({kind: Schema.Literal("approve")}),
	value({kind: Schema.Literal("change"), line: Schema.String, to: Schema.String}),
	value({kind: Schema.Literal("no"), why: Schema.String.check(Schema.isNonEmpty())}),
]);
export type PlanAnswer = typeof PlanAnswer.Type;

/**
 * The answers to a stuck task. `keep_going` always has a limit, in rounds.
 * `reword` names a criterion by its id and says it again: a new version of
 * it, open until a review judges that version.
 */
export const StuckAnswer = Schema.Union([
	value({kind: Schema.Literal("remove")}),
	value({
		kind: Schema.Literal("keep_going"),
		rounds: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 10})),
	}),
	value({
		kind: Schema.Literal("reword"),
		criterion: CriterionId,
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
export const RulingAnswer = value({
	kind: Schema.Literal("rule"),
	answer: Schema.String.check(Schema.isNonEmpty()),
	rule: Schema.Literals(["lasting", "one_off"]),
	build: Schema.Boolean,
});
export type RulingAnswer = typeof RulingAnswer.Type;

/** The answers to a check: yes, or no with a note. The note becomes a new criterion of the task. */
export const CheckAnswer = Schema.Union([
	value({kind: Schema.Literal("yes")}),
	value({kind: Schema.Literal("no"), why: Schema.String.check(Schema.isNonEmpty())}),
]);
export type CheckAnswer = typeof CheckAnswer.Type;

export const AnswerBody = Schema.Union([PlanAnswer, StuckAnswer, RulingAnswer, CheckAnswer]);
export type AnswerBody = typeof AnswerBody.Type;

/** An answer, under the id of the ask it answers: an ask takes one, so the two share it. */
export const Answer = entity(AskId, {answer: AnswerBody});
export type Answer = typeof Answer.Type;

/** Which answers each kind of ask takes. */
export const KINDS = {
	plan: ["approve", "change", "no"],
	stuck: ["remove", "keep_going", "reword"],
	ruling: ["rule"],
	check: ["yes", "no"],
} as const satisfies Record<Ask["for"], readonly AnswerBody["kind"][]>;

/** What the core does next with an answer it took. */
export const Next = Schema.Union([
	/** The plan is approved: build it. */
	value({do: Schema.Literal("build"), version: Schema.Int}),
	/** The planner writes the next version with this line as the owner wants it. */
	value({do: Schema.Literal("replan"), line: Schema.String, to: Schema.String}),
	/** The plan's tickets close, with the reason. */
	value({do: Schema.Literal("close"), why: Schema.String}),
	/** The task leaves the plan; the rest of it goes on. */
	value({do: Schema.Literal("remove_task"), task: TaskId}),
	/** The task, or the whole plan's list, goes on, for at most this many review rounds. */
	value({do: Schema.Literal("keep_going"), task: Owner, rounds: Schema.Int}),
	/** The criterion is said again, under the same id, and is open again. */
	value({
		do: Schema.Literal("reopen"),
		task: Owner,
		criterion: CriterionId,
		text: Schema.String,
	}),
	/** The ruling is saved on the ticket. `record`: write a decision record. `plan`: plan what it says to build. */
	value({do: Schema.Literal("ruled"), record: Schema.Boolean, plan: Schema.Boolean}),
	/** The build was looked at and is fine: it ships, unless something else holds it. */
	value({do: Schema.Literal("ship"), task: TaskId, build: Schema.Int}),
	/** The build was looked at and is not right: the note is a new criterion of the task, and the task goes back to build. */
	value({do: Schema.Literal("rebuild"), task: TaskId, criterion: Schema.String}),
]);
export type Next = typeof Next.Type;

/** An answer the core took, with the ask it answered and what it does next. */
export const Settled = value({ask: Ask, answer: AnswerBody, next: Next});
export type Settled = typeof Settled.Type;

/** An answer the core did not take, and why. Nothing was saved. `id`: the ask it was for. */
export const Refused = Schema.Struct({id: AskId, why: Schema.String});
export type Refused = typeof Refused.Type;

/**
 * Everything that waits on the owner now, oldest first: said at the start and
 * whenever it changes. An `ask` says only what is new, and an ask can stop
 * waiting with no answer heard: a newer version of its plan came, or an
 * answer was taken while a listener was not running. Outputs are kept
 * nowhere, so a listener that keeps a list replaces it with this.
 */
export const Waiting = value({asks: Schema.Array(Ask)});
export type Waiting = typeof Waiting.Type;

/** A short title for an ask, for a list. */
export function titleOf(ask: Ask): string {
	switch (ask.for) {
		case "plan":
			return ask.since === null
				? `Approve the plan for ${ask.plan}`
				: `Approve what changed in the plan for ${ask.plan} (v${ask.since.version} to v${ask.version})`;
		case "stuck":
			return ask.task === PLAN
				? `The plan ${ask.plan} as a whole is stuck: ${ask.title}`
				: `Task ${ask.task} of ${ask.plan} is stuck: ${ask.title}`;
		case "ruling":
			return `Rule on ${ask.ticket}`;
		case "check":
			return `Check build ${ask.build} of task ${ask.task} of ${ask.plan}: ${ask.question}`;
	}
}
