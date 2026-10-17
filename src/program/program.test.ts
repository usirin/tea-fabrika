import {setFlagsFromString} from "node:v8";
import {runInNewContext} from "node:vm";
import {defineMachine} from "@demlik/tea";
import {run as runMachine} from "@demlik/tea/effect";
import {Cause, Context, Deferred, Effect, Fiber, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "./ear.ts";
import {
	type AnyRun,
	defineProgram,
	type Listeners,
	listing,
	pipe,
	type RunningOf,
	type RunOf,
	readFlags,
	start,
	tell,
} from "./program.ts";
import {flag, input, output} from "./shape.ts";
import {memoryShelf} from "./shelf.ts";

/** A run that keeps its machines in memory only: what a test that never restarts it hands `start`. */
const kept = (id = "greeter:test") => ({id, shelf: memoryShelf()});

// The program shape on a toy: flags checked before `main` runs, inputs told
// at any time while it runs and closed by the starter alone, outputs heard as
// events by whoever listens at that moment (from the first instant, when the
// listener is given to `start`), a machine watched by name, services from the
// caller's Layers, `pipe`, and the listing a host shows. The ship program
// (src/stages/ship/program.test.ts) is the real one.

/** A service the toy asks for through Effect's context. A test provides it. */
class Clock extends Context.Service<Clock, {readonly now: () => number}>()("ToyClock") {}

/** The toy's one machine: how many names it has greeted. */
const tally = defineMachine({
	types: {model: {} as {readonly greeted: number}, msg: {} as {type: "greeted"}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {greeted: 0}, []],
	update: {greeted: (s) => [{greeted: s.greeted + 1}, []]},
});

const Word = Schema.String.check(Schema.isPattern(/^[a-z]+$/));

const greeter = defineProgram({
	name: "greeter",
	description: "Greets each name it is told, and says the time it did.",
	flags: {
		salute: flag(Word, "The word to greet with, in small letters."),
		loud: flag(Schema.Boolean, "Shout every greeting."),
	},
	inputs: {name: input(Word, "A name to greet, in small letters. Tell it any time.")},
	outputs: {
		// Finite and Int, not Number: Effect 4.0.0 writes Number's JSON Schema as a number or the strings "NaN", "Infinity", "-Infinity".
		greeting: output(Schema.Struct({text: Schema.String, at: Schema.Finite}), "One greeting."),
		count: output(Schema.Int, "How many names it has greeted so far, after each one."),
	},
	machines: {tally},
	main: ({flags, inputs, send, watch}) =>
		Effect.gen(function* () {
			const clock = yield* Clock;
			const counter = yield* (yield* runMachine(tally, {ctx: undefined, interpret: {}})).ready;
			yield* watch("tally", counter);
			yield* inputs.name.pipe(
				Stream.runForEach((name) =>
					Effect.gen(function* () {
						const text = `${flags.salute}, ${name}`;
						yield* send("greeting", {
							text: flags.loud ? text.toUpperCase() : text,
							at: clock.now(),
						});
						yield* counter.dispatch({type: "greeted"});
						yield* send("count", counter.getState().greeted);
					}),
				),
			);
		}).pipe(Effect.scoped),
});
type Greeter = typeof greeter;
const at42 = Layer.succeed(Clock, {now: () => 42});
const quiet = {salute: "hello", loud: false} as const;

/** Whether the run is still going a moment from now. */
const stillRunning = (run: AnyRun) =>
	Effect.raceFirst(
		run.ended.pipe(Effect.as(false)),
		Effect.sleep("20 millis").pipe(Effect.as(true)),
	);

/** Start the greeter in a scope with its clock and `listeners`, and hand what the starter holds to `body`. */
const withGreeter = <A, E>(
	listeners: Listeners<Greeter["outputs"]>,
	body: (started: RunningOf<Greeter>) => Effect.Effect<A, E>,
	flags = quiet,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const started = yield* start(greeter, flags, listeners, kept());
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started);
		}).pipe(Effect.scoped, Effect.provide(at42)),
	);

