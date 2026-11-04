import {mkdtempSync} from "node:fs";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, LedgerUnreachable, streams, UnknownName, type Writer} from "@kampus/fabrika-old";
import {layerHttp} from "@kampus/fabrika-old/http";
import {memoryService} from "@kampus/fabrika-old/memory";
import {layerSqlite, openDb} from "@kampus/fabrika-old/sqlite";
import {Clock, Duration, Effect, Fiber, Layer, Option, Redacted} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {OnWait} from "../wait.ts";
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

/**
 * What one call of the ledger meets, in turn, before it answers: no answer, the ledger's own 404, or
 * an HTTP answer that is not a 2xx, as the ledger over HTTP gives it: its status and its text.
 */
type Meets = "unreachable" | "unknown_name" | {readonly status: number; readonly says: string};

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
		/** The clock time of this call, kept, and what it meets. */
		const meeting = (method: "readStream" | "send") =>
			Effect.gen(function* () {
				times[method].push(yield* Clock.currentTimeMillis);
				return meets[method]?.[times[method].length - 1];
			});
		const silent = (method: "readStream" | "send") =>
			new LedgerUnreachable({method, message: "no answer"});
		/** The ledger over HTTP answered, but not with a 2xx: `LedgerUnreachable` with its status (http.ts). */
		const answered = (method: "readStream" | "send", meet: {status: number; says: string}) =>
			new LedgerUnreachable({method, message: meet.says, status: meet.status});
		const wrapped: Ledger["Service"] = {
			...ledger,
			readStream: (stream, fromRev, limit) =>
				Effect.flatMap(meeting("readStream"), (meet) =>
					meet === "unreachable"
						? Effect.fail(silent("readStream"))
						: typeof meet === "object"
							? Effect.fail(answered("readStream", meet))
							: ledger.readStream(stream, fromRev, limit),
				),
			// The 404 is the ledger's own error, which only `send` declares.
			send: (inbox, id, event, fence) =>
				Effect.flatMap(meeting("send"), (meet) =>
					meet === "unreachable"
						? Effect.fail(silent("send"))
						: meet === "unknown_name"
							? Effect.fail(new UnknownName({stream: inbox}))
							: typeof meet === "object"
								? Effect.fail(answered("send", meet))
								: ledger.send(inbox, id, event, fence),
				),
		};
		return {
			ledger,
			times,
			layer: ticketsOnLedger(lane).pipe(Layer.provide(Layer.succeed(Ledger, wrapped))),
		};
	});

/**
 * `program` on Tickets over `flaky(meets)`, under the TestClock, a second of virtual time at a time
 * until it ends: how it ended, the clock time of each ledger call, the ticket's rows after, and each
 * line the wait said (`OnWait`). A program still waiting after 1,000 virtual seconds is stopped, and
 * its result is `{_tag: "StillWaiting"}`.
 */
