import {Context, Effect, Layer, Ref, Schema} from "effect";
import {Plan} from "../stages/plan/plan.ts";
import {AnswerBody} from "./ask.ts";

// The smallest ledger the owner's asks need: an append-only list of facts,
// behind a service (docs/direction/ledger-behind-a-service.md). The core's
// state is a fold over it (./rules.ts), so nothing is kept twice: what waits
// on the owner is worked out from the facts every time.
//
//   planned        a plan was written (a new version of it, when it was there before)
//   reviewed       a review round of one task of a plan ended, with this many open
//   ruling_needed  sort sent a ticket to the owner to rule on
//   answered       the owner answered an ask, and the core took the answer
//
// Only answers the core took are kept. An answer that did not fit is refused
// before anything is written.

export const Fact = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("planned"),
		plan: Schema.String,
		tickets: Schema.Array(Schema.String),
		data: Plan,
		problems: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("reviewed"),
		plan: Schema.String,
		/** The task's place in the plan, from 1. */
		task: Schema.Int,
		open: Schema.Int,
	}),
	Schema.Struct({
		type: Schema.Literal("ruling_needed"),
		ticket: Schema.String,
		ask: Schema.String,
		options: Schema.Array(Schema.String),
		why: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("answered"), id: Schema.String, answer: AnswerBody}),
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
		/** Every fact, oldest first. */
		readonly entries: Effect.Effect<readonly Entry[]>;
	}
>()("Ledger") {}

/** A ledger in memory, starting from `entries`. Two layers made from one `memoryLedger` share it, as two starts on one disk would. */
export function memoryLedger(entries: readonly Entry[] = []) {
	const ref = Ref.makeUnsafe<readonly Entry[]>(entries);
	const layer = Layer.succeed(Ledger, {
		append: (fact) =>
			Ref.modify(ref, (all) => {
				const entry = {seq: all.length + 1, fact};
				return [entry, [...all, entry]] as const;
			}),
		entries: Ref.get(ref),
	});
	return {layer, read: () => Effect.runSync(Ref.get(ref))};
}