describe("a running program", () => {
	it("is told names one after another, over time, its listeners hear each answer in order, and it keeps running until it is stopped", async () => {
		const counts = ear<number>();
		const greetings = ear<unknown>();
		const seen = await withGreeter({count: counts.hear, greeting: greetings.hear}, ({run, stop}) =>
			Effect.gen(function* () {
				const first = tell(run, "name", "ada");
				const one = yield* counts.upTo(1);
				const later = [tell(run, "name", "alan"), tell(run, "name", "grace")];
				const all = yield* counts.upTo(3);
				const running = yield* stillRunning(run);
				const ended = yield* stop;
				return {first, one, later, all, running, ended, after: tell(run, "name", "lin")};
			}),
		);

		expect(seen).toEqual({
			first: "queued",
			one: [1],
			later: ["queued", "queued"],
			all: [1, 2, 3],
			running: true,
			ended: {kind: "stopped"},
			after: "stopped",
		});
		expect(greetings.values).toEqual([
			{text: "hello, ada", at: 42},
			{text: "hello, alan", at: 42},
			{text: "hello, grace", at: 42},
		]);
	});

	it("tell answers at once: bad_shape for a value its input refuses, no_cell for a name it has no input for", async () => {
		const words = await withGreeter({}, ({run}) =>
			Effect.succeed([
				tell(run, "name", "Alan"),
				run.tell("colour", "red"),
				run.tell("name", 7),
				run.tell("name", "ada"),
			]),
		);
		expect(words).toEqual(["bad_shape", "no_cell", "bad_shape", "queued"]);
	});

	it("a listener given to start hears a value main sends at its first instant, before anything is told", async () => {
		const eager = defineProgram({
			...greeter,
			main: (io) => io.send("count", 0).pipe(Effect.andThen(greeter.main(io))),
		});
		const counts = ear<number>();
		const heard = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(eager, quiet, {count: counts.hear}, kept());
				if (started.kind !== "running") return null;
				tell(started.run, "name", "ada");
				return yield* counts.upTo(2);
			}).pipe(Effect.scoped, Effect.provide(at42)),
		);
		expect(heard).toEqual([0, 1]);
	});

	it("a late listener hears only what is sent after it came, many may listen, and a throwing one hurts nobody", async () => {
		const early = ear<number>();
		const heard = await withGreeter(
			{
				count: (n) => {
					early.hear(n);
					// It throws on purpose, after it has heard, to show it hurts nobody.
					throw new Error("a listener that breaks");
				},
			},
			({run}) =>
				Effect.gen(function* () {
					tell(run, "name", "ada");
					tell(run, "name", "alan");
					yield* early.upTo(2);
					const late: number[] = [];
					const off = run.listen("count", (n) => late.push(n));
					const lateAtOnce = [...late];
					tell(run, "name", "grace");
					yield* early.upTo(3);
					off();
					tell(run, "name", "lin");
					yield* early.upTo(4);
					return {early: [...early.values], lateAtOnce, late};
				}),
		);
		expect(heard).toEqual({early: [1, 2, 3, 4], lateAtOnce: [], late: [3]});
	});

	it("keeps nothing it sent: 10,000 values are heard, and none is held by the program that is still running", async () => {
		setFlagsFromString("--expose-gc");
		const gc: () => void = runInNewContext("gc");
		const many = defineProgram({
			name: "many",
			description: "Sends as many numbered values as it is told, and waits for the next number.",
			inputs: {times: input(Schema.Int, "How many values to send.")},
			outputs: {each: output(Schema.Struct({n: Schema.Int}), "One numbered value.")},
			main: ({inputs, send}) =>
				inputs.times.pipe(
					Stream.runForEach((times) =>
						Effect.forEach(
							Array.from({length: times}, (_, n) => n),
							(n) => send("each", {n}),
							{discard: true, concurrency: 1},
						),
					),
				),
		});
		// The listener holds each value only weakly, so whatever keeps one alive is the program.
		const refs: WeakRef<object>[] = [];
		const heard = ear<number>();
		const kept = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(
					many,
					{},
					{each: (v) => heard.hear(refs.push(new WeakRef(v)))},
				);
				if (started.kind !== "running") return null;
				tell(started.run, "times", 10_000);
				yield* heard.upTo(10_000);
				// A WeakRef keeps its value alive until the task that made it ends: let it end, then collect.
				yield* Effect.sleep("10 millis");
				gc();
				const alive = refs.filter((ref) => ref.deref() !== undefined).length;
				return {heard: refs.length, alive, running: yield* stillRunning(started.run)};
			}).pipe(Effect.scoped),
		);
		// When every value was kept for late listeners, all 10,000 stayed alive here.
		expect(kept).toEqual({heard: 10_000, alive: 0, running: true});
	});

	it("shows each machine by name: its state now, and a stream of every change that ends with the run", async () => {
		const counts = ear<number>();
		const shown = await withGreeter({count: counts.hear}, ({run, stop}) =>
			Effect.gen(function* () {
				const view = run.machines.tally;
				const first = yield* Deferred.make<void>();
				const watching = yield* view.changes.pipe(
					Stream.tap(() => Deferred.succeed(first, undefined)),
					// A null first when this listener came before `main` had started its machine; whether it did is the scheduler's.
					Stream.filter((state) => state !== null),
					Stream.runCollect,
					Effect.forkChild,
				);
				yield* Deferred.await(first);
				for (const name of ["ada", "alan", "grace"]) tell(run, "name", name);
				yield* counts.upTo(3);
				const now = view.state();
				yield* stop;
				return {now, changes: [...(yield* Fiber.join(watching))]};
			}),
		);
		expect(shown).toEqual({
			now: {greeted: 3},
			changes: [{greeted: 0}, {greeted: 1}, {greeted: 2}, {greeted: 3}],
		});
	});

	it("has a stable id: the starter names a run that has machines; one with none is named after its program unless named", async () => {
		const plain = defineProgram({
			name: "plain",
			description: "Has no machine.",
			inputs: {},
			outputs: {},
			main: () => Effect.void,
		});
		const ids = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* start(plain, {});
				const b = yield* start(plain, {}, {}, {id: "plain:desk-7"});
				const c = yield* start(greeter, quiet, {}, kept("greeter:desk-7"));
				return [a, b, c].map((s) => s.kind === "running" && s.run.id);
			}).pipe(Effect.scoped, Effect.provide(at42)),
		);
		expect(ids[0]).toMatch(/^plain:[0-9a-f-]{36}$/);
		expect(ids.slice(1)).toEqual(["plain:desk-7", "greeter:desk-7"]);
		// Never run: these are here for the type checker alone.
		const refused = () => [
			// @ts-expect-error A run with machines is never started without an id and a shelf.
			start(greeter, quiet),
			// @ts-expect-error An id alone is not enough: where its machines keep their state must be said too.
			start(greeter, quiet, {}, {id: "greeter:desk-8"}),
		];
		expect(typeof refused).toBe("function");
	});

	it("a run with machines started past the type checker, with no shelf, dies before main runs", async () => {
		const exit = await Effect.runPromiseExit(
			// @ts-expect-error The type checker refuses this; a caller from plain JavaScript could still make it.
			start(greeter, quiet).pipe(Effect.scoped, Effect.provide(at42)),
		);
		expect(exit._tag).toBe("Failure");
		expect(String(exit._tag === "Failure" && Cause.pretty(exit.cause))).toContain(
			"greeter has machines and was given no shelf",
		);
	});
});

