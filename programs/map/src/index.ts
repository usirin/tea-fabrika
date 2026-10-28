import {run} from "@demlik/tea/effect";
import {defineProgram, flag, input} from "@kampus/fabrika";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {One, oneOf, tickets, ticketsKind, ticketsOptions} from "@tea-fabrika/tracker";
import {Effect, Schema, Stream} from "effect";

// The map of today's programs, in a tile of its own (./window.tsx): each program a box with its
// real inputs and outputs, the wires that exist in code, the `Ledger` calls dotted, and the
// operate program's nine spots lit by one ticket's facts. The boxes and wires are a table
// (./map.ts), checked against the programs themselves (./map.test.ts); the light is the facts.
//
//   tsh> map --ticket 7        its window takes over the tile
//   // triage and plan done, approval waits on you, the six after it not run yet
//   {kind: "quit"}             on `in`: it ends

export const map = defineProgram({
	name: "map",
	description:
		"The map of today's programs: their inputs, outputs and wires, and where one ticket stands on the plan's nine steps. It has a window.",
	flags: {ticket: flag(TicketNumber, "The ticket whose steps light the map, by its number.")},
	inputs: {
		in: input(
			Schema.Struct({kind: Schema.Literal("quit")}),
			"Quit: the map ends. The window sends nothing else.",
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

export {
	familyOf,
	LEDGER_CALLS,
	PROGRAMS,
	type ProgramName,
	type ProgramNode,
	SPOTS,
	type Where,
	WIRES,
} from "./map.ts";
