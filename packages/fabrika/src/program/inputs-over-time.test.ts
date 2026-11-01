import {setFlagsFromString} from "node:v8";
import {runInNewContext} from "node:vm";
import {describe, expect, it} from "@effect/vitest";
import {Cause, Deferred, Effect, Exit, Fiber, Schema} from "effect";
import {expectTypeOf} from "vitest";
import {call, defineProgram, MailboxFull, offer, pipe, start, tell, type Word} from "./program.ts";
import {CAPACITY, flag, input, output} from "./shape.ts";
import {memoryStorage, type Storage} from "./storage.ts";

// Experiment 79: what a program's inputs do over time. A value or a flag
// kept by an earlier start meets today's shapes at the next one (row 6 of
// the #657 harvest), and a mailbox nobody reads fills (row 11). Since
// 2026-10-30 a run has one mailbox for all its inputs, so the flood laws
// below are said for the mailbox, across inputs, not for one input's line.

const why = (ended: {readonly kind: string; readonly cause?: Cause.Cause<unknown>} | null) =>
	ended?.cause === undefined ? "" : String(Cause.squash(ended.cause));

const Lower = Schema.String.check(Schema.isPattern(/^[a-z]+$/));

/** Reads every number, in order, once `go` is done. Its mailbox holds `capacity` unread. */
const late = (go: Deferred.Deferred<void>, got: number[], capacity = CAPACITY) =>
	defineProgram({
		name: "late",
		description: "Reads its numbers once it is let go.",
		capacity,
		inputs: {n: input(Schema.Int, "A number.")},
		outputs: {},
		main: ({serve}) =>
			Deferred.await(go).pipe(Effect.andThen(serve({n: (n) => Effect.sync(() => got.push(n))}))),
	});
const numbers = (count: number) => Array.from({length: count}, (_, i) => i);

/** Sends on each line it is told. */
const relay = defineProgram({
	name: "relay",
	description: "Sends on each line it is told.",
	inputs: {line: input(Schema.String, "A line.")},
	outputs: {out: output(Schema.String, "The same line.")},
	main: ({serve, send}) => serve({line: (line) => send("out", line)}),
});

/** Takes lines and never acks them, so each one stays in its sender's outbox. */
const holder = (shape: Schema.Codec<string, string>, got: string[]) =>
	defineProgram({
		name: "holder",
		description: "Takes lines and never acks them.",
		inputs: {line: input(shape, "A line.", {ack: "manual"})},
		outputs: {},
		main: ({serve}) => serve({line: ({value}) => Effect.sync(() => got.push(value))}),
	});

/** One start of `relay | holder`, under the run id `relay:1`: tell `told`, wait until `holder` has `expect` lines, then stop both. */
const once = (
	disk: Storage,
	shape: Schema.Codec<string, string>,
	told: readonly string[],
	expected = told.length,
) =>
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
	}).pipe(Effect.scoped);

