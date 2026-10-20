import {defineMachine} from "@demlik/tea";
import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Duration, Effect, Exit, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {deadLetters, redrive} from "./dead-letters.ts";
import {cast, envelope, Self, savedState, serve} from "./host.ts";
import {ExitMessage, Ledger, type Row, streams} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {
	type Answer,
	type ChildSpec,
	delayOf,
	NOT_BEGUN,
	Reply,
	type SupervisorMsg,
	type SupervisorSpec,
	SupervisorState,
	startsOf,
	stopOf,
	superviseWith,
	supervisor,
} from "./supervisor.ts";

// Experiment 100's supervisor: the strategies, a tree, calls, shutdown timeouts, backoff, and dead
// letters sent back. First the pure machine driven by a fake world, then the program on the
// in-memory ledger. The fault runs (three hosts, kills, freezes) are experiments/100-*.ts.

// ---------------------------------------------------------------- the pure machine

/**
 * A fake world for the reducer: it answers every start and every stop the state asks for, the way
 * the ledger would, and writes down what it did, in order.
 */
const world = (name: string, spec: SupervisorSpec) => {
	const step = superviseWith(name, spec);
	const runs = new Map<string, {inc: number; up: boolean}>();
	const did: string[] = [];
	let s = step(NOT_BEGUN, {type: "begin", incarnation: 1, parent: null});
	let rev = 0;
	let now = 1000;
	const feed = (m: SupervisorMsg) => {
		s = step(s, m);
	};
	const exit = (child: string, reason: "crash" | "shutdown" | "killed" | "normal", at = now) => {
		const r = runs.get(child);
		if (r === undefined || !r.up) return;
		r.up = false;
		feed({type: "exit", rev: ++rev, from: child, to: 1, incarnation: r.inc, reason, why: "x", at});
	};
	/** Answer what the state asks for until it asks for nothing more (or `limit` steps). */
	const settle = (limit = 100) => {
		for (let i = 0; i < limit; i++) {
			const stop = stopOf(s);
			if (stop !== null) {
				did.push(`stop ${stop.name}`);
				const r = runs.get(stop.name);
				const live = r?.up === true && r.inc === stop.incarnation;
				feed({
					type: "signalled",
					name: stop.name,
					incarnation: stop.incarnation,
					signal: stop.signal,
					how: live ? "exited" : "noproc",
					at: now,
				});
				exit(stop.name, stop.signal === "kill" ? "killed" : "shutdown");
				continue;
			}
			const start = startsOf(s)[0];
			if (start === undefined) return;
			now = Math.max(now, start.notBefore);
			const r = runs.get(start.name) ?? {inc: 0, up: false};
			if (!r.up) {
				r.inc += 1;
				r.up = true;
			}
			runs.set(start.name, r);
			did.push(`start ${start.name}`);
			feed({
				type: "started",
				name: start.name,
				incarnation: r.inc,
				at: now,
				generation: start.generation,
			});
		}
	};
	return {
		get state() {
			return s;
		},
		did,
		feed,
		exit,
		settle,
		clock: (t: number) => {
			now = t;
		},
		nextRev: () => ++rev,
	};
};

const kids = (prefix: string, n: number): ChildSpec[] =>
	Array.from({length: n}, (_, i) => ({name: `${prefix}${i + 1}`, restart: "permanent"}));

const base = (strategy: SupervisorSpec["strategy"]): SupervisorSpec => ({
	strategy,
	intensity: 5,
	periodMs: 5000,
	children: kids("c", 4),
});

