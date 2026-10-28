import {endedAs} from "@kampus/pipeline/stages/status";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";

// The plan's nine steps for one ticket, each with where it stands, read off the ticket's facts
// alone (docs/direction/a-ticket-runs-from-the-app.md: the parent's children, with the owner's
// approval between plan and test writer). The ticket, map and trace programs draw from it.
//
//   stepsOf(timeline)
//   // [{step: "triage", state: "done", runs: 1, usd: 0.11, last: "sent to plan: yes"},
//   //  {step: "plan", state: "done", ...}, {step: "approval", state: "you", last: "approve plan v1"},
//   //  {step: "test_writer", state: "none", runs: 0, usd: 0, last: null}, ...]
//
// A step is a stage's name on `started` and `ended`, except `approval`: no run, only an ask. The
// approval is the ask whose picks hold "approve", the button the parent's approval box has.

/** The nine, in the order a lane runs them. */
export const STEPS = [
	"triage",
	"plan",
	"approval",
	"test_writer",
	"build",
	"mutation",
	"review",
	"push",
	"merge",
] as const;
export const StepName = Schema.Literals(STEPS);
export type StepName = typeof StepName.Type;

/**
 * `none`: no run yet. `running`: a run started and has not ended. `you`: it waits on a person.
 * `stuck`: its last run ended stuck. `done`: its last run ended any other way.
 */
export const StepState = Schema.Literals(["none", "running", "you", "stuck", "done"]);
export type StepState = typeof StepState.Type;

export const StepNow = Schema.Struct({
	step: StepName,
	state: StepState,
	/** How many runs it had. For the approval: how many asks. */
	runs: Schema.Int,
	/** What its runs cost, from each `ended`. */
	usd: Schema.Finite,
	/** Its last word, as a row says it: "sent to plan: yes", "running, task t-2". `null`: none yet. */
	last: Schema.NullOr(Schema.String),
});
export type StepNow = typeof StepNow.Type;

/** A step's name in words: `test_writer` reads `test writer`. */
export const stepWords = (step: string): string => step.replaceAll("_", " ");

/** Is this ask the parent's approval box: one of its picks is "approve". */
const isApproval = (picks: readonly string[]) => picks.includes("approve");

const approvalOf = (timeline: readonly Entry[]): StepNow => {
	const asks = timeline.flatMap((e) =>
		e.fact.type === "asked" && isApproval(e.fact.picks) ? [e.fact] : [],
	);
	const last = asks.at(-1);
	if (last === undefined) return {step: "approval", state: "none", runs: 0, usd: 0, last: null};
	const answer = timeline.findLast(
		(e) => e.fact.type === "answered" && e.fact.ask === last.ask,
	)?.fact;
	return answer?.type === "answered"
		? {step: "approval", state: "done", runs: asks.length, usd: 0, last: `answered: ${answer.pick}`}
		: {step: "approval", state: "you", runs: asks.length, usd: 0, last: last.what};
};

const stageOf = (step: StepName, timeline: readonly Entry[]): StepNow => {
	const started = timeline.flatMap((e) =>
		e.fact.type === "started" && e.fact.stage === step ? [e.fact] : [],
	);
	const ended = timeline.flatMap((e) =>
		e.fact.type === "ended" && e.fact.stage === step ? [e.fact] : [],
	);
	const usd = ended.reduce((sum, e) => sum + e.usd, 0);
	const done = new Set(ended.map((e) => e.run));
	const open = started.findLast((s) => !done.has(s.run));
	if (open !== undefined)
		return {
			step,
			state: "running",
			runs: started.length,
			usd,
			last: open.task === null ? "running" : `running, task ${open.task}`,
		};
	const last = ended.at(-1);
	if (last === undefined) return {step, state: "none", runs: started.length, usd, last: null};
	return {
		step,
		state: last.outcome.kind === "stuck" ? "stuck" : "done",
		runs: started.length,
		usd,
		last: endedAs(last.outcome, "done"),
	};
};

/** The nine steps of one ticket, in order, from its facts. */
export const stepsOf = (timeline: readonly Entry[]): readonly StepNow[] =>
	STEPS.map((step) => (step === "approval" ? approvalOf(timeline) : stageOf(step, timeline)));

/** The step a ticket is at: the one running or waiting on a person, else `null`. */
export const currentOf = (steps: readonly StepNow[]): StepNow | null =>
	steps.find((s) => s.state === "running" || s.state === "you" || s.state === "stuck") ?? null;
