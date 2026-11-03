// Part 2, design B, the change a program author would make: programs/counter's `count` machine,
// copied as it is, in a module of its own. Its schema comes in as a type only, so the build
// erases it: no Effect and no fabrika in this module. The program's schemas, `defineProgram` and
// its Effect `main` stay in the program's other module, which the core runs, not the sandbox.
import {defineMachine} from "@demlik/tea";
import type {Shown} from "@tea-fabrika/counter";

export const count = defineMachine({
	types: {model: {} as Shown, msg: {} as {readonly type: "plus"}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0}, []],
	update: {plus: (s) => [{n: s.n + 1}, []]},
});

/** Its status line, as programs/counter's `kind` says it. */
export const status = (s: Shown) => `${s.n} so far`;
