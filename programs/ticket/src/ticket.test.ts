import {
	Ledger,
	memoryStorage,
	offer,
	type PayloadOf,
	start,
	streams,
	type Word,
} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {type CodeFact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {Tickets, ticketsOnLedger} from "@kampus/pipeline/tickets/tickets";
import {Author, pullRequestsOf} from "@tea-fabrika/tracker";
import {LANE, OWNER, SEVEN, SEVEN_BODY, SEVEN_TITLE} from "@tea-fabrika/tracker/seven";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {ticket, writeOf} from "./index.ts";
import {type Shown, shownOf} from "./view.ts";

/** The ticket program's inputs, by name: what a test tells it. */
type Inputs = (typeof ticket)["inputs"];

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

/** A ticket filed by the owner with nothing after it. */
const file = (ledger: Ledger["Service"], n: number, title: string) =>
	Effect.gen(function* () {
		yield* ledger.register(nameOf(n), "user:owner");
		yield* ledger.send(streams(nameOf(n)).inbox, "filed", {
			kind: "filed",
			writer: "user:owner",
			data: {type: "filed", title, body: ""},
		});
	});

/** A run of the ticket program on `ledger`, started on ticket 7 unless told none. `sent`: what it sent on `ticket`. */
const session = (ledger: Ledger["Service"], flags: {readonly ticket?: number} = {ticket: 7}) =>
	Effect.gen(function* () {
		const sent: number[] = [];
		const started = yield* start(
			ticket,
			{ticket: flags.ticket},
			{ticket: (n) => sent.push(n)},
			{id: "ticket:test", storage: memoryStorage()},
		);
		if (started.kind !== "running") return yield* Effect.die("the ticket program did not start");
		const {run} = started;
		const say = <K extends keyof Inputs & string>(
			input: K,
			value: PayloadOf<Inputs[K]>,
		): Effect.Effect<Word> => offer(run, input, value);
		const pick = (n: number): Effect.Effect<Word> => offer(run, "ticket", n);
		const until = (ok: (shown: Shown) => boolean) =>
			run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(shownOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {run, say, pick, until, sent, close: started.close};
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
				const {run, say, until, sent} = yield* session(ledger);
				const first = yield* until((s) => s.page !== null);
				yield* say("answer", {
					ticket: 7,
					ask: "a-1",
					pick: "approve",
					note: "",
					saw: {title: SEVEN_TITLE, body: SEVEN_BODY},
				});
				yield* say("comment", {ticket: 7, body: "Keep the old format too.", asks: "changes"});
				const last = yield* until((s) => (s.page?.opened.ticket.timeline.length ?? 0) === 9);
				yield* say("quit", null);
				return {first, last, ended: (yield* run.ended).kind, sent};
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
		// Started on 7 by its flag, it sends 7 on, once.
		expect(seen.sent).toEqual([7]);
	});

	it("waits for a ticket with no flag, shows each one a pipe sends, and sends it on once a change", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seed(ledger);
				yield* file(ledger, 3, "Docs typo");
				const {pick, until, sent, say, run} = yield* session(ledger, {});
				const none = yield* until((s) => s.ready);
				yield* pick(7);
				const seven = yield* until((s) => s.page?.opened.ticket.number === 7);
				yield* pick(7);
				yield* pick(3);
				const three = yield* until((s) => s.page?.opened.ticket.number === 3);
				yield* say("quit", null);
				yield* run.ended;
				return {none: none.number, seven: seven.page?.opened.ticket.title, three, sent};
			}).pipe(Effect.scoped),
		);
		expect(seen.none).toBeNull();
		expect(seen.seven).toBe(SEVEN_TITLE);
		expect(seen.three.page?.opened.ticket.title).toBe("Docs typo");
		// 7 twice is one change.
		expect(seen.sent).toEqual([7, 3]);
	});

	it("keeps the last ticket when its input ends, and its window still writes there", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seed(ledger);
				yield* file(ledger, 3, "Docs typo");
				const {pick, until, say, close, run} = yield* session(ledger, {});
				yield* pick(3);
				yield* until((s) => s.page?.opened.ticket.number === 3);
				close("ticket");
				yield* say("comment", {ticket: 3, body: "Still here."});
				const after = yield* until((s) => (s.page?.opened.ticket.timeline.length ?? 0) === 2);
				yield* say("quit", null);
				return {after, ended: (yield* run.ended).kind};
			}).pipe(Effect.scoped),
		);
		expect(seen.after.number).toBe(3);
		expect(seen.after.page?.opened.ticket.timeline.at(-1)?.fact).toMatchObject({
			type: "commented",
			body: "Still here.",
		});
		expect(seen.ended).toBe("ended");
	});

	it("writes a comment made on #7 to #7, though #3 came in after, and none to a ticket it never showed", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seed(ledger);
				yield* file(ledger, 3, "Docs typo");
				yield* file(ledger, 4, "Never shown");
				const {pick, until, say, run} = yield* session(ledger, {});
				yield* pick(7);
				yield* until((s) => s.page?.opened.ticket.number === 7);
				yield* pick(3);
				yield* until((s) => s.page?.opened.ticket.number === 3);
				yield* say("comment", {ticket: 7, body: "Made on seven."});
				yield* say("comment", {ticket: 4, body: "Never shown here."});
				yield* say("comment", {ticket: 3, body: "Made on three."});
				const three = yield* until((s) => (s.page?.opened.ticket.timeline.length ?? 0) === 2);
				yield* pick(7);
				const seven = yield* until(
					(s) =>
						s.page?.opened.ticket.number === 7 && (s.page?.opened.ticket.timeline.length ?? 0) > 7,
				);
				yield* pick(4);
				const four = yield* until((s) => s.page?.opened.ticket.number === 4);
				yield* say("quit", null);
				yield* run.ended;
				return {three, seven, four};
			}).pipe(Effect.scoped),
		);
		const last = (s: Shown) => s.page?.opened.ticket.timeline.at(-1)?.fact;
		expect(last(seen.three)).toMatchObject({type: "commented", body: "Made on three."});
		expect(last(seen.seven)).toMatchObject({type: "commented", body: "Made on seven."});
		expect(seen.four.page?.opened.ticket.timeline.map((e) => e.fact.type)).toEqual(["filed"]);
	});
});

describe("writeOf", () => {
	it("names the ticket the window drew it on, and keeps a plain comment plain", () => {
		const shown = new Set([7]);
		expect(writeOf(shown, {kind: "comment", ticket: 7, body: "Seen."})).toEqual({
			kind: "comment",
			ticket: 7,
			body: "Seen.",
		});
		expect(writeOf(shown, {kind: "close", ticket: 7})).toEqual({kind: "close", ticket: 7});
		expect(writeOf(shown, {kind: "reopen", ticket: 7})).toEqual({kind: "reopen", ticket: 7});
	});

	it("writes nothing to a ticket the run never showed", () => {
		expect(writeOf(new Set([7]), {kind: "close", ticket: 3})).toBeNull();
		expect(writeOf(new Set(), {kind: "comment", ticket: 7, body: "Seen."})).toBeNull();
	});
});
