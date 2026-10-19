import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import type {BuildReport} from "../build/machine.ts";
import type {Item} from "../build/ticket.ts";
import type {Reviewed} from "../review/program.ts";
import type {Judged} from "../review/verdict.ts";
import {afterBuild, afterReview, afterShip, openItems, type Round, shipItems} from "./stop.ts";

// The stop rule, on its own: what each stage handed back, and what the loop
// does next. Pure, so every case is one call.

const PR = "https://github.com/kamp-us/tea-fabrika-sandbox/pull/9";
const HEAD = "a".repeat(40);

const item = (n: number): Item => ({
	criterion: criterionId(`c${n}`),
	text: `criterion ${n}`,
	says: "open",
	where: [],
	wants: [],
});
const round = (n: number, open: number | null): Round => ({
	n,
	built: "done",
	pr: PR,
	head: HEAD,
	changed: true,
	reviewed: open === null ? null : open === 0 ? "done" : "send:builder:review_failed",
	open,
	items: [],
	shipped: null,
	spend: 0,
	problems: [],
});
const failed: Pick<Reviewed, "outcome"> = {
	outcome: {kind: "send", to: "builder", why: "review_failed"},
};
const passed: Pick<Reviewed, "outcome"> = {outcome: {kind: "done", part: false, head: HEAD}};

const report: BuildReport = {
	pr: PR,
	head: HEAD,
	changed: true,
	built: null,
	ran: null,
	runs: 1,
	problems: [],
};

/** Items 1 to `n`: a list `n` long. */
const items = (n: number): readonly Item[] => Array.from({length: n}, (_, i) => item(i + 1));

/**
 * The loop's stop rule over a whole ticket: round `i`'s review leaves
 * `opens[i]` open (0 is a pass), and a pass ships and lands. What the loop
 * did, round by round, and how it ended.
 */
function walk(opens: readonly number[]): {readonly told: number[]; readonly ended: unknown} {
	const rounds: Round[] = [];
	const told: number[] = [];
	for (const [i, open] of opens.entries()) {
		rounds.push(round(i + 1, open));
		const next = afterReview(rounds, open === 0 ? passed : failed, items(open));
		if (next.go === "ship")
			return {
				told,
				ended: afterShip(PR, rounds, {
					outcome: {kind: "done", part: false, commit: "c", cleanup: "done"},
					said: "done",
				}),
			};
		if (next.go !== "build") return {told, ended: next};
		told.push(next.items.length);
	}
	return {told, ended: null};
}

describe("no cap on rounds: only the stall rule stops a loop", () => {
	it("8 open criteria, each round meets 2: ships after 4 rounds, and never asks the owner", () => {
		expect(walk([6, 4, 2, 0])).toEqual({
			told: [6, 4, 2],
			ended: {go: "end", outcome: {kind: "done", part: false, pr: PR, head: "c", rounds: 4}},
		});
	});

	it("a list that gets 1 shorter every round for 10 rounds never asks the owner, then ships", () => {
		const opens = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
		expect(walk(opens).told).toEqual(opens);
		expect(walk([...opens, 0]).ended).toMatchObject({
			go: "end",
			outcome: {kind: "done", rounds: 11},
		});
	});

	it("a long list that shrinks with one stall each time still goes on: 30 rounds, no ask", () => {
		const opens = Array.from({length: 15}, (_, i) => [15 - i, 15 - i]).flat();
		expect(walk(opens).told).toEqual(opens);
	});

	it("a list that wobbles, 1, 2, 1, 2, never stalls twice in a row: its third round with no new lowest asks the owner", () => {
		expect(walk([1, 2, 1, 2])).toEqual({
			told: [1, 2, 1],
			ended: {go: "end", outcome: {kind: "ask", who: "owner", for: "no_progress"}},
		});
		// One that falls to a new lowest in time goes on: 3, 2, 3 then 1.
		expect(walk([3, 2, 3, 1, 2]).told).toEqual([3, 2, 3, 1, 2]);
	});

	it("a long run that shrank, then stalls twice in a row: asks the owner then, not before", () => {
		expect(walk([9, 8, 7, 6, 5, 4, 3, 3, 3])).toEqual({
			told: [9, 8, 7, 6, 5, 4, 3, 3],
			ended: {go: "end", outcome: {kind: "ask", who: "owner", for: "no_progress"}},
		});
	});
});

