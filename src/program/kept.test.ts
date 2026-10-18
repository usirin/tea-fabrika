import {defineMachine, type Sub} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {Cause, Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {act, intentOf, listen} from "../primitives.ts";
import {call, defineProgram, type Keep} from "./program.ts";
import {type Key, memoryStorage, type Storage} from "./storage.ts";

// `keep.run` (./kept.ts) against the restart race of experiment 69, on a toy
// with the build machine's shape: a Listen that works, then one Act that
// writes. A kept run stopped while it worked is started again with `resume`,
// which starts the work again under a new run number.
//
// Booted bare, tea opens the kept state's Listen at once. A Listen that
// answers before the starter's `resume` moves the machine on to its write,
// and `resume` then sends that write a second time. `keep.run` reads the kept
// state first, folds `resume` first, and opens the Listens only after.

const write = act("job_write", {
	input: Schema.Struct({n: Schema.Finite}),
	ok: Schema.String,
	err: ["unknown"] as const,
});
type WriteCmd = ReturnType<typeof write>;

type Job =
	| {readonly phase: "idle"}
	| {readonly phase: "working"; readonly run: number}
	| {readonly phase: "writing"; readonly asked: WriteCmd}
	| {readonly phase: "over"};
type JobMsg =
	| {readonly type: "start"}
	| {readonly type: "resume"}
	| {readonly type: "job_done"; readonly run: number};
type WorkSub = Sub<"job_work", {readonly run: number}>;
type Step = readonly [Job, readonly WriteCmd[]];

const work = listen("job_work", (s: Job) => (s.phase === "working" ? {run: s.run} : null));

const job = defineMachine({
	types: {model: {} as Job, msg: {} as JobMsg, sub: {} as WorkSub, ctx: undefined},
	cmds: [write],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s): Step => (s.phase === "idle" ? [{phase: "working", run: 1}, []] : [s, []]),
		// The work that was on is gone with the process: start it again, as run n + 1. A write in flight goes again.
		resume: (s): Step => {
			if (s.phase === "working") return [{phase: "working", run: s.run + 1}, []];
			if (s.phase === "writing") return [s, [s.asked]];
			return [s, []];
		},
		job_done: (s, m): Step => {
			if (s.phase !== "working" || m.run !== s.run) return [s, []];
			const asked = write({n: m.run, intent: intentOf("write", m.run)});
			return [{phase: "writing", asked}, [asked]];
		},
		job_write_ok: (s): Step => (s.phase === "writing" ? [{phase: "over"}, []] : [s, []]),
		job_write_err: (s): Step => (s.phase === "writing" ? [{phase: "over"}, []] : [s, []]),
	},
	subs: [work],
});

const isOver = (s: Job) => s.phase === "over";
const KEY: Key<Job> = {id: "j", until: "forgotten"};

/** What one life of the toy did: each write sent, each run of the work started. */
const world = () => {
	const writes: number[] = [];
	const started: number[] = [];
	return {
		writes,
		started,
		interpret: {
			job_write: (cmd: WriteCmd) =>
				Effect.sync(() => writes.push(cmd.n)).pipe(
					Effect.andThen(Effect.sleep("20 millis")),
					Effect.as("written"),
				),
		},
		subscribe: {
			// Answers at once: the fast Listen of the race.
			job_work: (sub: WorkSub): Stream.Stream<JobMsg> =>
				Stream.fromEffect(
					Effect.sync(() => {
						started.push(sub.deps.run);
						return {type: "job_done", run: sub.deps.run} as const;
					}),
				),
		},
	};
};

/** A storage with the toy kept as an earlier process left it: stopped while it worked, on run 1. */
const stoppedWorking = async (): Promise<Storage> => {
	const storage = memoryStorage();
	const handle = await Effect.runPromise(storage.open("job:r1", {}));
	await handle.store("job", KEY).save({phase: "working", run: 1});
	return storage;
};

const jobProgram = (w: ReturnType<typeof world>) =>
	defineProgram({
		name: "job",
		description: "Runs the toy job to its end, from where it was kept.",
		inputs: {},
		outputs: {},
		machines: {job},
		status: {job: (s) => s.phase},
		left: {job: {by: "main"}},
		main: ({keep}) =>
			Effect.gen(function* () {
				const runtime = yield* keep.run(
					"job",
					KEY,
					{ctx: undefined, interpret: w.interpret, subscribe: w.subscribe, terminal: isOver},
					(kept) => (kept === null || kept.phase === "idle" ? {type: "start"} : {type: "resume"}),
					{name: "job", steps: {job_write: "write", job_work: "work"}},
				);
				yield* runtime.done();
			}).pipe(Effect.scoped),
	});