describe("the supervisor's strategies", () => {
	it("one_for_one starts the crashed child again, alone", () => {
		const w = world("s", base("one_for_one"));
		w.settle();
		w.did.length = 0;
		w.exit("c2", "crash");
		w.settle();
		expect(w.did).toEqual(["start c2"]);
	});

	it("one_for_all stops the others in reverse order, then starts all in order", () => {
		const w = world("s", base("one_for_all"));
		w.settle();
		expect(w.did).toEqual(["start c1", "start c2", "start c3", "start c4"]);
		w.did.length = 0;
		w.exit("c2", "crash");
		w.settle();
		expect(w.did).toEqual([
			"stop c4",
			"stop c3",
			"stop c1",
			"start c1",
			"start c2",
			"start c3",
			"start c4",
		]);
		expect(w.state.restarted).toBe(1);
	});

	it("rest_for_one stops only the children after it, then starts it and them in order", () => {
		const w = world("s", base("rest_for_one"));
		w.settle();
		w.did.length = 0;
		w.exit("c2", "crash");
		w.settle();
		expect(w.did).toEqual(["stop c4", "stop c3", "start c2", "start c3", "start c4"]);
		w.did.length = 0;
		w.exit("c4", "crash");
		w.settle();
		expect(w.did).toEqual(["start c4"]);
	});

	it("a sibling that crashes while the group is being stopped is still one restart", () => {
		const w = world("s", base("one_for_all"));
		w.settle();
		w.exit("c2", "crash");
		// c3 crashes on its own before its stop is sent: its exit completes the stop.
		w.exit("c3", "crash");
		w.settle();
		expect(w.state.restarted).toBe(1);
		expect(w.state.children.every((c) => c.run.is === "up")).toBe(true);
	});

	it("a start in flight when a group restart catches it is stopped and started again, in order", () => {
		const step = superviseWith("s", base("rest_for_one"));
		let s = step(NOT_BEGUN, {type: "begin", incarnation: 1, parent: null});
		for (const [i, name] of ["c1", "c2", "c3"].entries())
			s = step(s, {type: "started", name, incarnation: 1, at: i, generation: 0});
		// c4's start is on its way (generation 0) when c2 crashes: c4 must not run ahead of c2.
		const generation = startsOf(s).find((p) => p.name === "c4")?.generation;
		s = step(s, {
			type: "exit",
			rev: 1,
			from: "c2",
			to: 1,
			incarnation: 1,
			reason: "crash",
			why: "x",
			at: 10,
		});
		s = step(s, {type: "started", name: "c4", incarnation: 1, at: 11, generation: generation ?? 0});
		const c4 = s.children.find((c) => c.name === "c4");
		expect(c4?.run.is).toBe("stopping");
		// Last started, first stopped: c4, then c3; then c2, c3, c4 start again in order.
		expect(stopOf(s)?.name).toBe("c4");
	});

	it("a temporary child is never started again; a transient one only after a crash or a kill", () => {
		const spec: SupervisorSpec = {
			...base("one_for_one"),
			children: [
				{name: "t", restart: "temporary"},
				{name: "tr", restart: "transient"},
				{name: "p", restart: "permanent"},
			],
		};
		const w = world("s", spec);
		w.settle();
		w.did.length = 0;
		w.exit("t", "crash");
		w.exit("tr", "shutdown");
		w.settle();
		expect(w.did).toEqual([]);
		expect(w.state.children.map((c) => `${c.name} ${c.run.is}`)).toEqual(["tr stopped", "p up"]);
	});

	it("past its intensity it stops every child in reverse order, then exits", () => {
		const w = world("s", {...base("one_for_one"), intensity: 3});
		w.settle();
		for (let i = 0; i < 3; i++) {
			w.exit("c1", "crash");
			w.settle();
		}
		expect(w.state.phase).toBe("running");
		w.did.length = 0;
		w.exit("c1", "crash");
		w.settle();
		expect(w.did).toEqual(["stop c4", "stop c3", "stop c2"]);
		expect(w.state.phase).toBe("shutdown");
		expect(w.state.why).toContain("reached_max_restart_intensity");
	});

	it("an EXIT for an earlier run of the supervisor itself changes nothing", () => {
		const w = world("s", base("one_for_one"));
		w.settle();
		const before = w.state.restarted;
		w.feed({
			type: "exit",
			rev: w.nextRev(),
			from: "c1",
			to: 0,
			incarnation: 1,
			reason: "crash",
			why: "old",
			at: 2000,
		});
		w.settle();
		expect(w.state.restarted).toBe(before);
	});
});

