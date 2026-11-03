import {describe, expect, it} from "@effect/vitest";
import {Cause, Context, Deferred, Effect, Fiber, Queue, Schema, Stream} from "effect";
import fc from "fast-check";
import {expectTypeOf} from "vitest";
import {
	type Delivery,
	defineProgram,
	end,
	fork,
	MailboxFull,
	type Program,
	pipe,
	start,
	tell,
} from "./program.ts";
import {input, output} from "./shape.ts";
import {memoryStorage} from "./storage.ts";

// One mailbox per run (2026-10-30, shape B of experiment 164). Every value
// told to any input, and every close, goes in and is handled in the order
// told, by one handler per input (`serve`). A control input's values go
// beside that order, each handled at once (`fork`), on their own small
// bound. The flood laws on the one bound are in ./inputs-over-time.test.ts.

const numbers = (count: number) => Array.from({length: count}, (_, i) => i);
const turns = (n: number) =>
	Effect.forEach(numbers(n), () => Effect.yieldNow, {discard: true, concurrency: 1});

// ---------------------------------------------------------------- order

/** One value told: to which input, how many turns its handler takes, and whether the teller pauses after it. */
interface Step {
	readonly to: "a" | "b";
	readonly slow: number;
	readonly pause: boolean;
}
const Told = Schema.Struct({n: Schema.Int, slow: Schema.Int});
type Told = typeof Told.Type;
const steps = fc.array(
	fc.record({
		to: fc.constantFrom<"a" | "b">("a", "b"),
		slow: fc.integer({min: 0, max: 3}),
		pause: fc.boolean(),
	}),
	{minLength: 2, maxLength: 12},
);

/** One mailbox, one handler per input. */
const served = (got: number[]) =>
	defineProgram({
		name: "served",
		description: "Keeps the order values are told in, across its two inputs.",
		inputs: {a: input(Told, "A value."), b: input(Told, "Another value.")},
		outputs: {},
		main: ({serve}) => {
			const handle = ({n, slow}: Told) =>
				turns(slow).pipe(Effect.andThen(Effect.sync(() => got.push(n))));
			return serve({a: handle, b: handle});
		},
	});

/** The order `served` handles `list` in, told one at a time, with both inputs closed after. */
const servedOrder = (list: readonly Step[]) =>
	Effect.gen(function* () {
		const got: number[] = [];
		const started = yield* start(served(got), {});
		if (started.kind !== "running") return null;
		for (const [n, step] of list.entries()) {
			yield* tell(started.run, step.to, {n, slow: step.slow});
			if (step.pause) yield* turns(4);
		}
		started.close("a");
		started.close("b");
		yield* started.run.ended;
		return got;
	}).pipe(Effect.scoped);

/**
 * The shape this replaced, as it ran before 2026-10-30: a queue per input, each read as a
 * Stream, merged into one loop by `main` (as `asks`, the owner desk and the tracker did).
 */
const mergedOrder = (list: readonly Step[]) =>
	Effect.gen(function* () {
		const got: number[] = [];
		const a = yield* Queue.bounded<Told, Cause.Done>(1000);
		const b = yield* Queue.bounded<Told, Cause.Done>(1000);
		const loop = yield* Stream.merge(Stream.fromQueue(a), Stream.fromQueue(b)).pipe(
			Stream.runForEach(({n, slow}) =>
				turns(slow).pipe(Effect.andThen(Effect.sync(() => got.push(n)))),
			),
			Effect.forkChild,
		);
		for (const [n, step] of list.entries()) {
			yield* Queue.offer(step.to === "a" ? a : b, {n, slow: step.slow});
			if (step.pause) yield* turns(4);
		}
		yield* Queue.end(a);
		yield* Queue.end(b);
		yield* Fiber.join(loop);
		return got;
	});

const kept = (got: readonly number[] | null, list: readonly Step[]) =>
	JSON.stringify(got) === JSON.stringify(numbers(list.length));

