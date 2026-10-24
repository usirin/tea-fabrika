import {Cause, Deferred, Effect, Exit, Fiber, Schema, Stream} from "effect";
import {describe, expect, expectTypeOf, it} from "vitest";
import {
	CAPACITY,
	call,
	defineProgram,
	Full,
	offer,
	pipe,
	start,
	tell,
	type Word,
} from "./program.ts";
import {flag, input, output} from "./shape.ts";
import {memoryStorage, type Storage} from "./storage.ts";

// Experiment 79: what a program's inputs do over time. A value or a flag
// kept by an earlier start meets today's shapes at the next one (row 6 of
// the #657 harvest), and a line nobody reads fills (row 11).

const why = (ended: {readonly kind: string; readonly cause?: Cause.Cause<unknown>} | null) =>
	ended?.cause === undefined ? "" : String(Cause.squash(ended.cause));

const Lower = Schema.String.check(Schema.isPattern(/^[a-z]+$/));

/** Reads every number, in order, once `go` is done. Its input holds `capacity` unread. */
const late = (go: Deferred.Deferred<void>, got: number[], capacity = CAPACITY) =>
	defineProgram({
		name: "late",
		description: "Reads its numbers once it is let go.",
		inputs: {n: input(Schema.Int, "A number.", {capacity})},
		outputs: {},
		main: ({inputs}) =>
			Deferred.await(go).pipe(
				Effect.andThen(inputs.n.pipe(Stream.runForEach((n) => Effect.sync(() => got.push(n))))),
			),
	});
const numbers = (count: number) => Array.from({length: count}, (_, i) => i);

/** Sends on each line it is told. */
const relay = defineProgram({
	name: "relay",
	description: "Sends on each line it is told.",
	inputs: {line: input(Schema.String, "A line.")},
	outputs: {out: output(Schema.String, "The same line.")},
	main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("out", line))),
});

/** Takes lines and never acks them, so each one stays in its sender's outbox. */
const holder = (shape: Schema.Codec<string, string>, got: string[]) =>
	defineProgram({
		name: "holder",
		description: "Takes lines and never acks them.",
		inputs: {line: input(shape, "A line.", {ack: "manual"})},
		outputs: {},
		main: ({inputs}) =>
			inputs.line.pipe(Stream.runForEach(({value}) => Effect.sync(() => got.push(value)))),
	});

/** One start of `relay | holder`, under the run id `relay:1`: tell `told`, wait until `holder` has `expect` lines, then stop both. */
const once = (
	disk: Storage,
	shape: Schema.Codec<string, string>,
	told: readonly string[],
	expected = told.length,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const got: string[] = [];
			const target = yield* start(holder(shape, got), {});
			if (target.kind !== "running") return null;
			const source = yield* pipe(
				{program: relay, flags: {}, keeping: {id: "relay:1", storage: disk}},
				"out",
				target,
				"line",
			);
			if (source.kind !== "running") return null;
			for (const line of told) yield* tell(source.run, "line", line);
			// Settled: holder has what it should, and a resend had its time; or relay ended first.
			const settled = Effect.gen(function* () {
				while (got.length < expected) yield* Effect.sleep("1 millis");
				yield* Effect.sleep("50 millis");
				return null;
			});
			const ended = yield* settled.pipe(Effect.raceFirst(source.run.ended));
			return {got, ended};
		}).pipe(Effect.scoped),
	);

describe("a value kept in an outbox meets a stricter input at the next start (row 6)", () => {
	it("moves to the run's dead letters with why; the rest are sent again, the sender runs on, and no later start sends it again", async () => {
		const disk = memoryStorage();
		const first = await once(disk, Schema.String, ["Abc", "abc"]);
		expect(first).toEqual({got: ["Abc", "abc"], ended: null});

		// Before experiment 79 this start failed before main ("answered bad_shape"), and so did every start after.
		const second = await once(disk, Lower, ["xyz"], 2);
		expect(second).toEqual({got: ["abc", "xyz"], ended: null});
		const third = await once(disk, Lower, [], 2);
		expect(third?.got).toEqual(["abc", "xyz"]);

		const record = await Effect.runPromise(disk.record("relay:1"));
		expect(record?.deadLetters).toEqual([
			{output: "out", n: 0, value: "Abc", why: expect.stringMatching(/\[a-z\]/)},
		]);
	});

	it("a value that does not fit when it is first sent still fails the sender: that is the sender's bug, not a change over time", async () => {
		const sent = await once(memoryStorage(), Lower, ["Abc"], 0);
		expect(why(sent?.ended ?? null)).toMatch(/relay sent out down a pipe that answered bad_shape/);
	});
});

