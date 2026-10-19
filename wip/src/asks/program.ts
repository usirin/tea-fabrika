import {defineProgram} from "@tea-fabrika/tea-program";
import {flag, input, output} from "@tea-fabrika/tea-program/shape";
import {Effect, Schema, Stream} from "effect";
import {PlanId, planOf, readTicketId, TaskId, TicketId, ticketOf} from "../ids.ts";
import {Revision, revisionOfDraft} from "../stages/plan/plan.ts";
import {Planned} from "../stages/plan/program.ts";
import {Answer, type Ask, Ask as AskShape, Attachment, Refused, Settled, Waiting} from "./ask.ts";
import {type Fact, Ledger} from "./ledger.ts";
import {type Folded, foldLedger, nextOf, openAsks, problemWith, readyBuilds} from "./rules.ts";

// The core's side of "ask the owner", as a program. It is told facts (a plan
// written, a review round ended, a ticket sent to be ruled on) and answers,
// keeps each in the ledger, and says on `ask` whatever newly waits on the
// owner. It never knows who listens: with nobody listening an ask is still
// kept, open, in the ledger, and said again at the next start.
//
//   plan | asks            planned plans become approval asks
//   asks.ask  -> anyone    an add-on pack shows it, or nobody does
//   anyone    -> asks.answer   the core checks it against the open ask, keeps it, says `settled`
//
// It keeps no machine: its state is a fold over the ledger (./rules.ts), so
// a restart rebuilds it from the facts and says every open ask again, oldest
// first. A listener hears each ask once per start. One that keeps a list
// listens to `waiting` instead: the whole list, said at the start and on every
// change. Events alone leave such a list stale (experiment 89): an ask can
// stop waiting with no answer heard.
//
// A build goes the same way. The core says it on `built` and ships it on
// `ship` once nothing holds it. A listener may hold builds: it clears each
// one, or raises a yes-or-no check on it that the owner answers. The core
// knows only how many listeners hold builds (`holds`, set by whoever wires
// it), never which. A no keeps the build from shipping, and its note becomes
// a new criterion of the task, which goes back to build.

export const Reviewed = Schema.Struct({
	plan: PlanId,
	task: TaskId,
	/** How many of the task's criteria the round left open. */
	open: Schema.Int,
});
export type Reviewed = typeof Reviewed.Type;

/**
 * A next version of a plan, written by code that holds the last one: each
 * task and criterion it keeps names its id, and a new one names none. A plan
 * stage that starts over writes a `planned` plan instead, and every task and
 * criterion in it is new: a place is never read as an id.
 */
export const Revised = Schema.Struct({plan: PlanId, data: Revision});
export type Revised = typeof Revised.Type;

export const Ruling = Schema.Struct({
	ticket: TicketId,
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	why: Schema.String,
});
export type Ruling = typeof Ruling.Type;

/** A build of one task finished: the files it changed. */
export const Build = Schema.Struct({
	plan: PlanId,
	task: TaskId,
	changes: Schema.Array(Schema.String),
});
export type Build = typeof Build.Type;

/** A build, as the core says it: which build of the task it is, from 1. */
export const Built = Schema.Struct({...Build.fields, build: Schema.Int});
export type Built = typeof Built.Type;

/** One build of one task, named. */
export const BuildRef = Schema.Struct({plan: PlanId, task: TaskId, build: Schema.Int});
export type BuildRef = typeof BuildRef.Type;

/** A listener that holds builds lets this one go. `by`: who, in its own words. */
export const Cleared = Schema.Struct({...BuildRef.fields, by: Schema.String});
export type Cleared = typeof Cleared.Type;

/** A listener that holds builds asks the owner to look at this one, yes or no. */
export const Raise = Schema.Struct({
	...BuildRef.fields,
	by: Schema.String,
	question: Schema.String,
	attachments: Schema.Array(Attachment),
});
export type Raise = typeof Raise.Type;

type Told =
	| {readonly on: "fact"; readonly fact: Fact}
	| {readonly on: "answer"; readonly answer: Answer};

/**
 * A plan the plan stage wrote, as a fact: the plan named by its ticket.
 * `null`: no plan, a ticket that is not one, or a story whose name is not a
 * story id (the plan's Check says which).
 */
const factOf = (planned: Planned): Fact | null => {
	const ticket = readTicketId(planned.ticket);
	const data = planned.plan === null ? null : revisionOfDraft(planned.plan);
	return ticket === null || data === null
		? null
		: {
				type: "planned",
				plan: planOf(ticket),
				tickets: [ticket],
				data,
				problems: planned.outcome.kind === "stuck" ? planned.problems : [],
			};
};

