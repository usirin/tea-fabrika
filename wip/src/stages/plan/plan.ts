import {Schema} from "effect";

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
//       title: "Read every clock value as epoch milliseconds",
//       ends: "pr",
//       job: {
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

/** One kind of user the ticket touches: "As ‹who›, I want ‹want›, so that ‹why›." */
export const Story = Schema.Struct({
	/** Short and stable (`s1`, `s2`): criteria name a story by it, and it does not change when stories move. */
	id: Schema.String,
	who: Schema.String,
	want: Schema.String,
	why: Schema.String,
});
export type Story = typeof Story.Type;

/** What a task ends in: a pull request (code lands), or an answer (an investigation's written findings). */
export const ENDS = ["pr", "answer"] as const;

/**
 * How someone will see a criterion hold. `test`: an automated test shows it.
 * `typecheck`: the compiler shows it. `run`: running a command shows it, and
 * `what` is the command. `read`: a reviewer reads it (wording, a doc page).
 */
export const HOWS = ["test", "typecheck", "run", "read"] as const;

export const Check = Schema.Struct({
	how: Schema.Literals(HOWS),
	/** What the check does, in words. For `run`, the command. */
	what: Schema.String,
});
export type Check = typeof Check.Type;

/** The ids of the stories a criterion serves. Never empty: a criterion that serves nobody cannot be written. */
export const Serves = Schema.NonEmptyArray(Schema.String);

/** One observable claim: "When ‹when›, ‹result›." */
export const Criterion = Schema.Struct({
	/** The trigger: what someone does, or what happens. Without the word "When". */
	when: Schema.String,
	/** The thing, and what someone can observe of it. (Not `then`: an object with `then` reads as a Promise.) */
	result: Schema.String,
	check: Check,
	serves: Serves,
});
export type Criterion = typeof Criterion.Type;

/**
 * A task's first criterion: the user's whole job, as one observable outcome on
 * a realistic fixture. It may say more than one thing; it is the run that ties
 * the single claims together.
 */
export const Job = Schema.Struct({
	...Criterion.fields,
	/** The realistic case it runs on: more than two items, a second run, or a large input. Its shape, not its files. */
	fixture: Schema.String,
});
export type Job = typeof Job.Type;

export const Task = Schema.Struct({
	title: Schema.String,
	ends: Schema.Literals(ENDS),
	job: Job,
	/** The single claims after the job. May be empty when the job says it all. */
	criteria: Schema.Array(Criterion),
});
export type Task = typeof Task.Type;

/** A file, a function or a test a builder may start from. Non-binding. */
export const Pointer = Schema.Struct({at: Schema.String, why: Schema.String});
export type Pointer = typeof Pointer.Type;

/** A product call the ticket leaves open. The plan is written with the lean. */
export const Question = Schema.Struct({
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	lean: Schema.String,
	why: Schema.String,
});
export type Question = typeof Question.Type;

export const Plan = Schema.Struct({
	summary: Schema.String,
	/** Who the ticket is for, in order. Never empty: a plan for nobody cannot be written. */
	stories: Schema.NonEmptyArray(Story),
	/** In the order they are to be done. */
	tasks: Schema.Array(Task),
	pointers: Schema.Array(Pointer),
	questions: Schema.Array(Question),
});
export type Plan = typeof Plan.Type;

/** A criterion, or a job, as one sentence. */
export const textOf = (c: Criterion): string => `When ${c.when.trim()}, ${c.result.trim()}`;

/** A story as one sentence. */
export const storyText = (s: Story): string =>
	`As ${s.who.trim()}, I want ${s.want.trim()}, so that ${s.why.trim()}`;

/** A task's criteria in order: its job first. */
export const criteriaOf = (task: Task): readonly Criterion[] => [task.job, ...task.criteria];

const wordsIn = (text: string): number => text.split(/\s+/).filter((w) => w !== "").length;

/** How big a plan is: its stories, its tasks, its criteria (jobs counted), and every word it says. */
export function sizeOf(plan: Plan): {
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
			...criteriaOf(t).flatMap((c) => [textOf(c), c.check.what]),
		]),
		...plan.pointers.flatMap((p) => [p.at, p.why]),
		...plan.questions.flatMap((q) => [q.ask, ...q.options, q.lean, q.why]),
	];
	return {
		stories: plan.stories.length,
		tasks: plan.tasks.length,
		criteria: plan.tasks.reduce((n, t) => n + criteriaOf(t).length, 0),
		words: texts.reduce((n, text) => n + wordsIn(text), 0),
	};
}
