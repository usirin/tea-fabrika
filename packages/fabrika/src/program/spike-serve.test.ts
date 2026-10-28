import {describe, expect, it} from "@effect/vitest";
import {Cause, Context, Deferred, Effect, Exit, Fiber, Schema, Stream} from "effect";
import fc from "fast-check";
import {expectTypeOf} from "vitest";
import {
	type Delivery,
	defineProgram,
	start as startDefined,
	tell as tellDefined,
} from "./program.ts";
import {output} from "./shape.ts";
import * as Program from "./spike-serve.ts";

// Experiment 164: shape B of the program API study, on a spike runtime
// (./spike-serve.ts). (a) order across inputs, against today's merge; (b) a
// forked handler beside a slow one; (c) experiment 79's flood laws on the one
// mailbox; (d) the types of `serve`.

const numbers = (count: number) => Array.from({length: count}, (_, i) => i);

// ---------------------------------------------------------------- (a) order

/** One value told: to which input, how many turns its handler takes, and whether the teller pauses after it. */
interface Step {
	readonly to: "a" | "b";
	readonly slow: number;
	readonly pause: boolean;
}
const Step = Schema.Struct({n: Schema.Int, slow: Schema.Int});
const steps = fc.array(
	fc.record({
		to: fc.constantFrom<"a" | "b">("a", "b"),
		slow: fc.integer({min: 0, max: 3}),
		pause: fc.boolean(),
	}),
	{minLength: 2, maxLength: 12},
);
const turns = (n: number) =>
	Effect.forEach(numbers(n), () => Effect.yieldNow, {discard: true, concurrency: 1});

/** Shape B: one mailbox, one handler per input. */
const served = (got: number[]) =>
	Program.make("served", {
		description: "Keeps the order values are told in, across its two inputs.",
		inputs: {
			a: Program.input(Step, "A value."),
			b: Program.input(Step, "Another value."),
		},
		outputs: {},
		main: ({serve}) => {
			const handle = ({n, slow}: typeof Step.Type) =>
				turns(slow).pipe(Effect.andThen(Effect.sync(() => got.push(n))));
			return serve({a: handle, b: handle});
		},
	});

/** Today's shape: one Stream per input, merged into one loop, as `asks` and the tracker do. */
const merged = (got: number[]) =>
	defineProgram({
		name: "merged",
		description: "Merges its two inputs into one loop.",
		inputs: {
			a: Program.input(Step, "A value."),
			b: Program.input(Step, "Another value."),
		},
		outputs: {},
		main: ({inputs}) =>
			Stream.merge(inputs.a, inputs.b).pipe(
				Stream.runForEach(({n, slow}) =>
					turns(slow).pipe(Effect.andThen(Effect.sync(() => got.push(n)))),
				),
			),
	});

/** Tell each step in turn, close both inputs, and answer the order the handlers ran in. */
const orderOn = (shape: "served" | "merged", list: readonly Step[]) =>
	Effect.gen(function* () {
		const got: number[] = [];
		if (shape === "served") {
			const started = yield* Program.start(served(got), {});
			if (started.kind !== "running") return null;
			for (const [n, step] of list.entries()) {
				yield* Program.tell(started.run, step.to, {n, slow: step.slow});
				if (step.pause) yield* turns(4);
			}
			started.close("a");
			started.close("b");
			yield* started.run.ended;
		} else {
			const started = yield* startDefined(merged(got), {});
			if (started.kind !== "running") return null;
			for (const [n, step] of list.entries()) {
				yield* tellDefined(started.run, step.to, {n, slow: step.slow});
				if (step.pause) yield* turns(4);
			}
			started.close("a");
			started.close("b");
			yield* started.run.ended;
		}
		return got;
	}).pipe(Effect.scoped);

const inOrder = (shape: "served" | "merged", list: readonly Step[]) =>
	Effect.runPromise(orderOn(shape, list)).then((got) => ({
		got,
		kept: JSON.stringify(got) === JSON.stringify(numbers(list.length)),
	}));

