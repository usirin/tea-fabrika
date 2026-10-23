import {Effect, type Layer} from "effect";
import {describe, expect, it} from "vitest";
import {memoryLedger} from "../asks/ledger.ts";
import {criterionId, planOf, storyId, type TicketId, ticketId} from "../ids.ts";
import {type Revision, textOf} from "../stages/plan/plan.ts";
import {apply, type Book, EMPTY, type Row, type Stated, standingAt} from "./book.ts";
import {
	CriteriaRecord,
	followed,
	type Judgement,
	kept,
	ledgerRecord,
	memoryRecord,
} from "./record.ts";

// The criteria record: where a review keeps the round it judged, by criterion
// id and version, and where ship reads it back. Two layers: in memory, and
// over the asks ledger.

const TICKET = ticketId("example/repo#3");
const c = (n: number, version: number, text: string): Stated => ({
	id: criterionId(`c${n}`),
	version,
	text,
});
const row = (s: Stated, head: string, grade: "pass" | "fail" = "pass"): Row => ({
	criterion: s.id,
	version: s.version,
	head,
	grade,
	proof: `the review at ${head}`,
});
/** One review round at `head`: the criteria it read, its rows, and what it found that none covers. */
const round = (
	head: string,
	criteria: readonly Stated[],
	rows: readonly Row[],
	found: readonly string[] = [],
): Judgement => ({criteria, rows, found, head, proof: `the review at ${head}`});

const C1 = c(1, 1, "every window opens");
const C2 = c(2, 1, "the door locks");
const C3 = c(3, 1, "the roof keeps the rain out");
const C2_AGAIN = c(2, 2, "the door locks, from inside too");

const on = <A, E>(layer: Layer.Layer<CriteriaRecord>, body: Effect.Effect<A, E, CriteriaRecord>) =>
	Effect.runPromise(body.pipe(Effect.provide(layer)));
const judge = (ticket: TicketId, judgement: Judgement) =>
	Effect.gen(function* () {
		return yield* (yield* CriteriaRecord).judged(ticket, judgement);
	});
const read = (ticket: TicketId) =>
	Effect.gen(function* () {
		return yield* (yield* CriteriaRecord).read(ticket);
	});
const said = (v: {
	readonly id: string;
	readonly criterion: string;
	readonly version: number;
	readonly head: string;
	readonly grade: string;
}) => `${v.id} ${v.criterion} v${v.version} ${v.head} ${v.grade}`;

describe("the record in memory: the user's job", () => {
	it("three reviews of one ticket, at two heads and after a criterion is said again: ship reads every criterion as it is now, and every verdict by id and version", async () => {
		const record = memoryRecord();
		const held = await on(
			record.layer,
			Effect.gen(function* () {
				// Round 1 at head A: c3 fails.
				yield* judge(
					TICKET,
					round("A", [C1, C2, C3], [row(C1, "A"), row(C2, "A"), row(C3, "A", "fail")]),
				);
				// Round 2 at head B: all pass.
				yield* judge(TICKET, round("B", [C1, C2, C3], [row(C1, "B"), row(C2, "B"), row(C3, "B")]));
				// The owner said c2 again; round 3 at head B reads its new words.
				yield* judge(
					TICKET,
					round("B", [C1, C2_AGAIN, C3], [row(C1, "B"), row(C2_AGAIN, "B", "fail"), row(C3, "B")]),
				);
				return yield* read(ticketId("https://github.com/example/repo/issues/3"));
			}),
		);

		expect(held?.criteria).toEqual([C1, C2_AGAIN, C3]);
		expect(held?.verdicts.map(said)).toEqual([
			"v1 c1 v1 A pass",
			"v2 c2 v1 A pass",
			"v3 c3 v1 A fail",
			"v4 c1 v1 B pass",
			"v5 c2 v1 B pass",
			"v6 c3 v1 B pass",
			"v7 c1 v1 B pass",
			"v8 c2 v2 B fail",
			"v9 c3 v1 B pass",
		]);
		// The book keeps c2's history: both wordings, under the one id.
		expect(record.book(TICKET)?.live.find((e) => e.id === C2.id)?.wordings).toMatchObject([
			{version: 1, text: C2.text},
			{version: 2, text: C2_AGAIN.text},
		]);
	});

	it("what three rounds find that no criterion covers is kept under ids from the same book, and holds the merge until a round no longer finds it", async () => {
		const record = memoryRecord();
		const reads = await on(
			record.layer,
			Effect.gen(function* () {
				const all = [C1, C2, C3];
				const pass = (head: string) => all.map((s) => row(s, head));
				// Round 1 at A: every criterion passes, and two problems no criterion covers are found.
				yield* judge(
					TICKET,
					round("A", all, pass("A"), ["the log leaks a token", "a test is skipped"]),
				);
				const first = yield* read(TICKET);
				// Round 2 at B: one of them is found again, and one more.
				yield* judge(
					TICKET,
					round("B", all, pass("B"), ["the log leaks a token", "the docs page is stale"]),
				);
				const second = yield* read(TICKET);
				// Round 3 at C: none is found.
				yield* judge(TICKET, round("C", all, pass("C")));
				return {first, second, third: yield* read(TICKET)};
			}),
		);
		const ids = (h: typeof reads.first) => h?.criteria.map((x) => `${x.id} ${x.text}`);
		expect(ids(reads.first)).toEqual([
			"c1 every window opens",
			"c2 the door locks",
			"c3 the roof keeps the rain out",
			"c4 the log leaks a token",
			"c5 a test is skipped",
		]);
		expect(ids(reads.second)?.at(-1)).toBe("c6 the docs page is stale");
		const book = record.book(TICKET) ?? EMPTY;
		const open = (head: string) =>
			standingAt(book, head)
				.filter((s) => s.state === "open")
				.map((s) => s.id);
		expect(open("A")).toEqual(["c4", "c5", "c6"]);
		expect(open("B")).toEqual(["c4", "c6"]);
		expect(open("C")).toEqual([]);
		// Every verdict has an id of its own, given in order.
		const given = reads.third?.verdicts.map((v) => v.id) ?? [];
		expect(given).toEqual(given.map((_, i) => `v${i + 1}`));
	});

	it("two layers made from one record share it: what review keeps, ship reads", async () => {
		const record = memoryRecord();
		await on(record.layer, judge(TICKET, round("A", [C1], [row(C1, "A")])));

		expect(await on(record.layer, read(TICKET))).toEqual({
			criteria: [C1],
			verdicts: [{id: "v1", ...row(C1, "A")}],
		});
		expect(await on(memoryRecord().layer, read(TICKET))).toBeNull();
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
		const judgement = round("A", [C1, {...C2, text: "other words"}], [row(C1, "A"), row(C2, "A")]);
		expect(kept(book, judgement)).toEqual([row(C1, "A")]);
		// A row on a criterion the review did not say it read is not kept either.
		expect(kept(book, round("A", [], [row(C1, "A")]))).toEqual([]);
	});
});

