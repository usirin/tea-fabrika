import {replay} from "@demlik/tea";
import {run as runPromise} from "@demlik/tea/promise";
import {Effect, Exit, Schema, Scope, Stream} from "effect";
import {describe, expect, it, vi} from "vitest";
import {defineCmd} from "../schema.ts";
import {announced, handoff, log, type Outcome, operator, type PR, ship} from "./example.ts";
import {defineProgram, type MsgOf} from "./program.ts";
import {startEffect, startPromise} from "./run.ts";
import {input} from "./shape.ts";
import {connect, type ProgramRun, tell, type Word} from "./tell.ts";

// The user's job: three programs that know nothing of each other, wired by a
// host in plain code, ship five pull requests, round after round, on both of
// tea's engines. The host here is a few lines per engine: start each program,
// hand ship's `deliver` a handler that tells the operator, and connect the
// one-way outputs.

/** How the scripted world answers for one pull request. */
type Answer = {readonly enqueue: "queued" | "conflicts"; readonly queue: "landed" | "ejected"};
const SCRIPT: ReadonlyMap<string, Answer> = new Map([
	["#1", {enqueue: "queued", queue: "landed"}],
	["#2", {enqueue: "conflicts", queue: "landed"}],
	["#3", {enqueue: "queued", queue: "landed"}],
	["#4", {enqueue: "queued", queue: "ejected"}],
	["#5", {enqueue: "queued", queue: "landed"}],
]);
const answer = (pr: string): Answer => SCRIPT.get(pr) ?? {enqueue: "queued", queue: "landed"};
const PRS: readonly PR[] = [...SCRIPT.keys()].map((pr, i) => ({pr, head: `abc123${i}`}));
const EXPECTED: readonly Outcome[] = [
	{pr: "#1", kind: "done", why: "landed"},
	{pr: "#2", kind: "send", why: "conflicts"},
	{pr: "#3", kind: "done", why: "landed"},
	{pr: "#4", kind: "send", why: "ejected"},
	{pr: "#5", kind: "done", why: "landed"},
];

interface World {
	readonly operator: ProgramRun<typeof operator>;
	readonly ship: ProgramRun<typeof ship>;
	readonly logs: readonly ProgramRun<typeof log>[];
	/** Every Msg ship folded, in order. */
	readonly shipLog: readonly MsgOf<typeof ship>[];
	/** Let a held merge queue answer. */
	readonly release: () => void;
	readonly close: () => Promise<void>;
}

type QueueMsg = {
	readonly type: "ship_queue";
	readonly pr: string;
	readonly head: string;
	readonly reading: "landed" | "ejected";
};
/** The scripted merge queue. It answers a millisecond later, or, when held, once released. */
function mergeQueue(hold: boolean) {
	const waiting = new Set<() => void>();
	return {
		wait(at: PR, answerWith: (msg: QueueMsg) => void): () => void {
			const msg: QueueMsg = {type: "ship_queue", ...at, reading: answer(at.pr).queue};
			if (!hold) {
				const timer = setTimeout(() => answerWith(msg), 1);
				return () => clearTimeout(timer);
			}
			const fire = () => answerWith(msg);
			waiting.add(fire);
			return () => waiting.delete(fire);
		},
		release() {
			for (const fire of [...waiting]) fire();
			waiting.clear();
		},
	};
}

/** The host's wiring, the same on both engines: plain code, no registry. */
function wire(
	op: ProgramRun<typeof operator>,
	sh: ProgramRun<typeof ship>,
	logs: readonly ProgramRun<typeof log>[],
) {
	const handed = connect(op, handoff, sh, "hand");
	expect(handed).toMatchObject({wired: true, fit: "fits"});
	for (const l of logs) expect(connect(sh, announced, l, "heard")).toMatchObject({wired: true});
	const shipLog: MsgOf<typeof ship>[] = [];
	sh.observe((msg) => shipLog.push(msg));
	return shipLog;
}

