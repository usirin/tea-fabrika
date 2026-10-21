import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Layer} from "effect";
import {type Entry, listed} from "../../program/listed.ts";
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
} from "../../program/program.ts";
import type {PayloadOf} from "../../program/shape.ts";
import {layerLanes} from "../asks/claims.ts";
import {type Ledger, memoryLedger} from "../asks/ledger.ts";
import {type Counted, gitHubCodeHost, prOf} from "../code-host-github.ts";
import {type CriteriaRecord, ledgerRecord, memoryRecord} from "../criteria/record.ts";
import {deliverProgram, liveDelivery} from "../hosted/deliver-program.ts";
import {INSTALL, withLocalChecks} from "../local-checks.ts";
import {CodeHost} from "../services.ts";
import type {AgentPick, Setup} from "../setup.ts";
import {sh} from "../sh.ts";
import {liveBuilder} from "../stages/build/builder.ts";
import {liveAcpBuilder} from "../stages/build/builder-acp.ts";
import {type BuildConfig, cloneIn, gitHubBuild} from "../stages/build/github.ts";
import {buildProgram} from "../stages/build/program.ts";
import {operateProgram} from "../stages/operate/program.ts";
import {gitHubLoopWrites} from "../stages/operate/writes.ts";
import {planAtMain} from "../stages/plan/at-main.ts";
import {livePlanner} from "../stages/plan/planner.ts";
import {planProgram} from "../stages/plan/program.ts";
import {noFacts} from "../stages/plan/services.ts";
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
		id: criterion.id,
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

/** The drafts one plan may take when the line names none. */
export const PLAN_TRIES = 3;

/** One agent step's model, effort and budget, as a program's flags take them. */
const flagsOf = (a: AgentPick) => ({
	model: a.model.value,
	effort: a.effort.value,
	budget: a.budget.value,
});

/** An agent step's flags: the run's picks when it has them, else the config's. */
const agentFlags = (config: Config, setup: Setup | null, step: keyof Setup["agents"]) =>
	setup === null
		? {model: config.model, effort: config.effort, budget: config.budget}
		: flagsOf(setup.agents[step]);

/** The values for the flags the review programs take. */
const reviewing = (config: Config, setup: Setup | null) => ({
	rubrics: setup?.rubrics.value ?? config.rubrics,
	...agentFlags(config, setup, "review"),
});

/**
 * The GitHub reader with what the repository declared in fabrika.toml (whose
 * approval, which review kinds), and, when it names `[[checks.run]]`, those
 * checks run by fabrika at each head and counted beside GitHub's
 * (../local-checks.ts). `counted`: which of GitHub's checks a review waits on
 * when the run has no pick of its own.
 */
const gitHubReads = (
	config: Config,
	setup: Setup | null,
	counted: Counted | undefined,
): Layer.Layer<CodeHost> => {
	const accounts = {own: config.own, reviewers: config.reviewers};
	if (setup === null)
		return gitHubCodeHost(counted === undefined ? accounts : {...accounts, checks: counted});
	const github = setup.github.value;
	const base = gitHubCodeHost({
		...accounts,
		checks: github === "required" ? "required" : (counted ?? "required"),
		declared: {approval: setup.approval.value, kinds: setup.kinds.value},
	});
	const [first, ...rest] = setup.run.value;
	if (first === undefined) return base;
	const settings = {
		work: config.work,
		install: setup.install.value,
		checks: [first, ...rest] as const,
		github,
	};
	return Layer.effect(
		CodeHost,
		Effect.gen(function* () {
			return yield* withLocalChecks(yield* CodeHost, settings);
		}),
	).pipe(Layer.provide(Layer.merge(base, nodeServices)));
};

/**
 * build and operate: the programs that make a change. Each writes to the
 * repository its ticket's url names, and keeps its clone under the config's
 * work folder. operate's reviewer reads the clone build made of the pull
 * request's repository, and its reader waits on every check, not only the
 * required one. With a run's picks (`setup`), each step runs on its own
 * agent settings, the build installs what the repository's lockfile names,
 * and a ticket is built once the plan the ledger holds for it was approved.
 */