describe("shutdown: brutal_kill, a timeout, infinity", () => {
	it("sends shutdown, then kill at the timeout; brutal_kill kills at once; infinity waits", () => {
		const spec: SupervisorSpec = {
			...base("one_for_all"),
			children: [
				{name: "k", restart: "permanent", shutdown: "brutal_kill"},
				{name: "t", restart: "permanent", shutdown: 300},
				{name: "i", restart: "permanent", type: "supervisor"},
				{name: "x", restart: "permanent"},
			],
		};
		const step = superviseWith("s", spec);
		let s = step(NOT_BEGUN, {type: "begin", incarnation: 1, parent: null});
		for (const [i, c] of spec.children.entries())
			s = step(s, {type: "started", name: c.name, incarnation: 1, at: i, generation: 0});
		s = step(s, {
			type: "exit",
			rev: 1,
			from: "x",
			to: 1,
			incarnation: 1,
			reason: "crash",
			why: "b",
			at: 100,
		});
		// The last child first: `i`, a supervisor, gets shutdown and no kill.
		expect(stopOf(s)).toEqual({name: "i", incarnation: 1, signal: "shutdown", at: 0});
		s = step(s, {
			type: "signalled",
			name: "i",
			incarnation: 1,
			signal: "shutdown",
			how: "signalled",
			at: 110,
		});
		expect(stopOf(s)).toBe(null);
		s = step(s, {
			type: "exit",
			rev: 2,
			from: "i",
			to: 1,
			incarnation: 1,
			reason: "shutdown",
			why: "ok",
			at: 120,
		});
		expect(stopOf(s)).toEqual({name: "t", incarnation: 1, signal: "shutdown", at: 0});
		s = step(s, {
			type: "signalled",
			name: "t",
			incarnation: 1,
			signal: "shutdown",
			how: "signalled",
			at: 130,
		});
		expect(stopOf(s)).toEqual({name: "t", incarnation: 1, signal: "kill", at: 430});
		s = step(s, {
			type: "exit",
			rev: 3,
			from: "t",
			to: 1,
			incarnation: 1,
			reason: "killed",
			why: "slow",
			at: 431,
		});
		expect(stopOf(s)).toEqual({name: "k", incarnation: 1, signal: "kill", at: 0});
	});
});

describe("restart backoff", () => {
	const spec: SupervisorSpec = {
		...base("one_for_one"),
		intensity: 4,
		periodMs: 10_000,
		backoff: {minMs: 100, maxMs: 800, resetAfterMs: 1000},
	};

	it("waits min * 2^(n-1) after each exit in a row, capped, and a long run ends the row", () => {
		const w = world("s", spec);
		w.settle();
		const waits: number[] = [];
		let at = 1000;
		for (let i = 0; i < 4; i++) {
			w.clock(at);
			w.exit("c1", "crash", at);
			const start = startsOf(w.state)[0];
			waits.push((start?.notBefore ?? 0) - at);
			w.settle();
			at = (start?.notBefore ?? 0) + 10;
		}
		expect(waits).toEqual([100, 200, 400, 800]);
		expect(delayOf(spec.backoff, 6)).toBe(800);
		// A fifth crash inside the period: the brake trips.
		w.clock(at);
		w.exit("c1", "crash", at);
		expect(w.state.phase).not.toBe("running");
	});

	it("a run that lived resetAfterMs starts the row again", () => {
		const w = world("s", spec);
		w.settle();
		w.clock(1000);
		w.exit("c1", "crash", 1000);
		w.settle();
		w.clock(1100);
		w.exit("c1", "crash", 1100);
		const second = startsOf(w.state)[0];
		expect((second?.notBefore ?? 0) - 1100).toBe(200);
		w.settle();
		w.clock(5000);
		w.exit("c1", "crash", 5000);
		expect((startsOf(w.state)[0]?.notBefore ?? 0) - 5000).toBe(100);
	});

	it("refuses a backoff whose waits spread the intensity past the period", () => {
		expect(
			supervisor("s", {
				...spec,
				periodMs: 1000,
				backoff: {minMs: 100, maxMs: 800, resetAfterMs: 1000},
			}).ok,
		).toBe(false);
		expect(supervisor("s", spec).ok).toBe(true);
		expect(supervisor("s", {...spec, backoff: {minMs: 0, maxMs: 1, resetAfterMs: 0}}).ok).toBe(
			false,
		);
	});
});

