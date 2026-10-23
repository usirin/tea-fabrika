// Plan on tea-host (experiment 104): the plan machine, unchanged, under `plan:<n>`. Its planner runs
// in the child `plan:<n>:agent`, one ask per draft, under an id made of the draft's conversation and
// prompt. A draft asked again in the same conversation is answered from the ledger. A restart starts
// the refine loop over under a new conversation (the machine's own rule), so its drafts are new asks:
// an answer from the old conversation would leave the next try continuing one that does not exist.
// Plan writes nothing outside the ledger: its outcome row holds the plan.
//
// Read again (experiment 105): when the ledger holds a plan for the ticket already, the planner
// reads the plan as it stands and every ticket sort folded in since (`foldedPlanHost`), and writes
// the whole plan again. The outcome row holds the new draft, for whoever plans the next version.

import {Ledger, type Self} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {Effect, Exit, Schema, Stream} from "effect";
import {readFacts} from "../asks/ledger.ts";
import {foldLedger, foldsOf, latestOf} from "../asks/rules.ts";
import {planOf, readTicketId} from "../ids.ts";
import {nameOf} from "../stages/outcome.ts";
import {planInterpret, planSubscribe} from "../stages/plan/handlers.ts";
import {type PlanMachineMsg, type PlanState, plan} from "../stages/plan/machine.ts";
import {planMarkdown} from "../stages/plan/render.ts";
import {
	type PlanFacts,
	PlanHost,
	type PlanMsg,
	Planner,
	Settings,
} from "../stages/plan/services.ts";
import {issueUrl} from "../stages/sort/writes.ts";
import {type AgentAsk, agentOf, askAgent, asWritten, digest, type Turn} from "./agent.ts";
import {jsonJournal, type Stage} from "./stage.ts";

export const PlanJob = Schema.Struct({
	ticket: Schema.String,
	tries: Schema.Finite,
	settings: Settings,
	usd: Schema.Finite,
});
export type PlanJob = typeof PlanJob.Type;

const Run = Schema.Struct({
	key: Schema.String,
	id: Schema.String,
	prompt: Schema.String,
	session: Schema.Struct({id: Schema.String, continues: Schema.Boolean}),
	agent: Schema.NullOr(Schema.String),
	folder: Schema.NullOr(Schema.String),
});
const PlanAskBody = Schema.Struct({run: Run, settings: Settings});
const readAsk = Schema.decodeUnknownExit(PlanAskBody);

/** A planner Msg moved onto the run that asked now: a draft answered for an earlier run is this one's. */
const onRun =
	(run: DraftRun) =>
	(m: PlanMsg): PlanMsg => ({...m, key: run.key, id: run.id});

/** The stage's `Planner`: one ask per draft to its child, the answer replayed onto the current run. */
export const childPlanner = (child: string) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Self | Ledger>();
		return Planner.of({
			run: (run, settings) =>
				Stream.unwrap(
					askAgent(
						child,
						`plan/${run.session.id}/${digest(run.prompt)}/${run.session.continues ? "on" : "new"}`,
						{run, settings},
						asWritten<readonly PlanMsg[]>(),
					).pipe(
						Effect.map((asked) =>
							asked.how === "answered"
								? Stream.fromIterable<PlanMsg>(asked.answer).pipe(Stream.map(onRun(run)))
								: Stream.succeed<PlanMsg>({
										type: "plan_failed",
										key: run.key,
										id: run.id,
										error: "error_max_budget_usd: the agent child reached its limit",
										spend: {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0},
									}),
						),
						Effect.provideContext(context),
					),
				),
		});
	});

/**
 * The plan's ticket as a plan read again sees it: when the ledger holds a plan for the ticket, its
 * body ends with the plan as it stands and every ticket sort folded in since that version, each
 * read from the code host. The planner writes the whole plan again; code keeps the ids of what
 * stayed (../stages/plan/ids.ts, `keptFrom`). Read fresh on every read, so a try after a restart
 * sees the folds there are then.
 */
