import {defineMachine} from "@demlik/tea";
import {Duration, Effect, Fiber, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {type Copy, defineProgram, kind, listing, start} from "./program.ts";
import {memoryStorage} from "./storage.ts";

// A status line, the mechanism: declared on each kind of `machines`, one
// function per machine, typed by that machine's state. The
// run's view of a machine lists every copy this start showed, by the id it
// is kept under, with its line now and whether it still runs. The tsh test
// (src/tsh/status.test.ts) is the user's job; this is what it stands on.

/** A toy machine: a count that moves on one step at a time, until it is finished. */
const step = defineMachine({
	types: {
		model: {} as {readonly n: number; readonly done: boolean},
		msg: {} as {readonly type: "step"} | {readonly type: "again"} | {readonly type: "finish"},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0, done: false}, []],
	update: {
		step: (s) => [{...s, n: s.n + 1}, []],
		// A new state, and the same line.
		again: (s) => [{...s}, []],
		finish: (s) => [{...s, done: true}, []],
	},
});
type Toy = {readonly n: number; readonly done: boolean};

/** What the test holds of one copy: the way to tell it a Msg. */
interface Handle {
	readonly dispatch: (msg: {
		readonly type: "step" | "again" | "finish";
	}) => Effect.Effect<unknown, unknown>;
}

/**
 * A program that runs two copies of the toy side by side, under `a` and `b`,
 * each until it is finished. The test drives each through its handle.
 */
const pair = (line: (s: {readonly n: number; readonly done: boolean}) => string) => {
	const handles = new Map<string, Handle>();
	const program = defineProgram({
		name: "pair",
		description: "Runs two copies of a toy count side by side.",
		inputs: {},
		outputs: {},
		machines: {
			step: kind({
				machine: step,
				parent: "main",
				options: () => ({ctx: undefined, terminal: (s: Toy) => s.done}),
				drawing: ({id}) => ({name: id, steps: {}}),
				status: line,
			}),
		},
		main: ({machines}) =>
			Effect.forEach(
				["a", "b"],
				(id) =>
					Effect.gen(function* () {
						const runtime = yield* machines.step.get(id).start();
						handles.set(id, runtime);
						yield* runtime.done();
					}).pipe(Effect.scoped, Effect.orDie),
				{concurrency: "unbounded", discard: true},
			).pipe(Effect.andThen(Effect.never)),
	});
	return {program, handles};
};

const counted = (s: {readonly n: number; readonly done: boolean}) =>
	s.done ? `finished at ${s.n}` : `at ${s.n}`;

/** Until `ready` holds, a little at a time. */
const until = (ready: () => boolean) =>
	Effect.gen(function* () {
		while (!ready()) yield* Effect.sleep(Duration.millis(2));
	}).pipe(Effect.timeout(Duration.seconds(5)), Effect.orDie);

const byId = (copies: readonly Copy[]) => [...copies].sort((x, y) => x.id.localeCompare(y.id));

