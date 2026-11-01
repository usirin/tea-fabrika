import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika-old";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {plans86b} from "../../asks/cases.ts";
import {type PlanState, plan, readFacts, readTicket} from "./machine.ts";
import type {PlanDraft} from "./plan.ts";
import {planKind} from "./program.ts";
import type {PlanTicket, Settings} from "./services.ts";

// The plan machine as its kind keeps it, on tea's pbt: every state it reaches from its init,
// driven by any list of its Msgs, saves through the schema `planKind` declares and loads back
// equal. A start after a kill reads it back through that schema and starts the planner over, so a
// state the machine can reach and the schema cannot read is a plan that cannot go on.
//
// The planner's answers are real plans (experiment 86b's), and one the Check sends back.

type Machine = typeof plan;
type Msg = MsgOf<Machine>;

const ctx = stubCtxThrowingProxy<undefined>();
const URL = "https://github.com/o/r/issues/1";
const KEY = "plan/o-r-1";
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const ticket = (patch: Partial<PlanTicket> = {}): PlanTicket => ({
	url: URL,
	number: 1,
	state: "open",
	title: "windows",
	body: "Every window opens.",
	at: "h0",
	...patch,
});
const DRAFTS: readonly PlanDraft[] = plans86b().flatMap((p) => (p.plan === null ? [] : [p.plan]));
const [first] = DRAFTS;
if (first === undefined) throw new Error("experiment 86b has no plans");
/** A draft the Check sends back: the planner tries again, in the same conversation. */
const UNCHECKED: PlanDraft = {...first, summary: ""};
/** Every run id the refine loop gives: two tries, before and after one restart. */
const id = fc.constantFrom(`${KEY}/1`, `${KEY}/2`, `${KEY}/again/1/1`, `${KEY}/again/1/2`);
const spend = fc.record({
	costUsd: fc.integer({min: 0, max: 3}),
	tokens: fc.nat({max: 9000}),
	context: fc.nat({max: 9000}),
	turns: fc.nat({max: 9}),
	minutes: fc.nat({max: 9}),
});
const UNKNOWN = {_tag: "unknown"} as const;
const reads = readTicket({ticket: URL});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {
		ask: fc.record({ticket: fc.constant(URL), tries: fc.integer({min: 1, max: 2})}),
		settings: fc.constant(SETTINGS),
		key: fc.constant(KEY),
	}),
	resume: arbConstantMsg("resume"),
	plan_ticket_ok: fc
		.constantFrom(ticket(), ticket({at: null}), ticket({state: "closed"}))
		.map((t) => readTicket.ok(reads, t, 0)),
	plan_ticket_err: fc.constant(readTicket.err(reads, UNKNOWN, 0)),
	plan_facts_ok: fc
		.constantFrom({text: "`open` is in src/window.ts", names: ["open"]}, {text: "", names: []})
		.map((f) => readFacts.ok(readFacts({ticket: ticket()}), f, 0)),
	plan_facts_err: fc.constant(readFacts.err(readFacts({ticket: ticket()}), UNKNOWN, 0)),
	plan_tool: arbRecordMsg("plan_tool", {
		key: fc.constant(KEY),
		id,
		tool: fc.constantFrom("Read", "Grep"),
	}),
	plan_finished: arbRecordMsg("plan_finished", {
		key: fc.constant(KEY),
		id,
		output: fc.oneof(
			{weight: 3, arbitrary: fc.constantFrom(...DRAFTS.slice(0, 3))},
			{weight: 2, arbitrary: fc.constant(UNCHECKED)},
			{weight: 1, arbitrary: fc.constant(null)},
		),
		session: fc.constant("session-1"),
		spend,
	}),
	plan_failed: arbRecordMsg("plan_failed", {
		key: fc.constant(KEY),
		id,
		error: fc.constantFrom("error_max_budget_usd: spent", "the run broke"),
		spend,
	}),
};
/** Weighted to the answers that move a plan on, so every phase is reached. */
const WEIGHTS = {plan_ticket_ok: 4, plan_facts_ok: 3, plan_finished: 6};
/** A plan begins as its parent begins it, with `start`; the rest comes in any order. */
const lists = fc
	.tuple(table.start, fc.array(arbMsg(table, {weights: WEIGHTS}), {maxLength: 30, size: "max"}))
	.map(([start, rest]) => [start, ...rest]);

/**
 * Every state `machine` reaches from its init, saved through the kind's schema and loaded back.
 * `saved`: the phase of each state saved, so a test can say the law held on every shape of state.
 */
const keepsEvery = (machine: Machine, runs = 150, saved = new Set<string>()) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("plan:r1", null));
			const store = handle.store("plan", KEY, planKind.state);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
				saved.add(s.phase === "drafting" ? `drafting ${s.refining.phase}` : s.phase);
			}
		}),
		{numRuns: runs, seed: 1},
	);

const PHASES = ["idle", "reading", "gathering", "drafting drafting", "over"];

describe("the plan machine is kept", () => {
	it("every state it reaches from its init saves and loads back equal, in every phase", async () => {
		const saved = new Set<string>();
		await keepsEvery(plan, 150, saved);
		expect([...saved].sort()).toEqual([...PHASES].sort());
	});

	it("the law is seen to fail on a planted mistake: a plan that keeps the planner's whole answer dies at its first save", async () => {
		const keepsTheAnswer: Machine = {
			...plan,
			update: {
				...plan.update,
				plan_finished: (s, m) => {
					const [next, cmds] = plan.update.plan_finished(s, m);
					return [{...next, ...m} as PlanState, cmds];
				},
			},
		};
		await expect(keepsEvery(keepsTheAnswer, 40)).rejects.toThrow(/Counterexample/);
	});
});
