import {Effect, Schema} from "effect";
import type {Hash} from "../../tickets/ticket.ts";
import {LaneStep} from "./machine.ts";

// A step's input key (self-fix PR 5, P7): a hash of what the step read. The same inputs always give
// the same key, and a change to any one of them gives another. Each `done` fact keeps the key it ran
// on; nothing reads it to skip a step yet, but a key not written now can never be worked out later.
//
//   keyOf({step: "build", ticket: "sha256:…", plan: 1, base: "92740b74", exam: "5d38d582", ...})
//   // "sha256:b3f1e9…", for these inputs, every time
//
// STUB, written by the test writer so the tests compile: the builder owns this file.

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

/** The key of `inputs`. STUB: every input gives the same key, so the tests are red. */
export const keyOf = (_inputs: Inputs): Effect.Effect<Hash> =>
	Effect.succeed(`sha256:${"0".repeat(64)}`);
