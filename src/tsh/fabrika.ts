import {Layer, Schema} from "effect";
import {type Accounts, gitHubCodeHost} from "../code-host-github.ts";
import {defineProgram} from "../program/program.ts";
import {flag} from "../program/shape.ts";
import type {CodeHost} from "../services.ts";
import type {Brief} from "../stages/review/gate.ts";
import {createReviewProgram, reviewProgram} from "../stages/review/program.ts";
import {liveReviewer, noRun} from "../stages/review/reviewer.ts";
import {scriptedReviewer} from "../stages/review/scripted.ts";
import type {Form} from "../stages/review/sheet.ts";
import {noWrites} from "../stages/ship/launch.ts";
import {shipProgram} from "../stages/ship/program.ts";
import {type Entry, listed} from "./programs.ts";

// fabrika's own programs, as tsh lists them: ship and review, over GitHub.
//
// tsh never writes to GitHub. That is held twice, by structure, not by a
// warning:
//
//   - its `ship` takes `--mode read` alone. `--mode write` does not fit the
//     flag's shape, so the line is refused before anything starts, like any
//     value that does not fit.
//   - it is listed with `noWrites` as its write side: a write would die, and
//     there is no other write side in this file to give it.
//
// `review-scripted` is the review program with its reviewer scripted: the
// pack is read from GitHub for real, the gate runs for real, and where the
// agent would grade, a script hands back a form that passes every criterion.
// It costs nothing and proves the wiring, not the review. `review`, with a
// live agent, is listed only when the launcher is given a clone to read code
// from.
//
//   review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1 \
//       pr=https://github.com/<o>/<r>/pull/<n> | ship --mode read

/** ship, read only: the same program, with a mode flag that takes `read` and nothing else. */
export const shipReadOnly = defineProgram({
	...shipProgram,
	description: `${shipProgram.description} In tsh it only reads: its mode takes read alone.`,
	flags: {
		mode: flag(
			Schema.Literals(["read"]),
			"read: change nothing, say what the machine would send. tsh has no write mode: it never writes to GitHub.",
		),
	},
});

/** A form that passes every criterion, worked out from the brief alone. */
const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass",
		where: [{file: brief.files[0]?.path ?? "README.md", first: 1, last: 1}],
		says: "Scripted: it does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "Everything", why: "A scripted reviewer reads nothing."}],
});

const scripted = createReviewProgram();
/** review, with a scripted reviewer that passes every criterion. Everything else is the review program's own. */
export const reviewScripted = defineProgram({
	...scripted,
	name: "review-scripted",
	description:
		"The review program with a scripted reviewer: it reads each pull request from GitHub and runs the gate for real, then passes every criterion without reading the code. It costs nothing. It proves the wiring, not a review.",
});

export interface FabrikaSettings extends Accounts {
	/** A local clone the live reviewer reads code from. Left out: no live `review` is listed. */
	readonly clone?: string;
}

/**
 * ship (read only) and review-scripted, over GitHub; review with a live agent
 * when there is a clone to read. `reads`: the GitHub reader, made fresh for
 * each run; a test stands in one over recorded answers.
 */
export function fabrikaEntries(
	settings: FabrikaSettings,
	reads: () => Layer.Layer<CodeHost> = () =>
		gitHubCodeHost({own: settings.own, reviewers: settings.reviewers}),
): readonly Entry[] {
	const host = reads;
	const reviewer = () =>
		scriptedReviewer((brief) => ({answer: "form", form: passing(brief), ...noRun})).layer;
	const entries = [
		listed(
			shipReadOnly,
			Layer.suspend(() => Layer.mergeAll(host(), noWrites)),
		),
		listed(
			reviewScripted,
			Layer.suspend(() => Layer.mergeAll(host(), reviewer())),
		),
	];
	const {clone} = settings;
	if (clone === undefined) return entries;
	return [
		...entries,
		listed(
			reviewProgram,
			Layer.suspend(() => Layer.mergeAll(host(), liveReviewer({repo: clone}))),
		),
	];
}
