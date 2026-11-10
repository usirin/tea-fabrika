import {memoryStorage, readInput, start} from "@kampus/fabrika-old";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {Tickets} from "@kampus/pipeline/tickets/tickets";
import {OWNER, SEVEN, SEVEN_TITLE} from "@tea-fabrika/tracker/seven";
import {Duration, Effect, Layer, Ref} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {trace} from "./index.ts";
import {memoryTraces} from "./memory.ts";

// The trace program's `ticket` flag and input, and how often it reads a ticket's facts (ticket
// 141). Today's version. The owner's answer 6: no `Tickets.watch` exists, so the facts are read
// again every 1 s, every 5 s once 5 reads in a row changed nothing, and every 1 s again once one
// does. On Effect's TestClock, with a `Tickets` that counts its reads.
//
// The flag goes in as a value, not a literal, because today's program has no `ticket` flag: the
// test compiles before it is built, and the program ignores the key until it is.

/** A `Tickets` that serves ticket 7 as `facts` holds it, and counts each read and its number. */
const counting = (facts: Ref.Ref<readonly Entry[]>, reads: Ref.Ref<readonly number[]>) =>
	Layer.succeed(
		Tickets,
		Tickets.of({
			read: (n) =>
				Effect.gen(function* () {
					yield* Ref.update(reads, (all) => [...all, n]);
					return {number: n, title: SEVEN_TITLE, state: "open", timeline: yield* Ref.get(facts)};
				}),
			write: () => Effect.die("the trace program never writes a fact"),
			talk: () => Effect.die("the trace program never talks on a ticket"),
		}),
	);

/** Let the clock run `ms`, a second at a time, so each wakeup in between runs. */
const pass = (ms: number) =>
	Effect.gen(function* () {
		for (let left = ms; left > 0; left -= 1_000) {
			yield* TestClock.adjust(Math.min(1_000, left));
		}
	});

describe("the trace program on a ticket", () => {
	it("reads the facts every 1 s, every 5 s once nothing changed for 5 reads, and every 1 s once they change", async () => {
		const got = await Effect.runPromise(
			Effect.gen(function* () {
				const facts = yield* Ref.make<readonly Entry[]>(SEVEN);
				const reads = yield* Ref.make<readonly number[]>([]);
				const flags = {id: undefined, ticket: 7};
				const started = yield* start(
					trace,
					flags,
					{},
					{id: "trace:test", storage: memoryStorage()},
				).pipe(Effect.provide(Layer.merge(counting(facts, reads), memoryTraces([]))));

				if (started.kind !== "running") {
					return yield* Effect.die("the trace program did not start");
				}

				const count = Effect.map(Ref.get(reads), (all) => all.length);
				yield* pass(3_000);
				const early = yield* count;
				yield* pass(60_000);
				const settled = (yield* count) - early;
				// A comment lands: the next read sees it, and the reads come every second again.
				yield* Ref.update(facts, (tl): readonly Entry[] => [
					...tl,
					{
						pos: tl.length + 1,
						ticket: 7,
						by: OWNER,
						at: (tl.at(-1)?.at ?? 0) + 1,
						fact: {type: "commented", body: "Still on it."},
					},
				]);
				yield* pass(Duration.toMillis(Duration.seconds(5)));
				const seen = yield* count;
				yield* pass(3_000);
				const again = (yield* count) - seen;
				return {early, settled, again, numbers: new Set(yield* Ref.get(reads))};
			}).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
		);
		// At 1 s: a read at once, then one a second.
		expect(got.early).toBeGreaterThanOrEqual(3);
		// At 5 s after the first few: about 12 in a minute, never 60, and never none.
		expect(got.settled).toBeGreaterThanOrEqual(11);
		expect(got.settled).toBeLessThanOrEqual(18);
		// Back at 1 s once a read saw the change.
		expect(got.again).toBeGreaterThanOrEqual(2);
		expect([...got.numbers]).toEqual([7]);
	});

	it("takes a ticket on its `ticket` input, by its number, and nothing else there", () => {
		expect(readInput(trace, {type: "ticket", value: 7}).kind).toBe("read");
		expect(readInput(trace, {type: "ticket", value: "7"}).kind).toBe("refused");
		expect(readInput(trace, {type: "ticket", value: -1}).kind).toBe("refused");
	});
});
