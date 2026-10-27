import {
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika";
import type {AnswerBody, Ask, RulingAsk} from "@kampus/pipeline/asks/ask";
import {plans86b} from "@kampus/pipeline/asks/cases";
import {checkId, planAskId, stuckId} from "@kampus/pipeline/asks/rules";
import {askId, criterionId, planOf, taskId, ticketId} from "@kampus/pipeline/ids";
import {numbered} from "@kampus/pipeline/stages/plan/ids";
import {revisionOfDraft} from "@kampus/pipeline/stages/plan/plan";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Desk, desk, deskKind, GONE} from "./inbox.ts";
import {saidOf} from "./pages.ts";

// The laws of the owner's desk, the inbox machine, on tea's pbt: after every step of any list of
// Msgs, from the real init. The core's lists, answers and refusals are drawn in any order, as
// its inputs are read side by side and one can come after another said later.

type Machine = typeof desk;
type Msg = MsgOf<Machine>;
type DeskStep = Step<Desk, Msg, never>;

// ---------------------------------------------------------------- generators

/** Four asks, raised in the order of their number. Each list the core says holds each once. */
const ASKS: readonly RulingAsk[] = [1, 2, 3, 4].map((n) => ({
	id: askId(`ruling:o/r#${n}`),
	at: n,
	for: "ruling",
	ticket: ticketId(`o/r#${n}`),
	ask: `Ruling ${n}?`,
	options: ["yes", "no"],
	why: "sort sent it",
}));
const ask = fc.constantFrom(...ASKS);
const ANSWERS: readonly AnswerBody[] = [
	{kind: "approve"},
	{kind: "yes"},
	{kind: "no", why: "not now"},
	{kind: "keep_going", rounds: 2},
	{kind: "rule", answer: "Keep it.", rule: "lasting", build: false},
];

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	waiting: arbRecordMsg("waiting", {asks: fc.shuffledSubarray([...ASKS])}),
	settled: arbRecordMsg("settled", {ask, answer: fc.constantFrom(...ANSWERS)}),
	refused: arbRecordMsg("refused", {
		id: ask.map((a) => a.id),
		why: fc.constantFrom("not a version this plan has", "rounds out of range"),
	}),
};
const lists = fc.array(arbMsg(table), {maxLength: 30, size: "max"});
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: DeskStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law, OPTS),
});
/** The ids of what waits, as plain text: a refusal and a closed page are kept under one. */
const openIds = (s: Desk): readonly string[] => s.open.map((a) => a.id);

const oldestFirst = every(
	"what waits is shown oldest first, each ask once",
	({next}) =>
		next.open.every((a, i) => i === 0 || (next.open[i - 1]?.at ?? 0) <= a.at) &&
		new Set(openIds(next)).size === next.open.length,
);

const staysClosed = every(
	"an ask that stopped waiting never opens again, and keeps its closed page",
	({prev, next}) =>
		Object.keys(prev.closed).every((id) => next.closed[id] !== undefined) &&
		openIds(next).every((id) => next.closed[id] === undefined),
);

const neverLost = every(
	"an ask never just vanishes: one that stops waiting is closed",
	({prev, next}) =>
		openIds(prev).every((id) => openIds(next).includes(id) || next.closed[id] !== undefined),
);

const refusalsWait = every("a refusal is kept only for an ask that still waits", ({next}) =>
	Object.keys(next.refused).every((id) => openIds(next).includes(id)),
);

const listShown = every(
	"every ask the core says waits, and that never closed, is open after it",
	({prev, msg, next}) =>
		msg.type !== "waiting" ||
		msg.asks
			.filter((a) => prev.closed[a.id] === undefined)
			.every((a) => openIds(next).includes(a.id)),
);

const answerShown = every(
	"an answer the core took closes its ask, with what the owner said",
	({msg, next}) =>
		msg.type !== "settled" ||
		(!openIds(next).includes(msg.ask.id) && next.closed[msg.ask.id]?.said === saidOf(msg.answer)),
);

const refusalShown = every(
	"the core's refusal of an answer to an ask that waits is shown on that ask",
	({prev, msg, next}) =>
		msg.type !== "refused" || !openIds(prev).includes(msg.id) || next.refused[msg.id] === msg.why,
);

const LAWS = [
	oldestFirst,
	staysClosed,
	neverLost,
	refusalsWait,
	listShown,
	answerShown,
	refusalShown,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = desk.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...desk,
	update: {...real, ...update},
});

