import {Schema} from "effect";
import {Version} from "../../criteria/book.ts";
import {entity, value} from "../../entity.ts";
import {CriterionId, QuestionId, StoryId, TaskId} from "../../ids.ts";

// A plan: what one ticket asks for, as data, kept outside any builder. Every
// ticket gets one, sized to the work: a small bug is one task that reads as a
// paragraph; an epic is a plan with many tasks. There is no separate machine
// for an epic.
//
//   {
//     summary: "Span times are read as epoch milliseconds, however small.",
//     stories: [
//       {id: "s1", who: "a host that traces runs", want: "spans to start at the clock it gave",
//        why: "a trace lines up with the rest of its system"},
//     ],
//     tasks: [{
//       id: "t1",
//       title: "Read every clock value as epoch milliseconds",
//       ends: "pr",
//       job: {
//         id: "c1", version: 1,
//         when: "a host runs three programs, twice, on a clock it starts at 1",
//         result: "every span of every run starts and ends at the clock values it was given",
//         fixture: "three programs, each run twice, on a fake clock starting at 1",
//         check: {how: "test", what: "a test runs them and reads every span's start and end"},
//         serves: ["s1"],
//       },
//       criteria: [],
//     }],
//     pointers: [{at: "packages/tea/src/otel/index.ts", why: "every span start and end is set here"}],
//     questions: [],
//   }
//
// Stories come first: who the ticket is for, and why. Every criterion names
// the stories it serves, and every story has a criterion (the Check holds
// both). Each task opens with its `job`: the user's whole job as one
// observable outcome, on a realistic fixture. It is a criterion, the first
// one, and the only one that may say more than one thing. The rest are one
// claim each, "When ‹when›, ‹result›". A criterion never names an internal
// file or function: those go in `pointers`, which bind nobody. A product call
// the ticket leaves open is not made quietly: it is a question with a lean.
//
// A plan comes in three forms, the same but for what each task and criterion
// carries:
//
//   PlanDraft  what the planner writes. No ids: an agent never names one. Its
//              stories' names are only words until a revision checks them.
//   Revision   a next version, written by code that holds the last one: a
//              task, a criterion or a question may name the id it `keeps`.
//   Plan       every task and criterion under the id (and every criterion
//              under the version) the plan's criteria book
//              (../../criteria/book.ts) gave it, and every question under
//              an id the plan's versions gave it. Only `withIds` (./ids.ts)
//              makes one.
//
// The plan itself is the ledger's `plan` id; each version of its words is a
// value. Its stories, tasks, criteria and questions are entities, each under
// an id of its own kind (../../ids.ts). Pointers and checks are values.

/** One kind of user the ticket touches: "As ‹who›, I want ‹want›, so that ‹why›." */
const storyFields = {who: Schema.String, want: Schema.String, why: Schema.String};

/** A story as the planner writes it: its name is only words until it is checked. */
export const DraftStory = Schema.Struct({id: Schema.String, ...storyFields});
export type DraftStory = typeof DraftStory.Type;

/** A story, under its id: short and stable (`s1`, `s2`). Criteria name a story by it, and it does not change when stories move. */
export const Story = entity(StoryId, storyFields);
export type Story = typeof Story.Type;

/** What a task ends in: a pull request (code lands), or an answer (an investigation's written findings). */
export const ENDS = ["pr", "answer"] as const;

/**
 * How someone will see a criterion hold. `test`: an automated test shows it.
 * `typecheck`: the compiler shows it. `run`: running a command shows it, and
 * `what` is the command. `read`: a reviewer reads it (wording, a doc page).
 */
export const HOWS = ["test", "typecheck", "run", "read"] as const;

export const Check = value({
	how: Schema.Literals(HOWS),
	/** What the check does, in words. For `run`, the command. */
	what: Schema.String,
});
export type Check = typeof Check.Type;

/** The fields of one observable claim: "When ‹when›, ‹result›." `serves`: the stories it serves, by `story`. */
const claimFields = <S extends Schema.Top>(story: S) => ({
	/** The trigger: what someone does, or what happens. Without the word "When". */
	when: Schema.String,
	/** The thing, and what someone can observe of it. (Not `then`: an object with `then` reads as a Promise.) */
	result: Schema.String,
	check: Check,
	/** The stories it serves. Never empty: a criterion that serves nobody cannot be written. */
	serves: Schema.NonEmptyArray(story),
});

/** A job's one field more than a claim: the realistic case it runs on. */
const jobFields = {
	/** The realistic case it runs on: more than two items, a second run, or a large input. Its shape, not its files. */
	fixture: Schema.String,
};

/** One observable claim, its words only, as the planner writes it. */
export const Criterion = Schema.Struct(claimFields(Schema.String));
export type Criterion = typeof Criterion.Type;

/**
 * A task's first criterion: the user's whole job, as one observable outcome on
 * a realistic fixture. It may say more than one thing; it is the run that ties
 * the single claims together.
 */
export const Job = Schema.Struct({...claimFields(Schema.String), ...jobFields});
export type Job = typeof Job.Type;

/** A file, a function or a test a builder may start from. Non-binding. */
export const Pointer = value({at: Schema.String, why: Schema.String});
export type Pointer = typeof Pointer.Type;

/** A product call the ticket leaves open. The plan is written with the lean. */
const questionFields = {
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	lean: Schema.String,
	why: Schema.String,
};

/** An open question as the planner writes it: no id. */
export const Question = value(questionFields);
export type Question = typeof Question.Type;

