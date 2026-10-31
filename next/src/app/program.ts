import type {Cmd, Machine} from "@demlik/tea";
import {Schema} from "effect";

// What a program is: a tea machine, the Msgs a window may send it, and what its window gets (A3).
// Plain data and pure code, with no runtime in it, so the window can read `view.data` too.
//
//   const counter = defineProgram({name: "counter", machine, msg: Msg,
//     view: {data: Shown, select: (s) => ({n: s.n})}});

/** Every Msg from a window says which revision it saw. Each program decides what a stale one means. */
export const Saw = Schema.Int;

export type Program<S, M extends {readonly type: string}, V> = {
	readonly name: string;
	readonly machine: Machine<S, M, Cmd<never>, never, undefined>;
	readonly msg: Schema.Codec<M, unknown>;
	readonly view: {
		readonly data: Schema.Codec<V, unknown>;
		readonly select: (state: S) => V;
	};
};

export const defineProgram = <S, M extends {readonly type: string}, V>(
	program: Program<S, M, V>,
): Program<S, M, V> => program;
