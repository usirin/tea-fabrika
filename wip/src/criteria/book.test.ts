import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {CriterionId, criterionId, type TaskId, taskId, verdictId} from "../ids.ts";
import {
	apply,
	type Book,
	type CriteriaMsg,
	currentOf,
	EMPTY,
	historyOf,
	standingAt,
	type Verdict,
	withRound,
} from "./book.ts";

const book = (...msgs: readonly CriteriaMsg[]): Book => msgs.reduce(apply, EMPTY);
const T1 = taskId("t1");
const added = (text: string, task: TaskId = T1): CriteriaMsg => ({
	type: "added",
	task,
	text,
	by: "plan",
});
const c = criterionId;
const pass = (id: string, version: number, head = "A"): CriteriaMsg => ({
	type: "judged",
	row: {criterion: c(id), version, head, grade: "pass", proof: `review at ${head}`},
});
const fail = (id: string, version: number, head = "A"): CriteriaMsg => ({
	type: "judged",
	row: {criterion: c(id), version, head, grade: "fail", proof: `review at ${head}`},
});
const states = (b: Book, head = "A") =>
	Object.fromEntries(standingAt(b, head).map((s) => [s.id, `${s.state}@v${s.version}`]));

describe("a criterion's id", () => {
	it("is c1, c2, ... in the order criteria are added, and only an id the book could give decodes", () => {
		// @ts-expect-error a place, or any plain text, is not an id: only the book gives one
		const place: CriterionId = "c1";
		expect(place).toBe("c1");
		expect(currentOf(book(added("a"), added("b"), added("c"))).map((x) => x.id)).toEqual([
			"c1",
			"c2",
			"c3",
		]);
		for (const bad of ["", "c0", "c01", "t1.c2", "3", "C3", "c-1"])
			expect(Schema.decodeUnknownOption(CriterionId)(bad)._tag).toBe("None");
	});

	it("is the same on every replay of the same events", () => {
		const events = [
			added("a"),
			added("b", taskId("t2")),
			{type: "removed", id: c("c1")} as const,
			added("d"),
		];
		expect(book(...events)).toEqual(book(...events));
		expect(currentOf(book(...events)).map((x) => x.id)).toEqual(["c2", "c3"]);
	});

	it("is never given twice: a removed id stays retired, and the next added one gets a new id", () => {
		const b = book(added("a"), added("b"), {type: "removed", id: c("c2")}, added("again"));
		expect(currentOf(b).map((x) => `${x.id} ${x.text}`)).toEqual(["c1 a", "c3 again"]);
		expect(b.retired.map((e) => e.id)).toEqual(["c2"]);
		// A reword of a retired id does not bring it back.
		expect(currentOf(apply(b, {type: "reworded", id: c("c2"), text: "x", by: "owner"}))).toEqual(
			currentOf(b),
		);
	});

	it("does not move when a criterion is added before it in the plan's reading order", () => {
		// Ten criteria, every one met at A; then three more are added. No verdict moves.
		const ten = Array.from({length: 10}, (_, i) => added(`claim ${i + 1}`));
		const met = ten.map((_, i) => pass(`c${i + 1}`, 1));
		const before = book(...ten, ...met);
		const after = book(
			...ten,
			...met,
			added("new one"),
			added("another", taskId("t2")),
			added("third"),
		);
		const was = states(before);
		const now = states(after);
		expect(Object.keys(was)).toHaveLength(10);
		for (const [id, state] of Object.entries(was)) expect(now[id]).toBe(state);
		expect([now.c11, now.c12, now.c13]).toEqual(["open@v1", "open@v1", "open@v1"]);
	});
});

describe("a reworded criterion", () => {
	it("keeps its id, gets a new version, and is open until judged at that version", () => {
		const b = book(added("a"), added("b"), pass("c1", 1), pass("c2", 1));
		expect(states(b)).toEqual({c1: "met@v1", c2: "met@v1"});
		const reworded = apply(b, {type: "reworded", id: c("c2"), text: "b, tighter", by: "owner"});
		expect(states(reworded)).toEqual({c1: "met@v1", c2: "open@v2"});
		// A pass for the old wording, even a later one, does not count.
		expect(states(apply(reworded, pass("c2", 1)))).toEqual({c1: "met@v1", c2: "open@v2"});
		expect(states(apply(reworded, pass("c2", 2)))).toEqual({c1: "met@v1", c2: "met@v2"});
	});

	it("keeps every wording it had, and which one each verdict judged", () => {
		const b = book(
			added("a"),
			pass("c1", 1),
			{type: "reworded", id: c("c1"), text: "a2", by: "plan"},
			{type: "reworded", id: c("c1"), text: "a3", by: "owner"},
			fail("c1", 3),
		);
		expect(historyOf(b, c("c1"))).toEqual({
			wordings: [
				{version: 1, text: "a", by: "plan"},
				{version: 2, text: "a2", by: "plan"},
				{version: 3, text: "a3", by: "owner"},
			],
			verdicts: [
				{
					id: verdictId("v1"),
					criterion: c("c1"),
					version: 1,
					head: "A",
					grade: "pass",
					proof: "review at A",
				},
				{
					id: verdictId("v2"),
					criterion: c("c1"),
					version: 3,
					head: "A",
					grade: "fail",
					proof: "review at A",
				},
			] satisfies Verdict[],
		});
	});

	it("said again in the same words is not a new version", () => {
		const b = book(added("a"), pass("c1", 1));
		expect(states(apply(b, {type: "reworded", id: c("c1"), text: "a", by: "owner"}))).toEqual({
			c1: "met@v1",
		});
	});
});

