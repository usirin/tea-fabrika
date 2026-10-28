import {Ledger, MEMBERS, namesOf, streams, type Writer, writerText} from "@kampus/fabrika";
import {type Entry, mayWrite, nameOf, ROOT, readRow} from "@kampus/pipeline/tickets/ticket";
import {Clock, Context, Duration, Effect, Stream} from "effect";
import type {ClockSub, load, PollSub, save} from "./machine.ts";
import {factOf} from "./ticket.ts";

// The tracker's cells and its poll: the only code that talks to the ledger. Through the `Ledger`
// service, never the file under it, so the same tracker runs on memory in a test and on
// node:sqlite in the app.
//
//   save {id: "w1", write: {kind: "file", title: "Login fails", body: ""}, next: 1}
//     register tracker/ticket/1                     taken already? then 2, 3, ... until one is new
//     send tracker/ticket/1/inbox, id w1            {type: "filed", ...}, writer "user:owner"
//     // {ticket: 1}
//
// Who writes is the `Author` service: the host says who sits at the window.

/** Who the tracker writes as. */
export class Author extends Context.Service<Author, Writer>()("@tea-fabrika/tracker/Author") {}

/** Rows read per call. */
const PAGE = 500;

/** The most numbers a new ticket passes over before it gives up: each one was taken. */
const TRIES = 1000;

/** The ledger did not answer: the tag a cell fails with, and why in words. */
const unreachable = (e: {readonly message: string}) => ({
	_tag: "unreachable" as const,
	why: e.message,
});
const refused = (stream: string) => ({
	_tag: "refused" as const,
	why: `the ledger refused ${stream}`,
});

/**
 * An agent's entry with its person's name, when this ledger's members name them. A ledger with no
 * door has no members, and its entries stay as they are.
 */
const named = (entry: Entry, names: ReadonlyMap<string, string>): Entry => {
	const whose = "for" in entry.by ? names.get(entry.by.for) : undefined;
	return whose === undefined ? entry : {...entry, whose};
};

/** Every row after `after` under the tickets' prefix, read in pages. */
export const loadCell = (cmd: ReturnType<typeof load>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const entries: Entry[] = [];
		const broken: string[] = [];
		let last = cmd.after;
		const names = namesOf(yield* ledger.readStream(MEMBERS));
		for (;;) {
			const page = yield* ledger.read(last, PAGE, ROOT);
			for (const row of page) {
				const read = readRow(row);
				if (read.kind === "entry") entries.push(named(read.entry, names));
				if (read.kind === "broken") broken.push(read.why);
			}
			last = page.at(-1)?.pos ?? last;
			if (page.length < PAGE) return {entries, broken, last};
		}
	}).pipe(Effect.mapError(unreachable));

/** A new ticket's number: the first from `next` whose name nobody registered yet, registered now. */
const claim = (next: number, writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		for (let n = next; n < next + TRIES; n++)
			if ((yield* ledger.register(nameOf(n), writer)).created) return n;
		return yield* Effect.fail(refused(`${TRIES} ticket numbers from ${next}: every one was taken`));
	});

/** One write, as one fact in its ticket's inbox, under the write's message id. */
export const saveCell = (cmd: ReturnType<typeof save>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const author = yield* Author;
		const writer = writerText(author);
		const {write} = cmd;
		const fact = yield* factOf(write);
		// A ledger behind the door refuses this too; a ledger in this process does not, so it is here.
		if (!mayWrite(author, fact.type))
			return yield* Effect.fail({
				_tag: "refused" as const,
				why: `only a person writes ${fact.type}, and this tracker writes as agent ${author.id}`,
			});
		const ticket = write.kind === "file" ? yield* claim(cmd.next, writer) : write.ticket;
		yield* ledger.send(streams(nameOf(ticket)).inbox, cmd.id, {
			kind: fact.type,
			writer,
			data: fact,
		});
		return {ticket};
	}).pipe(
		Effect.catchTags({
			LedgerUnreachable: (e) => Effect.fail(unreachable(e)),
			Denied: (e) => Effect.fail(refused(e.stream)),
			Fenced: (e) => Effect.fail(refused(e.stream)),
			UnknownName: (e) => Effect.fail(refused(e.stream)),
		}),
	);

/** How often the poll asks the ledger for news. */
export const POLL = Duration.seconds(1);

/** `moved`, once the ledger has a row after `after`. A failed ask is asked again at the next tick. */
export const pollRunner = (sub: PollSub) =>
	Stream.tick(POLL).pipe(
		Stream.mapEffect(() =>
			Effect.gen(function* () {
				return yield* (yield* Ledger).read(sub.deps.after, 1, ROOT);
			}).pipe(Effect.orElseSucceed(() => [])),
		),
		Stream.filter((rows) => rows.length > 0),
		Stream.take(1),
		Stream.map(() => ({type: "moved" as const})),
	);

/** How often the clock ticks: a ticket's line turns "idle" within a minute of its hour. */
export const CLOCK = Duration.minutes(1);

/** `tick` with the time, at once and then once a minute. */
export const clockRunner = (_sub: ClockSub) =>
	Stream.tick(CLOCK).pipe(
		Stream.mapEffect(() => Clock.currentTimeMillis),
		Stream.map((now) => ({type: "tick" as const, now})),
	);
