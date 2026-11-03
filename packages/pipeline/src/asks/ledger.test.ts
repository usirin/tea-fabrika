import {execFile} from "node:child_process";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {layerSqlite, openDb} from "@kampus/fabrika-old/sqlite";
import {Cause, Effect, Exit, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {CriteriaRecord, ledgerRecord} from "../criteria/record.ts";
import {type LaneId, laneId, planOf, type TicketId, taskId, ticketId} from "../ids.ts";
import {RULINGS} from "./cases.ts";
import {claim, holderOf, type Lanes, layerLanes, newLane, release} from "./claims.ts";
import {demoFacts} from "./demo.ts";
import {
	type Fact,
	Ledger,
	memoryLedger,
	planName,
	ROOT,
	readFacts,
	sendFact,
	steadyCall,
	ticketName,
} from "./ledger.ts";
import {foldLedger, openAsks, planAskId, rulingId} from "./rules.ts";

// The pipeline's facts on the tea-host's ledger, kept in a node:sqlite file: the ledger tsh
// keeps per repository. The user's job first: what one process writes, a fresh layer and a fresh
// process fold back to the same state the in-memory ledger folds from the same calls. Then the
// claim across real processes, and what a row that is not a fact does to a read.

const PROC = fileURLToPath(
	new URL("../../../../fixtures/pipeline-ledger/proc.ts", import.meta.url),
);

const scratch = () => join(mkdtempSync(join(tmpdir(), "pipeline-ledger-")), "ledger.sqlite");
const onFile = (file: string) => layerSqlite({path: file});

/** How long a lease lives in these runs: a run after one that kept a lease waits it out. */
const TTL_MS = 2000;

/** One process on `ledger`: its leases (`Lanes`) and the criteria record over the ledger. */
const on = <A, E>(
	ledger: Layer.Layer<Ledger>,
	body: Effect.Effect<A, E, Ledger | Lanes | CriteriaRecord>,
) =>
	Effect.runPromise(
		body.pipe(
			Effect.provide(
				Layer.mergeAll(layerLanes({ttlMs: TTL_MS}), ledgerRecord).pipe(Layer.provideMerge(ledger)),
			),
		),
	);

const entriesOf = (ledger: Layer.Layer<Ledger>) =>
	Effect.runPromise(Effect.provide(readFacts, ledger));
const holderIn = (ledger: Layer.Layer<Ledger>, ticket: TicketId) =>
	Effect.runPromise(Effect.provide(holderOf(ticket), ledger));
const send = (fact: Fact) => Effect.orDie(sendFact(fact));

/** The defect `body` dies with, by its message. */
const brokenBy = async <A, E>(ledger: Layer.Layer<Ledger>, body: Effect.Effect<A, E, Ledger>) => {
	const exit = await Effect.runPromiseExit(body.pipe(Effect.provide(ledger)));
	if (Exit.isSuccess(exit)) throw new Error("it did not fail");
	return String(Cause.squash(exit.cause));
};

/**
 * A second process on the ledger (fixtures/pipeline-ledger/proc.ts). `ready`: it said `ready`;
 * `done`: everything it printed, once it ended well.
 */
const started1 = (args: readonly string[]) => {
	let out = "";
	let said: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		said = resolve;
	});
	const done = new Promise<string>((resolve, reject) => {
		const child = execFile(
			process.execPath,
			["--disable-warning=ExperimentalWarning", PROC, ...args],
			{encoding: "utf8"},
			(error, _stdout, stderr) => {
				// One that ended before it said ready is not waited on: `done` says why.
				said();
				if (error === null) resolve(out);
				else reject(new Error(`${error.message}\n${stderr}`));
			},
		);
		child.stdout?.on("data", (chunk: string) => {
			out += chunk;
			if (out.startsWith("ready\n")) said();
		});
	});
	return {ready, done};
};
const proc = (args: readonly string[]) => started1(args).done;

// The realistic case: experiment 89's real plans and rulings, three tickets
// worked by lanes, a ticket two lanes race for, review rounds through the
// criteria record, answers, and a build that is cleared and shipped.
const planned = demoFacts().flatMap((f) => (f.type === "planned" ? [f.tickets[0]] : []));
const [A, B, C] = planned as [TicketId, TicketId, TicketId];
const T1 = taskId("t1");