describe("a tell to a, then to b, is handled a then b", () => {
	it("on one mailbox, for every generated run of tells, slow handlers and pauses", async () => {
		await fc.assert(
			fc.asyncProperty(steps, async (list) => {
				expect(await Effect.runPromise(servedOrder(list))).toEqual(numbers(list.length));
			}),
			{numRuns: 300},
		);
	});

	it("the merge it replaced breaks it: the same 1000 runs, ten seeds of 100, out of order on the merge and never on the mailbox", async () => {
		const cases = numbers(10).flatMap((seed) => fc.sample(steps, {seed: seed + 1, numRuns: 100}));
		let merged = 0;
		let mailbox = 0;
		for (const list of cases) {
			if (!kept(await Effect.runPromise(mergedOrder(list)), list)) merged += 1;
			if (!kept(await Effect.runPromise(servedOrder(list)), list)) mailbox += 1;
		}
		console.log("order over seeded runs", {runs: cases.length, merged, mailbox});
		expect(mailbox).toBe(0);
		expect(merged).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------- control inputs

const Signal = Schema.Literals(["interrupt"]);

/** `line` waits on `release`; `signal` is a control input, handled beside the order. */
const lanes = (release: Deferred.Deferred<void>, heard: string[], capacity = 1000) =>
	defineProgram({
		name: "lanes",
		description: "A slow line, and a signal beside it.",
		capacity,
		inputs: {
			line: input(Schema.Int, "A line that runs until it is let go."),
			signal: input(Signal, "Ctrl-C.", {control: true}),
		},
		outputs: {},
		main: ({serve}) =>
			serve(
				{
					line: (n) =>
						Deferred.await(release).pipe(
							Effect.andThen(Effect.sync(() => heard.push(`line ${n}`))),
						),
					signal: fork((s) => Effect.sync(() => heard.push(s))),
				},
				{until: ["line"]},
			),
	});

describe("a control input, handled beside the order", () => {
	it.live("its value is handled while the line before it still runs", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const heard: string[] = [];
			const started = yield* start(lanes(release, heard), {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* tell(started.run, "line", 1);
			yield* tell(started.run, "signal", "interrupt");
			// The line is not let go until after this: the signal is heard first, or never.
			while (heard.length === 0) yield* Effect.sleep("1 millis");
			const during = [...heard];
			yield* Deferred.succeed(release, undefined);
			started.close("line");
			const ended = yield* started.run.ended;
			expect(during).toEqual(["interrupt"]);
			expect(heard).toEqual(["interrupt", "line 1"]);
			expect(ended).toEqual({kind: "ended", unread: {}});
		}).pipe(Effect.scoped),
	);

	it.live("a full mailbox does not refuse it: control values have their own bound", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const heard: string[] = [];
			const started = yield* start(lanes(release, heard, 4), {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			// One in hand, four waiting: the mailbox is full.
			yield* tell(started.run, "line", 0);
			while (started.run.mailbox().length > 0) yield* Effect.sleep("1 millis");
			for (const n of numbers(4)) yield* tell(started.run, "line", n + 1);
			const line = yield* Effect.flip(tell(started.run, "line", 5));
			const signal = yield* tell(started.run, "signal", "interrupt");
			while (heard.length === 0) yield* Effect.sleep("1 millis");
			const during = [...heard];
			yield* Deferred.succeed(release, undefined);
			started.close("line");
			yield* started.run.ended;
			expect(line).toMatchObject({_tag: "MailboxFull", input: "line", capacity: 4});
			expect({signal, during}).toEqual({signal: "queued", during: ["interrupt"]});
		}).pipe(Effect.scoped),
	);

	it.live(
		"the same input, ordinary: the same full mailbox refuses it, which is the trap a control input is for",
		() =>
			Effect.gen(function* () {
				const plain = defineProgram({
					name: "plain",
					description: "A slow line, and a signal in the same order.",
					capacity: 4,
					inputs: {line: input(Schema.Int, "A line."), signal: input(Signal, "Ctrl-C.")},
					outputs: {},
					main: ({serve}) => serve({line: () => Effect.never, signal: () => Effect.void}),
				});
				const started = yield* start(plain, {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				yield* tell(started.run, "line", 0);
				while (started.run.mailbox().length > 0) yield* Effect.sleep("1 millis");
				for (const n of numbers(4)) yield* tell(started.run, "line", n + 1);
				const signal = yield* Effect.flip(tell(started.run, "signal", "interrupt"));
				expect(signal).toMatchObject({_tag: "MailboxFull", input: "signal", capacity: 4});
			}).pipe(Effect.scoped),
	);

	it.live(
		"its own bound is 16 values not yet handled: the 17th fails MailboxFull naming it, and room comes back as each one ends",
		() =>
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				let handled = 0;
				const slow = defineProgram({
					name: "slow-signal",
					description: "A control input whose handler waits until it is let go.",
					inputs: {signal: input(Signal, "Ctrl-C.", {control: true})},
					outputs: {},
					main: ({serve}) =>
						serve({
							signal: fork(() =>
								Deferred.await(go).pipe(
									Effect.andThen(
										Effect.sync(() => {
											handled += 1;
										}),
									),
								),
							),
						}),
				});
				const started = yield* start(slow, {});
				if (started.kind !== "running") return yield* Effect.die("not started");
				const words = yield* Effect.forEach(
					numbers(16),
					() => tell(started.run, "signal", "interrupt"),
					{concurrency: 1},
				);
				const seventeenth = yield* Effect.flip(tell(started.run, "signal", "interrupt"));
				const waiting = yield* Effect.forkChild(
					Effect.suspend(() => started.run.offer("signal", "interrupt")),
				);
				// All 16 taken, each in its handler; the 17th waits for one of them to end.
				const settled = () => {
					const {signal} = started.run.mailbox().inputs;
					return signal.length === 0 && signal.waiting === 1;
				};
				while (!settled()) yield* Effect.sleep("1 millis");
				const asleep = started.run.mailbox();
				yield* Deferred.succeed(go, undefined);
				const word = yield* Fiber.join(waiting);
				while (handled < 17) yield* Effect.sleep("1 millis");
				started.close("signal");
				const ended = yield* started.run.ended;
				expect([...new Set(words)]).toEqual(["queued"]);
				expect(seventeenth).toBeInstanceOf(MailboxFull);
				expect(seventeenth).toMatchObject({input: "signal", capacity: 16});
				expect(asleep).toEqual({length: 0, inputs: {signal: {length: 0, waiting: 1}}});
				expect({word, handled, ended}).toEqual({
					word: "queued",
					handled: 17,
					ended: {kind: "ended", unread: {}},
				});
			}).pipe(Effect.scoped),
	);

	it.live("a forked handler that fails fails serve, and the run", () =>
		Effect.gen(function* () {
			const broken = defineProgram({
				name: "broken",
				description: "Its forked handler fails.",
				inputs: {
					line: input(Schema.Int, "A line."),
					signal: input(Signal, "Ctrl-C.", {control: true}),
				},
				outputs: {},
				main: ({serve}) =>
					serve({
						line: () => Effect.never,
						signal: fork(() => Effect.fail("boom" as const)),
					}),
			});
			const started = yield* start(broken, {});
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* tell(started.run, "line", 1);
			yield* tell(started.run, "signal", "interrupt");
			const ended = yield* started.run.ended;
			expect(ended.kind).toBe("failed");
			expect(ended.kind === "failed" ? Cause.squash(ended.cause) : null).toBe("boom");
		}).pipe(Effect.scoped),
	);
});

// ---------------------------------------------------------------- end, closes, a second serve

describe("serving ends", () => {
	it("when a handler answers end: what is still in the mailbox is counted unread, by input", async () => {
		const first = defineProgram({
			name: "first",
			description: "Handles one value and stops serving.",
			inputs: {a: input(Schema.Int, "A number."), b: input(Schema.Int, "Another.")},
			outputs: {said: output(Schema.Int, "The one handled.")},
			main: ({serve, send}) =>
				serve({
					a: (n) => send("said", n).pipe(Effect.andThen(end)),
					b: (n) => send("said", n).pipe(Effect.andThen(end)),
				}),
		});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const said: number[] = [];
				const started = yield* start(first, {}, {said: (n) => said.push(n)});
				if (started.kind !== "running") return null;
				for (const n of numbers(5)) yield* tell(started.run, n % 2 === 0 ? "b" : "a", n);
				return {ended: yield* started.run.ended, said};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({ended: {kind: "ended", unread: {a: 2, b: 2}}, said: [0]});
	});

	it("once each input in `until` has closed, and serve can be called again for the rest", async () => {
		const twice = defineProgram({
			name: "twice",
			description: "Serves until its prompt closes, says so, then serves the rest.",
			inputs: {prompt: input(Schema.String, "A prompt."), note: input(Schema.String, "A note.")},
			outputs: {said: output(Schema.String, "Each value, and when the prompt closed.")},
			main: ({serve, send}) =>
				Effect.gen(function* () {
					const handlers = {
						prompt: (p: string) => send("said", p),
						note: (n: string) => send("said", n),
					};
					yield* serve(handlers, {until: ["prompt"]});
					yield* send("said", "prompt closed");
					yield* serve(handlers);
				}),
		});
		const said = await Effect.runPromise(
			Effect.gen(function* () {
				const heard: string[] = [];
				const started = yield* start(twice, {}, {said: (s) => heard.push(s)});
				if (started.kind !== "running") return null;
				yield* tell(started.run, "prompt", "p1");
				yield* tell(started.run, "note", "n1");
				started.close("prompt");
				yield* tell(started.run, "note", "n2");
				started.close("note");
				yield* started.run.ended;
				return heard;
			}).pipe(Effect.scoped),
		);
		expect(said).toEqual(["p1", "n1", "prompt closed", "n2"]);
	});

	it("a restored run whose input was closed at an earlier start: the close is in its mailbox first, and a tell to it answers closed", async () => {
		const storage = memoryStorage();
		const keeping = {id: "restored:1", storage};
		const restored = defineProgram({
			name: "restored",
			description: "Says each value until its jobs input is closed.",
			inputs: {jobs: input(Schema.String, "A job."), notes: input(Schema.String, "A note.")},
			outputs: {said: output(Schema.String, "Each value.")},
			main: ({serve, send}) =>
				serve({jobs: (j) => send("said", j), notes: (n) => send("said", n)}, {until: ["jobs"]}),
		});
		const lives = await Effect.runPromise(
			Effect.gen(function* () {
				const heard: string[] = [];
				// The first start: one job, then the starter closes jobs, and the run ends on it.
				const one = yield* start(restored, {}, {said: (s) => heard.push(s)}, keeping);
				if (one.kind !== "running") return null;
				yield* tell(one.run, "jobs", "j1");
				while (heard.length < 1) yield* Effect.sleep("1 millis");
				one.close("jobs");
				const first = yield* one.run.ended;
				// The next start under the same id: jobs is closed from its first instant.
				const two = yield* start(restored, {}, {said: (s) => heard.push(s)}, keeping);
				if (two.kind !== "running") return null;
				const told = yield* tell(two.run, "jobs", "j2");
				return {first: first.kind, told, second: yield* two.run.ended, heard};
			}).pipe(Effect.scoped),
		);
		expect(lives).toEqual({
			first: "ended",
			told: "closed",
			second: {kind: "ended", unread: {}},
			heard: ["j1"],
		});
	});

	it("a second serve while one is serving dies, by name", async () => {
		const greedy = defineProgram({
			name: "greedy",
			description: "Serves twice at once.",
			inputs: {n: input(Schema.Int, "A number.")},
			outputs: {},
			main: ({serve}) =>
				Effect.all([serve({n: () => Effect.void}), serve({n: () => Effect.void})], {
					concurrency: "unbounded",
				}),
		});
		const ended = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(greedy, {});
				return started.kind === "running" ? yield* started.run.ended : null;
			}).pipe(Effect.scoped),
		);
		expect(ended?.kind).toBe("failed");
		expect(String(ended?.kind === "failed" && Cause.squash(ended.cause))).toMatch(
			/greedy called serve while it was serving/,
		);
	});
});

// ---------------------------------------------------------------- pipes

describe("pipes into the one mailbox", () => {
	const counts = defineProgram({
		name: "counts",
		description: "Sends 0, 1, 2, ... 9, then ends.",
		inputs: {},
		outputs: {n: output(Schema.Int, "A number.")},
		main: ({send}) =>
			Effect.forEach(numbers(10), (n) => send("n", n), {discard: true, concurrency: 1}),
	});

	it.live(
		"a pipe into an input that acks: each value comes as its delivery, beside a host's tells to another input; once each is acked the sender's outbox is empty and it ends",
		() =>
			Effect.gen(function* () {
				const got: string[] = [];
				const keeper = defineProgram({
					name: "keeper",
					description: "Acks each piped number once kept, and keeps each note.",
					inputs: {
						n: input(Schema.Int, "A number, acked once kept.", {ack: "manual"}),
						note: input(Schema.String, "A note."),
					},
					outputs: {},
					main: ({serve}) =>
						serve(
							{
								n: ({value, ack}) =>
									Effect.sync(() => got.push(`n ${value}`)).pipe(Effect.andThen(ack)),
								note: (text) => Effect.sync(() => got.push(text)),
							},
							{until: ["n"]},
						),
				});
				const target = yield* start(keeper, {});
				if (target.kind !== "running") return yield* Effect.die("not started");
				yield* tell(target.run, "note", "before");
				const source = yield* pipe({program: counts, flags: {}}, "n", target, "n");
				if (source.kind !== "running") return yield* Effect.die("not piped");
				const from = yield* source.run.ended;
				const to = yield* target.run.ended;
				expect({from, to}).toEqual({
					from: {kind: "ended", unread: {}},
					to: {kind: "ended", unread: {}},
				});
				expect(got).toEqual(["before", ...numbers(10).map((n) => `n ${n}`)]);
			}).pipe(Effect.scoped),
	);

	it.live(
		"a pipe's values and a host's tells, told in turn, are handled in the order told: the pipe is one more writer on the mailbox",
		() =>
			Effect.gen(function* () {
				const got: string[] = [];
				const go = yield* Deferred.make<void>();
				const relay = defineProgram({
					name: "relay",
					description: "Sends on each number it is told.",
					inputs: {n: input(Schema.Int, "A number.")},
					outputs: {n: output(Schema.Int, "The same number.")},
					main: ({serve, send}) => serve({n: (n) => send("n", n)}),
				});
				const sink = defineProgram({
					name: "sink",
					description: "Keeps what it is told, once let go.",
					inputs: {n: input(Schema.Int, "A number."), note: input(Schema.String, "A note.")},
					outputs: {},
					main: ({serve}) =>
						Deferred.await(go).pipe(
							Effect.andThen(
								serve(
									{
										n: (n) => Effect.sync(() => got.push(`n ${n}`)),
										note: (text) => Effect.sync(() => got.push(text)),
									},
									{until: ["n"]},
								),
							),
						),
				});
				const target = yield* start(sink, {});
				if (target.kind !== "running") return yield* Effect.die("not started");
				const source = yield* pipe({program: relay, flags: {}}, "n", target, "n");
				if (source.kind !== "running") return yield* Effect.die("not piped");
				for (const n of numbers(5)) {
					yield* tell(source.run, "n", n);
					// The relay's send lands in the sink's mailbox before the next note is told.
					while (target.run.mailbox().inputs.n.length < n + 1) yield* Effect.sleep("1 millis");
					yield* tell(target.run, "note", `note ${n}`);
				}
				source.close("n");
				yield* Deferred.succeed(go, undefined);
				yield* target.run.ended;
				expect(got).toEqual(numbers(5).flatMap((n) => [`n ${n}`, `note ${n}`]));
			}).pipe(Effect.scoped),
	);
});

// ---------------------------------------------------------------- types

class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}
class Clock2 extends Context.Service<Clock2, {readonly now: number}>()("mailbox/Clock2") {}

