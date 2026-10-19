import {defineProgram} from "@tea-fabrika/tea-program";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {Effect, Schema, Stream} from "effect";
import {Planned} from "../stages/plan/program.ts";
import {Answer, type Ask, Ask as AskShape, Refused, Settled, Waiting} from "./ask.ts";
import {type Fact, Ledger} from "./ledger.ts";
import {type Folded, foldLedger, nextOf, openAsks, problemWith} from "./rules.ts";

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

export const Reviewed = Schema.Struct({
	plan: Schema.String,
	/** The task's place in the plan, from 1. */
	task: Schema.Int,
	/** How many of the task's criteria the round left open. */
	open: Schema.Int,
});
export type Reviewed = typeof Reviewed.Type;

export const Ruling = Schema.Struct({
	ticket: Schema.String,
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	why: Schema.String,
});
export type Ruling = typeof Ruling.Type;

type Told =
	| {readonly on: "fact"; readonly fact: Fact}
	| {readonly on: "answer"; readonly answer: Answer};

const factOf = (planned: Planned): Fact | null =>
	planned.plan === null
		? null
		: {
				type: "planned",
				plan: planned.ticket,
				tickets: [planned.ticket],
				data: planned.plan,
				problems: planned.outcome.kind === "stuck" ? planned.problems : [],
			};

export const asksProgram = defineProgram({
	name: "asks",
	description:
		"Keeps what waits on the owner: a plan to approve, a stuck task, a ticket to rule on. It says each new ask on `ask`, takes answers on `answer`, checks each against the open ask, and keeps the ones it takes in the ledger. It never knows who shows the asks.",
	inputs: {
		planned: input(
			Planned,
			"A plan the plan stage wrote: its owner approves it before it is built.",
		),
		reviewed: input(
			Reviewed,
			"A review round of one task ended, with how many criteria it left open.",
		),
		ruling: input(Ruling, "A ticket sort sent to the owner to rule on."),
		answer: input(Answer, "The owner's answer to an open ask, under the ask's id."),
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
	},
	main: ({inputs, send}) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const folded = Effect.map(ledger.entries, foldLedger);
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
			const told = Stream.mergeAll(
				[
					inputs.planned.pipe(
						Stream.map(factOf),
						Stream.filter((fact): fact is Fact => fact !== null),
					),
					inputs.reviewed.pipe(Stream.map((r): Fact => ({type: "reviewed", ...r}))),
					inputs.ruling.pipe(Stream.map((r): Fact => ({type: "ruling_needed", ...r}))),
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
							yield* ledger.append(item.fact);
							return yield* said(before, yield* folded);
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
					}),
				),
			);
		}),
});