export const foldedPlanHost = (host: PlanHost["Service"], ledger: Ledger["Service"]) =>
	PlanHost.of({
		ticket: (url) =>
			Effect.gen(function* () {
				const ticket = yield* host.ticket(url);
				const id = readTicketId(url);
				if (id === null) return ticket;
				const entries = yield* readFacts.pipe(
					Effect.provideService(Ledger, ledger),
					Effect.mapError(() => ({_tag: "unknown" as const})),
				);
				const state = foldLedger(entries);
				const latest = latestOf(state, planOf(id));
				if (latest === null) return ticket;
				const folds = yield* Effect.forEach(
					foldsOf(state, planOf(id)),
					(t) => host.ticket(issueUrl(url, Number(t.slice(t.indexOf("#") + 1)))),
					{concurrency: 1},
				);
				const body = [
					ticket.body.trim(),
					"",
					`# The plan as it stands (version ${latest.version})`,
					"",
					"Plan it again with the tickets below folded in. Keep each task's title, and the",
					"words of every criterion that still holds, as they are: what keeps its words keeps",
					"its place in the plan and the verdicts it has.",
					"",
					planMarkdown(latest.data, `#${ticket.number}`),
					...folds.flatMap((f) => [
						"",
						`# Folded in: #${f.number} ${f.title.trim()}`,
						"",
						f.body.trim(),
					]),
				].join("\n");
				return {...ticket, body};
			}),
	});

/** The child's turn: the real `Planner` (live or scripted) on one draft, its stream kept whole. */
export const planTurn =
	(agent: Turn["agent"]) =>
	(ask: AgentAsk): Effect.Effect<Turn, never, Planner> =>
		Effect.gen(function* () {
			const read = readAsk(ask.brief);
			if (Exit.isFailure(read))
				return yield* Effect.die(`a plan ask that does not read: ${ask.id}`);
			// Tool notes, then one end: a live run's stream stays open after it, so it is read up to
			// the end and no further (as the builder's is).
			const msgs = Array.from(
				yield* (yield* Planner).run(read.value.run, read.value.settings).pipe(
					Stream.takeUntil((m) => m.type !== "plan_tool"),
					Stream.runCollect,
				),
			);
			const usd = msgs.reduce((n, m) => n + (m.type === "plan_tool" ? 0 : m.spend.costUsd), 0);
			const tokens = msgs.reduce((n, m) => n + (m.type === "plan_tool" ? 0 : m.spend.tokens), 0);
			return {answer: msgs, cost: {usd, tokens}, agent};
		});

export const hostedPlan: Stage<
	PlanState,
	PlanMachineMsg,
	PlanJob,
	PlanHost | PlanFacts | Self | Ledger
> = {
	kind: "plan",
	job: PlanJob,
	boot: (self) =>
		Effect.gen(function* () {
			const planner = yield* childPlanner(agentOf(self.name));
			return yield* self
				.run(
					plan,
					{schema: jsonJournal<PlanState>(), cursor: () => 0},
					{
						ctx: undefined,
						interpret: planInterpret,
						subscribe: planSubscribe,
						terminal: (s: PlanState) => s.phase === "over",
					},
				)
				.pipe(Effect.provideService(Planner, planner));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	// The conversation's name is the stage's: the same on every host.
	start: (job, name) => ({
		type: "start",
		ask: {ticket: job.ticket, tries: job.tries},
		settings: job.settings,
		key: name,
	}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {
						name: nameOf(end.outcome),
						outcome: end.outcome,
						tries: end.report.tries,
						tasks: end.report.plan?.tasks.map((t) => t.title) ?? null,
						questions: end.report.plan?.questions.length ?? null,
						draft: end.report.plan ?? null,
					},
		),
	agent: (job) => ({usd: job.usd}),
};
