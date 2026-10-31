// Part 2, design B: what the pure-step sandbox runs. Elm's update and nothing else, with
// everything as plain data: a state and a Msg in, the next state, its Cmds and its Subs out.
// No Effect engine and no schema: the core decodes what comes in and runs the Cmds.
//
//   init()                               {state: {n: 0}, cmds: [], subs: []}
//   step({n: 0}, {type: "plus"})         {state: {n: 1}, cmds: [], subs: []}
//   step(tracker, {type: "tick", ...})   {state, cmds: [{type: "load", after: 4}], subs: [...]}
import {applyCell} from "@demlik/tea";

/** The few parts of a tea machine the sandbox calls. */
export interface Pure {
	readonly init: (loaded?: never) => readonly [unknown, readonly unknown[]];
	readonly subs?: readonly {readonly type: string; readonly deps: (s: never) => unknown}[];
}

/** The Subs the state wants on, as data: a `null` deps is a Sub that is off. */
const subsOf = (machine: Pure, state: unknown) =>
	(machine.subs ?? []).flatMap((entry) => {
		const deps = entry.deps(state as never);
		return deps === null || deps === undefined ? [] : [{type: entry.type, deps}];
	});

export const sandboxOf = (machine: Pure) => ({
	init() {
		const [state, cmds] = machine.init();
		return {state, cmds, subs: subsOf(machine, state)};
	},
	step(state: unknown, msg: {readonly type: string}) {
		const [next, cmds] = applyCell(machine as never, state as never, msg as never) as readonly [
			unknown,
			readonly unknown[],
		];
		return {state: next, cmds, subs: subsOf(machine, next)};
	},
});
