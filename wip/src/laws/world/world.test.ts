import {describe, expect, it} from "vitest";
import type {Entry} from "../../asks/ledger.ts";
import {foldLedger, openAsks} from "../../asks/rules.ts";
import {taskId} from "../../ids.ts";
import type {Item} from "../../stages/build/ticket.ts";
import {afterReview, type Round} from "../../stages/operate/stop.ts";
import {asksAtTheFirstStall} from "../loop.ts";
import {forgetsMissingReview} from "../ship.ts";
import {
	firstDesk,
	type Lanes,
	type LanesOptions,
	lanesWorld,
	type Note,
	planOfName,
	REAL,
} from "./lanes.ts";
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
	forms: ["pass", "fail 1"],
};
const ONE: LanesOptions = {...TWO, lanes: 1};
/** Two lanes told the same ticket; the reviewer only passes, so no fail verdict is ever posted. */
const SAME: LanesOptions = {...TWO, tickets: "same", forms: ["pass"]};
/**
 * Two lanes told the same ticket; the reviewer may pass or fail in round 1,
 * and only passes after. No cap ends a lane at round 1 any more, so the
 * search is bounded by its inputs: the fails the reviewer may hand back.
 */
const SAME_FAIL: LanesOptions = {...TWO, tickets: "same", fails: 1};
/**
 * The same, with round 1's review the only one the reviewer answers: for the
 * safety searches with no claim, where two lanes on one ticket are too many
 * rounds of states. A lane asked for a second review waits for good.
 */
const SAME_FAIL_ONCE: LanesOptions = {...SAME_FAIL, reviews: 1};
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

describe("the loop and the owner's desk read one stall rule", () => {
	const COUNTS = [1, 2, 3];
	const runsOf = (n: number): number[][] =>
		n === 0 ? [[]] : runsOf(n - 1).flatMap((r) => COUNTS.map((c) => [...r, c]));
	const item = (n: number): Item => ({
		criterion: null,
		text: `${n}`,
		says: "",
		where: [],
		wants: [],
	});
	const round = (n: number, open: number): Round => ({
		n,
		built: "done",
		pr: "P",
		head: "H",
		changed: true,
		reviewed: "send:builder:review_failed",
		open,
		items: [],
		shipped: null,
		spend: 0,
		problems: [],
	});
	/** Planted: the loop's own copy of the rule, as it was, which asks at the first stall. */
	const theOldCopy: typeof afterReview = (rounds, reviewed, items) => {
		const before = rounds.at(-2);
		return reviewed.outcome.kind === "send" && before?.open != null && items.length >= before.open
			? {go: "end", outcome: {kind: "ask", who: "owner", for: "no_progress"}}
			: afterReview(rounds, reviewed, items);
	};
	/** The round the loop stops at to ask the owner on no progress. */
	const loopAsks = (opens: readonly number[], rule = afterReview): number | null => {
		for (let i = 0; i < opens.length; i++) {
			const rounds = opens.slice(0, i + 1).map((open, at) => round(at + 1, open));
			const next = rule(
				rounds,
				{outcome: {kind: "send", to: "builder", why: "review_failed"}},
				Array.from({length: opens[i] as number}, (_, k) => item(k)),
			);
			if (next.go === "end") return next.outcome.kind === "ask" ? i + 1 : null;
		}
		return null;
	};
	/** The round the asks core raises its stuck ask at, told each round as a reviewed fact. */
	const deskAsks = (opens: readonly number[]): number | null => {
		const desk: Entry[] = [...firstDesk("T1")];
		for (let i = 0; i < opens.length; i++) {
			desk.push({
				seq: desk.length + 1,
				fact: {
					type: "reviewed",
					plan: planOfName("T1"),
					task: taskId("t1"),
					open: opens[i] as number,
				},
			});
			if (openAsks(foldLedger(desk)).some((a) => a.for === "stuck")) return i + 1;
		}
		return null;
	};

	const differ = (rule = afterReview) => {
		const out: string[] = [];
		let runs = 0;
		for (let n = 2; n <= 6; n++)
			for (const opens of runsOf(n)) {
				runs++;
				const loop = loopAsks(opens, rule);
				const desk = deskAsks(opens);
				if (loop !== desk) out.push(`${opens.join(",")}: loop at ${loop}, desk at ${desk}`);
			}
		expect(runs).toBe(9 + 27 + 81 + 243 + 729);
		return out;
	};

	it("every run of 2 to 6 rounds, each leaving 1 to 3 open: the loop asks at the round the desk raises its ask, never before or after", () => {
		expect(differ()).toEqual([]);
	});

	it("planted: the loop's old copy of the rule asks at the first stall, when the desk has no ask yet", () => {
		expect(differ(theOldCopy)[0]).toBe("1,1: loop at 2, desk at null");
	});

	it("in the world: a lane that stops on no progress always leaves an ask on the owner's list", () => {
		const desk: LanesOptions = {...ONE, desk: true};
		const r = search(lanesWorld(desk), {laws: [asksReachTheOwner], depth: 200});
		expect(r.complete).toBe(true);
		expect(r.broken).toEqual([]);
		const planted = search(lanesWorld({...desk, steps: {...REAL, loop: asksAtTheFirstStall}}), {
			laws: [asksReachTheOwner],
			depth: 200,
		});
		expect(planted.broken[0]?.why).toBe(
			"L1 stops to ask the owner (ask:owner:no_progress), but the owner's list has nothing for T1",
		);
		expect(planted.broken[0]?.path.at(-1)).toBe("L1 posts fail at T1.c2");
	});
});

