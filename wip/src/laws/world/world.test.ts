import {describe, expect, it} from "vitest";
import {forgetsMissingReview} from "../ship.ts";
import {type Lanes, type LanesOptions, lanesWorld, type Note, REAL} from "./lanes.ts";
import {
	askLeavesByAnAnswer,
	asksReachTheOwner,
	deskWorld,
	dropsAnAskOnProgress,
	ignoresAFailedPost,
	LANE_LAWS,
	mergesPastTheQueue,
	oneLaneATicket,
	onlyPassedLands,
	testedWithMain,
	waitsForEver,
} from "./laws.ts";
import {type Options, search} from "./search.ts";

// Several machines at once: lanes of the real operate loop and its stages,
// over one shared world. The small worlds run here; the blowup tables, the
// bigger worlds and the size limits are in experiment 91's script.

const TWO: LanesOptions = {
	lanes: 2,
	tickets: "own",
	queue: true,
	cap: 2,
	forms: ["pass", "fail 1"],
};
const ONE: LanesOptions = {...TWO, lanes: 1};
/** Two lanes told the same ticket; the reviewer only passes, so no fail verdict is ever posted. */
const SAME: LanesOptions = {...TWO, tickets: "same", forms: ["pass"]};
/** Two lanes told the same ticket, one round each; the reviewer may pass or fail. */
const SAME_FAIL: LanesOptions = {...TWO, tickets: "same", cap: 1};
const NO_QUEUE: LanesOptions = {...TWO, queue: false};

const run = (o: LanesOptions, extra: Partial<Options<Lanes, Note>> = {}) =>
	search(lanesWorld(o), {laws: LANE_LAWS, depth: 200, ...extra});
const broken = (r: ReturnType<typeof run>) => r.broken.map((b) => b.law).sort();
const brokenOf = (r: ReturnType<typeof run>, name: string) => r.broken.find((b) => b.law === name);

describe("two lanes, each on a ticket of its own, with a merge queue", () => {
	it("keeps every law, and every lane ends: no fair loop, no dead state", () => {
		const r = run(TWO, {eventually: true});
		expect(r.complete).toBe(true);
		expect(r.broken).toEqual([]);
		expect(r.lassos).toEqual([]);
		expect(r.dead).toEqual([]);
	});
});

describe("the real code keeps the laws that used to break", () => {
	it("without a queue, the merge door stops a head built on an old main, and every lane still ends", () => {
		const r = run(NO_QUEUE, {eventually: true});
		expect(r.complete).toBe(true);
		expect(r.broken).toEqual([]);
		expect(r.lassos).toEqual([]);
		expect(r.dead).toEqual([]);
		expect(r.states).toBeLessThan(20_000);
	});

	it("a repository that refuses a branch behind main keeps it too", () => {
		expect(run({...NO_QUEUE, upToDate: true}).broken).toEqual([]);
	});

	it("two lanes told one ticket: the claim on the ledger lets one work it, and every lane ends", () => {
		const r = run(SAME, {eventually: true});
		expect(r.complete).toBe(true);
		expect(r.broken).toEqual([]);
		expect(r.lassos).toEqual([]);
		expect(r.dead).toEqual([]);
	});

	it("two lanes told one ticket, with a reviewer that may fail: no failed head lands", () => {
		const r = run(SAME_FAIL, {eventually: true});
		expect(r.complete).toBe(true);
		expect(r.broken).toEqual([]);
		expect(r.lassos).toEqual([]);
		expect(r.dead).toEqual([]);
		expect(r.states).toBeLessThan(20_000);
	});
});

describe("what the real code still breaks", () => {
	it("the loop asks the owner at the first stall, when the asks core has no ask yet", () => {
		const r = search(lanesWorld({...ONE, desk: true}), {laws: [asksReachTheOwner], depth: 200});
		expect(r.broken[0]?.why).toMatch(/L1 stops to ask the owner \(ask:owner:no_progress\)/);
	});
});