interface Engine {
	readonly name: "promise" | "effect";
	readonly world: (logs: number, hold?: boolean) => Promise<World>;
}

const promiseEngine: Engine = {
	name: "promise",
	async world(logs, hold = false) {
		const queue = mergeQueue(hold);
		const op = await startPromise(operator, {interpret: {}, subscribe: {}});
		const sh = await startPromise(ship, {
			interpret: {
				ship_enqueue: async (cmd, {ok}) => ok(answer(cmd.pr).enqueue),
				// Must arrive: the handler answers what `tell` said. It does not wait for the operator to fold it.
				ship_deliver: async (cmd, {ok, err}) => {
					const word = tell(op, "outcome", cmd.outcome);
					return word === "queued" ? ok(word) : err({_tag: word});
				},
			},
			subscribe: {
				ship_queue: (sub, _ctx, dispatch) => queue.wait(sub.deps, dispatch),
			},
		});
		const ls = await Promise.all(
			Array.from({length: logs}, () => startPromise(log, {interpret: {}, subscribe: {}})),
		);
		const shipLog = wire(op, sh, ls);
		return {
			operator: op,
			ship: sh,
			logs: ls,
			shipLog,
			release: queue.release,
			close: async () => {
				await Promise.all([op.stop(), sh.stop(), ...ls.map((l) => l.stop())]);
			},
		};
	},
};

const effectEngine: Engine = {
	name: "effect",
	async world(logs, hold = false) {
		const queue = mergeQueue(hold);
		const scope = Effect.runSync(Scope.make());
		const inScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
			Effect.runPromise(Scope.provide(scope)(effect));
		const op = await inScope(startEffect(operator, {interpret: {}, subscribe: {}}));
		const sh = await inScope(
			startEffect(ship, {
				interpret: {
					ship_enqueue: (cmd) => Effect.succeed(answer(cmd.pr).enqueue),
					ship_deliver: (cmd) =>
						Effect.suspend(() => {
							const word = tell(op, "outcome", cmd.outcome);
							return word === "queued" ? Effect.succeed(word) : Effect.fail({_tag: word});
						}),
				},
				subscribe: {
					ship_queue: (sub) =>
						Stream.fromEffect(
							Effect.callback<QueueMsg>((resume) => {
								const cancel = queue.wait(sub.deps, (msg) => resume(Effect.succeed(msg)));
								return Effect.sync(cancel);
							}),
						),
				},
			}),
		);
		const ls: ProgramRun<typeof log>[] = [];
		for (let i = 0; i < logs; i++)
			ls.push(await inScope(startEffect(log, {interpret: {}, subscribe: {}})));
		const shipLog = wire(op, sh, ls);
		return {
			operator: op,
			ship: sh,
			logs: ls,
			shipLog,
			release: queue.release,
			close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
		};
	},
};

const ENGINES = [promiseEngine, effectEngine] as const;
const outcomesOf = (op: ProgramRun<typeof operator>) => {
	const s = op.state();
	return s.type === "idle" ? [] : s.outcomes;
};
const done = (w: World) =>
	vi.waitFor(() => expect(w.operator.state().type).toBe("done"), {timeout: 2_000});

