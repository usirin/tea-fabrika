import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Duration, Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, kind, start, tell} from "../program/program.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";

// The doubt of docs/direction/an-old-host-is-named-then-restarted.md: when the old host stops
// with a job's call half done, and the new host's tsh attaches the job back, is that call sent
// again? A fake job here, never a paid call: one kept machine that makes one call, and counts
// each call it makes and each start of its `main`.
//
// What it shows: nothing sends a call again by itself. `main` runs again, and the kept machine
// gets one Msg first: its kind's `recovered` Msg, or with none, the caller's start Msg again.
// A call cut off half way is sent again only when that Msg's step sends it; when it does not,
// the job waits on an answer that never comes. A call that was answered before the stop is not
// sent again either way.

const call = Cmd.define("toy_call", {
	input: Schema.Struct({}),
	ok: Schema.String,
	err: ["unknown"],
});
type CallCmd = ReturnType<typeof call>;

const Work = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({phase: Schema.Literal("calling")}),
	Schema.Struct({phase: Schema.Literal("done")}),
]);
type Work = typeof Work.Type;
type Step = readonly [Work, readonly CallCmd[]];

const work = defineMachine({
	types: {
		model: {} as Work,
		msg: {} as {readonly type: "go"} | {readonly type: "resume"},
		ctx: undefined,
	},
	cmds: [call],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		// Only a job that never began calls on `go`: a second `go` finds it calling and sends nothing.
		go: (s): Step => (s.phase === "idle" ? [{phase: "calling"}, [call({})]] : [s, []]),
		// What a kind that carries on its work does: a call that was out goes again.
		resume: (s): Step => (s.phase === "calling" ? [s, [call({})]] : [s, []]),
		toy_call_ok: (s): Step => (s.phase === "calling" ? [{phase: "done"}, []] : [s, []]),
		toy_call_err: (s): Step => [s, []],
	},
});

/** What every life of the fake job did, and how its call answers in this life. */
const world = {calls: 0, mains: 0, answer: "hang" as "hang" | "at once"};
const reset = (answer: typeof world.answer) => {
	world.calls = 0;
	world.mains = 0;
	world.answer = answer;
};

const interpret = {
	toy_call: () =>
		Effect.sync(() => {
			world.calls += 1;
		}).pipe(Effect.andThen(world.answer === "hang" ? Effect.never : Effect.succeed("answered"))),
};

/** The fake job, with or without a `recovered` Msg that carries its work on. */
const fakeJob = (name: string, carriesOn: boolean) =>
	defineProgram({
		name,
		description: "Makes one call, kept, and counts each call and each start of its main.",
		inputs: {},
		outputs: {},
		machines: {
			work: kind({
				machine: work,
				state: Work,
				parent: "main",
				options: () => ({ctx: undefined, interpret}),
				...(carriesOn
					? {recovered: (s: Work) => (s.phase === "idle" ? null : ({type: "resume"} as const))}
					: {}),
				drawing: () => ({name: "work", steps: {toy_call: "call"}}),
				status: (s) => s.phase,
			}),
		},
		main: ({machines}) =>
			Effect.gen(function* () {
				world.mains += 1;
				yield* machines.work.get("one").start({type: "go"});
				// A job that runs on, as a lane does, until it is stopped.
				return yield* Effect.never;
			}).pipe(Effect.scoped),
	});

const LIST = programList([
	listed(fakeJob("fetch", false), Layer.empty),
	listed(fakeJob("refetch", true), Layer.empty),
]);

let runs = 0;

/** One tsh on a storage, as one host's life runs it. */
const session = (storage: Storage) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:attach-again-${runs}`, storage},
		).pipe(Effect.provideService(Programs, LIST), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				yield* ready.upTo(told);
				return printed.values.slice(from).map((p) => p.text);
			});
		return {started, line};
	});

/** Wait until `ok` holds, a few seconds at most. */
const until = (what: string, ok: () => boolean) =>
	Effect.gen(function* () {
		while (!ok()) yield* Effect.sleep(Duration.millis(5));
	}).pipe(
		Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.die(`never: ${what}`)}),
	);

/** The fake job's kept state, as the next host's tsh finds it. */
const keptOf = (storage: Storage, id: string) =>
	Effect.gen(function* () {
		const handle = yield* storage.open(id, null);
		return yield* handle.read("work", "one", Work);
	});

/** One host's life: start `program`, wait until it made its call, stop. Answers the job's run id. */
const firstLife = (storage: Storage, program: string) =>
	Effect.gen(function* () {
		const {started, line} = yield* session(storage);
		const said = yield* line(`${program} &`);
		const id = said[0]?.split(" ")[1] ?? "";
		yield* until("the first call", () => world.calls === 1);
		if (world.answer === "at once")
			yield* until(
				"the call's answer, kept",
				() => Effect.runSync(keptOf(storage, id).pipe(Effect.orDie))?.phase === "done",
			);
		yield* started.stop;
		return id;
	}).pipe(Effect.scoped);

/** The next host's life: attach the job back, and let it run a while. */
const nextLife = (storage: Storage) =>
	Effect.gen(function* () {
		const {line} = yield* session(storage);
		yield* line("");
		yield* line("attach %1 &");
		yield* until("main again", () => world.mains === 2);
		// Time for a call the restart would send to be counted.
		yield* Effect.sleep(Duration.millis(100));
	}).pipe(Effect.scoped);

describe("attaching a job back on the next host: is a half-done call sent again?", () => {
	it("no, with no `recovered`: main runs again, its start Msg finds the call out, and nothing is sent", async () => {
		reset("hang");
		const storage = memoryStorage();
		const id = await Effect.runPromise(firstLife(storage, "fetch"));
		expect(await Effect.runPromise(keptOf(storage, id))).toEqual({phase: "calling"});
		await Effect.runPromise(nextLife(storage));
		expect(world).toMatchObject({mains: 2, calls: 1});
		// The call's answer never comes: the job waits, calling, until someone stops it.
		expect(await Effect.runPromise(keptOf(storage, id))).toEqual({phase: "calling"});
	});

	it("yes, once, when the kind's `recovered` Msg sends it: the call was cut off, so it goes again", async () => {
		reset("hang");
		const storage = memoryStorage();
		const id = await Effect.runPromise(firstLife(storage, "refetch"));
		await Effect.runPromise(nextLife(storage));
		expect(world).toMatchObject({mains: 2, calls: 2});
		expect(await Effect.runPromise(keptOf(storage, id))).toEqual({phase: "calling"});
	});

	it("no, either way, for a call that was answered before the host stopped", async () => {
		for (const program of ["fetch", "refetch"]) {
			reset("at once");
			const storage = memoryStorage();
			const id = await Effect.runPromise(firstLife(storage, program));
			await Effect.runPromise(nextLife(storage));
			expect(world).toMatchObject({mains: 2, calls: 1});
			expect(await Effect.runPromise(keptOf(storage, id))).toEqual({phase: "done"});
		}
	});
});
