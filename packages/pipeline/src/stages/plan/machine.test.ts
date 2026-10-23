import {applyCell} from "@demlik/tea";
import {noSpend, type Spend} from "@kampus/fabrika/agents/claude";
import {describe, expect, it} from "vitest";
import {sentBack} from "../../refine.ts";
import {
	MAX_RESTARTS,
	type PlanCmd,
	type PlanState,
	plan,
	readFacts,
	readTicket,
	runSub,
} from "./machine.ts";
import type {PlanDraft as Plan} from "./plan.ts";
import type {PlanTicket, Settings} from "./services.ts";

// The plan machine, one step at a time: a state, a Msg, and what comes out.
// No engine, no service, no agent.

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: PlanState, msg: AnyMsg) => applyCell<PlanState, AnyMsg, PlanCmd>(plan, s, msg);

const URL = "https://github.com/acme/widgets/issues/7";
const SETTINGS: Settings = {model: "opus", effort: "medium", budget: 1};
const TICKET: PlanTicket = {
	url: URL,
	number: 7,
	state: "open",
	title: "A small clock value starts spans at the wrong time",
	body: "It does.",
	at: "c".repeat(40),
};
const SPENT: Spend = {costUsd: 0.3, tokens: 1000, context: 400, turns: 3, minutes: 0.5};

const good: Plan = {
	summary: "Spans start at the wrong time.",
	stories: [{id: "s1", who: "a host", want: "spans at its clock", why: "traces line up"}],
	tasks: [
		{
			title: "Read clock values as epoch milliseconds",
			ends: "pr",
			job: {
				when: "a clock starts at 1 and three runs go by",
				result: "every span starts at its clock value",
				fixture: "three runs on a clock from 1",
				check: {how: "test", what: "a test reads every span's start"},
				serves: ["s1"],
			},
			criteria: [
				{
					when: "a clock starts at 1",
					result: "the root span starts at 1",
					check: {how: "test", what: "a test reads the root span's start"},
					serves: ["s1"],
				},
			],
		},
	],
	pointers: [],
	questions: [],
};
const coded: Plan = {
	...good,
	tasks: [
		{...good.tasks[0]!, criteria: [{...good.tasks[0]!.criteria[0]!, when: "startSpan gets 1"}]},
	],
};

/** From idle to the planner's first draft, with facts gathered or not, and the names a user meets. */
function drafting(facts: string | null, tries = 3, names: readonly string[] = []): PlanState {
	const [reading, [read]] = step(
		{phase: "idle"},
		{type: "start", ask: {ticket: URL, tries}, settings: SETTINGS, key: "k"},
	);
	const [gathering, [gather]] = step(reading, {type: readTicket.okType, cmd: read, value: TICKET});
	return facts === null
		? step(gathering, {type: readFacts.errType, cmd: gather, error: {_tag: "unknown"}})[0]
		: step(gathering, {type: readFacts.okType, cmd: gather, value: {text: facts, names}})[0];
}

const runOf = (s: PlanState) => runSub.deps(s)?.run ?? null;
const finished = (s: PlanState, output: Plan | null, spend: Spend = SPENT) => ({
	type: "plan_finished",
	key: "k",
	id: runOf(s)?.id,
	output,
	session: "s",
	spend,
});

