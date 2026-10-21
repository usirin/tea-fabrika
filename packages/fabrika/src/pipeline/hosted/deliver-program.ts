// The deliver program: `deliver plan=<ticket>` in tsh (experiment 105). It takes one plan's lane
// (./deliver.ts) to its end on this machine's ledger, and says how it ended. Told a plan whose lane
// is already on the ledger, after a crash or from a second shell, it serves the same names: the lane
// goes on from its journal, and no child starts twice. The other shell's hold on a name runs out
// before this one takes it, so two shells never run one lane at once.
//
// It asks for every service the lane's children use through Effect's context. `liveDelivery` gives
// them over GitHub and the Agent SDK, writing to the named repositories only; a test gives fakes.
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Duration, Effect, Layer, Random, Schema, Stream} from "effect";
import {defineProgram} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {gitHubCodeHost} from "../code-host-github.ts";
import type {LocalCheck} from "../code-host-local.ts";
import {hostEnv} from "../env.ts";
import {planOf, readTicketId} from "../ids.ts";
import {sh} from "../sh.ts";
import {liveBuilder} from "../stages/build/builder.ts";
import {cloneIn} from "../stages/build/github.ts";
import {TicketUrl} from "../stages/build/ticket.ts";
import {agentFor, LANE_STEPS, LaneJob} from "../stages/lane/machine.ts";
import {LANE_NAMES, LaneOutcome} from "../stages/lane/outcome.ts";
import {planAtMain} from "../stages/plan/at-main.ts";
import {livePlanner} from "../stages/plan/planner.ts";
import {EFFORTS, noFacts} from "../stages/plan/services.ts";
import {liveReviewer} from "../stages/review/reviewer.ts";
import {BuildWork} from "./build.ts";
import {deliver} from "./deliver.ts";
import {gitHubOutside} from "./outside.ts";
import {LocalChecks, readingIn} from "./review-local.ts";

/** How one plan's lane ended. */
export const Delivered = Schema.Struct({
	plan: Schema.String,
	outcome: Schema.NullOr(LaneOutcome),
	name: Schema.NullOr(Schema.Literals(LANE_NAMES)),
});
export type Delivered = typeof Delivered.Type;

/** Each agent step's own settings: `LaneJob.agents`, as a flag. */
const AGENTS = LaneJob.fields.agents.schema;

/** The lane's outcome row, as `deliver` hands it back: the part said here. */
const Ended = Schema.Struct({name: Schema.Literals(LANE_NAMES), outcome: LaneOutcome});

const FLAGS = {
	rubrics: flag(
		Schema.String,
		"The folder the reviews' rubric texts are read from: code.md, doc.md, skill.md.",
	),
	model: flag(Schema.String, "The model an agent of the lane runs on, when agents names none."),
	effort: flag(
		Schema.Literals(EFFORTS),
		"How hard an agent of the lane thinks, when agents names none.",
	),
	budget: flag(
		Schema.Finite.check(Schema.isGreaterThan(0)),
		"The dollars one agent run may cost before it is stopped, when agents names none.",
	),
	usd: flag(
		Schema.Finite.check(Schema.isGreaterThan(0)),
		"The dollars one child of the lane may spend in all, its retries with it.",
	),
	agents: flag(
		AGENTS,
		"The planner's, the builder's and the reviewer's own model, effort and budget, each in full, as a repository's [agents.plan], [agents.build] and [agents.review] picked them. A step left out runs on model, effort and budget.",
		{default: {}},
	),
};

/** The most one agent run of the lane may cost, whichever step it is: what a turn holds before it starts. */
const mostOneRun = (job: LaneJob): number =>
	Math.max(...LANE_STEPS.map((step) => agentFor(job, step).budget));

export const deliverProgram = defineProgram({
	name: "deliver",
	description:
		"Delivers plans, one after another: plans the ticket, builds each task on one branch in rounds (catch up with main by merge, build, review), opens ONE pull request that closes every ticket the plan covers, and ships it. It asks the owner on the desk where a plan needs a yes. Told a plan again after a crash, it goes on from where the lane stood.",
	flags: FLAGS,
	inputs: {
		plan: input(TicketUrl, "The ticket a plan is named by, as its url on GitHub."),
	},
	outputs: {
		delivered: output(Delivered, "Once per plan: how its lane ended."),
	},
	main: ({flags, inputs, send}) =>
		inputs.plan.pipe(
			Stream.runForEach((url) =>
				Effect.gen(function* () {
					const ticket = readTicketId(url);
					if (ticket === null) return yield* Effect.die(`not a ticket: ${url}`);
					const plan = planOf(ticket);
					// This start's own name on the ledger: a shell started again is a new holder, and
					// takes each name over once the old hold has run out.
					const holder = `tsh-${(yield* Random.nextIntBetween(0, 0xffffffff)).toString(16)}`;
					const job: LaneJob = {
						plan,
						settings: {model: flags.model, effort: flags.effort, budget: flags.budget},
						...(Object.keys(flags.agents).length > 0 ? {agents: flags.agents} : {}),
						usd: flags.usd,
						rubrics: flags.rubrics,
						// The first commit date: kept with the job, which is cast once, so a resume keeps it.
						at: Math.floor(Date.now() / 1000),
					};
					const outcome = yield* deliver(plan, job, {
						holder,
						ttlMs: Duration.toMillis(Duration.seconds(10)),
						agent: "real",
						hold: {usd: mostOneRun(job)},
					});
					const read = Schema.decodeUnknownOption(Ended)(outcome);
					yield* send(
						"delivered",
						read._tag === "Some"
							? {plan, outcome: read.value.outcome, name: read.value.name}
							: {plan, outcome: null, name: null},
					);
				}),
			),
		),
});

/**
 * The lane's children live: the ticket and pull request on GitHub, writes to `repo` only, agents
 * on the Agent SDK, everything on disk under `work`. The planner reads main as fetched now, in the
 * clone build keeps (`planAtMain`, experiment 107); each builder works in its own copy; each
 * reviewer reads the plan's clone its turn put at the head (`readingIn`). Every review runs
 * `checks` at the head; the pull request's own checks run on GitHub, before ship.
 */
export const liveDelivery = (o: {
	readonly repo: {readonly owner: string; readonly name: string};
	readonly work: string;
	readonly own: readonly string[];
	readonly reviewers: readonly string[];
	/** What every review runs at the head, in a copy of the branch. At least one. */
	readonly checks: readonly [LocalCheck, ...LocalCheck[]];
}) =>
	Layer.mergeAll(
		gitHubOutside([`${o.repo.owner}/${o.repo.name}`]),
		planAtMain((args) => sh("gh", args), o.work),
		noFacts,
		livePlanner({repo: cloneIn(o.work, o.repo)}),
		liveBuilder(),
		liveReviewer({repo: (pr) => readingIn(o.work, pr) ?? cloneIn(o.work, o.repo)}),
		gitHubCodeHost({own: o.own, reviewers: o.reviewers}),
		Layer.succeed(BuildWork, {
			dir: o.work,
			env: {...hostEnv(), GIT_TERMINAL_PROMPT: "0"},
			install: false,
		}),
		Layer.succeed(LocalChecks, o.checks),
		// git, the working copies, and the commands a check runs: Node, at this edge.
		nodeServices,
		// A planner with no temp folder to work in cannot start: nothing the lane could answer.
	).pipe(Layer.orDie);
