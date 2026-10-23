import {structuralHash} from "@demlik/tea";
import {noSpend, type Spend} from "@kampus/fabrika/agents/claude";
import {planProblems} from "../stages/plan/check.ts";
import {
	MAX_RESTARTS,
	type PlanCmd,
	type PlanState,
	plan,
	readFacts,
	readTicket,
	runSub,
} from "../stages/plan/machine.ts";
import type {PlanDraft as Plan} from "../stages/plan/plan.ts";
import type {Brief} from "../stages/plan/planner.ts";
import type {PlanTicket, Settings} from "../stages/plan/services.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The plan machine under every order of messages: its world and its laws.
//
// The world reads the ticket and the facts, answers each read in any order,
// and may restart. The planner is a Sub: while a draft is asked for, it may
// send a tool call, a plan (one that passes the Check, one that names code a
// user never meets, one with open questions, or one that did not fit the
// schema), or a failure. A late Msg from the first run may come at any time.

export type AnyPlanMsg = MsgOf<typeof plan>;
type Msg = AnyPlanMsg;
const planUpdate = stepOf<PlanState, Msg, PlanCmd>(plan);

const URL = "T";
const KEY = "k";
const TRIES = 2;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const TICKET: PlanTicket = {url: URL, number: 1, state: "open", title: "t", body: "b", at: "c"};
const SPENT: Spend = {...noSpend, costUsd: 1, turns: 1};

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

/** What the planner may hand back, by a short name. */
export const PLANS: Readonly<Record<string, Plan | null>> = {
	good,
	"names code": {
		...good,
		tasks: good.tasks.map((t) => ({
			...t,
			criteria: t.criteria.map((c) => ({...c, when: "startSpan gets 1"})),
		})),
	},
	"open questions": {
		...good,
		questions: [{ask: "A new export?", options: ["yes", "no"], lean: "no", why: "smaller"}],
	},
	"no fit": null,
};

const runIdOf = (s: PlanState): string | null => runSub.deps(s)?.run.id ?? null;
const FIRST_RUN = `${KEY}/1`;

export function planWorld(): World<PlanState, Msg, PlanCmd> {
	return {
		outside: (s) => {
			const current = runIdOf(s);
			// The run asked for now, and the first one, whose Msgs may come late.
			const ids = [...new Set([...(current === null ? [] : [current]), FIRST_RUN])];
			return [
				{type: "start", ask: {ticket: URL, tries: TRIES}, settings: SETTINGS, key: KEY},
				{type: "resume"},
				...ids.flatMap((id): Msg[] => [
					{type: "plan_tool", key: KEY, id, tool: "Read"},
					...Object.values(PLANS).map(
						(output): Msg => ({
							type: "plan_finished",
							key: KEY,
							id,
							output,
							session: "s",
							spend: SPENT,
						}),
					),
					{type: "plan_failed", key: KEY, id, error: "boom", spend: SPENT},
					{type: "plan_failed", key: KEY, id, error: "error_max_budget_usd", spend: SPENT},
				]),
			];
		},
		answers: (cmd): readonly Msg[] =>
			cmd.type === "plan_ticket"
				? [
						readTicket.ok(cmd, TICKET, 0),
						readTicket.ok(cmd, {...TICKET, state: "closed"}, 0),
						readTicket.err(cmd, {_tag: "unknown"}, 0),
					]
				: [readFacts.ok(cmd, {text: "f", names: []}, 0), readFacts.err(cmd, {_tag: "unknown"}, 0)],
		restart: (msg) => msg.type === "resume",
	};
}

const briefOf = (s: PlanState): Brief | null =>
	s.phase === "drafting" && s.refining.phase === "drafting" ? s.refining.brief : null;