describe("(a) a tell to A, then to B, on two inputs, is handled A then B", () => {
	it("on one mailbox, for every generated run of tells, slow handlers and pauses", async () => {
		await fc.assert(
			fc.asyncProperty(steps, async (list) => {
				expect((await inOrder("served", list)).got).toEqual(numbers(list.length));
			}),
			{numRuns: 300},
		);
	});

	it("today's merge breaks it: the same runs, ten seeds of 100, on both shapes", async () => {
		const cases = numbers(10).flatMap((seed) => fc.sample(steps, {seed: seed + 1, numRuns: 100}));
		const broken: number[] = [];
		const servedBroken: number[] = [];
		for (const [i, list] of cases.entries()) {
			if (!(await inOrder("merged", list)).kept) broken.push(i);
			if (!(await inOrder("served", list)).kept) servedBroken.push(i);
		}
		// A run told to one input alone cannot break order across inputs.
		const mixed = cases.filter((list) => new Set(list.map((s) => s.to)).size === 2).length;
		// The numbers the write-up gives.
		console.log(
			JSON.stringify({
				runs: cases.length,
				mixed,
				merged: broken.length,
				served: servedBroken.length,
			}),
		);
		expect(servedBroken).toEqual([]);
		expect(broken.length).toBeGreaterThan(0);
	});

	it("the smallest case today's merge breaks: a, a, b told before main reads comes out a, b, a", async () => {
		const list: Step[] = [
			{to: "a", slow: 0, pause: false},
			{to: "a", slow: 0, pause: false},
			{to: "b", slow: 0, pause: false},
		];
		expect((await inOrder("merged", list)).got).toEqual([0, 2, 1]);
		expect((await inOrder("served", list)).got).toEqual([0, 1, 2]);
	});
});

// ---------------------------------------------------------------- (b) fork

const Line = Schema.Int;
const Signal = Schema.Literals(["interrupt"]);

/** `line` waits on `release`; `signal` is forked, or not. */
const lanes = (
	release: Deferred.Deferred<void>,
	heard: string[],
	forked: boolean,
	capacity = 1000,
) =>
	Program.make("lanes", {
		description: "A slow line, and a signal beside it.",
		capacity,
		inputs: {
			line: Program.input(Line, "A line that runs until it is let go."),
			signal: Program.input(Signal, "Ctrl-C."),
		},
		outputs: {},
		main: ({serve}) => {
			const line = (n: number) =>
				Deferred.await(release).pipe(Effect.andThen(Effect.sync(() => heard.push(`line ${n}`))));
			const signal = (s: "interrupt") => Effect.sync(() => heard.push(s));
			return forked
				? serve({line, signal: Program.fork(signal)}, {until: ["line"]})
				: serve({line, signal}, {until: ["line"]});
		},
	});