describe("one planted mistake per law, each caught", () => {
	it("no claim at all: two lanes told one ticket both work it", () => {
		expect(brokenOf(run({...SAME, claim: "none"}), oneLaneATicket.name)?.path).toEqual([
			"L1 starts on T1",
			"L1 takes T1 with no claim",
			"L2 starts on T1",
			"L2 takes T1 with no claim",
		]);
	});

	it("a claim read, then written in a second step: two lanes both take the ticket", () => {
		const b = brokenOf(run({...SAME, claim: "read_then_write"}), oneLaneATicket.name);
		expect(b?.path).toEqual([
			"L1 starts on T1",
			"L1 reads the claim on T1: free",
			"L2 starts on T1",
			"L2 reads the claim on T1: free",
			"L1 writes its claim on T1",
			"L2 writes its claim on T1",
		]);
	});

	it("a merge door that does not look at main: the second head lands on a main it was not tested with", () => {
		for (const door of ["no_main", "none"] as const) {
			const b = brokenOf(run({...NO_QUEUE, door}), testedWithMain.name);
			expect(b?.why).toMatch(/T\d\.c1 lands on main 1, but it was built and tested on main 0/);
			expect(b?.path.at(-1)).toMatch(/merges T\d\.c1 straight onto main 1/);
		}
	});

	it("ship merges past the queue: the merge door stops it, and with no door it lands on a stale main", () => {
		const past = {...TWO, steps: {...REAL, ship: mergesPastTheQueue}};
		expect(run(past).broken).toEqual([]);
		expect(broken(run({...past, door: "none"}))).toEqual([testedWithMain.name]);
	});

	it("no claim and no door: a head a review failed lands", () => {
		const b = brokenOf(run({...SAME_FAIL, claim: "none", door: "none"}), onlyPassedLands.name);
		expect(b?.why).toBe("T1.c2 lands with a fail at that head");
		// The fail is posted, then the head is queued: the door would have refused it.
		expect(b?.path.slice(-3)).toEqual([
			"L1 posts fail at T1.c2",
			"L2 enqueue T1.c2: queued",
			"T1 queue lands T1.c2 onto main 0",
		]);
	});

	it("no claim, with the door: the fail can only come after the head is queued, so the claim is what keeps it", () => {
		const b = brokenOf(run({...SAME_FAIL, claim: "none"}), onlyPassedLands.name);
		expect(b?.path.slice(-3)).toEqual([
			"L2 enqueue T1.c2: queued",
			"L1 posts fail at T1.c2",
			"T1 queue lands T1.c2 onto main 0",
		]);
	});

	it("ship takes a missing review as passed: the door stops it, and with no door a head with no verdict lands", () => {
		const forgets = {...SAME, claim: "none" as const, steps: {...REAL, ship: forgetsMissingReview}};
		expect(broken(run(forgets))).not.toContain(onlyPassedLands.name);
		const r = run({...forgets, door: "none"});
		expect(brokenOf(r, onlyPassedLands.name)?.why).toMatch(/lands with no verdict/);
	});

	it("ship as it was before the waits were counted: flaky CI keeps it waiting for ever, as a lasso", () => {
		const flaky: LanesOptions = {...ONE, flaky: true};
		expect(run(flaky, {eventually: true}).lassos).toEqual([]);
		const r = run({...flaky, steps: {...REAL, ship: waitsForEver}}, {eventually: true});
		const lasso = r.lassos?.[0];
		expect(lasso?.prefix.at(-1)).toMatch(/reads the ship facts at T1\.c1: passed, checks pending/);
		expect(lasso?.cycle).toEqual([
			"T1 CI green at T1.c1",
			"L1 hears the checks settled at T1.c1",
			"T1 CI runs again at T1.c1",
			"L1 reads the ship facts at T1.c1: passed, checks pending",
		]);
	});

	it("the loop takes a failed post as nothing: a dead state, nothing left to happen", () => {
		const errors: LanesOptions = {...ONE, errors: true};
		expect(run(errors, {eventually: true}).dead).toEqual([]);
		const r = run({...errors, steps: {...REAL, loop: ignoresAFailedPost}}, {eventually: true});
		expect(r.dead?.[0]?.path.at(-1)).toBe("L1 posting fails");
	});

	it("a desk that drops a stuck ask once a later round shows fewer open", () => {
		const desk = {rounds: 5, counts: [0, 1, 2]};
		expect(search(deskWorld(desk), {laws: [askLeavesByAnAnswer], depth: 50}).broken).toEqual([]);
		const r = search(deskWorld({...desk, fold: dropsAnAskOnProgress}), {
			laws: [askLeavesByAnAnswer],
			depth: 50,
		});
		expect(r.broken[0]?.why).toBe("stuck:w/T1#1/t1/1 left the owner's list with no answer to it");
	});
});

describe("the reductions find what the whole search finds", () => {
	const modes = [
		{por: true, symmetry: false},
		{por: false, symmetry: true},
		{por: true, symmetry: true},
	];
	for (const [name, o] of [
		["own tickets, no queue, a door blind to main", {...NO_QUEUE, door: "no_main" as const}],
		["one ticket, no claim", {...SAME, claim: "none" as const}],
		["one ticket, a claim read then written", {...SAME, claim: "read_then_write" as const}],
		[
			"one ticket, no claim, no door",
			{...SAME_FAIL, claim: "none" as const, door: "none" as const},
		],
	] as const)
		it(name, () => {
			const full = run(o);
			for (const mode of modes) {
				const r = run(o, mode);
				expect(broken(r)).toEqual(broken(full));
				expect(r.states).toBeLessThanOrEqual(full.states);
			}
		});

	it("symmetry and partial order together keep under half the states of two lanes", () => {
		const full = run(TWO);
		const both = run(TWO, {por: true, symmetry: true});
		expect(both.states * 2).toBeLessThan(full.states);
	});
});
