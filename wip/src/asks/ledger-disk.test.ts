import {execFile} from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Cause, type Duration, Effect, Exit, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {CriteriaRecord, ledgerRecord} from "../criteria/record.ts";
import {type LaneId, laneId, planOf, type TicketId, taskId, ticketId} from "../ids.ts";
import {RULINGS} from "./cases.ts";
import {claim, holderOf, newLane, release} from "./claims.ts";
import {demoFacts} from "./demo.ts";
import {type Fact, Ledger, memoryLedger} from "./ledger.ts";
import {diskLedger, LedgerBroken} from "./ledger-disk.ts";
import {foldLedger, openAsks, planAskId, rulingId} from "./rules.ts";

// The ledger kept on disk: one JSON line per fact, folded again on every
// read. The user's job first: what one process writes, a fresh layer and a
// fresh process fold back to the same state the in-memory ledger folds from
// the same calls. Then the claim across real processes, and what a torn, bad,
// empty or missing file does.

const PROC = fileURLToPath(new URL("../../../fixtures/disk-ledger/proc.ts", import.meta.url));

const scratch = () => join(mkdtempSync(join(tmpdir(), "disk-ledger-")), "ledger.jsonl");
const disk = (file: string, wait?: Duration.Input) =>
	diskLedger(file, wait === undefined ? {} : {wait}).pipe(Layer.provide(nodeServices));

const read = Effect.gen(function* () {
	return yield* (yield* Ledger).entries;
});
const append = (fact: Fact) =>
	Effect.gen(function* () {
		return yield* (yield* Ledger).append(fact);
	});
const appendAfter = (after: number, fact: Fact) =>
	Effect.gen(function* () {
		return yield* (yield* Ledger).appendAfter(after, fact);
	});

/** Run `body` over a ledger layer, with the criteria record on top of it. */
const on = <A, E>(
	ledger: Layer.Layer<Ledger>,
	body: Effect.Effect<A, E, Ledger | CriteriaRecord>,
) => Effect.runPromise(body.pipe(Effect.provide(Layer.provideMerge(ledgerRecord, ledger))));

const entriesOf = (ledger: Layer.Layer<Ledger>) => Effect.runPromise(Effect.provide(read, ledger));

/** The defect `body` dies with: a `LedgerBroken`, by its message. */
const brokenBy = async <A>(ledger: Layer.Layer<Ledger>, body: Effect.Effect<A, never, Ledger>) => {
	const exit = await Effect.runPromiseExit(body.pipe(Effect.provide(ledger)));
	if (Exit.isSuccess(exit)) throw new Error("it did not fail");
	const error = Cause.squash(exit.cause);
	expect(error).toBeInstanceOf(LedgerBroken);
	return (error as LedgerBroken).message;
};