describe("a value kept in an outbox meets a stricter input at the next start (row 6)", () => {
	it.live(
		"moves to the run's dead letters with why; the rest are sent again, the sender runs on, and no later start sends it again",
		() =>
			Effect.gen(function* () {
				const disk = memoryStorage();
				const first = yield* once(disk, Schema.String, ["Abc", "abc"]);
				expect(first).toEqual({got: ["Abc", "abc"], ended: null});

				// Before experiment 79 this start failed before main ("answered bad_shape"), and so did every start after.
				const second = yield* once(disk, Lower, ["xyz"], 2);
				expect(second).toEqual({got: ["abc", "xyz"], ended: null});
				const third = yield* once(disk, Lower, [], 2);
				expect(third?.got).toEqual(["abc", "xyz"]);

				const record = yield* disk.record("relay:1");
				expect(record?.deadLetters).toEqual([
					{output: "out", n: 0, value: "Abc", why: expect.stringMatching(/\[a-z\]/)},
				]);
			}),
	);

	it.live(
		"a value that does not fit when it is first sent still fails the sender: that is the sender's bug, not a change over time",
		() =>
			Effect.gen(function* () {
				const sent = yield* once(memoryStorage(), Lower, ["Abc"], 0);
				expect(why(sent?.ended ?? null)).toMatch(
					/relay sent out down a pipe that answered bad_shape/,
				);
			}),
	);
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

describe("a mailbox nobody reads (row 11)", () => {
	/** Two inputs, one mailbox, and nobody reads it. */
	const stuck = defineProgram({
		name: "stuck",
		description: "Never reads its inputs.",
		inputs: {n: input(Schema.Int, "A number."), m: input(Schema.Int, "Another number.")},
		outputs: {},
		main: () => Effect.never,
	});

	it("a host's tells fail MailboxFull past 1000 values main has not read, across both inputs, at once; nothing over it is kept", async () => {
		expect(CAPACITY).toBe(1000);
		expect(stuck.capacity).toBe(1000);
		setFlagsFromString("--expose-gc");
		const gc: () => void = runInNewContext("gc");
		const heap = () => {
			gc();
			return process.memoryUsage().heapUsed;
		};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(stuck, {});
				if (started.kind !== "running") return null;
				const counts: Record<string, number> = {};
				const tellOne = (i: number) =>
					tell(started.run, i % 2 === 0 ? "n" : "m", i).pipe(
						Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
						Effect.tap((word) =>
							Effect.sync(() => {
								counts[word] = (counts[word] ?? 0) + 1;
							}),
						),
					);
				for (let i = 0; i < 1000; i++) yield* tellOne(i);
				const full = heap();
				for (let i = 1000; i < 100_000; i++) yield* tellOne(i);
				const grewMB = (heap() - full) / 1e6;
				return {counts, mailbox: started.run.mailbox(), grewMB};
			}).pipe(Effect.scoped),
		);
		// Before experiment 79: {queued: 100_000}, about 31 MB held (experiments/79-flood.ts). Before
		// 2026-10-30 each input held its own 1000, so two inputs held 2000.
		expect(seen?.counts).toEqual({queued: 1000, MailboxFull: 100_000 - 1000});
		expect(seen?.mailbox).toEqual({
			length: 1000,
			inputs: {n: {length: 500, waiting: 0}, m: {length: 500, waiting: 0}},
		});
		// Flat: 99,000 more tells keep nothing. Each kept value, its letter and its count, would be
		// about a hundred bytes: some 10 MB in all.
		expect(seen?.grewMB).toBeLessThan(5);
	});

	it.live(
		"offer waits for room: three mailboxes' worth to a reader that starts late all arrive, once and in order",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const seen = yield* Effect.gen(function* () {
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
				}).pipe(Effect.scoped);
				expect(seen).toEqual({waiting: 0, words: ["queued"], ended: {kind: "ended", unread: {}}});
				expect(got).toEqual(numbers(3 * CAPACITY));
			}),
	);

	it.live(
		"the pipe law: a pipe into an input that does not ack waits on a full mailbox instead of breaking",
		() =>
			Effect.gen(function* () {
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
				const seen = yield* Effect.gen(function* () {
					const go = yield* Deferred.make<void>();
					const target = yield* start(late(go, got), {});
					if (target.kind !== "running") return null;
					const source = yield* pipe(
						{program: counts, flags: {to: 3 * CAPACITY}},
						"n",
						target,
						"n",
					);
					if (source.kind !== "running") return null;
					// The source fills the mailbox at its own pace, and the next writer then waits on it.
					const isFull = () => {
						const {length, inputs} = target.run.mailbox();
						return length === CAPACITY && inputs.n?.waiting === 1;
					};
					while (!isFull()) yield* Effect.sleep("1 millis");
					const full = target.run.mailbox();
					yield* Deferred.succeed(go, undefined);
					return {full, from: yield* source.run.ended, to: yield* target.run.ended};
				}).pipe(Effect.scoped);
				expect(seen).toEqual({
					full: {length: CAPACITY, inputs: {n: {length: CAPACITY, waiting: 1}}},
					from: {kind: "ended", unread: {}},
					to: {kind: "ended", unread: {}},
				});
				expect(got).toEqual(numbers(3 * CAPACITY));
			}),
	);

	it("call tells more than a mailbox holds, and every value is heard", async () => {
		const echo = defineProgram({
			name: "echo",
			description: "Says back each number.",
			inputs: {n: input(Schema.Int, "A number.")},
			outputs: {said: output(Schema.Int, "The same number.")},
			main: ({serve, send}) => serve({n: (n) => send("said", n)}),
		});
		const called = await Effect.runPromise(call(echo, {}, {told: {n: numbers(3 * CAPACITY)}}));
		expect(called.kind === "called" ? called.heard.map((h) => h.value) : called).toEqual(
			numbers(3 * CAPACITY),
		);
	});

	it.live(
		"an offer waiting when the run stops is let go with stopped; one waiting when the starter closes the input was in line before the close, and is read",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const words = yield* Effect.gen(function* () {
					const go = yield* Deferred.make<void>();
					const a = yield* start(late(go, got), {});
					const b = yield* start(stuck, {});
					if (a.kind !== "running" || b.kind !== "running") return null;
					for (const n of numbers(CAPACITY)) yield* tell(a.run, "n", n);
					for (const n of numbers(CAPACITY)) yield* tell(b.run, "n", n);
					const closing = yield* Effect.forkChild(offer(a.run, "n", -1));
					const stopping = yield* Effect.forkChild(offer(b.run, "m", -1));
					yield* Effect.sleep("10 millis");
					yield* b.stop;
					a.close("n");
					yield* Deferred.succeed(go, undefined);
					const told = [
						yield* Fiber.join(closing),
						yield* Fiber.join(stopping),
						yield* tell(a.run, "n", 0),
					];
					yield* a.run.ended;
					return told;
				}).pipe(Effect.scoped);
				expect(words).toEqual(["queued", "stopped", "closed"]);
				expect(got).toEqual([...numbers(CAPACITY), -1]);
			}),
	);

	it.live(
		"mailbox() names the writers waiting on a full mailbox, by the input they wait on, and not a tell that failed MailboxFull; they go once room comes",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const seen = yield* Effect.gen(function* () {
					const go = yield* Deferred.make<void>();
					const started = yield* start(late(go, got), {});
					if (started.kind !== "running") return null;
					const empty = started.run.mailbox();
					for (const n of numbers(CAPACITY)) yield* tell(started.run, "n", n);
					const word = yield* tell(started.run, "n", -1).pipe(
						Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
					);
					const told = started.run.mailbox();
					const two = yield* Effect.forkChild(
						Effect.forEach([-2, -3], (n) => offer(started.run, "n", n), {concurrency: 2}),
					);
					yield* Effect.sleep("10 millis");
					const asleep = started.run.mailbox();
					yield* Deferred.succeed(go, undefined);
					yield* Fiber.join(two);
					started.close("n");
					yield* started.run.ended;
					return {empty, word, told, asleep, after: started.run.mailbox()};
				}).pipe(Effect.scoped);
				expect(seen).toEqual({
					empty: {length: 0, inputs: {n: {length: 0, waiting: 0}}},
					word: "MailboxFull",
					told: {length: CAPACITY, inputs: {n: {length: CAPACITY, waiting: 0}}},
					asleep: {length: CAPACITY, inputs: {n: {length: CAPACITY, waiting: 2}}},
					after: {length: 0, inputs: {n: {length: 0, waiting: 0}}},
				});
				expect(got.length).toBe(CAPACITY + 2);
			}),
	);

	it("a tell never passes an offer already waiting: with a writer asleep on m, a tell to n fails MailboxFull", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(stuck, {});
				if (started.kind !== "running") return null;
				for (const n of numbers(CAPACITY)) yield* tell(started.run, "n", n);
				yield* Effect.forkChild(offer(started.run, "m", -1));
				yield* Effect.yieldNow;
				return yield* Effect.flip(tell(started.run, "n", -2));
			}).pipe(Effect.scoped),
		);
		expect(seen).toMatchObject({_tag: "MailboxFull", input: "n", capacity: CAPACITY});
	});
});

