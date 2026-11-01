import type {Ended} from "@kampus/fabrika-old";
import {Cause} from "effect";
import {inert} from "../build/body.ts";
import type {ExamChange} from "../exam/machine.ts";
import {textOf} from "../plan/plan.ts";
import {questionLines} from "../plan/render.ts";
import type {Finding} from "../review/sheet.ts";
import type {Found} from "../test-writer/checked.ts";
import type {MutantAnswer} from "../test-writer/mutants.ts";
import {Surprise} from "../test-writer/outcome.ts";
import type {Answer} from "../test-writer/written.ts";
import {listed} from "./briefs.ts";
import type {Carry, Through, Untested} from "./machine.ts";

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

const NOTHING: Through = {findings: [], mutants: []};

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

/**
 * The findings and mutants a person let through, for the merge question and the pull request.
 * Nothing let through: nothing said.
 */
export const throughWords = ({findings, mutants}: Through = NOTHING): readonly string[] => [
	...(findings.length === 0
		? []
		: [
				"A person let these findings through, on a call that their decision stands:",
				listed(findings.map((row) => inert(row.fault))),
			]),
	...(mutants.length === 0
		? []
		: [
				"A person let these mutants live, as no test can see the change:",
				listed(mutants.map((row) => inert(`\`${row.mutant}\`: ${row.why}`))),
			]),
];

/** The line for a lane's program that broke, so it never ends without a word. Any other end: none. */
export const brokeWords = (n: number, end: Ended<unknown>): readonly string[] =>
	end.kind === "failed"
		? [`#${n} broke: ${Cause.pretty(end.cause).split("\n")[0] ?? "no reason given"}`]
		: [];

/** Each rule change, as the plan says it: which file, what changes, and why. */
export const ruleChangeLines = (changes: readonly ExamChange[]): readonly string[] =>
	changes.map((c) => `- \`${c.path}\`: ${inert(c.change)} Why: ${inert(c.why)}`);

/**
 * What a person decided at the plan, for a brief: each question with its lean, under its id, and
 * what they wrote beside their answers. A lane saved before this was kept has only its plan's leans,
 * with no ids, so no finding can name one. Pure.
 */
export const decidedWords = (carry: Pick<Carry, "plan" | "decided">): string => {
	const questions = carry.decided?.questions ?? [];
	const leans =
		questions.length > 0
			? questionLines({questions})
			: (carry.plan?.questions ?? []).map((q) => `- ${q.ask} Lean: ${q.lean}`);
	const said = carry.decided?.said ?? [];
	if (leans.length === 0 && said.length === 0) return "None.";
	return [
		...(leans.length === 0
			? []
			: [
					"A person approved the plan, and that yes took the lean on each question here:",
					...leans,
				]),
		...(said.length === 0 ? [] : ["What the person wrote beside their answers:", listed(said)]),
	].join("\n");
};

/** Both sides of each finding against a decision, for the person who made it. Pure. */
export const againstWords = (
	carry: Pick<Carry, "decided">,
	against: readonly Finding[],
): readonly string[] => [
	"The review says a decision you made on the plan is wrong.",
	...against.flatMap((finding) => {
		const {from} = finding;
		const question =
			from.source === "decision"
				? carry.decided?.questions.find((q) => q.id === from.id)
				: undefined;
		return [
			"",
			...(question === undefined
				? []
				: [`You decided: ${inert(question.ask)} ${inert(question.lean)}`]),
			`The review says: ${inert(finding.fault)}`,
			`What it shows: ${inert(finding.proof)}`,
			`What it wants: ${inert(finding.wants)}`,
		];
	}),
	...((carry.decided?.said ?? []).length === 0
		? []
		: ["", "You also wrote:", listed((carry.decided?.said ?? []).map(inert))]),
];

/** Each task's job, and the plan's own: the whole thing a user does, with its real values. */
export const jobsList = (plan: Carry["plan"]): string =>
	listed(
		[
			...(plan?.tasks ?? []).map((task) => ({title: task.title, job: task.job})),
			...(plan?.goal === undefined ? [] : [{title: "The whole plan", job: plan.goal.job}]),
		].map(({title, job}) => `${title}: ${textOf(job)} (Fixture: ${job.fixture})`),
	);
