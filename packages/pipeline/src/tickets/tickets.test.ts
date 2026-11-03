import {Ledger, LedgerUnreachable, streams, UnknownName, type Writer} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Clock, Effect, Fiber, Layer} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import type {Check, CodeFact, PrFact} from "./ticket.ts";
import {
	memoryTickets,
	type Seeded,
	Tickets,
	ticketsInMemory,
	ticketsOnLedger,
	Watcher,
	watcherInMemory,
	watcherOnLedger,
} from "./tickets.ts";

// The services a lane and the PR watcher write tickets through, on both their Layers: the same
// answers on a ledger and in memory.

const owner: Writer = {kind: "user", id: "owner"};
const lane: Writer = {kind: "agent", id: "lane", for: "owner"};
const watcher: Writer = {kind: "agent", id: "pr-watcher", for: "owner"};

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
	const layer = Layer.mergeAll(ticketsOnLedger(lane), watcherOnLedger(watcher));
	return {ledger, layer: layer.pipe(Layer.provide(Layer.succeed(Ledger, ledger)))};
});

/** The memory Layers on one store, with ticket 1 filed by its owner. */
const inMemory = Layer.mergeAll(ticketsInMemory(lane), watcherInMemory(watcher)).pipe(
	Layer.provide(memoryTickets([filed])),
);