function writingEntries(
	config: Config,
	record: Layer.Layer<CriteriaRecord>,
	ledger: Layer.Layer<Ledger>,
	setup: Setup | null,
): readonly Entry[] {
	const {work} = config;
	const reads = () => gitHubReads(config, setup, "every");
	/** The clone that holds a pull request's commits: the one build pushed them from. */
	const cloneOf = (pr: string) => {
		const at = prOf(pr);
		return at === null ? work : cloneIn(work, at);
	};
	const building: BuildConfig =
		setup === null
			? {work}
			: {
					work,
					install: setup.install.value,
					go: setup.go.value.by === "plan" ? {by: "plan", ledger} : setup.go.value,
				};
	const told = setup?.told.value ?? [];
	const builder = () => liveBuilder(told.length === 0 ? {} : {checks: told});
	const agents =
		setup === null
			? {}
			: {agents: {build: flagsOf(setup.agents.build), review: flagsOf(setup.agents.review)}};
	// deliver (experiment 105): one plan's lane to one pull request, on the one ledger. Listed when
	// the config names the repository it writes to, and the run's picks name what each review runs
	// at its head: the repository's install first, as fabrika's own checks run it (107), then
	// fabrika.toml's `[[checks.run]]`. The install alone still proves the lockfile agrees with every
	// manifest. A review with neither would pass on nothing, so then it is not listed.
	const {repo} = config;
	const install = setup?.install.value ?? [];
	const [first, ...rest] = [
		...(install.length > 0
			? [{name: INSTALL, run: install as readonly [string, ...string[]]}]
			: []),
		...(setup?.run.value ?? []),
	];
	const delivering =
		repo === null || first === undefined
			? []
			: [
					listed(
						configured(deliverProgram, {
							rubrics: reviewing(config, setup).rubrics,
							// The shared fallback; each step's own are in `agents`, the planner's too.
							model: config.model,
							effort: config.effort,
							budget: config.budget,
							...(setup === null
								? {}
								: {
										agents: {
											plan: flagsOf(setup.agents.plan),
											build: flagsOf(setup.agents.build),
											review: flagsOf(setup.agents.review),
										},
									}),
							usd: agentFlags(config, setup, "build").budget * 10,
						}),
						Layer.suspend(() =>
							Layer.mergeAll(
								liveDelivery({
									repo,
									work,
									own: config.own,
									reviewers: config.reviewers,
									checks: [first, ...rest],
								}),
								ledgerRecord.pipe(Layer.provideMerge(ledger)),
							),
						),
					),
				];
	return [
		...delivering,
		listed(
			configured(buildProgram, agentFlags(config, setup, "build")),
			// The ACP builder too, for `build --harness acp` (experiment 77): it starts nothing until a build asks for it.
			Layer.suspend(() => Layer.mergeAll(gitHubBuild(building), builder(), liveAcpBuilder())),
		),
		listed(
			configured(operateProgram, {
				...reviewing(config, setup),
				// The shared fallback; each step's own are in `agents`.
				model: config.model,
				effort: config.effort,
				budget: config.budget,
				ship: config.ship,
				...agents,
			}),
			Layer.suspend(() =>
				Layer.mergeAll(
					reads(),
					gitHubBuild(building),
					builder(),
					liveReviewer({repo: cloneOf}),
					gitHubLoopWrites(),
					record,
					// This run's leases, renewed while it runs, on the one ledger.
					layerLanes().pipe(Layer.provideMerge(ledger)),
				),
			),
		),
	];
}

/**
 * ship, review-scripted, build and operate, over GitHub; review with a live
 * agent when the config gives a clone to read. `reads`: the GitHub reader,
 * made fresh for each run; a test stands in one over recorded answers.
 *
 * Every entry shares one criteria record, kept in memory for the shell's
 * life: what a review judged is what `review | ship` reads back. A shell
 * started anew holds no verdict rows, so its ship sends each pull request
 * back to the reviewer before it merges anything.
 *
 * Every operate run shares one ledger too: one lane works a ticket at a
 * time, however many runs are told it. fabrika's tsh hands it the ledger kept
 * on disk for the repository it works on (./fabrika-main.ts), the desk's too,
 * so the claim holds across shells; left out, as in a test, it is one in
 * memory for the shell's life. Each run holds its own leases (`Lanes`).
 *
 * `setup`: the run's picks, from fabrika.toml, tsh.toml and what the
 * repository holds (../setup.ts), worked out once at the edge. Left out, as
 * in a test, every program runs on the config alone, as before a repository
 * could pick.
 *
 * `plan`, with a live planner, is listed beside the live review: it reads
 * the code in the same clone, at the commit main is at when it is told the
 * ticket (../stages/plan/at-main.ts).
 */
export function fabrikaEntries(
	config: Config,
	reads?: () => Layer.Layer<CodeHost>,
	record: Layer.Layer<CriteriaRecord> = memoryRecord().layer,
	ledger: Layer.Layer<Ledger> = memoryLedger().layer,
	setup: Setup | null = null,
): readonly Entry[] {
	const host = reads ?? (() => gitHubReads(config, setup, undefined));
	const reviewer = () =>
		scriptedReviewer((brief) => ({answer: "form", form: passing(brief), ...noRun})).layer;
	const {clone, work} = config;
	const live =
		clone === null
			? []
			: [
					listed(
						configured(reviewProgram, reviewing(config, setup)),
						Layer.suspend(() => Layer.mergeAll(host(), liveReviewer({repo: clone}), record)),
					),
					listed(
						configured(planProgram, {...agentFlags(config, setup, "plan"), tries: PLAN_TRIES}),
						Layer.suspend(() =>
							Layer.mergeAll(
								planAtMain((args) => sh("gh", args), work),
								noFacts,
								// No temp folder to copy the code into: nothing this run can do about it.
								Layer.orDie(livePlanner({repo: clone})),
							),
						),
					),
				];
	return [
		listed(
			configured(shipProgram, {mode: config.ship}),
			Layer.suspend(() => Layer.mergeAll(host(), gitHubLoopWrites(), record)),
		),
		listed(
			configured(reviewScripted, reviewing(config, setup)),
			Layer.suspend(() => Layer.mergeAll(host(), reviewer(), record)),
		),
		...live,
		...writingEntries(config, record, ledger, setup),
	];
}
