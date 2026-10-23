import {fresh, type LawResult, say} from "@kampus/fabrika/laws";
import {Duration, Effect, Exit, Layer, Scope} from "effect";
import {type LaneId, laneId, planOf, type TicketId, taskId, ticketId} from "../ids.ts";
import {claim, Lanes, layerLanes, release} from "./claims.ts";
import {
	appendFact,
	type Fact,
	factsOf,
	homeOf,
	Ledger,
	planName,
	readFacts,
	sendFact,
	ticketName,
} from "./ledger.ts";
import {planAskId, rulingId} from "./rules.ts";

// The pipeline's own laws over the one ledger: what its facts and claims promise on top of the
// tea-host ledger's laws (fabrika's host/laws.ts). The same suite runs on every ledger Layer; a Layer
// with a planted mistake must break at least one of them. Each law works on a ticket of its own,
// so the laws run at once on one ledger.

type Service = Ledger["Service"];
type Step = {readonly what: string; readonly got: string; readonly want: string};

const verdict = (law: string, list: readonly Step[]): LawResult => {
	const bad = list.filter((s) => s.got !== s.want);
	return {
		law,
		pass: bad.length === 0,
		numbers:
			bad.length === 0
				? list.map((s) => `${s.what}: ${s.got}`).join("; ")
				: `WRONG ${bad.map((s) => `${s.what}: ${s.got}, wanted ${s.want}`).join("; ")}`,
	};
};
const steps = () => {
	const list: Step[] = [];
	const step = <A, E extends {readonly _tag: string}>(
		what: string,
		e: Effect.Effect<A, E>,
		want: string,
	) =>
		Effect.map(say(e), (s) => {
			list.push({what, got: s.word, want});
			return s.value;
		});
	const check = (what: string, got: unknown, want: unknown) => {
		list.push({what, got: String(got), want: String(want)});
	};
	return {list, step, check};
};

/** A ticket no other law touches. */
const freshTicket = (tag: string): TicketId => ticketId(`${fresh(tag)}/r#1`);

/**
 * One process on the ledger: its own `Lanes`, alive until `close`. Closing it is the process
 * gone: its renewals stop, and its leases run out.
 */
const proc = (l: Service, ttlMs: number) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const ctx = yield* Layer.buildWithScope(
			layerLanes({ttlMs}).pipe(Layer.provideMerge(Layer.succeed(Ledger, l))),
			scope,
		);
		return {
			run: <A, E>(e: Effect.Effect<A, E, Lanes | Ledger>) => Effect.provide(e, ctx),
			close: Scope.close(scope, Exit.void),
		};
	});

const onLedger = <A, E>(l: Service, e: Effect.Effect<A, E, Ledger>) =>
	Effect.provideService(e, Ledger, l);

/** P1. Every fact reads back once, in the order written, from the name it belongs to. */
export const lawHome = (l: Service) =>
	Effect.gen(function* () {
		const law = "P1. every fact reads back once, in order, from its own name";
		const {list, check} = steps();
		const T = freshTicket("p1");
		const P = planOf(T);
		const t1 = taskId("t1");
		const facts: readonly Fact[] = [
			{type: "lane", ticket: T},
			{type: "reviewed", plan: P, task: t1, open: 2},
			{type: "answered", id: planAskId(P, 1), answer: {kind: "approve"}},
			{type: "ruling_needed", ticket: T, ask: "keep it?", options: ["yes", "no"], why: "a test"},
			{
				type: "answered",
				id: rulingId(T),
				answer: {kind: "rule", answer: "Yes.", rule: "one_off", build: false},
			},
			{type: "built", plan: P, task: t1, changes: ["src/a.ts"], holds: 0},
		];
		const p = yield* proc(l, 30_000);
		const lane = laneId("L1");
		yield* p.run(claim(T, lane));
		const hold = yield* p.run(Lanes.use((s) => s.hold(T)));
		for (const fact of facts)
			yield* onLedger(l, hold === null ? sendFact(fact) : appendFact(fact, hold));
		yield* p.run(release(T, lane));
		yield* p.close;
		const written = [...facts, {type: "released", ticket: T, lane} satisfies Fact];
		const mine = new Set([ticketName(T), planName(P)]);
		const back = (yield* onLedger(l, readFacts))
			.map((e) => e.fact)
			.filter((f) => mine.has(homeOf(f) ?? ""));
		check("facts read back", JSON.stringify(back), JSON.stringify(written));
		// The lease holder's own facts went under its fence; the plan's to the plan's inbox.
		const own = yield* l.readStream(factsOf(ticketName(T)));
		check(
			"under the ticket's lease",
			own.map((r) => r.kind).join(","),
			"lane,ruling_needed,answered,released",
		);
		return verdict(law, list);
	});

