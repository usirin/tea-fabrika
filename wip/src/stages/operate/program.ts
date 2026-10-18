import {Effect, Schema} from "effect";
import {
	defineProgram,
	type Kit,
	kind,
	type RefsOf,
	type Send,
} from "../../../../packages/tea-program/src/program";
import {flag, input, output} from "../../../../packages/tea-program/src/shape";
import {numberOf, SANDBOX, SandboxTicket} from "../../sandbox";
import {buildKind as buildStage, buildToTheEnd} from "../build/program";
import {nameOf} from "../outcome";
import {queueKind, workQueue} from "../queue";
import {reviewReadInterpret, reviewSubscribe} from "../review/handlers";
import {type Review, review} from "../review/machine";
import type {Reviewed} from "../review/program";
import {EFFORTS, type Settings} from "../review/reviewer";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "../ship/handlers";
import {look} from "../ship/look";
import {type Ship, ship} from "../ship/machine";
import {loopLine, reviewLine, shipLine} from "../status";
import {loopDrawing, reviewDrawing, shipDrawing} from "../traced";
import {
	type Loop,
	type LoopSettings,
	loop,
	type postVerdicts,
	type runBuild,
	type runReview,
	type runShip,
} from "./machine";
import {LOOP_NAMES, LoopOutcome} from "./outcome";
import {Round, type ShipEnd} from "./stop";
import {ReviewWrites} from "./writes";

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
// Each ticket told is kept on the run's queue (../queue.ts) until its loop
// has ended and said so. So a run started again with the same id and storage,
// after a crash, takes each loop it left unfinished to its end, from where it
// stood, and then every ticket still waiting, even when its input was closed
// and nobody can tell it again. A ticket told again while it waits or runs
// gets one loop. The
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

const unknown = {_tag: "unknown" as const};
const settled = Effect.mapError(() => unknown);

/** Where a loop is kept. */
const loopId = (ticket: string) => `loop/${ticket}`;

/** The round a stage's id names: `loop/<ticket>/<round>/<stage>`. */
const roundOf = (id: string): string => {
	const parts = id.split("/");
	return parts[parts.length - 2] ?? "";
};

/** A round's build, run by the loop's Act that started it: the loop is its parent. */
const buildKind = {...buildStage, parent: "loop" as const};

/** A round's review. Its notes are kept in its report; none is posted. */
const reviewKind = kind({
	machine: review,
	parent: "loop",
	options: () => ({
		ctx: undefined,
		interpret: {...reviewReadInterpret, review_file_note: () => Effect.succeed("kept" as const)},
		subscribe: reviewSubscribe,
		terminal: (s: Review) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id, kept, start}) =>
		reviewDrawing(
			`round ${roundOf(id)}`,
			kept !== null && kept.phase !== "idle"
				? kept.ask.pr
				: start?.type === "start"
					? start.ask.pr
					: id,
		),
	status: reviewLine,
});

/** A round's ship, with the writes. */
const shipKind = kind({
	machine: ship,
	parent: "loop",
	options: () => ({
		ctx: undefined,
		interpret: {...shipReadInterpret, ...shipWriteInterpret()},
		subscribe: shipSubscribe,
		terminal: (s: Ship) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id, kept, start}) =>
		shipDrawing(
			`round ${roundOf(id)}`,
			kept !== null && kept.phase !== "idle" ? kept.pr : start?.type === "start" ? start.pr : id,
		),
	status: shipLine,
});

/** What the loop's Acts are handed: the outputs, and the stages they run. */
interface Stages {
	readonly send: Send<Outputs>;
	readonly machines: {
		readonly build: RefsOf<typeof buildKind>;
		readonly review: RefsOf<typeof reviewKind>;
		readonly ship: RefsOf<typeof shipKind>;
	};
}

