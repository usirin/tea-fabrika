import {Cmd, type DepKeyedSub, defineMachine, RuntimeDiscardedError, type Sub} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Cause, Deferred, Effect, Exit, Schema, Stream} from "effect";
import {KeyValueStore} from "effect/persistence";
import {failureReport, runKept} from "./kept.ts";
import {mortalDisk} from "./mortal.ts";
import {AlreadyStarted, call, defineProgram, kind} from "./program.ts";
import {type Handle, memoryStorage, StateRefused, type Storage} from "./storage.ts";

// A ref's `start` (./refs.ts, ./kept.ts) against the restart race of
// experiment 69, on a toy with the build machine's shape: a Listen that
// works, then one Act that writes. A kept run stopped while it worked is
// started again with `resume`, which starts the work again under a new run
// number.
//
// Booted bare, tea opens the kept state's Listen at once. A Listen that
// answers before the starter's `resume` moves the machine on to its write,
// and `resume` then sends that write a second time. A ref's `start` reads the
// kept state first, folds the kind's `recovered` Msg first, and opens the
// Listens only after.
//
// Then what experiment 75b adds: one live copy per id, shared by every start
// of it; another start Msg on a live copy fails `AlreadyStarted`; and a run
// its parent left unfinished fails the program, by name, when `main` returns.

// An Act, in tea's own words: a Cmd that carries the name of its one write.
const WriteIn = Schema.Struct({n: Schema.Finite, intent: Schema.String});
const write = Cmd.define("job_write", {
	input: Schema.toStandardSchemaV1(WriteIn),
	ok: Schema.toStandardSchemaV1(Schema.String),
	err: ["unknown"] as const,
});
type WriteCmd = ReturnType<typeof write>;

/** The toy's state, and the schema it is kept and read back through. */
const Job = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({phase: Schema.Literal("working"), run: Schema.Finite}),
	Schema.Struct({
		phase: Schema.Literal("writing"),
		asked: Schema.Struct({...WriteIn.fields, type: Schema.Literal("job_write")}),
	}),
	Schema.Struct({phase: Schema.Literal("over")}),
]);
type Job = typeof Job.Type;
/** The toy's state as older code kept it: its work counted in `try`, not `run`. */
const OlderJob = Schema.Struct({phase: Schema.Literal("working"), try: Schema.Finite});
type JobMsg =
	| {readonly type: "start"; readonly by: string}
	| {readonly type: "resume"}
	| {readonly type: "job_done"; readonly run: number};
type WorkSub = Sub<"job_work", {readonly run: number}>;
type Step = readonly [Job, readonly WriteCmd[]];

const work: DepKeyedSub<Job, WorkSub> = {
	type: "job_work",
	deps: (s) => (s.phase === "working" ? {run: s.run} : null),
};

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
			const asked = write({n: m.run, intent: `write/${m.run}`});
			return [{phase: "writing", asked}, [asked]];
		},
		job_write_ok: (s): Step => (s.phase === "writing" ? [{phase: "over"}, []] : [s, []]),
		job_write_err: (s): Step => (s.phase === "writing" ? [{phase: "over"}, []] : [s, []]),
	},
	subs: [work],
});

const isOver = (s: Job) => s.phase === "over";
const ID = "j";
const START = {type: "start", by: "main"} as const;

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
type World = ReturnType<typeof world>;

/** The toy as a kind: each kept phase `recovered` was asked about is noted in `asked`. */
const jobKind = (w: World, asked: string[] = []) =>
	kind({
		machine: job,
		state: Job,
		parent: "main",
		options: () => ({
			ctx: undefined,
			interpret: w.interpret,
			subscribe: w.subscribe,
			terminal: isOver,
		}),
		recovered: (s) => {
			asked.push(s.phase);
			return s.phase === "idle" ? null : {type: "resume"};
		},
		drawing: () => ({name: "job", steps: {job_write: "write", job_work: "work"}}),
		status: (s) => s.phase,
	});

/** A storage with the toy kept under `ID` in `state`, as an earlier start left it. */
const keptIn = async (state: Job): Promise<Storage> => {
	const storage = memoryStorage();
	const handle = await Effect.runPromise(storage.open("job:r1", {}));
	await handle.store("job", ID, Job).save(state);
	return storage;
};