describe("calls", () => {
	const call = (rev: number, id: string, req: Extract<SupervisorMsg, {type: "request"}>["req"]) =>
		({type: "request", rev, caller: {id, replyTo: "h/inbox"}, req}) as const;

	it("answers once the work is done, and a resent call gets the same answer, once", () => {
		const w = world("s", base("one_for_one"));
		w.settle();
		w.feed(call(w.nextRev(), "q1", {op: "terminate_child", name: "c2"}));
		expect(w.state.outbox).toEqual([]);
		w.settle();
		expect(w.state.outbox).toEqual([{id: "q1", replyTo: "h/inbox", res: {ok: true}}]);
		w.feed({type: "replied", id: "q1"});
		w.feed(call(w.nextRev(), "q1", {op: "terminate_child", name: "c2"}));
		expect(w.state.outbox).toEqual([{id: "q1", replyTo: "h/inbox", res: {ok: true}}]);
		w.feed({type: "replied", id: "q1"});
		w.feed(call(w.nextRev(), "q2", {op: "which_children"}));
		const which = w.state.outbox[0]?.res;
		expect(
			which !== undefined && "children" in which ? which.children.map((c) => c.run) : [],
		).toEqual(["up", "stopped", "up", "up"]);
		w.feed({type: "replied", id: "q2"});
		// A stopped child is not started again by its own strategy...
		w.exit("c1", "crash");
		w.settle();
		expect(w.state.children.find((c) => c.name === "c2")?.run.is).toBe("stopped");
		// ...until restart_child.
		w.feed(call(w.nextRev(), "q3", {op: "restart_child", name: "c2"}));
		w.settle();
		const res: Answer | undefined = w.state.outbox.find((o) => o.id === "q3")?.res;
		expect(res).toEqual({ok: true, incarnation: 2});
		w.feed(call(w.nextRev(), "q4", {op: "start_child", spec: {name: "c9", restart: "temporary"}}));
		w.settle();
		expect(w.state.outbox.find((o) => o.id === "q4")?.res).toEqual({ok: true, incarnation: 1});
		w.feed(call(w.nextRev(), "q5", {op: "start_child", spec: {name: "c9", restart: "temporary"}}));
		expect(w.state.outbox.find((o) => o.id === "q5")?.res).toEqual({
			ok: false,
			error: "already_started",
		});
		w.feed(call(w.nextRev(), "q6", {op: "delete_child", name: "c1"}));
		expect(w.state.outbox.find((o) => o.id === "q6")?.res).toEqual({ok: false, error: "running"});
	});
});

// ---------------------------------------------------------------- on the in-memory ledger

const sleep = (ms: number) => Effect.sleep(Duration.millis(ms));
const until = (done: Effect.Effect<boolean, unknown, Ledger>, ms = 15_000) =>
	Effect.gen(function* () {
		const t0 = Date.now();
		while (!(yield* done) && Date.now() - t0 < ms) yield* sleep(20);
	});
const decodeExit = Schema.decodeUnknownExit(ExitMessage);
const Body = Schema.Struct({crashAfter: Schema.optional(Schema.Boolean)});
const decodeBody = Schema.decodeUnknownExit(Body);

const Count = Schema.Struct({count: Schema.Number, cursor: Schema.Number});
type Inc = {readonly type: "inc"; readonly rev: number; readonly poison: boolean};
/** A counter whose pure reducer throws on a `poison` message: the planted bug. */
const counter = defineMachine({
	types: {model: {} as typeof Count.Type, msg: {} as Inc, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0, cursor: 0}, []],
	update: {
		inc: (s, m) => {
			if (m.rev <= s.cursor) return [s, []];
			if (m.poison) throw new Error("poison");
			return [{count: s.count + 1, cursor: m.rev}, []];
		},
	},
});

/** Which names boot-crash right now: the planted bug that a flag "fixes". */
const bootCrash = new Set<string>();

/**
 * A worker. `trap`: `no` (the ledger takes it down), `graceful` (it ends on its parent's
 * shutdown), `ignore` (it traps the shutdown and never ends: only a kill stops it).
 */
