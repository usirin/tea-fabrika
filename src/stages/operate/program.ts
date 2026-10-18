import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Keep, type Send, type Watch} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {runTraced} from "../../program/trace.ts";
import {numberOf, SANDBOX, SandboxTicket} from "../../sandbox.ts";
import {build} from "../build/machine.ts";
import {buildToTheEnd} from "../build/program.ts";
import {nameOf} from "../outcome.ts";
import {reviewReadInterpret, reviewSubscribe} from "../review/handlers.ts";
import {review} from "../review/machine.ts";
import type {Reviewed} from "../review/program.ts";
import {EFFORTS, type Settings} from "../review/reviewer.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "../ship/handlers.ts";
import {look} from "../ship/look.ts";
import {ship} from "../ship/machine.ts";
import {prAttributes} from "../traced.ts";
import {
	type Loop,
	type LoopSettings,
	loop,
	type postVerdicts,
	type runBuild,
	type runReview,
	type runShip,
} from "./machine.ts";
import {LOOP_NAMES, LoopOutcome} from "./outcome.ts";
import {Round, type ShipEnd} from "./stop.ts";
import {ReviewWrites} from "./writes.ts";

// The operate program: a small loop over the stage machines. It is told
// sandbox tickets, and for each one runs the loop machine (./machine.ts):
// build, review, build, review, until the stop rule (./stop.ts) ships it or
// stops it, and says how it ended.
//
// The stages are libraries here: their machines, run by the same handlers
// their own programs use. This file only wires them, and keeps each one's
// state in the run's storage:
//
//   loop    under `loop/<ticket>`, until the loop is over and its children
//           are dropped
//   build, review, ship   each under the intent of the loop's Act that
//           started it: `loop/<ticket>/<round>/<stage>`
//
// So a run started again with the same id and storage, after a crash, first
// takes each loop it left unfinished to its end, from where it stood. The
// loop sends its Act again with the same intent; the Act finds its stage's
// machine where it stood, and goes on from there. A build that had opened its
// pull request does not open another. A review that was over is not run again.
//
// It writes, and only to the sandbox. Its input takes a sandbox ticket and no
// other url, so any other is refused when it is decoded, before a run starts
// (src/sandbox.ts). Its services write to the sandbox alone.

/** One stage of one round, ended. */
export const Step = Schema.Struct({
	ticket: Schema.String,
	round: Schema.Finite,
	stage: Schema.Literals(["build", "review", "post", "ship"]),
	/** The stage's outcome, by name. */
	name: Schema.String,
	pr: Schema.NullOr(Schema.String),
	head: Schema.NullOr(Schema.String),
	/** After a review: how many it left open. */
	open: Schema.NullOr(Schema.Finite),
	/** What this stage's agent cost, in dollars. */
	spend: Schema.Finite,
});
export type Step = typeof Step.Type;

/** How one loop ended. */
export const Ended = Schema.Struct({
	ticket: Schema.String,
	outcome: LoopOutcome,
	name: Schema.Literals(LOOP_NAMES),
	/** The last stage outcome the loop read, by name. */
	said: Schema.String,
	rounds: Schema.Array(Round),
});
export type Ended = typeof Ended.Type;

const OUTPUTS = {
	step: output(
		Step,
		"Each stage of each round, as it ends: its outcome, the pull request, and what it cost.",
	),
	ended: output(Ended, "Once per ticket: how the loop ended, why, and every round."),
};
type Outputs = typeof OUTPUTS;

const MACHINES = {loop, build, review, ship};
type Machines = typeof MACHINES;

const unknown = {_tag: "unknown" as const};
const settled = Effect.mapError(() => unknown);

/** Where a loop is kept. */
const loopId = (ticket: string) => `loop/${ticket}`;

/**
 * What to send a stage's machine once it is running again: start it when
 * nothing was kept, resume it when it stands where it was kept, and nothing
 * when it has already moved on. A stage with a Listen (the reviewer's run,
 * ship's waits) opens it again on its own when the state is loaded, and can
 * move before this is sent; a resume then would send a Cmd a second time.
 */
const goOn = <M>(
	loaded: {readonly phase: string} | null,
	now: {readonly phase: string},
	started: M,
): M | {readonly type: "resume"} | null =>
	loaded === null || loaded.phase === "idle"
		? started
		: loaded.phase === now.phase
			? {type: "resume"}
			: null;