/** P2. While a lane holds its ticket, a write under the ticket with no fence, or a made-up one, is refused. */
export const lawUnfenced = (l: Service) =>
	Effect.gen(function* () {
		const law = "P2. a claimed lane refuses a write without its fence";
		const {list, step, check} = steps();
		const T = freshTicket("p2");
		const name = ticketName(T);
		const p = yield* proc(l, 30_000);
		yield* p.run(claim(T, laneId("L1")));
		const hold = yield* p.run(Lanes.use((s) => s.hold(T)));
		if (hold === null) return verdict(law, [{what: "claim", got: "no lease", want: "a lease"}]);
		const released = {type: "released", ticket: T, lane: laneId("L1")} satisfies Fact;
		const event = {kind: "released", writer: "L2", data: released};
		yield* step("no fence", l.append(factsOf(name), "any", event), "denied");
		yield* step("a made-up fence", l.append(factsOf(name), "any", event, hold.fence + 1), "fenced");
		yield* step("the holder's fence", onLedger(l, appendFact(released, hold)), "ok");
		// The inbox stays open: anyone may send the ticket a fact.
		yield* step("a send with no fence", onLedger(l, sendFact({type: "lane", ticket: T})), "ok");
		yield* p.close;
		check("rows under the lease", (yield* l.readStream(factsOf(name))).length, 1);
		return verdict(law, list);
	});

/** P3. A holder that stops renewing loses the ticket when its lease runs out; its late writes are refused. */
export const lawLost = (l: Service, ttlMs = 500, graceMs = 1000) =>
	Effect.gen(function* () {
		const law = "P3. a lost lease fences the old holder";
		const {list, step, check} = steps();
		const T = freshTicket("p3");
		const old = yield* proc(l, ttlMs);
		yield* old.run(claim(T, laneId("L1")));
		const hold = yield* old.run(Lanes.use((s) => s.hold(T)));
		// The process is gone, frozen or cut off: nothing renews its lease.
		yield* old.close;
		if (hold === null) return verdict(law, [{what: "claim", got: "no lease", want: "a lease"}]);
		const next = yield* proc(l, 30_000);
		check("claimed while the lease lives", yield* next.run(claim(T, laneId("L2"))), "L1");
		yield* Effect.sleep(Duration.millis(ttlMs + graceMs));
		check("claimed once it ran out", yield* next.run(claim(T, laneId("L2"))), "L2");
		const late: Fact = {type: "released", ticket: T, lane: laneId("L1")};
		yield* step("late write under the ticket", onLedger(l, appendFact(late, hold)), "fenced");
		yield* step(
			"late send to its plan",
			onLedger(
				l,
				sendFact({type: "reviewed", plan: planOf(T), task: taskId("t1"), open: 0}, {hold}),
			),
			"fenced",
		);
		yield* next.close;
		check("rows under the lease", (yield* l.readStream(factsOf(ticketName(T)))).length, 0);
		return verdict(law, list);
	});

/** P4. `n` processes claim one ticket at once, `rounds` times: one claim lands, and all are told its lane. */
export const lawOneWins = (l: Service, n = 8, rounds = 10) =>
	Effect.gen(function* () {
		const law = `P4. one claim wins among ${n}`;
		const {list, check} = steps();
		const procs = yield* Effect.forEach(Array.from({length: n}), () => proc(l, 30_000), {
			concurrency: 1,
		});
		let split = 0;
		let landed = 0;
		for (let round = 0; round < rounds; round++) {
			const T = freshTicket("p4");
			const told = yield* Effect.all(
				procs.map((p, i) => p.run(claim(T, laneId(`L${i + 1}`)))),
				{concurrency: "unbounded"},
			);
			if (new Set(told).size !== 1) split++;
			landed += (yield* l.readStream(ticketName(T))).filter((r) => r.kind === "claimed").length;
		}
		yield* Effect.forEach(procs, (p) => p.close, {concurrency: "unbounded"});
		check("rounds with two holders", split, 0);
		check("claims landed", landed, rounds);
		return verdict(law, list);
	});

/** P5. A lane that lets its ticket go frees it at once: the next lane need not wait the lease out. */
export const lawRelease = (l: Service) =>
	Effect.gen(function* () {
		const law = "P5. a release lets the next lane claim at once";
		const {list, check} = steps();
		const T = freshTicket("p5");
		const a = yield* proc(l, 60_000);
		yield* a.run(claim(T, laneId("L1")));
		yield* a.run(release(T, laneId("L1")));
		const b = yield* proc(l, 60_000);
		const started = Date.now();
		const told: LaneId = yield* b.run(claim(T, laneId("L2")));
		check("the next lane", told, "L2");
		check("it waited under 5 s", Date.now() - started < 5_000, true);
		yield* a.close;
		yield* b.close;
		return verdict(law, list);
	});

const guard = (law: string, e: Effect.Effect<LawResult, unknown>) =>
	e.pipe(
		Effect.catchCause((c) =>
			Effect.succeed({law, pass: false, numbers: `stopped: ${String(c).slice(0, 300)}`}),
		),
	);

export interface PipelineLawOptions {
	/** The ledger's grace past a lease's end before a claim can take it (P3). */
	readonly graceMs?: number;
}

/** Every pipeline law, all at once. A law that dies is a failed law, not a crash. */
export const runPipelineLaws = (o: PipelineLawOptions = {}) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		return yield* Effect.all(
			[
				guard("P1", lawHome(l)),
				guard("P2", lawUnfenced(l)),
				guard("P3", lawLost(l, 500, o.graceMs ?? 1000)),
				guard("P4", lawOneWins(l)),
				guard("P5", lawRelease(l)),
			],
			{concurrency: "unbounded"},
		);
	});
