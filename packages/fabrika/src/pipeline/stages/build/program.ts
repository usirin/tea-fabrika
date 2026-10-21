import {Clock, Effect, Random, Schema} from "effect";
import {defineProgram, type Kit, kind, type RefsOf} from "../../../program/program.ts";
import {flag, input, output} from "../../../program/shape.ts";
import {sessionOf} from "../../combos.ts";
import {nameOf} from "../outcome.ts";
import {queueKind, workQueue} from "../queue.ts";
import {EFFORTS, type Settings} from "../review/reviewer.ts";
import {PullRequestUrl} from "../ship/program.ts";
import {buildLine} from "../status.ts";
import {buildDrawing} from "../traced.ts";
import {HARNESSES, viaAcp} from "./builder-acp.ts";
import {Builder} from "./form.ts";
import {buildReadInterpret, buildSubscribe, buildWriteInterpret} from "./handlers.ts";
import {type Build, type BuildAsk, BuildReport, build} from "./machine.ts";
import {BUILD_NAMES, BuildOutcome} from "./outcome.ts";
import {numberOf, TicketUrl} from "./ticket.ts";

// The build program: the thing you start to build tickets. It is started once,
// with its settings as flags, and then told tickets for as long as it runs.
// Each gets a fresh run of the build machine (./machine.ts), one at a time,
// as a first round: nothing left open from a review.
//
// It writes to the repository each ticket's url names: a branch, a commit, a
// pull request.
//
// Its output `opened` is the url of each pull request it opened or brought up
// to date, so `build | review` is one pipe.
//
// What it is told is kept. Each ticket goes on the run's queue (../queue.ts)
// as it is told, and each round's build is kept under `build/<ticket>/1`. So
// a start after a kill carries every ticket it was told and did not finish
// to its end, the one it was building first, from where it stood, even when
// its input was closed and nobody can tell it again. A ticket told again
// while it is on the queue is built once.

/** How one build ended: its outcome, how that is spelled, and the report it was worked out from. */
export const Built = Schema.Struct({
	ticket: Schema.String,
	round: Schema.Finite,
	outcome: BuildOutcome,
	name: Schema.Literals(BUILD_NAMES),
	...BuildReport.fields,
});
export type Built = typeof Built.Type;

/**
 * The build machine as a kind. A round found part way resumes; one kept
 * before it began starts afresh from the caller's Msg. Its parent is the
 * program's queue work (`main`) here, operate's loop there.
 */
export const buildKind = kind({
	machine: build,
	parent: "main",
	options: () => ({
		ctx: undefined,
		interpret: {...buildReadInterpret, ...buildWriteInterpret()},
		subscribe: buildSubscribe,
		terminal: (s: Build) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id, kept, start}) => {
		const ask =
			kept !== null && kept.phase !== "idle"
				? kept.ask
				: start?.type === "start"
					? start.ask
					: null;
		return ask === null ? buildDrawing(id, 1) : buildDrawing(ask.ticket, ask.round);
	},
	// `#2 round 1: builder at work`.
	status: buildLine,
});

/**
 * A new name for a round's conversation with its builder. New for each start,
 * never derived from the ticket and round alone: the agent refuses a name a
 * kept conversation already has, and a build started again on the same ticket
 * starts its own conversation. Kept in the machine's state, so a restart finds it.
 */
const sessionNamed = (id: string) =>
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis;
		const salt = yield* Random.nextIntBetween(0, 0xffffffff);
		return sessionOf(`build ${id} ${now} ${salt}`);
	});

/**
 * One build machine run to its end, under `id`, shown on the handle while it
 * runs. A run found kept goes on from where it stood (the kind's `recovered`).
 * Used by this program and by operate's loop, which keeps each round's build
 * under its own id.
 */
export const buildToTheEnd = (
	id: string,
	ask: BuildAsk,
	settings: Settings,
	builds: RefsOf<typeof buildKind>,
) =>
	Effect.gen(function* () {
		// A new name every call, so no two start Msgs are the same: a start on a round live already
		// shares it, and this one's Msg is dropped. A kept run keeps the name it has.
		const session = yield* sessionNamed(id);
		const runtime = yield* builds
			.get(id)
			.start({type: "start", ask, settings, session}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

const FLAGS = {
	model: flag(Schema.String, "The model the builder runs on."),
	effort: flag(Schema.Literals(EFFORTS), "How hard the builder thinks."),
	budget: flag(
		Schema.Finite.check(Schema.isGreaterThan(0)),
		"The dollars one builder run may cost before it is stopped.",
	),
	harness: flag(
		Schema.UndefinedOr(Schema.Literals(HARNESSES)),
		"How the builder is run: `sdk`, the Agent SDK (the default), or `acp`, the Claude adapter over ACP, with the same check (experiment 77).",
	),
};

const OUTPUTS = {
	built: output(
		Built,
		"Once per ticket: the outcome, the pull request, the builder's form, and its cost.",
	),
	opened: output(
		PullRequestUrl,
		"The url of each pull request opened or brought up to date. Pipe it into review's `pr`.",
	),
};

const BUILD_KINDS = {queue: queueKind, build: buildKind};
type BuildKinds = typeof BUILD_KINDS;

/** Where the build program keeps a ticket's one round. */
const idOf = (ticket: string) => `build/${ticket}/1`;

/** One ticket's round built to its end, from where it was kept, and said on both outputs. */
const builtOne = (
	ticket: string,
	{flags, send, machines}: Kit<typeof FLAGS, typeof OUTPUTS, BuildKinds>,
) =>
	Effect.gen(function* () {
		const ask: BuildAsk = {ticket, number: numberOf(ticket), round: 1, open: []};
		const settings = {model: flags.model, effort: flags.effort, budget: flags.budget};
		const run = buildToTheEnd(idOf(ticket), ask, settings, machines.build);
		const end = yield* flags.harness === "acp"
			? Effect.provideServiceEffect(run, Builder, viaAcp)
			: run;
		yield* send("built", {
			ticket,
			round: 1,
			outcome: end.outcome,
			name: nameOf(end.outcome),
			...end.report,
		});
		if (end.outcome.kind === "done") yield* send("opened", end.outcome.pr);
	});

export const buildProgram = defineProgram({
	name: "build",
	description:
		"Builds tickets, one after another, as it is told them: one agent changes a working copy, and code commits, pushes and opens the pull request, in the ticket's own repository. A ticket told is kept until its build ends: started again after a crash, it carries every one on.",
	flags: FLAGS,
	inputs: {
		ticket: input(
			TicketUrl,
			"A ticket to build, as its url on GitHub. Told again while it waits or is being built, it is built once.",
			// Read by the kept queue, which acks each once it has kept it (../queue.ts).
			{ack: "manual"},
		),
	},
	outputs: OUTPUTS,
	// A round on the queue is carried on by the queue's work; a round's drop a kill cut off is run
	// by the queue at its next start (../queue.ts).
	machines: BUILD_KINDS,
	main: (io) =>
		workQueue(
			io.machines.queue,
			io.inputs.ticket,
			(ticket) => builtOne(ticket, io),
			(ticket) => io.machines.build.get(idOf(ticket)).clear,
		),
});