describe("(b) a forked handler is not blocked behind a slow one", () => {
	it.live("a forked signal is handled while the line before it still runs", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const heard: string[] = [];
			const started = yield* Program.start(lanes(release, heard, true), {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* Program.tell(started.run, "line", 1);
			yield* Program.tell(started.run, "signal", "interrupt");
			yield* Effect.sleep("20 millis");
			const during = [...heard];
			yield* Deferred.succeed(release, undefined);
			started.close("line");
			const ended = yield* started.run.ended;
			expect(during).toEqual(["interrupt"]);
			expect(heard).toEqual(["interrupt", "line 1"]);
			expect(ended).toEqual({kind: "ended", unread: {}});
		}).pipe(Effect.scoped),
	);

	it.live("the same signal, not forked, waits its turn behind the line", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const heard: string[] = [];
			const started = yield* Program.start(lanes(release, heard, false), {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* Program.tell(started.run, "line", 1);
			yield* Program.tell(started.run, "signal", "interrupt");
			yield* Effect.sleep("20 millis");
			const during = [...heard];
			yield* Deferred.succeed(release, undefined);
			started.close("line");
			yield* started.run.ended;
			expect(during).toEqual([]);
			expect(heard).toEqual(["line 1", "interrupt"]);
		}).pipe(Effect.scoped),
	);

	it.live(
		"a full mailbox refuses a signal: lines piled behind a slow one fill the bound every input shares",
		() =>
			Effect.gen(function* () {
				const release = yield* Deferred.make<void>();
				const heard: string[] = [];
				const started = yield* Program.start(lanes(release, heard, true, 4), {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				for (const n of numbers(4)) yield* Program.tell(started.run, "line", n);
				const signal = yield* Effect.flip(Program.tell(started.run, "signal", "interrupt"));
				const box = started.run.queues();
				yield* Deferred.succeed(release, undefined);
				started.close("line");
				yield* started.run.ended;
				expect(signal).toMatchObject({_tag: "MailboxFull", input: "signal", capacity: 4});
				expect(box).toEqual({length: 4, waiting: 0, by: {line: 4}});
				expect(heard).toEqual(["line 0", "line 1", "line 2", "line 3"]);
			}).pipe(Effect.scoped),
	);

	it("today's shape keeps a line per input: the same pile leaves the signal's line empty, and it is queued", async () => {
		const today = defineProgram({
			name: "today",
			description: "A slow line, and a signal beside it, each on its own line.",
			inputs: {
				line: Program.input(Line, "A line.", {capacity: 4}),
				signal: Program.input(Signal, "Ctrl-C.", {capacity: 4}),
			},
			outputs: {},
			main: () => Effect.never,
		});
		const word = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* startDefined(today, {});
				if (started.kind !== "running") return null;
				for (const n of numbers(4)) yield* tellDefined(started.run, "line", n);
				return yield* tellDefined(started.run, "signal", "interrupt");
			}).pipe(Effect.scoped),
		);
		expect(word).toBe("queued");
	});

	it.live("a forked handler that fails fails serve, and the run", () =>
		Effect.gen(function* () {
			const broken = Program.make("broken", {
				description: "Its forked handler fails.",
				inputs: {line: Program.input(Line, "A line."), signal: Program.input(Signal, "Ctrl-C.")},
				outputs: {},
				main: ({serve}) =>
					serve({
						line: () => Effect.never,
						signal: Program.fork(() => Effect.fail("boom" as const)),
					}),
			});
			const started = yield* Program.start(broken, {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* Program.tell(started.run, "line", 1);
			yield* Program.tell(started.run, "signal", "interrupt");
			const ended = yield* started.run.ended;
			expect(ended.kind).toBe("failed");
			expect(ended.kind === "failed" ? Cause.squash(ended.cause) : null).toBe("boom");
		}).pipe(Effect.scoped),
	);
});

// ---------------------------------------------------------------- (c) experiment 79's flood laws

/** Never serves. */
const stuck = (capacity?: number) =>
	Program.make("stuck", {
		description: "Never reads its inputs.",
		...(capacity === undefined ? {} : {capacity}),
		inputs: {n: Program.input(Schema.Int, "A number."), m: Program.input(Schema.Int, "Another.")},
		outputs: {},
		main: () => Effect.never,
	});

/** Serves every number, in order, once `go` is done. */
const late = (go: Deferred.Deferred<void>, got: number[], capacity?: number) =>
	Program.make("late", {
		description: "Reads its numbers once it is let go.",
		...(capacity === undefined ? {} : {capacity}),
		inputs: {n: Program.input(Schema.Int, "A number.")},
		outputs: {},
		main: ({serve}) =>
			Deferred.await(go).pipe(Effect.andThen(serve({n: (n) => Effect.sync(() => got.push(n))}))),
	});

describe("(c) experiment 79's laws on one mailbox", () => {
	it("a host's tell fails MailboxFull past 1000 values told and not handled, at once", async () => {
		const words = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Program.start(stuck(), {});
				if (started.kind !== "running") return null;
				const counts: Record<string, number> = {};
				for (let i = 0; i < 100_000; i++) {
					const word = yield* Program.tell(started.run, i % 2 === 0 ? "n" : "m", i).pipe(
						Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
					);
					counts[word] = (counts[word] ?? 0) + 1;
				}
				return {counts, box: started.run.queues()};
			}).pipe(Effect.scoped),
		);
		// Today: 1000 per input, so two inputs take 2000 between them. Here the bound is the run's.
		expect(words).toEqual({
			counts: {queued: 1000, MailboxFull: 99_000},
			box: {length: 1000, waiting: 0, by: {n: 500, m: 500}},
		});
	});

	it.live(
		"offer waits for room: three mailboxes' worth to a late reader all arrive, once and in order",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const go = yield* Deferred.make<void>();
				const started = yield* Program.start(late(go, got), {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				const offering = yield* Effect.forkChild(
					Effect.forEach(numbers(3000), (n) => Program.offer(started.run, "n", n), {
						concurrency: 1,
					}),
				);
				yield* Effect.sleep("20 millis");
				const waiting = got.length;
				yield* Deferred.succeed(go, undefined);
				const words = new Set(yield* Fiber.join(offering));
				started.close("n");
				expect({waiting, words: [...words], ended: yield* started.run.ended}).toEqual({
					waiting: 0,
					words: ["queued"],
					ended: {kind: "ended", unread: {}},
				});
				expect(got).toEqual(numbers(3000));
			}).pipe(Effect.scoped),
	);

	it("call tells more than the mailbox holds, and every value is heard", async () => {
		const echo = Program.make("echo", {
			description: "Says back each number.",
			inputs: {n: Program.input(Schema.Int, "A number.")},
			outputs: {said: output(Schema.Int, "The same number.")},
			main: ({serve, send}) => serve({n: (n) => send("said", n)}),
		});
		const called = await Effect.runPromise(Program.call(echo, {}, {n: numbers(3000)}));
		expect(called.kind === "called" ? called.heard.map((h) => h.value) : called).toEqual(
			numbers(3000),
		);
	});

	it.live(
		"an offer waiting when the run stops answers stopped; one waiting when the input closes is read; a tell after the close answers closed",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const go = yield* Deferred.make<void>();
				const a = yield* Program.start(late(go, got), {});
				const b = yield* Program.start(stuck(), {});
				if (a.kind !== "running" || b.kind !== "running") return yield* Effect.die("not started");
				for (const n of numbers(1000)) yield* Program.tell(a.run, "n", n);
				for (const n of numbers(1000)) yield* Program.tell(b.run, "n", n);
				const closing = yield* Effect.forkChild(Program.offer(a.run, "n", -1));
				const stopping = yield* Effect.forkChild(Program.offer(b.run, "n", -1));
				yield* Effect.sleep("10 millis");
				yield* b.stop;
				a.close("n");
				yield* Deferred.succeed(go, undefined);
				const told = [
					yield* Fiber.join(closing),
					yield* Fiber.join(stopping),
					yield* Program.tell(a.run, "n", 0),
				];
				yield* a.run.ended;
				expect(told).toEqual(["queued", "stopped", "closed"]);
				expect(got).toEqual([...numbers(1000), -1]);
			}).pipe(Effect.scoped),
	);

	it.live(
		"queues() counts the writers waiting on a full mailbox, and not a tell that failed; they go once room comes",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const go = yield* Deferred.make<void>();
				const started = yield* Program.start(late(go, got), {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				const empty = started.run.queues();
				for (const n of numbers(1000)) yield* Program.tell(started.run, "n", n);
				const word = yield* Program.tell(started.run, "n", -1).pipe(
					Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
				);
				const told = started.run.queues();
				const two = yield* Effect.forkChild(
					Effect.forEach([-2, -3], (n) => Program.offer(started.run, "n", n), {concurrency: 2}),
				);
				yield* Effect.sleep("10 millis");
				const asleep = started.run.queues();
				yield* Deferred.succeed(go, undefined);
				yield* Fiber.join(two);
				started.close("n");
				yield* started.run.ended;
				expect({empty, word, told, asleep, after: started.run.queues()}).toEqual({
					empty: {length: 0, waiting: 0, by: {}},
					word: "MailboxFull",
					told: {length: 1000, waiting: 0, by: {n: 1000}},
					asleep: {length: 1000, waiting: 2, by: {n: 1000}},
					after: {length: 0, waiting: 0, by: {}},
				});
				expect(got.length).toBe(1002);
			}).pipe(Effect.scoped),
	);

	it("a program's own capacity: 16 told, the 17th fails MailboxFull naming the input it was told to", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Program.start(stuck(16), {});
				if (started.kind !== "running") return null;
				const words = yield* Effect.forEach(numbers(16), (n) => Program.tell(started.run, "n", n), {
					concurrency: 1,
				});
				const seventeenth = yield* Effect.flip(Program.tell(started.run, "m", 16));
				return {words: [...new Set(words)], seventeenth, box: started.run.queues()};
			}).pipe(Effect.scoped),
		);
		expect(seen?.words).toEqual(["queued"]);
		expect(seen?.seventeenth).toBeInstanceOf(Program.MailboxFull);
		expect(seen?.seventeenth).toMatchObject({_tag: "MailboxFull", input: "m", capacity: 16});
		expect(seen?.box).toEqual({length: 16, waiting: 0, by: {n: 16}});
	});

	it("a MailboxFull nobody catches fails the caller, and its type says so", async () => {
		const caller = Effect.gen(function* () {
			const started = yield* Program.start(stuck(16), {});
			if (started.kind !== "running") return "not started";
			for (const n of numbers(17)) yield* Program.tell(started.run, "n", n);
			return "all told";
		}).pipe(Effect.scoped);
		expectTypeOf(caller).toEqualTypeOf<
			Effect.Effect<"not started" | "all told", Program.MailboxFull>
		>();
		const exit = await Effect.runPromiseExit(caller);
		expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value).toMatchObject({
			_tag: "MailboxFull",
			input: "n",
			capacity: 16,
		});
	});

	it.each([0, 2.5, -1, Number.NaN])(
		"a capacity of %s is refused where the program is made",
		(capacity) => {
			expect(() => stuck(capacity)).toThrow(/an input's capacity is a whole number, 1 or more/);
		},
	);

	it.live(
		"the bound counts a value until its handler ends, not until it is read: one in hand counts",
		() =>
			Effect.gen(function* () {
				const release = yield* Deferred.make<void>();
				const heard: string[] = [];
				const started = yield* Program.start(lanes(release, heard, true, 2), {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				yield* Program.tell(started.run, "line", 0);
				yield* Effect.sleep("10 millis");
				// Line 0 is read and running; it still holds one of the two.
				yield* Program.tell(started.run, "line", 1);
				const third = yield* Effect.flip(Program.tell(started.run, "line", 2));
				yield* Deferred.succeed(release, undefined);
				started.close("line");
				yield* started.run.ended;
				expect(third).toMatchObject({_tag: "MailboxFull", capacity: 2});
			}).pipe(Effect.scoped),
	);

	it.live("values left at the end are counted by the input they were told to", () =>
		Effect.gen(function* () {
			const started = yield* Program.start(stuck(), {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			for (const n of numbers(3)) yield* Program.tell(started.run, "n", n);
			yield* Program.tell(started.run, "m", 9);
			expect(yield* started.stop).toEqual({kind: "stopped", unread: {n: 3, m: 1}});
		}).pipe(Effect.scoped),
	);
});

// ---------------------------------------------------------------- (d) types

class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}
class Clock2 extends Context.Service<Clock2, {readonly now: number}>()("spike/Clock2") {}

describe("(d) the types of serve", () => {
	it("each handler's value is its input's type; a manual input's is its delivery; errors and services are the table's", () => {
		const typed = Program.make("typed", {
			description: "Checks the types of its handler table.",
			inputs: {
				n: Program.input(Schema.Int, "A number."),
				pr: Program.input(Schema.String, "A pull request.", {ack: "manual"}),
				forget: Program.input(Schema.Struct({id: Schema.String}), "An id."),
				quit: Program.input(Schema.Null, "Stop."),
			},
			outputs: {},
			main: ({serve}) =>
				serve(
					{
						n: (n) => {
							expectTypeOf(n).toEqualTypeOf<number>();
							return n > 0 ? Effect.void : Effect.fail(new Boom());
						},
						pr: (delivery) => {
							expectTypeOf(delivery).toEqualTypeOf<Delivery<string>>();
							return delivery.ack;
						},
						forget: Program.fork(({id}) => {
							expectTypeOf(id).toEqualTypeOf<string>();
							return Effect.gen(function* () {
								yield* Clock2;
							});
						}),
						quit: () => Program.end,
					},
					{until: ["pr"]},
				),
		});
		type Typed = typeof typed;
		expectTypeOf<
			Typed extends Program.Serving<any, any, any, any, infer E, any> ? E : never
		>().toEqualTypeOf<Boom>();
		expectTypeOf<
			Typed extends Program.Serving<any, any, any, any, any, infer R> ? R : never
		>().toEqualTypeOf<Clock2>();
	});

	it("an input with no handler, a handler for no input, and a value of the wrong type do not compile", () => {
		const inputs = {
			n: Program.input(Schema.Int, "A number."),
			quit: Program.input(Schema.Null, "Stop."),
		};
		const missing = Program.make("missing", {
			description: "Forgets quit.",
			inputs,
			outputs: {},
			// @ts-expect-error: `quit` has no handler.
			main: ({serve}) => serve({n: () => Effect.void}),
		});
		const extra = Program.make("extra", {
			description: "Serves an input it does not have.",
			inputs,
			outputs: {},
			main: ({serve}) =>
				// @ts-expect-error: `nope` is no input.
				serve({n: () => Effect.void, quit: () => Program.end, nope: () => Effect.void}),
		});
		const wrong = Program.make("wrong", {
			description: "Reads a number as a string.",
			inputs,
			outputs: {},
			// @ts-expect-error: `n` is a number.
			main: ({serve}) => serve({n: (n: string) => Effect.log(n), quit: () => Program.end}),
		});
		const until = Program.make("until", {
			description: "Waits on an input it does not have.",
			inputs,
			outputs: {},
			// @ts-expect-error: `nope` is no input.
			main: ({serve}) => serve({n: () => Effect.void, quit: () => Program.end}, {until: ["nope"]}),
		});
		expect([missing.name, extra.name, wrong.name, until.name]).toEqual([
			"missing",
			"extra",
			"wrong",
			"until",
		]);
	});
});
