import {Context, Effect, Layer, Ref} from "effect";
import {Ledger} from "../asks/ledger.ts";
import {bookOf, type Folded, foldLedger} from "../asks/rules.ts";
import {
	apply,
	type Book,
	type CriteriaMsg,
	currentOf,
	EMPTY,
	historyOf,
	nextId,
	type Stated,
	type Verdict,
} from "./book.ts";

// Where a ticket's criteria and their verdicts are kept for the stages that
// read them: the record, as against the code host
// (docs/direction/ledger-behind-a-service.md). The review writes what it
// judged; ship reads it back and will not merge without a passing row for
// every criterion, at its current version, at the head (../stages/ship/ready.ts).
//
//   read(ticket)              the criteria that hold now, and every verdict row
//   judged(ticket, judgement) the rows a review gave, each by id and version
//
// Two Layers:
//
//   ledgerRecord   over the asks ledger: a ticket's criteria are the book of
//                  the plan written for it. Only the plan makes, rewords and
//                  removes them; a review's rows go in as a `judged` fact.
//   memoryRecord   for a ticket no plan holds, kept in memory: it learns the
//                  ticket's criteria from what each review read, one step at
//                  a time and never by guess (see `followed`).
//
// Either way a row is kept only when the words the review read are the
// book's words for that version: a row on other words says nothing.

/** What the record holds for one ticket: its criteria now, and every verdict row, oldest first. */
export interface Held {
	readonly criteria: readonly [Stated, ...Stated[]];
	readonly verdicts: readonly Verdict[];
}

/** What a review hands the record: the criteria as it read them, and the rows it gave. */
export interface Judgement {
	readonly criteria: readonly Stated[];
	readonly verdicts: readonly Verdict[];
}

type Unknown = {readonly _tag: "unknown"};

export class CriteriaRecord extends Context.Service<
	CriteriaRecord,
	{
		/** The ticket's criteria and rows. `null`: the record holds no criteria for it. */
		readonly read: (ticket: string) => Effect.Effect<Held | null, Unknown>;
		/** Keep a review's rows, each that holds against the book's words. */
		readonly judged: (ticket: string, judgement: Judgement) => Effect.Effect<void, Unknown>;
	}
>()("CriteriaRecord") {}

/** A ticket's key: `owner/name#N`, from that or from the issue's url. `null`: it is neither. */
export function ticketKey(ticket: string): string | null {
	const ref = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ticket);
	if (ref !== null) return `${ref[1]}/${ref[2]}#${ref[3]}`;
	const url = /github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/.exec(ticket);
	return url === null ? null : `${url[1]}/${url[2]}#${url[3]}`;
}

/** The book's criteria now, and its rows. `null`: it holds none. Pure. */
export function heldOf(book: Book): Held | null {
	const [first, ...rest] = currentOf(book).map(({id, version, text}) => ({id, version, text}));
	return first === undefined ? null : {criteria: [first, ...rest], verdicts: book.verdicts};
}

/** The rows of a judgement whose criterion the review read in the book's own words for that version. Pure. */
export function kept(book: Book, judgement: Judgement): readonly Verdict[] {
	return judgement.verdicts.filter((v) => {
		const read = judgement.criteria.find((c) => c.id === v.id && c.version === v.version);
		const words = historyOf(book, v.id)?.wordings.find((w) => w.version === v.version);
		return read !== undefined && words !== undefined && words.text === read.text;
	});
}

/**
 * A book that follows a ticket no plan holds, from the criteria a review read
 * on it. Each step is taken only when it is the book's own next one, so
 * nothing is guessed:
 *
 *   an id the book does not hold   added, if it is the book's next id at version 1
 *   an id it holds, one version on reworded, if the words changed
 *   an id the ticket no longer has retired
 *
 * Anything else (an id out of turn, a version that skips) is left as it was,
 * and the rows on it are not kept. Pure.
 */
export function followed(book: Book, criteria: readonly Stated[]): Book {
	const steps = criteria.reduce((b, c): Book => {
		const entry = b.live.find((e) => e.id === c.id);
		if (entry === undefined)
			return c.id === nextId(b) && c.version === 1
				? apply(b, {type: "added", task: 1, text: c.text, by: "plan"})
				: b;
		const last = entry.wordings[entry.wordings.length - 1];
		return last !== undefined && c.version === last.version + 1 && c.text !== last.text
			? apply(b, {type: "reworded", id: c.id, text: c.text, by: "owner"})
			: b;
	}, book);
	const gone = steps.live.filter((e) => !criteria.some((c) => c.id === e.id));
	return gone.reduce((b, e) => apply(b, {type: "removed", id: e.id}), steps);
}

const judgedMsgs = (verdicts: readonly Verdict[]): readonly CriteriaMsg[] =>
	verdicts.map((verdict) => ({type: "judged", verdict}));

/** A record in memory, starting from `books` (by ticket key). Two layers made from one share it. */
export function memoryRecord(books: ReadonlyMap<string, Book> = new Map()) {
	const ref = Ref.makeUnsafe<ReadonlyMap<string, Book>>(new Map(books));
	const bookFor = (all: ReadonlyMap<string, Book>, ticket: string): Book | null => {
		const key = ticketKey(ticket);
		return key === null ? null : (all.get(key) ?? null);
	};
	const layer = Layer.succeed(CriteriaRecord, {
		read: (ticket) => Ref.get(ref).pipe(Effect.map((all) => heldOf(bookFor(all, ticket) ?? EMPTY))),
		judged: (ticket, judgement) =>
			Ref.update(ref, (all) => {
				const key = ticketKey(ticket);
				if (key === null) return all;
				const book = followed(all.get(key) ?? EMPTY, judgement.criteria);
				return new Map(all).set(key, judgedMsgs(kept(book, judgement)).reduce(apply, book));
			}),
	});
	return {layer, book: (ticket: string) => bookFor(Effect.runSync(Ref.get(ref)), ticket)};
}

/** The plan written for a ticket: the one whose tickets name it. `null`: none. */
function planFor(state: Folded, ticket: string): string | null {
	const key = ticketKey(ticket);
	if (key === null) return null;
	for (const [plan, track] of state.plans)
		if (track.tickets.some((t) => ticketKey(t) === key)) return plan;
	return null;
}

/**
 * The record over the asks ledger. A ticket's criteria are its plan's book,
 * every task's: the ledger does not yet say which task a pull request builds.
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
					if (plan === null || book === null) return;
					const verdicts = kept(book, judgement);
					if (verdicts.length > 0) yield* ledger.append({type: "judged", plan, verdicts});
				}),
		};
	}),
);
