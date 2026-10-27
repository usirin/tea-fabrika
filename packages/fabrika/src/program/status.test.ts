import {defineMachine} from "@demlik/tea";
import {describe, expect, it} from "@effect/vitest";
import {Cause, Duration, Effect, Fiber, Option, References, Schema, Stream} from "effect";
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
const Toy = Schema.Struct({n: Schema.Int, done: Schema.Boolean});
type Toy = typeof Toy.Type;

/** What the test holds of one copy: the way to tell it a Msg. */
interface Handle {
	readonly dispatch: (msg: {
		readonly type: "step" | "again" | "finish";
	}) => Effect.Effect<unknown, unknown>;
}

/**
 * A program that runs two copies of the toy side by side, under `a` and `b`
 * (or under each of `ids`), each until it is finished. The test drives each
 * through its handle.
 */
const pair = (
	line: (s: {readonly n: number; readonly done: boolean}) => string,
	ids: readonly string[] = ["a", "b"],
) => {
	const handles = new Map<string, Handle>();
	const program = defineProgram({
		name: "pair",
		description: "Runs two copies of a toy count side by side.",
		inputs: {},
		outputs: {},
		machines: {
			step: kind({
				machine: step,
				state: Toy,
				parent: "main",
				options: () => ({ctx: undefined, terminal: (s: Toy) => s.done}),
				drawing: ({id}) => ({name: id, steps: {}}),
				status: line,
			}),
		},
		main: ({machines}) =>
			Effect.forEach(
				ids,
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
	});

const byId = (copies: readonly Copy[]) => [...copies].sort((x, y) => x.id.localeCompare(y.id));

describe("status lines: one row per copy", () => {
	it.live(
		"two copies side by side are both listed; one that does not move is not hidden by the other; a finished one stays, not live",
		() =>
			Effect.gen(function* () {
				const {program, handles} = pair(counted);
				const seen = yield* Effect.gen(function* () {
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
				}).pipe(Effect.scoped);
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
			}),
	);

	it.live(
		"lines are sent only when one changes: a new state with the same line sends nothing",
		() =>
			Effect.gen(function* () {
				const {program, handles} = pair(counted);
				const sent = yield* Effect.gen(function* () {
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
				}).pipe(Effect.scoped);
				expect(sent).toEqual([
					["a at 0", "b at 0"],
					["a at 1", "b at 0"],
					["a at 2", "b at 0"],
				]);
			}),
	);

	/** A line with a bug: it throws once the count is at 1. */
	const buggy = (s: Toy) => {
		if (s.n === 1) throw new Error("a bug in the line");
		return counted(s);
	};

	it.live("a line that throws hurts nobody: the copy's row says so, and the machine goes on", () =>
		Effect.gen(function* () {
			const {program, handles} = pair(buggy);
			const rows = yield* Effect.gen(function* () {
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
			}).pipe(Effect.scoped);
			expect(rows).toEqual({broken: "no line: its status line threw", after: "at 2"});
		}),
	);

	it.live(
		"copies that close while others change, all at once: every row ends right, and the run goes on",
		() =>
			Effect.gen(function* () {
				const ids = Array.from({length: 8}, (_, n) => `c${n}`);
				const closing = ids.filter((_, n) => n % 2 === 0);
				const {program, handles} = pair(counted, ids);
				const seen = yield* Effect.gen(function* () {
					const started = yield* start(program, {}, {}, {id: "pair:t", storage: memoryStorage()});
					if (started.kind !== "running") return yield* Effect.die("did not start");
					const view = started.run.machines.step;
					yield* until(() => handles.size === ids.length);
					const closed = () =>
						view.copies().filter((c) => closing.includes(c.id) && !c.live).length ===
						closing.length;
					const steps = new Map<string, number>();
					// Half finish, so their copies close; the other half step on until every one of those has
					// closed, and a little after; all together.
					yield* Effect.forEach(
						ids,
						(id) =>
							Effect.gen(function* () {
								const handle = handles.get(id);
								if (handle === undefined) return yield* Effect.die(`no handle for ${id}`);
								if (closing.includes(id)) return yield* handle.dispatch({type: "finish"});
								let after = 0;
								while (after < 20 && steps.get(id) !== 500) {
									// A copy stopped under it ends its steps; the run's end below says why.
									const refused = yield* handle.dispatch({type: "step"}).pipe(
										Effect.as(false),
										Effect.catchCause(() => Effect.succeed(true)),
									);
									if (refused) return;
									steps.set(id, (steps.get(id) ?? 0) + 1);
									if (closed()) after++;
									yield* Effect.yieldNow;
								}
							}),
						{concurrency: "unbounded", discard: true},
					);
					const want = () =>
						ids.map((id) =>
							closing.includes(id)
								? {id, line: "finished at 0", live: false}
								: {id, line: `at ${steps.get(id)}`, live: true},
						);
					yield* until(() => JSON.stringify(byId(view.copies())) === JSON.stringify(want())).pipe(
						// Stopped mid-wait (the test's time limit, or a cancel): say what it waited for and saw last.
						Effect.onInterrupt(() =>
							Effect.logError(
								`the rows never matched; they were ${JSON.stringify(byId(view.copies()))}, and the test wanted ${JSON.stringify(want())}`,
							),
						),
					);
					const end = yield* started.run.ended.pipe(Effect.timeoutOption(Duration.millis(20)));
					// How the run ended, if it did, in one line: the first of its cause.
					const ended = Option.getOrNull(
						Option.map(end, (e: {readonly kind: string; readonly cause?: unknown}) =>
							e.cause === undefined
								? e.kind
								: `${e.kind}: ${Cause.pretty(e.cause as Cause.Cause<unknown>).split("\n")[0]}`,
						),
					);
					return {rows: byId(view.copies()), want: want(), ended};
				}).pipe(
					Effect.scoped,
					// Every fiber yields after three operations, not the usual 2048, so a close holds the view
					// across a yield often, as it can now and then under load: a change that cannot wait its
					// turn throws then, and the copy whose change it was is stopped.
					Effect.provideService(References.MaxOpsBeforeYield, 3),
				);
				expect({rows: seen.rows, ended: seen.ended}).toEqual({rows: seen.want, ended: null});
			}),
	);
});

describe("status lines: declared, and typed", () => {
	it("cannot be forgotten: a kind with no line does not compile, and is refused past the types; a line sits on its kind, so none names a machine the program does not run", () => {
		const declared = {
			machine: step,
			state: Toy,
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
