import {run} from "@demlik/tea/effect";
import {defineProgram, end, flag, input, kind, TraceId, Traces} from "@kampus/fabrika";
import {Effect, Schema} from "effect";
import {
	Model,
	RowKey,
	type read,
	statusOf,
	type TraceMsg,
	trace as traceMachine,
} from "./machine.ts";
import {Shown, shownOf} from "./view.ts";

// One job's trace, in a tile of its own (./window.tsx): read from the job's record through the
// `Traces` service, drawn as a waterfall (one bar per span, nested by parent, one colour per
// program, its events as dots), and every row that groups others opens, down to one step: its
// Msg, the state before and after, and the Cmds it started. Elm's debugger and Redux DevTools
// for the steps, Jaeger's span detail for the spans.
//
//   tsh> trace --id 6c0f…e3a1           its window takes over the tile
//   {kind: "toggle", row: "job"}         on `do`: the job's row closes; again, it opens
//   {kind: "choose", row: "step:…"}      the step's detail shows
//   {kind: "quit"}                       it ends
//
//   tsh> runs --ticket 7 | trace         no flag: it says "pick a run" until an id comes on `id`
//   // a run picked in runs' window: runs sends its trace id, and this one reads that record.
//   // A newer id replaces the record shown.
//
// The record holds no ticket. A trace that belongs to a ticket is opened from that ticket's
// facts, as `runs` does; the trace never draws another program's view.

/** What the window does: open or close a row, show one row's detail, or quit. */
export const Do = Schema.Union([
	Schema.Struct({kind: Schema.Literal("toggle"), row: RowKey}),
	Schema.Struct({kind: Schema.Literal("choose"), row: Schema.NullOr(RowKey)}),
	Schema.Struct({kind: Schema.Literal("quit")}),
]);
export type Do = typeof Do.Type;

const msgOf = (d: Exclude<Do, {readonly kind: "quit"}>): TraceMsg =>
	d.kind === "toggle" ? {type: "toggle", row: d.row} : {type: "choose", row: d.row};

/** The record's one read, through `Traces`. */
const readCell = (cmd: ReturnType<typeof read>) =>
	Effect.gen(function* () {
		return yield* (yield* Traces).read(cmd.id);
	}).pipe(Effect.mapError((e) => ({_tag: "unread" as const, why: e.message})));

/** How the machine runs: its one cell, on the `Traces` service. */
export const traceOptions = {ctx: undefined, interpret: {read: readCell}};

/** The machine as the program declares it: kept nowhere, since the record keeps the trace. */
export const traceKind = kind({
	machine: traceMachine,
	state: Model,
	parent: "main",
	options: () => traceOptions,
	drawing: () => ({name: "trace", steps: {read: "read the record"}}),
	status: statusOf,
});

export const trace = defineProgram({
	name: "trace",
	description:
		"One job's trace, read from its record: a bar per span, nested by parent, one colour per program, and every grouped row opening down to one step, with its Msg, the state before and after, and its Cmds. It has a window.",
	flags: {
		id: flag(
			Schema.UndefinedOr(TraceId),
			"The job's trace id: 32 hex characters, the trace id of its first run. Left out, it waits for one on `id`.",
		),
	},
	inputs: {
		do: input(Do, "What the window does: open or close a row, show a row's detail, or quit."),
		id: input(TraceId, "A job's trace id: its record replaces the one shown, as `runs` sends."),
	},
	outputs: {},
	machines: {trace: traceKind},
	view: {machine: "trace", data: Shown, of: shownOf},
	main: ({flags, serve, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(traceMachine, traceOptions)).ready;
			const look = (id: string) => runtime.dispatch({type: "look", id}).pipe(Effect.orDie);
			if (flags.id !== undefined) yield* look(flags.id);
			yield* watch("trace", "trace", runtime);
			// Each id told, in order with the window's writes: a pipe's end does not end the window. A
			// quit, or `do` closed, does.
			yield* serve(
				{
					id: look,
					do: (d) => (d.kind === "quit" ? end : runtime.dispatch(msgOf(d)).pipe(Effect.orDie)),
				},
				{until: ["do"]},
			);
		}).pipe(Effect.scoped),
});

export {Model, Read, read, statusOf, type TraceMsg} from "./machine.ts";
export {groupsOf, JOB, type Node, nodesOf, treeOf} from "./tree.ts";
export {Change, changesOf, Detail, Row, Shown, shownOf} from "./view.ts";
