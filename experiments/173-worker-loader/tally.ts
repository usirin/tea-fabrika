// The tiny tea program experiment 173 loads: a copy of programs/counter's machine, with one
// more Msg so the state can grow. Its step is Elm's update and nothing else: a state and a Msg
// in, the next state and its Cmds out. The Msg is checked with an Effect schema first, since
// it comes from outside the isolate.
//
//   step({n: 0, pad: ""}, {type: "plus"})        [{n: 1, pad: ""}, []]
//   step({n: 1, pad: ""}, {type: "add", by: 4})  [{n: 5, pad: ""}, []]
//   step({n: 5, pad: ""}, {type: "minus"})       throws: the schema refuses it
import {applyCell, defineMachine} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {Effect, Schema} from "effect";

export const Tally = Schema.Struct({n: Schema.Int, pad: Schema.String});
export type Tally = typeof Tally.Type;

export const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("plus")}),
	Schema.Struct({type: Schema.Literal("add"), by: Schema.Int}),
]);
export type Msg = typeof Msg.Type;

export const tally = defineMachine({
	types: {model: {} as Tally, msg: {} as Msg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0, pad: ""}, []],
	update: {
		plus: (s) => [{n: s.n + 1, pad: s.pad}, []],
		add: (s, m) => [{n: s.n + m.by, pad: s.pad}, []],
	},
});

const decode = Schema.decodeUnknownSync(Msg);

/** One step: the Msg is checked, then folded. What the core hands across the isolate line. */
export const step = (model: Tally, raw: unknown): readonly [Tally, readonly unknown[]] =>
	applyCell(tally, model, decode(raw));

/** The whole Effect engine, booted and stepped inside the isolate: does `run` work here? */
export const runAll = (msgs: readonly unknown[]): Promise<Tally> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const booting = yield* run(tally, {ctx: undefined});
			const runtime = yield* booting.ready;
			for (const m of msgs) yield* runtime.dispatch(decode(m));
			return runtime.getState();
		}).pipe(Effect.scoped),
	);