describe("the record over the asks ledger", () => {
	const PLAN = planOf(TICKET);
	const check = {how: "test", what: "a test"} as const;
	const s1 = storyId("s1");
	const plan: Revision = {
		summary: "a house",
		stories: [{id: s1, who: "a tenant", want: "a house", why: "to live in"}],
		tasks: [
			{
				title: "build it",
				ends: "pr",
				job: {
					when: "the tenant moves in",
					result: "every window opens",
					check,
					serves: [s1],
					fixture: "three rooms",
				},
				criteria: [{when: "it rains", result: "the roof holds", check, serves: [s1]}],
			},
		],
		pointers: [],
		questions: [],
	};
	const job = textOf(plan.tasks[0]!.job);
	const roof = textOf(plan.tasks[0]!.criteria[0]!);
	const withPlan = () => {
		return memoryLedger([
			{type: "planned", plan: PLAN, tickets: [TICKET], data: plan, problems: []},
		]);
	};
	const onLedger = <A>(
		ledger: ReturnType<typeof memoryLedger>,
		body: Effect.Effect<A, unknown, CriteriaRecord>,
	) => Effect.runPromise(body.pipe(Effect.provide(ledgerRecord), Effect.provide(ledger.layer)));

	it("a plan's criteria are the ticket's, under the ids the plan's book gave them", async () => {
		const held = await onLedger(withPlan(), read(TICKET));

		expect(held?.criteria).toEqual([c(1, 1, job), c(2, 1, roof)]);
		expect(held?.verdicts).toEqual([]);
	});

	it("a review's round goes in as one judged fact, and only its rows on the book's own words", async () => {
		const ledger = withPlan();
		const held = await onLedger(
			ledger,
			Effect.gen(function* () {
				yield* judge(
					TICKET,
					round(
						"A",
						[c(1, 1, job), c(2, 1, "other words")],
						[row(c(1, 1, job), "A"), row(c(2, 1, roof), "A")],
					),
				);
				// Nothing on the book's words, and nothing found: nothing is written.
				yield* judge(TICKET, round("B", [], [row(c(1, 1, job), "B")]));
				return yield* read(TICKET);
			}),
		);

		expect(held?.verdicts).toEqual([{id: "v1", ...row(c(1, 1, job), "A")}]);
		expect(ledger.read().map((e) => e.fact.type)).toEqual(["planned", "judged"]);
	});

	it("what a review finds is a criterion of the plan's first task, under the plan book's next id", async () => {
		const ledger = withPlan();
		const held = await onLedger(
			ledger,
			Effect.gen(function* () {
				yield* judge(
					TICKET,
					round("A", [c(1, 1, job), c(2, 1, roof)], [row(c(1, 1, job), "A")], ["a leak"]),
				);
				return yield* read(TICKET);
			}),
		);

		expect(held?.criteria.map((x) => `${x.id} ${x.text}`)).toEqual([
			`c1 ${job}`,
			`c2 ${roof}`,
			"c3 a leak",
		]);
		expect(held?.verdicts.map(said)).toEqual(["v1 c1 v1 A pass", "v2 c3 v1 A fail"]);
	});

	it("a ticket no plan names reads as none, and a review of it writes nothing", async () => {
		const ledger = withPlan();
		const other = ticketId("example/repo#4");
		const held = await onLedger(
			ledger,
			Effect.gen(function* () {
				yield* judge(other, round("A", [C1], [row(C1, "A")], ["a leak"]));
				return yield* read(other);
			}),
		);

		expect(held).toBeNull();
		expect(ledger.read()).toHaveLength(1);
	});
});

// The judged rows a book holds, applied by hand: what the record's own steps must agree with.
it("the record's steps are the book's own: a judged row applied by hand gives the same book", () => {
	const byHand = apply(followed(EMPTY, [C1]), {type: "judged", row: row(C1, "A")});
	const record = memoryRecord();
	Effect.runSync(
		judge(TICKET, round("A", [C1], [row(C1, "A")])).pipe(Effect.provide(record.layer)),
	);
	expect(record.book(TICKET)).toEqual(byHand);
});
