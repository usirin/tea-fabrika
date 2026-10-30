import {run} from "@demlik/tea/effect";
import {
	anyInput,
	defineProgram,
	end,
	flag,
	input,
	jobTraceId,
	kind,
	TraceId,
	Traces,
} from "@kampus/fabrika";
import {Clock, Duration, Effect, Schema, Stream} from "effect";
import {
	type FollowSub,
	Model,
	RowKey,
	statusOf,
	type TraceMsg,
	trace as traceMachine,
} from "./machine.ts";
import {Shown, shownOf} from "./view.ts";

// One job's trace, in a tile of its own (./window.tsx): read from the job's record through the
// `Traces` service, drawn as a waterfall (one bar per span, nested by parent, one colour per
// program, its events as dots), and every row that groups others opens, down to one step: its
// Msg, the state before and after, and the Cmds it started. Elm's debugger and Redux DevTools
// for the steps, Jaeger's span detail for the spans.
//
//   tsh> seq --to 3 | tally | trace      no flag: its own line's job, followed as it goes
//   // tally's total fits no input of trace, so it is wired to `any`, which takes it and lets it go
//   tsh> trace --id 6c0f…e3a1            that job's record, followed while the job runs
//   toggle {row: "job"}                  the job's row closes; again, it opens
//   choose {row: "step:…"}               the step's detail shows
//   quit null                            it ends
//
//   tsh> runs --ticket 7 | trace         its own line's job, until an id comes on `id`
//   // a run picked in runs' window: runs sends its trace id, and this one follows that record.
//   // A newer id replaces the record shown.
//
// `any` is how `pv` and `tee` sit in a Unix pipe: anything comes in, and being in the line is
// enough. Elm's `Json.Decode.value` is the same promise in a type: a value nobody decodes.
//
// The record holds no ticket. A trace that belongs to a ticket is opened from that ticket's
// facts, as `runs` does; the trace never draws another program's view.

/** A row to open or close. */
export const Toggle = Schema.Struct({row: RowKey});
/** The row whose detail shows, or `null` for none. */
export const Choose = Schema.Struct({row: Schema.NullOr(RowKey)});

/** The window's own inputs: closing them all ends the program, as a quit does. */
const WINDOW = ["toggle", "choose", "quit"] as const;

/**
 * How long a record is still followed once its job has ended: the spans that end last, the
 * line's own among them, come in after the job's end is written.
 */
export const SETTLE = Duration.seconds(5);

/** Its job ended more than `SETTLE` ago: the record will not change again. */
const settled = (t: {readonly job: {readonly ended: {readonly at: number} | null} | null}) =>
	Effect.map(
		Clock.currentTimeMillis,
		(now) =>
			t.job !== null && t.job.ended !== null && now - t.job.ended.at > Duration.toMillis(SETTLE),
	);

/** The record, followed through `Traces`: a `got` per read of it, and one `lost` if it cannot be read. */
const followRunner = (sub: FollowSub) =>
	Stream.unwrap(
		Effect.gen(function* () {
			return (yield* Traces).watch(sub.deps.id);
		}),
	).pipe(
		Stream.takeUntilEffect(settled),
		Stream.map((t): TraceMsg => ({type: "got", trace: t})),
		Stream.catchTag(
			"TraceUnread",
			(e): Stream.Stream<TraceMsg> => Stream.make({type: "lost", id: sub.deps.id, why: e.message}),
		),
	);

/** How the machine runs: its one Sub, on the `Traces` service. */
export const traceOptions = {ctx: undefined, interpret: {}, subscribe: {follow: followRunner}};

/** The machine as the program declares it: kept nowhere, since the record keeps the trace. */
export const traceKind = kind({
	machine: traceMachine,
	state: Model,
	parent: "main",
	options: () => traceOptions,
	drawing: () => ({name: "trace", steps: {follow: "follow the record"}}),
	status: statusOf,
});

export const trace = defineProgram({
	name: "trace",
	description:
		"One job's trace, read from its record: a bar per span, nested by parent, one colour per program, and every grouped row opening down to one step, with its Msg, the state before and after, and its Cmds. It has a window.",
	flags: {
		id: flag(
			Schema.UndefinedOr(TraceId),
			"The job's trace id: 32 hex characters, the trace id of its first run. Left out, it shows its own line's job until one comes on `id`.",
		),
	},
	inputs: {
		toggle: input(Toggle, "Open or close a row that groups others."),
		choose: input(Choose, "Show one row's detail, or none with `null`."),
		quit: input(Schema.Null, "Stop."),
		id: input(TraceId, "A job's trace id: its record replaces the one shown, as `runs` sends."),
		any: anyInput(
			"Anything else on a pipe, let go unread: being in the line is enough, as with `pv`.",
		),
	},
	outputs: {},
	machines: {trace: traceKind},
	view: {machine: "trace", data: Shown, of: shownOf},
	main: ({flags, serve, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(traceMachine, traceOptions)).ready;
			const look = (id: string) => runtime.dispatch({type: "look", id}).pipe(Effect.orDie);
			// The flag's job, or else its own line's: `null` when it runs in no job (a test).
			const first = flags.id ?? (yield* jobTraceId);
			if (first !== null) yield* look(first);
			yield* watch("trace", "trace", runtime);
			const step = (msg: TraceMsg) => runtime.dispatch(msg).pipe(Effect.orDie);
			// Each id told, in order with the window's inputs: a pipe's end does not end the window. A
			// quit, or the window's inputs closed, does. Anything on `any` is taken and let go, so
			// the program before it never waits on it.
			yield* serve(
				{
					id: look,
					any: () => Effect.void,
					toggle: ({row}) => step({type: "toggle", row}),
					choose: ({row}) => step({type: "choose", row}),
					quit: () => end,
				},
				{until: WINDOW},
		}).pipe(Effect.scoped),
});

export {type FollowSub, followed, Model, Read, statusOf, type TraceMsg} from "./machine.ts";
export {groupsOf, JOB, type Node, nodesOf, treeOf} from "./tree.ts";
export {Change, changesOf, Detail, Row, Shown, shownOf} from "./view.ts";
