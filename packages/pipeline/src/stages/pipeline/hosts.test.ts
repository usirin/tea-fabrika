import {Ledger, streams} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Clock, Effect, Fiber, Layer, Option, Stream} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import {hashOf, textOf} from "../../tickets/approval.ts";
import {nameOf} from "../../tickets/ticket.ts";
import {Tickets, ticketsOnLedger} from "../../tickets/tickets.ts";
import {answerHeard} from "./hosts.ts";

// Today's version. A person's answer, as the lane listens for it, on the real tickets over a ledger
// in memory: an answer counts only for a question the ticket holds.

const NUMBER = 1;
const OWNER = "user:owner";
const ASK = "a-step-9";

const on = <A, E>(effect: Effect.Effect<A, E, Tickets | Ledger>) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(ticketsOnLedger({kind: "agent", id: "lane", for: "owner"})),
			Effect.provide(Layer.fresh(memoryLedger().layer)),
		),
	);

const filed = Effect.gen(function* () {
	const ledger = yield* Ledger;
	yield* ledger.register(nameOf(NUMBER), OWNER);
	yield* ledger.send(streams(nameOf(NUMBER)).inbox, "file", {
		kind: "filed",
		writer: OWNER,
		data: {type: "filed", title: "A change", body: "It changes one thing."},
	});
});

const asked = Effect.gen(function* () {
	yield* (yield* Tickets).write(NUMBER, ASK, {
		type: "asked",
		ask: ASK,
		what: "Does it go on?",
		picks: ["again", "stop"],
	});
});

const answered = (writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const ticket = yield* (yield* Tickets).read(NUMBER);
		yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${writer}`, {
			kind: "answered",
			writer,
			data: {
				type: "answered",
				ask: ASK,
				pick: "stop",
				note: "",
				text: yield* hashOf(textOf(ticket)),
			},
		});
	});

/** What the lane hears inside two looks, the first at once and the next a second on. */
const heard = answerHeard(NUMBER, ASK, ["again", "stop"]).pipe(
	Stream.runHead,
	Effect.timeoutOption("1500 millis"),
	Effect.map(Option.flatten),
	Effect.map(Option.getOrNull),
);

describe("a person's answer, as the lane hears it", () => {
	it("an answer to a question on the ticket is heard", async () => {
		const got = await on(
			Effect.gen(function* () {
				yield* filed;
				yield* asked;
				yield* answered(OWNER);
				return yield* heard;
			}),
		);
		expect(got).toEqual({ask: ASK, pick: "stop", note: ""});
	});

	it(
		"an answer under an id no question on the ticket holds is not heard",
		{timeout: 5_000},
		async () => {
			const got = await on(
				Effect.gen(function* () {
					yield* filed;
					yield* answered(OWNER);
					return yield* heard;
				}),
			);
			expect(got).toBeNull();
		},
	);

	it(
		"an answer written before its question does not count once the question comes",
		{timeout: 5_000},
		async () => {
			const got = await on(
				Effect.gen(function* () {
					yield* filed;
					yield* answered(OWNER);
					yield* asked;
					return yield* heard;
				}),
			);
			expect(got).toBeNull();
		},
	);
});

// The wait, on a clock the test owns: a ledger that can watch rings the lane awake when the answer
// lands, with no second passing; one that cannot is still looked at again a second on.

/** The ledger as memory keeps it, with its own doorbell. */
const watching = Layer.effect(
	Ledger,
	Effect.sync(() => memoryService()),
);

/**
 * The same ledger, with a doorbell that never rings or that ends at once: nothing to wake on. `reads`
 * counts every stream read, so a wait that spins on a doorbell that ended shows.
 */
const deaf = (watch: () => Stream.Stream<void>) => {
	const reads = {count: 0};
	const layer = Layer.effect(
		Ledger,
		Effect.sync(() => {
			const ledger = memoryService();
			return {
				...ledger,
				watch,
				readStream: (stream: string, fromRev?: number, limit?: number) =>
					Effect.andThen(
						Effect.sync(() => void reads.count++),
						ledger.readStream(stream, fromRev, limit),
					),
			};
		}),
	);
	return {layer, reads};
};

const onClock = <A, E>(
	ledger: Layer.Layer<Ledger>,
	effect: Effect.Effect<A, E, Tickets | Ledger>,
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(ticketsOnLedger({kind: "agent", id: "lane", for: "owner"})),
			Effect.provide(ledger),
			Effect.provide(TestClock.layer({warningDelay: "1 minute"})),
		),
	);

/**
 * The lane listens from before the answer: its first look finds nothing. The answer lands, `moved`
 * runs on the test's clock, and the lane gets a short real time to hear it. `null`: it did not.
 */
const heardAfter = (moved: Effect.Effect<void>) =>
	Effect.gen(function* () {
		yield* filed;
		yield* asked;
		const listening = yield* answerHeard(NUMBER, ASK, ["again", "stop"]).pipe(
			Stream.runHead,
			Effect.forkChild,
		);
		yield* TestClock.withLive(Effect.sleep("50 millis"));
		expect(listening.pollUnsafe()).toBeUndefined();
		yield* answered(OWNER);
		yield* moved;
		const got = yield* Fiber.join(listening).pipe(
			Effect.timeoutOption("2 seconds"),
			TestClock.withLive,
			Effect.map(Option.flatten),
			Effect.map(Option.getOrNull),
		);
		return {got, at: yield* Clock.currentTimeMillis};
	});

describe("the wait for a person's answer, on a clock the test owns", () => {
	it("a ledger that can watch wakes the lane when the answer lands, with no second passing", async () => {
		const {got, at} = await onClock(watching, heardAfter(Effect.void));
		expect(got).toEqual({ask: ASK, pick: "stop", note: ""});
		expect(at).toBe(0);
	});

	it.each([
		["never rings", () => Stream.never],
		["ends at once", () => Stream.empty],
	])(
		"a ledger whose doorbell %s still hears the answer on the look a second on",
		async (_name, watch) => {
			const ledger = deaf(watch);
			const {got, at} = await onClock(ledger.layer, heardAfter(TestClock.adjust("1 second")));
			expect(got).toEqual({ask: ASK, pick: "stop", note: ""});
			expect(at).toBe(1_000);
			// Two looks and the answer's own read of the ticket, give or take: not a loop with no pause.
			expect(ledger.reads.count).toBeLessThan(10);
		},
	);
});
