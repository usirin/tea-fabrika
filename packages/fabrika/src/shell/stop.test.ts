import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {HostJobs, type JobTable, openJobs} from "../host/host-jobs.ts";
import type {Jobs} from "../host/jobs.ts";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// tsh's `stop` input (tracker 185b, PR 1): the host tells the tsh that started job n to stop it,
// for whoever asked, since only that tsh holds the job's runs. It is a control input, as `signal`
// is: a line queued behind a slow one never holds it up. It does what `stop %n` does, so the table
// is the same after either (d5). When the stopper is not this tsh's own writer, the tsh says who
// and why, in the tile the person was looking at. Today's version.
//
//   t1's tsh, as user:github:7     tsh$ sleep --ms 60000 &          job %1
//   the host, for claude           stopping {n: 1, by: "agent:claude for:github:7", why: "wrong ticket"}
//                                  then tells t1's tsh: stop 1
//   t1 prints                      [1] stopped by agent:claude for:github:7: wrong ticket
//
// The host's own `stopping` is kept once, so the tsh's own ask after it changes nothing: the job
// keeps the agent's stop, not the person's.

const PERSON = "user:github:7";
const AGENT = "agent:claude for:github:7";
const LIST = programList(SMALL);
const LONG = "sleep --ms 60000";

/** A tsh in tile t1, as `PERSON`, on a table of its own, its storage as `wrap` makes it. */
const tshOn = (wrap: (storage: Storage) => Storage) =>
	Effect.gen(function* () {
		const storage = wrap(memoryStorage());
		const jobs = yield* openJobs(storage);
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:stop", storage},
		).pipe(
			Effect.provideService(HostJobs, {...jobs, owner: "t1", by: PERSON}),
			Effect.provideService(Programs, LIST),
		);

		if (started.kind !== "running") {
			return yield* Effect.die("tsh did not start");
		}

		let told = 0;
		/** One line, and its `ready`. */
		const line = (text: string) =>
			Effect.gen(function* () {
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				return all[told - 1];
			});
		/** The host's word to this tsh: stop job n. */
		const stop = (n: number): Effect.Effect<string, unknown> => tell(started.run, "stop", n);
		return {table: jobs.table, run: started.run, printed, ready, line, stop};
	});

/** A tsh in tile t1, as `PERSON`, on a table of its own. */
const tshInT1 = tshOn((storage) => storage);

/**
 * A storage whose `sleep` runs take 100 ms to open, as a slow disk would: the job is in the table
 * that long before tsh holds its runs.
 */
const slowSleep = (storage: Storage): Storage => ({
	record: (run) => storage.record(run),
	remove: (run) => storage.remove(run),
	open: (run, flags) =>
		run.startsWith("sleep")
			? Effect.sleep("100 millis").pipe(Effect.andThen(storage.open(run, flags)))
			: storage.open(run, flags),
});

/** Wait for `check` to answer something, three seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 300; i += 1) {
			const got = check();

			if (got !== undefined) {
				return got;
			}

			yield* Effect.sleep("10 millis");
		}

		return yield* Effect.die(`waited for ${what}`);
	});

/** The table as two tsh's can share it: run ids are made fresh at each start, so they go. */
const shapeOf = (s: Jobs) => ({
	next: s.next,
	jobs: s.jobs.map(({stages, ...job}) => ({
		...job,
		stages: stages.map(({run: _, ...stage}) => stage),
	})),
});

/** The table once it has held still for 60 ms, three seconds at most. */
const settled = (table: JobTable) =>
	Effect.gen(function* () {
		let last = JSON.stringify(shapeOf(table.getState()));
		let still = 0;

		for (let i = 0; i < 300 && still < 6; i += 1) {
			yield* Effect.sleep("10 millis");
			const now = JSON.stringify(shapeOf(table.getState()));
			still = now === last ? still + 1 : 0;
			last = now;
		}

		return shapeOf(table.getState());
	});

/** A job of the table before the stop: run by this tsh, by another tile's, or detached. */
type Kind = "here" | "other" | "detached";

