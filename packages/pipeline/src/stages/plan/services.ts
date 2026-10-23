import type {DraftMsg, DraftRun} from "@kampus/fabrika/agents/claude";
import {Context, Effect, Layer, Schema, type Stream} from "effect";
import {ask, type Gh} from "../../code-host-github.ts";
import {ticketOf} from "../build/ticket.ts";
import type {PlanDraft} from "./plan.ts";

// What the plan stage reads, and the one agent it runs, each behind a service
// so a host picks the implementation:
//
//   PlanHost    reads the ticket: GitHub (below), or the replay set as filed
//               (experiment 86's script)
//   PlanFacts   what the code says about the names and paths the ticket
//               mentions. The first-generation triage's facts are one
//               implementation (legacy/src/code-facts.ts, wired in
//               experiment 86's script); `noFacts` is another
//   Planner     the planner's run (./planner.ts)

type Failed = {readonly _tag: "unknown"};

/** A ticket as the planner reads it. `at`: the commit to read the code at; `null`, the clone's own. */
export const PlanTicket = Schema.Struct({
	url: Schema.String,
	number: Schema.Finite,
	state: Schema.Literals(["open", "closed"]),
	title: Schema.String,
	body: Schema.String,
	at: Schema.NullOr(Schema.String),
});
export type PlanTicket = typeof PlanTicket.Type;

/**
 * What code found. `text`: about the names and paths the ticket mentions, as
 * the planner reads it. `names`: the names a user of the published packages
 * meets (./names.ts), which a criterion may name.
 */
export const Facts = Schema.Struct({text: Schema.String, names: Schema.Array(Schema.String)});
export type Facts = typeof Facts.Type;

/** How one planner run is to spend: the model, its effort, and the most it may cost. */
export const EFFORTS = ["low", "medium", "high"] as const;
export const Settings = Schema.Struct({
	model: Schema.String,
	effort: Schema.Literals(EFFORTS),
	budget: Schema.Finite,
});
export type Settings = typeof Settings.Type;

export type PlanMsg = DraftMsg<"plan", PlanDraft>;

export class PlanHost extends Context.Service<
	PlanHost,
	{readonly ticket: (url: string) => Effect.Effect<PlanTicket, Failed>}
>()("PlanHost") {}

export class PlanFacts extends Context.Service<
	PlanFacts,
	{readonly gather: (ticket: PlanTicket) => Effect.Effect<Facts, Failed>}
>()("PlanFacts") {}

/**
 * The planner, as a service: one run in, its stream of Msgs out, ending with
 * one `plan_finished` or `plan_failed`. A continued run picks up the same
 * conversation, in the same folder. A test stands a scripted one in.
 */
export class Planner extends Context.Service<
	Planner,
	{readonly run: (run: DraftRun, settings: Settings) => Stream.Stream<PlanMsg>}
>()("Planner") {}

/** No facts: the planner reads the code itself. */
export const noFacts = Layer.succeed(PlanFacts, {
	gather: () => Effect.fail({_tag: "unknown" as const}),
});

// ---------------------------------------------------------------- the GitHub read

const TICKET = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { state title body }
  }
}`;

const Answer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issue: Schema.Struct({
				state: Schema.Literals(["OPEN", "CLOSED"]),
				title: Schema.String,
				body: Schema.String,
			}),
		}),
	}),
});

/** The ticket on GitHub, read only. The code is read at the clone's own commit. */
export const githubPlanHost = (gh: Gh) =>
	Layer.succeed(PlanHost, {
		ticket: (url) =>
			Effect.gen(function* () {
				const at = ticketOf(url);
				if (at === null) return yield* Effect.fail({_tag: "unknown" as const});
				const {issue} = (yield* ask(gh, Answer, TICKET, {
					owner: at.owner,
					name: at.name,
					number: at.number,
				})).data.repository;
				return {
					url,
					number: at.number,
					state: issue.state === "OPEN" ? "open" : "closed",
					title: issue.title,
					body: issue.body,
					at: null,
				} satisfies PlanTicket;
			}),
	});