/** A review round of `ticket` at `head` over the criteria the record holds now: the first fails when `failFirst`. */
const review = (ticket: TicketId, head: string, failFirst: boolean, found: readonly string[]) =>
	Effect.gen(function* () {
		const record = yield* CriteriaRecord;
		const held = yield* record.read(ticket);
		const criteria = held?.criteria ?? [];
		yield* record.judged(ticket, {
			criteria,
			rows: criteria.map((c, i) => ({
				criterion: c.id,
				version: c.version,
				head,
				grade: failFirst && i === 0 ? ("fail" as const) : ("pass" as const),
				proof: `the review at ${head}`,
			})),
			found,
			head,
			proof: `the review at ${head}`,
		});
	});

/** The first run: what one process writes. Answers the lanes it made. */
const firstRun = Effect.gen(function* () {
	for (const fact of demoFacts()) yield* send(fact);
	const lanes: Record<string, LaneId> = {};
	for (const ticket of [A, B, C]) {
		const lane = yield* newLane(ticket);
		lanes[ticket] = yield* claim(ticket, lane);
	}
	// A second lane on A is told the first holds it.
	const late = yield* newLane(A);
	const told = yield* claim(A, late);
	yield* review(A, "a1", true, ["a gap no criterion covers"]);
	yield* review(B, "b1", false, []);
	const [ruling] = RULINGS;
	if (ruling !== undefined)
		yield* send({
			type: "answered",
			id: rulingId(ruling.ruling.ticket),
			answer: {kind: "rule", answer: "Keep it.", rule: "one_off", build: false},
		});
	yield* send({type: "answered", id: planAskId(planOf(B), 1), answer: {kind: "approve"}});
	yield* send({type: "built", plan: planOf(B), task: T1, changes: ["src/a.ts"], holds: 1});
	yield* send({type: "cleared", plan: planOf(B), task: T1, build: 1, by: "ui-check"});
	yield* send({type: "shipped", plan: planOf(B), task: T1, build: 1});
	yield* release(A, lanes[A] as LaneId);
	return {lanes, late, told};
});

/**
 * A later run on the same ledger, as another process: the late lane takes A now, A is reviewed
 * again, and C's lane, started again, waits its old lease out, takes C as itself and lets it go.
 */
const secondRun = (lanes: Record<string, LaneId>, late: LaneId) =>
	Effect.gen(function* () {
		const holder = yield* claim(A, late);
		yield* review(A, "a2", false, []);
		yield* claim(C, lanes[C] as LaneId);
		yield* release(C, lanes[C] as LaneId);
		const ruling = RULINGS[1];
		if (ruling !== undefined)
			yield* send({
				type: "answered",
				id: rulingId(ruling.ruling.ticket),
				answer: {kind: "rule", answer: "Build it.", rule: "lasting", build: true},
			});
		return holder;
	});

/** What the fresh process prints, worked out here from a fold. */
const summaryOf = (entries: Parameters<typeof foldLedger>[0]) => {
	const folded = foldLedger(entries);
	return {
		count: entries.length,
		open: openAsks(folded).map((ask) => ask.id),
		answered: [...folded.answered.keys()],
		builds: [...folded.builds.keys()],
	};
};

describe("the pipeline's facts on the one ledger, in a node:sqlite file: the user's job", () => {
	it("six plans, three lanes, reviews, answers and a ship, written in one process: a fresh layer and a fresh process fold the same state as memory, run after run", async () => {
		const file = scratch();
		const memory = memoryLedger();

		const onDisk = await on(onFile(file), firstRun);
		const inMemory = await on(memory.layer, firstRun);
		expect(onDisk).toEqual(inMemory);
		expect(onDisk.told).toBe(onDisk.lanes[A]);

		const back = await entriesOf(onFile(file));
		expect(back).toEqual(memory.read());
		expect(foldLedger(back)).toEqual(foldLedger(memory.read()));
		expect(back.length).toBeGreaterThan(25);
		expect(await holderIn(onFile(file), A)).toBeNull();
		expect(await holderIn(onFile(file), B)).toBe(onDisk.lanes[B]);

		const fresh = JSON.parse(await proc(["read", file]));
		expect(fresh).toEqual(summaryOf(memory.read()));
		expect(fresh.open.length).toBeGreaterThan(5);

		// Run again on the same file, from a new layer and new leases: more facts, then read again.
		const heldOnDisk = await on(onFile(file), secondRun(onDisk.lanes, onDisk.late));
		const heldInMemory = await on(memory.layer, secondRun(inMemory.lanes, inMemory.late));
		expect(heldOnDisk).toBe(heldInMemory);
		expect(heldOnDisk).toBe(onDisk.late);

		const again = await entriesOf(onFile(file));
		expect(again).toEqual(memory.read());
		expect(foldLedger(again)).toEqual(foldLedger(memory.read()));
		expect(await holderIn(onFile(file), C)).toBeNull();
		expect(JSON.parse(await proc(["read", file]))).toEqual(summaryOf(memory.read()));
	});
});

