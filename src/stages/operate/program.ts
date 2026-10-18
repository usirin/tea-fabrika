import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Keep, type Send} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
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
import {loopDrawing, reviewDrawing, shipDrawing} from "../traced.ts";
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
	/**
	 * Why, in the stage's own words: the builder's summary, what it left and
	 * any problem; each criterion a review left open. A build that changed
	 * nothing says here what the builder found.
	 */
	says: Schema.Array(Schema.String),
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

/** A review machine run to its end, under `id`. Its notes are kept in its report; none is posted. */
const reviewToTheEnd = (
	id: string,
	pr: string,
	round: number,
	rubrics: string,
	settings: Settings,
	keep: Keep<Machines>,
) =>
	Effect.gen(function* () {
		const runtime = yield* keep.run(
			"review",
			{id, until: "forgotten"},
			{
				ctx: undefined,
				interpret: {
					...reviewReadInterpret,
					review_file_note: () => Effect.succeed("kept" as const),
				},
				subscribe: reviewSubscribe,
				terminal: (s) => s.phase === "over",
			},
			(kept) =>
				kept === null || kept.phase === "idle"
					? {type: "start", ask: {pr, head: null, rubrics}, settings}
					: {type: "resume"},
			reviewDrawing(`round ${round}`, pr),
		);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the review stopped in ${end.phase}`);
		const reviewed: Reviewed = {pr, outcome: end.outcome, name: nameOf(end.outcome), ...end.report};
		return reviewed;
	}).pipe(Effect.scoped);

/** A ship machine run to its end, under `id`, with the writes. */
const shipToTheEnd = (id: string, pr: string, round: number, keep: Keep<Machines>) =>
	Effect.gen(function* () {
		const runtime = yield* keep.run(
			"ship",
			{id, until: "forgotten"},
			{
				ctx: undefined,
				interpret: {...shipReadInterpret, ...shipWriteInterpret()},
				subscribe: shipSubscribe,
				terminal: (s) => s.phase === "over",
			},
			(kept) => (kept === null || kept.phase === "idle" ? {type: "start", pr} : {type: "resume"}),
			shipDrawing(`round ${round}`, pr),
		);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the ship stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

/** What answers the loop's four Acts: each runs a stage's machine to its end, and says so on `step`. */
const loopInterpret = (send: Send<Outputs>, keep: Keep<Machines>) => {
	const step = (ticket: string, round: number, part: Omit<Step, "ticket" | "round">) =>
		send("step", {ticket, round, ...part});
	return {
		loop_build: (cmd: ReturnType<typeof runBuild>) =>
			Effect.gen(function* () {
				const ask = {ticket: cmd.ticket, number: cmd.number, round: cmd.round, open: cmd.open};
				const end = yield* buildToTheEnd(cmd.intent, ask, cmd.settings, keep);
				const name = nameOf(end.outcome);
				yield* step(cmd.ticket, cmd.round, {
					stage: "build",
					name,
					pr: end.report.pr,
					head: end.report.head,
					open: null,
					spend: end.report.ran?.spend.costUsd ?? 0,
					says: [
						...(end.report.built === null ? [] : [end.report.built.summary]),
						...(end.report.built?.left ?? []).map((left) => `left: ${left}`),
						...end.report.problems,
					],
				});
				return {outcome: end.outcome, name, report: end.report};
			}).pipe(settled),
		loop_review: (cmd: ReturnType<typeof runReview>) =>
			Effect.gen(function* () {
				const reviewed = yield* reviewToTheEnd(
					cmd.intent,
					cmd.pr,
					cmd.round,
					cmd.rubrics,
					cmd.settings,
					keep,
				);
				yield* step(cmd.ticket, cmd.round, {
					stage: "review",
					name: reviewed.name,
					pr: cmd.pr,
					head: reviewed.head,
					open: reviewed.criteria.filter((c) => c.state === "open").length,
					spend: reviewed.ran?.spend.costUsd ?? 0,
					says: reviewed.criteria
						.filter((c) => c.state === "open")
						.map((c) => `${c.n}. ${c.text}: ${c.says}`),
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
						? yield* shipToTheEnd(cmd.intent, cmd.pr, cmd.round, keep).pipe(
								Effect.map((outcome) => ({outcome, said: nameOf(outcome)})),
							)
						: yield* look(cmd.pr, `round ${cmd.round}`).pipe(
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
					says: [],
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
	main: ({flags, inputs, send, keep}) => {
		const interpret = loopInterpret(send, keep);
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
				const runtime = yield* keep.run(
					"loop",
					{id: loopId(ticket), until: "forgotten"},
					{ctx: undefined, interpret, terminal: (s) => s.phase === "over"},
					(kept) =>
						kept === null || kept.phase === "idle"
							? {type: "start", ticket, number: numberOf(ticket), settings}
							: {type: "resume"},
					loopDrawing(ticket),
				);
				const end = yield* runtime.done();
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
