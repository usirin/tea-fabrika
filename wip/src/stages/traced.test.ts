import {applyCell} from "@demlik/tea";
import {ATTR} from "@tea-fabrika/tea-program/trace";
import {describe, expect, it} from "vitest";
import {noSpend} from "../draft.ts";
import {gatherPack, type Review, type ReviewCmd, review} from "./review/machine.ts";
import type {Ran} from "./review/reviewer.ts";
import {WHOLE} from "./review/scripted.ts";
import {reviewDrawing} from "./traced.ts";

// What a review's span says when it ends, read from the machine's own state.

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Review, msg: AnyMsg) => applyCell<Review, AnyMsg, ReviewCmd>(review, s, msg);
const RAN: Ran = {spend: {...noSpend, costUsd: 0.25}, tools: [], refused: [], links: 0};
const at = (run: number) => ({pr: WHOLE.pr, head: WHOLE.head, run});

/** A review that read WHOLE, and is now running its reviewer. */
function reviewing(): Review {
	const ask = {pr: WHOLE.pr, head: null, rubrics: "rubrics"};
	const settings = {model: "opus", effort: "medium", budget: 2} as const;
	const [gathering, [read]] = step({phase: "idle"}, {type: "start", ask, settings});
	return step(gathering, {type: gatherPack.okType, cmd: read, value: WHOLE})[0];
}

describe("a review's span, at its end", () => {
	it("a form code refused on every try says why, in the Check's words, and what both tries cost", () => {
		const refused = {rows: [], findings: [], skipped: []};
		const [again] = step(reviewing(), {type: "review_reviewed", ...at(1), form: refused, ran: RAN});
		const [over] = step(again, {type: "review_reviewed", ...at(2), form: refused, ran: RAN});
		const tags = reviewDrawing("review", WHOLE.pr).tags?.(over) ?? {};
		expect(tags[ATTR.outcome]).toBe("stuck:draft_failed");
		const problems = String(tags[ATTR.problems]).split("\n");
		expect(problems).toEqual([
			"form 1 refused: criterion c1 has no row",
			"form 1 refused: criterion c2 has no row",
			"form 2 refused: criterion c1 has no row",
			"form 2 refused: criterion c2 has no row",
		]);
		expect(tags[ATTR.costUsd]).toBe(0.5);
	});

	it("a review that passed first time carries no problems tag", () => {
		const passing = {
			rows: (WHOLE.criteria ?? []).map((c) => ({
				id: c.id,
				grade: "pass",
				where: [],
				says: "yes",
				limit: null,
			})),
			findings: [],
			skipped: [],
		};
		const [over] = step(reviewing(), {type: "review_reviewed", ...at(1), form: passing, ran: RAN});
		const tags = reviewDrawing("review", WHOLE.pr).tags?.(over) ?? {};
		expect(tags[ATTR.outcome]).toBe("done");
		expect(ATTR.problems in tags).toBe(false);
	});
});
