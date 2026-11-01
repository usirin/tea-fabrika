import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Layer, Option, Stream} from "effect";
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