describe("a run's flags at its next start (row 6)", () => {
	const seen: string[] = [];
	const Mode = Schema.Literals(["read", "write"]);
	const moder = defineProgram({
		name: "moder",
		description: "Says the mode it runs in.",
		flags: {
			mode: flag(Mode, "read or write, for the whole run."),
			loud: flag(Schema.Boolean, "Shout."),
		},
		inputs: {},
		outputs: {},
		main: ({flags}) => Effect.sync(() => seen.push(flags.mode)),
	});
	const twice = (
		disk: Storage,
		second: {readonly mode: "read" | "write"; readonly loud: boolean},
	) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const keeping = {id: "moder:1", storage: disk};
				const a = yield* start(moder, {mode: "read", loud: false}, {}, keeping);
				if (a.kind === "running") yield* a.run.ended;
				const b = yield* start(moder, second, {}, keeping);
				if (b.kind !== "running") return b;
				return yield* b.run.ended;
			}).pipe(Effect.scoped),
		);

	it("other flags under the same run id are refused by name, before main runs and before the run is opened; the record keeps the first", async () => {
		seen.length = 0;
		const disk = memoryStorage();
		// Before experiment 79 this start ran with "write" while the record kept "read".
		const second = await twice(disk, {mode: "write", loud: false});
		expect(second).toEqual({
			kind: "bad_shape",
			name: "mode",
			why: 'run moder:1 was first started with mode "read", and a run keeps the flags it was first started with',
		});
		expect(seen).toEqual(["read"]);
		// Not opened again: it still says how its first start ended.
		const record = await Effect.runPromise(disk.record("moder:1"));
		expect(record).toMatchObject({status: "ended", flags: {mode: "read", loud: false}});
	});

	it("the same flags, in another key order, start it again", async () => {
		seen.length = 0;
		const again = await twice(memoryStorage(), {loud: false, mode: "read"});
		expect(again).toEqual({kind: "ended", unread: {}});
		expect(seen).toEqual(["read", "read"]);
	});

	it("kept flags a stricter shape no longer takes refuse the next start by that flag's name", async () => {
		const disk = memoryStorage();
		await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* start(
					moder,
					{mode: "write", loud: false},
					{},
					{id: "moder:1", storage: disk},
				);
				if (a.kind === "running") yield* a.run.ended;
			}).pipe(Effect.scoped),
		);
		const stricter = defineProgram({
			...moder,
			flags: {...moder.flags, mode: flag(Schema.Literals(["read"]), "read only, now.")},
		});
		const next = await Effect.runPromise(
			start(stricter, {mode: "write"} as never, {}, {id: "moder:1", storage: disk}).pipe(
				Effect.scoped,
			),
		);
		expect(next).toMatchObject({kind: "bad_shape", name: "mode"});
	});
});