export const asksProgram = defineProgram({
	name: "asks",
	description:
		"Keeps what waits on the owner: a plan to approve, a stuck task, a ticket to rule on, a build someone asked the owner to check. It says each new ask on `ask`, takes answers on `answer`, checks each against the open ask, and keeps the ones it takes in the ledger. It never knows who shows the asks.",
	flags: {
		holds: flag(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"How many listeners hold each build until they clear it or raise a check on it.",
			{default: 0},
		),
	},
	inputs: {
		planned: input(
			Planned,
			"A plan the plan stage wrote: its owner approves it before it is built.",
		),
		revised: input(
			Revised,
			"A next version of a plan, by code that holds the last one: a criterion it keeps names its id.",
		),
		reviewed: input(
			Reviewed,
			"A review round of one task ended, with how many criteria it left open.",
		),
		ruling: input(Ruling, "A ticket sort sent to the owner to rule on."),
		answer: input(Answer, "The owner's answer to an open ask, under the ask's id."),
		build: input(Build, "A build of one task finished, with the files it changed."),
		cleared: input(Cleared, "A listener that holds builds lets one go."),
		raise: input(Raise, "A listener that holds builds asks the owner to check one, yes or no."),
	},
	outputs: {
		ask: output(
			AskShape,
			"Each ask as it starts to wait on the owner; at a start, every open one again.",
		),
		settled: output(Settled, "An answer the core took, with what it does next."),
		refused: output(Refused, "An answer the core did not take, and why. Nothing was kept."),
		waiting: output(
			Waiting,
			"Every open ask, oldest first: at the start and whenever the list changes.",
		),
		built: output(Built, "Each build as it finishes, for whoever holds builds to look at."),
		ship: output(BuildRef, "A build nothing holds: it ships."),
	},
	main: ({inputs, send, flags}) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const folded = Effect.map(ledger.entries, foldLedger);
			// Every build nothing holds is shipped, once: the `shipped` fact keeps a restart from shipping it again.
			const ship = Effect.gen(function* () {
				for (const b of readyBuilds(yield* folded)) {
					const ref = {plan: b.plan, task: b.task, build: b.build};
					yield* ledger.append({type: "shipped", ...ref});
					yield* send("ship", ref);
				}
			});
			const said = (before: Folded | null, after: Folded) =>
				Effect.gen(function* () {
					const was = before === null ? null : openAsks(before).map((ask) => ask.id);
					const now = openAsks(after);
					const known = new Set(was ?? []);
					yield* Effect.forEach(
						now.filter((ask: Ask) => !known.has(ask.id)),
						(ask) => send("ask", ask),
						// One after another: oldest first is the order a listener hears.
						{concurrency: 1, discard: true},
					);
					const changed = was === null || was.join("\n") !== now.map((ask) => ask.id).join("\n");
					if (changed) yield* send("waiting", {asks: now});
				});
			yield* said(null, yield* folded);
			yield* ship;
			const told = Stream.mergeAll(
				[
					inputs.planned.pipe(
						Stream.map(factOf),
						Stream.filter((fact): fact is Fact => fact !== null),
					),
					inputs.revised.pipe(
						Stream.map(
							(r): Fact => ({
								type: "planned",
								plan: r.plan,
								tickets: [ticketOf(r.plan)],
								data: r.data,
								problems: [],
							}),
						),
					),
					inputs.reviewed.pipe(Stream.map((r): Fact => ({type: "reviewed", ...r}))),
					inputs.ruling.pipe(Stream.map((r): Fact => ({type: "ruling_needed", ...r}))),
					inputs.build.pipe(Stream.map((b): Fact => ({type: "built", ...b, holds: flags.holds}))),
					inputs.cleared.pipe(Stream.map((c): Fact => ({type: "cleared", ...c}))),
					inputs.raise.pipe(Stream.map((r): Fact => ({type: "check_raised", ...r}))),
				].map((facts) => facts.pipe(Stream.map((fact): Told => ({on: "fact", fact})))),
				{concurrency: "unbounded"},
			).pipe(
				Stream.merge(inputs.answer.pipe(Stream.map((answer): Told => ({on: "answer", answer})))),
			);
			yield* told.pipe(
				Stream.runForEach((item) =>
					Effect.gen(function* () {
						const before = yield* folded;
						if (item.on === "fact") {
							const {fact} = item;
							yield* ledger.append(fact);
							const after = yield* folded;
							if (fact.type === "built") {
								const build = [...after.builds.values()]
									.filter((b) => b.plan === fact.plan && b.task === fact.task)
									.at(-1);
								if (build !== undefined)
									yield* send("built", {
										plan: fact.plan,
										task: fact.task,
										changes: fact.changes,
										build: build.build,
									});
							}
							yield* said(before, after);
							return yield* ship;
						}
						const {answer} = item;
						const problem = problemWith(before, answer);
						const ask = before.asks.get(answer.id);
						const next = ask === undefined ? null : nextOf(ask, answer.answer);
						if (problem !== null || ask === undefined || next === null)
							return yield* send("refused", {id: answer.id, why: problem ?? "it does not fit"});
						yield* ledger.append({type: "answered", id: answer.id, answer: answer.answer});
						yield* send("settled", {ask, answer: answer.answer, next});
						yield* said(before, yield* folded);
						yield* ship;
					}),
				),
			);
		}),
});
