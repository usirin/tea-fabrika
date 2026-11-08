import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {Effect, Layer} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../../host/host-jobs.ts";
import {traceIdOf} from "../../host/jobs.ts";
import {keepJobs, layerRecordTraces, type Records, stepsInto} from "../../host/records.ts";
import {layerReplayer, Replayer, replayOf} from "../../host/replay.ts";
import {sqliteRecords} from "../../host/sqlite-records.ts";
import {type JobTrace, Traces} from "../../host/traces.ts";
import {ear} from "../../program/ear.ts";
import {start, tell} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {Programs, programList} from "../programs.ts";
import {type Printed, type Ready, tsh} from "../shell.ts";
import {SMALL, tally} from "../small.ts";
import {recordTracing} from "./otel.ts";

// The proof on a real run (docs/plan/replay-through-current-code.md, section 4). Today's version.
// `seq --to 3 | tally` runs through a real tsh, the host's job table and `sqliteRecords`, the
// app's own pieces, as ./records.test.ts runs them. Its record keeps count total's start and its
// three steps, and that machine run is replayed through tally's own `count`, through one whose
// `add` adds n + 1, and through one with no `add` at all.

const dir = mkdtempSync(join(tmpdir(), "replay-"));
afterAll(() => rmSync(dir, {recursive: true, force: true}));

const node = Layer.mergeAll(nodeFileSystem, nodePath);

const readOn = (records: Records, trace: string) =>
	Effect.gen(function* () {
		return yield* (yield* Traces).read(trace);
	}).pipe(Effect.provide(layerRecordTraces(records)));

/** One tsh told `line` on records in `at`, then the line's job's record, read after tsh ended. */
const lineIn = (at: string, line: string) =>
	Effect.gen(function* () {
		const records = yield* sqliteRecords({dir: at, by: "user:owner"});
		const storage = memoryStorage(stepsInto(records));
		const trace = yield* Effect.gen(function* () {
			const jobs = keepJobs(yield* openJobs(storage), records, "laptop");
			const printed = ear<Printed>();
			const ready = ear<Ready>();
			const started = yield* start(
				tsh,
				{show: "short"},
				{printed: printed.hear, ready: ready.hear},
				{id: "tsh:replay", storage},
			).pipe(
				Effect.provideService(Programs, programList(SMALL)),
				Effect.provideService(HostJobs, jobs),
			);
			if (started.kind !== "running") return yield* Effect.die("tsh did not start");
			let first: string | null = null;
			const off = jobs.table.subscribe(() => {
				const job = jobs.table.getState().jobs[0];
				if (first === null && job !== undefined) first = traceIdOf(job);
			});
			yield* tell(started.run, "line", line);
			yield* ready.upTo(1);
			off();
			started.close("line");
			yield* started.run.ended;
			return first;
		}).pipe(Effect.scoped, Effect.provide(recordTracing(records)));
		if (trace === null) return yield* Effect.die("the line made no job");
		return yield* readOn(records, trace);
	}).pipe(Effect.scoped, Effect.provide(node));

/** count total's rows in a record: its starts and its steps. */
const countIn = (record: JobTrace) => ({
	starts: record.starts.filter((s) => s.machine === "count" && s.id === "total"),
	steps: record.steps.filter((s) => s.machine === "count" && s.id === "total"),
});

const count = tally.machines.count;

type Add = (
	s: {readonly total: number},
	m: {readonly type: "add"; readonly n: number},
) => readonly [{readonly total: number}, readonly never[]];

/** Today's code with tally's count changed: its `add` cell is `add`, or gone with `null`. */
const tallyWith = (add: Add | null) => {
	const {add: _, ...rest} = count.machine.update;
	return [
		{
			name: "tally",
			machines: {
				count: {
					...count,
					machine: {...count.machine, update: add === null ? rest : {...rest, add}},
				},
			},
		},
	];
};

describe("a real run of seq --to 3 | tally, replayed through today's code", () => {
	// Run once, at the first test that asks, and shared by the rest.
	let ran: Promise<JobTrace> | undefined;
	const recorded = () => {
		ran ??= Effect.runPromise(lineIn(join(dir, "three"), "seq --to 3 | tally"));
		return ran;
	};

	it("keeps count total's start and its three steps", async () => {
		const rows = countIn(await recorded());
		expect(rows.starts.map((s) => [s.program, s.n, s.after, s.state])).toEqual([
			["tally", 1, 0, {total: 0}],
		]);
		expect(rows.steps.map((s) => s.n)).toEqual([1, 2, 3]);
	});

	it("(a) through tally's own count: it matches at all 3 steps", async () => {
		expect(replayOf([tally], countIn(await recorded()))).toEqual({_tag: "matches", steps: 3});
	});

	it("(b) through a count whose add adds n + 1: it parts at step 1, at state.total, 1 recorded and 2 replayed", async () => {
		const plusOne = tallyWith((s, m) => [{total: s.total + m.n + 1}, []]);
		expect(replayOf(plusOne, countIn(await recorded()))).toEqual({
			_tag: "parts",
			n: 1,
			msg: {type: "add", n: 1},
			path: "state.total",
			recorded: 1,
			replayed: 2,
		});
	});

	it("(c) through a count with no add: it is refused at step 1, and nothing is accepted", async () => {
		expect(replayOf(tallyWith(null), countIn(await recorded()))).toMatchObject({
			_tag: "refused",
			n: 1,
			msg: {type: "add", n: 1},
			accepts: [],
		});
	});

	it("through the host's Replayer on the programs tsh lists: it matches", async () => {
		const rows = countIn(await recorded());
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* Replayer).replay(rows);
			}).pipe(Effect.provide(layerReplayer(SMALL))),
		);
		expect(answer).toEqual({_tag: "matches", steps: 3});
	});

	it("with its start taken out, as a record written before starts were kept: it cannot, no_start", async () => {
		const {steps} = countIn(await recorded());
		expect(replayOf([tally], {starts: [], steps})).toMatchObject({
			_tag: "cannot",
			why: "no_start",
			n: null,
		});
	});
});

describe("a real run of seq --to 25 | tally", () => {
	it("replays its 25 Msgs twice to the same answer, deep equal", async () => {
		const rows = countIn(await Effect.runPromise(lineIn(join(dir, "25"), "seq --to 25 | tally")));
		expect(rows.steps).toHaveLength(25);
		const once = replayOf([tally], rows);
		const twice = replayOf([tally], rows);
		expect(once).toEqual({_tag: "matches", steps: 25});
		expect(twice).toEqual(once);
	});
});