describe("no cap on rounds", () => {
	it("the cap ask, which had no ask on the owner's list, is gone: every ask a lane makes reaches the list", () => {
		// Was: the loop asked the owner at the cap (ask:owner:rounds), and the desk had nothing.
		const worlds: readonly LanesOptions[] = [
			{...ONE, desk: true},
			{...ONE, desk: true, forms: ["fail 1"]},
			// Someone else merges, so ship may send the passed head back (behind): a round with 1 open.
			{...ONE, desk: true, queue: false, outsider: 2},
		];
		for (const world of worlds) {
			const r = search(lanesWorld(world), {
				laws: [asksReachTheOwner],
				depth: 200,
				eventually: true,
			});
			expect(r.complete).toBe(true);
			expect(r.broken).toEqual([]);
			expect(r.lassos).toEqual([]);
			expect(r.dead).toEqual([]);
		}
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
		// With no cap, a review may fail in round 1 only, which bounds the search: the mistake is in ship, not review.
		const past = {...TWO, fails: 1, steps: {...REAL, ship: mergesPastTheQueue}};
		expect(run(past).broken).toEqual([]);
		expect(broken(run({...past, door: "none"}))).toEqual([testedWithMain.name]);
	});

	it("no claim and no door: a head a review failed lands", () => {
		const b = brokenOf(run({...SAME_FAIL_ONCE, claim: "none", door: "none"}), onlyPassedLands.name);
		expect(b?.why).toBe("T1.c2 lands with a fail at that head");
		// The fail is posted, then the head is queued: the door would have refused it.
		expect(b?.path.slice(-3)).toEqual([
			"L1 posts fail at T1.c2",
			"L2 enqueue T1.c2: queued",
			"T1 queue lands T1.c2 onto main 0",
		]);
	});

	it("no claim, with the door: the fail can only come after the head is queued, so the claim is what keeps it", () => {
		const b = brokenOf(run({...SAME_FAIL_ONCE, claim: "none"}), onlyPassedLands.name);
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
	// Four searches each. With no cap, a lane whose round 1 fails builds a round 2, so the
	// one-ticket world with fails takes a few seconds.
	for (const [name, o] of [
		["own tickets, no queue, a door blind to main", {...NO_QUEUE, door: "no_main" as const}],
		["one ticket, no claim", {...SAME, claim: "none" as const}],
		["one ticket, a claim read then written", {...SAME, claim: "read_then_write" as const}],
		[
			"one ticket, no claim, no door",
			{...SAME_FAIL_ONCE, claim: "none" as const, door: "none" as const},
		],
	] as const)
		it(name, () => {
			const full = run(o);
			for (const mode of modes) {
				const r = run(o, mode);
				expect(broken(r)).toEqual(broken(full));
				expect(r.states).toBeLessThanOrEqual(full.states);
			}
		}, 20_000);

	it("symmetry and partial order together keep under half the states of two lanes", () => {
		const full = run(TWO);
		const both = run(TWO, {por: true, symmetry: true});
		expect(both.states * 2).toBeLessThan(full.states);
	});
});
