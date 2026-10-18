import {
	type Definition,
	defineProgram,
	type Flags,
	type Inputs,
	type Kinds,
	type Outputs,
	type Parented,
	type Program,
	withDefaults,
} from "@tea-fabrika/tea-program";
import {type Entry, listed} from "@tea-fabrika/tea-program/listed";
import type {PayloadOf} from "@tea-fabrika/tea-program/shape";
import {Layer} from "effect";
import {gitHubCodeHost, prOf} from "../code-host-github.ts";
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
import type {Config} from "./config.ts";

// fabrika's own programs, as tsh lists them, from one repository's config
// (./config.ts): ship and review over GitHub, and build and operate, which
// write to the repository each ticket names. The config fills their flags'
// defaults, so `operate ticket=<url>` is a whole line; a flag given on the
// line still wins.
//
// `review-scripted` is the review program with its reviewer scripted: the
// pack is read from GitHub for real, the gate runs for real, and where the
// agent would grade, a script hands back a form that passes every criterion.
// It costs nothing and proves the wiring, not the review. `review`, with a
// live agent, is listed only when the config gives a clone to read code from.
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

/** `program`, its flags named in `values` defaulting to them. */
const configured = <F extends Flags, I extends Inputs, O extends Outputs, Ks extends Kinds, E, R>(
	program: Program<F, I, O, Ks, E, R>,
	values: {readonly [K in keyof F]?: PayloadOf<F[K]>},
): Program<F, I, O, Ks, E, R> =>
	// Its machines' parents were checked when `program` was defined, and only its flags change.
	defineProgram<I, O, F, Ks, E, R>({
		...program,
		flags: withDefaults(program.flags, values),
	} as Definition<F, I, O, Ks, E, R> & Parented<F, O, Ks>);

/** The config's values for the flags the review programs take. */
const reviewing = (config: Config) => ({
	rubrics: config.rubrics,
	model: config.model,
	effort: config.effort,
	budget: config.budget,
});

/**
 * build and operate: the programs that make a change. Each writes to the
 * repository its ticket's url names, and keeps its clone under the config's
 * work folder. operate's reviewer reads the clone build made of the pull
 * request's repository, and its reader waits on every check, not only the
 * required one.
 */
function writingEntries(config: Config): readonly Entry[] {
	const {work} = config;
	const reads = () =>
		gitHubCodeHost({own: config.own, reviewers: config.reviewers, checks: "every"});
	/** The clone that holds a pull request's commits: the one build pushed them from. */
	const cloneOf = (pr: string) => {
		const at = prOf(pr);
		return at === null ? work : cloneIn(work, at);
	};
	const {model, effort, budget} = config;
	return [
		listed(
			configured(buildProgram, {model, effort, budget}),
			// The ACP builder too, for `build --harness acp` (experiment 77): it starts nothing until a build asks for it.
			Layer.suspend(() => Layer.mergeAll(gitHubBuild({work}), liveBuilder(), liveAcpBuilder())),
		),
		listed(
			configured(operateProgram, {
				...reviewing(config),
				rounds: config.rounds,
				ship: config.ship,
			}),
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
 * ship, review-scripted, build and operate, over GitHub; review with a live
 * agent when the config gives a clone to read. `reads`: the GitHub reader,
 * made fresh for each run; a test stands in one over recorded answers.
 */
export function fabrikaEntries(
	config: Config,
	reads: () => Layer.Layer<CodeHost> = () =>
		gitHubCodeHost({own: config.own, reviewers: config.reviewers}),
): readonly Entry[] {
	const host = reads;
	const reviewer = () =>
		scriptedReviewer((brief) => ({answer: "form", form: passing(brief), ...noRun})).layer;
	const {clone} = config;
	const live =
		clone === null
			? []
			: [
					listed(
						configured(reviewProgram, reviewing(config)),
						Layer.suspend(() => Layer.mergeAll(host(), liveReviewer({repo: clone}))),
					),
				];
	return [
		listed(
			configured(shipProgram, {mode: config.ship}),
			Layer.suspend(() => Layer.mergeAll(host(), gitHubLoopWrites())),
		),
		listed(
			configured(reviewScripted, reviewing(config)),
			Layer.suspend(() => Layer.mergeAll(host(), reviewer())),
		),
		...live,
		...writingEntries(config),
	];
}
