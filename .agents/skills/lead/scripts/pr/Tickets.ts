// Tickets: what the landing path asks the app's own tracker once a pull request has merged (0015):
// which tickets are open, one comment, one close. This file is the contract only (0095):
// `TicketsCli.layer` posts through today's app's `post` command as agent:lead, `TicketsTest.layer`
// keeps the tickets in memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** The tracker could not be asked, or refused the post. The reason never holds a local path. */
export class TicketsError extends Schema.TaggedError<TicketsError>()("TicketsError", { reason: Schema.String }) {}

export class Tickets extends Context.Service<
  Tickets,
  {
    /** The numbers of the tickets that are open now. */
    readonly open: Effect.Effect<ReadonlyArray<number>, TicketsError>;
    /** Posts `body` as a comment on ticket `number`. */
    readonly comment: (number: number, body: string) => Effect.Effect<void, TicketsError>;
    /** Closes ticket `number`. */
    readonly close: (number: number) => Effect.Effect<void, TicketsError>;
  }
>()("lead/pr/Tickets") {}
