import {Ledger, streams, type Writer, writerText} from "@kampus/fabrika";
import {Clock, Context, Effect, Layer, Ref, Schema} from "effect";
import {type CodeFact, type Entry, Fact, fold, nameOf, readRow, type Ticket} from "./ticket.ts";
import {sha256} from "./yes.ts";

/** A ticket's number, as the tracker counts them from 1. */
type TicketNumber = number;

// The service the pipeline reads and writes tickets through
// (docs/direction/a-ticket-runs-from-the-app.md, section 3). A lane writes its facts here, on the
// stream the tracker already reads once a second, so its window shows them with no new code:
//
//   const tickets = yield* Tickets;
//   yield* tickets.write(3, {type: "started", run: "r-1", stage: "triage", task: null, log: null});
//   // tracker/ticket/3/inbox  {type: "started", ...}  by agent:lane; the window says "triage running"
//   (yield* tickets.read(3)).timeline.at(-1)?.fact.type   // "started"
//
// Two Layers: `ticketsOnLedger`, for a host, and `ticketsInMemory`, for a test with no ledger.
// Each writes as one writer, the host's. It takes only a `CodeFact`, so no lane writes a
// person's `answered` or `rated`.
//
// Left for the slices that need them: `answers`, the Listen on a person's answer (slice 3), and
// `tail`, every new fact on every ticket for `lanes` (slice 4).

/** Why a read or a write did not go through. */
export const Why = Schema.Literals([
	/** The ledger did not answer. */
	"unreachable",
	/** No ticket has that number: nobody filed it, or its facts do not fold. */
	"no_ticket",
	/** The ledger refused the write. */
	"refused",
]);

export class TicketsFailed extends Schema.TaggedError<TicketsFailed>()("TicketsFailed", {
	ticket: Schema.Int,
	why: Why,
	/** What went wrong, in words. */
	says: Schema.String,
}) {}

export class Tickets extends Context.Service<
	Tickets,
	{
		/** The ticket, folded from every fact on it, oldest first. */
		readonly read: (n: TicketNumber) => Effect.Effect<Ticket, TicketsFailed>;
		/**
		 * One fact on the ticket, as the host's writer. The same fact sent twice lands once: its
		 * message id is the hash of the fact, so a write tried again after a crash is not a second
		 * row.
		 */
		readonly write: (n: TicketNumber, fact: CodeFact) => Effect.Effect<void, TicketsFailed>;
	}
>()("Tickets") {}

const encode = Schema.encodeSync(Fact);

/** A fact's message id: the hash of its JSON, as the schema spells it. */
const idOf = (fact: CodeFact): Effect.Effect<string> => sha256(JSON.stringify(encode(fact)));

const failed = (ticket: number, why: typeof Why.Type, says: string) =>
	new TicketsFailed({ticket, why, says});

/** The one ticket `n` in a fold, or `no_ticket`. */
const ticketIn = (n: number, entries: readonly Entry[]) => {
	const ticket = fold([], entries).tickets.find((t) => t.number === n);
	return ticket === undefined
		? Effect.fail(failed(n, "no_ticket", `no ticket #${n} on the ledger`))
		: Effect.succeed(ticket);
};

/** Tickets on the ledger, written as `writer`: the host's own. */
export const ticketsOnLedger = (writer: Writer): Layer.Layer<Tickets, never, Ledger> =>
	Layer.effect(
		Tickets,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			return {
				read: (n) =>
					ledger.readStream(streams(nameOf(n)).inbox, 0, -1).pipe(
						Effect.mapError((e) => failed(n, "unreachable", e.message)),
						Effect.flatMap((rows) =>
							ticketIn(
								n,
								rows.flatMap((row) => {
									const read = readRow(row);
									return read.kind === "entry" ? [read.entry] : [];
								}),
							),
						),
					),
				write: (n, fact) =>
					Effect.gen(function* () {
						const id = yield* idOf(fact);
						yield* ledger.send(streams(nameOf(n)).inbox, id, {
							kind: fact.type,
							writer: writerText(writer),
							data: encode(fact),
						});
					}).pipe(
						Effect.catchTags({
							LedgerUnreachable: (e) => Effect.fail(failed(n, "unreachable", e.message)),
							Denied: (e) => Effect.fail(failed(n, "refused", `the ledger refused ${e.stream}`)),
							Fenced: (e) => Effect.fail(failed(n, "refused", `the ledger refused ${e.stream}`)),
							UnknownName: () =>
								Effect.fail(failed(n, "no_ticket", `no ticket #${n} on the ledger`)),
						}),
					),
			};
		}),
	);

/** A fact a test puts on a ticket before it starts: who wrote it, on which ticket. */
export interface Seeded {
	readonly ticket: TicketNumber;
	readonly by: Writer;
	readonly fact: Fact;
}

/**
 * Tickets in memory, written as `writer`, with `seed` on them first: a filed ticket, a person's
 * answer. It folds as the ledger's does, so a fact that does not fit is kept out the same way.
 */
export const ticketsInMemory = (
	writer: Writer,
	seed: readonly Seeded[] = [],
): Layer.Layer<Tickets> =>
	Layer.effect(
		Tickets,
		Effect.gen(function* () {
			const entries = yield* Ref.make<readonly Entry[]>(
				seed.map((s, i) => ({pos: i + 1, ticket: s.ticket, by: s.by, at: 0, fact: s.fact})),
			);
			const ids = yield* Ref.make<ReadonlySet<string>>(new Set());
			return {
				read: (n) =>
					Effect.flatMap(Ref.get(entries), (all) =>
						ticketIn(
							n,
							all.filter((e) => e.ticket === n),
						),
					),
				write: (n, fact) =>
					Effect.gen(function* () {
						const all = yield* Ref.get(entries);
						if (!all.some((e) => e.ticket === n && e.fact.type === "filed"))
							return yield* Effect.fail(failed(n, "no_ticket", `no ticket #${n} in memory`));
						const id = `${n}/${yield* idOf(fact)}`;
						if ((yield* Ref.get(ids)).has(id)) return;
						const at = yield* Clock.currentTimeMillis;
						yield* Ref.update(ids, (s) => new Set([...s, id]));
						yield* Ref.update(entries, (es) => [
							...es,
							{pos: es.length + 1, ticket: n, by: writer, at, fact},
						]);
					}),
			};
		}),
	);