describe("closing an input, like the end of stdin", () => {
	it("main reads every value told before the close, finishes, and the run ends on its own; a tell after the close answers closed", async () => {
		const counts = ear<number>();
		const seen = await withGreeter({count: counts.hear}, ({run, close}) =>
			Effect.gen(function* () {
				const told = ["ada", "alan", "grace"].map((name) => tell(run, "name", name));
				close("name");
				const afterClose = tell(run, "name", "lin");
				close("name");
				const ended = yield* run.ended;
				return {told, afterClose, ended, afterEnd: tell(run, "name", "lin")};
			}),
		);
		expect(seen).toEqual({
			told: ["queued", "queued", "queued"],
			afterClose: "closed",
			ended: {kind: "ended"},
			afterEnd: "stopped",
		});
		expect(counts.values).toEqual([1, 2, 3]);
	});

	it("close is not stop: the value main holds when the input closes is finished, and its answer is sent", async () => {
		const picked = Deferred.makeUnsafe<void>();
		const gate = Deferred.makeUnsafe<void>();
		const slow = defineProgram({
			name: "slow",
			description: "Says back each line it is told, once a gate opens.",
			inputs: {line: input(Schema.String, "A line.")},
			outputs: {said: output(Schema.String, "The same line.")},
			main: ({inputs, send}) =>
				inputs.line.pipe(
					Stream.runForEach((line) =>
						Deferred.succeed(picked, undefined).pipe(
							Effect.andThen(Deferred.await(gate)),
							Effect.andThen(send("said", line)),
						),
					),
				),
		});
		const said = ear<string>();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(slow, {}, {said: said.hear});
				if (started.kind !== "running") return null;
				tell(started.run, "line", "one");
				yield* Deferred.await(picked);
				started.close("line");
				const runningWhileHeld = yield* stillRunning(started.run);
				const heardWhileHeld = [...said.values];
				yield* Deferred.succeed(gate, undefined);
				return {runningWhileHeld, heardWhileHeld, ended: yield* started.run.ended};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({runningWhileHeld: true, heardWhileHeld: [], ended: {kind: "ended"}});
		expect(said.values).toEqual(["one"]);
	});

	it("only the starter may close or stop: the run it hands on can tell and listen, and has neither, in its type or at run time", async () => {
		// What a non-starter is given. Never called: it is here for the compiler.
		const handedOn = (run: RunOf<Greeter>) =>
			Effect.gen(function* () {
				tell(run, "name", "ada");
				run.listen("count", () => undefined);
				// @ts-expect-error: a run handed on has no way to close an input
				run.close("name");
				// @ts-expect-error: a run handed on has no way to stop the run
				yield* run.stop;
			});
		const has = await withGreeter({}, (started) =>
			Effect.succeed({
				run: ["close" in started.run, "stop" in started.run],
				starter: [typeof started.close, Effect.isEffect(started.stop)],
			}),
		);
		expect(typeof handedOn).toBe("function");
		expect(has).toEqual({run: [false, false], starter: ["function", true]});
	});
});

