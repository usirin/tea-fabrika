import {run} from "@demlik/tea/effect";
import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Send, type Watch} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {nameOf} from "../outcome.ts";
import {PullRequestUrl} from "../ship/program.ts";
import {reviewReadInterpret, reviewSubscribe} from "./handlers.ts";
import {type fileNote, Report, review} from "./machine.ts";
import {REVIEW_NAMES, ReviewOutcome} from "./outcome.ts";
import type {Ask} from "./pack.ts";
import {EFFORTS, type Settings} from "./reviewer.ts";
import {Place} from "./sheet.ts";

// The review program: the thing you start to review pull requests. It is
// started once, with its settings as flags, and then told pull requests on
// its input `pr` for as long as it runs. Each gets a fresh run of the review
// machine (./machine.ts), one at a time: the machine takes one pull request
// from start to end, and the program is what keeps running.
//
// It only reads. Its one Act, filing a note the reviewer made, is answered
// here by sending the note on the output `note`: nothing is posted anywhere.
//
// Its output `passed` is the url of each pull request that met every
// criterion, in the shape the ship program's input `pr` takes, so
// `review | ship` is one `pipe`.
//
// It asks for `CodeHost` and `Reviewer` through Effect's context. Whoever
// starts it provides them: GitHub and the Agent SDK for `run.ts`
// (./launch.ts), fakes and a scripted reviewer for a test. Where the live
// reviewer finds its code (a local clone) is that service's setting, like
// ship's `--own`: a fact about where the program runs, not about a review.

/**
 * A pull request, or one commit of it to review again. The second form is a
 * replay: a merged pull request can only be reviewed that way.
 */
export const ReviewTarget = Schema.String.check(
	Schema.isPattern(
		/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(\/commits\/[0-9a-f]{40})?$/,
		{
			message:
				"not a pull request url: it looks like https://github.com/<owner>/<repo>/pull/<number>, or that with /commits/<the whole commit>",
		},
	),
).annotate({
	description:
		"https://github.com/<owner>/<repo>/pull/<number>, or .../pull/<number>/commits/<40-character commit> to review that commit again",
});

/** What the machine is asked, from a url its input took. */
export function askOf(url: string, rubrics: string): Ask {
	const at = url.indexOf("/commits/");
	return at === -1
		? {pr: url, head: null, rubrics}
		: {pr: url.slice(0, at), head: url.slice(at + "/commits/".length), rubrics};
}

/** How one review ended: its outcome, how that is spelled, and the report it was worked out from. */
export const Reviewed = Schema.Struct({
	pr: Schema.String,
	outcome: ReviewOutcome,
	name: Schema.Literals(REVIEW_NAMES),
	...Report.fields,
});
export type Reviewed = typeof Reviewed.Type;

/** A note the reviewer filed, as it is filed. */
export const Filed = Schema.Struct({
	pr: Schema.String,
	id: Schema.String,
	title: Schema.String,
	body: Schema.String,
	at: Schema.NullOr(Place),
});
export type Filed = typeof Filed.Type;

type ReviewMachines = {readonly review: typeof review};

/** The machine to its end, shown on the handle while it runs. Its notes go out on `note` as they are filed. */
const toTheEnd = (
	ask: Ask,
	settings: Settings,
	machine: typeof review,
	watch: Watch<ReviewMachines>,
	send: Send<Outputs>,
) =>
	Effect.gen(function* () {
		const handle = yield* run(machine, {
			ctx: undefined,
			interpret: {
				...reviewReadInterpret,
				review_file_note: (cmd: ReturnType<typeof fileNote>) =>
					send("note", {pr: cmd.pr, id: cmd.id, ...cmd.note}).pipe(Effect.as("kept" as const)),
			},
			subscribe: reviewSubscribe,
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* watch("review", runtime);
		yield* runtime.dispatch({type: "start", ask, settings});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

const OUTPUTS = {
	verdict: output(
		Reviewed,
		"Once per pull request: the outcome, each criterion met or open with what shows it, the verdict of each kind, the notes filed, and what the reviewer cost.",
	),
	passed: output(
		PullRequestUrl,
		"The url of each pull request that met every criterion at its head now. Not sent for a replay of an older commit. Pipe it into ship's `pr`.",
	),
	note: output(
		Filed,
		"Each note the reviewer filed while it worked: something worth fixing that this change did not cause. Kept here, posted nowhere.",
	),
};
type Outputs = typeof OUTPUTS;

/** The review program over a given review machine. `machine`: one with other limits, for a test. */
export const createReviewProgram = (machine = review) =>
	defineProgram({
		name: "review",
		description:
			"Reviews pull requests, one after another, as it is told them: reads each one, stops where code can, and otherwise has one agent grade it against its ticket. It only reads, and posts nothing.",
		flags: {
			rubrics: flag(
				Schema.String,
				"The folder the rubric texts are read from: code.md, doc.md, skill.md.",
			),
			model: flag(Schema.String, "The model the reviewer runs on."),
			effort: flag(Schema.Literals(EFFORTS), "How hard the reviewer thinks."),
			budget: flag(
				Schema.Finite.check(Schema.isGreaterThan(0)),
				"The dollars one reviewer run may cost before it is stopped.",
			),
		},
		inputs: {
			pr: input(
				ReviewTarget,
				"A pull request to review. Tell it any time: each gets a fresh run of the review machine once the one before has ended.",
			),
		},
		outputs: OUTPUTS,
		machines: {review: machine},
		main: ({flags, inputs, send, watch}) =>
			inputs.pr.pipe(
				Stream.runForEach((url) =>
					Effect.gen(function* () {
						const ask = askOf(url, flags.rubrics);
						const settings = {model: flags.model, effort: flags.effort, budget: flags.budget};
						const end = yield* toTheEnd(ask, settings, machine, watch, send);
						const {outcome, report} = end;
						yield* send("verdict", {pr: ask.pr, outcome, name: nameOf(outcome), ...report});
						if (outcome.kind === "done" && !report.replay) yield* send("passed", ask.pr);
					}),
				),
			),
	});

/** The review program, on a review machine with every limit at its default. */
export const reviewProgram = createReviewProgram();