describe("keep.run: a kept run starts from its kept state, before anything else reaches it", () => {
	it("bare, the way 69 found it: the Listen tea reopens at boot moves the machine on, and resume writes twice", async () => {
		const storage = await stoppedWorking();
		const w = world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const handle = yield* storage.open("job:r1", null);
				const runtime = yield* (yield* run(job, {
					ctx: undefined,
					interpret: w.interpret,
					subscribe: w.subscribe,
					store: handle.store("job", KEY),
					terminal: isOver,
				})).ready;
				// The starter's resume lands after the boot, as the build and operate starters sent it before 69
				// and review and ship still did. The fast Listen has answered by then, and its write is out.
				while (runtime.getState().phase !== "writing") yield* Effect.sleep("1 millis");
				yield* runtime.dispatch({type: "resume"});
				yield* runtime.done();
			}).pipe(Effect.scoped),
		);
		expect(w.started).toEqual([1]);
		expect(w.writes).toEqual([1, 1]);
	});

	it("through keep.run: resume is folded first, the work starts once as run 2, and the write goes once", async () => {
		const storage = await stoppedWorking();
		const w = world();
		const called = await Effect.runPromise(
			call(jobProgram(w), {}, {keeping: {id: "job:r1", storage}}),
		);
		expect(called.kind === "called" && called.ended.kind).toBe("ended");
		// Run 1's Listen, the one a restart replaces, never started.
		expect(w.started).toEqual([2]);
		expect(w.writes).toEqual([2]);
	});

	it("through keep.run, from nothing kept: start goes first, and the run is the same as a first start", async () => {
		const w = world();
		const called = await Effect.runPromise(
			call(jobProgram(w), {}, {keeping: {id: "job:r2", storage: memoryStorage()}}),
		);
		expect(called.kind === "called" && called.ended.kind).toBe("ended");
		expect(w.started).toEqual([1]);
		expect(w.writes).toEqual([1]);
	});

	it("three restarts in a row, each stopped as it worked: each life starts the work once, and only the last writes", async () => {
		const storage = await stoppedWorking();
		const lives = [world(), world(), world()];
		for (const w of lives.slice(0, 2)) {
			// A life stopped as soon as its work started: before it answered, as a kill leaves it.
			const stopped = await Effect.runPromise(
				call(
					jobProgram({...w, subscribe: {job_work: (sub) => stall(w, sub)}}),
					{},
					{keeping: {id: "job:r1", storage}, stopOn: Effect.sleep("20 millis")},
				),
			);
			expect(stopped.kind === "called" && stopped.ended.kind).toBe("stopped");
		}
		const last = lives[2];
		if (last === undefined) throw new Error("no last life");
		await Effect.runPromise(call(jobProgram(last), {}, {keeping: {id: "job:r1", storage}}));
		expect(lives.map((w) => w.started)).toEqual([[2], [3], [4]]);
		expect(lives.map((w) => w.writes)).toEqual([[], [], [4]]);
	});

	it("cannot be gone around: a program has no store to hand a machine, and keep.run takes no store and needs what goes first", () => {
		const w = world();
		const options = {ctx: undefined, interpret: w.interpret, subscribe: w.subscribe};
		const never = defineProgram({
			name: "never",
			description: "Never started: what does not compile is the test.",
			inputs: {},
			outputs: {},
			machines: {job},
			status: {job: (s) => s.phase},
			left: {job: {by: "main"}},
			main: ({keep}) =>
				Effect.gen(function* () {
					const handle = yield* memoryStorage().open("never:r1", {});
					// @ts-expect-error there is no `keep.store`: a machine is only ever run kept through `keep.run`
					keep.store("job", KEY);
					// @ts-expect-error `keep.run` is never called without saying what goes first
					yield* keep.run("job", KEY, options);
					// @ts-expect-error nor handed a store of the caller's own, which would skip the read
					yield* keep.run("job", KEY, {...options, store: handle.store("job", KEY)}, () => null);
				}).pipe(Effect.scoped),
		});
		expect(never.name).toBe("never");
	});
});

/** A storage with the toy kept under `KEY` in `state`, as an earlier start left it. */
const keptIn = async (state: Job): Promise<Storage> => {
	const storage = memoryStorage();
	const handle = await Effect.runPromise(storage.open("job:r1", {}));
	await handle.store("job", KEY).save(state);
	return storage;
};

