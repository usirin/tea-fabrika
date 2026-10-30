import {describe, expect, it} from "vitest";
import {earlierFor, type Job, type Jobs, ownedBy} from "./jobs.ts";

// Whose a job is, as a tsh asks it: which jobs it owns, and which earlier ones it says are
// waiting when it starts.

const job = (n: number, owner: Job["owner"], state: Job["state"] = "detached"): Job => ({
	n,
	text: "counter",
	stages: [{program: "counter", flags: {}, run: `counter:${n}`, wire: null, ended: false}],
	state,
	background: false,
	owner,
});

/** t1's job and t2's, both detached; t2's running one; and one kept before jobs had owners. */
const TABLE: Jobs = {
	jobs: [job(1, "t1"), job(2, "t2"), job(3, "t2", "running"), job(4, null)],
	next: 5,
};
const numbers = (jobs: readonly Job[]) => jobs.map((one) => one.n);

describe("whose a job is", () => {
	it("a tile's tsh owns the jobs that name it, and a tsh with no name owns every one", () => {
		expect(numbers(ownedBy(TABLE, "t2"))).toEqual([2, 3]);
		expect(numbers(ownedBy(TABLE, "t3"))).toEqual([]);
		expect(numbers(ownedBy(TABLE, null))).toEqual([1, 2, 3, 4]);
	});

	it("a tsh that starts is told of its own detached jobs, and of any whose owner is not known", () => {
		expect(numbers(earlierFor(TABLE, "t1"))).toEqual([1, 4]);
		// t2's running job is not waiting: it runs.
		expect(numbers(earlierFor(TABLE, "t2"))).toEqual([2, 4]);
		// A tile that never ran a job is told of none of another's.
		expect(numbers(earlierFor(TABLE, "t3"))).toEqual([4]);
		expect(numbers(earlierFor(TABLE, null))).toEqual([1, 2, 4]);
	});
});