describe("many writers on one input, like a Unix pipe", () => {
	const echo = defineProgram({
		name: "echo",
		description: "Says back each line it is told.",
		inputs: {line: input(Schema.String, "A line.")},
		outputs: {said: output(Schema.String, "The same line.")},
		main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("said", line))),
	});
	/** Sends each line it is told on, and ends when its own input closes. */
	const relay = defineProgram({
		name: "relay",
		description: "Sends on each line it is told.",
		inputs: {line: input(Schema.String, "A line.")},
		outputs: {line: output(Schema.String, "The same line.")},
		main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("line", line))),
	});

	it("the input closes when its last writer ends, and the starter's close still closes it at once", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const said = ear<string>();
				const target = yield* start(echo, {}, {said: said.hear});
				if (target.kind !== "running") return null;
				const a = yield* pipe({program: relay, flags: {}}, "line", target, "line");
				const b = yield* pipe({program: relay, flags: {}}, "line", target, "line");
				if (a.kind !== "running" || b.kind !== "running") return null;
				tell(a.run, "line", "from a");
				a.close("line");
				yield* a.run.ended;
				const afterA = tell(target.run, "line", "from the starter");
				tell(b.run, "line", "from b");
				yield* said.upTo(3);
				const runningAfterA = yield* stillRunning(target.run);
				// The starter closes it while b still writes: b's next value breaks b's pipe.
				target.close("line");
				tell(b.run, "line", "too late");
				return {
					afterA,
					runningAfterA,
					b: (yield* b.run.ended).kind,
					target: yield* target.run.ended,
					said: said.values,
				};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			afterA: "queued",
			runningAfterA: true,
			b: "failed",
			target: {kind: "ended"},
			said: ["from a", "from the starter", "from b"],
		});
	});
});