describe("the claim across processes: the ledger's lease", () => {
	/** `lanes` processes, each started, then all told one start time once every one said `ready`. */
	const race = async (how: "cas" | "blind", lanes: readonly string[], rounds: number) => {
		const file = scratch();
		// The file and its tables first, so the processes do not race to make them.
		await entriesOf(onFile(file));
		const started = lanes.map((lane) => started1(["claim", file, lane, String(rounds), "25", how]));
		await Promise.all(started.map((s) => s.ready));
		writeFileSync(`${file}.go`, String(Date.now() + 300));
		const outs = await Promise.all(started.map((s) => s.done));
		const told = (round: number) =>
			outs.map(
				(out) =>
					out
						.split("\n")
						.find((l) => l.startsWith(`told ${round} `))
						?.split(" ")[2],
			);
		const refused = outs.map((out) => Number(/refused (\d+)/.exec(out)?.[1]));
		return {file, told, refused};
	};

	it("four processes claim the same ticket at the same moment, forty times over: the ledger takes exactly one claim each time, and all four are told the same lane", async () => {
		const lanes = ["L1", "L2", "L3", "L4"];
		const {file, told, refused} = await race("cas", lanes, 40);
		const rows = await Effect.runPromise(
			Ledger.use((l) => l.read(0, 100_000, ROOT)).pipe(Effect.provide(onFile(file)), Effect.scoped),
		);
		for (let round = 1; round <= 40; round++) {
			const ticket = ticketId(`o/r#${round}`);
			const claims = rows.filter((r) => r.stream === ticketName(ticket) && r.kind === "claimed");
			expect(claims).toHaveLength(1);
			expect(told(round)).toEqual(lanes.map(() => claims[0]?.writer));
		}
		// The race was real: claims lost to another process.
		expect(refused.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
		// Claims are the ledger's own events: no pipeline fact was written.
		expect(await entriesOf(onFile(file))).toEqual([]);
	});

	it("planted: the same race with the lease read, then the ticket taken with no claim, tells two processes they both hold one ticket", async () => {
		const {told} = await race("blind", ["L1", "L2", "L3", "L4"], 40);
		const split = Array.from({length: 40}, (_, i) => new Set(told(i + 1)).size).filter(
			(n) => n > 1,
		);
		expect(split.length).toBeGreaterThan(0);
	});

	it("three layers over one file in one process, claiming at once twenty times: one holds each ticket", async () => {
		const file = scratch();
		for (let run = 1; run <= 20; run++) {
			const ticket = ticketId(`o/r#${run}`);
			const told = await Promise.all(
				["L1", "L2", "L3"].map((lane) => on(onFile(file), claim(ticket, laneId(lane)))),
			);
			expect(new Set(told).size).toBe(1);
			expect(await holderIn(onFile(file), ticket)).toBe(told[0]);
		}
	});
});

describe("what the ledger can hold under pipeline/", () => {
	const lane = (n: number): Fact => ({type: "lane", ticket: ticketId(`o/r#${n}`)});
	const reviewed: Fact = {type: "reviewed", plan: planOf(ticketId("o/r#1")), task: T1, open: 0};

	/**
	 * A file holding `facts`, then its one row of `type` changed in place by `sql` (with `?` the
	 * row's pos): a row written past the pipeline's own calls, as a bad tool or a torn copy would.
	 */
	const planted = async (facts: readonly Fact[], type: string, sql: string) => {
		const file = scratch();
		for (const fact of facts)
			await Effect.runPromise(send(fact).pipe(Effect.provide(onFile(file))));
		// The ledger's own driver, past its rules.
		const {db, close} = openDb(file);
		const [row] = db.all("SELECT pos FROM events WHERE kind = ?", type);
		db.all(sql, Number(row?.pos));
		close();
		return onFile(file);
	};

	it("a new file: no facts, and the first fact reads back as place 1", async () => {
		const file = scratch();
		expect(await entriesOf(onFile(file))).toEqual([]);
		await Effect.runPromise(send(lane(1)).pipe(Effect.provide(onFile(file))));
		expect(await entriesOf(onFile(file))).toEqual([{seq: 1, fact: lane(1)}]);
	});

	it("a row that is not a fact stops the read, naming its place and stream: it is never skipped", async () => {
		const cases: readonly [string, string, RegExp][] = [
			[
				"a kind that is no fact",
				"UPDATE events SET kind = 'nope' WHERE pos = ?",
				/ledger at \d+ \(pipeline\/ticket\/o\/r#1\/inbox\): a nope event is not a fact/,
			],
			[
				"data that is not JSON",
				"UPDATE events SET data = '{torn' WHERE pos = ?",
				/its data is not JSON/,
			],
			[
				"a fact that does not fit",
				`UPDATE events SET data = '{"type":"lane"}' WHERE pos = ?`,
				/not a lane fact/,
			],
			[
				"a fact written as another kind",
				"UPDATE events SET kind = 'released' WHERE pos = ?",
				/a lane fact written as released/,
			],
		];
		for (const [what, sql, why] of cases) {
			const ledger = await planted([lane(1), lane(2)], "lane", sql);
			expect(await brokenBy(ledger, readFacts), what).toMatch(why);
		}
	});

	it("a fact read back from another name's stream breaks the read: one ticket's fact in another's inbox, a plan's in a ticket's, a ticket's in a plan's", async () => {
		const T2 = `${ticketName(ticketId("o/r#2"))}/inbox`;
		const P1 = `${planName(planOf(ticketId("o/r#1")))}/inbox`;
		const T1n = `${ticketName(ticketId("o/r#1"))}/inbox`;
		const plants: readonly [Fact, string, string][] = [
			[lane(1), "lane", T2],
			[reviewed, "reviewed", T1n],
			[lane(1), "lane", P1],
		];
		for (const [fact, type, stream] of plants) {
			const ledger = await planted(
				[fact],
				type,
				`UPDATE events SET stream = '${stream}', rev = 1000 WHERE pos = ?`,
			);
			expect(await brokenBy(ledger, readFacts)).toMatch(/a fact of .* read from /);
		}
	});

	it("a fact that does not fit its schema is never written", async () => {
		const memory = memoryLedger();
		// Its type fits; its schema does not: a count of open criteria is a whole number.
		const bad: Fact = {type: "reviewed", plan: planOf(A), task: T1, open: 1.5};
		expect(await brokenBy(memory.layer, sendFact(bad))).toMatch(/open/);
		expect(memory.rows()).toEqual([]);
	});

	it("one message id writes a fact once, however many times it is sent", async () => {
		const memory = memoryLedger();
		const sent = await Effect.runPromise(
			Effect.all(
				Array.from({length: 5}, () => sendFact(lane(1), {id: "once"})),
				{concurrency: "unbounded"},
			).pipe(Effect.provide(memory.layer)),
		);
		expect(sent.filter((s) => !s.dup)).toHaveLength(1);
		expect(memory.read()).toEqual([{seq: 1, fact: lane(1)}]);
	});
});

describe("a call on `Self` while the ledger does not answer (151)", () => {
	/** A call that answers each word in turn, then the last one again. */
	const scripted = <W>(words: readonly W[]) => {
		let tries = 0;
		const call = Effect.sync(() => words[Math.min(tries++, words.length - 1)] as W);
		return {call, tries: () => tries};
	};

	it("is asked again until the ledger answers, and the answer comes back as it came: a word or a record, `fenced` at once", async () => {
		const trap = scripted<"ok" | "fenced" | "unreachable">(["unreachable", "unreachable", "ok"]);
		expect(await Effect.runPromise(steadyCall("trap exits", trap.call))).toBe("ok");
		expect(trap.tries()).toBe(3);

		type Start = {readonly how: "ok"; readonly started: boolean} | {readonly how: "unreachable"};
		const start = scripted<Start>([{how: "unreachable"}, {how: "ok", started: false}]);
		expect(await Effect.runPromise(steadyCall("start a child", start.call))).toEqual({
			how: "ok",
			started: false,
		});

		const lost = scripted<"ok" | "fenced" | "unreachable">(["fenced", "ok"]);
		expect(await Effect.runPromise(steadyCall("trap exits", lost.call))).toBe("fenced");
		expect(lost.tries()).toBe(1);
	});
});
