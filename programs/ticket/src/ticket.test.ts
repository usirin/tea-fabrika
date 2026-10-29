import {Ledger, memoryStorage, offer, start, streams, type Word} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {type CodeFact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {Tickets, ticketsOnLedger} from "@kampus/pipeline/tickets/tickets";
import {Author, pullRequestsOf} from "@tea-fabrika/tracker";
import {LANE, OWNER, SEVEN, SEVEN_BODY, SEVEN_TITLE} from "@tea-fabrika/tracker/seven";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {type Do, ticket, writeOf} from "./index.ts";
import {type Shown, shownOf} from "./view.ts";

// The ticket program with no window, on a ledger in memory that holds ticket 7 as a lane left it.
// Told what its window sends, it writes the tracker's own facts, on ticket 7 only.

/** Ticket 7 on `ledger`: filed by the owner, then the lane's facts through the lane's service. */
const seed = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		yield* ledger.register(nameOf(7), "user:owner");
		yield* ledger.send(streams(nameOf(7)).inbox, "filed", {
			kind: "filed",
			writer: "user:owner",
			data: {type: "filed", title: SEVEN_TITLE, body: SEVEN_BODY},
		});
		const tickets = yield* Tickets;
		for (const e of SEVEN.slice(1)) yield* tickets.write(7, `w/${e.pos}`, e.fact as CodeFact);
	}).pipe(Effect.provide(ticketsOnLedger(LANE)), Effect.provide(Layer.succeed(Ledger, ledger)));

const session = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		const started = yield* start(
			ticket,
			{ticket: 7},
			{},
			{id: "ticket:test", storage: memoryStorage()},
		);
		if (started.kind !== "running") return yield* Effect.die("the ticket program did not start");
		const {run} = started;
		const say = (d: Do): Effect.Effect<Word> => offer(run, "do", d);
		const until = (ok: (shown: Shown) => boolean) =>
			run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(shownOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {run, say, until};
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(Ledger, ledger),
				Layer.succeed(Author, OWNER),
				pullRequestsOf([]),
			),
		),
	);

describe("the ticket program", () => {
	it("shows ticket 7 as its page reads, then approves and asks for changes as the owner", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seed(ledger);
				const {run, say, until} = yield* session(ledger);
				const first = yield* until((s) => s.page !== null);
				yield* say({
					kind: "answer",
					ask: "a-1",
					pick: "approve",
					note: "",
					saw: {title: SEVEN_TITLE, body: SEVEN_BODY},
				});
				yield* say({kind: "comment", body: "Keep the old format too.", asks: "changes"});
				const last = yield* until((s) => (s.page?.opened.ticket.timeline.length ?? 0) === 9);
				yield* say({kind: "quit"});
				return {first, last, ended: (yield* run.ended).kind};
			}).pipe(Effect.scoped),
		);
		const page = seen.first.page;
		expect(page?.opened.ticket.title).toBe(SEVEN_TITLE);
		expect(page?.body).toBe(SEVEN_BODY);
		expect(page?.filed?.by).toEqual(OWNER);
		expect(page?.plan).toEqual({version: 1, tasks: ["t-1", "t-2"]});
		expect(page?.usd).toBeCloseTo(0.49);
		expect(page?.opened.asks.map((a) => a.ask)).toEqual(["a-1"]);
		expect(page?.steps.find((s) => s.state === "you")?.step).toBe("approval");

		const added = seen.last.page?.opened.ticket.timeline.slice(7) ?? [];
		expect(added.map((e) => [e.by, e.fact.type])).toEqual([
			[OWNER, "answered"],
			[OWNER, "commented"],
		]);
		expect(added[0]?.fact).toMatchObject({ask: "a-1", pick: "approve"});
		expect(added[1]?.fact).toMatchObject({body: "Keep the old format too.", asks: "changes"});
		expect(seen.last.page?.opened.asks).toEqual([]);
		expect(seen.ended).toBe("ended");
	});
});

describe("writeOf", () => {
	it("names the flag's ticket on every write, and keeps a plain comment plain", () => {
		expect(writeOf(7, {kind: "comment", body: "Seen."})).toEqual({
			kind: "comment",
			ticket: 7,
			body: "Seen.",
		});
		expect(writeOf(7, {kind: "close"})).toEqual({kind: "close", ticket: 7});
		expect(writeOf(7, {kind: "reopen"})).toEqual({kind: "reopen", ticket: 7});
	});
});