describe("the plan machine", () => {
	it("reads the ticket, then the facts, then starts the planner at the ticket's commit with both", () => {
		const [reading, cmds] = step(
			{phase: "idle"},
			{type: "start", ask: {ticket: URL, tries: 3}, settings: SETTINGS, key: "k"},
		);
		expect(cmds).toEqual([readTicket({ticket: URL})]);
		expect(reading.phase).toBe("reading");

		const s = drafting("- `startSpan`: in src/otel.ts");
		expect(s.phase).toBe("drafting");
		const run = runOf(s);
		expect(run).toMatchObject({id: "k/1", folder: TICKET.at, session: {continues: false}});
		expect(run?.prompt).toContain(TICKET.title);
		expect(run?.prompt).toContain("- `startSpan`: in src/otel.ts");
		expect(runSub.deps(s)?.settings).toEqual(SETTINGS);
	});

	it("goes on without facts: the planner is told to read the code itself", () => {
		const s = drafting(null);
		expect(s.phase === "drafting" && s.facts).toBe(false);
		expect(runOf(s)?.prompt).toContain("Nothing was gathered. Read the code yourself.");
	});

	it("ends done with the plan when the first draft passes the Check, and counts what it cost", () => {
		const [over] = step(drafting("f"), finished(drafting("f"), good));
		expect(over).toMatchObject({
			phase: "over",
			outcome: {kind: "done", part: false},
			report: {plan: good, tries: 1, facts: true, problems: [], spend: {costUsd: 0.3, turns: 3}},
		});
	});

	it("sends the Check's problems back in the same conversation, and sums the spend over the tries", () => {
		const first = drafting("f");
		const [second] = step(first, finished(first, coded));
		const run = runOf(second);
		expect(run).toMatchObject({id: "k/2", session: {continues: true}});
		expect(run?.prompt).toBe(
			sentBack([
				'Task 1 ("Read clock values as epoch milliseconds"), criterion 1 ("When startSpan gets 1, the root span starts at 1") names code a user never meets: startSpan (a camelCase name). Name things the way a user meets them (a command, a flag, a config key, a published name), and put internal files and names in pointers.',
			]),
		);
		const [over] = step(second, finished(second, good));
		expect(over).toMatchObject({
			outcome: {kind: "done"},
			report: {tries: 2, spend: {costUsd: 0.6, tokens: 2000, turns: 6, minutes: 1}},
		});
	});

	it("hands the Check the names a user meets, so a criterion may name them, after a restart too", () => {
		const s = drafting("f", 3, ["startSpan"]);
		expect(step(s, finished(s, coded))[0]).toMatchObject({outcome: {kind: "done"}});
		const [again] = step(s, {type: "resume"});
		expect(step(again, finished(again, coded))[0]).toMatchObject({outcome: {kind: "done"}});
	});

	it("asks the owner when the plan passes with open questions", () => {
		const withQuestion = {
			...good,
			questions: [{ask: "A new export?", options: ["yes", "no"], lean: "no", why: "smaller"}],
		};
		const s = drafting("f");
		const [over] = step(s, finished(s, withQuestion));
		expect(over).toMatchObject({
			outcome: {kind: "ask", who: "owner", for: "questions"},
			report: {plan: withQuestion},
		});
	});

	it("ends unchecked with the last plan and its problems once the tries are spent", () => {
		const s = drafting("f", 1);
		const [over] = step(s, finished(s, coded));
		expect(over).toMatchObject({
			outcome: {kind: "stuck", why: "unchecked"},
			report: {plan: coded, tries: 1},
		});
		expect(over.phase === "over" && over.report.problems).toHaveLength(1);
	});

	it("tells a broken run from one stopped at its budget, and an answer that is not a plan from both", () => {
		const s = drafting("f");
		const failed = (error: string) => ({...finished(s, null), type: "plan_failed", error});
		expect(step(s, failed("error_max_budget_usd"))[0]).toMatchObject({
			outcome: {kind: "stuck", why: "over_budget"},
		});
		expect(step(s, failed("error_during_execution"))[0]).toMatchObject({
			outcome: {kind: "stuck", why: "draft_failed"},
			report: {problems: ["error_during_execution"]},
		});
		expect(step(s, finished(s, null))[0]).toMatchObject({
			outcome: {kind: "stuck", why: "draft_failed"},
			report: {problems: ["the answer did not fit the schema"]},
		});
	});

	it("passes over a late answer from an earlier run", () => {
		const first = drafting("f");
		const [second] = step(first, finished(first, coded));
		const late = finished(first, good);
		expect(step(second, late)).toEqual([second, []]);
	});

	it("skips a closed ticket, and stops on one it could not read", () => {
		const [reading, [read]] = step(
			{phase: "idle"},
			{type: "start", ask: {ticket: URL, tries: 3}, settings: SETTINGS, key: "k"},
		);
		expect(
			step(reading, {type: readTicket.okType, cmd: read, value: {...TICKET, state: "closed"}})[0],
		).toMatchObject({outcome: {kind: "skip", why: "closed"}});
		expect(
			step(reading, {type: readTicket.errType, cmd: read, error: {_tag: "unknown"}})[0],
		).toMatchObject({outcome: {kind: "stuck", why: "read_failed"}});
	});

	it("after a restart, starts the planner over once under a new conversation, then stops", () => {
		const s = drafting("f");
		const [again] = step(s, {type: "resume"});
		expect(runOf(again)).toMatchObject({id: "k/again/1/1", session: {continues: false}});
		expect(runOf(again)?.prompt).toContain("f");
		expect(MAX_RESTARTS).toBe(1);
		expect(step(again, {type: "resume"})[0]).toMatchObject({
			outcome: {kind: "stuck", why: "cut_off"},
		});
	});

	it("re-sends the read that was in flight after a restart", () => {
		const [reading, [read]] = step(
			{phase: "idle"},
			{type: "start", ask: {ticket: URL, tries: 3}, settings: SETTINGS, key: "k"},
		);
		expect(step(reading, {type: "resume"})).toEqual([reading, [read]]);
	});

	it("counts nothing for a run that spent nothing", () => {
		const s = drafting("f");
		const [over] = step(s, finished(s, good, noSpend));
		expect(over).toMatchObject({report: {spend: {costUsd: 0, turns: 0}}});
	});
});
