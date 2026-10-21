import {Deferred, Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {call, defineProgram, type Ended, start, tell} from "./program.ts";
import {input, output} from "./shape.ts";

// What a run's end says about the values still on its inputs' lines: told,
// queued, and never read by `main`. Nothing reads them after the end, and a
// host told them with no ack, so the end names how many, per input, instead of
// dropping them without a word (experiment 80). A pipe into a `manual` input
// still holds its own in the sender's outbox and sends them again; they are
// counted here the same, as unread by this run.

const words = (n: number) => Array.from({length: n}, (_, i) => `w${i}`);

/** Reads the first word, says it, and ends: the rest stay on the line. */
const firstOnly = defineProgram({
	name: "first-only",
	description: "Says the first word it is told, then ends.",
	inputs: {word: input(Schema.String, "A word.")},
	outputs: {said: output(Schema.String, "The first word.")},
	main: ({inputs, send}) =>
		inputs.word.pipe(
			Stream.take(1),
			Stream.runForEach((w) => send("said", w)),
		),
});

/** Reads every word to the end. */
const all = defineProgram({
	name: "all",
	description: "Says every word it is told.",
	inputs: {word: input(Schema.String, "A word.")},
	outputs: {said: output(Schema.String, "Each word.")},
	main: ({inputs, send}) => inputs.word.pipe(Stream.runForEach((w) => send("said", w))),
});

describe("a run's end names what it never read", () => {
	it("main that stops reading early: the end counts each value left on the line, not only the one it took", async () => {
		const called = await Effect.runPromise(call(firstOnly, {}, {told: {word: words(5)}}));
		if (called.kind !== "called") throw new Error(called.why);
		expect(called.heard).toEqual([{name: "said", value: "w0"}]);
		expect(called.ended).toEqual({kind: "ended", unread: {word: 4}});
	});

	it("main that reads every value: nothing unread", async () => {
		const called = await Effect.runPromise(call(all, {}, {told: {word: words(5)}}));
		if (called.kind !== "called") throw new Error(called.why);
		expect(called.heard).toHaveLength(5);
		expect(called.ended).toEqual({kind: "ended", unread: {}});
	});

	it("a run stopped from outside with values waiting, a manual input among them: each input's count, a host's tells too", async () => {
		const stuck = defineProgram({
			name: "stuck",
			description: "Never reads.",
			inputs: {
				word: input(Schema.String, "A word."),
				job: input(Schema.String, "A job, acked once saved.", {ack: "manual"}),
				spare: input(Schema.String, "Never told."),
			},
			outputs: {},
			main: () => Effect.never,
		});
		const ended: Ended<never> = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(stuck, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				for (const w of words(3)) yield* tell(started.run, "word", w);
				for (const w of words(2)) yield* tell(started.run, "job", w);
				return yield* started.stop;
			}).pipe(Effect.scoped),
		);
		expect(ended).toEqual({kind: "stopped", unread: {word: 3, job: 2}});
	});

	it("a run that failed with values waiting says both", async () => {
		const failing = defineProgram({
			name: "failing",
			description: "Reads one word and fails.",
			inputs: {word: input(Schema.String, "A word.")},
			outputs: {},
			main: ({inputs}) =>
				inputs.word.pipe(
					Stream.take(1),
					Stream.runDrain,
					Effect.andThen(Effect.fail("broke" as const)),
				),
		});
		const called = await Effect.runPromise(call(failing, {}, {told: {word: words(3)}}));
		if (called.kind !== "called") throw new Error(called.why);
		expect(called.ended.kind).toBe("failed");
		expect(called.ended.unread).toEqual({word: 2});
	});

	it("a value told after main returned, before the run is over, is counted too; one told after the end answers stopped", async () => {
		const gate = await Effect.runPromise(Deferred.make<void>());
		const early = defineProgram({
			name: "early",
			description: "Ends once let go, reading nothing.",
			inputs: {word: input(Schema.String, "A word.")},
			outputs: {},
			main: () => Deferred.await(gate),
		});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(early, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				const first = yield* tell(started.run, "word", "a");
				yield* Deferred.succeed(gate, undefined);
				const ended = yield* started.run.ended;
				return {first, ended, after: yield* tell(started.run, "word", "b")};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			first: "queued",
			ended: {kind: "ended", unread: {word: 1}},
			after: "stopped",
		});
	});
});