const worker = (trap: "no" | "graceful" | "ignore") =>
	defineProgram({
		name: `worker-${trap}`,
		description:
			"Counts its inbox; crashes after crashAfter; ends or not on its parent's shutdown.",
		inputs: {inbox: input(envelope(Schema.Unknown), "One message.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				if (bootCrash.has(self.name)) return yield* Effect.die("planted boot crash");
				if (trap !== "no") yield* self.trapExit(true);
				const handle = yield* self.run(
					counter,
					{schema: Count, cursor: (s) => s.cursor},
					{ctx: undefined},
				);
				const machine = yield* handle.ready;
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) => {
						const count = machine.dispatch({type: "inc", rev: e.rev, poison: false});
						if (e.kind === "EXIT" && e.from === "ledger") {
							const x = decodeExit(e.body);
							if (Exit.isSuccess(x) && x.value.to === self.incarnation && trap === "graceful")
								return count.pipe(Effect.andThen(self.exit("shutdown", "asked to")), Effect.asVoid);
							return count;
						}
						const b = decodeBody(e.body);
						return Exit.isSuccess(b) && b.value.crashAfter === true
							? count.pipe(Effect.andThen(Effect.die("planted crash")))
							: count;
					}),
				);
			}).pipe(Effect.scoped),
	});

const exitedOrRestarted = (rows: readonly Row[], names: readonly string[]) =>
	rows
		.filter((r) => names.includes(r.stream) && (r.kind === "exited" || r.kind === "restarted"))
		.map((r) => `${r.kind} ${r.stream}`);

const TREE = {
	top: {
		strategy: "one_for_one",
		intensity: 3,
		periodMs: 10_000,
		children: [
			{name: "sup:all", restart: "permanent", type: "supervisor"},
			{name: "sup:rest", restart: "permanent", type: "supervisor"},
		],
	},
	all: {
		strategy: "one_for_all",
		intensity: 3,
		periodMs: 10_000,
		children: [
			{name: "a:1", restart: "permanent"},
			{name: "a:2", restart: "permanent", shutdown: 300},
			{name: "a:3", restart: "permanent", shutdown: "brutal_kill"},
		],
	},
	rest: {
		strategy: "rest_for_one",
		intensity: 3,
		periodMs: 10_000,
		backoff: {minMs: 50, maxMs: 400, resetAfterMs: 2000},
		children: [
			{name: "r:1", restart: "permanent"},
			{name: "r:2", restart: "permanent"},
			{name: "r:3", restart: "permanent", shutdown: 200},
		],
	},
} satisfies Record<string, SupervisorSpec>;

const TRAPS: Record<string, "no" | "graceful" | "ignore"> = {
	"a:1": "no",
	"a:2": "graceful",
	"a:3": "ignore",
	"r:1": "no",
	"r:2": "no",
	"r:3": "ignore",
};

const tree = Effect.gen(function* () {
	const ledger = yield* Ledger;
	yield* ledger.register("top", "test");
	yield* ledger.register("harness:1", "test");
	for (const [name, spec] of [
		["top", TREE.top],
		["sup:all", TREE.all],
		["sup:rest", TREE.rest],
	] as const) {
		const sup = supervisor(name, spec);
		if (!sup.ok) return yield* Effect.die(sup.why);
		yield* serve({name, holder: `h-${name}`, program: sup.program});
	}
	for (const [name, trap] of Object.entries(TRAPS))
		yield* serve({name, holder: `h-${name}`, program: worker(trap), ttlMs: 1000});
	yield* until(
		Effect.map(
			Effect.forEach(Object.keys(TRAPS), (n) => ledger.lease(n), {concurrency: "unbounded"}),
			(ls) => ls.every((l) => l !== null),
		),
	);
});

const upAt = (name: string) =>
	Effect.gen(function* () {
		const p = yield* (yield* Ledger).processInfo(name);
		return p === null || p.down !== 0 ? 0 : p.incarnation;
	});
const replyTo = (id: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const rows = yield* ledger.readStream(streams("harness:1").inbox);
		for (const r of rows) {
			const x = Schema.decodeUnknownExit(Schema.fromJsonString(Reply))(r.data);
			if (Exit.isSuccess(x) && x.value.id === id) return x.value.res;
		}
		return null;
	});
