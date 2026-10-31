import {mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {Effect, Fiber, Layer, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../../host/host-jobs.ts";
import {traceIdOf} from "../../host/jobs.ts";
import {keepJobs, layerRecordTraces, type Records, stepsInto} from "../../host/records.ts";
import {sqliteRecords} from "../../host/sqlite-records.ts";
import {Traces} from "../../host/traces.ts";
import {ear} from "../../program/ear.ts";
import {start, tell} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {Programs, programList} from "../programs.ts";
import {type Printed, type Ready, tsh} from "../shell.ts";
import {SMALL} from "../small.ts";
import {recordTracing} from "./otel.ts";

// A host's own records, filled by a real tsh line: the job's start and end from the table, the
// steps from the runs' storage, the spans from the tracer. One file, the job's; nothing for tsh's
// own run or the table's.

const dir = mkdtempSync(join(tmpdir(), "records-"));
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
				{id: "tsh:records", storage},
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

describe("a host's records", () => {
	it("keep a tsh line's job: its start and end, its runs' spans, and tally's steps", async () => {
		const at = join(dir, "line");
		const record = await Effect.runPromise(lineIn(at, "seq --to 3 | tally"));
		expect(record.job).toMatchObject({
			n: 1,
			text: "seq --to 3 | tally",
			host: "laptop",
			by: "user:owner",
		});
		expect(record.job?.ended?.how).toBe("done");
		const services = new Set(record.spans.map((s) => s.service));
		expect(services).toContain("seq");
		expect(services).toContain("tally");
		// The line's span is the one root: its name is the line's programs.
		expect(record.spans.filter((s) => s.parent === null).map((s) => s.name)).toEqual([
			"seq | tally",
		]);
		expect(record.steps.map((s) => [s.machine, s.n])).toEqual([
			["count", 1],
			["count", 2],
			["count", 3],
		]);
		// One file: the job's. tsh's own run and the host's table began no job.
		expect(readdirSync(at).filter((f) => f.endsWith(".sqlite"))).toEqual([
			`${record.trace}.sqlite`,
		]);
	});

	it("keep a failed line's end as failed", async () => {
		const record = await Effect.runPromise(lineIn(join(dir, "failed"), "false"));
		expect(record.job).toMatchObject({text: "false", ended: {how: "failed"}});
	});

	it("read a trace no job began as empty, and make no file for it", async () => {
		const at = join(dir, "empty");
		const trace = "0".repeat(32);
		const read = await Effect.runPromise(
			Effect.gen(function* () {
				const records = yield* sqliteRecords({dir: at, by: "user:owner"});
				yield* records.calls(trace, {op: "ended", how: "done", at: 1});
				return yield* readOn(records, trace);
			}).pipe(Effect.scoped, Effect.provide(node)),
		);
		expect(read).toEqual({trace, job: null, runs: [], spans: [], steps: [], opened: []});
		expect(readdirSync(at)).toEqual([]);
	});

	it("are read again for a follower on each write to the record followed, and only to it", async () => {
		const one = "1".repeat(32);
		const two = "2".repeat(32);
		const reads = await Effect.runPromise(
			Effect.gen(function* () {
				const records = yield* sqliteRecords({dir: join(dir, "changes"), by: "user:owner"});
				const watch = yield* Effect.gen(function* () {
					return (yield* Traces).watch(one);
				}).pipe(Effect.provide(layerRecordTraces(records)));
				const following = yield* watch.pipe(
					Stream.takeUntil((t) => t.job?.ended !== null && t.job?.ended !== undefined),
					Stream.runCollect,
					Effect.forkScoped,
				);
				yield* records.calls(two, {op: "began", n: 2, text: "seq", host: "laptop", at: 1});
				yield* records.calls(one, {op: "began", n: 1, text: "seq", host: "laptop", at: 1});
				yield* records.calls(one, {op: "ended", how: "done", at: 2});
				return yield* Fiber.join(following).pipe(Effect.timeout("5 seconds"));
			}).pipe(Effect.scoped, Effect.provide(node)),
		);
		expect(reads.every((t) => t.trace === "1".repeat(32))).toBe(true);
		expect(reads.at(-1)?.job).toMatchObject({text: "seq", ended: {how: "done", at: 2}});
	});
});