/** A review machine run to its end, under `id`. Its notes are kept in its report; none is posted. */
const reviewToTheEnd = (
	id: string,
	pr: string,
	rubrics: string,
	settings: Settings,
	watch: Watch<Machines>,
	keep: Keep<Machines>,
) =>
	Effect.gen(function* () {
		const loaded = yield* keep.find("review", id);
		const handle = yield* runTraced(
			"review",
			review,
			{
				ctx: undefined,
				interpret: {
					...reviewReadInterpret,
					review_file_note: () => Effect.succeed("kept" as const),
				},
				subscribe: reviewSubscribe,
				store: keep.store("review", {id, until: "forgotten"}),
				terminal: (s) => s.phase === "over",
			},
			prAttributes(pr),
		);
		const runtime = yield* handle.ready;
		yield* watch("review", runtime);
		const now = runtime.getState();
		const end =
			now.phase === "over"
				? now
				: yield* Effect.gen(function* () {
						const msg = goOn(loaded, now, {
							type: "start",
							ask: {pr, head: null, rubrics},
							settings,
						} as const);
						if (msg !== null) yield* runtime.dispatch(msg);
						return yield* runtime.done();
					});
		if (end.phase !== "over") return yield* Effect.die(`the review stopped in ${end.phase}`);
		const reviewed: Reviewed = {pr, outcome: end.outcome, name: nameOf(end.outcome), ...end.report};
		return reviewed;
	}).pipe(Effect.scoped);

