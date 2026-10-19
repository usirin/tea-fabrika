import {Effect, type Layer} from "effect";
import {describe, expect, it} from "vitest";
import {Ledger, memoryLedger} from "../asks/ledger.ts";
import {type Revision, textOf} from "../stages/plan/plan.ts";
import {apply, type Book, criterionId, EMPTY, type Stated, type Verdict} from "./book.ts";
import {
	CriteriaRecord,
	followed,
	type Judgement,
	kept,
	ledgerRecord,
	memoryRecord,
	ticketKey,
} from "./record.ts";

// The criteria record: where a review keeps the rows it gave, by criterion id
// and version, and where ship reads them back. Two layers: in memory, and
// over the asks ledger.

const TICKET = "example/repo#3";
const c = (n: number, version: number, text: string): Stated => ({
	id: criterionId(`c${n}`),
	version,
	text,
});
const row = (s: Stated, head: string, grade: "pass" | "fail" = "pass"): Verdict => ({
	id: s.id,
	version: s.version,
	head,
	grade,
	proof: `the review at ${head}`,
});

const C1 = c(1, 1, "every window opens");
const C2 = c(2, 1, "the door locks");
const C3 = c(3, 1, "the roof keeps the rain out");
const C2_AGAIN = c(2, 2, "the door locks, from inside too");

const on = <A, E>(layer: Layer.Layer<CriteriaRecord>, body: Effect.Effect<A, E, CriteriaRecord>) =>
	Effect.runPromise(body.pipe(Effect.provide(layer)));
const judge = (ticket: string, judgement: Judgement) =>
	Effect.gen(function* () {
		return yield* (yield* CriteriaRecord).judged(ticket, judgement);
	});
const read = (ticket: string) =>
	Effect.gen(function* () {
		return yield* (yield* CriteriaRecord).read(ticket);
	});

describe("the record in memory: the user's job", () => {
	it("three reviews of one ticket, at two heads and after a criterion is said again: ship reads every criterion as it is now, and every row by id and version", async () => {
		const record = memoryRecord();
		const held = await on(
			record.layer,
			Effect.gen(function* () {
				// Round 1 at head A: c3 fails.
				yield* judge(TICKET, {
					criteria: [C1, C2, C3],
					verdicts: [row(C1, "A"), row(C2, "A"), row(C3, "A", "fail")],
				});
				// Round 2 at head B: all pass.
				yield* judge(TICKET, {
					criteria: [C1, C2, C3],
					verdicts: [row(C1, "B"), row(C2, "B"), row(C3, "B")],
				});
				// The owner said c2 again; round 3 at head B reads its new words.
				yield* judge(TICKET, {
					criteria: [C1, C2_AGAIN, C3],
					verdicts: [row(C1, "B"), row(C2_AGAIN, "B", "fail"), row(C3, "B")],
				});
				return yield* read(`https://github.com/example/repo/issues/3`);
			}),
		);

		expect(held?.criteria).toEqual([C1, C2_AGAIN, C3]);
		expect(held?.verdicts.map((v) => `${v.id} v${v.version} ${v.head} ${v.grade}`)).toEqual([
			"c1 v1 A pass",
			"c2 v1 A pass",
			"c3 v1 A fail",
			"c1 v1 B pass",
			"c2 v1 B pass",
			"c3 v1 B pass",
			"c1 v1 B pass",
			"c2 v2 B fail",
			"c3 v1 B pass",
		]);
		// The book keeps c2's history: both wordings, under the one id.
		expect(record.book(TICKET)?.live.find((e) => e.id === C2.id)?.wordings).toMatchObject([
			{version: 1, text: C2.text},
			{version: 2, text: C2_AGAIN.text},
		]);
	});

	it("two layers made from one record share it: what review keeps, ship reads", async () => {
		const record = memoryRecord();
		await on(record.layer, judge(TICKET, {criteria: [C1], verdicts: [row(C1, "A")]}));

		expect(await on(record.layer, read(TICKET))).toEqual({
			criteria: [C1],
			verdicts: [row(C1, "A")],
		});
		expect(await on(memoryRecord().layer, read(TICKET))).toBeNull();
	});

	it("a ticket that is not one is never kept, and reads as none", async () => {
		const record = memoryRecord();
		await on(record.layer, judge("not a ticket", {criteria: [C1], verdicts: [row(C1, "A")]}));

		expect(await on(record.layer, read("not a ticket"))).toBeNull();
		expect(record.book("not a ticket")).toBeNull();
	});
});