describe("pipe: one program's output into another's input", () => {
	const echo = defineProgram({
		name: "echo",
		description: "Says back each line it is told.",
		inputs: {line: input(Schema.String, "A line.")},
		outputs: {said: output(Schema.String, "The same line.")},
		main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("said", line))),
	});
	const lines = defineProgram({
		name: "lines",
		description: "Sends each line it is started with, then ends.",
		flags: {lines: flag(Schema.Array(Schema.String), "The lines to send.")},
		inputs: {},
		outputs: {line: output(Schema.String, "One line.")},
		main: ({flags, send}) =>
			Effect.forEach(flags.lines, (line) => send("line", line), {discard: true, concurrency: 1}),
	});

	/** `lines | to`, with `to` started first. */
	const piped = (to: typeof echo, sent: readonly string[]) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const said = ear<string>();
				const target = yield* start(to, {}, {said: said.hear});
				if (target.kind !== "running") return null;
				const source = yield* pipe({program: lines, flags: {lines: sent}}, "line", target, "line");
				if (source.kind !== "running") return null;
				const from = yield* source.run.ended;
				return {from, to: yield* target.run.ended, said: said.values};
			}).pipe(Effect.scoped),
		);
	const why = (
		ended: {readonly kind: string; readonly cause?: Cause.Cause<unknown>} | undefined,
	) => (ended?.cause === undefined ? "" : String(Cause.squash(ended.cause)));

	it("each value flows through, and when the upstream ends the downstream input closes and it ends on its own", async () => {
		const seen = await piped(echo, ["one", "two", "three"]);
		expect(seen).toEqual({
			from: {kind: "ended"},
			to: {kind: "ended"},
			said: ["one", "two", "three"],
		});
	});

	it("a refused tell is not swallowed: the upstream fails at that send and says what the downstream answered", async () => {
		// Its starter closed its input and it is still running: the first tell answers `closed`.
		const lingers = defineProgram({
			...echo,
			main: (io) => echo.main(io).pipe(Effect.andThen(Effect.never)),
		});
		const closedFirst = await Effect.runPromise(
			Effect.gen(function* () {
				const target = yield* start(lingers, {});
				if (target.kind !== "running") return null;
				target.close("line");
				const source = yield* pipe(
					{program: lines, flags: {lines: ["one"]}},
					"line",
					target,
					"line",
				);
				return source.kind === "running" ? yield* source.run.ended : null;
			}).pipe(Effect.scoped),
		);
		expect(closedFirst?.kind).toBe("failed");
		expect(why(closedFirst ?? undefined)).toMatch(
			/lines sent line down a pipe that answered closed/,
		);

		// Fit cannot see a pattern (Effect 4.0.0 leaves it out of JSON Schema), so the tell is what catches it.
		const small = defineProgram({...echo, inputs: {line: input(Word, "A word in small letters.")}});
		const refused = await piped(small, ["ok", "LOUD", "never"]);
		expect(why(refused?.from)).toMatch(/lines sent line down a pipe that answered bad_shape/);
		// The value before the refused one went through; the downstream ended once its input closed.
		expect(refused).toMatchObject({to: {kind: "ended"}, said: ["ok"]});
	});

	it("does_not_fit: shapes whose JSON Schema differ are refused before the upstream starts", async () => {
		const ran: string[] = [];
		const counter = defineProgram({
			name: "counter",
			description: "Reads each whole number it is told.",
			inputs: {n: input(Schema.Int, "A whole number.")},
			outputs: {},
			main: ({inputs}) => inputs.n.pipe(Stream.runDrain),
		});
		const sends = defineProgram({
			name: "sends",
			description: "Sends a number.",
			inputs: {},
			outputs: {n: output(Schema.Finite, "Any finite number.")},
			main: ({send}) => Effect.sync(() => ran.push("main")).pipe(Effect.andThen(send("n", 1.5))),
		});
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const target = yield* start(counter, {});
				if (target.kind !== "running") return null;
				return yield* pipe({program: sends, flags: {}}, "n", target, "n");
			}).pipe(Effect.scoped),
		);
		expect(answer).toEqual({kind: "does_not_fit", output: "n", input: "n"});
		expect(ran).toEqual([]);
	});

	it("an input that cannot take the output's values does not compile", () => {
		const numbers = defineProgram({
			name: "numbers",
			description: "Sends numbers.",
			inputs: {},
			outputs: {n: output(Schema.Int, "A number.")},
			main: () => Effect.void,
		});
		// Never called: it is here for the compiler.
		const wrong = (target: RunningOf<Greeter>) =>
			// @ts-expect-error: greeter's input `name` takes a string, and `n` sends numbers
			pipe({program: numbers, flags: {}}, "n", target, "name");
		expect(typeof wrong).toBe("function");
	});
});