describe.each(ENGINES)("three programs on the $name engine", (engine) => {
	it("ships five pull requests, three rounds running: every outcome reaches the operator and both logs", async () => {
		for (let round = 0; round < 3; round++) {
			const w = await engine.world(2);
			expect(tell(w.operator, "work", PRS)).toBe("queued");
			await done(w);
			expect(outcomesOf(w.operator)).toEqual(EXPECTED);
			await vi.waitFor(() => expect(w.ship.state().delivered).toHaveLength(5));
			expect(w.ship.state().delivered.map((d) => d.word)).toEqual(Array(5).fill("queued"));
			for (const l of w.logs) await vi.waitFor(() => expect(l.state().lines).toEqual(EXPECTED));
			expect(w.ship.late).toEqual([]);
			expect(w.operator.late).toEqual([]);
			await w.close();
		}
	});

	it("with no log at all, every outcome still reaches the operator", async () => {
		const w = await engine.world(0);
		tell(w.operator, "work", PRS);
		await done(w);
		expect(outcomesOf(w.operator)).toEqual(EXPECTED);
		await w.close();
	});

	it("a receiver stopped before delivery: ship's deliver comes back `stopped`, the logs still hear it", async () => {
		const w = await engine.world(1, true);
		tell(w.operator, "work", PRS);
		await vi.waitFor(() => expect(w.ship.state().type).toBe("queued"));
		await w.operator.stop();
		w.release();
		await vi.waitFor(() => expect(w.ship.state().delivered).toEqual([{pr: "#1", word: "stopped"}]));
		await vi.waitFor(() => expect(w.logs[0]?.state().lines).toEqual([EXPECTED[0]]));
		expect(tell(w.operator, "work", PRS)).toBe("stopped");
		await w.close();
	});

	it("bad_shape: a payload that fails the input's shape never reaches the run", async () => {
		const w = await engine.world(0);
		const folded: unknown[] = [];
		w.ship.observe((m) => folded.push(m));
		expect(tell(w.ship, "hand", {pr: "seven", head: "abc1234"})).toBe("bad_shape");
		expect(tell(w.ship, "hand", {pr: "#7", head: "ABC"})).toBe("bad_shape");
		await w.ship.idle();
		expect(folded).toEqual([]);
		expect(w.ship.state().type).toBe("idle");
		await w.close();
	});

	it("no_cell: a state with no cell for the input says so, and nothing is queued", async () => {
		const w = await engine.world(0, true);
		expect(tell(w.operator, "outcome", {pr: "#1", kind: "done", why: "landed"})).toBe("no_cell");
		tell(w.operator, "work", [PRS[0] ?? {pr: "#1", head: "abc1230"}]);
		await vi.waitFor(() => expect(w.ship.state().type).toBe("queued"));
		expect(tell(w.ship, "hand", {pr: "#9", head: "abc1239"})).toBe("no_cell");
		w.release();
		await done(w);
		expect(tell(w.operator, "work", PRS)).toBe("no_cell");
		expect(w.operator.late).toEqual([]);
		await w.close();
	});

	it("answers at once: `queued` is said before the receiver has folded the Msg, and order is kept", async () => {
		const w = await engine.world(1);
		const l = w.logs[0];
		if (l === undefined) throw new Error("no log");
		const words: Word[] = EXPECTED.map((o) => tell(l, "heard", o));
		expect(words).toEqual(Array(5).fill("queued"));
		expect(l.state().lines).toEqual([]);
		await vi.waitFor(() => expect(l.state().lines).toEqual(EXPECTED));
		await w.close();
	});

	it("`queued` means on the line: a Msg told just before stop() is folded, not lost", async () => {
		const w = await engine.world(1);
		const l = w.logs[0];
		if (l === undefined) throw new Error("no log");
		expect(tell(l, "heard", EXPECTED[0] ?? {pr: "#1", kind: "done", why: "landed"})).toBe("queued");
		await l.stop();
		expect(l.state().lines).toHaveLength(1);
		expect(l.late).toEqual([]);
		await w.close();
	});

	it("replay: the ship's log folds to the same state, and replay checks no shape", async () => {
		const w = await engine.world(0);
		tell(w.operator, "work", PRS);
		await done(w);
		await vi.waitFor(() => expect(w.ship.state().delivered).toHaveLength(5));
		const msgs = w.shipLog;
		expect(replay(ship.machine, {msgs, ctx: undefined}).state).toEqual(w.ship.state());
		// A log written before a shape was tightened: replay folds it as it is.
		const old = msgs.map((m) =>
			m.type === "hand" ? {...m, payload: {...m.payload, head: "not-a-sha"}} : m,
		);
		const folded = replay(ship.machine, {msgs: old, ctx: undefined}).state;
		expect(folded.type).toBe("over");
		await w.close();
	});
});

