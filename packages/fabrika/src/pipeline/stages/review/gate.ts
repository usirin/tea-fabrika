import {Schema} from "effect";
import {RepoRule} from "../rules.ts";
import type {ReviewOutcome} from "./outcome.ts";
import {
	ChangedFile,
	Checks,
	Criterion,
	Deviations,
	isTextKind,
	Kind,
	type Pack,
	TextKind,
} from "./pack.ts";

// The Check before the reviewer: is there anything to review, and is the
// pack whole. Pure: same pack in, same answer out. A reviewer costs dollars
// and minutes, so every stop that code can see is taken here first.
//
// The order of the lines is a choice. The tests beside this file pin it.

/**
 * A pack with every unknown ruled out: what the reviewer is handed. Each
 * part the pack may lack is here without its `null`, so the code after the
 * gate never asks "was this read" a second time. A schema, since the review
 * machine keeps it in its state and hands it to the reviewer in a Cmd.
 */
export const Brief = Schema.Struct({
	pr: Schema.String,
	head: Schema.String,
	ticket: Schema.Struct({id: Schema.String, link: Schema.Literals(["closes_it", "part_of_it"])}),
	/** At least one. */
	criteria: Schema.NonEmptyArray(Criterion),
	files: Schema.Array(ChangedFile),
	diff: Schema.String,
	deviations: Deviations,
	checks: Checks,
	/** The text reviews the change owes: the ones this stage does. */
	kinds: Schema.Array(TextKind),
	/** The other kinds it owes. This stage does not do them, and says so. */
	left: Schema.Array(Kind),
	/** One per kind in `kinds`, each with its text. */
	rubrics: Schema.Array(Schema.Struct({kind: TextKind, text: Schema.String})),
	/** The repository's own rules for agents, from the base branch. The reviewer holds the change to them too. */
	rules: Schema.Array(RepoRule),
});
export type Brief = typeof Brief.Type;

export type ReviewGate =
	| {readonly answer: "go"; readonly brief: Brief}
	/**
	 * Not yet: a required check is still running, or none has reported. That
	 * is no problem, only early, so it is not an outcome. A machine would wait
	 * here. This piece has none, and says that it does not wait.
	 */
	| {readonly answer: "wait_for_checks"; readonly head: string}
	| {readonly answer: "stop"; readonly outcome: ReviewOutcome};

const stop = (outcome: ReviewOutcome): ReviewGate => ({answer: "stop", outcome});
const stuck = (why: Extract<ReviewOutcome, {kind: "stuck"}>["why"]) => stop({kind: "stuck", why});

/** Go, wait, or the one reason not to. */
export function reviewGate(pack: Pack): ReviewGate {
	// On a replay the state is today's, not the head's: a merged pull request is what a replay is for.
	if (!pack.replay && pack.state !== "open") return stop({kind: "skip", why: pack.state});
	// Red comes before everything a reviewer needs: a red head goes back whatever else is missing.
	if (pack.checks.state === "red") return stop({kind: "send", to: "builder", why: "checks_red"});
	if (pack.ticket === "none") return stop({kind: "send", to: "builder", why: "no_ticket"});
	if (pack.files === null || pack.diff === null) return stuck("diff_unknown");
	if (pack.kinds === null) return stuck("kinds_unknown");
	if (pack.criteria === null) return stuck("ticket_unknown");
	const [first, ...rest] = pack.criteria;
	if (first === undefined) return stuck("no_criteria");
	const kinds = pack.kinds.filter(isTextKind);
	const rubrics = kinds.flatMap((kind) => {
		const text = pack.rubrics.find((rubric) => rubric.kind === kind)?.text ?? null;
		return text === null ? [] : [{kind, text}];
	});
	if (rubrics.length !== kinds.length) return stuck("rubric_unknown");
	if (pack.checks.state === "unknown") return stuck("checks_unknown");
	if (pack.checks.state === "pending") return {answer: "wait_for_checks", head: pack.head};
	return {
		answer: "go",
		brief: {
			pr: pack.pr,
			head: pack.head,
			ticket: pack.ticket,
			criteria: [first, ...rest],
			files: pack.files,
			diff: pack.diff,
			deviations: pack.deviations,
			checks: pack.checks,
			kinds,
			left: pack.kinds.filter((kind) => !isTextKind(kind)),
			rubrics,
			rules: pack.rules,
		},
	};
}