describe("status lines: one row per copy", () => {
	it("two copies side by side are both listed; one that does not move is not hidden by the other; a finished one stays, not live", async () => {
		const {program, handles} = pair(counted);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(program, {}, {}, {id: "pair:t", storage: memoryStorage()});
				if (started.kind !== "running") return yield* Effect.die("did not start");
				const view = started.run.machines.step;
				yield* until(() => handles.size === 2);
				const both = byId(view.copies());
				const a = handles.get("a");
				const b = handles.get("b");
				if (a === undefined || b === undefined) return yield* Effect.die("no handles");
				// `a` moves on; `b`, the stuck one, does not.
				yield* a.dispatch({type: "step"});
				yield* a.dispatch({type: "step"});
				const moved = byId(view.copies());
				// `b` is finished: its run ends, and its row stays with its last line.
				yield* b.dispatch({type: "finish"});
				yield* until(() => view.copies().some((c) => c.id === "b" && !c.live));
				const finished = byId(view.copies());
				return {both, moved, finished};
			}).pipe(Effect.scoped),
		);
		expect(seen.both).toEqual([
			{id: "a", line: "at 0", live: true},
			{id: "b", line: "at 0", live: true},
		]);
		expect(seen.moved).toEqual([
			{id: "a", line: "at 2", live: true},
			{id: "b", line: "at 0", live: true},
		]);
		expect(seen.finished).toEqual([
			{id: "a", line: "at 2", live: true},
			{id: "b", line: "finished at 0", live: false},
		]);
	});

	it("lines are sent only when one changes: a new state with the same line sends nothing", async () => {
		const {program, handles} = pair(counted);
		const sent = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(program, {}, {}, {id: "pair:t", storage: memoryStorage()});
				if (started.kind !== "running") return yield* Effect.die("did not start");
				yield* until(() => handles.size === 2);
				const a = handles.get("a");
				if (a === undefined) return yield* Effect.die("no handle");
				const collected: (readonly Copy[])[] = [];
				const listening = yield* started.run.machines.step.lines.pipe(
					Stream.runForEach((copies) => Effect.sync(() => collected.push(copies))),
					Effect.forkChild,
				);
				yield* until(() => collected.length === 1);
				for (const type of ["again", "again", "step", "again", "step"] as const)
					yield* a.dispatch({type});
				yield* until(() => collected.length === 3);
				// Time for one more to come, if one were sent.
				yield* Effect.sleep(Duration.millis(20));
				yield* Fiber.interrupt(listening);
				return collected.map((copies) => byId(copies).map((c) => `${c.id} ${c.line}`));
			}).pipe(Effect.scoped),
		);
		expect(sent).toEqual([
			["a at 0", "b at 0"],
			["a at 1", "b at 0"],
			["a at 2", "b at 0"],
		]);
	});

	it("a line that throws hurts nobody: the copy's row says so, and the machine goes on", async () => {
		const {program, handles} = pair((s) => {
			if (s.n === 1) throw new Error("a bug in the line");
			return counted(s);
		});
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(program, {}, {}, {id: "pair:t", storage: memoryStorage()});
				if (started.kind !== "running") return yield* Effect.die("did not start");
				yield* until(() => handles.size === 2);
				const a = handles.get("a");
				if (a === undefined) return yield* Effect.die("no handle");
				yield* a.dispatch({type: "step"});
				const broken = byId(started.run.machines.step.copies())[0]?.line;
				yield* a.dispatch({type: "step"});
				const after = byId(started.run.machines.step.copies())[0]?.line;
				return {broken, after};
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual({broken: "no line: its status line threw", after: "at 2"});
	});
});

describe("status lines: declared, and typed", () => {
	it("cannot be forgotten: a kind with no line does not compile, and is refused past the types; a line sits on its kind, so none names a machine the program does not run", () => {
		const declared = {
			machine: step,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "step", steps: {}}),
		} as const;
		const base = {
			name: "toy",
			description: "Never started: what does not compile, and what throws, is the test.",
			inputs: {},
			outputs: {},
			main: () => Effect.void,
		} as const;
		// @ts-expect-error a kind says how each copy of it reads in `jobs`
		const lineless = () => kind(declared);
		expect(typeof lineless).toBe("function");
		// Past the types, as a host that reads a program from elsewhere would hand it.
		expect(() => defineProgram({...base, machines: {step: declared as never}})).toThrow(
			"toy says no status line for step",
		);
		// Never run: here for the type checker alone.
		const typed = () =>
			kind({
				...declared,
				// The line is handed that machine's state, and nothing else.
				// @ts-expect-error the toy's state has no `phase`
				status: (s) => s.phase,
			});
		expect(typeof typed).toBe("function");
	});

	it("a program with no machine has no line to give, and none is asked of it", () => {
		const plain = defineProgram({
			name: "plain",
			description: "Has no machine.",
			inputs: {},
			outputs: {},
			main: () => Effect.void,
		});
		expect(plain.machines).toEqual({});
		expect(listing(plain).status).toEqual([]);
	});

	it("listing names each machine that has a line, as --describe shows them", () => {
		expect(listing(pair(counted).program).status).toEqual(["step"]);
	});
});
