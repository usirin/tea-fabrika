import {Schema} from "effect";

// A plan: what one ticket asks for, as data, kept outside any builder. Every
// ticket gets one, sized to the work: a small bug is one task that reads as a
// paragraph; an epic is a plan with many tasks. There is no separate machine
// for an epic.
//
//   {
//     summary: "Span times are read as epoch milliseconds, however small.",
//     tasks: [{
//       title: "Read every clock value as epoch milliseconds",
//       ends: "pr",
//       criteria: [{
//         when: "a run's clock starts at a value smaller than the time since the process started",
//         result: "the root span starts at exactly that clock value",
//         check: {how: "test", what: "a test that starts the clock at 1 and reads the root span's start"},
//       }],
//     }],
//     pointers: [{at: "packages/tea/src/otel/index.ts", why: "every span start and end is set here"}],
//     questions: [],
//   }
//
// A criterion is an outcome: one claim someone can observe, in the shape
// "When ‹when›, ‹result›". It never names a file or a function: those go in
// `pointers`, which bind nobody. A product call the ticket leaves open is not
// made quietly: it is a question with a lean.

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

/** One observable claim: "When ‹when›, ‹result›." */
export const Criterion = Schema.Struct({
	/** The trigger: what someone does, or what happens. Without the word "When". */
	when: Schema.String,
	/** The thing, and what someone can observe of it. (Not `then`: an object with `then` reads as a Promise.) */
	result: Schema.String,
	check: Check,
});
export type Criterion = typeof Criterion.Type;

export const Task = Schema.Struct({
	title: Schema.String,
	ends: Schema.Literals(ENDS),
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
	/** In the order they are to be done. */
	tasks: Schema.Array(Task),
	pointers: Schema.Array(Pointer),
	questions: Schema.Array(Question),
});
export type Plan = typeof Plan.Type;

/** A criterion as one sentence. */
export const textOf = (c: Criterion): string => `When ${c.when.trim()}, ${c.result.trim()}`;

const wordsIn = (text: string): number => text.split(/\s+/).filter((w) => w !== "").length;

/** How big a plan is: its tasks, its criteria, and every word it says. */
export function sizeOf(plan: Plan): {
	readonly tasks: number;
	readonly criteria: number;
	readonly words: number;
} {
	const texts = [
		plan.summary,
		...plan.tasks.flatMap((t) => [
			t.title,
			...t.criteria.flatMap((c) => [textOf(c), c.check.what]),
		]),
		...plan.pointers.flatMap((p) => [p.at, p.why]),
		...plan.questions.flatMap((q) => [q.ask, ...q.options, q.lean, q.why]),
	];
	return {
		tasks: plan.tasks.length,
		criteria: plan.tasks.reduce((n, t) => n + t.criteria.length, 0),
		words: texts.reduce((n, text) => n + wordsIn(text), 0),
	};
}