const waited = <A, E>(
	meets: Partial<Record<"readStream" | "send", readonly Meets[]>>,
	program: Effect.Effect<A, E, Tickets>,
) =>
	Effect.gen(function* () {
		const {ledger, times, layer} = yield* flaky(meets);
		const heard: string[] = [];
		let over = false;
		const fiber = yield* Effect.forkChild(
			Effect.result(
				program.pipe(
					Effect.provide(layer),
					Effect.provideService(OnWait, (line) => Effect.sync(() => void heard.push(line))),
				),
			).pipe(Effect.ensuring(Effect.sync(() => void (over = true)))),
		);
		for (let s = 0; !over && s < 1_000; s++) {
			yield* TestClock.adjust("1 second");
			for (let k = 0; k < 5; k++) yield* Effect.yieldNow;
		}
		if (!over) yield* Fiber.interrupt(fiber);
		const result = over ? yield* Fiber.join(fiber) : ({_tag: "StillWaiting"} as const);
		const rows = yield* ledger.readStream(streams("tracker/ticket/1").inbox);
		return {result, times, heard, kinds: rows.map((r) => r.kind)};
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

// Self-fix PR 11b, round 2 (the review's first must-fix). The ledger over HTTP turns every answer that
// is not a 2xx into `LedgerUnreachable` (packages/fabrika/src/host/http.ts), with the answer's status
// beside its text. A refusal is not slowness: a 400, a 401 after a renew that failed, a 403, a 404, a
// door that gave no new session. Each fails at once with the ledger's own words. Only no answer at
// all (a timeout, a dropped connection), a 408, a 429 and a 5xx are waited out.
describe("Tickets, on a ledger that answers with a refusal", () => {
	const REFUSALS = [
		{status: 400, says: "the ledger answered 400: bad arguments"},
		{status: 401, says: "the ledger answered 401: the session ended"},
		{status: 401, says: "the door gave no new session (401): wrong key"},
		{status: 403, says: "the ledger answered 403: an agent may not cancel"},
		{status: 404, says: "the ledger answered 404: no such ledger"},
	] as const;

	it("a read the ledger refuses fails at once, with the ledger's own words, and is never asked again", async () => {
		for (const refusal of REFUSALS) {
			const seen = await waited(
				{readStream: [refusal]},
				Tickets.use((t) => t.read(1)),
			);
			expect(seen.result, refusal.says).toMatchObject({_tag: "Failure"});
			if (seen.result._tag === "Failure")
				expect(seen.result.failure.says, refusal.says).toContain(refusal.says);
			expect(seen.times.readStream, refusal.says).toHaveLength(1);
			expect(seen.heard, refusal.says).toEqual([]);
		}
	});

	it("a keyed write the ledger refuses fails at once, with the ledger's own words, and lands nothing", async () => {
		for (const refusal of REFUSALS) {
			const seen = await waited(
				{send: [refusal]},
				Tickets.use((t) => t.write(1, "r-1/started", started)),
			);
			expect(seen.result, refusal.says).toMatchObject({_tag: "Failure"});
			if (seen.result._tag === "Failure")
				expect(seen.result.failure.says, refusal.says).toContain(refusal.says);
			expect(seen.times.send, refusal.says).toHaveLength(1);
			expect(seen.kinds, refusal.says).toEqual(["filed"]);
		}
	});

	it("a 408, a 429 and a 5xx are slowness: each is waited out, 1 second later the read answers", async () => {
		for (const status of [408, 429, 500, 502, 503, 504]) {
			const seen = await waited(
				{readStream: [{status, says: `the ledger answered ${status}: busy`}]},
				Tickets.use((t) => t.read(1)),
			);
			expect(seen.result._tag, String(status)).toBe("Success");
			expect(gapsIn(seen.times.readStream), String(status)).toEqual([1_000]);
		}
	});

	it("the wait line says what the ledger answered, not `no answer`, when it did answer", async () => {
		const says = "the ledger answered 503: the object is restarting";
		const seen = await waited(
			{readStream: [{status: 503, says}]},
			Tickets.use((t) => t.read(1)),
		);
		expect(seen.result._tag).toBe("Success");
		expect(seen.heard).toHaveLength(1);
		expect(seen.heard[0]).toContain(says);
		expect(seen.heard[0]).not.toContain("no answer");
	});
});

// Self-fix PR 11b, round 2b (the review's must-fix 1). A ledger that answers, but with something this
// code cannot read, will never heal: the client and the ledger disagree on the wire (two checkouts, or
// a proxy's page). So Tickets fails at once, with the cause, as for a refusal. It never waits on it as
// `no answer`, which has no cap. On the real ledgers: over HTTP (http.ts and ledger.ts's `rawOf`) and
// on SQLite (a worker's error, sqlite.ts).

/**
 * `Tickets.read(1)` on `ledger`, in real time, given 2.5 seconds: the one wait's second try is at 1 s
 * and its third at 3 s, so a read that waits is still waiting then (`StillWaiting`). Each line the
 * wait said comes back too.
 */
const readWithin = (ledger: Layer.Layer<Ledger>) =>
	Effect.gen(function* () {
		const heard: string[] = [];
		const ended = yield* Tickets.use((t) => t.read(1)).pipe(
			Effect.provide(ticketsOnLedger(lane).pipe(Layer.provide(ledger))),
			Effect.provideService(OnWait, (line) => Effect.sync(() => void heard.push(line))),
			Effect.result,
			Effect.timeoutOption(Duration.millis(2_500)),
		);
		return {result: Option.getOrElse(ended, () => ({_tag: "StillWaiting"}) as const), heard};
	});

/** A Node server on a free port that answers every `readStream` 200 with `body`, and counts them. */
const answering200 = (body: string) =>
	Effect.gen(function* () {
		const calls = {readStream: 0};
		const server = yield* Effect.acquireRelease(
			Effect.callback<ReturnType<typeof createServer>>((resume) => {
				const s = createServer((req, res) => {
					req.resume();
					if (req.url?.endsWith("/readStream") === true) calls.readStream++;
					res.writeHead(200, {"content-type": "application/json"});
					res.end(body);
				});
				s.listen(0, "127.0.0.1", () => resume(Effect.succeed(s)));
			}),
			(s) =>
				Effect.sync(() => {
					s.closeAllConnections();
					s.close();
				}),
		);
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		return {calls, url};
	});

describe("Tickets, on a ledger that answers with what this code cannot read", () => {
	it.each([
		["a body that is not JSON, such as a proxy's page", "<html><body>Sign in</body></html>"],
		["JSON in a shape the wire does not have", '{"rows":"not a list"}'],
	])(
		"over HTTP, a 200 with %s: the read fails at once, refused with the cause, asked once and never waited on",
		async (_, body) => {
			const seen = await Effect.gen(function* () {
				const {calls, url} = yield* answering200(body);
				const ledger = layerHttp({
					url,
					ledger: "x",
					token: Redacted.make("fabrika_a_test"),
					timeout: Duration.millis(500),
				});
				return {...(yield* readWithin(ledger)), calls: calls.readStream};
			}).pipe(Effect.scoped, Effect.runPromise);
			expect(seen.result, JSON.stringify(seen)).toMatchObject({
				_tag: "Failure",
				failure: {why: "refused"},
			});
			expect(seen.calls).toBe(1);
			expect(seen.heard).toEqual([]);
		},
	);

	it("on SQLite, an error its worker reports (here its file lost its table): the read fails at once, refused with the cause, never waited on", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "tickets-sqlite-")), "ledger.sqlite");
		const seen = await Effect.gen(function* () {
			const ledger = yield* Layer.build(layerSqlite({path: file}));
			yield* Ledger.use((l) => l.register("tracker/ticket/1", "user:owner")).pipe(
				Effect.provide(ledger),
			);
			// The file's own driver, past the ledger's rules, as a bad tool or a torn copy would leave it.
			const {db, close} = openDb(file);
			db.all("DROP TABLE events");
			close();
			return yield* readWithin(Layer.succeedContext(ledger));
		}).pipe(Effect.scoped, Effect.runPromise);
		expect(seen.result, JSON.stringify(seen)).toMatchObject({
			_tag: "Failure",
			failure: {why: "refused"},
		});
		expect(JSON.stringify(seen.result)).toContain("events");
		expect(seen.heard).toEqual([]);
	});
});