describe("how a run ends", () => {
	it("ended: main finished on its own; a listener given at start heard what it sent, and one after the end hears nothing", async () => {
		const once = defineProgram({...greeter, main: ({send}) => send("count", 0)});
		const atStart = ear<number>();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(once, quiet, {count: atStart.hear}, kept());
				if (started.kind !== "running") return null;
				const ended = yield* started.run.ended;
				const after: unknown[] = [];
				started.run.listen("count", (n) => after.push(n));
				return {ended, after, told: tell(started.run, "name", "ada")};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({ended: {kind: "ended"}, after: [], told: "stopped"});
		expect(atStart.values).toEqual([0]);
	});

	it("stopped: closing the starter's scope stops the run", async () => {
		const run = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(greeter, quiet, {}, kept());
				if (started.kind !== "running") return yield* Effect.die("did not start");
				return started.run;
			}).pipe(Effect.scoped, Effect.provide(at42)),
		);
		expect(await Effect.runPromise(run.ended)).toEqual({kind: "stopped"});
		expect(tell(run, "name", "ada")).toBe("stopped");
	});

	it("failed: a value the program's own output refuses is a bug in the program; the run fails and says which output", async () => {
		const liar = defineProgram({...greeter, main: ({send}) => send("count", 1.5)});
		const ended = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(liar, quiet, {}, kept());
				return started.kind === "running" ? yield* started.run.ended : null;
			}).pipe(Effect.scoped),
		);
		expect(ended?.kind).toBe("failed");
		expect(ended?.kind === "failed" && String(Cause.squash(ended.cause))).toMatch(
			/greeter sent its output count a value it does not take/,
		);
	});
});

describe("flags", () => {
	it("bad_shape: a typed flag that fails a check its type cannot hold names itself and says why, and main never runs", async () => {
		const ran: string[] = [];
		const watched = defineProgram({...greeter, main: () => Effect.sync(() => ran.push("main"))});

		const started = await Effect.runPromise(
			start(watched, {salute: "Hello", loud: false}, {}, kept()).pipe(Effect.scoped),
		);

		expect(started).toMatchObject({kind: "bad_shape", name: "salute"});
		expect(ran).toEqual([]);
	});

	it("from outside, a host's JSON: the typed flags, or the first that does not fit", () => {
		expect(readFlags(greeter, {salute: "hi", loud: true})).toEqual({
			kind: "given",
			flags: {salute: "hi", loud: true},
		});
		expect(readFlags(greeter, {salute: "hi", loud: "yes"})).toMatchObject({
			kind: "bad_shape",
			name: "loud",
		});
		expect(readFlags(greeter, {salute: "hi", loud: true, colour: "red"})).toEqual({
			kind: "bad_shape",
			name: "colour",
			why: "greeter has no flag named colour",
		});
		expect(readFlags(greeter, ["hi"])).toMatchObject({kind: "bad_shape", name: ""});
	});

	it("a program may take none, and run no machine of its own", async () => {
		const echo = defineProgram({
			name: "echo",
			description: "Says back each line it is told.",
			inputs: {line: input(Schema.String, "A line.")},
			outputs: {said: output(Schema.String, "The same line.")},
			main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("said", line))),
		});
		const said = ear<string>();
		const heard = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(echo, {}, {said: said.hear});
				if (started.kind !== "running") return null;
				tell(started.run, "line", "one");
				tell(started.run, "line", "two");
				return yield* said.upTo(2);
			}).pipe(Effect.scoped),
		);
		expect(heard).toEqual(["one", "two"]);
		expect(listing(echo)).toMatchObject({flags: [], machines: []});
	});
});

describe("defining", () => {
	it("a blank name or description is refused when the program is defined", () => {
		expect(() => defineProgram({...greeter, name: " "})).toThrow(/name/);
		expect(() => defineProgram({...greeter, description: ""})).toThrow(/description/);
	});
});

describe("listing", () => {
	it("gives the name, the description, each flag, input and output with its JSON Schema, and the machines a host can watch", () => {
		const word = {type: "string"};
		expect(listing(greeter)).toEqual({
			name: "greeter",
			description: "Greets each name it is told, and says the time it did.",
			// Patterns are not here: Effect 4.0.0 leaves them out of JSON Schema.
			flags: [
				{name: "salute", description: "The word to greet with, in small letters.", schema: word},
				{name: "loud", description: "Shout every greeting.", schema: {type: "boolean"}},
			],
			inputs: [
				{
					name: "name",
					description: "A name to greet, in small letters. Tell it any time.",
					schema: word,
				},
			],
			outputs: [
				{
					name: "greeting",
					description: "One greeting.",
					schema: {
						type: "object",
						properties: {text: {type: "string"}, at: {type: "number"}},
						required: ["text", "at"],
						additionalProperties: false,
					},
				},
				{
					name: "count",
					description: "How many names it has greeted so far, after each one.",
					schema: {type: "integer"},
				},
			],
			machines: ["tally"],
		});
	});
});
