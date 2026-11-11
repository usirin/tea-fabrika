// Outcome.ts: how one step of a flow answers, in the five verbs (docs/direction/outcome-names.md).
// Today's lead tooling (0064), read through its module: `Outcome.done("pushed")`.
//
//   done   the step did its job; the flow goes on to the next step
//   skip   nothing to do here; the flow goes on, with the reason on record
//   send   go to the named step of this flow, with why
//   ask    stop and park for the lead, with one question
//   stuck  stop; something broke, with why

import { Schema } from "effect";

export const Outcome = Schema.TaggedUnion({
  done: { reason: Schema.String },
  skip: { reason: Schema.String },
  send: { to: Schema.String, reason: Schema.String },
  ask: { reason: Schema.String },
  stuck: { reason: Schema.String },
});
export type Outcome = typeof Outcome.Type;

export const done = (reason: string): Outcome => Outcome.cases.done.make({ reason });
export const skip = (reason: string): Outcome => Outcome.cases.skip.make({ reason });
export const send = (to: string, reason: string): Outcome => Outcome.cases.send.make({ to, reason });
export const ask = (reason: string): Outcome => Outcome.cases.ask.make({ reason });
export const stuck = (reason: string): Outcome => Outcome.cases.stuck.make({ reason });

/**
 * What one agent turn spent: the same fields as the lead agents module's `Spent`, so a draft step
 * hands a turn's spend on as it is. Both token measures, and dollars where the maker says.
 */
export const Spent = Schema.Struct({
  input: Schema.Number,
  cached: Schema.Number,
  output: Schema.Number,
  counted: Schema.Literals(["turn", "requests", "last", "none"]),
  usd: Schema.NullOr(Schema.Number),
  requests: Schema.NullOr(Schema.Number),
  tools: Schema.Number,
});
export type Spent = typeof Spent.Type;

/**
 * What a step's runner hands back: its outcome, and what an agent turn spent, `null` for a step
 * that ran no agent. 0064 asks every flow to record dollars and tokens per step.
 */
export const Answer = Schema.Struct({ outcome: Outcome, spent: Schema.NullOr(Spent) });
export type Answer = typeof Answer.Type;

/** An answer from a step that ran no agent. */
export const answer = (outcome: Outcome): Answer => ({ outcome, spent: null });
