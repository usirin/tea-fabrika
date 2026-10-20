import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Duration, Effect, Exit, Schema, Scope, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {cast, envelope, Self, savedState, serve} from "./host.ts";
import {DownMessage, Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {
	endedOf,
	type MonitorCmd,
	type MonitorMsg,
	type MonitorOutcome,
	noMonitors,
	type Retry,
	retries,
	retriesOf,
	update,
} from "./monitor.ts";

// A watcher keeps monitors on two names: a crash is one DOWN, a host going away and another taking
// the name over is none, and a name that exited normally is one DOWN `normal`.

const Seen = Schema.Struct({
	target: Schema.String,
	incarnation: Schema.Number,
	reason: Schema.String,
});
const WatcherState = Schema.Struct({
	monitors: Schema.Struct({
		watches: Schema.Array(
			Schema.Struct({
				target: Schema.String,
				n: Schema.Number,
				status: Schema.Literals(["asking", "on", "waiting"]),
				incarnation: Schema.NullOr(Schema.Number),
				due: Schema.NullOr(Schema.Number),
				endedTo: Schema.NullOr(Schema.Number),
			}),
		),
		cursor: Schema.Number,
	}),
	downs: Schema.Array(Seen),
	noprocs: Schema.Number,
});
type WatcherState = typeof WatcherState.Type;
type RetrySub = Sub<"retries", {readonly list: readonly Retry[]}>;

const monitors = update({retryMs: 50});
const step = (s: WatcherState, m: MonitorMsg): [WatcherState, MonitorCmd[]] => {
	const r = monitors(s.monitors, m);
	const o = r.outcome;
	const downs =
		o?.kind === "down"
			? [...s.downs, {target: o.target, incarnation: o.incarnation, reason: o.reason}]
			: s.downs;
	return [
		{monitors: r.monitors, downs, noprocs: s.noprocs + (o?.kind === "noproc" ? 1 : 0)},
		[...r.cmds],
	];
};
const watcher = defineMachine<WatcherState, MonitorMsg, MonitorCmd, RetrySub, undefined>({
	types: {
		model: {} as WatcherState,
		msg: {} as MonitorMsg,
		cmd: {} as MonitorCmd,
		sub: {} as RetrySub,
		ctx: undefined,
	},
	init: (loaded) => [loaded ?? {monitors: noMonitors, downs: [], noprocs: 0}, []],
	update: {watch: step, resume: step, monitored: step, down: step, retry_due: step},
	subs: [
		{
			type: "retries",
			deps: (s: WatcherState) => {
				const list = retriesOf(s.monitors);
				return list.length === 0 ? null : {list};
			},
		} as DepKeyedSub<WatcherState, RetrySub>,
	],
});

const decodeDown = Schema.decodeUnknownExit(DownMessage);

const watcherProgram = (targets: readonly string[]) =>
	defineProgram({
		name: "watcher",
		description: "Keeps a monitor on each target and counts the DOWNs.",
		inputs: {inbox: input(envelope(Schema.Unknown), "A DOWN.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const handle = yield* self.run(
					watcher,
					{schema: WatcherState, cursor: (s) => s.monitors.cursor},
					{
						ctx: undefined,
						interpret: {
							monitor: (cmd) =>
								Effect.map(
									self.monitor(cmd.ref, cmd.target),
									(m): MonitorMsg => ({
										type: "monitored",
										ref: cmd.ref,
										how: m.how === "on" ? "on" : m.how === "noproc" ? "noproc" : "failed",
										incarnation: m.how === "on" ? m.incarnation : null,
										at: Date.now(),
									}),
								),
						},
						subscribe: {retries: (sub) => retries(sub.deps.list)},
					},
				);
				const machine = yield* handle.ready;
				yield* machine.dispatch({type: "resume"});
				for (const target of targets) yield* machine.dispatch({type: "watch", target});
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) => {
						const d = e.kind === "DOWN" ? decodeDown(e.body) : null;
						return d !== null && Exit.isSuccess(d)
							? machine.dispatch({type: "down", rev: e.rev, ...d.value})
							: Effect.void;
					}),
				);
			}).pipe(Effect.scoped),
	});

const Count = Schema.Struct({n: Schema.Number, cursor: Schema.Number});
const Body = Schema.Struct({
	crash: Schema.optional(Schema.Boolean),
	stop: Schema.optional(Schema.Boolean),
});
const counter = defineMachine({
	types: {model: {} as typeof Count.Type, msg: {} as {type: "inc"; rev: number}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0, cursor: 0}, []],
	update: {inc: (s, m) => (m.rev <= s.cursor ? [s, []] : [{n: s.n + 1, cursor: m.rev}, []])},
});
const target = defineProgram({
	name: "target",
	description: "Counts; crashes after a crash message; returns after a stop message.",
	inputs: {inbox: input(envelope(Body), "One message.")},
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
				Stream.mapEffect((e) =>
					machine
						.dispatch({type: "inc", rev: e.rev})
						.pipe(
							Effect.andThen(e.body.crash === true ? Effect.die("planted defect") : Effect.void),
							Effect.as(e.body.stop === true),
						),
				),
				Stream.takeUntil((stop) => stop),
				Stream.runDrain,
			);
		}).pipe(Effect.scoped),
});