describe("standing at a head", () => {
	it("counts only a verdict at that head, and the latest one there", () => {
		const b = book(added("a"), pass("c1", 1, "A"));
		expect(states(b, "B")).toEqual({c1: "open@v1"});
		expect(states(apply(b, fail("c1", 1, "A")))).toEqual({c1: "open@v1"});
		expect(states(apply(apply(b, fail("c1", 1, "A")), pass("c1", 1, "A")))).toEqual({
			c1: "met@v1",
		});
	});

	it("ignores a verdict for an id the book never gave, or a version it never had", () => {
		const b = book(added("a"));
		expect(apply(b, pass("c9", 1))).toEqual(b);
		expect(apply(b, pass("c1", 2))).toEqual(b);
	});
});

describe("a verdict's id", () => {
	it("is v1, v2, ... in the order the book files them, and a row it ignores takes none", () => {
		const b = book(
			added("a"),
			added("b"),
			pass("c1", 1),
			pass("c9", 1),
			fail("c2", 1),
			pass("c2", 1, "B"),
		);
		expect(b.verdicts.map((v) => `${v.id} ${v.criterion}`)).toEqual(["v1 c1", "v2 c2", "v3 c2"]);
	});

	it("is never taken for a criterion's id, though both are text", () => {
		const b = book(added("a"), pass("c1", 1));
		const [v] = b.verdicts;
		// @ts-expect-error a verdict's id is not a criterion's
		const wrong: CriterionId | undefined = v?.id;
		expect(wrong).toBe("v1");
		expect(Schema.decodeUnknownOption(CriterionId)(v?.id)._tag).toBe("None");
	});
});

describe("a review round", () => {
	const round = (head: string, found: readonly string[], rows: readonly CriteriaMsg[] = []) => ({
		head,
		proof: `the review at ${head}`,
		rows: rows.flatMap((m) => (m.type === "judged" ? [m.row] : [])),
		found,
		task: T1,
	});

	it("files what it found as criteria of the book, from the same counter, failed at its head", () => {
		// Three of the ticket's criteria, three rounds: each finds problems no criterion covers.
		const ticket = book(added("a"), added("b"), added("c"));
		const rounds = [
			round("A", ["the log leaks a token", "the docs page is stale"], [pass("c1", 1)]),
			// The same one again, in other spacing, and a new one.
			round("B", ["the log  leaks a token.", "a test is skipped"], [pass("c1", 1, "B")]),
			// None of them.
			round("C", [], [pass("c1", 1, "C"), pass("c2", 1, "C"), pass("c3", 1, "C")]),
		] as const;
		const first = withRound(ticket, rounds[0]);
		expect(currentOf(first).map((x) => `${x.id} ${x.text}`)).toEqual([
			"c1 a",
			"c2 b",
			"c3 c",
			"c4 the log leaks a token",
			"c5 the docs page is stale",
		]);
		expect(historyOf(first, c("c4"))?.wordings.map((w) => w.by)).toEqual(["review"]);
		expect(states(first)).toEqual({
			c1: "met@v1",
			c2: "open@v1",
			c3: "open@v1",
			c4: "open@v1",
			c5: "open@v1",
		});
		const second = withRound(first, rounds[1]);
		expect(currentOf(second).map((x) => x.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
		expect(states(second, "B")).toEqual({
			c1: "met@v1",
			c2: "open@v1",
			c3: "open@v1",
			c4: "open@v1",
			c5: "met@v1",
			c6: "open@v1",
		});
		// A round that finds none of them passes them all at its head.
		const third = withRound(second, rounds[2]);
		expect(Object.values(states(third, "C"))).toEqual(Array(6).fill("met@v1"));
		// Every row and every judgement of a found one is a verdict, each under its own id.
		const ids = third.verdicts.map((v) => v.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.at(-1)).toBe(`v${ids.length}`);
		// The same rounds again give the same book.
		expect(rounds.reduce(withRound, ticket)).toEqual(third);
	});
});
