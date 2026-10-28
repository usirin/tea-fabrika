import {Ledger, streams, type Writer} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import type {CodeFact} from "./ticket.ts";
import {type Seeded, Tickets, ticketsInMemory, ticketsOnLedger} from "./tickets.ts";

// The service a lane reads and writes tickets through, on both its Layers: the same answers on a
// ledger and in memory.

const owner: Writer = {kind: "user", id: "owner"};
const lane: Writer = {kind: "agent", id: "lane", for: "owner"};

const started: CodeFact = {type: "started", run: "r-1", stage: "triage", task: null, log: null};
const filed: Seeded = {ticket: 1, by: owner, fact: {type: "filed", title: "Login fails", body: ""}};

/** The ledger Layer on a ledger in memory, with ticket 1 filed by its owner. */
const onLedger = Effect.gen(function* () {
	const ledger = memoryService();
	yield* ledger.register("tracker/ticket/1", "user:owner");
	yield* ledger.send(streams("tracker/ticket/1").inbox, "w1", {
		kind: "filed",
		writer: "user:owner",
		data: filed.fact,
	});
	return {ledger, layer: ticketsOnLedger(lane).pipe(Layer.provide(Layer.succeed(Ledger, ledger)))};
});

/** Write `started` twice, read the ticket, and try a ticket nobody filed. */
const drive = Effect.gen(function* () {
	const tickets = yield* Tickets;
	yield* tickets.write(1, started);
	yield* tickets.write(1, started);
	const ticket = yield* tickets.read(1);
	const missing = yield* Effect.flip(tickets.read(2));
	const nowhere = yield* Effect.flip(tickets.write(2, started));
	return {
		timeline: ticket.timeline.map((e) => [e.by, e.fact.type]),
		missing: missing.why,
		nowhere: nowhere.why,
	};
});

const expected = {
	timeline: [
		[owner, "filed"],
		[lane, "started"],
	],
	missing: "no_ticket",
	nowhere: "no_ticket",
};

describe("Tickets", () => {
	it("on the ledger: writes as the host's writer, once per fact, and reads the ticket back", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {ledger, layer} = yield* onLedger;
				const result = yield* drive.pipe(Effect.provide(layer));
				const rows = yield* ledger.readStream(streams("tracker/ticket/1").inbox);
				return {...result, rows: rows.map((r) => [r.kind, r.writer])};
			}),
		);
		expect(seen).toEqual({
			...expected,
			rows: [
				["filed", "user:owner"],
				["started", "agent:lane for:owner"],
			],
		});
	});

	it("in memory: the same answers, with no ledger", async () => {
		const seen = await Effect.runPromise(
			drive.pipe(Effect.provide(ticketsInMemory(lane, [filed]))),
		);
		expect(seen).toEqual(expected);
	});
});