describe("the stop rule, after a review", () => {
	it("nothing open: ship", () => {
		expect(afterReview([round(1, 0)], passed, [])).toEqual({go: "ship", head: HEAD});
	});

	it("passed, at a head this round did not build: stuck, and nothing ships", () => {
		const elsewhere: Pick<Reviewed, "outcome"> = {
			outcome: {kind: "done", part: false, head: "b".repeat(40)},
		};
		expect(afterReview([round(1, 0)], elsewhere, [])).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "review"},
			said: `the review passed ${"b".repeat(40)}, and this round built ${HEAD}`,
		});
		expect(afterReview([{...round(1, 0), head: null}], passed, [])).toMatchObject({go: "end"});
	});

	it("open, fewer than the round before: build again, told what is open", () => {
		const told = [item(4)];
		expect(afterReview([round(1, 2), round(2, 1)], failed, told)).toEqual({
			go: "build",
			items: told,
		});
	});

	it("open, and no fewer than the round before, once: one more round", () => {
		for (const now of [2, 3])
			expect(afterReview([round(1, 2), round(2, now)], failed, items(now))).toEqual({
				go: "build",
				items: items(now),
			});
	});

	it("open, and no fewer than the round before, twice in a row: stop on no_progress", () => {
		for (const now of [2, 3])
			expect(afterReview([round(1, 2), round(2, 2), round(3, now)], failed, items(now))).toEqual({
				go: "end",
				outcome: {kind: "ask", who: "owner", for: "no_progress"},
			});
	});

	it("a stall, then fewer, then a stall: the count starts over, so one more round", () => {
		expect(
			afterReview([round(1, 3), round(2, 3), round(3, 2), round(4, 2)], failed, items(2)),
		).toMatchObject({go: "build"});
	});

	it("a first round has no round before it: it never stops on no_progress", () => {
		expect(afterReview([round(1, 1)], failed, [item(1)])).toEqual({
			go: "build",
			items: [item(1)],
		});
	});

	it("a draft or a review that broke is stuck; a merged one is skipped", () => {
		expect(afterReview([round(1, null)], {outcome: {kind: "skip", why: "draft"}}, [])).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "review"},
		});
		expect(afterReview([round(1, null)], {outcome: {kind: "skip", why: "merged"}}, [])).toEqual({
			go: "end",
			outcome: {kind: "skip", why: "merged"},
		});
		expect(
			afterReview([round(1, null)], {outcome: {kind: "stuck", why: "over_budget"}}, []),
		).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "review"},
		});
	});
});