/** A task's fields but its criteria. */
const taskFields = {title: Schema.String, ends: Schema.Literals(ENDS)};

/** The parts of a plan in one form, around its tasks, stories and questions. */
const planOf = <T extends Schema.Top, S extends Schema.Top, Q extends Schema.Top>(
	task: T,
	story: S,
	question: Q,
) => ({
	summary: Schema.String,
	/** Who the ticket is for, in order. Never empty: a plan for nobody cannot be written. */
	stories: Schema.NonEmptyArray(story),
	/** In the order they are to be done. */
	tasks: Schema.Array(task),
	pointers: Schema.Array(Pointer),
	questions: Schema.Array(question),
});

// What the planner writes: no ids, its stories named in plain words.
const draftCriterion = Criterion;
const draftJob = Job;
const draftTask = Schema.Struct({
	...taskFields,
	job: draftJob,
	/** The single claims after the job. May be empty when the job says it all. */
	criteria: Schema.Array(draftCriterion),
});

// A next version: each task and criterion may name the id it keeps.
const keepsCriterion = {keeps: Schema.optionalKey(CriterionId)};
const revisedCriterion = value({...keepsCriterion, ...claimFields(StoryId)});
const revisedJob = value({...keepsCriterion, ...claimFields(StoryId), ...jobFields});
const revisedTask = value({
	keeps: Schema.optionalKey(TaskId),
	...taskFields,
	job: revisedJob,
	criteria: Schema.Array(revisedCriterion),
});
const revisedQuestion = value({keeps: Schema.optionalKey(QuestionId), ...questionFields});

// Every task, criterion and question under its id.
const numberedCriterion = entity(CriterionId, {version: Version, ...claimFields(StoryId)});
const numberedJob = entity(CriterionId, {version: Version, ...claimFields(StoryId), ...jobFields});
const numberedTask = entity(TaskId, {
	...taskFields,
	job: numberedJob,
	criteria: Schema.Array(numberedCriterion),
});
const numberedQuestion = entity(QuestionId, questionFields);

/** What the planner writes: a plan with no ids. */
export const PlanDraft = Schema.Struct(planOf(draftTask, DraftStory, Question));
export type PlanDraft = typeof PlanDraft.Type;
export const DraftTask = draftTask;
export type DraftTask = typeof DraftTask.Type;

/** A next version of a plan, from code that holds the last one: a task, a criterion or a question may name the id it keeps. */
export const Revision = value(planOf(revisedTask, Story, revisedQuestion));
export type Revision = typeof Revision.Type;
export type RevisedTask = typeof revisedTask.Type;
export type RevisedQuestion = typeof revisedQuestion.Type;

/** A criterion under its id, at the version it says. */
export const PlanCriterion = numberedCriterion;
export type PlanCriterion = typeof PlanCriterion.Type;
export const PlanJob = numberedJob;
export type PlanJob = typeof PlanJob.Type;
export const Task = numberedTask;
export type Task = typeof Task.Type;
/** An open question under its id. */
export const PlanQuestion = numberedQuestion;
export type PlanQuestion = typeof PlanQuestion.Type;

/** A plan whose every task and criterion has the id the criteria book gave it, and every question its own. */
export const Plan = value(planOf(numberedTask, Story, numberedQuestion));
export type Plan = typeof Plan.Type;

const toRevision = Schema.decodeUnknownOption(Revision);

/**
 * What the planner wrote, as the first version of a plan: every story's name
 * checked as a story id. `null`: one is not (the plan's Check says which).
 */
export const revisionOfDraft = (draft: PlanDraft): Revision | null => {
	const revision = toRevision(draft);
	return revision._tag === "Some" ? revision.value : null;
};

/** The words of a criterion or a job, whatever form it is in. */
type Claim = {readonly when: string; readonly result: string};

/** A criterion, or a job, as one sentence. The words a criteria book keeps for it. */
export const textOf = (c: Claim): string => `When ${c.when.trim()}, ${c.result.trim()}`;

/** A story as one sentence. */
export const storyText = (s: {
	readonly who: string;
	readonly want: string;
	readonly why: string;
}): string => `As ${s.who.trim()}, I want ${s.want.trim()}, so that ${s.why.trim()}`;

/** A task's criteria in order: its job first. */
export const criteriaOf = <C extends Claim>(task: {
	readonly job: C;
	readonly criteria: readonly C[];
}): readonly C[] => [task.job, ...task.criteria];

const wordsIn = (text: string): number => text.split(/\s+/).filter((w) => w !== "").length;

/** How big a plan is: its stories, its tasks, its criteria (jobs counted), and every word it says. */
export function sizeOf(plan: PlanDraft): {
	readonly stories: number;
	readonly tasks: number;
	readonly criteria: number;
	readonly words: number;
} {
	const texts = [
		plan.summary,
		...plan.stories.map(storyText),
		...plan.tasks.flatMap((t) => [
			t.title,
			t.job.fixture,
			...criteriaOf<Criterion>(t).flatMap((c) => [textOf(c), c.check.what]),
		]),
		...plan.pointers.flatMap((p) => [p.at, p.why]),
		...plan.questions.flatMap((q) => [q.ask, ...q.options, q.lean, q.why]),
	];
	return {
		stories: plan.stories.length,
		tasks: plan.tasks.length,
		criteria: plan.tasks.reduce((n, t) => n + 1 + t.criteria.length, 0),
		words: texts.reduce((n, text) => n + wordsIn(text), 0),
	};
}