/** A storage with the toy kept as an earlier process left it: stopped while it worked, on run 1. */
const stoppedWorking = () => keptIn({phase: "working", run: 1});

/** A program that runs the toy under `ID` to its end, from where it was kept. */
const jobProgram = (w: World, asked: string[] = []) =>
	defineProgram({
		name: "job",
		description: "Runs the toy job to its end, from where it was kept.",
		inputs: {},
		outputs: {},
		machines: {job: jobKind(w, asked)},
		main: ({machines}) =>
			Effect.gen(function* () {
				const runtime = yield* machines.job.get(ID).start(START);
				yield* runtime.done();
			}).pipe(Effect.scoped),
	});

/** How a called program ended, and the words of its failure. */
const endOf = (called: {readonly kind: string; readonly ended?: unknown}) => {
	const ended = called.kind === "called" ? (called.ended as {kind: string; cause?: unknown}) : null;
	return {
		kind: ended?.kind,
		why: ended?.cause === undefined ? "" : Cause.pretty(ended.cause as Cause.Cause<unknown>),
	};
};

describe("a ref's start: a kept run starts from its kept state, before anything else reaches it", () => {
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
					store: handle.store("job", ID, Job),
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

	it("through a ref: the kind's resume is folded first, the work starts once as run 2, and the write goes once", async () => {
		const storage = await stoppedWorking();
		const w = world();
		const asked: string[] = [];
		const called = await Effect.runPromise(
			call(jobProgram(w, asked), {}, {keeping: {id: "job:r1", storage}}),
		);
		expect(endOf(called).kind).toBe("ended");
		// Run 1's Listen, the one a restart replaces, never started.
		expect(asked).toEqual(["working"]);
		expect(w.started).toEqual([2]);
		expect(w.writes).toEqual([2]);
	});

	it("through a ref, from nothing kept: the caller's start goes first, and the run is the same as a first start", async () => {
		const w = world();
		const asked: string[] = [];
		const called = await Effect.runPromise(
			call(jobProgram(w, asked), {}, {keeping: {id: "job:r2", storage: memoryStorage()}}),
		);
		expect(endOf(called).kind).toBe("ended");
		expect(asked).toEqual([]);
		expect(w.started).toEqual([1]);
		expect(w.writes).toEqual([1]);
	});

	it("three restarts in a row, each stopped as it worked: each life starts the work once, and only the last writes", async () => {
		const storage = await stoppedWorking();
		const lives = [world(), world(), world()];
		for (const w of lives.slice(0, 2)) {
			// A life stopped as soon as its work started: before it answered, as a kill leaves it.
			// The stop waits on the work's start, not on a clock: a busy machine takes longer to get there.
			const stopped = await Effect.runPromise(
				Effect.gen(function* () {
					const working = yield* Deferred.make<void>();
					return yield* call(
						jobProgram({...w, subscribe: {job_work: (sub) => stall(w, sub, working)}}),
						{},
						{keeping: {id: "job:r1", storage}, stopOn: Deferred.await(working)},
					);
				}),
			);
			expect(endOf(stopped).kind).toBe("stopped");
		}
		const last = lives[2];
		if (last === undefined) throw new Error("no last life");
		await Effect.runPromise(call(jobProgram(last), {}, {keeping: {id: "job:r1", storage}}));
		expect(lives.map((w) => w.started)).toEqual([[2], [3], [4]]);
		expect(lives.map((w) => w.writes)).toEqual([[], [], [4]]);
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
			machines: {job: jobKind(w, asked)},
			main: ({machines}) =>
				machines.job
					.get(ID)
					.start(START)
					.pipe(
						Effect.flatMap((runtime) => runtime.done()),
						Effect.flatMap((end) => Effect.sync(() => ends.push(end))),
						Effect.scoped,
					),
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		expect(endOf(called).kind).toBe("ended");
		expect(asked).toEqual([]);
		expect(ends).toEqual([{phase: "over"}]);
		expect(w.started).toEqual([]);
		expect(w.writes).toEqual([]);
	});

	it("cannot be gone around: a kind's options hand no store, its start takes only its own Msg, and its parent is main or another of its machines", () => {
		const w = world();
		const handle = Effect.runSync(memoryStorage().open("never:r1", {}));
		const options = {ctx: undefined, interpret: w.interpret, subscribe: w.subscribe};
		const base = {
			name: "never",
			description: "Never started: what does not compile is the test.",
			inputs: {},
			outputs: {},
		};
		// Never run: here for the type checker alone.
		const programs = () => [
			kind({
				...jobKind(w),
				// @ts-expect-error nor handed a store of the caller's own, which would skip the read
				options: () => ({...options, store: handle.store("job", ID, Job)}),
			}),
			defineProgram({
				...base,
				machines: {job: jobKind(w)},
				main: ({machines}) =>
					// @ts-expect-error the toy has no `begin` Msg: a start takes only its machine's own
					machines.job.get(ID).start({type: "begin"}).pipe(Effect.scoped, Effect.orDie),
			}),
			defineProgram({
				...base,
				// @ts-expect-error a kind is never its own parent
				machines: {job: {...jobKind(w), parent: "job" as const}},
				main: () => Effect.void,
			}),
			defineProgram({
				...base,
				// @ts-expect-error a parent is `main` or another machine of the program
				machines: {job: {...jobKind(w), parent: "nobody" as const}},
				main: () => Effect.void,
			}),
		];
		expect(typeof programs).toBe("function");
		// Past the types, the check still holds.
		expect(() =>
			defineProgram({
				...base,
				machines: {job: {...jobKind(w), parent: "nobody"} as never},
				main: () => Effect.void,
			}),
		).toThrow(
			"never's job names nobody as its parent, which is not another of its machines or main",
		);
	});
});