/** The table holds `kinds`, in order, numbered from 1. */
const setUp = (t: Effect.Success<typeof tshInT1>, kinds: readonly Kind[]) =>
	Effect.gen(function* () {
		for (const [i, kind] of kinds.entries()) {
			if (kind === "here") {
				yield* t.line(`${LONG} &`);
				continue;
			}

			yield* t.table.dispatch({
				type: "began",
				text: LONG,
				stages: [
					{
						program: "sleep",
						flags: {ms: 60000},
						run: `sleep-${kind}-${i}`,
						wire: null,
						ended: false,
					},
				],
				background: true,
				owner: kind === "other" ? "t2" : "t1",
				by: kind === "other" ? "user:github:8" : PERSON,
			});

			if (kind === "detached") {
				yield* t.table.dispatch({type: "detached", n: t.table.getState().next - 1});
			}
		}
	});

describe("tsh's stop input does what stop %n does", () => {
	it("leaves the same table as stop %n, for a job run here, another tile's, a detached one, or none", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom<Kind>("here", "other", "detached"), {minLength: 1, maxLength: 4}),
				fc.nat({max: 4}),
				(kinds, at) =>
					Effect.runPromise(
						Effect.gen(function* () {
							// n past the table's last job, at times: a job there is not.
							const n = Math.min(at, kinds.length) + 1;
							const byLine = yield* Effect.gen(function* () {
								const t = yield* tshInT1;
								yield* setUp(t, kinds);
								yield* t.line(`stop %${n}`);
								return yield* settled(t.table);
							}).pipe(Effect.scoped);
							const byInput = yield* Effect.gen(function* () {
								const t = yield* tshInT1;
								yield* setUp(t, kinds);
								expect(yield* t.stop(n)).toBe("queued");
								const want = JSON.stringify(byLine);
								yield* until("the same table", () =>
									JSON.stringify(shapeOf(t.table.getState())) === want ? true : undefined,
								).pipe(Effect.ignore);
								return yield* settled(t.table);
							}).pipe(Effect.scoped);
							expect(byInput).toEqual(byLine);
						}),
					),
			),
			{numRuns: 20, seed: 119120},
		);
	}, 120_000);

	it("stops a foreground job however many lines wait behind it: it is a control input", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshInT1;
				expect(yield* tell(t.run, "line", LONG)).toBe("queued");
				yield* until("job 1 in the table", () =>
					t.table.getState().jobs.some((job) => job.n === 1) ? true : undefined,
				);

				for (let i = 0; i < 20; i += 1) {
					yield* tell(t.run, "line", "jobs");
				}

				const word = yield* t.stop(1);
				const [first] = yield* t.ready
					.upTo(1)
					.pipe(Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.succeed([])}));
				return {word, status: first?.status};
			}).pipe(Effect.scoped),
		);
		// 130: stopped, as Ctrl-C's end is.
		expect(seen).toEqual({word: "queued", status: 130});
	});

	it("stops a job told while it is in the table but before tsh holds its runs", async () => {
		// The host sees a job running as soon as the table has it, and an agent's stop can come then:
		// here, while its run is still opening on a slow storage. The stop must still end it.
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(slowSleep);
				expect(yield* tell(t.run, "line", `${LONG} &`)).toBe("queued");
				yield* until("job 1 in the table", () =>
					t.table.getState().jobs.some((j) => j.n === 1) ? true : undefined,
				);
				// What the host does for the agent: its stop first, then the word to the tsh that runs it.
				yield* t.table.dispatch({type: "stopping", n: 1, by: AGENT, why: "wrong ticket"});
				expect(yield* t.stop(1)).toBe("queued");
				yield* until("the job's end", () =>
					t.table.getState().jobs.some((j) => j.n === 1) ? undefined : true,
				).pipe(Effect.exit);
				return t.table.getState().jobs.map((j) => ({n: j.n, state: j.state}));
			}).pipe(Effect.scoped),
		);
		// Job 1 left the table: it was stopped, and did not run on.
		expect(seen).toEqual([]);
	});
});

