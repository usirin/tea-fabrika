import {Ledger, streams, type Writer} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import type {Check, CodeFact} from "./ticket.ts";
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

/** Run `program` on both Layers, and give both answers. */
const onBoth = <A, E>(program: Effect.Effect<A, E, Tickets>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const {layer} = yield* onLedger;
			return {
				ledger: yield* program.pipe(Effect.provide(layer)),
				memory: yield* program.pipe(Effect.provide(ticketsInMemory(lane, [filed]))),
			};
		}),
	);

/** Write `started` twice under one key, read the ticket, and try a ticket nobody filed. */
const drive = Effect.gen(function* () {
	const tickets = yield* Tickets;
	yield* tickets.write(1, "r-1/started", started);
	yield* tickets.write(1, "r-1/started", started);
	const ticket = yield* tickets.read(1);
	const missing = yield* Effect.flip(tickets.read(2));
	const nowhere = yield* Effect.flip(tickets.write(2, "r-1/started", started));
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

/** The watcher's `pr` fact at one head, with CI in one state. */
const pr = (ci: Check): CodeFact => ({
	type: "pr",
	url: "https://github.com/o/r/pull/7",
	state: "open",
	head: "abc1234",
	checks: [ci],
});
const queued = pr({name: "ci", status: "queued", conclusion: null});
const failure = pr({name: "ci", status: "completed", conclusion: "failure"});
const success = pr({name: "ci", status: "completed", conclusion: "success"});

describe("Tickets", () => {
	it("on the ledger: writes as the host's writer, once per key, and reads the ticket back", async () => {
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

	it("keeps a fact that reads the same as an earlier one: CI re-run at one head ends red", async () => {
		// queued, failure, queued, success, failure: the second queued and the second failure equal
		// earlier facts. Each is its own step, so each lands, and the last one says red.
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const steps = [queued, failure, queued, success, failure];
				for (const [i, fact] of steps.entries()) yield* tickets.write(1, `watch/${i + 1}`, fact);
				const ticket = yield* tickets.read(1);
				return ticket.timeline.flatMap((e) =>
					e.fact.type === "pr" ? e.fact.checks.map((c) => c.conclusion ?? c.status) : [],
				);
			}),
		);
		const sequence = ["queued", "failure", "queued", "success", "failure"];
		expect(seen).toEqual({ledger: sequence, memory: sequence});
	});

	it("lands a retry under the same key once", async () => {
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				yield* tickets.write(1, "watch/1", failure);
				yield* tickets.write(1, "watch/1", failure);
				return (yield* tickets.read(1)).timeline.filter((e) => e.fact.type === "pr").length;
			}),
		);
		expect(seen).toEqual({ledger: 1, memory: 1});
	});

	it("refuses a person's `answered` cast past the type, as `not_yours`", async () => {
		const answer = {type: "answered", ask: "a-1", pick: "approve", note: ""};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const refused = yield* Effect.flip(
					// biome-ignore lint/plugin: the test plays a caller that lies to the compiler, to show the run-time check holds
					tickets.write(1, "r-1/answer", answer as unknown as CodeFact),
				);
				const kinds = (yield* tickets.read(1)).timeline.map((e) => e.fact.type);
				return {why: refused.why, kinds};
			}),
		);
		const expectedRefusal = {why: "not_yours", kinds: ["filed"]};
		expect(seen).toEqual({ledger: expectedRefusal, memory: expectedRefusal});
	});

	it("fails a fact that does not fit its schema as `bad_fact`, not a crash", async () => {
		const asked: CodeFact = {type: "asked", ask: "a-1", what: "Ship it?\nNow?", picks: ["yes"]};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const failed = yield* Effect.flip(tickets.write(1, "r-1/ask", asked));
				const kinds = (yield* tickets.read(1)).timeline.map((e) => e.fact.type);
				return {why: failed.why, kinds};
			}),
		);
		const expectedFailure = {why: "bad_fact", kinds: ["filed"]};
		expect(seen).toEqual({ledger: expectedFailure, memory: expectedFailure});
	});
});
