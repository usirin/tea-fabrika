import {Ledger, memoryStorage, offer, pipe, start, streams} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {type CodeFact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {Tickets, ticketsOnLedger} from "@kampus/pipeline/tickets/tickets";
import {trace} from "@tea-fabrika/trace";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {TALLY_TRACE} from "@tea-fabrika/trace/tally";
import {Author, pullRequestsOf} from "@tea-fabrika/tracker";
import {LANE, OWNER, SEVEN, SEVEN_BODY, SEVEN_TITLE, SEVEN_TRACE} from "@tea-fabrika/tracker/seven";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {runs, traceIdOf} from "./index.ts";

// `runs --ticket 7 | trace`, as tsh wires it: runs' output `id` into trace's input `id`, both the
// real programs, ticket 7 on a ledger in memory, and its job's record in memory. A run picked in
// runs' window makes trace read that run's record.

/** The lane's job, as its record holds it: the tally record's spans, under #7's trace id. */
const LANE_RECORD = {...TALLY_TRACE, trace: SEVEN_TRACE};

/** A run that started with no trace id: one from before records were kept. */
const UNTRACED: CodeFact = {type: "started", run: "r-3", stage: "sort", task: null, log: null};

/** Ticket 7 on `ledger`, as a lane left it, and one run with no trace id. */
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
		yield* tickets.write(7, "w/untraced", UNTRACED);
	}).pipe(Effect.provide(ticketsOnLedger(LANE)), Effect.provide(Layer.succeed(Ledger, ledger)));

const piped = (ledger: Ledger["Service"], sent: string[]) =>
	Effect.gen(function* () {
		const target = yield* start(
			trace,
			{id: undefined},
			{},
			{id: "trace:pipe", storage: memoryStorage()},
		).pipe(Effect.provide(memoryTraces([LANE_RECORD])));
		if (target.kind !== "running") return yield* Effect.die("trace did not start");
		const source = yield* pipe(
			{
				program: runs,
				flags: {ticket: 7},
				listeners: {id: (id) => sent.push(id)},
				keeping: {id: "runs:pipe", storage: memoryStorage()},
			},
			"id",
			target,
			"id",
		).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(Ledger, ledger),
					Layer.succeed(Author, OWNER),
					pullRequestsOf([]),
				),
			),
		);
		if (source.kind !== "running") return yield* Effect.die("runs did not start");
		return {runs: source.run, trace: target.run};
	});

describe("runs --ticket 7 | trace", () => {
	it("opens the trace of the run picked; a run with no trace id, or none at all, sends nothing", async () => {
		const ledger = memoryService();
		const sent: string[] = [];
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seed(ledger);
				const p = yield* piped(ledger, sent);
				const first = yield* p.trace.machines.trace.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
				);
				// Picked only once runs has read the ticket, as a person can only click a drawn clip.
				yield* p.runs.machines.tickets.changes.pipe(
					Stream.filter((s) =>
						(s?.tickets.find((t) => t.number === 7)?.timeline ?? []).some(
							(e) => e.fact.type === "started" && e.fact.run === "r-3",
						),
					),
					Stream.runHead,
				);
				yield* offer(p.runs, "choose", {run: "r-3"});
				yield* offer(p.runs, "choose", {run: "r-9"});
				yield* offer(p.runs, "choose", {run: "r-2"});
				const read = yield* p.trace.machines.trace.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.filter((s) => s.read.at === "read" && s.read.trace.trace === SEVEN_TRACE),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
				);
				yield* offer(p.runs, "quit", null);
				const runsEnded = (yield* p.runs.ended).kind;
				// The pipe's end closes trace's `id`, not its window: it shows the record still.
				const after = p.trace.machines.trace.state();
				yield* offer(p.trace, "quit", null);
				return {first, read, runsEnded, after, traceEnded: (yield* p.trace.ended).kind};
			}).pipe(Effect.scoped),
		);
		// Before a pick, trace follows its own trace: the job it runs in, not one runs sent.
		const own = seen.first.read;
		const ownId = own.at === "read" ? own.trace.trace : own.at === "waiting" ? null : own.id;
		expect(ownId).toMatch(/^[0-9a-f]{32}$/);
		expect(ownId).not.toBe(SEVEN_TRACE);
		expect(sent).toEqual([SEVEN_TRACE]);
		expect(seen.read.read.at === "read" && seen.read.read.trace.trace).toBe(SEVEN_TRACE);
		expect(seen.read.open).toEqual(["job"]);
		expect(seen.runsEnded).toBe("ended");
		expect(seen.after?.read.at).toBe("read");
		expect(seen.traceEnded).toBe("ended");
	});
});

describe("traceIdOf", () => {
	it("gives the trace id a run's start holds, and null for a run with none or no such run", () => {
		const timeline = [...SEVEN, {...SEVEN[1], pos: 99, fact: UNTRACED}] as typeof SEVEN;
		expect(traceIdOf(timeline, "r-2")).toBe(SEVEN_TRACE);
		expect(traceIdOf(timeline, "r-3")).toBeNull();
		expect(traceIdOf(timeline, "r-9")).toBeNull();
	});
});
