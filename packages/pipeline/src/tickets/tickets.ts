import {Ledger, streams, type Writer, writerText} from "@kampus/fabrika";
import {Clock, Context, Effect, Layer, Ref, Schema} from "effect";
import {
	CodeFact,
	type Entry,
	type Fact,
	fold,
	nameOf,
	PrFact,
	readRow,
	type Ticket,
} from "./ticket.ts";

/** A ticket's number, as the tracker counts them from 1. */
type TicketNumber = number;

/**
 * A write's own key, built by the writer from its run and its step, such as `r-1/started`. The
 * ledger keeps one row per key on a stream, so a step tried again after a crash lands once, and a
 * new step always lands, even when its fact reads the same as an earlier one.
 */
type WriteId = string;

// The services the pipeline reads and writes tickets through
// (docs/direction/a-ticket-runs-from-the-app.md, section 3). A lane writes its facts here, on the
// stream the tracker already reads once a second, so its window shows them with no new code:
//
//   const tickets = yield* Tickets;
//   yield* tickets.write(3, "r-1/started", {type: "started", run: "r-1", stage: "triage", task: null, log: null});
//   // tracker/ticket/3/inbox  {type: "started", ...}  by agent:lane; the window says "triage running"
//   (yield* tickets.read(3)).timeline.at(-1)?.fact.type   // "started"
//
// Each fact has one writer (the table in section 3), and each writer gets only its own service:
//
//   Tickets   the lane: reads a ticket, writes a `CodeFact`. Never a `pr`, `answered` or `rated`.
//   Watcher   the PR watcher: writes a `pr` fact and nothing else. Done is read off it alone.
//
//   yield* tickets.write(3, "w/1", {type: "pr", state: "merged", ...})   // not_yours: the watcher's
//   yield* watcher.write(3, "w/1", {type: "pr", state: "merged", ...})   // lands; the ticket is done
//
// Each takes its own facts by its type and again at run time, so a cast fact is refused too. A
// lane's Layer never hands out `Watcher`; only the watcher's host provides it (slice 7).
//
// Two Layers each: on the ledger, for a host, and in memory, for a test with no ledger. The two
// memory Layers share one `MemoryTickets`, so a test can play the lane and the watcher at once.
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
	/** The fact is not this writer's: a person's `answered`, the watcher's `pr`, a tracker fact. */
	"not_yours",
	/** The fact does not fit its schema, such as an `asked.what` with a newline. */
	"bad_fact",
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
		 * One fact on the ticket, as the lane's writer, under the lane's own key `id`. The same
		 * `id` sent twice lands once; a new `id` always lands.
		 */
		readonly write: (
			n: TicketNumber,
			id: WriteId,
			fact: CodeFact,
		) => Effect.Effect<void, TicketsFailed>;
	}
>()("Tickets") {}

/** The PR watcher's one write: what it read from GitHub, on a change only. */
export class Watcher extends Context.Service<
	Watcher,
	{
		/** One `pr` fact on the ticket, as the watcher's writer, under its own key `id`. */
		readonly write: (
			n: TicketNumber,
			id: WriteId,
			fact: PrFact,
		) => Effect.Effect<void, TicketsFailed>;
	}
>()("Watcher") {}

const failed = (ticket: number, why: typeof Why.Type, says: string) =>
	new TicketsFailed({ticket, why, says});

/** A fact as the ledger keeps it: its kind, and its data encoded. */
interface Checked {
	readonly kind: Fact["type"];
	readonly data: unknown;
}

/**
 * The run-time check for one writer: a kind outside `kinds` is `not_yours`, even one cast past the
 * type, and a fact that fails its schema is `bad_fact`.
 */
const checking =
	(
		who: string,
		kinds: readonly string[],
		encode: (fact: unknown) => Effect.Effect<unknown, {readonly message: string}>,
	) =>
	(n: number, fact: Fact): Effect.Effect<Checked, TicketsFailed> =>
		kinds.includes(fact.type)
			? encode(fact).pipe(
					Effect.map((data) => ({kind: fact.type, data})),
					Effect.mapError((e) => failed(n, "bad_fact", e.message)),
				)
			: Effect.fail(failed(n, "not_yours", `${who} may not write a ${fact.type} fact`));

/** The lane's kinds, read off the `CodeFact` schema itself. */
const laneChecked = checking(
	"a lane",
	CodeFact.members.map((m) => m.fields.type.literal),
	Schema.encodeUnknownEffect(CodeFact),
);

/** The watcher's one kind. */
const watcherChecked = checking(
	"the watcher",
	[PrFact.fields.type.literal],
	Schema.encodeUnknownEffect(PrFact),
);

/** The one ticket `n` in a fold, or `no_ticket`. */
const ticketIn = (n: number, entries: readonly Entry[]) => {
	const ticket = fold([], entries).tickets.find((t) => t.number === n);
	return ticket === undefined
		? Effect.fail(failed(n, "no_ticket", `no ticket #${n} on the ledger`))
		: Effect.succeed(ticket);
};

