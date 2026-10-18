import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Keep, type Watch} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {runTraced} from "../../program/trace.ts";
import {numberOf, SANDBOX, SandboxPullRequest, SandboxTicket} from "../../sandbox.ts";
import {nameOf} from "../outcome.ts";
import {EFFORTS, type Settings} from "../review/reviewer.ts";
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

/** How one build ended: its outcome, how that is spelled, and the report it was worked out from. */
export const Built = Schema.Struct({
	ticket: Schema.String,
	round: Schema.Finite,
	outcome: BuildOutcome,
	name: Schema.Literals(BUILD_NAMES),
	...BuildReport.fields,
});
export type Built = typeof Built.Type;

type BuildMachines = {readonly build: typeof build};

/**
 * One build machine run to its end, under `id` in the run's storage, shown on
 * the handle while it runs. A run found there goes on from where it stood.
 * Used by this program and by operate's loop, which keeps each round's build
 * under its own id.
 */
export const buildToTheEnd = (
	id: string,
	ask: BuildAsk,
	settings: Settings,
	watch: Watch<BuildMachines>,
	keep: Keep<BuildMachines>,
	machine: typeof build = build,
) =>
	Effect.gen(function* () {
		// The state as it was kept, read before the machine starts: once it
		// starts, the builder's Listen opens again on its own and may move it on.
		const loaded = yield* keep.find("build", id);
		const handle = yield* runTraced(
			"build",
			machine,
			{
				ctx: undefined,
				interpret: {...buildReadInterpret, ...buildWriteInterpret()},
				subscribe: buildSubscribe,
				store: keep.store("build", {id, until: "forgotten"}),
				terminal: (s: Build) => s.phase === "over",
			},
			{"tea.ticket": ask.ticket, "tea.round": String(ask.round)},
		);
		const runtime = yield* handle.ready;
		yield* watch("build", runtime);
		const now = runtime.getState();
		if (now.phase === "over") return now;
		yield* runtime.dispatch(
			loaded === null || loaded.phase === "idle"
				? {type: "start", ask, settings}
				: {type: "resume", from: loaded.phase},
		);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const buildProgram = defineProgram({
	name: "build",
	description: `Builds tickets, one after another, as it is told them: one agent changes a working copy, and code commits, pushes and opens the pull request. It writes to ${SANDBOX} only: its input takes no other repository's ticket.`,
	flags: {
		model: flag(Schema.String, "The model the builder runs on."),
		effort: flag(Schema.Literals(EFFORTS), "How hard the builder thinks."),
		budget: flag(
			Schema.Finite.check(Schema.isGreaterThan(0)),
			"The dollars one builder run may cost before it is stopped.",
		),
	},
	inputs: {
		ticket: input(
			SandboxTicket,
			"A sandbox ticket to build. Any other url is refused when it is decoded: this program writes to the sandbox alone.",
		),
	},
	outputs: {
		built: output(
			Built,
			"Once per ticket: the outcome, the pull request, the builder's form, and its cost.",
		),
		opened: output(
			SandboxPullRequest,
			"The url of each pull request opened or brought up to date. Pipe it into review's `pr`.",
		),
	},
	machines: {build},
	main: ({flags, inputs, send, watch, keep}) =>
		inputs.ticket.pipe(
			Stream.runForEach((ticket) =>
				Effect.gen(function* () {
					const ask: BuildAsk = {ticket, number: numberOf(ticket), round: 1, open: []};
					const settings = {model: flags.model, effort: flags.effort, budget: flags.budget};
					const id = `build/${ticket}/1`;
					const end = yield* buildToTheEnd(id, ask, settings, watch, keep);
					yield* keep.forget("build", id);
					yield* send("built", {
						ticket,
						round: 1,
						outcome: end.outcome,
						name: nameOf(end.outcome),
						...end.report,
					});
					if (end.outcome.kind === "done") yield* send("opened", end.outcome.pr);
				}),
			),
		),
});