// ---- two programs telling each other from inside Cmd handlers --------------

// The #639 shape: A's Cmd handler tells B while B's Cmd handler tells A, both
// in flight at once. A `tell` that waited for the fold would lock both up.

const ring = defineCmd("ring", {
	input: Schema.Struct({to: Schema.String}),
	ok: Schema.Literals(["queued", "stopped", "bad_shape", "no_cell"]),
	err: [],
});
type Pinger = {
	readonly type: "ready";
	readonly heard: readonly string[];
	readonly told: readonly string[];
};
const pinger = defineProgram({
	name: "pinger",
	description: "Rings another pinger when kicked, and keeps who rang it.",
	inputs: {
		kick: input(Schema.Struct({to: Schema.String}), "Ring this one."),
		poke: input(Schema.Struct({from: Schema.String}), "Someone rang."),
	},
	outputs: [],
	types: {model: {} as Pinger, msg: {} as never},
	cmds: [ring],
	init: (loaded) => [loaded ?? {type: "ready", heard: [], told: []}, []],
	update: {
		ready: {
			kick: (s, m) => [s, [ring({to: m.payload.to})]],
			poke: (s, m) => [{...s, heard: [...s.heard, m.payload.from]}, []],
			ring_ok: (s, m) => [{...s, told: [...s.told, m.value]}, []],
		},
	},
});

/** Two latches: each handler waits until both are in flight, so the tells cross. */
function crossing() {
	let arrived = 0;
	let open: () => void = () => undefined;
	const both = new Promise<void>((resolve) => {
		open = resolve;
	});
	return {
		arrive: () => {
			arrived += 1;
			if (arrived === 2) open();
			return both;
		},
	};
}

describe("two programs telling each other from inside Cmd handlers", () => {
	it("promise engine: both tells land, nothing locks up", async () => {
		const gate = crossing();
		const runs = new Map<string, ProgramRun<typeof pinger>>();
		const start = (me: string) =>
			startPromise(pinger, {
				interpret: {
					ring: async (cmd, {ok}) => {
						await gate.arrive();
						const other = runs.get(cmd.to);
						return ok(other === undefined ? "stopped" : tell(other, "poke", {from: me}));
					},
				},
				subscribe: {},
			});
		const a = await start("a");
		const b = await start("b");
		runs.set("a", a).set("b", b);
		tell(a, "kick", {to: "b"});
		tell(b, "kick", {to: "a"});
		await vi.waitFor(() => {
			expect(a.state()).toEqual({type: "ready", heard: ["b"], told: ["queued"]});
			expect(b.state()).toEqual({type: "ready", heard: ["a"], told: ["queued"]});
		});
		await Promise.all([a.stop(), b.stop()]);
	});

	it("effect engine: both tells land, nothing locks up", async () => {
		const gate = crossing();
		const runs = new Map<string, ProgramRun<typeof pinger>>();
		const scope = Effect.runSync(Scope.make());
		const start = (me: string) =>
			Effect.runPromise(
				Scope.provide(scope)(
					startEffect(pinger, {
						interpret: {
							ring: (cmd) =>
								Effect.tryPromise({try: () => gate.arrive(), catch: () => "never"}).pipe(
									Effect.orDie,
									Effect.map(() => {
										const other = runs.get(cmd.to);
										return other === undefined ? "stopped" : tell(other, "poke", {from: me});
									}),
								),
						},
						subscribe: {},
					}),
				),
			);
		const a = await start("a");
		const b = await start("b");
		runs.set("a", a).set("b", b);
		tell(a, "kick", {to: "b"});
		tell(b, "kick", {to: "a"});
		await vi.waitFor(() => {
			expect(a.state()).toEqual({type: "ready", heard: ["b"], told: ["queued"]});
			expect(b.state()).toEqual({type: "ready", heard: ["a"], told: ["queued"]});
		});
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});

	it("the control: the same crossing with a dispatch that waits for the fold locks both runs up", async () => {
		const gate = crossing();
		const runs = new Map<
			string,
			{dispatch: (m: {type: "poke"; payload: {from: string}}) => Promise<void>}
		>();
		const start = (me: string) =>
			runPromise(pinger.machine, {
				ctx: undefined,
				interpret: {
					ring: async (cmd, {ok}) => {
						await gate.arrive();
						await runs.get(cmd.to)?.dispatch({type: "poke", payload: {from: me}});
						return ok("queued");
					},
				},
			}).ready;
		const a = await start("a");
		const b = await start("b");
		runs.set("a", a).set("b", b);
		const both = Promise.all([
			a.dispatch({type: "kick", payload: {to: "b"}}),
			b.dispatch({type: "kick", payload: {to: "a"}}),
		]).then(() => "finished");
		const late = new Promise((resolve) => setTimeout(() => resolve("locked"), 300));
		expect(await Promise.race([both, late])).toBe("locked");
		// Neither run can be stopped now: stop() waits for the line, which never empties.
	});
});