describe("what the next round is told", () => {
	const judged = (
		n: number,
		state: "met" | "open",
		from: "ticket" | "review" = "ticket",
	): Judged => {
		const id = criterionId(`c${n}`);
		const common = {
			text: `criterion ${n}`,
			says: state === "met" ? "it does" : "it does not",
			where: [{file: "src/a.ts", first: 3, last: 9}],
			findings:
				state === "met"
					? []
					: [
							{
								id: "f1",
								state: "open" as const,
								kind: "review-code" as const,
								from: {source: "criterion" as const, id},
								fault: "x",
								at: null,
								proof: "y",
								wants: "it does",
							},
						],
		};
		return from === "ticket"
			? {from, id, version: 1, state, ...common}
			: {from, state: "open", ...common};
	};

	it("each open criterion, with where and what it wants; a criterion the review added has no id", () => {
		const items = openItems({
			...failed,
			criteria: [judged(1, "met"), judged(2, "open"), judged(7, "open", "review")],
		});
		expect(items).toEqual([
			{
				criterion: "c2",
				text: "criterion 2",
				says: "it does not",
				where: ["src/a.ts:3-9"],
				wants: ["it does"],
			},
			{
				criterion: null,
				text: "criterion 7",
				says: "it does not",
				where: ["src/a.ts:3-9"],
				wants: ["it does"],
			},
		]);
	});

	it("red checks are one item, whatever the criteria say", () => {
		const items = openItems({
			outcome: {kind: "send", to: "builder", why: "checks_red"},
			criteria: [],
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.criterion).toBeNull();
	});
});

describe("after a build", () => {
	it("done: review it; a later round that changed nothing stops on no_change", () => {
		const done = {
			outcome: {kind: "done", part: false, pr: PR, head: HEAD, changed: true},
			name: "done",
			report,
		} as const;
		expect(afterBuild(1, done)).toEqual({go: "review"});
		const same = {...done, outcome: {...done.outcome, changed: false}};
		expect(afterBuild(1, same)).toEqual({go: "review"});
		expect(afterBuild(2, same)).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "no_change"},
		});
	});

	it("skip is passed on; anything else is stuck", () => {
		expect(
			afterBuild(1, {outcome: {kind: "skip", why: "not_ready"}, name: "skip:not_ready", report}),
		).toEqual({
			go: "end",
			outcome: {kind: "skip", why: "not_ready"},
		});
		expect(
			afterBuild(1, {
				outcome: {kind: "stuck", why: "push_failed"},
				name: "stuck:push_failed",
				report,
			}),
		).toEqual({go: "end", outcome: {kind: "stuck", why: "build"}});
	});
});

describe("after a ship", () => {
	it("merged: done, with the base commit and the rounds", () => {
		expect(
			afterShip(PR, [round(1, 1), round(2, 0)], {
				outcome: {kind: "done", part: false, commit: "c", cleanup: "done"},
				said: "done",
			}),
		).toEqual({
			go: "end",
			outcome: {kind: "done", part: false, pr: PR, head: "c", rounds: 2},
		});
	});

	it("sent back to the builder: one item open, read by the stall rule like a review's list", () => {
		const back = {
			outcome: {kind: "send", to: "builder", why: "conflicts"},
			said: "send:builder:conflicts",
		} as const;
		expect(shipItems(back)).toMatchObject([{criterion: null}]);
		// After 3 open, 1 is progress; after a round the ship sent back (1), a second 1 is one stall.
		expect(afterShip(PR, [round(1, 3), round(2, 0)], back)).toMatchObject({
			go: "build",
			items: [{criterion: null}],
		});
		expect(afterShip(PR, [round(1, 3), round(2, 1), round(3, 0)], back)).toMatchObject({
			go: "build",
		});
		// The ship sends it back a third round in a row: the second stall asks the owner.
		expect(afterShip(PR, [round(1, 3), round(2, 1), round(3, 1), round(4, 0)], back)).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "no_progress"},
		});
	});

	it("a ship that did not send it back leaves nothing open", () => {
		expect(shipItems({outcome: null, said: "would_send:enqueue"})).toEqual([]);
		expect(
			shipItems({
				outcome: {kind: "send", to: "reviewer", why: "no_review"},
				said: "send:reviewer:no_review",
			}),
		).toEqual([]);
	});

	it("read mode, or a ship that could not finish, asks the owner or is stuck, with a reason", () => {
		expect(afterShip(PR, [round(1, 0)], {outcome: null, said: "would_send:enqueue"})).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "ship"},
		});
		expect(
			afterShip(PR, [round(1, 0)], {
				outcome: {kind: "stuck", why: "enqueue_failed"},
				said: "stuck:enqueue_failed",
			}),
		).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "ship"},
		});
	});
});
