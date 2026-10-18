// Experiment 87, kamp-us/demlik issue 692: the glue for terminal-save.feature.
// Copied to `packages/tea/scen87/692-terminal-save/` in a scratch checkout, so
// `../../src` is tea's source.
import {Cause, Effect, Exit, Scope, Stream} from "effect";
import {After} from "quickpickle";
import {run as runEffect, StoreFailed} from "../../src/effect/index.ts";
import {defineMachine, type NoCtx, type Store, type Sub} from "../../src/index.ts";
import {run as runPromise} from "../../src/promise/index.ts";
import {expectThat, Given, need, type Problems, Then, When, type World} from "../lib/moves.ts";

type State = {readonly phase: "working" | "over"};
type Msg = {readonly type: "end"};
type Timer = Sub<"timer", {readonly ms: number}>;

/** A run that a Sub ends about 10 ms after it starts. */
const machine = defineMachine({
	types: {model: {} as State, msg: {} as Msg, sub: {} as Timer, ctx: {} as NoCtx},
	init: (loaded) => [loaded ?? {phase: "working"}, []],
	update: {end: () => [{phase: "over"}, []]},
	subs: [{type: "timer", deps: (s: State) => (s.phase === "working" ? {ms: 10} : null)}],
});
const isOver = (s: State) => s.phase === "over";