describe("a program's own capacity, declared where the program declares it", () => {
	const small = defineProgram({
		name: "small",
		description: "Never reads its two inputs, whose mailbox holds 16.",
		capacity: 16,
		inputs: {n: input(Schema.Int, "A number."), m: input(Schema.Int, "Another number.")},
		outputs: {},
		main: () => Effect.never,
	});

	it("takes 16 unread tells across its inputs, and fails the 17th with MailboxFull, which names the input told and the capacity", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(small, {});
				if (started.kind !== "running") return null;
				const words = yield* Effect.forEach(
					numbers(16),
					(n) => tell(started.run, n < 8 ? "n" : "m", n),
					{concurrency: 1},
				);
				const seventeenth = yield* Effect.flip(tell(started.run, "m", 16));
				return {words: [...new Set(words)], seventeenth, mailbox: started.run.mailbox()};
			}).pipe(Effect.scoped),
		);
		expect(seen?.words).toEqual(["queued"]);
		expect(seen?.seventeenth).toBeInstanceOf(MailboxFull);
		expect(seen?.seventeenth).toMatchObject({_tag: "MailboxFull", input: "m", capacity: 16});
		expect(seen?.mailbox).toEqual({
			length: 16,
			inputs: {n: {length: 8, waiting: 0}, m: {length: 8, waiting: 0}},
		});
	});

	it("a MailboxFull nobody catches fails the caller, and its type says so", async () => {
		const caller = Effect.gen(function* () {
			const started = yield* start(small, {});
			if (started.kind !== "running") return "not started";
			for (const n of numbers(17)) yield* tell(started.run, "n", n);
			return "all told";
		}).pipe(Effect.scoped);
		expectTypeOf(caller).toEqualTypeOf<Effect.Effect<"not started" | "all told", MailboxFull>>();
		const exit = await Effect.runPromiseExit(caller);
		expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value).toMatchObject({
			_tag: "MailboxFull",
			input: "n",
			capacity: 16,
		});
	});

	it.live(
		"offer still waits for room on a full mailbox of 16, then is read once the reader starts",
		() =>
			Effect.gen(function* () {
				const got: number[] = [];
				const seen = yield* Effect.gen(function* () {
					const go = yield* Deferred.make<void>();
					const started = yield* start(late(go, got, 16), {});
					if (started.kind !== "running") return null;
					for (const n of numbers(16)) yield* tell(started.run, "n", n);
					const offering = yield* Effect.forkChild(offer(started.run, "n", 16));
					yield* Effect.sleep("10 millis");
					const asleep = started.run.mailbox();
					yield* Deferred.succeed(go, undefined);
					const word: Word = yield* Fiber.join(offering);
					started.close("n");
					return {asleep, word, ended: yield* started.run.ended};
				}).pipe(Effect.scoped);
				expect(seen).toEqual({
					asleep: {length: 16, inputs: {n: {length: 16, waiting: 1}}},
					word: "queued",
					ended: {kind: "ended", unread: {}},
				});
				expect(got).toEqual(numbers(17));
			}),
	);

	it.each([0, 2.5, -1, Number.NaN])(
		"a capacity of %s is refused where the program is defined",
		(capacity) => {
			expect(() =>
				defineProgram({
					name: "bad",
					description: "Holds a capacity no mailbox can.",
					capacity,
					inputs: {n: input(Schema.Int, "A number.")},
					outputs: {},
					main: () => Effect.void,
				}),
			).toThrow(/a mailbox's capacity is a whole number, 1 or more/);
		},
	);
});
