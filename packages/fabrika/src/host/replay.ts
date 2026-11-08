import type {Cmd} from "@demlik/tea";
import {replayTrace, type Trace} from "@demlik/tea/persistence";
import {Cause, Context, Effect, Exit, Layer, Schema} from "effect";
import type {Entry} from "../program/listed.ts";
import type {Kinds} from "../program/program.ts";
import type {Start, Step} from "./traces.ts";

// One machine run of a job's record, replayed through today's code
// (docs/plan/replay-through-current-code.md, section 2). Pure: it names no platform, and no Cmd,
// Store or Sub ever runs. The record keeps where each boot started (`starts`) and every Msg folded
// after it (`steps`); each life, a start and the steps until the next start, becomes one tea
// `Trace` from its start's state, and tea's `replayTrace` folds its Msgs through the machine as the
// code is now, comparing each step's state, then its Cmds, with what was recorded. Elm's debugger
// does the same on an imported history: it folds the Msgs again from the history's own initial
// model and keeps only the model.
//
//   replayOf([tally], {starts, steps})     {_tag: "matches", steps: 3}
//   with tally's add adding n + 1          {_tag: "parts", n: 1, msg: {type: "add", n: 1}, path: "state.total", recorded: 1, replayed: 2}
//   with no add at all                     {_tag: "refused", n: 1, msg, state: "(untagged state)", accepts: []}
//   with no start kept                     {_tag: "cannot", why: "no_start", n: null, detail: "..."}
//
// A restart is a new life, never a verdict: tea's own rule is one boot per recording ("A trace has
// exactly one boot line", its `parseJSONL`), so each life replays from its own start, in order. A
// start whose state is not what the step before it left is a crash between a step's write and its
// save, and replays on. The first life that parts or is refused is the answer; its `n` is the
// record's step number. States go in through the kind's own state schema, as storage reads them;
// Msgs and Cmds as the record keeps them, their JSON. A kind's `options`, the only place a Cmd
// handler can come from, is never asked for.

/** What one machine run's replay answers. `n` is always the record's step number, from 1. */
export const Replayed = Schema.TaggedUnion({
	/** Today's code folds the same states and starts the same Cmds at every step. */
	matches: {steps: Schema.Int},
	/** Step `n` parts from the recording at `path`, which starts at `state` or `cmds`. */
	parts: {
		n: Schema.Int,
		msg: Schema.Unknown,
		path: Schema.String,
		recorded: Schema.Unknown,
		replayed: Schema.Unknown,
	},
	/** Today's code has no cell for step `n`'s Msg in the state it came to. */
	refused: {
		n: Schema.Int,
		msg: Schema.Unknown,
		state: Schema.String,
		accepts: Schema.Array(Schema.String),
	},
	/**
	 * No replay could be made. `no_start`: recorded before its start was kept. `no_code`: no
	 * program or machine of that name today. `state_refused`: a kept state its schema now refuses,
	 * at step `n` (0 for a start). `threw`: today's update threw.
	 */
	cannot: {
		why: Schema.Literals(["no_start", "no_code", "state_refused", "threw"]),
		n: Schema.NullOr(Schema.Int),
		detail: Schema.String,
	},
});
export type Replayed = typeof Replayed.Type;

/** Today's code, as a replay reads it: each program's kept machines, by name. */
export interface Code {
	readonly name: string;
	readonly machines: Kinds;
}

/** One machine run's rows, as a job's record keeps them. */
export interface Rows {
	readonly starts: readonly Start[];
	readonly steps: readonly Step[];
}

const cannot = (
	why: Extract<Replayed, {_tag: "cannot"}>["why"],
	n: number | null,
	detail: string,
) => Replayed.cases.cannot.make({why, n, detail});

/** A failure in a few words: its message, else itself. */
const wordsOf = (error: unknown): string =>
	error instanceof Error && error.message !== "" ? error.message : String(error);

