import {defineMachine, type Sub} from "@demlik/tea";
import type {DraftRun, Spend} from "@kampus/fabrika/agents/claude";
import {Schema} from "effect";
import {createRefineLoop, refiningOf} from "../../combos.ts";
import {gather, keptCmd, listen} from "../../primitives.ts";
import {planProblems} from "./check.ts";
import {PlanOutcome} from "./outcome.ts";
import {PlanDraft} from "./plan.ts";
import {Brief, planDraft, promptFor} from "./planner.ts";
import {Facts, type PlanMsg, PlanTicket, Settings} from "./services.ts";

// The plan machine: one ticket in, one typed outcome and a plan out. One
// agent sits inside it, the planner, and the machine decides everything
// around it:
//
//   reading    read the ticket. A Gather
//   gathering  what code says about the names and paths it mentions. A
//              Gather; when it fails, the planner reads the code itself
//   drafting   the refine combo: the planner drafts, the pure Check
//              (./check.ts) reads the draft, and its problems go back to the
//              planner in the same conversation, up to `tries` drafts
//   over       the outcome, and the report it was worked out from
//
// It reads, and writes nothing anywhere. Its input is the ticket's url, the
// settings and the conversation's name, so it runs alone or under a parent.

const Unknown = ["unknown"] as const;

/** One plan, as asked. `tries`: the most drafts the Check may send back for. */
export const PlanAsk = Schema.Struct({ticket: Schema.String, tries: Schema.Finite});
export type PlanAsk = typeof PlanAsk.Type;

const TicketIn = Schema.Struct({ticket: Schema.String});
const FactsIn = Schema.Struct({ticket: PlanTicket});

export const readTicket = gather("plan_ticket", {input: TicketIn, ok: PlanTicket, err: Unknown});

export const readFacts = gather("plan_facts", {input: FactsIn, ok: Facts, err: Unknown});

type TicketCmd = ReturnType<typeof readTicket>;
type FactsCmd = ReturnType<typeof readFacts>;
export type PlanCmd = TicketCmd | FactsCmd;

/** The planner's run as the Sub asks for it: the run, and how it may spend. */
export type RunSub = Sub<"plan_run", {readonly run: DraftRun; readonly settings: Settings}>;

/** What every run of the planner cost, summed over the tries. */
export const Spent = Schema.Struct({
	costUsd: Schema.Finite,
	tokens: Schema.Finite,
	/** The conversation's size at its last turn. */
	context: Schema.Finite,
	turns: Schema.Finite,
	minutes: Schema.Finite,
});
export type Spent = typeof Spent.Type;

const nothing: Spent = {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0};

const add = (a: Spent, b: Spend): Spent => ({
	costUsd: a.costUsd + b.costUsd,
	tokens: a.tokens + b.tokens,
	context: b.context === 0 ? a.context : b.context,
	turns: a.turns + b.turns,
	minutes: a.minutes + b.minutes,
});

/** What a plan run leaves besides its outcome. */
export const PlanReport = Schema.Struct({
	/**
	 * The plan: the one that passed, or the last one when the tries ran out.
	 * As the planner wrote it, with no ids: the ledger gives them when it keeps
	 * the plan (../../asks/rules.ts). `null`: none came back.
	 */
	plan: Schema.NullOr(PlanDraft),
	/** What the Check still found, or why it stopped, in words. */
	problems: Schema.Array(Schema.String),
	tries: Schema.Finite,
	/** Facts were gathered and handed to the planner. */
	facts: Schema.Boolean,
	spend: Spent,
});
export type PlanReport = typeof PlanReport.Type;

/**
 * The refine combo over the planner and the Check. Each try's prompt is the
 * brief, then only the Check's problems: the conversation already holds the rest.
 */
export const refine = createRefineLoop({
	draft: planDraft,
	check: planProblems,
	prompt: promptFor,
	agent: null,
	folder: null,
});

/** `key`: the conversation's name, new for every start; the agent refuses a name a kept one has. */
const Held = Schema.Struct({ask: PlanAsk, settings: Settings, key: Schema.String});
type Held = typeof Held.Type;
const Read = Schema.Struct({...Held.fields, ticket: PlanTicket});
type Read = typeof Read.Type;

/** The plan machine's state, and the schema it is kept and read back through. */
export const PlanState = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("reading"),
		asked: keptCmd(readTicket, TicketIn),
	}),
	Schema.Struct({
		...Read.fields,
		phase: Schema.Literal("gathering"),
		asked: keptCmd(readFacts, FactsIn),
	}),
	Schema.Struct({
		...Read.fields,
		phase: Schema.Literal("drafting"),
		refining: refiningOf(Brief, PlanDraft),
		facts: Schema.Boolean,
		spend: Spent,
		/** Times a restart started the planner over. */
		restarts: Schema.Finite,
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("over"),
		outcome: PlanOutcome,
		report: PlanReport,
	}),
]);
export type PlanState = typeof PlanState.Type;