/**
 * A second process on the ledger (fixtures/disk-ledger/proc.ts). `ready`: it
 * said `ready`; `done`: everything it printed, once it ended well.
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
	for (const fact of demoFacts()) yield* append(fact);
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
		yield* append({
			type: "answered",
			id: rulingId(ruling.ruling.ticket),
			answer: {kind: "rule", answer: "Keep it.", rule: "one_off", build: false},
		});
	yield* append({type: "answered", id: planAskId(planOf(B), 1), answer: {kind: "approve"}});
	yield* append({type: "built", plan: planOf(B), task: T1, changes: ["src/a.ts"], holds: 1});
	yield* append({type: "cleared", plan: planOf(B), task: T1, build: 1, by: "ui-check"});
	yield* append({type: "shipped", plan: planOf(B), task: T1, build: 1});
	yield* release(A, lanes[A] as LaneId);
	return {lanes, late, told};
});

/** A later run on the same ledger: the late lane takes A now, A is reviewed again, C is let go. */
const secondRun = (lanes: Record<string, LaneId>, late: LaneId) =>
	Effect.gen(function* () {
		const holder = yield* claim(A, late);
		yield* review(A, "a2", false, []);
		yield* release(C, lanes[C] as LaneId);
		const ruling = RULINGS[1];
		if (ruling !== undefined)
			yield* append({
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

describe("the ledger on disk: the user's job", () => {
	it("six plans, three lanes, reviews, answers and a ship, written in one process: a fresh layer and a fresh process fold the same state as memory, run after run", async () => {
		const file = scratch();
		const memory = memoryLedger();

		const onDisk = await on(disk(file), firstRun);
		const inMemory = await on(memory.layer, firstRun);
		expect(onDisk).toEqual(inMemory);
		expect(onDisk.told).toBe(onDisk.lanes[A]);

		const back = await entriesOf(disk(file));
		expect(back).toEqual(memory.read());
		expect(foldLedger(back)).toEqual(foldLedger(memory.read()));
		expect(back.length).toBeGreaterThan(30);
		expect(holderOf(back, A)).toBeNull();
		expect(holderOf(back, B)).toBe(onDisk.lanes[B]);

		const fresh = JSON.parse(await proc(["read", file]));
		expect(fresh).toEqual(summaryOf(memory.read()));
		expect(fresh.open.length).toBeGreaterThan(5);

		// Run again on the same file, from a new layer: more facts, then read again.
		const heldOnDisk = await on(disk(file), secondRun(onDisk.lanes, onDisk.late));
		const heldInMemory = await on(memory.layer, secondRun(inMemory.lanes, inMemory.late));
		expect(heldOnDisk).toBe(heldInMemory);
		expect(heldOnDisk).toBe(onDisk.late);

		const again = await entriesOf(disk(file));
		expect(again).toEqual(memory.read());
		expect(foldLedger(again)).toEqual(foldLedger(memory.read()));
		expect(holderOf(again, C)).toBeNull();
		expect(JSON.parse(await proc(["read", file]))).toEqual(summaryOf(memory.read()));
	}, 30_000);
});

describe("the claim across processes: one compare-and-set", () => {
	/** `lanes` processes, each started, then all told one start time once every one said `ready`. */
	const race = async (how: "cas" | "blind", lanes: readonly string[], rounds: number) => {
		const file = scratch();
		const started = lanes.map((lane) => started1(["claim", file, lane, String(rounds), "20", how]));
		await Promise.all(started.map((s) => s.ready));
		writeFileSync(`${file}.go`, String(Date.now() + 200));
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

	it("four processes claim the same ticket at the same moment, forty times over: exactly one claim is written each time, and all four are told the same lane", async () => {
		const lanes = ["L1", "L2", "L3", "L4"];
		const {file, told, refused} = await race("cas", lanes, 40);
		const entries = await entriesOf(disk(file));
		for (let round = 1; round <= 40; round++) {
			const ticket = ticketId(`o/r#${round}`);
			const claims = entries.filter((e) => e.fact.type === "claimed" && e.fact.ticket === ticket);
			expect(claims).toHaveLength(1);
			const holder = holderOf(entries, ticket);
			expect(told(round)).toEqual(lanes.map(() => holder));
		}
		expect(entries).toHaveLength(40);
		// The race was real: compare-and-sets lost to another process.
		expect(refused.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
		expect(existsSync(`${file}.lock`)).toBe(false);
	}, 60_000);

	it("planted: the same race with a claim read, then written with no compare, tells two processes they both hold one ticket", async () => {
		const {told} = await race("blind", ["L1", "L2", "L3", "L4"], 40);
		const split = Array.from({length: 40}, (_, i) => new Set(told(i + 1)).size).filter(
			(n) => n > 1,
		);
		expect(split.length).toBeGreaterThan(0);
	}, 60_000);

	it("three layers over one file in one process, claiming at once twenty times: one holds each ticket", async () => {
		const file = scratch();
		for (let run = 1; run <= 20; run++) {
			const ticket = ticketId(`o/r#${run}`);
			const told = await Effect.runPromise(
				Effect.all(
					["L1", "L2", "L3"].map((lane) =>
						claim(ticket, laneId(lane)).pipe(Effect.provide(disk(file))),
					),
					{concurrency: "unbounded"},
				),
			);
			expect(new Set(told).size).toBe(1);
		}
		const entries = await entriesOf(disk(file));
		expect(entries.filter((e) => e.fact.type === "claimed")).toHaveLength(20);
	});

	it("appendAfter refuses when the file no longer ends where it was read, and adds nothing", async () => {
		const file = scratch();
		const lane: Fact = {type: "lane", ticket: ticketId("o/r#1")};
		await Effect.runPromise(append(lane).pipe(Effect.provide(disk(file))));
		const refused = await Effect.runPromise(appendAfter(0, lane).pipe(Effect.provide(disk(file))));
		expect(refused).toBeNull();
		const taken = await Effect.runPromise(appendAfter(1, lane).pipe(Effect.provide(disk(file))));
		expect(taken?.seq).toBe(2);
		expect(await entriesOf(disk(file))).toHaveLength(2);
	});
});

describe("what the file can hold", () => {
	const lane = (n: number): Fact => ({type: "lane", ticket: ticketId(`o/r#${n}`)});
	const line = (fact: Fact) => `${JSON.stringify(fact)}\n`;

	it("missing, in a folder that is not there: no facts, and the first append is place 1", async () => {
		const file = join(scratch(), "..", "deeper", "still", "ledger.jsonl");
		expect(await entriesOf(disk(file))).toEqual([]);
		const entry = await Effect.runPromise(append(lane(1)).pipe(Effect.provide(disk(file))));
		expect(entry.seq).toBe(1);
	});

	it("empty: no facts", async () => {
		const file = scratch();
		writeFileSync(file, "");
		expect(await entriesOf(disk(file))).toEqual([]);
	});

	it("a torn last line (a writer killed mid-line) is not read, and the next writer cuts it off before it appends", async () => {
		const file = scratch();
		writeFileSync(file, line(lane(1)) + line(lane(2)));
		appendFileSync(file, '{"type":"lane","tick');
		expect((await entriesOf(disk(file))).map((e) => e.seq)).toEqual([1, 2]);

		// The compare counts whole lines only: the torn one never landed.
		const entry = await Effect.runPromise(appendAfter(2, lane(3)).pipe(Effect.provide(disk(file))));
		expect(entry?.seq).toBe(3);
		expect(readFileSync(file, "utf8")).toBe(line(lane(1)) + line(lane(2)) + line(lane(3)));
		expect((await entriesOf(disk(file))).map((e) => e.fact)).toEqual([lane(1), lane(2), lane(3)]);
	});

	it("a last line with no newline is torn even when its JSON is whole: its writer never said it landed", async () => {
		const file = scratch();
		writeFileSync(file, line(lane(1)) + JSON.stringify(lane(2)));
		expect(await entriesOf(disk(file))).toHaveLength(1);
	});

	it("a line that is not a fact stops the read, naming the file and the line: it is never skipped", async () => {
		const file = scratch();
		writeFileSync(file, `${line(lane(1))}{"type":"nope"}\n${line(lane(3))}`);
		const reading = read;
		expect(await brokenBy(disk(file), reading)).toMatch(
			new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:2: not a ledger fact`),
		);

		writeFileSync(file, "not json\n");
		expect(await brokenBy(disk(file), reading)).toContain(`${file}:1: not a ledger fact`);

		writeFileSync(file, `${line(lane(1))}\n${line(lane(3))}`);
		expect(await brokenBy(disk(file), reading)).toContain(`${file}:2: not a ledger fact`);

		writeFileSync(
			file,
			Buffer.concat([Buffer.from(line(lane(1))), Buffer.from([0xff, 0xfe, 0x0a])]),
		);
		expect(await brokenBy(disk(file), reading)).toContain(`${file}:2: not UTF-8 text`);
	});

	it("a fact that does not fit the schema is never written", async () => {
		const file = scratch();
		// Its type fits; its schema does not: a count of open criteria is a whole number.
		const bad: Fact = {type: "reviewed", plan: planOf(A), task: T1, open: 1.5};
		expect(await brokenBy(disk(file), append(bad))).toContain("cannot write the fact as a line");
		expect(existsSync(file)).toBe(false);
	});

	it("a lock left by a killed writer stops every write, loudly, naming the lock and its holder; removed, writes go on", async () => {
		const file = scratch();
		const lock = `${file}.lock`;
		writeFileSync(lock, "pid 4242 since 2026-10-19T00:00:00.000Z\n");
		const message = await brokenBy(disk(file, "100 millis"), append(lane(1)));
		expect(message).toContain(lock);
		expect(message).toContain("pid 4242");
		expect(existsSync(file)).toBe(false);

		rmSync(lock);
		const entry = await Effect.runPromise(append(lane(1)).pipe(Effect.provide(disk(file))));
		expect(entry.seq).toBe(1);
		expect(existsSync(lock)).toBe(false);
	});
});
