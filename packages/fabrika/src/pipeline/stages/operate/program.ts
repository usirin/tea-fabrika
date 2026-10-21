import {Effect, Schema} from "effect";
import {defineProgram, type Kit, kind, type RefsOf, type Send} from "../../../program/program.ts";
import {flag, input, output} from "../../../program/shape.ts";
import {claim, holderOf, newLane, release} from "../../asks/claims.ts";
import {Ledger} from "../../asks/ledger.ts";
import {markOf} from "../../criteria/mark.ts";
import {type LaneId, readTicketId, type TicketId} from "../../ids.ts";
import {buildKind as buildStage, buildToTheEnd} from "../build/program.ts";
import {numberOf, TicketUrl} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import {queueKind, workQueue} from "../queue.ts";
import {reviewReadInterpret, reviewSubscribe} from "../review/handlers.ts";
import {problemsOf, type Review, review} from "../review/machine.ts";
import {keepRows, type Reviewed} from "../review/program.ts";
import {EFFORTS, type Settings} from "../review/reviewer.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "../ship/handlers.ts";
import {look} from "../ship/look.ts";
import {type Ship, ship} from "../ship/machine.ts";
import {loopLine, reviewLine, shipLine} from "../status.ts";
import {loopDrawing, reviewDrawing, shipDrawing} from "../traced.ts";
import {
	type claimTicket,
	type Loop,
	type LoopSettings,
	loop,
	type postVerdicts,
	type releaseTicket,
	type runBuild,
	type runReview,
	type runShip,
} from "./machine.ts";
import {LOOP_NAMES, LoopOutcome} from "./outcome.ts";
import {Round, type ShipEnd} from "./stop.ts";
import {ReviewWrites} from "./writes.ts";

// The operate program: a small loop over the stage machines. It is told
// tickets, and for each one runs the loop machine (./machine.ts):
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
// It writes to the repository each ticket's url names: build's branch and
// pull request, review's verdicts, and ship's merge.
//
// One lane works a ticket at a time, across every run that shares the
// `Ledger`. Each loop is a lane, with an id the ledger gives it, kept in the
// loop's state so a restart goes on as the same lane. The loop claims its
// ticket first (../../asks/claims.ts); a build and a ship read the ledger
// again before they run, and run only while the lane still holds it. The
// loop lets the ticket go when it ends, and the tidy-up lets it go again, in
// case that failed.

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
	 * Why, in the stage's own words: the builder's summary and what it left;
	 * each criterion a review left open. A build that changed nothing says
	 * here what the builder found.
	 */
	says: Schema.Array(Schema.String),
	/**
	 * What went wrong, in the stage's own words: why a build stopped; each
	 * form a review's Check refused (`problemsOf`, ../review/machine.ts) and
	 * why the review stopped. Empty: nothing did.
	 */
	problems: Schema.Array(Schema.String),
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
		// Its round, for this loop's ship to read.
		yield* keepRows(end.report, pr);
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

/** The ledger's id of a ticket the loop was told by its url. */
const ticketOf = (url: string): Effect.Effect<TicketId, typeof unknown> => {
	const id = readTicketId(url);
	return id === null ? Effect.fail(unknown) : Effect.succeed(id);
};

/**
 * The door of a build or a ship: the ledger read again, and the stage run
 * only while `lane` still holds the ticket. A lane that does not hold it
 * builds nothing and ships nothing.
 */
const holding = (cmd: {readonly ticket: string; readonly lane: LaneId}) =>
	Effect.gen(function* () {
		const ticket = yield* ticketOf(cmd.ticket);
		const holder = holderOf(yield* (yield* Ledger).entries, ticket);
		if (holder !== cmd.lane) return yield* Effect.fail(unknown);
	});

/** What answers the loop's Acts: each stage's runs its machine to its end, and says so on `step`. */
const loopInterpret = ({send, machines}: Stages) => {
	const step = (ticket: string, round: number, part: Omit<Step, "ticket" | "round">) =>
		send("step", {ticket, round, ...part});
	return {
		loop_claim: (cmd: ReturnType<typeof claimTicket>) =>
			ticketOf(cmd.ticket).pipe(Effect.flatMap((ticket) => claim(ticket, cmd.lane))),
		loop_release: (cmd: ReturnType<typeof releaseTicket>) =>
			ticketOf(cmd.ticket).pipe(
				Effect.flatMap((ticket) => release(ticket, cmd.lane)),
				Effect.as("released" as const),
			),
		loop_build: (cmd: ReturnType<typeof runBuild>) =>
			Effect.gen(function* () {
				yield* holding(cmd);
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
					],
					problems: end.report.problems,
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
					spend: reviewed.cost,
					says: reviewed.criteria
						.filter((c) => c.state === "open")
						.map((c) => `${c.from === "ticket" ? markOf(c) : "(review)"} ${c.text}: ${c.says}`),
					problems: problemsOf(reviewed),
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
				yield* holding(cmd);
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
					problems: [],
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
	ship: flag(
		Schema.Literals(["read", "write"]),
		"read: ship says what it would do and writes nothing. write: ship runs to its end, and may put the pull request in the merge queue, or merge it when the repository has no queue.",
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

/** Drop what the loop kept of one ticket: its stages' machines, then the loop. Its ticket is let go first, if its lane still holds it. */
const tidy = (ticket: string, {machines}: OperateKit) =>
	Effect.gen(function* () {
		const kept = yield* machines.loop.get(loopId(ticket)).read;
		const id = readTicketId(ticket);
		if (kept !== null && kept.phase !== "idle" && id !== null) yield* release(id, kept.lane);
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
			ship: flags.ship,
		};
		const ref = machines.loop.get(loopId(ticket));
		// A loop kept from before goes on as the lane it was; only a new one is given a lane.
		const kept = yield* ref.read;
		const id = readTicketId(ticket);
		if (id === null) return yield* Effect.die(`not a ticket: ${ticket}`);
		const lane = kept !== null && kept.phase !== "idle" ? kept.lane : yield* newLane(id);
		const runtime = yield* ref.start({
			type: "start",
			ticket,
			number: numberOf(ticket),
			lane,
			settings,
		});
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
	description:
		"Builds, reviews and ships tickets, one after another: build, review, build, review, until nothing is left open or a round makes no progress, then ship. It writes to each ticket's own repository. A ticket told is kept until its loop ends: started again after a crash, it carries every one on.",
	flags: FLAGS,
	inputs: {
		ticket: input(
			TicketUrl,
			"A ticket to build, review and ship, as its url on GitHub. Told again while it waits or runs, it gets one loop.",
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