export type PlanMachineMsg =
	| {
			readonly type: "start";
			readonly ask: PlanAsk;
			readonly settings: Settings;
			readonly key: string;
	  }
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	| PlanMsg;

type Step = readonly [PlanState, readonly PlanCmd[]];
const stay = (s: PlanState): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, settings: s.settings, key: s.key});

const blank: PlanReport = {plan: null, problems: [], tries: 0, facts: false, spend: nothing};
const end = (s: Held, outcome: PlanOutcome, report: Partial<PlanReport> = {}): Step => [
	{...held(s), phase: "over", outcome, report: {...blank, ...report}},
	[],
];

/** How many times a restart may start the planner over. */
export const MAX_RESTARTS = 1;

const OVER_BUDGET = "error_max_budget_usd";

/** Start the planner on its first try, with what was gathered. */
const draft = (s: Read, facts: Facts | null, restarts = 0, spend = nothing): Step => {
	const key = restarts === 0 ? s.key : `${s.key}/again/${restarts}`;
	const brief: Brief = {ticket: s.ticket, facts: facts?.text ?? null, names: facts?.names ?? []};
	const refining = refine.start(key, brief, s.ask.tries);
	return [
		{
			...held(s),
			ticket: s.ticket,
			phase: "drafting",
			refining,
			facts: facts !== null,
			spend,
			restarts,
		},
		[],
	];
};

/** A planner Msg, folded into the refine combo, and what it ends in. */
function drafted(s: PlanState, m: Extract<PlanMsg, {type: "plan_finished" | "plan_failed"}>): Step {
	if (s.phase !== "drafting" || refine.runOf(s.refining)?.id !== m.id) return stay(s);
	const spend = add(s.spend, m.spend);
	const next = refine.update(s.refining, m);
	const base = {tries: next.tries, facts: s.facts, spend};
	switch (next.phase) {
		case "drafting":
			return [{...s, refining: next, spend}, []];
		case "done":
			return next.output.questions.length === 0
				? end(s, {kind: "done", part: false}, {...base, plan: next.output})
				: end(s, {kind: "ask", who: "owner", for: "questions"}, {...base, plan: next.output});
		case "out_of_tries":
			return end(
				s,
				{kind: "stuck", why: "unchecked"},
				{...base, plan: next.output, problems: next.problems},
			);
		case "failed":
			return next.error.startsWith(OVER_BUDGET)
				? end(
						s,
						{kind: "stuck", why: "over_budget"},
						{...base, problems: [`the planner reached its limit of ${s.settings.budget} dollars`]},
					)
				: end(s, {kind: "stuck", why: "draft_failed"}, {...base, problems: [next.error]});
	}
}

/** The planner's run: on only while a draft is asked for. Its folder is the commit the code is read at. */
export const runSub = listen("plan_run", (s: PlanState) => {
	if (s.phase !== "drafting") return null;
	const run = refine.runOf(s.refining);
	return run === null ? null : {run: {...run, folder: s.ticket.at}, settings: s.settings};
});

export const plan = defineMachine({
	types: {
		model: {} as PlanState,
		msg: {} as PlanMachineMsg,
		sub: {} as RunSub,
		ctx: undefined,
	},
	cmds: [readTicket, readFacts],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readTicket({ticket: m.ask.ticket});
			return [{ask: m.ask, settings: m.settings, key: m.key, phase: "reading", asked}, [asked]];
		},
		resume: (s): Step => {
			if (s.phase === "reading" || s.phase === "gathering") return [s, [s.asked]];
			if (s.phase !== "drafting") return stay(s);
			// The run that was on is gone with the process, and its conversation's name is taken.
			// Start over once, under a new name.
			if (s.restarts >= MAX_RESTARTS)
				return end(
					s,
					{kind: "stuck", why: "cut_off"},
					{
						spend: s.spend,
						facts: s.facts,
						problems: [`the planner was cut off ${s.restarts + 1} times`],
					},
				);
			const brief = s.refining.phase === "drafting" ? s.refining.brief : null;
			return draft(
				s,
				brief?.facts === null || brief === null ? null : {text: brief.facts, names: brief.names},
				s.restarts + 1,
				s.spend,
			);
		},

		plan_ticket_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const ticket = m.value;
			if (ticket.state === "closed") return end(s, {kind: "skip", why: "closed"});
			const asked = readFacts({ticket});
			return [{...held(s), ticket, phase: "gathering", asked}, [asked]];
		},
		plan_ticket_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),

		plan_facts_ok: (s, m): Step => (s.phase === "gathering" ? draft(s, m.value) : stay(s)),
		// No facts only means the planner reads the code itself.
		plan_facts_err: (s): Step => (s.phase === "gathering" ? draft(s, null) : stay(s)),

		plan_tool: (s): Step => stay(s),
		plan_finished: (s, m): Step => drafted(s, m),
		plan_failed: (s, m): Step => drafted(s, m),
	},
	subs: [runSub],
});