const PLANTS = {
	/** The list is shown in the order the core said it. */
	keepsTheCoresOrder: plant({
		waiting: (s, m) => {
			const [next] = real.waiting(s, m);
			return [{...next, open: m.asks.filter((a) => openIds(next).includes(a.id))}, []];
		},
	}),
	/** A list said before an answer, and heard after it, opens the answered ask again. */
	reopens: plant({
		waiting: (s, m) => {
			const [next] = real.waiting({...s, closed: {}}, m);
			return [{...next, closed: {...s.closed, ...next.closed}}, []];
		},
	}),
	/** An ask left out of a new list is dropped, with no closed page. */
	dropsTheGone: plant({
		waiting: (s, m) => {
			const [next] = real.waiting(s, m);
			return [{...next, closed: s.closed}, []];
		},
	}),
	/** Refusals are kept for asks that no longer wait. */
	keepsOldRefusals: plant({
		settled: (s, m) => {
			const [next] = real.settled(s, m);
			return [{...next, refused: s.refused}, []];
		},
	}),
	/** A new list is not heard. */
	deafToLists: plant({waiting: (s) => [s, []]}),
	/** An answer closes its ask with nothing said. */
	saysNothing: plant({
		settled: (s, m) => {
			const [next] = real.settled(s, m);
			return [{...next, closed: {...next.closed, [m.ask.id]: {ask: m.ask, said: GONE}}}, []];
		},
	}),
	/** A refusal is not heard. */
	deafToRefusals: plant({refused: (s) => [s, []]}),
} satisfies Readonly<Record<string, Machine>>;

describe("the owner's desk's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(desk);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			keepsTheCoresOrder: [oldestFirst.name],
			reopens: [staysClosed.name],
			dropsTheGone: [neverLost.name],
			keepsOldRefusals: [refusalsWait.name],
			deafToLists: [listShown.name],
			saysNothing: [answerShown.name],
			deafToRefusals: [refusalShown.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});

// ---------------------------------------------------------------- law: every reachable desk is kept

/** Every kind of ask the core raises, not only rulings: the desk is kept through a union of all four. */
const plans = plans86b().flatMap((p) => {
	const revision = p.plan === null ? null : revisionOfDraft(p.plan);
	return revision === null ? [] : [{ticket: ticketId(p.ticket), data: numbered(revision)}];
});
const [first, second] = plans;
if (first === undefined || second === undefined) throw new Error("experiment 86b has no plans");
const PLAN = planOf(first.ticket);
const T1 = taskId("t1");
const KINDS: readonly Ask[] = [
	...ASKS,
	{
		for: "plan",
		id: planAskId(PLAN, 1),
		at: 5,
		plan: PLAN,
		tickets: [first.ticket],
		version: 1,
		data: first.data,
		since: null,
		problems: [],
	},
	{
		for: "plan",
		id: planAskId(PLAN, 2),
		at: 6,
		plan: PLAN,
		tickets: [first.ticket, second.ticket],
		version: 2,
		data: second.data,
		since: {version: 1, data: first.data},
		problems: ["a task has no criteria"],
	},
	{
		for: "stuck",
		id: stuckId(PLAN, T1, 1),
		at: 7,
		plan: PLAN,
		task: T1,
		title: "Sort the list",
		criteria: [],
		open: [3, 3],
		why: "no_progress",
		time: 1,
	},
	{
		for: "check",
		id: checkId(PLAN, T1, 2, "a pack"),
		at: 8,
		plan: PLAN,
		task: T1,
		build: 2,
		by: "a pack",
		question: "Does the page look right?",
		attachments: [{label: "after", ref: "shots/after.png"}],
	},
];
const anyKind = fc.constantFrom(...KINDS);
const kindsTable: MsgArbitraryTable<Msg> = {
	waiting: arbRecordMsg("waiting", {asks: fc.shuffledSubarray([...KINDS])}),
	settled: arbRecordMsg("settled", {
		ask: anyKind,
		answer: fc.constantFrom<AnswerBody>(
			...ANSWERS,
			{kind: "change", line: "c3", to: "the list stays sorted"},
			{kind: "remove"},
			{kind: "reword", criterion: criterionId("c3"), when: "it runs twice", result: "both pass"},
		),
	}),
	refused: arbRecordMsg("refused", {
		id: anyKind.map((a) => a.id),
		why: fc.constantFrom("not a version this plan has", "rounds out of range"),
	}),
};
const kindsLists = fc.array(arbMsg(kindsTable), {maxLength: 30, size: "max"});

/** Every desk `machine` reaches from its init, saved through the schema `deskKind` declares, and loaded back. */
const keepsEvery = (machine: Machine, runs = 150) =>
	fc.assert(
		fc.asyncProperty(kindsLists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("desk:r1", null));
			const store = handle.store("desk", "desk", deskKind.state);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
			}
		}),
		{numRuns: runs, seed: 1},
	);

describe("the owner's desk is kept", () => {
	it("every desk it reaches from its init, with every kind of ask, saves and loads back equal", async () => {
		await keepsEvery(desk);
	});

	it("the law is seen to fail on a planted mistake: a desk that keeps the answer whole, not what it said, dies at its first save", async () => {
		const keepsTheAnswer = plant({
			settled: (s, m) => {
				const [next] = real.settled(s, m);
				return [
					{
						...next,
						closed: {...next.closed, [m.ask.id]: {...m, said: saidOf(m.answer)}},
					},
					[],
				];
			},
		});
		await expect(keepsEvery(keepsTheAnswer, 20)).rejects.toThrow(/Counterexample/);
	});
});