/** Replay one machine run's rows through `code`. See the note at the top of this file. */
export const replayOf = (code: readonly Code[], {starts, steps}: Rows): Replayed => {
	const lives = starts.toSorted((a, b) => a.n - b.n);
	const first = lives[0];
	// The boot before its first step is the one fact a replay folds from: without it, nothing can.
	if (first === undefined || first.after !== 0)
		return cannot("no_start", null, "recorded before its start was kept");
	const program = code.find((p) => p.name === first.program);
	if (program === undefined)
		return cannot("no_code", null, `today's code lists no program ${first.program}`);
	const kind = program.machines[first.machine];
	if (kind === undefined)
		return cannot("no_code", null, `${first.program} has no machine ${first.machine} today`);

	const decode = Schema.decodeUnknownExit(kind.state);
	const loaded: unknown[] = [];
	for (const s of lives) {
		const read = decode(s.state);
		if (Exit.isFailure(read))
			return cannot("state_refused", 0, `start ${s.n}: ${wordsOf(Cause.squash(read.cause))}`);
		loaded.push(read.value);
	}
	const ordered = steps.toSorted((a, b) => a.n - b.n);
	const states: unknown[] = [];
	for (const s of ordered) {
		const read = decode(s.state);
		if (Exit.isFailure(read))
			return cannot("state_refused", s.n, `step ${s.n}: ${wordsOf(Cause.squash(read.cause))}`);
		states.push(read.value);
	}

	for (const [i, start] of lives.entries()) {
		const until = lives[i + 1]?.after ?? Infinity;
		const life = ordered.flatMap((s, j) =>
			s.n > start.after && s.n <= until ? [{row: s, state: states[j]}] : [],
		);
		const last = life.at(-1);
		const trace: Trace<unknown, {type: string}> = {
			loaded: loaded[i],
			// The record keeps each Msg as JSON, and each kept machine's Msgs are plain data.
			msgs: life.map(({row}) => row.msg as {type: string}),
			finalState: last === undefined ? loaded[i] : last.state,
			steps: life.map(({row, state}) => ({
				msg: row.msg as {type: string},
				state,
				cmds: row.cmds as readonly Cmd[],
			})),
		};
		const ran = Effect.runSync(
			Effect.exit(
				Effect.try({
					try: () => replayTrace(kind.machine, trace),
					catch: (thrown) => wordsOf(thrown),
				}),
			),
		);
		if (Exit.isFailure(ran))
			return cannot(
				"threw",
				null,
				`today's ${first.machine} threw: ${wordsOf(Cause.squash(ran.cause))}`,
			);
		const {refusal, divergence} = ran.value;
		if (refusal !== undefined)
			return Replayed.cases.refused.make({
				n: life[refusal.index]?.row.n ?? 0,
				msg: refusal.msg,
				state: refusal.stateName,
				accepts: refusal.acceptedTypes,
			});
		if (divergence !== undefined)
			return Replayed.cases.parts.make({
				n: life[divergence.at?.index ?? life.length - 1]?.row.n ?? start.after,
				msg: divergence.at?.msg ?? null,
				path: divergence.path,
				recorded: divergence.expected,
				replayed: divergence.actual,
			});
	}
	return Replayed.cases.matches.make({steps: ordered.length});
};

/** Replays one machine run through the code of the programs a host lists. */
export class Replayer extends Context.Service<
	Replayer,
	{readonly replay: (rows: Rows) => Effect.Effect<Replayed>}
>()("@kampus/fabrika-old/Replayer") {}

/** The `Replayer` over `entries`: the programs a host lists, as a tile's tsh lists them. */
export const layerReplayer = (entries: readonly Entry[]) => {
	const code = entries.map((e) => e.program);
	return Layer.succeed(
		Replayer,
		Replayer.of({replay: (rows) => Effect.sync(() => replayOf(code, rows))}),
	);
};
