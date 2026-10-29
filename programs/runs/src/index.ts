import {run} from "@demlik/tea/effect";
import {defineProgram, flag, input} from "@kampus/fabrika";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {One, oneOf, tickets, ticketsKind, ticketsOptions} from "@tea-fabrika/tracker";
import {Effect, Schema, Stream} from "effect";

// One ticket's runs in time, in a tile of its own (./window.tsx), laid out like tracks in a music
// editor: a track per step, a clip per run, the waits on a person striped, the answers marked on
// the ruler. Its view is the ticket's facts and the clock; the window folds them up to its
// playhead (./trace.ts), so dragging the playhead back replays the ticket as it was then.
//
//   tsh> runs --ticket 7         its window takes over the tile
//   // triage 10:02 to 10:03, plan 10:03 to 10:09, the approval striped from 10:09 to now
//   {kind: "quit"}               on `in`: it ends
//
// It was the `trace` program until the job record came (docs/direction/a-job-record-holds-its-trace.md):
// `trace` now opens one job's spans and steps (programs/trace). This one stays the ticket's view
// over all its runs, read from the ticket's facts.

export const runs = defineProgram({
	name: "runs",
	description:
		"One ticket's runs laid out in time: a track per step, a clip per run, the waits on a person, the answers, and what each step cost. A playhead replays the facts up to a time. It has a window.",
	flags: {ticket: flag(TicketNumber, "The ticket to lay out, by its number.")},
	inputs: {
		in: input(
			Schema.Struct({kind: Schema.Literal("quit")}),
			"Quit: it ends. The window sends nothing else.",
		),
	},
	outputs: {},
	machines: {tickets: ticketsKind},
	view: {machine: "tickets", data: One, of: oneOf},
	main: ({flags, inputs, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			yield* runtime.dispatch({type: "open", ticket: flags.ticket}).pipe(Effect.orDie);
			yield* watch("tickets", "tickets", runtime);
			yield* inputs.in.pipe(Stream.take(1), Stream.runDrain);
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});

export {type Clip, type Marker, type Trace, type Track, traceOf, type Wait} from "./trace.ts";