describe("the stopper's line in the tile the job ran in", () => {
	it("says who stopped the job and why, when it was not this tsh's own writer, and keeps their stop", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshInT1;
				yield* t.line(`${LONG} &`);
				const stops: unknown[] = [];
				const unsubscribe = t.table.subscribe(() => {
					const job = t.table.getState().jobs.find((j) => j.n === 1);

					if (job?.stop != null) {
						stops.push(job.stop);
					}
				});
				yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
				// What the host does for the agent: its stop first, then the word to the tsh that runs it.
				yield* t.table.dispatch({type: "stopping", n: 1, by: AGENT, why: "wrong ticket"});
				expect(yield* t.stop(1)).toBe("queued");
				yield* until("the job's end", () =>
					t.table.getState().jobs.some((j) => j.n === 1) ? undefined : true,
				);
				const text = `[1] stopped by ${AGENT}: wrong ticket`;
				yield* until("the stopper's line", () =>
					t.printed.values.some((p) => p.text === text) ? true : undefined,
				);
				return {stops, printed: t.printed.values.map((p) => p.text)};
			}).pipe(Effect.scoped),
		);
		expect(seen.printed).toContain(`[1] stopped by ${AGENT}: wrong ticket`);
		// Kept once: the tsh's own ask after the host's changed nothing.
		expect(seen.stops.length).toBeGreaterThan(0);

		for (const stop of seen.stops) {
			expect(stop).toEqual({by: AGENT, why: "wrong ticket"});
		}
	});

	it("names the stopper of the job told, not another job's, with two jobs running", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshInT1;
				yield* t.line(`${LONG} &`);
				yield* t.line(`${LONG} &`);
				// The host's stop is for %2 only: %1 has none.
				yield* t.table.dispatch({type: "stopping", n: 2, by: AGENT, why: "wrong ticket"});
				expect(yield* t.stop(2)).toBe("queued");
				yield* until("job 2's end", () =>
					t.table.getState().jobs.some((j) => j.n === 2) ? undefined : true,
				);
				yield* settled(t.table);
				return {
					printed: t.printed.values.map((p) => p.text),
					left: t.table.getState().jobs.map((j) => j.n),
				};
			}).pipe(Effect.scoped),
		);
		expect(seen.printed).toContain(`[2] stopped by ${AGENT}: wrong ticket`);
		expect(seen.printed.filter((text) => text.includes("stopped by"))).toHaveLength(1);
		// %1 runs on.
		expect(seen.left).toEqual([1]);
	});

	it("says the stopper once when one job is stopped twice: the host's word, then stop %1", async () => {
		const printed = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshInT1;
				yield* t.line(`${LONG} &`);
				yield* t.table.dispatch({type: "stopping", n: 1, by: AGENT, why: "wrong ticket"});
				expect(yield* t.stop(1)).toBe("queued");
				// The person's own stop of the same job, at once: the table keeps the agent's stop.
				expect(yield* tell(t.run, "line", "stop %1")).toBe("queued");
				yield* until("the job's end", () =>
					t.table.getState().jobs.some((j) => j.n === 1) ? undefined : true,
				);
				yield* settled(t.table);
				return t.printed.values.map((p) => p.text);
			}).pipe(Effect.scoped),
		);
		expect(printed.filter((text) => text.includes("stopped by"))).toEqual([
			`[1] stopped by ${AGENT}: wrong ticket`,
		]);
	});

	it("says no stopper when the tsh's own writer stopped it", async () => {
		const printed = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshInT1;
				yield* t.line(`${LONG} &`);
				yield* t.line("stop %1");
				yield* until("the job's end", () =>
					t.table.getState().jobs.some((j) => j.n === 1) ? undefined : true,
				);
				yield* settled(t.table);
				return t.printed.values.map((p) => p.text);
			}).pipe(Effect.scoped),
		);
		expect(printed.filter((text) => text.includes("stopped by"))).toEqual([]);
	});
});
