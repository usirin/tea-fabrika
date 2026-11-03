import type {Shell} from "@kampus/fabrika-old";
import {describe, expect, it} from "vitest";
import {endOf, type TileJobs, watchJobs} from "./tile-jobs.ts";

// One tile's jobs, watched by hand: the host's table and each run's end, in either order, by a
// clock the test moves.

const stage = (run: string) => ({program: run, flags: {}, run, wire: null, ended: false});
const job = (n: number, text: string, runs: readonly string[], over: Partial<Shell.Job> = {}) => {
	const [first = "", ...rest] = runs;
	return {
		n,
		text,
		stages: [stage(first), ...rest.map(stage)] as const,
		state: "running" as const,
		background: false,
		owner: null,
		...over,
	};
};
const table = (...jobs: Shell.Job[]): Shell.Jobs => ({jobs, next: 9});
const ENDED = {kind: "ended", unread: {}} as const;
const STOPPED = {kind: "stopped", unread: {}} as const;

const watched = () => {
	let now = 1000;
	const told: TileJobs[] = [];
	const watch = watchJobs(
		() => now,
		(jobs) => told.push(jobs),
	);
	return {
		watch,
		told,
		at: (t: number) => {
			now = t;
		},
	};
};

describe("a tile's jobs", () => {
	const mine = new Set(["seq-1", "tally-1", "counter-1"]);

	it("names only this tile's running jobs, with when each was first seen", () => {
		const w = watched();
		const pipe = job(1, "seq --to 9 | tally", ["seq-1", "tally-1"]);
		const theirs = job(2, "counter", ["counter-9"]);
		w.watch.table(table(pipe, theirs), mine);
		w.at(5000);
		w.watch.table(table(pipe, {...theirs, background: true}), mine);
		expect(w.told).toEqual([
			{running: [{n: 1, text: "seq --to 9 | tally", since: 1000, foreground: true}], ended: null},
		]);
	});

	it("says a job ended once it left the table and each run said how, in either order", () => {
		const w = watched();
		const pipe = job(1, "seq --to 9 | tally", ["seq-1", "tally-1"]);
		w.watch.table(table(pipe), mine);
		w.at(7000);
		w.watch.ran("seq-1", ENDED);
		w.watch.table(table(), mine);
		// Gone from the table, but tally has not said how it ended yet.
		expect(w.told.at(-1)).toEqual({running: [], ended: null});
		w.watch.ran("tally-1", STOPPED);
		expect(w.told.at(-1)).toEqual({
			running: [],
			ended: {
				n: 1,
				text: "seq --to 9 | tally",
				how: "stopped",
				since: 1000,
				at: 7000,
				foreground: true,
			},
		});
	});

	it("does not call a job detached as tsh stops an end", () => {
		const w = watched();
		const one = job(3, "counter", ["counter-1"], {background: true});
		w.watch.table(table(one), mine);
		w.watch.table(table({...one, state: "detached"}), mine);
		w.watch.ran("counter-1", STOPPED);
		expect(w.told.at(-1)).toEqual({running: [], ended: null});
	});

	it("reads a job's end off its runs': one failure fails it, one stop stops it", () => {
		expect(endOf(["ended", "ended"])).toBe("done");
		expect(endOf(["ended", "stopped"])).toBe("stopped");
		expect(endOf(["stopped", "failed"])).toBe("failed");
	});
});
