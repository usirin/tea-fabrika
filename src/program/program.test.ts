import {defineMachine} from "@demlik/tea";
import {run as runMachine} from "@demlik/tea/effect";
import {Cause, Context, Deferred, Effect, Fiber, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {
	type AnyRun,
	defineProgram,
	listing,
	type RunOf,
	readFlags,
	start,
	tell,
} from "./program.ts";
import {flag, input, output} from "./shape.ts";

// The program shape on a toy: flags checked before `main` runs, inputs told
// at any time while it runs, outputs heard by any number of listeners (late
// ones too), a machine watched by name, services from the caller's Layers, and
// the listing a host shows. The ship program
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
const at42 = Layer.succeed(Clock, {now: () => 42});
const quiet = {salute: "hello", loud: false} as const;

/** Wait until `run` has sent `n` values on `name`, counting the ones before. */
const heardN = (run: AnyRun, name: string, n: number) =>
	Effect.gen(function* () {
		const values: unknown[] = [];
		const enough = yield* Deferred.make<readonly unknown[]>();
		const off = run.listen(name, (value: unknown) => {
			values.push(value);
			if (values.length === n) Deferred.doneUnsafe(enough, Effect.succeed([...values]));
		});
		const got = yield* Deferred.await(enough);
		off();
		return got;
	});

/** Whether the run is still going a moment from now. */
const stillRunning = (run: AnyRun) =>
	Effect.raceFirst(
		run.ended.pipe(Effect.as(false)),
		Effect.sleep("20 millis").pipe(Effect.as(true)),
	);

/** Start the greeter in a scope with its clock, and hand its run to `body`. */
const withGreeter = <A, E>(
	body: (run: RunOf<typeof greeter>) => Effect.Effect<A, E>,
	flags = quiet,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const started = yield* start(greeter, flags);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run);
		}).pipe(Effect.scoped, Effect.provide(at42)),
	);

describe("a running program", () => {
	it("is told names one after another, over time, hears each answer in order, and keeps running until it is stopped", async () => {
		const seen = await withGreeter((run) =>
			Effect.gen(function* () {
				const first = tell(run, "name", "ada");
				const one = yield* heardN(run, "count", 1);
				const later = [tell(run, "name", "alan"), tell(run, "name", "grace")];
				const counts = yield* heardN(run, "count", 3);
				const greetings = yield* heardN(run, "greeting", 3);
				const running = yield* stillRunning(run);
				const ended = yield* run.stop;
				return {
					first,
					one,
					later,
					counts,
					greetings,
					running,
					ended,
					after: tell(run, "name", "lin"),
				};
			}),
		);

		expect(seen).toEqual({
			first: "queued",
			one: [1],
			later: ["queued", "queued"],
			counts: [1, 2, 3],
			greetings: [
				{text: "hello, ada", at: 42},
				{text: "hello, alan", at: 42},
				{text: "hello, grace", at: 42},
			],
			running: true,
			ended: {kind: "stopped"},
			after: "stopped",
		});
	});

	it("tell answers at once: bad_shape for a value its input refuses, no_cell for a name it has no input for", async () => {
		const words = await withGreeter((run) =>
			Effect.succeed([
				tell(run, "name", "Alan"),
				run.tell("colour", "red"),
				run.tell("name", 7),
				run.tell("name", "ada"),
			]),
		);
		expect(words).toEqual(["bad_shape", "no_cell", "bad_shape", "queued"]);
	});

	it("an output can be listened to at any time, by many: a late listener first hears what came before, and a throwing one hurts nobody", async () => {
		const heard = await withGreeter((run) =>
			Effect.gen(function* () {
				const early: unknown[] = [];
				run.listen("count", (n) => early.push(n));
				run.listen("count", () => {
					// biome-ignore lint/plugin: a listener is plain code outside Effect; this one throws on purpose, to show it hurts nobody.
					throw new Error("a listener that breaks");
				});
				tell(run, "name", "ada");
				tell(run, "name", "alan");
				yield* heardN(run, "count", 2);
				const late: unknown[] = [];
				const off = run.listen("count", (n) => late.push(n));
				const lateAtOnce = [...late];
				off();
				tell(run, "name", "grace");
				yield* heardN(run, "count", 3);
				return {early, lateAtOnce, late};
			}),
		);
		expect(heard).toEqual({early: [1, 2, 3], lateAtOnce: [1, 2], late: [1, 2]});
	});

	it("shows each machine by name: its state now, and a stream of every change that ends with the run", async () => {
		const shown = await withGreeter((run) =>
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
				yield* heardN(run, "count", 3);
				const now = view.state();
				yield* run.stop;
				return {now, changes: [...(yield* Fiber.join(watching))]};
			}),
		);
		expect(shown).toEqual({
			now: {greeted: 3},
			changes: [{greeted: 0}, {greeted: 1}, {greeted: 2}, {greeted: 3}],
		});
	});

	it("has a stable id, named after its program unless the starter names it", async () => {
		const ids = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* start(greeter, quiet);
				const b = yield* start(greeter, quiet, {id: "greeter:desk-7"});
				return [a.kind === "running" && a.run.id, b.kind === "running" && b.run.id];
			}).pipe(Effect.scoped, Effect.provide(at42)),
		);
		expect(ids[0]).toMatch(/^greeter:[0-9a-f-]{36}$/);
		expect(ids[1]).toBe("greeter:desk-7");
	});
});

describe("how a run ends", () => {
	it("ended: main finished on its own, and a listener after the end still hears what it sent", async () => {
		const once = defineProgram({...greeter, main: ({send}) => send("count", 0)});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(once, quiet);
				if (started.kind !== "running") return null;
				const ended = yield* started.run.ended;
				const heard: unknown[] = [];
				started.run.listen("count", (n) => heard.push(n));
				return {ended, heard, told: tell(started.run, "name", "ada")};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({ended: {kind: "ended"}, heard: [0], told: "stopped"});
	});

	it("stopped: closing the starter's scope stops the run", async () => {
		const run = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(greeter, quiet);
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
				const started = yield* start(liar, quiet);
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
			start(watched, {salute: "Hello", loud: false}).pipe(Effect.scoped),
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
		const said = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(echo, {});
				if (started.kind !== "running") return null;
				tell(started.run, "line", "one");
				tell(started.run, "line", "two");
				return yield* heardN(started.run, "said", 2);
			}).pipe(Effect.scoped),
		);
		expect(said).toEqual(["one", "two"]);
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
