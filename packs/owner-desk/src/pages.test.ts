import {applyCell} from "@demlik/tea";
import type {Ask} from "@kampus/fabrika/pipeline/asks/ask";
import {changed, plans86b} from "@kampus/fabrika/pipeline/asks/cases";
import {planAskId} from "@kampus/fabrika/pipeline/asks/rules";
import {EMPTY} from "@kampus/fabrika/pipeline/criteria/book";
import {planOf, ticketId} from "@kampus/fabrika/pipeline/ids";
import {numbered, withIds} from "@kampus/fabrika/pipeline/stages/plan/ids";
import {revisionOfDraft} from "@kampus/fabrika/pipeline/stages/plan/plan";
import {describe, expect, it} from "vitest";
import {commentOf} from "./comment.ts";
import {type Desk, type DeskMsg, desk, GONE, pagesOf} from "./inbox.ts";
import {markdownOf} from "./markdown.ts";
import {askPage, inboxPage} from "./pages.ts";
import {answerOf} from "./reply.ts";

// The desk's pure parts: the reply reader, the pages, and the desk machine.

const asks: readonly Extract<Ask, {for: "plan"}>[] = plans86b().flatMap((p, i) => {
	const revision = p.plan === null ? null : revisionOfDraft(p.plan);
	if (revision === null) return [];
	const ticket = ticketId(p.ticket);
	const plan = planOf(ticket);
	return [
		{
			for: "plan" as const,
			id: planAskId(plan, 1),
			at: i + 1,
			plan,
			tickets: [ticket],
			version: 1,
			data: numbered(revision),
			since: null,
			problems: [],
		},
	];
});

const step = (s: Desk, msg: DeskMsg) => applyCell<Desk, DeskMsg, never>(desk, s, msg)[0];
const empty: Desk = {open: [], refused: {}, closed: {}};

describe("a reply typed by the owner", () => {
	it("reads each answer kind from its slash word", () => {
		expect(answerOf("/approve")).toEqual({kind: "approve"});
		expect(answerOf("/no not now: nobody needs this yet")).toEqual({
			kind: "no",
			why: "not now: nobody needs this yet",
		});
		expect(answerOf("/change c3 the list stays sorted")).toEqual({
			kind: "change",
			line: "c3",
			to: "the list stays sorted",
		});
		expect(answerOf("/remove")).toEqual({kind: "remove"});
		expect(answerOf("/keep-going 3")).toEqual({kind: "keep_going", rounds: 3});
		expect(answerOf("/reword c3 When the suite runs twice, both runs pass")).toEqual({
			kind: "reword",
			criterion: "c3",
			when: "the suite runs twice",
			result: "both runs pass",
		});
		expect(answerOf("/rule one-off build (b): reject.")).toEqual({
			kind: "rule",
			rule: "one_off",
			build: true,
			answer: "(b): reject.",
		});
	});

	it("guesses nothing: a reply that is not a whole answer is none", () => {
		for (const text of [
			"looks good",
			"/approve it all",
			"/no",
			"/change c3",
			"/keep-going 0",
			"/keep-going 11",
			"/keep-going three",
			"/reword c3 both runs pass",
			// A place is not an id: only the id the book gave names a criterion.
			"/reword t1.c2 When the suite runs twice, both runs pass",
			"/reword c0 When the suite runs twice, both runs pass",
			"/rule (b)",
			"/rule forever (b)",
		])
			expect(answerOf(text), text).toBeNull();
	});
});

describe("the pages", () => {
	it("the inbox lists what waits oldest first, whatever order it was handed in", () => {
		const page = inboxPage([...asks].reverse());
		expect(page.kind === "inbox" && page.rows.map((r) => r.at)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(
			markdownOf(page)
				.split("\n")
				.filter((l) => /^\d\./.test(l)),
		).toHaveLength(6);
	});

	it("a changed plan shows only what changed since the approved version, on both views", () => {
		const v1 = asks.find((a) => a.plan.endsWith("#565"));
		if (v1 === undefined) throw new Error("no 565");
		const data = withIds(withIds(EMPTY, v1.data).book, changed(v1.data)).plan;
		const v2: Ask = {
			...v1,
			id: planAskId(v1.plan, 2),
			version: 2,
			data,
			since: {version: 1, data: v1.data},
		};
		const page = askPage(v2, null);
		expect(page.kind === "ask" && page.plan?.whole).toBe(false);
		const said = v1.data.tasks[0]!.criteria[0]!.id;
		const added = data.tasks[0]!.criteria.at(-1)!.id;
		expect(markdownOf(page)).toContain(`## New or changed\n\n- **${added}** `);
		expect(markdownOf(page)).toContain(`## Said again\n\n- **${said}** `);
		expect(commentOf(page)).toContain(`\`${added}\` **new or changed:**`);
		expect(commentOf(page)).toContain(`\`${said}\` **said again:**`);
		for (const text of [markdownOf(page), commentOf(page)])
			expect(text).not.toContain("User stories");
		const whole = markdownOf(askPage(v1, null));
		expect(whole).toContain("## User stories");
		expect(whole).toContain("Lean: ");
	});
});

describe("the desk machine", () => {
	it("a list said before an answer but heard after it does not reopen the answered ask", () => {
		const [a, b] = asks;
		if (a === undefined || b === undefined) throw new Error("no plans");
		let s = step(empty, {type: "waiting", asks: [a, b]});
		s = step(s, {type: "settled", ask: a, answer: {kind: "approve"}});
		s = step(s, {type: "waiting", asks: [a, b]});
		expect(s.open.map((x) => x.id)).toEqual([b.id]);
		s = step(s, {type: "waiting", asks: [b]});
		expect(pagesOf(s).get(a.id)).toEqual({kind: "closed", ask: a, said: "approved"});
	});

	it("an ask that leaves the list with no answer heard closes as gone; a late answer still names it", () => {
		const [a, b] = asks;
		if (a === undefined || b === undefined) throw new Error("no plans");
		let s = step(empty, {type: "waiting", asks: [a, b]});
		s = step(s, {type: "waiting", asks: [b]});
		expect(pagesOf(s).get(a.id)).toMatchObject({kind: "closed", said: GONE});
		s = step(s, {type: "settled", ask: a, answer: {kind: "no", why: "not now"}});
		expect(pagesOf(s).get(a.id)).toMatchObject({kind: "closed", said: "no: not now"});
	});

	it("a refusal shows on the ask's page until the ask closes", () => {
		const [a] = asks;
		if (a === undefined) throw new Error("no plans");
		let s = step(empty, {type: "waiting", asks: [a]});
		s = step(s, {
			type: "refused",
			id: a.id,
			why: "a plan ask takes approve, change or no, not rule",
		});
		expect(pagesOf(s).get(a.id)).toMatchObject({
			refused: "a plan ask takes approve, change or no, not rule",
		});
		s = step(s, {type: "settled", ask: a, answer: {kind: "approve"}});
		expect(s.refused).toEqual({});
	});
});
