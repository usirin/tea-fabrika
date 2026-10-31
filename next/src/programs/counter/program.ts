import {Cmd, defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {defineProgram, Saw} from "../../app/program.ts";

// The smallest program with a window: it counts presses of +1. Its view is the count. It does not
// care how old a press is, so `saw` is kept in the log and never read: a press always counts.

const Shown = Schema.Struct({n: Schema.Int});
type Shown = typeof Shown.Type;

const Press = Schema.Struct({type: Schema.Literal("plus"), saw: Saw});
type Press = typeof Press.Type;

export const counter = defineProgram({
	name: "counter",
	machine: defineMachine({
		types: {model: {} as Shown, msg: {} as Press, ctx: undefined},
		init: (loaded) => [loaded ?? {n: 0}, Cmd.none],
		update: {plus: (state) => [{n: state.n + 1}, Cmd.none]},
	}),
	msg: Press,
	view: {data: Shown, select: (state) => state},
});