// ---- what `tell` cannot see without a core change ---------------------------

describe.each(ENGINES)("known gaps on the $name engine", (engine) => {
	it("no_cell is judged on the state now: a Msg ahead on the line can make `queued` wrong", async () => {
		const w = await engine.world(0);
		await w.ship.stop();
		// One pull request: the first outcome ends the work, the second has no cell by the time it is folded.
		tell(w.operator, "work", [PRS[0] ?? {pr: "#1", head: "abc1230"}]);
		await w.operator.idle();
		const first = tell(w.operator, "outcome", {pr: "#1", kind: "done", why: "landed"});
		const second = tell(w.operator, "outcome", {pr: "#1", kind: "done", why: "landed"});
		expect([first, second]).toEqual(["queued", "queued"]);
		await vi.waitFor(() => expect(w.operator.late).toEqual([{msg: "outcome", why: "no_cell"}]));
		await w.close();
	});
});

// A run tea halts by itself (a reducer that throws) is stopped, and this layer
// cannot see it: tea has no way to ask a run whether it is open.
const fragile = defineProgram({
	name: "fragile",
	description: "Throws on a negative number, to halt its run.",
	inputs: {n: input(Schema.Number, "A number. A negative one breaks the run.")},
	outputs: [],
	types: {model: {} as {readonly type: "up"; readonly sum: number}, msg: {} as never},
	cmds: [],
	init: (loaded) => [loaded ?? {type: "up", sum: 0}, []],
	update: {
		up: {
			n: (s, m) => {
				if (m.payload < 0) throw new Error("negative");
				return [{type: "up", sum: s.sum + m.payload}, []];
			},
		},
	},
});

describe("known gap: a run tea halted by itself", () => {
	const onError = () => undefined;
	it("promise engine: tell still answers queued, and the refusal comes late and unnamed", async () => {
		const run = await startPromise(fragile, {interpret: {}, subscribe: {}, onError});
		expect(tell(run, "n", -1)).toBe("queued");
		await vi.waitFor(() => expect(run.late).toHaveLength(1));
		expect(tell(run, "n", 1)).toBe("queued");
		await vi.waitFor(() => expect(run.late).toHaveLength(2));
		expect(run.late[1]).toEqual({msg: "n", why: "refused"});
		expect(run.state().sum).toBe(0);
	});

	it("effect engine: tell still answers queued, and the refusal comes late as `stopped`", async () => {
		const scope = Effect.runSync(Scope.make());
		const run = await Effect.runPromise(
			Scope.provide(scope)(startEffect(fragile, {interpret: {}, subscribe: {}, onError})),
		);
		expect(tell(run, "n", -1)).toBe("queued");
		await vi.waitFor(() => expect(run.late).toHaveLength(1));
		expect(tell(run, "n", 1)).toBe("queued");
		await vi.waitFor(() => expect(run.late).toHaveLength(2));
		expect(run.late[1]).toEqual({msg: "n", why: "stopped"});
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
});
