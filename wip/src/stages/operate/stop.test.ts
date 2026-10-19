import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import type {BuildReport} from "../build/machine.ts";
import type {Item} from "../build/ticket.ts";
import type {Reviewed} from "../review/program.ts";
import type {Judged} from "../review/verdict.ts";
import {afterBuild, afterReview, afterShip, openItems, type Round} from "./stop.ts";

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

describe("the stop rule, after a review", () => {
	it("nothing open: ship", () => {
		expect(afterReview([round(1, 0)], 3, passed, [])).toEqual({go: "ship", head: HEAD});
	});

	it("passed, at a head this round did not build: stuck, and nothing ships", () => {
		const elsewhere: Pick<Reviewed, "outcome"> = {
			outcome: {kind: "done", part: false, head: "b".repeat(40)},
		};
		expect(afterReview([round(1, 0)], 3, elsewhere, [])).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "review"},
			said: `the review passed ${"b".repeat(40)}, and this round built ${HEAD}`,
		});
		expect(afterReview([{...round(1, 0), head: null}], 3, passed, [])).toMatchObject({go: "end"});
	});

	it("open, fewer than the round before: build again, told what is open", () => {
		const items = [item(4)];
		expect(afterReview([round(1, 2), round(2, 1)], 3, failed, items)).toEqual({go: "build", items});
	});

	it("open, and no fewer than the round before: stop on no_progress, before the cap is reached", () => {
		for (const now of [2, 3])
			expect(
				afterReview(
					[round(1, 2), round(2, now)],
					5,
					failed,
					Array.from({length: now}, (_, i) => item(i + 1)),
				),
			).toEqual({go: "end", outcome: {kind: "ask", who: "owner", for: "no_progress"}});
	});

	it("a first round has no round before it: it never stops on no_progress", () => {
		expect(afterReview([round(1, 1)], 3, failed, [item(1)])).toEqual({
			go: "build",
			items: [item(1)],
		});
	});

	it("open, and this was the last round: stop at the cap", () => {
		expect(afterReview([round(1, 3), round(2, 1)], 2, failed, [item(1)])).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "rounds"},
		});
	});

	it("a draft or a review that broke is stuck; a merged one is skipped", () => {
		expect(afterReview([round(1, null)], 3, {outcome: {kind: "skip", why: "draft"}}, [])).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "review"},
		});
		expect(afterReview([round(1, null)], 3, {outcome: {kind: "skip", why: "merged"}}, [])).toEqual({
			go: "end",
			outcome: {kind: "skip", why: "merged"},
		});
		expect(
			afterReview([round(1, null)], 3, {outcome: {kind: "stuck", why: "over_budget"}}, []),
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
			afterShip(PR, 2, 3, {
				outcome: {kind: "done", part: false, commit: "c", cleanup: "done"},
				said: "done",
			}),
		).toEqual({
			go: "end",
			outcome: {kind: "done", part: false, pr: PR, head: "c", rounds: 2},
		});
	});

	it("sent back to the builder: one more round under the cap, none at it", () => {
		const back = {
			outcome: {kind: "send", to: "builder", why: "conflicts"},
			said: "send:builder:conflicts",
		} as const;
		expect(afterShip(PR, 1, 3, back)).toMatchObject({go: "build", items: [{criterion: null}]});
		expect(afterShip(PR, 3, 3, back)).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "rounds"},
		});
	});

	it("read mode, or a ship that could not finish, asks the owner or is stuck, with a reason", () => {
		expect(afterShip(PR, 1, 3, {outcome: null, said: "would_send:enqueue"})).toEqual({
			go: "end",
			outcome: {kind: "ask", who: "owner", for: "ship"},
		});
		expect(
			afterShip(PR, 1, 3, {
				outcome: {kind: "stuck", why: "enqueue_failed"},
				said: "stuck:enqueue_failed",
			}),
		).toEqual({
			go: "end",
			outcome: {kind: "stuck", why: "ship"},
		});
	});
});