describe("a run saved by older code: its state is checked before it starts", () => {
	it("its start fails StateRefused, nothing in it runs or is written, and another run of the same machine starts all the same", async () => {
		const storage = memoryStorage();
		const handle = await Effect.runPromise(storage.open("job:r1", {}));
		await handle.store("job", "old", OlderJob).save({phase: "working", try: 1});
		const w = world();
		const asked: string[] = [];
		const seen: string[] = [];
		const program = defineProgram({
			name: "job",
			description: "Starts a run older code kept, then a new one.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(w, asked)},
			main: ({machines}) =>
				Effect.gen(function* () {
					const old = yield* machines.job.get("old").start(START).pipe(Effect.exit);
					const failure = Exit.isFailure(old) ? Cause.squash(old.cause) : null;
					seen.push(failure instanceof StateRefused ? failure.message : "started");
					const runtime = yield* machines.job.get(ID).start(START);
					yield* runtime.done();
				}).pipe(Effect.scoped),
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		// The refused run is not a run its parent left unfinished: it never started.
		expect(endOf(called)).toEqual({kind: "ended", why: ""});
		expect(seen).toEqual([expect.stringContaining("job run old was saved by older code")]);
		// Only the new run's kind was asked about, and only the new run worked and wrote.
		expect(asked).toEqual([]);
		expect(w.started).toEqual([1]);
		expect(w.writes).toEqual([1]);
		// Its bytes are as older code left them.
		const after = await Effect.runPromise(storage.open("job:r1", null));
		expect(await Effect.runPromise(after.read("job", "old", OlderJob))).toEqual({
			phase: "working",
			try: 1,
		});
	});
});

describe("one live copy per id", () => {
	it("two starts of one id at once share one copy: the work starts once, and the write goes once", async () => {
		const w = world();
		const program = defineProgram({
			name: "job",
			description: "Starts the toy twice at once under one id.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(w)},
			main: ({machines}) =>
				Effect.gen(function* () {
					const one = () =>
						machines.job
							.get(ID)
							.start(START)
							.pipe(
								Effect.flatMap((runtime) => runtime.done().pipe(Effect.as(runtime))),
								Effect.scoped,
							);
					const [a, b] = yield* Effect.all([one(), one()], {concurrency: "unbounded"});
					if (a !== b) return yield* Effect.die(new Error("two copies of one id"));
				}),
		});
		const called = await Effect.runPromise(
			call(program, {}, {keeping: {id: "job:r1", storage: memoryStorage()}}),
		);
		expect(endOf(called)).toEqual({kind: "ended", why: ""});
		expect(w.started).toEqual([1]);
		expect(w.writes).toEqual([1]);
	});

	it("another start Msg on a live copy fails AlreadyStarted, as Temporal answers; use_existing shares it instead", async () => {
		const fresh = world();
		const w = {...fresh, subscribe: {job_work: (sub: WorkSub) => stall(fresh, sub)}};
		const seen: string[] = [];
		const program = defineProgram({
			name: "job",
			description: "Starts the toy, then again under the same id with another Msg.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(w)},
			main: ({machines}) =>
				Effect.gen(function* () {
					const ref = machines.job.get(ID);
					const first = yield* ref.start(START);
					const other = yield* ref.start({type: "start", by: "loop"}).pipe(Effect.exit);
					seen.push(
						Exit.isFailure(other) && Cause.squash(other.cause) instanceof AlreadyStarted
							? "AlreadyStarted"
							: "shared",
					);
					const same = yield* ref.start({type: "start", by: "main"});
					seen.push(same === first ? "same Msg: shared" : "two copies");
					const none = yield* ref.start();
					seen.push(none === first ? "no Msg: shared" : "two copies");
					const used = yield* ref.start({type: "start", by: "loop"}, {conflict: "use_existing"});
					seen.push(used === first ? "use_existing: shared" : "two copies");
					// Its work starts, and a little later still it has started once.
					while (w.started.length === 0) yield* Effect.sleep("1 millis");
					yield* Effect.sleep("20 millis");
				}).pipe(Effect.scoped),
		});
		const called = await Effect.runPromise(
			call(program, {}, {keeping: {id: "job:r1", storage: memoryStorage()}}),
		);
		// The work never answers: the run is left working, and main's end says so.
		expect(endOf(called).kind).toBe("failed");
		expect(seen).toEqual([
			"AlreadyStarted",
			"same Msg: shared",
			"no Msg: shared",
			"use_existing: shared",
		]);
		expect(w.started).toEqual([1]);
	});
});

describe("a run its parent left unfinished", () => {
	it("fails the program when main returns, by name, and its parent: experiment 74's stranding is loud", async () => {
		const storage = await stoppedWorking();
		const w = world();
		// main never starts the run it left working: a parent that forgot it.
		const program = defineProgram({
			name: "job",
			description: "Leaves its toy job working, and returns.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(w)},
			main: () => Effect.void,
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		expect(endOf(called).kind).toBe("failed");
		expect(endOf(called).why).toContain(
			"job ended with job run j unfinished: its parent main never took it to its end",
		);
		expect(w.writes).toEqual([]);
	});

	it("one kept before it began is dropped quietly, and one kept over is left to its parent", async () => {
		const storage = memoryStorage();
		const handle = await Effect.runPromise(storage.open("job:r1", {}));
		await handle.store("job", "never", Job).save({phase: "idle"});
		await handle.store("job", "over", Job).save({phase: "over"});
		const program = defineProgram({
			name: "job",
			description: "Returns at once.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(world())},
			main: () => Effect.void,
		});
		const called = await Effect.runPromise(call(program, {}, {keeping: {id: "job:r1", storage}}));
		expect(endOf(called)).toEqual({kind: "ended", why: ""});
		expect((await Effect.runPromise(storage.record("job:r1")))?.machines).toEqual([
			{machine: "job", id: "over"},
		]);
	});
});

describe("a failure tea reports ends the run, never the process", () => {
	it.live(
		"a Listen whose stream fails: the parent's done() dies with the cause, tea's phase named, and the program run ends failed with it",
		() =>
			Effect.gen(function* () {
				const w = {
					...world(),
					// A defect, as the world's type has no error: tea treats a stream that dies as one that fails.
					subscribe: {job_work: () => Stream.die(new Error("the work's feed broke"))},
				};
				const seen: string[] = [];
				const program = defineProgram({
					name: "job",
					description: "Waits on its toy job, whose work fails.",
					inputs: {},
					outputs: {},
					machines: {job: jobKind(w)},
					main: ({machines}) =>
						Effect.gen(function* () {
							const runtime = yield* machines.job.get(ID).start(START);
							const end = yield* runtime.done().pipe(Effect.exit);
							seen.push(
								Exit.isFailure(end) ? (Cause.pretty(end.cause).split("\n")[0] ?? "") : "done",
							);
							yield* end;
						}).pipe(Effect.scoped),
				});
				// Before: tea's default rethrew the failure on a macrotask, and done() waited for ever.
				const called = yield* call(
					program,
					{},
					{keeping: {id: "job:r1", storage: memoryStorage()}},
				);
				const words = `job run j failed (tea's "sub"): the work's feed broke`;
				expect(seen).toEqual([`Error: ${words}`]);
				expect(endOf(called).kind).toBe("failed");
				expect(endOf(called).why).toContain(words);
				expect(w.writes).toEqual([]);
			}),
	);

	it("a last save that fails as the run closes (tea's stop-save): the program run ends failed, and nothing is thrown at the process", async () => {
		let broke = false;
		const disk = mortalDisk();
		const life = disk.life((key) =>
			broke && key?.includes("/machine/job/") === true
				? Effect.fail(
						new KeyValueStore.KeyValueStoreError({message: "the disk is full", method: "set", key}),
					)
				: Effect.void,
		);
		const w = world();
		const program = defineProgram({
			name: "job",
			description: "Runs its toy job to its end, then the disk breaks.",
			inputs: {},
			outputs: {},
			machines: {job: jobKind(w)},
			main: ({machines}) =>
				Effect.gen(function* () {
					const runtime = yield* machines.job.get(ID).start(START);
					yield* runtime.done();
					// The copy is over and saved; its last save, on close, finds the disk broken.
					broke = true;
				}).pipe(Effect.scoped),
		});
		// Before: the run ended `ended`, and tea's default threw the failed save at the process.
		const called = await Effect.runPromise(
			call(program, {}, {keeping: {id: "job:r1", storage: life.storage}}),
		);
		expect(w.writes).toEqual([1]);
		expect(endOf(called).kind).toBe("failed");
		expect(endOf(called).why).toContain(`job run j failed (tea's "stop-save")`);
	});
});

const thrown = new Error("the reducer broke");

/** `breaks`' state, as a kept run keeps it. */
const Broke = Schema.Struct({run: Schema.Finite});

const BROKE: typeof Broke.Type = {run: 1};

/** A machine whose reducer throws on the answer its Listen gives at once. */
const breaks = defineMachine({
	types: {
		model: BROKE,
		msg: {} as {readonly type: "job_done"; readonly run: number},
		sub: {} as WorkSub,
		ctx: undefined,
	},
	cmds: [],
	init: () => [{run: 1}, []],
	update: {
		job_done: () => {
			throw thrown;
		},
	},
	subs: [{type: "job_work", deps: (s) => ({run: s.run})}],
});

/**
 * What a kept run does with what tea reports, with its choices written down and no clock. `closing`
 * is the test's to set. `failureReport` is the one choice `runKept` makes, out where a test can reach.
 */
const reporting = () => {
	const fails: Error[] = [];
	const brokens: Error[] = [];
	const seen = {closing: false, fails, brokens};
	const report = failureReport("job run j", {
		closing: () => seen.closing,
		fail: (ended) => seen.fails.push(ended),
		broken: (ended) => seen.brokens.push(ended),
	});
	return {seen, report};
};

describe("what a kept run does with what tea reports", () => {
	it("a report before closing fails the run, in words that name it and tea's phase", () => {
		const {seen, report} = reporting();
		report(new Error("the feed broke"), {phase: "sub"});
		expect(seen.fails.map((ended) => ended.message)).toEqual([
			`job run j failed (tea's "sub"): the feed broke`,
		]);
		expect(seen.brokens).toEqual([]);
	});

	it("keeps the error it was told as the cause of what it says", () => {
		const {seen, report} = reporting();
		report(thrown, {phase: "reduce"});
		expect(seen.fails[0]?.cause).toBe(thrown);
	});

	it("the same error again as the run closes is dropped: broken is not called", () => {
		const {seen, report} = reporting();
		report(thrown, {phase: "reduce"});
		seen.closing = true;
		report(thrown, {phase: "follow-up"});
		expect(seen.fails).toHaveLength(1);
		expect(seen.brokens).toEqual([]);
	});

	it("another error as the run closes calls broken, once", () => {
		const {seen, report} = reporting();
		report(thrown, {phase: "reduce"});
		seen.closing = true;
		report(new Error("the disk is full"), {phase: "stop-save"});
		expect(seen.fails).toHaveLength(1);
		expect(seen.brokens.map((ended) => ended.message)).toEqual([
			`job run j failed (tea's "stop-save"): the disk is full`,
		]);
	});

	it("a first report that comes as the run closes calls broken, and fails nothing", () => {
		const {seen, report} = reporting();
		seen.closing = true;
		report(new Error("the disk is full"), {phase: "stop-save"});
		expect(seen.fails).toEqual([]);
		expect(seen.brokens).toHaveLength(1);
	});

	it("a discard the host asked for does nothing, live or closing", () => {
		const {seen, report} = reporting();
		report(new RuntimeDiscardedError(1), {phase: "discard"});
		seen.closing = true;
		report(new RuntimeDiscardedError(2), {phase: "discard"});
		expect(seen.fails).toEqual([]);
		expect(seen.brokens).toEqual([]);
	});

	it("tells apart two errors, and an error that is `undefined`", () => {
		const {seen, report} = reporting();
		const where = {phase: "sub"} as const;
		for (const error of [undefined, undefined, "the disk", "the disk", "the feed"])
			report(error, where);
		expect(seen.fails.map((ended) => ended.message)).toEqual([
			`job run j failed (tea's "sub"): undefined`,
			`job run j failed (tea's "sub"): the disk`,
			`job run j failed (tea's "sub"): the feed`,
		]);
	});
});

describe("one failure tea reports twice", () => {
	it.live("a reducer's throw on a Listen's answer: two reports of one error, told once", () =>
		Effect.gen(function* () {
			const reports: string[] = [];
			const {seen, report} = reporting();
			yield* run(breaks, {
				ctx: undefined,
				subscribe: {
					job_work: (sub: WorkSub) => Stream.make({type: "job_done", run: sub.deps.run} as const),
				},
				onError: (error, where) => {
					reports.push(`${where.phase}: ${error === thrown ? "the throw" : "another"}`);
					report(error, where);
				},
			});
			while (reports.length < 2) yield* Effect.sleep("1 millis");
			// If tea ever stops repeating itself, this says the rule can go.
			expect(reports).toEqual(["reduce: the throw", "follow-up: the throw"]);
			expect(seen.fails.map((ended) => ended.cause)).toEqual([thrown]);
		}).pipe(Effect.scoped, Effect.timeout("5 seconds")),
	);

	// `runKept` itself, with no clock. tea's own repeat never lands late in a toy, so the same error
	// comes back here as the last save's failure: the one report tea makes once the run is closing.
	it.live(
		"through runKept: an error the parent already heard, told again as the run closes, does not break the program",
		() =>
			Effect.gen(function* () {
				const broken: Error[] = [];
				let closing = false;
				const real = yield* memoryStorage().open("job:r1", {});
				const handle: Handle = {
					...real,
					store: (name, id, state) => {
						const store = real.store(name, id, state);
						return {
							...store,
							save: (s) => (closing ? Promise.reject(thrown) : store.save(s)),
						};
					},
				};
				const heard = yield* Effect.scoped(
					Effect.gen(function* () {
						const runtime = yield* runKept(
							handle,
							"job",
							breaks,
							Broke,
							ID,
							{
								ctx: undefined,
								subscribe: {
									job_work: (sub: WorkSub) =>
										Stream.make({type: "job_done", run: sub.deps.run} as const),
								},
							},
							() => null,
							() => Effect.void,
							() => ({name: "job", steps: {job_work: "work"}}),
							(ended) => broken.push(ended),
						);
						const end = yield* runtime.done().pipe(Effect.exit);
						closing = true;
						return Exit.isFailure(end) ? (Cause.pretty(end.cause).split("\n")[0] ?? "") : "done";
					}),
				);
				expect(heard).toBe(`Error: job run j failed (tea's "reduce"): the reducer broke`);
				expect(broken).toEqual([]);
			}).pipe(Effect.timeout("5 seconds")),
	);
});

/**
 * The work's Listen in a life that is stopped before it answers: it starts, says so on `working`
 * when given one, and never answers.
 */
const stall = (w: World, sub: WorkSub, working?: Deferred.Deferred<void>): Stream.Stream<JobMsg> =>
	Stream.fromEffect(
		Effect.sync(() => w.started.push(sub.deps.run)).pipe(
			Effect.andThen(working === undefined ? Effect.void : Deferred.succeed(working, undefined)),
			Effect.andThen(Effect.never),
		),
	);
