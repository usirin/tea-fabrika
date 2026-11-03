// Experiment 99's three programs, on the package's exports alone:
//
//   c:N        a counter with two planted bugs. `crashAfter`: it counts the message, saves, then
//              dies (a defect after the work: a restart goes on past it). `poison`: its pure
//              reducer throws on that message, every time it sees it (a replay brings it back).
//   sup:1      the package's one_for_one supervisor over c:1..c:N, all permanent.
//   watcher:1  keeps a monitor on sup:1 and every child with the package's monitor module, and
//              says each DOWN it reads, with the time it read it. Its state keeps every death it
//              reported: a `down`, or a `gap` of deaths no monitor was on.
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {
	DownMessage,
	defineProgram,
	envelope,
	input,
	Monitor,
	Self,
	type SupervisorSpec,
	supervisor,
} from "@kampus/fabrika-old";
import {Effect, Exit, Schema, Stream} from "effect";

// ---------------------------------------------------------------- the child

export const Count = Schema.Struct({
	count: Schema.Number,
	cursor: Schema.Number,
	last: Schema.NullOr(Schema.String),
});
export type Count = typeof Count.Type;
type Inc = {
	readonly type: "inc";
	readonly id: string;
	readonly rev: number;
	readonly poison: boolean;
};

export const counter = defineMachine({
	types: {model: {} as Count, msg: {} as Inc, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0, cursor: 0, last: null}, []],
	update: {
		inc: (s, m) => {
			if (m.rev <= s.cursor) return [s, []];
			if (m.poison) throw new Error(`poison message ${m.id}`);
			return [{count: s.count + 1, cursor: m.rev, last: m.id}, []];
		},
	},
});

export const Body = Schema.Struct({
	poison: Schema.optional(Schema.Boolean),
	crashAfter: Schema.optional(Schema.Boolean),
});

export const childProgram = defineProgram({
	name: "crashy-counter",
	description:
		"Counts its inbox. Dies after saving a crashAfter message; its reducer throws on a poison one.",
	inputs: {inbox: input(envelope(Body), "One message, maybe with a planted bug.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const handle = yield* self.run(
				counter,
				{schema: Count, cursor: (s) => s.cursor},
				{ctx: undefined},
			);
			const machine = yield* handle.ready;
			yield* inputs.inbox.pipe(
				Stream.runForEach((e) =>
					machine
						.dispatch({type: "inc", id: e.id, rev: e.rev, poison: e.body.poison === true})
						.pipe(
							Effect.andThen(
								e.body.crashAfter === true
									? Effect.die(`planted defect after ${e.id}`)
									: Effect.void,
							),
						),
				),
			);
		}).pipe(Effect.scoped),
});

// ---------------------------------------------------------------- the supervisor

export const childNames = (n: number) => Array.from({length: n}, (_, i) => `c:${i + 1}`);

export const specOf = (
	n: number,
	intensity: number,
	periodMs: number,
	maxDeliveries: number | null,
): SupervisorSpec => ({
	strategy: "one_for_one",
	intensity,
	periodMs,
	maxDeliveries,
	children: childNames(n).map((name) => ({name, restart: "permanent"})),
});

export const supervisorProgram = (spec: SupervisorSpec) => {
	const sup = supervisor("sup:1", spec);
	if (!sup.ok) throw new Error(`the spec is refused: ${sup.why}`);
	return sup.program;
};

// ---------------------------------------------------------------- the watcher

const WatcherState = Schema.Struct({
	monitors: Monitor.Monitors,
	// Every death the watcher reported, once each: a `down`, or a `gap` of deaths no monitor was on.
	reported: Schema.Array(
		Schema.Struct({
			target: Schema.String,
			kind: Schema.Literals(["down", "gap"]),
			from: Schema.Number,
			to: Schema.Number,
			reason: Schema.NullOr(Schema.String),
		}),
	),
});
type WatcherState = typeof WatcherState.Type;
type RetrySub = Sub<"retries", {readonly list: readonly Monitor.Retry[]}>;

const decodeDown = Schema.decodeUnknownExit(DownMessage);

export const watcherProgram = (
	targets: readonly string[],
	retryMs: number,
	line: (o: object) => Effect.Effect<void>,
	maxRetryMs = retryMs,
) => {
	// 99's fixed retry by default; 100 passes a `maxRetryMs` above `retryMs`: the re-arm backs off.
	const monitors = Monitor.update({retryMs, maxRetryMs});
	const step = (s: WatcherState, m: Monitor.MonitorMsg): [WatcherState, Monitor.MonitorCmd[]] => {
		const r = monitors(s.monitors, m);
		const o = r.outcome;
		const ended = Monitor.endedOf(o);
		const reported =
			ended === null || o === null || o.kind === "noproc"
				? s.reported
				: [...s.reported, {...ended, kind: o.kind, reason: o.kind === "down" ? o.reason : null}];
		return [{monitors: r.monitors, reported}, [...r.cmds]];
	};
	const machine = defineMachine<
		WatcherState,
		Monitor.MonitorMsg,
		Monitor.MonitorCmd,
		RetrySub,
		undefined
	>({
		types: {
			model: {} as WatcherState,
			msg: {} as Monitor.MonitorMsg,
			cmd: {} as Monitor.MonitorCmd,
			sub: {} as RetrySub,
			ctx: undefined,
		},
		init: (loaded) => [loaded ?? {monitors: Monitor.noMonitors, reported: []}, []],
		update: {watch: step, resume: step, monitored: step, down: step, retry_due: step},
		subs: [
			// The one cast: tea's `DepKeyedSub` is a conditional type a literal cannot be checked against.
			{
				type: "retries",
				deps: (s: WatcherState) => {
					const list = Monitor.retriesOf(s.monitors);
					return list.length === 0 ? null : {list};
				},
			} as DepKeyedSub<WatcherState, RetrySub>,
		],
	});
	return defineProgram({
		name: "watcher",
		description:
			"Keeps a monitor on each target, monitors again after each DOWN, and says each DOWN.",
		inputs: {inbox: input(envelope(Schema.Unknown), "A DOWN from the ledger.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const handle = yield* self.run(
					machine,
					{schema: WatcherState, cursor: (s) => s.monitors.cursor},
					{
						ctx: undefined,
						interpret: {
							monitor: (cmd) =>
								Effect.map(self.monitor(cmd.ref, cmd.target), (m): Monitor.MonitorMsg => ({
									type: "monitored",
									ref: cmd.ref,
									how: m.how === "on" ? "on" : m.how === "noproc" ? "noproc" : "failed",
									incarnation: m.how === "on" ? m.incarnation : null,
									at: Date.now(),
								})),
						},
						subscribe: {retries: (sub) => Monitor.retries(sub.deps.list)},
					},
				);
				const run = yield* handle.ready;
				yield* run.dispatch({type: "resume"});
				for (const target of targets) yield* run.dispatch({type: "watch", target});
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) => {
						const d = e.kind === "DOWN" ? decodeDown(e.body) : null;
						if (d === null || !Exit.isSuccess(d)) return Effect.void;
						const down = d.value;
						return line({
							ev: "DOWN",
							rev: e.rev,
							ref: down.ref,
							target: down.target,
							incarnation: down.incarnation,
							reason: down.reason,
							downAt: down.at,
							readAt: Date.now(),
						}).pipe(Effect.andThen(run.dispatch({type: "down", rev: e.rev, ...down})));
					}),
				);
			}).pipe(Effect.scoped),
	});
};
