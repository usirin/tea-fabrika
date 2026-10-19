import {Context, Effect, Layer, Ref} from "effect";
import {Ledger} from "../asks/ledger.ts";
import {bookOf, firstTaskOf, foldLedger, planFor} from "../asks/rules.ts";
import {type TaskId, type TicketId, taskId} from "../ids.ts";
import {
	apply,
	type Book,
	byReview,
	currentOf,
	EMPTY,
	historyOf,
	nextId,
	type Row,
	type Stated,
	type Verdict,
	withRound,
} from "./book.ts";

// Where a ticket's criteria and their verdicts are kept for the stages that
// read them: the record, as against the code host
// (docs/direction/ledger-behind-a-service.md). The review writes what it
// judged; ship reads it back and will not merge without a passing verdict for
// every criterion, at its current version, at the head (../stages/ship/ready.ts).
//
//   read(ticket)              the criteria that hold now, and every verdict
//   judged(ticket, judgement) the rows a review gave, each by id and version,
//                             and what it found that no criterion covers
//
// A review's round goes into the book whole (`withRound`): each row it gave
// is filed as a verdict under an id of its own, and each thing it found that
// no criterion covers becomes a criterion, under an id from the same counter
// as the ticket's, failed at that head. Such a criterion blocks the merge
// until a later round no longer finds it.
//
// Two Layers:
//
//   ledgerRecord   over the asks ledger: a ticket's criteria are the book of
//                  the plan written for it. Only the plan makes, rewords and
//                  removes the ticket's own; a review's round goes in as a
//                  `judged` fact.
//   memoryRecord   for a ticket no plan holds, kept in memory: it learns the
//                  ticket's criteria from what each review read, one step at
//                  a time and never by guess (see `followed`).
//
// Either way a row is kept only when the words the review read are the
// book's words for that version: a row on other words says nothing.

/** What the record holds for one ticket: its criteria now, and every verdict, oldest first. */
export interface Held {
	readonly criteria: readonly [Stated, ...Stated[]];
	readonly verdicts: readonly Verdict[];
}

/** What a review hands the record: one round at one commit. */
export interface Judgement {
	/** The ticket's criteria, as the review read them. */
	readonly criteria: readonly Stated[];
	readonly rows: readonly Row[];
	/** What it found that no criterion covers, each as what has to be true. */
	readonly found: readonly string[];
	readonly head: string;
	/** Where its proof is, in words a person can follow. */
	readonly proof: string;
}

type Unknown = {readonly _tag: "unknown"};

export class CriteriaRecord extends Context.Service<
	CriteriaRecord,
	{
		/** The ticket's criteria and verdicts. `null`: the record holds no criteria for it. */
		readonly read: (ticket: TicketId) => Effect.Effect<Held | null, Unknown>;
		/** Keep a review's round: each row that holds against the book's words, and what it found. */
		readonly judged: (ticket: TicketId, judgement: Judgement) => Effect.Effect<void, Unknown>;
	}
>()("CriteriaRecord") {}

/** The book's criteria now, and its verdicts. `null`: it holds none. Pure. */
export function heldOf(book: Book): Held | null {
	const [first, ...rest] = currentOf(book).map(({id, version, text}) => ({id, version, text}));
	return first === undefined ? null : {criteria: [first, ...rest], verdicts: book.verdicts};
}

/** The rows of a judgement whose criterion the review read in the book's own words for that version. Pure. */
export function kept(book: Book, judgement: Judgement): readonly Row[] {
	return judgement.rows.filter((row) => {
		const read = judgement.criteria.find(
			(c) => c.id === row.criterion && c.version === row.version,
		);
		const words = historyOf(book, row.criterion)?.wordings.find((w) => w.version === row.version);
		return read !== undefined && words !== undefined && words.text === read.text;
	});
}

/** A judgement, folded into a book: its kept rows, and what it found, under `task`. Pure. */
export const keep = (book: Book, judgement: Judgement, task: TaskId): Book =>
	withRound(book, {...judgement, rows: kept(book, judgement), task});