describe("a line nobody reads (row 11)", () => {
	const stuck = defineProgram({
		name: "stuck",
		description: "Never reads its input.",
		inputs: {n: input(Schema.Int, "A number.")},
		outputs: {},
		main: () => Effect.never,
	});
	it("a host's tell on an input that says no capacity fails Full past 1000 values main has not read, at once; nothing over it is kept", async () => {
		expect(CAPACITY).toBe(1000);
		expect(stuck.inputs.n.capacity).toBe(1000);
		const words = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(stuck, {});
				if (started.kind !== "running") return null;
				const counts: Record<string, number> = {};
				for (let i = 0; i < 100_000; i++) {
					const word = yield* tell(started.run, "n", i).pipe(
						Effect.catchTag("Full", (full) => Effect.succeed(full._tag)),
					);
					counts[word] = (counts[word] ?? 0) + 1;
				}
				return counts;
			}).pipe(Effect.scoped),
		);
		// Before experiment 79: {queued: 100_000}, about 31 MB held (experiments/79-flood.ts).
		expect(words).toEqual({queued: 1000, Full: 100_000 - 1000});
	});

	it("offer waits for room: three lines' worth to a reader that starts late all arrive, once and in order", async () => {
		const got: number[] = [];
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const started = yield* start(late(go, got), {});
				if (started.kind !== "running") return null;
				const offering = yield* Effect.forkChild(
					// One at a time: the order they arrive in is the point.
					Effect.forEach(numbers(3 * CAPACITY), (n) => offer(started.run, "n", n), {
						concurrency: 1,
					}),
				);
				yield* Effect.sleep("20 millis");
				const waiting = got.length;
				yield* Deferred.succeed(go, undefined);
				const words = new Set(yield* Fiber.join(offering));
				started.close("n");
				return {waiting, words: [...words], ended: yield* started.run.ended};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({waiting: 0, words: ["queued"], ended: {kind: "ended", unread: {}}});
		expect(got).toEqual(numbers(3 * CAPACITY));
	});

	it("a pipe into an input that does not ack waits on a full line instead of breaking", async () => {
		const got: number[] = [];
		const counts = defineProgram({
			name: "counts",
			description: "Sends 0, 1, 2, ... then ends.",
			flags: {to: flag(Schema.Int, "How many.")},
			inputs: {},
			outputs: {n: output(Schema.Int, "A number.")},
			main: ({flags, send}) =>
				Effect.forEach(numbers(flags.to), (n) => send("n", n), {discard: true, concurrency: 1}),
		});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const target = yield* start(late(go, got), {});
				if (target.kind !== "running") return null;
				const source = yield* pipe({program: counts, flags: {to: 3 * CAPACITY}}, "n", target, "n");
				if (source.kind !== "running") return null;
				yield* Effect.sleep("20 millis");
				yield* Deferred.succeed(go, undefined);
				return {from: yield* source.run.ended, to: yield* target.run.ended};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({from: {kind: "ended", unread: {}}, to: {kind: "ended", unread: {}}});
		expect(got).toEqual(numbers(3 * CAPACITY));
	});

	it("call tells more than a line holds, and every value is heard", async () => {
		const echo = defineProgram({
			name: "echo",
			description: "Says back each number.",
			inputs: {n: input(Schema.Int, "A number.")},
			outputs: {said: output(Schema.Int, "The same number.")},
			main: ({inputs, send}) => inputs.n.pipe(Stream.runForEach((n) => send("said", n))),
		});
		const called = await Effect.runPromise(call(echo, {}, {told: {n: numbers(3 * CAPACITY)}}));
		expect(called.kind === "called" ? called.heard.map((h) => h.value) : called).toEqual(
			numbers(3 * CAPACITY),
		);
	});

	it("an offer waiting when the run stops is let go with stopped; one waiting when the starter closes the input was in line before the close, and is read", async () => {
		const got: number[] = [];
		const words = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const a = yield* start(late(go, got), {});
				const b = yield* start(stuck, {});
				if (a.kind !== "running" || b.kind !== "running") return null;
				for (const run of [a.run, b.run])
					for (const n of numbers(CAPACITY)) yield* tell(run, "n", n);
				const closing = yield* Effect.forkChild(offer(a.run, "n", -1));
				const stopping = yield* Effect.forkChild(offer(b.run, "n", -1));
				yield* Effect.sleep("10 millis");
				yield* b.stop;
				a.close("n");
				yield* Deferred.succeed(go, undefined);
				const told = [
					yield* Fiber.join(closing),
					yield* Fiber.join(stopping),
					yield* tell(a.run, "n", 0),
				];
				// `main` reads one value per pull (experiment 80): wait for it to read the rest before the scope stops it.
				yield* a.run.ended;
				return told;
			}).pipe(Effect.scoped),
		);
		expect(words).toEqual(["queued", "stopped", "closed"]);
		expect(got).toEqual([...numbers(CAPACITY), -1]);
	});

	it("queues() names the writers waiting on a full line, and not a tell that failed Full; they go once room comes", async () => {
		const got: number[] = [];
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const started = yield* start(late(go, got), {});
				if (started.kind !== "running") return null;
				const empty = started.run.queues();
				for (const n of numbers(CAPACITY)) yield* tell(started.run, "n", n);
				const word = yield* tell(started.run, "n", -1).pipe(
					Effect.catchTag("Full", (full) => Effect.succeed(full._tag)),
				);
				const told = started.run.queues();
				const two = yield* Effect.forkChild(
					Effect.forEach([-2, -3], (n) => offer(started.run, "n", n), {concurrency: 2}),
				);
				yield* Effect.sleep("10 millis");
				const asleep = started.run.queues();
				yield* Deferred.succeed(go, undefined);
				yield* Fiber.join(two);
				started.close("n");
				yield* started.run.ended;
				return {empty, word, told, asleep, after: started.run.queues()};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			empty: {n: {length: 0, waiting: 0}},
			word: "Full",
			told: {n: {length: CAPACITY, waiting: 0}},
			asleep: {n: {length: CAPACITY, waiting: 2}},
			after: {n: {length: 0, waiting: 0}},
		});
		expect(got.length).toBe(CAPACITY + 2);
	});
});