/** The toy run to its end through `keep.run`, each first Msg asked for noted in `asked`. */
const toTheEnd = (w: ReturnType<typeof world>, keep: Keep<{job: typeof job}>, asked: string[]) =>
	Effect.gen(function* () {
		const runtime = yield* keep.run(
			"job",
			KEY,
			{ctx: undefined, interpret: w.interpret, subscribe: w.subscribe, terminal: isOver},
			(kept) => {
				asked.push(kept?.phase ?? "nothing");
				return kept === null || kept.phase === "idle" ? {type: "start"} : {type: "resume"};
			},
			{name: "job", steps: {job_write: "write", job_work: "work"}},
		);
		return yield* runtime.done();
	}).pipe(Effect.scoped);

describe("left: what an earlier start left is found first, by the program, every start", () => {
	it("a kept run left working goes to its `left` step before main begins, and is taken to its end there", async () => {
		const storage = await stoppedWorking();
		const w = world();
		const order: string[] = [];
		const asked: string[] = [];
		const program = defineProgram({
			name: "job",
			description: "Carries on the toy job it left, then runs main.",
			inputs: {},
			outputs: {},
			machines: {job},
			status: {job: (s) => s.phase},
			left: {
				job: (run, {keep}) =>
					Effect.sync(() => order.push(`left ${run.id} ${run.state.phase}`)).pipe(
						Effect.andThen(toTheEnd(w, keep, asked)),
						Effect.asVoid,
						// The program's failure is main's, and main fails with nothing.
						Effect.orDie,
					),
			},
			main: () => Effect.sync(() => order.push("main")),
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		expect(called.kind === "called" && called.ended.kind).toBe("ended");
		expect(order).toEqual(["left j working", "main"]);
		expect(asked).toEqual(["working"]);
		expect(w.writes).toEqual([2]);
	});

	it("a run kept already over is never sent a first Msg: nothing in it runs again, and done answers the kept state", async () => {
		const storage = await keptIn({phase: "over"});
		const w = world();
		const asked: string[] = [];
		const ends: Job[] = [];
		const program = defineProgram({
			name: "job",
			description: "Runs the toy job it finds over.",
			inputs: {},
			outputs: {},
			machines: {job},
			status: {job: (s) => s.phase},
			left: {job: {by: "main"}},
			main: ({keep}) =>
				toTheEnd(w, keep, asked).pipe(Effect.flatMap((end) => Effect.sync(() => ends.push(end)))),
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		expect(called.kind === "called" && called.ended.kind).toBe("ended");
		expect(asked).toEqual([]);
		expect(ends).toEqual([{phase: "over"}]);
		expect(w.started).toEqual([]);
		expect(w.writes).toEqual([]);
	});

	it("one machine run under one id at a time: a second keep.run of it while the first goes dies, and nothing runs twice", async () => {
		const w = world();
		const asked: string[] = [];
		const program = defineProgram({
			name: "job",
			description: "Runs the toy job twice at once, which it may not.",
			inputs: {},
			outputs: {},
			machines: {job},
			status: {job: (s) => s.phase},
			left: {job: {by: "main"}},
			main: ({keep}) =>
				Effect.all([toTheEnd(w, keep, asked), toTheEnd(w, keep, asked)], {
					concurrency: "unbounded",
				}),
		});
		const called = await Effect.runPromise(
			call(program, {}, {keeping: {id: "job:r1", storage: memoryStorage()}}),
		);
		const ended = called.kind === "called" ? called.ended : null;
		expect(ended?.kind).toBe("failed");
		if (ended?.kind === "failed")
			expect(Cause.pretty(ended.cause)).toContain("job ran job under j twice at once");
		expect(w.writes.length).toBeLessThanOrEqual(1);
	});

	it("cannot be forgotten: a program with machines and no `left` step for one does not compile, and is refused past the types", () => {
		const base = {
			name: "job",
			description: "Never started: what does not compile, and what throws, is the test.",
			inputs: {},
			outputs: {},
			machines: {job},
			status: {job: (s: Job) => s.phase},
			main: () => Effect.void,
		};
		// @ts-expect-error a program that keeps state must say what a start does with what an earlier one left
		expect(() => defineProgram(base)).toThrow(
			"job says nothing of what a start does with the runs of job an earlier start left",
		);
		const named = {...base, left: {job: {by: "nobody"}}};
		// @ts-expect-error `by` names `main` or a machine of the program
		expect(() => defineProgram(named)).toThrow(
			"job's job is carried on by nobody, which it does not run",
		);
	});
});

/** The work's Listen in a life that is stopped before it answers: it starts, and never answers. */
const stall = (w: ReturnType<typeof world>, sub: WorkSub): Stream.Stream<JobMsg> =>
	Stream.fromEffect(
		Effect.sync(() => w.started.push(sub.deps.run)).pipe(Effect.andThen(Effect.never)),
	);
