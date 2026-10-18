import {Context, type Effect, Schema} from "effect";
import {Criterion} from "../review/pack.ts";
import {Ran, Settings} from "../review/reviewer.ts";
import {Item} from "./ticket.ts";

// What the builder is handed and what it hands back, and the service it is
// reached through. The live builder is ./builder.ts; a test stands a scripted
// one in (./scripted.ts).

/** What one builder run is handed: the ticket, the round, what the last review left open, and where to work. */
export const BuildBrief = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	title: Schema.String,
	body: Schema.String,
	criteria: Schema.NonEmptyArray(Criterion),
	/** 1 for the first round. */
	round: Schema.Finite,
	/** What the last review left open. Empty on a first round. */
	open: Schema.Array(Item),
	/** The working copy, on the ticket's branch. */
	tree: Schema.String,
	branch: Schema.String,
	/**
	 * The round's conversation with the builder, a UUID named when the build
	 * started. A builder started again in the same round (after a restart)
	 * carries this conversation on, where one was kept, instead of starting
	 * over.
	 */
	session: Schema.String,
});
export type BuildBrief = typeof BuildBrief.Type;

/** The builder's form: filled once, at the end of its run. Code commits, pushes and opens the pull request from it. */
export const Built = Schema.Struct({
	/** What the change does, in a few sentences: the pull request's text. */
	summary: Schema.String,
	/** Each place the change does something other than the ticket asks, and why. Empty: none. */
	deviations: Schema.Array(Schema.String),
	/** Each command it ran to check its work, and whether it passed. */
	ran: Schema.Array(Schema.Struct({command: Schema.String, passed: Schema.Boolean})),
	/** What it could not do, and why. Empty: nothing. */
	left: Schema.Array(Schema.String),
});
export type Built = typeof Built.Type;

/** How one builder run ended. Never a throw. */
export type BuildDrafted =
	| ({readonly answer: "built"; readonly built: Built} & Ran)
	| ({readonly answer: "misfit"} & Ran)
	| ({readonly answer: "over_budget"} & Ran)
	| ({readonly answer: "broke"; readonly error: string} & Ran);

/** The builder, as a service: one brief in, how its run ended out. */
export class Builder extends Context.Service<
	Builder,
	{readonly build: (brief: BuildBrief, settings: Settings) => Effect.Effect<BuildDrafted>}
>()("BuildStageBuilder") {}

export {Ran, Settings};
