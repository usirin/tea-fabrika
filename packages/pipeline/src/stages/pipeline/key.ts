import type { Effect } from "effect";
import { Schema } from "effect";
import { sha256 } from "../../tickets/approval.ts";
import type { Hash } from "../../tickets/ticket.ts";
import { LaneStep } from "./machine.ts";

// A step's input key (self-fix PR 5, P7): a hash of what the step read. The same inputs always give
// the same key, and a change to any one of them gives another. Each `ended` fact keeps the key it ran
// on and the inputs it was made of; nothing reads them to skip a step yet, but a key not written now
// can never be worked out later, and a key alone never says which input changed.
//
//   keyOf({step: "build", ticket: "sha256:…", plan: 1, base: "92740b74", exam: "5d38d582", ...})
//   // "sha256:b3f1e9…", for these inputs, every time
//
// The hash is of one JSON array, the fields in `Inputs`' own order, so a null and a text that reads
// "null" differ, and a new field joins the key by being a field.

/** What a step read, by name. `null`: the step read no such thing. */
export const Inputs = Schema.Struct({
  /** The step that ran. */
  step: LaneStep,
  /** The ticket's title and body, hashed as an approval hashes them. */
  ticket: Schema.String,
  /** The plan's version. */
  plan: Schema.NullOr(Schema.Finite),
  /** The commit the lane stood on. */
  base: Schema.NullOr(Schema.String),
  /** The test writer's commit. */
  exam: Schema.NullOr(Schema.String),
  /** The commit the step ran at. */
  head: Schema.NullOr(Schema.String),
  /** The brief's hash. */
  brief: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  /** The repository's settings, hashed. */
  settings: Schema.NullOr(Schema.String),
});
export type Inputs = typeof Inputs.Type;

const FIELDS = Object.keys(Inputs.fields).filter((name): name is keyof Inputs => name in Inputs.fields);

/** The key of `inputs`: SHA-256 of their values, in the fields' order. */
export const keyOf = (inputs: Inputs): Effect.Effect<Hash> =>
  sha256(JSON.stringify(FIELDS.map((field) => inputs[field])));
