// The `counter` tea program: OTP's gen_server, with tea's `update` as its handle_cast. It counts
// the increments it is told. It knows nothing of hosts, leases or the ledger: it asks for a
// `Journal` (a tea store), and the host that starts it hands it one on the ledger, fenced.
//
//   increment {id: "s1-7", rev: 12}    count 4 -> 5, cursor 9 -> 12, last "s1-7"
//   increment {id: "s2-3", rev: 11}    nothing: 11 is at or behind the cursor, already counted
//
// Dropping a repeated message id is the mailbox's job (the host's inbox fold, ./host.ts): the
// first send of an id in the inbox counts, a later one is skipped. The cursor here is the second
// guard: a message the machine has already passed changes nothing, so a replay that feeds a
// message twice cannot count it twice.
import {defineMachine, type FencedStore, type OnError} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {Context, Effect, Schema, Stream} from "effect";
import {defineProgram} from "../../packages/tea-program/src/program.ts";
import {input, output} from "../../packages/tea-program/src/shape.ts";

export const Count = Schema.Struct({
	count: Schema.Number,
	/** The inbox rev of the last increment counted. */
	cursor: Schema.Number,
	/** Its message id: the state events, in order, name every id counted. */
	last: Schema.NullOr(Schema.String),
});
export type Count = typeof Count.Type;

export const ZERO: Count = {count: 0, cursor: 0, last: null};

export const Increment = Schema.Struct({id: Schema.String, rev: Schema.Int});
export type Increment = typeof Increment.Type;

export type CounterMsg = {readonly type: "increment"} & Increment;

export const counter = defineMachine({
	types: {model: {} as Count, msg: {} as CounterMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? ZERO, []],
	update: {
		increment: (s, m) =>
			m.rev <= s.cursor ? [s, []] : [{count: s.count + 1, cursor: m.rev, last: m.id}, []],
	},
});

/** Where the counter keeps its state: the host's to give, never the program's to open. */
/**
 * The journal, and where the run's failures with no caller go. The second is not optional: tea's
 * default sink throws them on a timer, which ends the whole host process. A save refused while
 * the run stops (its final flush, after the host lost the lease) is such a failure.
 */
export class Journal extends Context.Service<
	Journal,
	{readonly store: FencedStore<Count>; readonly onError: OnError}
>()("tea-host/Journal") {}

export const counterProgram = defineProgram({
	name: "counter",
	description:
		"Counts the increments it is told, each saved before the next is read. Started again on its journal, it goes on from the count saved there.",
	inputs: {
		inc: input(Increment, "One increment: its message id and its place in the inbox."),
	},
	outputs: {count: output(Schema.Int, "The count, after each increment is saved.")},
	main: ({inputs, send}) =>
		Effect.gen(function* () {
			const {store, onError} = yield* Journal;
			const handle = yield* run(counter, {ctx: undefined, store, onError});
			const machine = yield* handle.ready;
			// Each dispatch returns once its state is saved: a save the journal refuses fails the
			// dispatch, so `main` fails and the run is gone (OTP: the process exits).
			yield* inputs.inc.pipe(
				Stream.runForEach((m) =>
					machine
						.dispatch({type: "increment", id: m.id, rev: m.rev})
						.pipe(Effect.andThen(() => send("count", machine.getState().count))),
				),
			);
		}).pipe(Effect.scoped),
});