describe("a book that follows a ticket no plan holds", () => {
	const book: Book = followed(EMPTY, [C1, C2]);

	it("adds each id in turn, from c1 at version 1", () => {
		expect(book.live.map((e) => e.id)).toEqual([C1.id, C2.id]);
	});

	it("an id out of turn, or a version that skips one, is left as it was", () => {
		expect(followed(book, [C1, C2, c(5, 1, "out of turn")]).live.map((e) => e.id)).toEqual([
			C1.id,
			C2.id,
		]);
		expect(followed(book, [c(1, 3, "skips v2"), C2]).live[0]?.wordings).toHaveLength(1);
	});

	it("an id the ticket no longer has is retired, and its id is never given again", () => {
		const after = followed(book, [C1]);
		expect(after.live.map((e) => e.id)).toEqual([C1.id]);
		expect(after.retired.map((e) => e.id)).toEqual([C2.id]);
		expect(followed(after, [C1, c(3, 1, "a new one")]).live.map((e) => e.id)).toEqual([
			C1.id,
			criterionId("c3"),
		]);
	});

	it("keeps a row only when the review read the book's own words for that version", () => {
		const judgement: Judgement = {
			criteria: [C1, {...C2, text: "other words"}],
			verdicts: [row(C1, "A"), row(C2, "A")],
		};
		expect(kept(book, judgement)).toEqual([row(C1, "A")]);
		// A row on a criterion the review did not say it read is not kept either.
		expect(kept(book, {criteria: [], verdicts: [row(C1, "A")]})).toEqual([]);
	});
});

describe("a ticket's key", () => {
	it.each([
		["example/repo#3", "example/repo#3"],
		["https://github.com/example/repo/issues/3", "example/repo#3"],
		["https://github.com/example/repo/pull/3", null],
		["#3", null],
	])("%s is %s", (ticket, key) => {
		expect(ticketKey(ticket)).toBe(key);
	});
});

describe("the record over the asks ledger", () => {
	const PLAN = "https://github.com/example/repo/issues/3";
	const check = {how: "test", what: "a test"} as const;
	const plan: Revision = {
		summary: "a house",
		stories: [{id: "s1", who: "a tenant", want: "a house", why: "to live in"}],
		tasks: [
			{
				title: "build it",
				ends: "pr",
				job: {
					when: "the tenant moves in",
					result: "every window opens",
					check,
					serves: ["s1"],
					fixture: "three rooms",
				},
				criteria: [{when: "it rains", result: "the roof holds", check, serves: ["s1"]}],
			},
		],
		pointers: [],
		questions: [],
	};
	const job = textOf(plan.tasks[0]!.job);
	const roof = textOf(plan.tasks[0]!.criteria[0]!);
	const withPlan = () => {
		const ledger = memoryLedger();
		Effect.runSync(
			Effect.gen(function* () {
				yield* (yield* Ledger).append({
					type: "planned",
					plan: PLAN,
					tickets: [PLAN],
					data: plan,
					problems: [],
				});
			}).pipe(Effect.provide(ledger.layer)),
		);
		return ledger;
	};
	const onLedger = <A>(
		ledger: ReturnType<typeof memoryLedger>,
		body: Effect.Effect<A, unknown, CriteriaRecord>,
	) => Effect.runPromise(body.pipe(Effect.provide(ledgerRecord), Effect.provide(ledger.layer)));

	it("a plan's criteria are the ticket's, under the ids the plan's book gave them", async () => {
		const held = await onLedger(withPlan(), read("example/repo#3"));

		expect(held?.criteria).toEqual([c(1, 1, job), c(2, 1, roof)]);
		expect(held?.verdicts).toEqual([]);
	});

	it("a review's rows go in as one judged fact, and only those on the book's own words", async () => {
		const ledger = withPlan();
		const held = await onLedger(
			ledger,
			Effect.gen(function* () {
				yield* judge(PLAN, {
					criteria: [c(1, 1, job), c(2, 1, "other words")],
					verdicts: [row(c(1, 1, job), "A"), row(c(2, 1, roof), "A")],
				});
				// Nothing on the book's words: nothing is written.
				yield* judge(PLAN, {criteria: [], verdicts: [row(c(1, 1, job), "B")]});
				return yield* read(PLAN);
			}),
		);

		expect(held?.verdicts).toEqual([row(c(1, 1, job), "A")]);
		expect(ledger.read().map((e) => e.fact.type)).toEqual(["planned", "judged"]);
	});

	it("a ticket no plan names reads as none, and a review of it writes nothing", async () => {
		const ledger = withPlan();
		const held = await onLedger(
			ledger,
			Effect.gen(function* () {
				yield* judge("example/repo#4", {criteria: [C1], verdicts: [row(C1, "A")]});
				return yield* read("example/repo#4");
			}),
		);

		expect(held).toBeNull();
		expect(ledger.read()).toHaveLength(1);
	});
});

// The judged rows a book holds, applied by hand: what the record's own steps must agree with.
it("the record's steps are the book's own: a judged row applied by hand gives the same book", () => {
	const byHand = apply(followed(EMPTY, [C1]), {type: "judged", verdict: row(C1, "A")});
	const record = memoryRecord();
	Effect.runSync(
		judge(TICKET, {criteria: [C1], verdicts: [row(C1, "A")]}).pipe(Effect.provide(record.layer)),
	);
	expect(record.book(TICKET)).toEqual(byHand);
});