/** One call; `tries` names the send, so a resend is a new message with the same call id. */
const ask = (to: string, id: string, req: unknown, tries = 1) =>
	Effect.gen(function* () {
		yield* cast(to, `${id}#${tries}`, {id, replyTo: "harness:1/inbox", req}, "harness");
		let res: Answer | null = null;
		yield* until(
			Effect.map(replyTo(id), (r) => {
				res = r;
				return r !== null;
			}),
		);
		return res as Answer | null;
	});

describe("a two-level tree on the in-memory ledger", () => {
	it("one_for_all and rest_for_one restart exactly the right siblings, in order", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree;
				const from = (yield* ledger.read(0, 1_000_000)).at(-1)?.pos ?? 0;
				yield* cast("a:2", "boom-a", {crashAfter: true}, "test");
				yield* until(Effect.map(upAt("a:3"), (n) => n === 2));
				yield* until(Effect.map(upAt("a:2"), (n) => n === 2));
				const allRows = yield* ledger.read(from, 1_000_000);
				const mid = allRows.at(-1)?.pos ?? from;
				yield* cast("r:2", "boom-r", {crashAfter: true}, "test");
				yield* until(Effect.map(upAt("r:3"), (n) => n === 2));
				yield* sleep(300);
				const restRows = yield* ledger.read(mid, 1_000_000);
				return {
					all: exitedOrRestarted(allRows, ["a:1", "a:2", "a:3"]),
					rest: exitedOrRestarted(restRows, ["r:1", "r:2", "r:3"]),
					a3: (yield* ledger.readStream("a:3")).filter((r) => r.kind === "exited"),
					r1: yield* upAt("r:1"),
					top: (yield* savedState("top", SupervisorState)).state?.restarted,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(out.all).toEqual([
			"exited a:2",
			"exited a:3",
			"exited a:1",
			"restarted a:1",
			"restarted a:2",
			"restarted a:3",
		]);
		// a:3 traps and ignores the shutdown, but its shutdown is brutal_kill: killed at once.
		expect(out.a3[0]?.data).toContain("killed");
		expect(out.rest).toEqual(["exited r:2", "exited r:3", "restarted r:2", "restarted r:3"]);
		expect(out.r1).toBe(1);
		expect(out.top).toBe(0);
	}, 30_000);

	it("calls: which_children, terminate_child past a shutdown timeout, restart_child", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree;
				const which = yield* ask("sup:rest", "w1", {op: "which_children"});
				const t0 = Date.now();
				const term = yield* ask("sup:rest", "t1", {op: "terminate_child", name: "r:3"});
				const tookMs = Date.now() - t0;
				const again = yield* ask("sup:rest", "t1", {op: "terminate_child", name: "r:3"}, 2);
				const restart = yield* ask("sup:rest", "s1", {op: "restart_child", name: "r:3"});
				const added = yield* ask("sup:all", "n1", {
					op: "start_child",
					spec: {name: "a:9", restart: "temporary"},
				});
				return {
					which,
					term,
					tookMs,
					again,
					restart,
					added,
					r3: (yield* ledger.readStream("r:3")).filter((r) => r.kind === "exited"),
					replies: (yield* ledger.readStream(streams("harness:1").inbox)).length,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(
			out.which !== null && "children" in out.which ? out.which.children.map((c) => c.name) : [],
		).toEqual(["r:1", "r:2", "r:3"]);
		expect(out.term).toEqual({ok: true});
		// r:3 ignores its shutdown: it is killed when its 200 ms run out.
		expect(out.tookMs).toBeGreaterThanOrEqual(200);
		expect(out.r3[0]?.data).toContain("killed");
		expect(out.again).toEqual({ok: true});
		expect(out.restart).toEqual({ok: true, incarnation: 2});
		expect(out.added).toEqual({ok: true, incarnation: 1});
		// Five sends, four call ids, four replies: the resent t1 got its first reply again (a dup).
		expect(out.replies).toBe(4);
	}, 30_000);

	it("a boot-crash loop backs off, its supervisor gives up, and the top restarts it once", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree;
				bootCrash.add("r:2");
				const t0 = Date.now();
				// r:2 crashes once now; every restart dies at boot until the flag is off.
				yield* cast("r:2", "boom", {crashAfter: true}, "test");
				yield* until(
					Effect.map(ledger.readStream("sup:rest"), (rows) =>
						rows.some((r) => r.kind === "restarted"),
					),
				);
				bootCrash.delete("r:2");
				yield* until(Effect.map(upAt("r:3"), (n) => n > 0));
				yield* until(Effect.map(upAt("sup:rest"), (n) => n === 2));
				yield* sleep(300);
				const exits = (yield* ledger.readStream("r:2"))
					.filter((r) => r.kind === "exited")
					.map((r) => r.at - t0);
				return {
					exits,
					top: (yield* savedState("top", SupervisorState)).state,
					supRest: (yield* ledger.readStream("sup:rest")).filter((r) => r.kind === "exited"),
					supAll: (yield* ledger.readStream("sup:all")).filter((r) => r.kind === "exited"),
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		// intensity 3: the first crash and three boot crashes are restarted, the next one gives up.
		expect(out.exits.length).toBeGreaterThanOrEqual(4);
		const gaps = out.exits.slice(1).map((t, i) => t - (out.exits[i] ?? 0));
		// Each wait at least the backoff: 50, 100, 200 ms.
		expect(gaps.slice(0, 3).every((g, i) => g >= 50 * 2 ** i - 5)).toBe(true);
		expect(out.supRest.length).toBe(1);
		expect(out.supRest[0]?.data).toContain("shutdown");
		expect(out.top?.restarted).toBe(1);
		expect(out.top?.phase).toBe("running");
		expect(out.supAll.length).toBe(0);
	}, 30_000);
});

