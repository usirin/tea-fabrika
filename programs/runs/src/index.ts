import {run} from "@demlik/tea/effect";
import {defineProgram, end, flag, input, output, TraceId} from "@kampus/fabrika";
import {type Entry, Id, TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {One, oneOf, tickets, ticketsKind, ticketsOptions} from "@tea-fabrika/tracker";
import {Effect, Schema} from "effect";

// One ticket's runs in time, in a tile of its own (./window.tsx), laid out like tracks in a music
// editor: a track per step, a clip per run, the waits on a person striped, the answers marked on
// the ruler. Its view is the ticket's facts and the clock; the window folds them up to its
// playhead (./trace.ts), so dragging the playhead back replays the ticket as it was then.
//
//   tsh> runs --ticket 7         its window takes over the tile
//   // triage 10:02 to 10:03, plan 10:03 to 10:09, the approval striped from 10:09 to now
//   {kind: "choose", run: "r-2"} on `in`: plan's run is picked, and its trace id goes out on `id`
//   {kind: "quit"}               on `in`: it ends
//
//   tsh> runs --ticket 7 | trace   a run picked here opens its job's trace there
//   tsh> tracker | ticket | runs
//   // it lays out the ticket the tracker picks, and moves to the next pick
//
// Which ticket it lays out comes from the flag, then from its input `ticket`, the latest one
// winning. The input's end changes nothing: the last ticket stays, until `in` ends.
//
// It was the `trace` program until the job record came (docs/direction/a-job-record-holds-its-trace.md):
// `trace` now opens one job's spans and steps (programs/trace). This one stays the ticket's view
// over all its runs, read from the ticket's facts.

/** What the window sends: a run picked, or quit. */
export const In = Schema.Union([
	Schema.Struct({kind: Schema.Literal("choose"), run: Id}),
	Schema.Struct({kind: Schema.Literal("quit")}),
]);
export type In = typeof In.Type;

/**
 * The trace id its `started` gave the run named. `null`: no such run, or it started with none.
 *
 *   traceIdOf(SEVEN, "r-2")   // SEVEN_TRACE
 *   traceIdOf(SEVEN, "r-9")   // null
 */
export const traceIdOf = (timeline: readonly Entry[], runId: string): string | null => {
	for (const e of timeline)
		if (e.fact.type === "started" && e.fact.run === runId) return e.fact.trace ?? null;
	return null;
};

export const runs = defineProgram({
	name: "runs",
	description:
		"One ticket's runs laid out in time: a track per step, a clip per run, the waits on a person, the answers, and what each step cost. A playhead replays the facts up to a time. Lays out the ticket a pipe sends it. A run picked sends its trace id. It has a window.",
	flags: {
		ticket: flag(
			Schema.UndefinedOr(TicketNumber),
			"The ticket to lay out first, by its number. Left out, it waits for one on its input ticket.",
		),
	},
	inputs: {
		in: input(In, "What the window sends: a run picked, or quit, and it ends."),
		ticket: input(
			TicketNumber,
			"A ticket to lay out now, by its number: what a pipe from the ticket or the tracker sends.",
		),
	},
	outputs: {
		id: output(TraceId, "The trace id of each run picked that has one, for `trace` to open."),
	},
	machines: {tickets: ticketsKind},
	view: {machine: "tickets", data: One, of: oneOf},
	main: ({flags, serve, send, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			const open = (ticket: number) => runtime.dispatch({type: "open", ticket}).pipe(Effect.orDie);
			if (flags.ticket !== undefined) yield* open(flags.ticket);
			yield* watch("tickets", "tickets", runtime);
			// The picks and the window's choices, in the order told. Once `ticket` is closed the last
			// pick stays, until a quit or until `in` is closed.
			yield* serve(
				{
					ticket: open,
					in: (d) => {
						if (d.kind === "quit") return end;
						if (d.kind !== "choose") return Effect.void;
						const id = traceIdOf(oneOf(runtime.getState()).ticket?.timeline ?? [], d.run);
						return id === null ? Effect.void : send("id", id);
					},
				},
				{until: ["in"]},
			);
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});

export {type Clip, type Marker, type Trace, type Track, traceOf, type Wait} from "./trace.ts";
