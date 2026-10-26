import {Duration, Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {SAVED_BY_OLDER_CODE} from "./execute.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, TABLE, TABLE_REFUSED, tsh} from "./shell.ts";
import {SMALL, tally} from "./small.ts";

// tsh over kept state that older code saved, as laws over any set of jobs, any of them saved by
// older code, attached in any order:
//
//   a job saved by older code stays detached, says so, and its kept state is as older code left it
//   every other job attaches, and goes on from its own total, whatever was refused before it
//   a job table saved by older code is never written over, whatever lines tsh then runs
//
// A few runs each: each run starts two tsh. ./execute.test.ts walks one case by hand.

const SMALL_LIST = programList(SMALL);
/** tally's total as this code keeps it, and as older code might have: under a key it does not have. */
const Total = tally.machines.count.state;
const OlderTotal = Schema.Struct({sum: Schema.Int});
/** The job table as older code might have kept it. */
const OlderTable = Schema.Struct({list: Schema.Array(Schema.String)});

let runs = 0;

/** One tsh on a storage. `line` tells it a line and answers what it printed for it. */
const session = (storage: Storage) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:laws-${runs}`, storage},
		).pipe(Effect.provideService(Programs, SMALL_LIST), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				yield* ready.upTo(told);
				const said = printed.values.slice(from);
				return {
					out: said.filter((p) => p.to === "out").map((p) => p.text),
					err: said.filter((p) => p.to === "err").map((p) => p.text),
				};
			});
		/** Wait until tsh has printed `text`: a job's end comes when it comes. */
		const heard = (text: string) =>
			Effect.gen(function* () {
				while (!printed.values.some((p) => p.text === text))
					yield* Effect.sleep(Duration.millis(5));
			});
		const said = () => printed.values.map((p) => p.text);
		return {started, line, heard, said};
	});

/** One job: what it adds before the restart, and whether older code then saved its total. */
const Job = fc.record({add: fc.integer({min: 1, max: 8}), older: fc.boolean()});
/** One to four jobs, and the order the new tsh attaches them in. */
const jobsAndOrder = fc.array(Job, {minLength: 1, maxLength: 4}).chain((jobs) =>
	fc.tuple(
		fc.constant(jobs),
		fc.shuffledSubarray(
			jobs.map((_, i) => i),
			{minLength: jobs.length, maxLength: jobs.length},
		),
	),
);

describe("tsh over jobs saved by older code", () => {
	it("a job saved by older code stays detached with its state as it was; every other job attaches and goes on", async () => {
		/** Runs where a job saved by older code was attached before one that was not. */
		let refusedFirst = 0;
		await fc.assert(
			fc.asyncProperty(jobsAndOrder, async ([jobs, order]) => {
				const firstGood = order.findIndex((i) => jobs[i]?.older === false);
				if (order.slice(0, Math.max(firstGood, 0)).some((i) => jobs[i]?.older)) refusedFirst += 1;
				const storage = memoryStorage();
				const ids = await Effect.runPromise(
					Effect.gen(function* () {
						const {line, heard, started} = yield* session(storage);
						const out: string[] = [];
						for (const [i, job] of jobs.entries()) {
							const n = i + 1;
							out.push((yield* line("tally &")).err[0]?.split(" ")[1] ?? "");
							yield* line(`tell %${n} add ${job.add}`);
							yield* heard(`[${n}] ${job.add}`);
						}
						yield* started.stop;
						return out;
					}).pipe(Effect.scoped),
				);
				for (const [i, job] of jobs.entries()) {
					if (!job.older) continue;
					const old = await Effect.runPromise(storage.open(ids[i] ?? "", null));
					await old.store("count", "total", OlderTotal).save({sum: job.add});
				}

				const listed = await Effect.runPromise(
					Effect.gen(function* () {
						const {line, heard} = yield* session(storage);
						yield* line("");
						for (const i of order) {
							const n = i + 1;
							const job = jobs[i];
							if (job === undefined) continue;
							const {err} = yield* line(`attach %${n} &`);
							if (job.older) {
								yield* heard(`[${n}] ${SAVED_BY_OLDER_CODE}  tally`);
								yield* heard(`[${n}] it stays in the table, detached; stop %${n} drops it`);
								continue;
							}
							expect(err).toEqual([`[${n}] attached ${ids[i]}`]);
							yield* line(`tell %${n} add 1`);
							yield* heard(`[${n}] ${job.add + 1}`);
						}
						return (yield* line("jobs")).out;
					}).pipe(Effect.scoped),
				);
				expect(listed).toEqual(
					jobs.flatMap((job, i) =>
						job.older
							? [`[${i + 1}] detached  tally`]
							: [`[${i + 1}] running   tally`, `      total ${job.add + 1}`],
					),
				);
				for (const [i, job] of jobs.entries()) {
					const kept = await Effect.runPromise(storage.open(ids[i] ?? "", null));
					if (job.older)
						expect(await Effect.runPromise(kept.read("count", "total", OlderTotal))).toEqual({
							sum: job.add,
						});
					else
						expect(await Effect.runPromise(kept.read("count", "total", Total))).toEqual({
							total: job.add + 1,
						});
				}
			}),
			{numRuns: 12, seed: 1},
		);
		expect(refusedFirst).toBeGreaterThan(0);
	});

	it("a job table saved by older code is never written over, whatever lines tsh runs on it", async () => {
		const lines = fc.array(
			fc.constantFrom(
				"tally &",
				"tell %1 add 2",
				"jobs",
				"say --text still",
				"stop %1",
				"attach %1 &",
			),
			{minLength: 1, maxLength: 6},
		);
		await fc.assert(
			fc.asyncProperty(lines, async (told) => {
				const storage = memoryStorage();
				const home = await Effect.runPromise(storage.open(TABLE.run, null));
				await home.store(TABLE.machine, TABLE.key, OlderTable).save({list: ["tally"]});
				const said = await Effect.runPromise(
					Effect.gen(function* () {
						const {line, said} = yield* session(storage);
						for (const text of told) yield* line(text);
						return said();
					}).pipe(Effect.scoped),
				);
				expect(said[0]).toBe(TABLE_REFUSED);
				expect(said.filter((text) => text === TABLE_REFUSED)).toHaveLength(1);
				const after = await Effect.runPromise(storage.open(TABLE.run, null));
				expect(await Effect.runPromise(after.read(TABLE.machine, TABLE.key, OlderTable))).toEqual({
					list: ["tally"],
				});
			}),
			{numRuns: 12, seed: 1},
		);
	});
});