/** Run `program` on both Layers, and give both answers. */
const onBoth = <A, E>(program: Effect.Effect<A, E, Tickets | Watcher>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const {layer} = yield* onLedger;
			return {
				ledger: yield* program.pipe(Effect.provide(layer)),
				memory: yield* program.pipe(Effect.provide(inMemory)),
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
const pr = (ci: Check): PrFact => ({
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
		const seen = await Effect.runPromise(drive.pipe(Effect.provide(inMemory)));
		expect(seen).toEqual(expected);
	});

	it("keeps a fact that reads the same as an earlier one: CI re-run at one head ends red", async () => {
		// queued, failure, queued, success, failure: the second queued and the second failure equal
		// earlier facts. Each is its own step, so each lands, and the last one says red.
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const watching = yield* Watcher;
				const steps = [queued, failure, queued, success, failure];
				for (const [i, fact] of steps.entries()) yield* watching.write(1, `watch/${i + 1}`, fact);
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
				const watching = yield* Watcher;
				yield* watching.write(1, "watch/1", failure);
				yield* watching.write(1, "watch/1", failure);
				return (yield* tickets.read(1)).timeline.filter((e) => e.fact.type === "pr").length;
			}),
		);
		expect(seen).toEqual({ledger: 1, memory: 1});
	});

	it("refuses the watcher's `pr` from a lane, cast past the type, as `not_yours`", async () => {
		const merged: PrFact = {...success, state: "merged"};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const refused = yield* Effect.flip(
					// oxlint-disable-next-line fabrika/no-type-assertions -- the test plays a lane that lies to the compiler, to show the run-time check holds
					tickets.write(1, "watch/1", merged as unknown as CodeFact),
				);
				const kinds = (yield* tickets.read(1)).timeline.map((e) => e.fact.type);
				return {why: refused.why, kinds};
			}),
		);
		const expectedRefusal = {why: "not_yours", kinds: ["filed"]};
		expect(seen).toEqual({ledger: expectedRefusal, memory: expectedRefusal});
	});

	it("writes the watcher's `pr` as the watcher, and refuses a lane's fact cast past its type", async () => {
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const watching = yield* Watcher;
				yield* watching.write(1, "watch/1", success);
				const refused = yield* Effect.flip(
					// oxlint-disable-next-line fabrika/no-type-assertions -- the test plays a caller that lies to the compiler, to show the run-time check holds
					watching.write(1, "r-1/started", started as unknown as PrFact),
				);
				const timeline = (yield* tickets.read(1)).timeline.map((e) => [e.by, e.fact.type]);
				return {why: refused.why, timeline};
			}),
		);
		const expectedWrites = {
			why: "not_yours",
			timeline: [
				[owner, "filed"],
				[watcher, "pr"],
			],
		};
		expect(seen).toEqual({ledger: expectedWrites, memory: expectedWrites});
	});

	it("refuses a person's `answered` cast past the type, as `not_yours`", async () => {
		const answer = {type: "answered", ask: "a-1", pick: "approve", note: ""};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				const refused = yield* Effect.flip(
					// oxlint-disable-next-line fabrika/no-type-assertions -- the test plays a caller that lies to the compiler, to show the run-time check holds
					tickets.write(1, "r-1/answer", answer as unknown as CodeFact),
				);
				const kinds = (yield* tickets.read(1)).timeline.map((e) => e.fact.type);
				return {why: refused.why, kinds};
			}),
		);
		const expectedRefusal = {why: "not_yours", kinds: ["filed"]};
		expect(seen).toEqual({ledger: expectedRefusal, memory: expectedRefusal});
	});

	// Record wide (docs/plan/pipeline-self-fix.md, PR 7).
	it("keeps a run's harness session id as a fact of its own, on both Layers", async () => {
		const session: CodeFact = {type: "session", run: "r-1", id: "fake-triage"};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				yield* tickets.write(1, "r-1/started", started);
				yield* tickets.write(1, "r-1/session", session);
				return (yield* tickets.read(1)).timeline.map((e) => e.fact);
			}),
		);
		const expected = [filed.fact, started, session];
		expect(seen).toEqual({ledger: expected, memory: expected});
	});

	it("fills in `during` on a lane's comment: the run live when it was written, and none after its end", async () => {
		const ended: CodeFact = {
			type: "ended",
			run: "r-1",
			stage: "triage",
			outcome: {kind: "done", part: false},
			usd: 0,
			input: 0,
			output: 0,
			turns: 1,
		};
		const seen = await onBoth(
			Effect.gen(function* () {
				const tickets = yield* Tickets;
				yield* tickets.talk(1, "before", {type: "commented", body: "Nothing runs yet."});
				yield* tickets.write(1, "r-1/started", started);
				yield* tickets.talk(1, "while", {type: "commented", body: "Seen while triage runs."});
				yield* tickets.write(1, "r-1/ended", ended);
				yield* tickets.talk(1, "after", {type: "commented", body: "Seen after it ended."});
				return (yield* tickets.read(1)).timeline.flatMap((e) =>
					e.fact.type === "commented" ? [e.fact] : [],
				);
			}),
		);
		const comments = [
			{type: "commented", body: "Nothing runs yet."},
			{type: "commented", body: "Seen while triage runs.", during: "r-1"},
			{type: "commented", body: "Seen after it ended."},
		];
		// Strict: with no run live, `during` is missing, never `undefined` or `null`.
		expect(seen).toStrictEqual({ledger: comments, memory: comments});
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

// Self-fix PR 11b, "waits and records" (docs/plan/pipeline-self-fix.md, PR 11, `wait`). Tickets wraps
// its transport in the one wait (../wait.ts): a ledger that does not answer is asked again, 1 second
// after, then 2, then 4, with no cap. Only a write with its own key is sent again. A transient error
// never reaches the lane. A refusal does, at once, with its real why.

/** What one call of the ledger meets, in turn, before it answers: no answer, or the ledger's 404. */
type Meets = "unreachable" | "unknown_name";

/**
 * Ticket 1, filed, on a ledger whose `readStream` and `send` meet `meets[method]` in turn, then answer
 * as the memory ledger does. `times[method]`: the clock time of each call that reached it.
 */
const flaky = (meets: Partial<Record<"readStream" | "send", readonly Meets[]>>) =>
	Effect.gen(function* () {
		const ledger = memoryService();
		yield* ledger.register("tracker/ticket/1", "user:owner");
		yield* ledger.send(streams("tracker/ticket/1").inbox, "w1", {
			kind: "filed",
			writer: "user:owner",
			data: filed.fact,
		});
		const times = {readStream: [] as number[], send: [] as number[]};
		const meeting = (method: "readStream" | "send", stream: string) =>
			Effect.gen(function* () {
				times[method].push(yield* Clock.currentTimeMillis);
				const meet = meets[method]?.[times[method].length - 1];
				if (meet === "unreachable")
					return yield* Effect.fail(new LedgerUnreachable({method, message: "no answer"}));
				if (meet === "unknown_name") return yield* Effect.fail(new UnknownName({stream}));
			});
		const wrapped: Ledger["Service"] = {
			...ledger,
			readStream: (stream, fromRev, limit) =>
				meeting("readStream", stream).pipe(
					Effect.andThen(ledger.readStream(stream, fromRev, limit)),
				),
			// The 404 is the ledger's own error, which only `send` declares.
			send: ((inbox, id, event, fence) =>
				meeting("send", inbox).pipe(
					Effect.andThen(ledger.send(inbox, id, event, fence)),
				)) as Ledger["Service"]["send"],
		};
		return {
			ledger,
			times,
			layer: ticketsOnLedger(lane).pipe(Layer.provide(Layer.succeed(Ledger, wrapped))),
		};
	});

/**
 * `program` on Tickets over `flaky(meets)`, under the TestClock, a second of virtual time at a time
 * until it ends: how it ended, the clock time of each ledger call, and the ticket's rows after.
 */
const waited = <A>(
	meets: Partial<Record<"readStream" | "send", readonly Meets[]>>,
	program: Effect.Effect<A, unknown, Tickets>,
) =>
	Effect.gen(function* () {
		const {ledger, times, layer} = yield* flaky(meets);
		let over = false;
		const fiber = yield* Effect.forkChild(
			Effect.result(program.pipe(Effect.provide(layer))).pipe(
				Effect.ensuring(Effect.sync(() => void (over = true))),
			),
		);
		for (let s = 0; !over && s < 1_000; s++) {
			yield* TestClock.adjust("1 second");
			for (let k = 0; k < 5; k++) yield* Effect.yieldNow;
		}
		const result = yield* Fiber.join(fiber);
		const rows = yield* ledger.readStream(streams("tracker/ticket/1").inbox);
		return {result, times, kinds: rows.map((r) => r.kind)};
	}).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

const gapsIn = (times: readonly number[]) => times.slice(1).map((t, i) => t - (times[i] ?? 0));

describe("Tickets, on a ledger that does not answer", () => {
	it("a read that gets no answer three times, then answers: the ticket, after waits of 1, 2 and 4 seconds", async () => {
		const seen = await waited(
			{readStream: ["unreachable", "unreachable", "unreachable"]},
			Tickets.use((t) => t.read(1)),
		);
		expect(seen.result._tag, JSON.stringify(seen.result)).toBe("Success");
		if (seen.result._tag === "Success") expect(seen.result.success.number).toBe(1);
		expect(gapsIn(seen.times.readStream)).toEqual([1_000, 2_000, 4_000]);
	});

	it("a write with its key that gets no answer twice, then lands: it lands once", async () => {
		const seen = await waited(
			{send: ["unreachable", "unreachable"]},
			Tickets.use((t) => t.write(1, "r-1/started", started)),
		);
		expect(seen.result._tag, JSON.stringify(seen.result)).toBe("Success");
		expect(gapsIn(seen.times.send)).toEqual([1_000, 2_000]);
		expect(seen.kinds).toEqual(["filed", "started"]);
	});

	it("a write that gets no answer twice, then the ledger's 404: refused with its real why, and tried no more", async () => {
		const seen = await waited(
			{send: ["unreachable", "unreachable", "unknown_name"]},
			Tickets.use((t) => t.write(1, "r-1/started", started)),
		);
		expect(seen.result).toMatchObject({_tag: "Failure", failure: {why: "no_ticket"}});
		expect(seen.times.send).toHaveLength(3);
		expect(seen.kinds).toEqual(["filed"]);
	});

	it("a read of a ticket nobody filed, after two reads with no answer: `no_ticket`, never `unreachable`", async () => {
		const seen = await waited(
			{readStream: ["unreachable", "unreachable"]},
			Tickets.use((t) => t.read(2)),
		);
		expect(seen.result).toMatchObject({_tag: "Failure", failure: {why: "no_ticket"}});
		expect(seen.times.readStream).toHaveLength(3);
	});
});
