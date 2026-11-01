import {inert} from "../build/body.ts";
import {textOf} from "../plan/plan.ts";
import type {Found} from "../test-writer/checked.ts";
import type {MutantAnswer} from "../test-writer/mutants.ts";
import {Surprise} from "../test-writer/outcome.ts";
import type {Answer} from "../test-writer/written.ts";
import {listed} from "./briefs.ts";
import type {Carry, Untested} from "./machine.ts";

// What a step found, in the words a person or an agent reads it in. Today's version. All pure: the
// lane's program writes these on the ticket, in a pull request's body and in a brief.
//
//   {property: "p1", for: "cannot_test"}  and  {when: "Three titles are converted", why: "No inputs."}
//
//   The test writer says no test can check these:
//   - Three titles are converted: No inputs.

const HEADS: Readonly<Record<Surprise, string>> = {
	cannot_test: "The test writer says no test can check these:",
	already_passes: "These new tests already pass on the code as it is, so they show nothing yet:",
	fails_on_base: "These tests of what should already work fail on the code as it is:",
};

type Named = {readonly id: string; readonly when: string};

/** Each Property the writer says no test can check, and its reason. */
export const untestedRows = (
	properties: readonly Named[],
	answers: readonly Answer[],
): readonly Untested[] =>
	answers.flatMap((answer) =>
		answer.kind === "cannot"
			? [
					{
						when: properties.find((p) => p.id === answer.property)?.when ?? answer.property,
						why: answer.why,
					},
				]
			: [],
	);

/** What the test writer found, each surprise under its own sentence. Nothing found: nothing said. */
export const foundWords = (
	properties: readonly Named[],
	found: readonly Found[],
	answers: readonly Answer[],
): readonly string[] =>
	Surprise.literals.flatMap((surprise) => {
		const rows = found
			.filter((row) => row.for === surprise)
			.map((row) => {
				const when = properties.find((p) => p.id === row.property)?.when ?? row.property;
				const said = answers.find((a) => a.kind === "cannot" && a.property === row.property);
				return inert(said?.kind === "cannot" ? `${when}: ${said.why}` : when);
			});
		return rows.length === 0 ? [] : [HEADS[surprise], listed(rows)];
	});

/** Why the mutants' writer says no test can tell these mutants from the code. */
export const mutantWords = (answers: readonly MutantAnswer[]): readonly string[] => {
	const rows = answers.flatMap((a) =>
		a.answer === "cannot" ? [inert(`\`${a.mutant}\`: ${a.why}`)] : [],
	);
	return rows.length === 0
		? []
		: ["These mutants lived, and the test writer says no test can see the change:", listed(rows)];
};

/** The Properties a person let through, for the ticket and the pull request. */
export const untestedWords = (rows: readonly Untested[]): readonly string[] =>
	rows.length === 0
		? []
		: [
				"No test checks these properties. A person said to go on without one:",
				listed(rows.map((row) => inert(`${row.when}: ${row.why}`))),
			];

/** Each task's job, and the plan's own: the whole thing a user does, with its real values. */
export const jobsList = (plan: Carry["plan"]): string =>
	listed(
		[
			...(plan?.tasks ?? []).map((task) => ({title: task.title, job: task.job})),
			...(plan?.goal === undefined ? [] : [{title: "The whole plan", job: plan.goal.job}]),
		].map(({title, job}) => `${title}: ${textOf(job)} (Fixture: ${job.fixture})`),
	);
