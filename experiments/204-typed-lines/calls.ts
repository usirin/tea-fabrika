import {open, unchecked} from "./open.ts";

// The calls a program writes. `pnpm exec tsc -p experiments/204-typed-lines` passes only while
// each `@ts-expect-error` below is an error.
const via = {_tag: "key", keys: "enter"} as const;

export const good = [
	open({line: "asks --ask a-approve-8 | ticket", from: "t1", via}),
	open({line: "tracker | ticket | ticket", from: "t1", via}),
];

export const bad = [
	// @ts-expect-error no program nope
	open({line: "asks | nope", from: "t1", via}),
	// @ts-expect-error ticket | tracker: no output fits an input
	open({line: "ticket | tracker", from: "t1", via}),
	// @ts-expect-error asks --ask: approve-8 does not fit AskId
	open({line: "asks --ask approve-8 | ticket", from: "t1", via}),
];

/** A line built at run time: a plain string is refused, and `unchecked` says the desk checks it. */
export const built = (id: string) => [
	// @ts-expect-error a line built at run time: pass it through unchecked(line)
	open({line: `asks --ask ${id} | ticket`, from: "t1", via}),
	// @ts-expect-error the same for any string
	open({line: id, from: "t1", via}),
	open({line: unchecked(`asks --ask ${id} | ticket`), from: "t1", via}),
];
