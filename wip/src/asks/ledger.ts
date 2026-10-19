import {Context, Effect, Layer, Ref, Schema} from "effect";
import {Row} from "../criteria/book.ts";
import {LaneId, PlanId, TaskId, TicketId} from "../ids.ts";
import {Revision} from "../stages/plan/plan.ts";
import {Answer, Attachment} from "./ask.ts";

// The smallest ledger the owner's asks need: an append-only list of facts,
// behind a service (docs/direction/ledger-behind-a-service.md). The core's
// state is a fold over it (./rules.ts), so nothing is kept twice: what waits
// on the owner is worked out from the facts every time.
//
//   planned        a plan was written (a new version of it, when it was there before).
//                  Its tasks and criteria get their ids in the fold, from the plan's criteria book
//   reviewed       a review round of one task of a plan ended, with this many open
//   judged         a review's rows on criteria of a plan, each by id and version, at a
//                  commit, and what it found that no criterion covers
//   ruling_needed  sort sent a ticket to the owner to rule on
//   answered       the owner answered an ask, and the core took the answer
//   built          a build of one task finished, with the files it changed
//   cleared        a listener that holds builds let this one go
//   check_raised   a listener that holds builds asked the owner to look at it
//   shipped        the core sent the build to ship
//   lane           a lane began on a ticket; its id is `L` and the fact's place
//   claimed        a lane took a ticket, by one compare-and-set (./claims.ts)
//   released       a lane let its ticket go
//
// Only answers the core took are kept. An answer that did not fit is refused
// before anything is written.

export const Fact = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("planned"),
		plan: PlanId,
		tickets: Schema.Array(TicketId),
		/** As written: a task or criterion with no id, or one the book does not hold, gets a new id. */
		data: Revision,
		problems: Schema.Array(Schema.String),
	}),
	/** A review round at one commit: its rows, and what it found that no criterion covers. The fold files both in the plan's book (`withRound`). */
	Schema.Struct({
		type: Schema.Literal("judged"),
		plan: PlanId,
		/** The task the round reviewed: what it found goes under it. */
		task: TaskId,
		head: Schema.String,
		proof: Schema.String,
		rows: Schema.Array(Row),
		found: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("reviewed"),
		plan: PlanId,
		task: TaskId,
		open: Schema.Int,
	}),
	Schema.Struct({
		type: Schema.Literal("ruling_needed"),
		ticket: TicketId,
		ask: Schema.String,
		options: Schema.Array(Schema.String),
		why: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("answered"), ...Answer.fields}),
	Schema.Struct({
		type: Schema.Literal("built"),
		plan: PlanId,
		task: TaskId,
		/** The files the build changed. */
		changes: Schema.Array(Schema.String),
		/** How many listeners this build waits on before it ships: each clears it or raises a check. */
		holds: Schema.Int,
	}),
	/** A listener that holds builds says this one needs nothing from it. */
	Schema.Struct({
		type: Schema.Literal("cleared"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
		by: Schema.String,
	}),
	/** A listener that holds builds asks the owner to look at this one. */
	Schema.Struct({
		type: Schema.Literal("check_raised"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
		by: Schema.String,
		question: Schema.String,
		attachments: Schema.Array(Attachment),
	}),
	/** The core sent a build to ship. */
	Schema.Struct({
		type: Schema.Literal("shipped"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
	}),
	/** A lane began on a ticket. Its id is made from this fact's place, so two processes never share one. */
	Schema.Struct({type: Schema.Literal("lane"), ticket: TicketId}),
	/** A lane took a ticket. Only the first claim since the ticket was last let go holds it (./claims.ts). */
	Schema.Struct({type: Schema.Literal("claimed"), ticket: TicketId, lane: LaneId}),
	/** A lane let its ticket go. One from a lane that does not hold it changes nothing. */
	Schema.Struct({type: Schema.Literal("released"), ticket: TicketId, lane: LaneId}),
]);
export type Fact = typeof Fact.Type;

/** A fact with its place in the ledger, from 1. */
export interface Entry {
	readonly seq: number;
	readonly fact: Fact;
}

export class Ledger extends Context.Service<
	Ledger,
	{
		/** Add a fact at the end, and answer it with its place. */
		readonly append: (fact: Fact) => Effect.Effect<Entry>;
		/**
		 * Add a fact at the end only if the ledger still ends at `after` (the
		 * place of its last fact, 0 when empty): one compare-and-set. `null`:
		 * another fact came in first, and nothing was added; read again.
		 */
		readonly appendAfter: (after: number, fact: Fact) => Effect.Effect<Entry | null>;
		/** Every fact, oldest first. */
		readonly entries: Effect.Effect<readonly Entry[]>;
	}
>()("Ledger") {}

/** A ledger in memory, starting from `entries`. Two layers made from one `memoryLedger` share it, as two starts on one disk would. */
export function memoryLedger(entries: readonly Entry[] = []) {
	const ref = Ref.makeUnsafe<readonly Entry[]>(entries);
	const add = (all: readonly Entry[], fact: Fact) => {
		const entry = {seq: all.length + 1, fact};
		return [entry, [...all, entry]] as const;
	};
	const layer = Layer.succeed(Ledger, {
		append: (fact) => Ref.modify(ref, (all) => add(all, fact)),
		appendAfter: (after, fact) =>
			Ref.modify(ref, (all) => ((all.at(-1)?.seq ?? 0) === after ? add(all, fact) : [null, all])),
		entries: Ref.get(ref),
	});
	return {layer, read: () => Effect.runSync(Ref.get(ref))};
}