const sleep = (ms: number) => Effect.sleep(Duration.millis(ms));
const until = (done: Effect.Effect<boolean, unknown, Ledger>, ms = 15_000) =>
	Effect.gen(function* () {
		const t0 = Date.now();
		while (!(yield* done) && Date.now() - t0 < ms) yield* sleep(20);
	});
const downsOf = Effect.map(savedState("watcher:1", WatcherState), (s) => s.state?.downs ?? []);

describe("monitor", () => {
	it("deaths no monitor was on come back as one gap, and nothing is reported twice", () => {
		const msgs: MonitorMsg[] = [
			{type: "watch", target: "c"},
			{type: "monitored", ref: "c#1", how: "on", incarnation: 3, at: 0},
			{
				type: "down",
				rev: 1,
				ref: "c#1",
				target: "c",
				incarnation: 3,
				reason: "crash",
				why: "x",
				at: 1,
			},
			// The next monitor's answer is lost; it landed on 6 all the same, and so does its retry:
			// c restarted and crashed twice before it landed.
			{type: "monitored", ref: "c#2", how: "failed", incarnation: null, at: 2},
			{type: "retry_due", ref: "c#2"},
			{type: "monitored", ref: "c#3", how: "on", incarnation: 6, at: 3},
			// One death, two DOWNs: one per monitor.
			{
				type: "down",
				rev: 2,
				ref: "c#2",
				target: "c",
				incarnation: 6,
				reason: "crash",
				why: "x",
				at: 4,
			},
			{
				type: "down",
				rev: 3,
				ref: "c#3",
				target: "c",
				incarnation: 6,
				reason: "crash",
				why: "x",
				at: 5,
			},
			// Down when looked at again, two deaths later.
			{type: "monitored", ref: "c#4", how: "noproc", incarnation: null, at: 6},
			{
				type: "down",
				rev: 4,
				ref: "c#4",
				target: "c",
				incarnation: 8,
				reason: "noproc",
				why: "down",
				at: 7,
			},
		];
		const outcomes: MonitorOutcome[] = [];
		let s = noMonitors;
		for (const m of msgs) {
			const r = update({retryMs: 50})(s, m);
			s = r.monitors;
			outcomes.push(r.outcome);
		}
		expect(outcomes.filter((o) => o !== null).map((o) => [o.kind, endedOf(o)])).toEqual([
			["down", {target: "c", from: 3, to: 3}],
			["gap", {target: "c", from: 4, to: 5}],
			["down", {target: "c", from: 6, to: 6}],
			["gap", {target: "c", from: 7, to: 8}],
		]);
		expect(s.watches[0]?.status).toBe("waiting");
	});

	it("one DOWN per real exit, and none for a host takeover", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				for (const name of ["watcher:1", "t:1", "t:2"]) yield* ledger.register(name, "test");
				yield* serve({name: "watcher:1", holder: "w", program: watcherProgram(["t:1", "t:2"])});
				const scopes = new Map<string, Scope.Closeable>();
				for (const [name, holder] of [
					["t:1", "a"],
					["t:1", "b"],
					["t:2", "a2"],
				] as const) {
					const scope = yield* Scope.make();
					scopes.set(holder, scope);
					yield* serve({name, holder, program: target, ttlMs: 400, renewEveryMs: 100}).pipe(
						Scope.provide(scope),
					);
				}
				const on = (n: number) =>
					Effect.map(
						savedState("watcher:1", WatcherState),
						(s) => (s.state?.monitors.watches ?? []).filter((w) => w.status === "on").length === n,
					);
				yield* until(on(2));
				// A takeover: t:1's holder goes away, the other host claims it. Not a death.
				const held = yield* ledger.lease("t:1");
				const owner = held === null ? undefined : scopes.get(held.holder);
				if (owner !== undefined) yield* Scope.close(owner, Exit.void);
				yield* until(
					Effect.map(ledger.lease("t:1"), (l) => l !== null && l.holder !== held?.holder),
				);
				yield* cast("t:1", "x1", {}, "sender");
				yield* sleep(300);
				const afterTakeover = yield* downsOf;
				// A crash of t:1 and a normal stop of t:2: one DOWN each.
				yield* cast("t:1", "boom", {crash: true}, "sender");
				yield* cast("t:2", "bye", {stop: true}, "sender");
				yield* until(Effect.map(downsOf, (d) => d.length >= 2));
				yield* sleep(400);
				return {
					afterTakeover,
					downs: yield* downsOf,
					inbox: yield* ledger.readStream("watcher:1/inbox"),
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(out.afterTakeover).toEqual([]);
		expect(out.downs).toEqual([
			{target: "t:1", incarnation: 1, reason: "crash"},
			{target: "t:2", incarnation: 1, reason: "normal"},
		]);
		const real = out.inbox.filter((r) => r.kind === "DOWN" && !r.data.includes("noproc"));
		expect(real.length).toBe(2);
	}, 30_000);
});