/** A ship machine run to its end, under `id`, with the writes. */
const shipToTheEnd = (id: string, pr: string, watch: Watch<Machines>, keep: Keep<Machines>) =>
	Effect.gen(function* () {
		const loaded = yield* keep.find("ship", id);
		const handle = yield* runTraced(
			"ship",
			ship,
			{
				ctx: undefined,
				interpret: {...shipReadInterpret, ...shipWriteInterpret()},
				subscribe: shipSubscribe,
				store: keep.store("ship", {id, until: "forgotten"}),
				terminal: (s) => s.phase === "over",
			},
			prAttributes(pr),
		);
		const runtime = yield* handle.ready;
		yield* watch("ship", runtime);
		const now = runtime.getState();
		if (now.phase === "over") return now.outcome;
		const msg = goOn(loaded, now, {type: "start", pr} as const);
		if (msg !== null) yield* runtime.dispatch(msg);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the ship stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

/** What answers the loop's four Acts: each runs a stage's machine to its end, and says so on `step`. */
const loopInterpret = (send: Send<Outputs>, watch: Watch<Machines>, keep: Keep<Machines>) => {
	const step = (ticket: string, round: number, part: Omit<Step, "ticket" | "round">) =>
		send("step", {ticket, round, ...part});
	return {
		loop_build: (cmd: ReturnType<typeof runBuild>) =>
			Effect.gen(function* () {
				const ask = {ticket: cmd.ticket, number: cmd.number, round: cmd.round, open: cmd.open};
				const end = yield* buildToTheEnd(cmd.intent, ask, cmd.settings, watch, keep);
				const name = nameOf(end.outcome);
				yield* step(cmd.ticket, cmd.round, {
					stage: "build",
					name,
					pr: end.report.pr,
					head: end.report.head,
					open: null,
					spend: end.report.ran?.spend.costUsd ?? 0,
				});
				return {outcome: end.outcome, name, report: end.report};
			}).pipe(settled),
		loop_review: (cmd: ReturnType<typeof runReview>) =>
			Effect.gen(function* () {
				const reviewed = yield* reviewToTheEnd(
					cmd.intent,
					cmd.pr,
					cmd.rubrics,
					cmd.settings,
					watch,
					keep,
				);
				yield* step(cmd.ticket, cmd.round, {
					stage: "review",
					name: reviewed.name,
					pr: cmd.pr,
					head: reviewed.head,
					open: reviewed.criteria.filter((c) => c.state === "open").length,
					spend: reviewed.ran?.spend.costUsd ?? 0,
				});
				return reviewed;
			}).pipe(settled),
		loop_post: (cmd: ReturnType<typeof postVerdicts>) =>
			Effect.gen(function* () {
				const writes = yield* ReviewWrites;
				for (const post of cmd.posts) yield* writes.post({pr: cmd.pr, head: cmd.head, ...post});
				return "posted" as const;
			}).pipe(settled),
		loop_ship: (cmd: ReturnType<typeof runShip>) =>
			Effect.gen(function* () {
				const shipped: ShipEnd =
					cmd.mode === "write"
						? yield* shipToTheEnd(cmd.intent, cmd.pr, watch, keep).pipe(
								Effect.map((outcome) => ({outcome, said: nameOf(outcome)})),
							)
						: yield* look(cmd.pr).pipe(
								Effect.map((found) => ({
									outcome: found.outcome,
									said:
										found.name ??
										(found.wouldSend !== null
											? `would_send:${found.wouldSend.type}`
											: "would_wait:checks"),
								})),
							);
				yield* step(cmd.ticket, cmd.round, {
					stage: "ship",
					name: shipped.said,
					pr: cmd.pr,
					head: null,
					open: null,
					spend: 0,
				});
				return shipped;
			}).pipe(settled),
	};
};

export const operateProgram = defineProgram({
	name: "operate",
	description: `Builds, reviews and ships sandbox tickets, one after another: build, review, build, review, until nothing is left open or a round makes no progress, then ship. It writes to ${SANDBOX} only: its input takes no other repository's ticket.`,
	flags: {
		rubrics: flag(
			Schema.String,
			"The folder the review's rubric texts are read from: code.md, doc.md, skill.md.",
		),
		model: flag(Schema.String, "The model the builder and the reviewer run on."),
		effort: flag(Schema.Literals(EFFORTS), "How hard the builder and the reviewer think."),
		budget: flag(
			Schema.Finite.check(Schema.isGreaterThan(0)),
			"The dollars one agent run may cost: one builder run, or one reviewer run.",
		),
		rounds: flag(
			Schema.Finite.check(Schema.isBetween({minimum: 1, maximum: 5})),
			"The most build rounds for one ticket, from 1 to 5.",
		),
		ship: flag(
			Schema.Literals(["read", "write"]),
			"read: ship says what it would do and writes nothing. write: ship runs to its end, and may put the pull request in the merge queue.",
		),
	},
	inputs: {
		ticket: input(
			SandboxTicket,
			"A sandbox ticket to build, review and ship. Any other url is refused when it is decoded: this program writes to the sandbox alone.",
		),
	},
	outputs: OUTPUTS,
	machines: MACHINES,
	main: ({flags, inputs, send, watch, keep}) => {
		const interpret = loopInterpret(send, watch, keep);
		const settings: LoopSettings = {
			rubrics: flags.rubrics,
			model: flags.model,
			effort: flags.effort,
			budget: flags.budget,
			rounds: flags.rounds,
			ship: flags.ship,
		};

		/** Drop what the loop kept of one ticket: its stages' machines, then the loop. */
		const tidy = (ticket: string) =>
			Effect.gen(function* () {
				const prefix = `${loopId(ticket)}/`;
				for (const name of ["build", "review", "ship"] as const)
					for (const kept of yield* keep.kept(name))
						if (kept.id.startsWith(prefix)) yield* keep.forget(name, kept.id);
				yield* keep.forget("loop", loopId(ticket));
			});

		const said = (ticket: string, end: Extract<Loop, {phase: "over"}>) =>
			send("ended", {
				ticket,
				outcome: end.outcome,
				name: nameOf(end.outcome),
				said: end.said,
				rounds: end.rounds,
			}).pipe(Effect.andThen(tidy(ticket)));

		/** One loop to its end. Found in the storage mid-way, it goes on from where it stood. */
		const run = (ticket: string) =>
			Effect.gen(function* () {
				const handle = yield* runTraced(
					"loop",
					loop,
					{
						ctx: undefined,
						interpret,
						store: keep.store("loop", {id: loopId(ticket), until: "forgotten"}),
						terminal: (s) => s.phase === "over",
					},
					{"tea.ticket": ticket},
				);
				const runtime = yield* handle.ready;
				yield* watch("loop", runtime);
				const now = runtime.getState();
				if (now.phase !== "over")
					yield* runtime.dispatch(
						now.phase === "idle"
							? {type: "start", ticket, number: numberOf(ticket), settings}
							: {type: "resume"},
					);
				const end = now.phase === "over" ? now : yield* runtime.done();
				if (end.phase !== "over") return yield* Effect.die(`the loop stopped in ${end.phase}`);
				yield* said(ticket, end);
			}).pipe(Effect.scoped);

		// First, each loop an earlier start of this run left unfinished, from where it stood.
		const leftOver = Effect.gen(function* () {
			for (const {state} of yield* keep.kept("loop"))
				if (state.phase !== "idle") yield* run(state.ticket);
		});
		return leftOver.pipe(Effect.andThen(inputs.ticket.pipe(Stream.runForEach(run))));
	},
});