describe("the types of serve", () => {
	it("each handler's value is its input's type; a manual input's is its delivery; errors and services are the table's", () => {
		const typed = defineProgram({
			name: "typed",
			description: "Checks the types of its handler table.",
			inputs: {
				n: input(Schema.Int, "A number."),
				pr: input(Schema.String, "A pull request.", {ack: "manual"}),
				cancel: input(Schema.Struct({id: Schema.String}), "An id.", {control: true}),
				quit: input(Schema.Null, "Stop."),
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
						cancel: fork(({id}) => {
							expectTypeOf(id).toEqualTypeOf<string>();
							return Effect.gen(function* () {
								yield* Clock2;
							});
						}),
						quit: () => end,
					},
					{until: ["pr"]},
				),
		});
		type Typed = typeof typed;
		expectTypeOf<
			Typed extends Program<any, any, any, any, infer E, any> ? E : never
		>().toEqualTypeOf<Boom>();
		expectTypeOf<
			Typed extends Program<any, any, any, any, any, infer R> ? R : never
		>().toEqualTypeOf<Clock2>();
	});

	it("an input with no handler, a handler for no input, a value of the wrong type, a bad until, and a fork on the wrong input do not compile", () => {
		const inputs = {
			n: input(Schema.Int, "A number."),
			quit: input(Schema.Null, "Stop."),
			signal: input(Signal, "Ctrl-C.", {control: true}),
		};
		const signal = fork(() => Effect.void);
		const programs = [
			defineProgram({
				name: "missing",
				description: "Forgets quit.",
				inputs,
				outputs: {},
				// @ts-expect-error: `quit` has no handler.
				main: ({serve}) => serve({n: () => Effect.void, signal}),
			}),
			defineProgram({
				name: "extra",
				description: "Serves an input it does not have.",
				inputs,
				outputs: {},
				main: ({serve}) =>
					// @ts-expect-error: `nope` is no input.
					serve({n: () => Effect.void, quit: () => end, signal, nope: () => Effect.void}),
			}),
			defineProgram({
				name: "wrong",
				description: "Reads a number as a string.",
				inputs,
				outputs: {},
				// @ts-expect-error: `n` is a number.
				main: ({serve}) => serve({n: (n: string) => Effect.log(n), quit: () => end, signal}),
			}),
			defineProgram({
				name: "until",
				description: "Waits on an input it does not have.",
				inputs,
				outputs: {},
				main: ({serve}) =>
					// @ts-expect-error: `nope` is no input.
					serve({n: () => Effect.void, quit: () => end, signal}, {until: ["nope"]}),
			}),
			defineProgram({
				name: "unforked",
				description: "Handles its control input in the order.",
				inputs,
				outputs: {},
				main: ({serve}) =>
					// @ts-expect-error: a control input takes a fork, never a plain handler.
					serve({n: () => Effect.void, quit: () => end, signal: () => Effect.void}),
			}),
			defineProgram({
				name: "forked",
				description: "Forks an ordinary input.",
				inputs,
				outputs: {},
				main: ({serve}) =>
					// @ts-expect-error: an ordinary input is handled in the order: it takes no fork.
					serve({n: fork(() => Effect.void), quit: () => end, signal}),
			}),
		];
		expect(programs.map((p) => p.name)).toEqual([
			"missing",
			"extra",
			"wrong",
			"until",
			"unforked",
			"forked",
		]);
	});

	it("past the types, a missing handler or a fork on the wrong input dies when serve starts, by name", async () => {
		const loose = defineProgram({
			name: "loose",
			description: "Serves a table the types would refuse.",
			inputs: {
				n: input(Schema.Int, "A number."),
				signal: input(Signal, "Ctrl-C.", {control: true}),
			},
			outputs: {},
			main: ({serve}) =>
				// @ts-expect-error: a control input takes a fork; this one gets a plain handler, to reach the runtime check.
				serve({n: () => Effect.void, signal: () => Effect.void}) as Effect.Effect<void>,
		});
		const ended = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(loose, {});
				return started.kind === "running" ? yield* started.run.ended : null;
			}).pipe(Effect.scoped),
		);
		expect(String(ended?.kind === "failed" && Cause.squash(ended.cause))).toMatch(
			/loose's control input signal needs a fork handler/,
		);
	});
});