/** A checked fact onto ticket `n`'s inbox on the ledger, as `writer`, under `id`. */
const sendOn =
	(ledger: Ledger["Service"], writer: Writer) =>
	(n: number, id: WriteId, fact: Effect.Effect<Checked, TicketsFailed>) =>
		Effect.gen(function* () {
			const {kind, data} = yield* fact;
			yield* ledger.send(streams(nameOf(n)).inbox, id, {kind, writer: writerText(writer), data});
		}).pipe(
			Effect.catchTags({
				LedgerUnreachable: (e) => Effect.fail(failed(n, "unreachable", e.message)),
				Denied: (e) => Effect.fail(failed(n, "refused", `the ledger refused ${e.stream}`)),
				Fenced: (e) => Effect.fail(failed(n, "refused", `the ledger refused ${e.stream}`)),
				UnknownName: () => Effect.fail(failed(n, "no_ticket", `no ticket #${n} on the ledger`)),
			}),
		);

/** Tickets on the ledger, written as `writer`: the lane's own. */
export const ticketsOnLedger = (writer: Writer): Layer.Layer<Tickets, never, Ledger> =>
	Layer.effect(
		Tickets,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const send = sendOn(ledger, writer);
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
				write: (n, id, fact) => send(n, id, laneChecked(n, fact)),
			};
		}),
	);

/** The watcher on the ledger, written as `writer`: the watcher's own, never a lane's. */
export const watcherOnLedger = (writer: Writer): Layer.Layer<Watcher, never, Ledger> =>
	Layer.effect(
		Watcher,
		Effect.gen(function* () {
			const send = sendOn(yield* Ledger, writer);
			return {write: (n, id, fact) => send(n, id, watcherChecked(n, fact))};
		}),
	);

/** A fact a test puts on a ticket before it starts: who wrote it, on which ticket. */
export interface Seeded {
	readonly ticket: TicketNumber;
	readonly by: Writer;
	readonly fact: Fact;
}

/**
 * Tickets kept in memory, for a test with no ledger: the store under the memory Layers, as the
 * ledger is under the others. Its `add` takes any fact, as the ledger's `send` does; the check of
 * who may write what is in the Layers above it.
 */
export class MemoryTickets extends Context.Service<
	MemoryTickets,
	{
		/** Ticket `n`, folded as the ledger's is, so a fact that does not fit is kept out the same way. */
		readonly read: (n: TicketNumber) => Effect.Effect<Ticket, TicketsFailed>;
		/** `fact` onto ticket `n` as `by`, once per `id`. */
		readonly add: (
			n: TicketNumber,
			id: WriteId,
			by: Writer,
			fact: Fact,
		) => Effect.Effect<void, TicketsFailed>;
	}
>()("MemoryTickets") {}

/** Tickets in memory, with `seed` on them first: a filed ticket, a person's answer. */
export const memoryTickets = (seed: readonly Seeded[] = []): Layer.Layer<MemoryTickets> =>
	Layer.effect(
		MemoryTickets,
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
				add: (n, id, by, fact) =>
					Effect.gen(function* () {
						const all = yield* Ref.get(entries);
						if (!all.some((e) => e.ticket === n && e.fact.type === "filed"))
							return yield* Effect.fail(failed(n, "no_ticket", `no ticket #${n} in memory`));
						const key = `${n}/${id}`;
						if ((yield* Ref.get(ids)).has(key)) return;
						const at = yield* Clock.currentTimeMillis;
						yield* Ref.update(ids, (s) => new Set([...s, key]));
						yield* Ref.update(entries, (es) => [
							...es,
							{pos: es.length + 1, ticket: n, by, at, fact},
						]);
					}),
			};
		}),
	);

/** Tickets in memory, written as `writer`: the lane's own. */
export const ticketsInMemory = (writer: Writer): Layer.Layer<Tickets, never, MemoryTickets> =>
	Layer.effect(
		Tickets,
		Effect.gen(function* () {
			const memory = yield* MemoryTickets;
			return {
				read: memory.read,
				write: (n, id, fact) =>
					laneChecked(n, fact).pipe(Effect.andThen(memory.add(n, id, writer, fact))),
			};
		}),
	);

/** The watcher in memory, written as `writer`: the watcher's own, never a lane's. */
export const watcherInMemory = (writer: Writer): Layer.Layer<Watcher, never, MemoryTickets> =>
	Layer.effect(
		Watcher,
		Effect.gen(function* () {
			const memory = yield* MemoryTickets;
			return {
				write: (n, id, fact) =>
					watcherChecked(n, fact).pipe(Effect.andThen(memory.add(n, id, writer, fact))),
			};
		}),
	);