export function planLaws<S extends PlanState>(): readonly Law<S, Msg, PlanCmd>[] {
	return [
		watched<S, Msg, PlanCmd, Brief | null>(
			"done only with a plan the Check passes and nothing left to ask; asks only with questions",
			null,
			(brief, {prev, next}) => {
				const now = briefOf(next) ?? brief;
				if (next.phase !== "over" || prev.phase === "over") return now;
				const {outcome, report} = next;
				if (outcome.kind !== "done" && outcome.kind !== "ask") return now;
				if (report.plan === null || now === null) return broke(`${outcome.kind} with no plan`);
				const problems = planProblems(report.plan, now);
				if (problems.length > 0) return broke(`${outcome.kind} with a plan the Check fails`);
				const asks = report.plan.questions.length > 0;
				return asks === (outcome.kind === "ask")
					? now
					: broke(`${outcome.kind} with ${report.plan.questions.length} open questions`);
			},
		),
		law<S, Msg, PlanCmd>("a planner Msg counts only for the run asked for", ({prev, msg, next}) =>
			(msg.type === "plan_finished" || msg.type === "plan_failed") &&
			msg.id !== runIdOf(prev) &&
			structuralHash(prev) !== structuralHash(next)
				? `${msg.type} from run ${msg.id} was taken while ${runIdOf(prev) ?? "no run"} was asked for`
				: null,
		),
		law<S, Msg, PlanCmd>("tries never pass the limit asked", ({next}) => {
			const tries =
				next.phase === "drafting"
					? next.refining.tries
					: next.phase === "over"
						? next.report.tries
						: 0;
			return tries > TRIES ? `try ${tries} of ${TRIES}` : null;
		}),
		law<S, Msg, PlanCmd>("the planner is started over at most once a restart allows", ({next}) =>
			next.phase === "drafting" && next.restarts > MAX_RESTARTS
				? `started over ${next.restarts} times`
				: null,
		),
		watched<S, Msg, PlanCmd, number>(
			"every dollar the planner spent is in the report",
			0,
			(spent, {prev, msg, next}) => {
				const took =
					(msg.type === "plan_finished" || msg.type === "plan_failed") &&
					structuralHash(prev) !== structuralHash(next);
				const now = took ? spent + msg.spend.costUsd : spent;
				if (next.phase !== "over" || prev.phase === "over") return now;
				return next.report.spend.costUsd === now
					? now
					: broke(`${now} spent, and the report says ${next.report.spend.costUsd}`);
			},
		),
		law<S, Msg, PlanCmd>("an ended run sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the run ended`
				: null,
		),
	];
}

export const planInit: PlanState = {phase: "idle"};
export const planStep: Update<PlanState, Msg, PlanCmd> = planUpdate;

const nameOf = (output: Plan | null) =>
	Object.entries(PLANS).find(([, p]) => structuralHash(p) === structuralHash(output))?.[0] ?? "?";

export function showPlanMsg(m: Msg): string {
	switch (m.type) {
		case "plan_ticket_ok":
			return `ticket read: ${m.value.state}`;
		case "plan_finished":
			return `run ${m.id}: plan "${nameOf(m.output)}"`;
		case "plan_failed":
			return `run ${m.id} failed: ${m.error}`;
		case "plan_tool":
			return `run ${m.id}: tool`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** A plan with open questions is taken as done. */
export const doneWithQuestions: Update<PlanState, Msg, PlanCmd> = (s, m) => {
	const [next, cmds] = planUpdate(s, m);
	return next.phase === "over" && next.outcome.kind === "ask"
		? [{...next, outcome: {kind: "done", part: false}}, cmds]
		: [next, cmds];
};

/** A planner Msg is taken whatever run it is from. */
export const takesAnyRun: Update<PlanState, Msg, PlanCmd> = (s, m) => {
	if ((m.type === "plan_finished" || m.type === "plan_failed") && s.phase === "drafting") {
		const id = runIdOf(s);
		return id === null ? planUpdate(s, m) : planUpdate(s, {...m, id});
	}
	return planUpdate(s, m);
};

/** A failed run's spend is left out of the report. */
export const dropsAFailedSpend: Update<PlanState, Msg, PlanCmd> = (s, m) =>
	m.type === "plan_failed" ? planUpdate(s, {...m, spend: noSpend}) : planUpdate(s, m);
