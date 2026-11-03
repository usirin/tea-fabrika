import {defineProgram, flag, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import {Clock, Effect, Random, Schema} from "effect";
import {sessionOf} from "../../combos.ts";
import {TicketUrl} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import {refOf} from "../traced.ts";
import {planInterpret, planSubscribe} from "./handlers.ts";
import {type PlanAsk, PlanReport, PlanState, plan} from "./machine.ts";
import {PLAN_NAMES, PlanOutcome} from "./outcome.ts";
import {EFFORTS, type Settings} from "./services.ts";

// The plan program: the thing you start to plan tickets. It is started once,
// with its settings as flags, and told tickets for as long as it runs. Each
// gets a fresh run of the plan machine (./machine.ts), one at a time.
//
// It only reads. Its output `planned` is each plan, as data, with the
// outcome; a markdown view is made from it by whoever shows it (./render.ts).
//
// It asks for `PlanHost`, `PlanFacts` and `Planner` through Effect's context.
// Whoever starts it provides them: GitHub, code facts and the Agent SDK live,
// the replay set for experiment 86, fakes and a scripted planner for a test.

/** How one plan ended: its outcome, how that is spelled, and the report with the plan. */
export const Planned = Schema.Struct({
	ticket: Schema.String,
	outcome: PlanOutcome,
	name: Schema.Literals(PLAN_NAMES),
	...PlanReport.fields,
});
export type Planned = typeof Planned.Type;

const status = (s: PlanState): string => {
	if (s.phase === "idle") return "not started";
	const at = refOf(s.ask.ticket) ?? s.ask.ticket;
	switch (s.phase) {
		case "reading":
			return `${at}: reading the ticket`;
		case "gathering":
			return `${at}: gathering code facts`;
		case "drafting":
			return `${at}: planner at work, draft ${s.refining.tries}`;
		case "over":
			return `${at}: ${nameOf(s.outcome)}`;
	}
};

/** The plan machine as a kind. A run found part way resumes; one kept before it began starts from the caller's Msg. */
export const planKind = kind({
	machine: plan,
	state: PlanState,
	parent: "main",
	options: () => ({
		ctx: undefined,
		interpret: planInterpret,
		subscribe: planSubscribe,
		terminal: (s: PlanState) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id}) => ({
		name: refOf(id.replace(/^plan\//, "")) ?? id,
		service: "plan",
		steps: {plan_ticket: "read ticket", plan_facts: "gather facts", plan_run: "planner"},
	}),
	status,
});

/** A new name for the planner's conversation, new for each start: the agent refuses one a kept conversation has. */
const keyed = (ticket: string) =>
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis;
		const salt = yield* Random.nextIntBetween(0, 0xffffffff);
		return `plan ${sessionOf(`${ticket} ${now} ${salt}`)}`;
	});

/** One plan machine run to its end, under `id`. */
export const planToTheEnd = (
	id: string,
	ask: PlanAsk,
	settings: Settings,
	plans: RefsOf<typeof planKind>,
) =>
	Effect.gen(function* () {
		const key = yield* keyed(ask.ticket);
		const runtime = yield* plans
			.get(id)
			.start({type: "start", ask, settings, key}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

const FLAGS = {
	model: flag(Schema.String, "The model the planner runs on."),
	effort: flag(Schema.Literals(EFFORTS), "How hard the planner thinks."),
	budget: flag(
		Schema.Finite.check(Schema.isGreaterThan(0)),
		"The dollars one planner run may cost before it is stopped.",
	),
	tries: flag(
		Schema.Finite.check(Schema.isGreaterThan(0)),
		"The most drafts one plan may take: the first, and each one the Check sent back for.",
	),
};

export const planProgram = defineProgram({
	name: "plan",
	description:
		"Plans tickets, one after another, as it is told them: one agent reads the ticket and the code and writes a plan as data, outcomes not recipes, and code checks it and sends it back until it passes. It only reads, and posts nothing.",
	flags: FLAGS,
	inputs: {
		ticket: input(TicketUrl, "A ticket to plan, as its url on GitHub."),
	},
	outputs: {
		planned: output(
			Planned,
			"Once per ticket: the outcome, the plan as data, what the Check still found, and what the planner cost.",
		),
	},
	machines: {plan: planKind},
	main: ({flags, serve, send, machines}) =>
		serve({
			ticket: (ticket) =>
				Effect.gen(function* () {
					const ask: PlanAsk = {ticket, tries: flags.tries};
					const settings = {model: flags.model, effort: flags.effort, budget: flags.budget};
					const id = `plan/${ticket}`;
					const end = yield* planToTheEnd(id, ask, settings, machines.plan);
					yield* send("planned", {
						ticket,
						outcome: end.outcome,
						name: nameOf(end.outcome),
						...end.report,
					});
					yield* machines.plan.get(id).clear;
				}),
		}),
});