/** The one task a ticket no plan holds has: every criterion it learns goes under it. */
const ONLY = taskId("t1");

/**
 * A book that follows a ticket no plan holds, from the criteria a review read
 * on it. Each step is taken only when it is the book's own next one, so
 * nothing is guessed:
 *
 *   an id the book does not hold   added, if it is the book's next id at version 1
 *   an id it holds, one version on reworded, if the words changed
 *   an id the ticket no longer has retired, unless a review added it: the
 *                                  ticket never lists those
 *
 * Anything else (an id out of turn, a version that skips) is left as it was,
 * and the rows on it are not kept. Pure.
 */
export function followed(book: Book, criteria: readonly Stated[]): Book {
	const steps = criteria.reduce((b, c): Book => {
		const entry = b.live.find((e) => e.id === c.id);
		if (entry === undefined)
			return c.id === nextId(b) && c.version === 1
				? apply(b, {type: "added", task: ONLY, text: c.text, by: "plan"})
				: b;
		const last = entry.wordings[entry.wordings.length - 1];
		return last !== undefined && c.version === last.version + 1 && c.text !== last.text
			? apply(b, {type: "reworded", id: c.id, text: c.text, by: "owner"})
			: b;
	}, book);
	const gone = steps.live.filter((e) => !byReview(e) && !criteria.some((c) => c.id === e.id));
	return gone.reduce((b, e) => apply(b, {type: "removed", id: e.id}), steps);
}

/** A judgement, folded into the book of a ticket no plan holds: the book follows what the review read, then keeps the round. Pure. */
export const followedThenKept = (book: Book, judgement: Judgement): Book =>
	keep(followed(book, judgement.criteria), judgement, ONLY);

/** A record in memory, starting from `books` (by ticket). Two layers made from one share it. */
export function memoryRecord(books: ReadonlyMap<TicketId, Book> = new Map()) {
	const ref = Ref.makeUnsafe<ReadonlyMap<TicketId, Book>>(new Map(books));
	const layer = Layer.succeed(CriteriaRecord, {
		read: (ticket) => Ref.get(ref).pipe(Effect.map((all) => heldOf(all.get(ticket) ?? EMPTY))),
		judged: (ticket, judgement) =>
			Ref.update(ref, (all) =>
				new Map(all).set(ticket, followedThenKept(all.get(ticket) ?? EMPTY, judgement)),
			),
	});
	return {
		layer,
		book: (ticket: TicketId): Book | null => Effect.runSync(Ref.get(ref)).get(ticket) ?? null,
	};
}

/**
 * The record over the asks ledger. A ticket's criteria are its plan's book,
 * every task's: the ledger does not yet say which task a pull request builds,
 * so what a review finds goes under the plan's first task.
 */
export const ledgerRecord = Layer.effect(
	CriteriaRecord,
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const folded = Effect.map(ledger.entries, foldLedger);
		return {
			read: (ticket) =>
				Effect.map(folded, (state) => {
					const plan = planFor(state, ticket);
					const book = plan === null ? null : bookOf(state, plan);
					return book === null ? null : heldOf(book);
				}),
			judged: (ticket, judgement) =>
				Effect.gen(function* () {
					const state = yield* folded;
					const plan = planFor(state, ticket);
					const book = plan === null ? null : bookOf(state, plan);
					const task = plan === null ? null : firstTaskOf(state, plan);
					if (plan === null || book === null || task === null) return;
					const rows = kept(book, judgement);
					// A round with no row kept still judges what earlier rounds found.
					if (rows.length > 0 || judgement.found.length > 0 || book.live.some(byReview))
						yield* ledger.append({
							type: "judged",
							plan,
							task,
							head: judgement.head,
							proof: judgement.proof,
							rows,
							found: judgement.found,
						});
				}),
		};
	}),
);
