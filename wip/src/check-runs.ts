import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import type {Checks} from "./stages/review/pack.ts";

// The checks a local review counts: commands run at one exact commit, in a
// copy of it made for the run (./code-host-local.ts). Kept as a plain fold
// over finished runs, as tea's update is: the local code host folds each run
// in and reads a head's checks back, and the laws check
// (./laws/check-runs.ts) walks it as a machine.
//
//   ran   every check of one run finished. `asked`: the commit the run was
//         started for. `at`: the one commit its copy stood at from the first
//         check to the last, read from the copy itself; `null` when it moved
//         or could not be read. Only `at` says what the results are about.
//
//   let r = NONE;
//   r = apply(r, {type: "ran", asked: "A", at: "A", results: [{name: "test", state: "green"}]});
//   checksAt(r, "A", ["test"]);   // {state: "green", required: [{name: "test", state: "green"}]}
//   checksAt(r, "B", ["test"]);   // {state: "pending", required: [{name: "test", state: "pending"}]}
//
// Why `at` and not `asked`: a run is asked for a commit, and what it checked
// is what its copy held. When the two differ, the results are about the
// copy's, and the asked one has none.

/** How one check of a run ended: its command answered 0, or it did not. */
export const Result = Schema.Struct({
	name: Schema.String,
	state: Schema.Literals(["green", "red"]),
});
export type Result = typeof Result.Type;

/** One finished run. */
export const Ran = Schema.Struct({
	asked: Schema.String,
	at: Schema.NullOr(Schema.String),
	results: Schema.Array(Result),
});
export type Ran = typeof Ran.Type;

/** Every run so far, oldest first. */
export interface Runs {
	readonly runs: readonly Ran[];
}

export const NONE: Runs = {runs: []};

export type RunsMsg = {readonly type: "ran"} & Ran;

/** One finished run, folded in. Pure. */
export const apply = (r: Runs, m: RunsMsg): Runs => ({
	runs: [...r.runs, {asked: m.asked, at: m.at, results: m.results}],
});

/** The runs as a tea machine: no Cmds, each finished run a Msg. The local code host folds through `apply`, the same code. */
export const checkRuns = defineMachine({
	types: {model: {} as Runs, msg: {} as RunsMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? NONE, []],
	update: {ran: (s, m) => [apply(s, m), []]},
});

/** The last run whose copy stood at `head` the whole time. `null`: none did. */
export const lastAt = (r: Runs, head: string): Ran | null =>
	r.runs.findLast((run) => run.at === head) ?? null;

/**
 * The checks of `head`, as a review reads them: the last run that stood at
 * that exact commit. With none, each named check is pending: no run is the
 * same as one not finished.
 */
export function checksAt(r: Runs, head: string, names: readonly string[]): Checks {
	const run = lastAt(r, head);
	if (run === null)
		return {state: "pending", required: names.map((name) => ({name, state: "pending" as const}))};
	return {
		state: run.results.some((result) => result.state === "red") ? "red" : "green",
		required: run.results,
	};
}