describe("dead letters", () => {
	it("lists the message set aside, and sends it back once after the fix", async () => {
		const poisoned = new Set<string>(["on"]);
		const picky = defineProgram({
			name: "picky",
			description: "Counts its inbox; its reducer throws on a poison message while the bug is in.",
			inputs: {inbox: input(envelope(Schema.Unknown), "One message.")},
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
						Stream.runForEach((e) => {
							// The bug: a poison body crashes the reducer, while the flag says the bug is in.
							const poison =
								typeof e.body === "object" &&
								e.body !== null &&
								"poison" in e.body &&
								poisoned.has("on");
							return machine.dispatch({type: "inc", rev: e.rev, poison});
						}),
					);
				}).pipe(Effect.scoped),
		});
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register("sup:p", "test");
				const sup = supervisor("sup:p", {
					strategy: "one_for_one",
					intensity: 5,
					periodMs: 10_000,
					children: [{name: "p:1", restart: "permanent"}],
				});
				if (!sup.ok) return yield* Effect.die(sup.why);
				yield* serve({name: "sup:p", holder: "hs", program: sup.program});
				yield* serve({name: "p:1", holder: "hp", program: picky});
				yield* until(Effect.map(ledger.lease("p:1"), (l) => l !== null));
				yield* cast("p:1", "bad", {poison: true}, "test");
				yield* until(Effect.map(deadLetters("p:1"), (d) => d.length === 1));
				const listed = yield* deadLetters("p:1");
				poisoned.delete("on");
				const rev = listed[0]?.rev ?? -1;
				const first = yield* redrive("p:1", rev, "ops");
				const second = yield* redrive("p:1", rev, "ops");
				const notDead = yield* redrive("p:1", rev + 100, "ops");
				yield* sleep(300);
				return {
					listed,
					first,
					second,
					notDead,
					after: yield* deadLetters("p:1"),
					exits: (yield* ledger.readStream("p:1")).filter((r) => r.kind === "exited").length,
					count: (yield* savedState("p:1", Count)).state?.count,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(out.listed.length).toBe(1);
		expect(out.listed[0]?.message?.id).toBe("bad");
		expect(out.listed[0]?.redriven).toBe(false);
		expect(out.first.how).toBe("sent");
		expect(out.second).toEqual(
			out.first.how === "sent" ? {how: "sent", rev: out.first.rev, dup: true} : null,
		);
		expect(out.notDead).toEqual({how: "not_dead"});
		expect(out.after[0]?.redriven).toBe(true);
		// Three crashes on the poison, none on its resent copy, which is counted once.
		expect(out.exits).toBe(3);
		expect(out.count).toBe(1);
	}, 30_000);
});
