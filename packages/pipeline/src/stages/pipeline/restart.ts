import {Effect, Schema} from "effect";
import {Entry} from "../../tickets/ticket.ts";
import type {Tickets} from "../../tickets/tickets.ts";
import {HeldDraft} from "../plan/plan.ts";
import {Carry, Held, LaneStep, Resume} from "./machine.ts";
import type {LaneOutcome} from "./outcome.ts";
import type {LaneWork} from "./work.ts";

// What may restart, and the carry from facts (self-fix PR 5, P4 and P6). Today's version.
//
//   A stop saves its `Held` and where it goes on. The same line typed again goes on there.
//   FINAL: the closed list of stops that never restart. Every other one does, a new one included.
//   fold(seen): the second copy of a stop's `Held`, rebuilt from the ticket's facts and the commits
//   code made. A field no fact proves is named in `missing`, and the lane goes on at the step that
//   writes that field, and no earlier.
//
// STUB, written by the test writer so the tests compile: the builder owns this file.

type StuckWhy = Extract<LaneOutcome, {readonly kind: "stuck"}>["why"];

/**
 * The stops that are a person's call, never the lane's: a restart says why and runs nothing. STUB:
 * empty, a wrong value, so the tests are red.
 */
export const FINAL: ReadonlySet<StuckWhy> = new Set<StuckWhy>([]);

/** The fields of a carry the fold proves from facts, each with the step that writes it. */
export const Field = Schema.Literals([
	"plan",
	"version",
	"rules",
	"decided",
	"base",
	"exam",
	"head",
	"count",
	"trail",
]);
export type Field = typeof Field.Type;

/** A commit code made on the lane's branch: which step it was made for, and the files it touched. */
export const Made = Schema.Struct({
	sha: Schema.String,
	by: Schema.Union([LaneStep, Schema.Literal("format")]),
	files: Schema.Array(Schema.String),
});
export type Made = typeof Made.Type;

/** What the fold reads. */
export const Seen = Schema.Struct({
	/** The ticket's facts, oldest first. */
	timeline: Schema.Array(Entry),
	/** The plan the ledger keeps for this ticket, newest version, as the lane held it. `null`: none. */
	plan: Schema.NullOr(HeldDraft),
	/** Where the lane's working copy left main. `null`: there is no working copy. */
	base: Schema.NullOr(Schema.String),
	/** The commits code made on the lane's branch, oldest first. */
	commits: Schema.Array(Made),
});
export type Seen = typeof Seen.Type;

/** A stop's `Held` as the facts prove it, what they could not prove, and where the lane goes on. */
export const Folded = Schema.Struct({
	held: Schema.Struct({
		count: Held.fields.count,
		round: Held.fields.round,
		carry: Carry,
		trail: Held.fields.trail,
	}),
	missing: Schema.Array(Field),
	at: Resume,
});
export type Folded = typeof Folded.Type;

/** The fold of a lane's facts. STUB: it throws, so the tests are red. */
export const fold = (_seen: Seen): Folded => {
	throw new Error("fold: not built yet (self-fix PR 5)");
};

/** What the fold of ticket `number`'s lane reads, read now. STUB: it dies, so the tests are red. */
export const seenOf = (_number: number): Effect.Effect<Seen, never, Tickets | LaneWork> =>
	Effect.die(new Error("seenOf: not built yet (self-fix PR 5)"));