describe("an input's own capacity, declared where the program declares it", () => {
	const small = defineProgram({
		name: "small",
		description: "Never reads its input, which holds 16.",
		inputs: {n: input(Schema.Int, "A number.", {capacity: 16})},
		outputs: {},
		main: () => Effect.never,
	});

	it("takes 16 unread tells, and fails the 17th with Full, which names the input and its capacity", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(small, {});
				if (started.kind !== "running") return null;
				const words = yield* Effect.forEach(numbers(16), (n) => tell(started.run, "n", n), {
					concurrency: 1,
				});
				const seventeenth = yield* Effect.flip(tell(started.run, "n", 16));
				return {words: [...new Set(words)], seventeenth, queues: started.run.queues()};
			}).pipe(Effect.scoped),
		);
		expect(seen?.words).toEqual(["queued"]);
		expect(seen?.seventeenth).toBeInstanceOf(Full);
		expect(seen?.seventeenth).toMatchObject({_tag: "Full", input: "n", capacity: 16});
		expect(seen?.queues).toEqual({n: {length: 16, waiting: 0}});
	});

	it("a Full nobody catches fails the caller, and its type says so", async () => {
		const caller = Effect.gen(function* () {
			const started = yield* start(small, {});
			if (started.kind !== "running") return "not started";
			for (const n of numbers(17)) yield* tell(started.run, "n", n);
			return "all told";
		}).pipe(Effect.scoped);
		expectTypeOf(caller).toEqualTypeOf<Effect.Effect<"not started" | "all told", Full>>();
		const exit = await Effect.runPromiseExit(caller);
		expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value).toMatchObject({
			_tag: "Full",
			input: "n",
			capacity: 16,
		});
	});

	it("offer still waits for room on a full line of 16, then is read once the reader starts", async () => {
		const got: number[] = [];
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const started = yield* start(late(go, got, 16), {});
				if (started.kind !== "running") return null;
				for (const n of numbers(16)) yield* tell(started.run, "n", n);
				const offering = yield* Effect.forkChild(offer(started.run, "n", 16));
				yield* Effect.sleep("10 millis");
				const asleep = started.run.queues();
				yield* Deferred.succeed(go, undefined);
				const word: Word = yield* Fiber.join(offering);
				started.close("n");
				return {asleep, word, ended: yield* started.run.ended};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			asleep: {n: {length: 16, waiting: 1}},
			word: "queued",
			ended: {kind: "ended", unread: {}},
		});
		expect(got).toEqual(numbers(17));
	});

	it.each([0, 2.5, -1, Number.NaN])(
		"a capacity of %s is refused where the input is declared, and past the types where the program is",
		(capacity) => {
			expect(() => input(Schema.Int, "A number.", {capacity})).toThrow(
				/an input's capacity is a whole number, 1 or more/,
			);
			const n = {...input(Schema.Int, "A number."), capacity};
			expect(() =>
				defineProgram({
					name: "bad",
					description: "Holds a capacity no line can.",
					inputs: {n},
					outputs: {},
					main: () => Effect.void,
				}),
			).toThrow(/an input's capacity is a whole number, 1 or more/);
		},
	);
});
