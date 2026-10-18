import {Clock, Effect, Random, Schema} from "effect";
import {sessionOf} from "../../combos.ts";
import {defineProgram, type Keep, type Kit} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {numberOf, SANDBOX, SandboxPullRequest, SandboxTicket} from "../../sandbox.ts";
import {nameOf} from "../outcome.ts";
import {queue, waitingOf, workQueue} from "../queue.ts";
import {EFFORTS, type Settings} from "../review/reviewer.ts";
import {buildDrawing} from "../traced.ts";
import {buildReadInterpret, buildSubscribe, buildWriteInterpret} from "./handlers.ts";
import {type Build, type BuildAsk, BuildReport, build} from "./machine.ts";
import {BUILD_NAMES, BuildOutcome} from "./outcome.ts";

// The build program: the thing you start to build tickets. It is started once,
// with its settings as flags, and then told tickets for as long as it runs.
// Each gets a fresh run of the build machine (./machine.ts), one at a time,
// as a first round: nothing left open from a review.
//
// It writes, and only to the sandbox. Its input takes a sandbox ticket and no
// other url, so any other is refused when it is decoded, before a run starts
// (src/sandbox.ts). The services it is given write to the sandbox alone.
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

type BuildMachines = {readonly queue: typeof queue; readonly build: typeof build};

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
 * One build machine run to its end, under `id` in the run's storage, shown on
 * the handle while it runs. A run found there goes on from where it stood.
 * Used by this program and by operate's loop, which keeps each round's build
 * under its own id. It needs only `keep.run`, so operate can hand it its own
 * keep, which runs more machines than build's.
 */
export const buildToTheEnd = (
	id: string,
	ask: BuildAsk,
	settings: Settings,
	keep: Pick<Keep<BuildMachines>, "run">,
) =>
	Effect.gen(function* () {
		// Named before the kept state is read, as `first` cannot run an effect;
		// used only when the run starts here. A kept run keeps the name it has.
		const session = yield* sessionNamed(id);
		const runtime = yield* keep.run(
			"build",
			{id, until: "forgotten"},
			{
				ctx: undefined,
				interpret: {...buildReadInterpret, ...buildWriteInterpret()},
				subscribe: buildSubscribe,
				terminal: (s: Build) => s.phase === "over",
			},
			(kept) =>
				kept === null || kept.phase === "idle"
					? {type: "start", ask, settings, session}
					: {type: "resume"},
			buildDrawing(ask.ticket, ask.round),
		);
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
};

const OUTPUTS = {
	built: output(
		Built,
		"Once per ticket: the outcome, the pull request, the builder's form, and its cost.",
	),
	opened: output(
		SandboxPullRequest,
		"The url of each pull request opened or brought up to date. Pipe it into review's `pr`.",
	),
};

/** Where the build program keeps a ticket's one round. */
const idOf = (ticket: string) => `build/${ticket}/1`;

/** One ticket's round built to its end, from where it was kept, and said on both outputs. */
const builtOne = (
	ticket: string,
	{flags, send, keep}: Kit<typeof FLAGS, typeof OUTPUTS, BuildMachines>,
) =>
	Effect.gen(function* () {
		const ask: BuildAsk = {ticket, number: numberOf(ticket), round: 1, open: []};
		const settings = {model: flags.model, effort: flags.effort, budget: flags.budget};
		const end = yield* buildToTheEnd(idOf(ticket), ask, settings, keep);
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
	description: `Builds tickets, one after another, as it is told them: one agent changes a working copy, and code commits, pushes and opens the pull request. It writes to ${SANDBOX} only: its input takes no other repository's ticket. A ticket told is kept until its build ends: started again after a crash, it carries every one on.`,
	flags: FLAGS,
	inputs: {
		ticket: input(
			SandboxTicket,
			"A sandbox ticket to build. Any other url is refused when it is decoded: this program writes to the sandbox alone. Told again while it waits or is being built, it is built once.",
		),
	},
	outputs: OUTPUTS,
	machines: {queue, build},
	left: {
		queue: {by: "main"},
		// A round on the queue is carried on by the queue's work. One the queue no longer holds has
		// left it: its outcome was sent, and only the drop was cut off. One the queue never held (kept
		// by a build from before the queue) is taken to its end here.
		build: (run, kit) =>
			Effect.gen(function* () {
				const {state} = run;
				if (state.phase === "idle") return yield* kit.keep.forget("build", run.id);
				const {ticket} = state.ask;
				if ((yield* waitingOf(kit.keep)).includes(ticket)) return;
				if (state.phase !== "over") yield* builtOne(ticket, kit);
				yield* kit.keep.forget("build", run.id);
			}),
	},
	main: (io) =>
		workQueue(
			io.keep,
			io.inputs.ticket,
			(ticket) => builtOne(ticket, io),
			(ticket) => io.keep.forget("build", idOf(ticket)),
		),
});