/** A store whose save takes `ms`, and fails on the terminal state when `fails`. */
class SlowStore implements Store<State> {
	saved: State | null;
	failures = 0;
	readonly boom = new Error("disk full");
	constructor(
		private readonly ms: number,
		private readonly fails: boolean,
		saved: State | null,
	) {
		this.saved = saved;
	}
	load = async (): Promise<unknown> => this.saved;
	migrate = (raw: unknown) => (raw ?? null) as State | null;
	save = async (state: State): Promise<void> => {
		await sleep(this.ms);
		if (this.fails && isOver(state)) {
			this.failures++;
			throw this.boom;
		}
		this.saved = state;
	};
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What done() came to, read with a limit so a done() that never settles is a finding, not a hang. */
type Settled =
	| {readonly how: "resolved"; readonly state: State; readonly storeHeld: State | null}
	| {readonly how: "rejected"; readonly error: unknown}
	| {readonly how: "pending"};

/** One run, with both engines' verbs as Promises. */
interface Probe {
	readonly store: SlowStore | null;
	getState(): State;
	result(): State | undefined;
	done(): Promise<Settled>;
	stop(): Promise<void>;
}

const quiet = () => {};

async function startPromise(store: SlowStore | null): Promise<Probe> {
	const booting = runPromise(machine, {
		...(store === null ? {} : {store}),
		terminal: isOver,
		onError: quiet,
		subscribe: {
			timer: (_sub, _ctx, dispatch) => {
				const t = setTimeout(() => Promise.resolve(dispatch({type: "end"})).catch(quiet), 10);
				return () => clearTimeout(t);
			},
		},
	});
	const rt = await booting.ready;
	return {
		store,
		getState: () => rt.getState(),
		result: () => rt.result(),
		done: () =>
			rt.done().then(
				(state): Settled => ({how: "resolved", state, storeHeld: store?.saved ?? null}),
				(error: unknown): Settled => ({how: "rejected", error}),
			),
		stop: () => booting.stop(),
	};
}

async function startEffect(store: SlowStore | null): Promise<Probe> {
	const scope = await Effect.runPromise(Scope.make());
	const booting = await Effect.runPromise(
		Scope.provide(scope)(
			runEffect(machine, {
				...(store === null ? {} : {store}),
				terminal: isOver,
				onError: quiet,
				subscribe: {
					timer: () =>
						Stream.fromEffect(Effect.as(Effect.sleep("10 millis"), {type: "end" as const})),
				},
			}),
		),
	);
	const rt = await Effect.runPromise(booting.ready);
	return {
		store,
		getState: () => rt.getState(),
		result: () => rt.result(),
		done: async (): Promise<Settled> => {
			const exit = await Effect.runPromiseExit(rt.done());
			return Exit.isSuccess(exit)
				? {how: "resolved", state: exit.value, storeHeld: store?.saved ?? null}
				: {how: "rejected", error: Cause.squash(exit.cause)};
		},
		stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
	};
}

async function start(world: World, engine: unknown, store: SlowStore | null) {
	world.data.run = await (engine === "Effect" ? startEffect(store) : startPromise(store));
}

After(async (world: World) => {
	const probe = world.data.run as Probe | undefined;
	if (probe !== undefined) await Promise.race([probe.stop().catch(quiet), sleep(500)]);
});

/** Wait until `holds`, up to a second. */
async function until(holds: () => boolean, what: string) {
	for (let waited = 0; !holds(); waited++) {
		if (waited > 1000) throw new Error(`waited a second and ${what} never happened`);
		await sleep(1);
	}
}

const within = (p: Promise<Settled>, ms = 1000): Promise<Settled> =>
	Promise.race([p, sleep(ms).then((): Settled => ({how: "pending"}))]);

// ------------------------------------------------------------ Given

Given(
	"provide",
	"a run on the {word} engine whose store takes {int} ms to save",
	(world, engine, ms) => start(world, engine, new SlowStore(Number(ms), false, null)),
);

Given(
	"provide",
	"a run on the {word} engine whose store fails to save the terminal state",
	(world, engine) => start(world, engine, new SlowStore(50, true, null)),
);

Given("provide", "a run on the {word} engine with no store", (world, engine) =>
	start(world, engine, null),
);

Given(
	"provide",
	"a run on the {word} engine whose store already holds the terminal state",
	(world, engine) => start(world, engine, new SlowStore(50, false, {phase: "over"})),
);

// ------------------------------------------------------------ When

const probe = (world: World) => need<Probe>(world, "run");

When("listen", "the state turns terminal", async (world) => {
	await until(() => isOver(probe(world).getState()), "the state turning terminal");
});

When("listen", "the final save lands", async (world) => {
	await until(() => probe(world).store?.saved?.phase === "over", "the final save landing");
});

When("listen", "the final save fails", async (world) => {
	await until(() => (probe(world).store?.failures ?? 0) > 0, "the final save failing");
});

When("act", "I ask done\\(\\) {}", async (world, moment) => {
	const p = probe(world);
	if (moment === "during the final save") await sleep(25);
	if (moment === "after getState() turns terminal")
		await until(() => isOver(p.getState()), "terminal");
	world.data.done = p.done();
});

// ------------------------------------------------------------ Then

Then("check", "the store does not yet hold the terminal state", (world) =>
	expectThat(
		probe(world).store?.saved?.phase !== "over",
		"the save had already landed: the gap was missed",
	),
);

Then("check", "result\\(\\) is undefined", (world) => {
	const r = probe(world).result();
	return expectThat(r === undefined, `result() said ${JSON.stringify(r)}`);
});

Then("check", "result\\(\\) is the terminal state", (world) => {
	const r = probe(world).result();
	return expectThat(r?.phase === "over", `result() said ${JSON.stringify(r)}`);
});

const resolvedOver = (s: Settled): Problems =>
	s.how === "resolved"
		? expectThat(s.state.phase === "over", `done() resolved with ${JSON.stringify(s.state)}`)
		: [
				`done() ${s.how === "pending" ? "had not settled after a second" : `rejected: ${String(s.how === "rejected" ? s.error : "")}`}`,
			];

Then("check", "done\\(\\) resolves with the terminal state", async (world) =>
	resolvedOver(await within(need<Promise<Settled>>(world, "done"))),
);

Then("check", "done\\(\\) asked now resolves with the terminal state", async (world) =>
	resolvedOver(await within(probe(world).done())),
);

Then("check", "the store held the terminal state when done\\(\\) resolved", async (world) => {
	const s = await within(need<Promise<Settled>>(world, "done"));
	if (s.how !== "resolved") return [`done() did not resolve (${s.how})`];
	return expectThat(
		s.storeHeld?.phase === "over",
		`the store still held ${JSON.stringify(s.storeHeld)}`,
	);
});

/** The ruling: done() rejects with the save failure; on Effect, StoreFailed with operation "save". */
function isTheSaveFailure(world: World, error: unknown): boolean {
	const boom = probe(world).store?.boom;
	if (error instanceof StoreFailed) return error.operation === "save" && error.cause === boom;
	return error === boom || (error instanceof Error && error.cause === boom);
}

const rejectsWithSaveFailure = (world: World, s: Settled): Problems =>
	s.how === "rejected"
		? expectThat(
				isTheSaveFailure(world, s.error),
				`done() rejected with something else: ${String(s.error)}`,
			)
		: [s.how === "pending" ? "done() had not settled after a second" : "done() resolved as over"];

Then("check", "done\\(\\) rejects with the save failure", async (world) =>
	rejectsWithSaveFailure(world, await within(need<Promise<Settled>>(world, "done"))),
);

Then("check", "done\\(\\) asked again rejects with the save failure", async (world) =>
	rejectsWithSaveFailure(world, await within(probe(world).done())),
);