/** A review machine run to its end, under `id`. */
const reviewToTheEnd = (
	reviews: Stages["machines"]["review"],
	id: string,
	pr: string,
	rubrics: string,
	settings: Settings,
) =>
	Effect.gen(function* () {
		const runtime = yield* reviews
			.get(id)
			.start({type: "start", ask: {pr, head: null, rubrics}, settings});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the review stopped in ${end.phase}`);
		const reviewed: Reviewed = {pr, outcome: end.outcome, name: nameOf(end.outcome), ...end.report};
		return reviewed;
	}).pipe(Effect.scoped);

/** A ship machine run to its end, under `id`, with the writes. */
const shipToTheEnd = (ships: Stages["machines"]["ship"], id: string, pr: string) =>
	Effect.gen(function* () {
		const runtime = yield* ships.get(id).start({type: "start", pr});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the ship stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

/** What answers the loop's four Acts: each runs a stage's machine to its end, and says so on `step`. */
const loopInterpret = ({send, machines}: Stages) => {
	const step = (ticket: string, round: number, part: Omit<Step, "ticket" | "round">) =>
		send("step", {ticket, round, ...part});
	return {
		loop_build: (cmd: ReturnType<typeof runBuild>) =>
			Effect.gen(function* () {
				const ask = {ticket: cmd.ticket, number: cmd.number, round: cmd.round, open: cmd.open};
				const end = yield* buildToTheEnd(cmd.intent, ask, cmd.settings, machines.build);
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
					machines.review,
					cmd.intent,
					cmd.pr,
					cmd.rubrics,
					cmd.settings,
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
						? yield* shipToTheEnd(machines.ship, cmd.intent, cmd.pr).pipe(
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

const FLAGS = {
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
};

/** The loop over one ticket. Found mid-way, it sends its Act again, which finds its stage where it stood. */
const loopKind = kind({
	machine: loop,
	parent: "main",
	options: (stages: Stages) => ({
		ctx: undefined,
		interpret: loopInterpret(stages),
		terminal: (s: Loop) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id, kept, start}) =>
		loopDrawing(
			kept !== null && kept.phase !== "idle"
				? kept.ticket
				: start?.type === "start"
					? start.ticket
					: id,
		),
	// The loop's line says the stage; the stage's own says where in it: `#6 round 1: reviewing PR #8`
	// beside `#8: waiting on checks`.
	status: loopLine,
});

const KINDS = {
	queue: queueKind,
	loop: loopKind,
	build: buildKind,
	review: reviewKind,
	ship: shipKind,
};

type OperateKit = Kit<typeof FLAGS, Outputs, typeof KINDS>;

/** Drop what the loop kept of one ticket: its stages' machines, then the loop. */
const tidy = (ticket: string, {machines}: OperateKit) =>
	Effect.gen(function* () {
		const prefix = `${loopId(ticket)}/`;
		for (const stage of [machines.build, machines.review, machines.ship])
			for (const kept of yield* stage.list)
				if (kept.id.startsWith(prefix)) yield* stage.get(kept.id).clear;
		yield* machines.loop.get(loopId(ticket)).clear;
	});

/** One loop to its end, and how it ended said. Found in the storage mid-way, it goes on from where it stood. */
const run = (ticket: string, {flags, send, machines}: OperateKit) =>
	Effect.gen(function* () {
		const settings: LoopSettings = {
			rubrics: flags.rubrics,
			model: flags.model,
			effort: flags.effort,
			budget: flags.budget,
			rounds: flags.rounds,
			ship: flags.ship,
		};
		const runtime = yield* machines.loop
			.get(loopId(ticket))
			.start({type: "start", ticket, number: numberOf(ticket), settings});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the loop stopped in ${end.phase}`);
		yield* send("ended", {
			ticket,
			outcome: end.outcome,
			name: nameOf(end.outcome),
			said: end.said,
			rounds: end.rounds,
		});
	}).pipe(Effect.scoped);

export const operateProgram = defineProgram({
	name: "operate",
	description: `Builds, reviews and ships sandbox tickets, one after another: build, review, build, review, until nothing is left open or a round makes no progress, then ship. It writes to ${SANDBOX} only: its input takes no other repository's ticket. A ticket told is kept until its loop ends: started again after a crash, it carries every one on.`,
	flags: FLAGS,
	inputs: {
		ticket: input(
			SandboxTicket,
			"A sandbox ticket to build, review and ship. Any other url is refused when it is decoded: this program writes to the sandbox alone. Told again while it waits or runs, it gets one loop.",
			// Read by the kept queue, which acks each once it has kept it (../queue.ts).
			{ack: "manual"},
		),
	},
	outputs: OUTPUTS,
	// A loop on the queue is carried on by the queue's work, and its tidy-up, cut off by a kill, by
	// the queue's next start. Each stage's machine is run again by the loop's Act that started it.
	machines: KINDS,
	main: (io) =>
		workQueue(
			io.machines.queue,
			io.inputs.ticket,
			(ticket) => run(ticket, io),
			(ticket) => tidy(ticket, io),
		),
});
