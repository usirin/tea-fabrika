import {Schema} from "effect";
import {open, unchecked} from "./open.ts";
import {flag} from "./register.ts";

// The calls a program writes. `tsc -p experiments/208-typed-line-gaps` passes only while each
// `@ts-expect-error` below is an error.
const via = {_tag: "key", keys: "enter"} as const;

export const good = [
	open({line: "asks --ask a-approve-8 | ticket", from: "t1", via}),
	open({line: "tracker | ticket | ticket", from: "t1", via}),
	open({line: "ticket --ticket 117", from: "t1", via}),
];

export const bad = [
	// @ts-expect-error no program nope
	open({line: "asks | nope", from: "t1", via}),
	// @ts-expect-error ticket | tracker: no output fits an input
	open({line: "ticket | tracker", from: "t1", via}),
	// @ts-expect-error asks --ask: approve-8 does not fit AskId
	open({line: "asks --ask approve-8 | ticket", from: "t1", via}),
	// @ts-expect-error ticket --ticket: 0 does not fit TicketNumber (a gap in 204)
	open({line: "ticket --ticket 0", from: "t1", via}),
	// @ts-expect-error ticket --ticket: 1.5 does not fit TicketNumber (a gap in 204)
	open({line: "ticket --ticket 1.5", from: "t1", via}),
	// @ts-expect-error asks --ask: a-approve-1.5 does not fit AskId (a gap in 204)
	open({line: "asks --ask a-approve-1.5 | ticket", from: "t1", via}),
];

/** A plain number cannot be a flag: it would be read as `${number}`. It says how it is spelled. */
export const unspelled = [
	// @ts-expect-error a number with no spelling
	flag(Schema.Int, "A count."),
	// @ts-expect-error the same, with a check the type cannot see
	flag(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "A count of at least 1."),
	flag(Schema.String, "Free text: any word fits, on both sides."),
	flag(Schema.Literals(["open", "closed"]), "A few fixed words."),
];

/** A line built at run time: a plain string is refused, and `unchecked` says the desk checks it. */
export const built = (id: string) => [
	// @ts-expect-error a line built at run time: pass it through unchecked(line)
	open({line: `asks --ask ${id} | ticket`, from: "t1", via}),
	// @ts-expect-error the same for any string
	open({line: id, from: "t1", via}),
	open({line: unchecked(`asks --ask ${id} | ticket`), from: "t1", via}),
];
