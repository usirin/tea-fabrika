import {defineProgram} from "@tea-fabrika/tea-program";
import {type Entry, listed} from "@tea-fabrika/tea-program/listed";
import {Layer} from "effect";
import {type Accounts, gitHubCodeHost, prOf} from "../code-host-github.ts";
import type {CodeHost} from "../services.ts";
import {liveBuilder} from "../stages/build/builder.ts";
import {liveAcpBuilder} from "../stages/build/builder-acp.ts";
import {cloneIn, gitHubBuild} from "../stages/build/github.ts";
import {buildProgram} from "../stages/build/program.ts";
import {operateProgram} from "../stages/operate/program.ts";
import {gitHubLoopWrites} from "../stages/operate/writes.ts";
import type {Brief} from "../stages/review/gate.ts";
import {createReviewProgram, reviewProgram} from "../stages/review/program.ts";
import {liveReviewer, noRun} from "../stages/review/reviewer.ts";
import {scriptedReviewer} from "../stages/review/scripted.ts";
import type {Form} from "../stages/review/sheet.ts";
import {shipProgram} from "../stages/ship/program.ts";

// fabrika's own programs, as tsh lists them: ship and review, over GitHub,
// and build and operate, which write to the repository each ticket names.
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
	/**
	 * The folder build and operate keep their clones and working copies in, one
	 * folder per repository. Left out: neither is listed.
	 */
	readonly work?: string;
}

/**
 * build and operate: the programs that make a change. Each writes to the
 * repository its ticket's url names. operate's reviewer reads the clone build
 * made of that repository, and its reader waits on every check, not only the
 * required one.
 */
export function writingEntries(settings: Accounts & {readonly work: string}): readonly Entry[] {
	const {work} = settings;
	const reads = () =>
		gitHubCodeHost({own: settings.own, reviewers: settings.reviewers, checks: "every"});
	/** The clone that holds a pull request's commits: the one build pushed them from. */
	const cloneOf = (pr: string) => {
		const at = prOf(pr);
		return at === null ? work : cloneIn(work, at);
	};
	return [
		listed(
			buildProgram,
			// The ACP builder too, for `build --harness acp` (experiment 77): it starts nothing until a build asks for it.
			Layer.suspend(() => Layer.mergeAll(gitHubBuild({work}), liveBuilder(), liveAcpBuilder())),
		),
		listed(
			operateProgram,
			Layer.suspend(() =>
				Layer.mergeAll(
					reads(),
					gitHubBuild({work}),
					liveBuilder(),
					liveReviewer({repo: cloneOf}),
					gitHubLoopWrites(),
				),
			),
		),
	];
}

/**
 * ship and review-scripted, over GitHub; review with a live agent when there
 * is a clone to read; build and operate when there is a folder to work in.
 * `reads`: the GitHub reader, made fresh for each run; a test stands in one
 * over recorded answers.
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
			shipProgram,
			Layer.suspend(() => Layer.mergeAll(host(), gitHubLoopWrites())),
		),
		listed(
			reviewScripted,
			Layer.suspend(() => Layer.mergeAll(host(), reviewer())),
		),
	];
	const {clone, work} = settings;
	const live =
		clone === undefined
			? []
			: [
					listed(
						reviewProgram,
						Layer.suspend(() => Layer.mergeAll(host(), liveReviewer({repo: clone}))),
					),
				];
	const writing =
		work === undefined
			? []
			: writingEntries({own: settings.own, reviewers: settings.reviewers, work});
	return [...entries, ...live, ...writing];
}
