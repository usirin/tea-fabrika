import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Ledger} from "@kampus/fabrika";
import {
	Entry,
	fold,
	ROOT,
	readRow,
	type Ticket,
	TicketNumber,
	Title,
} from "@kampus/pipeline/tickets/ticket";
import {headOf, words} from "@tea-fabrika/tracker";
import {Clock, Duration, Effect, Schema, Stream} from "effect";

// The asks: every ask on the ledger that waits on the person, folded in the host, once, for
// every place that shows a count of them: the window's top bar, the Dock badge and the asks list
// (window/frame.tsx, main.ts). One source, so the three can never tell two stories, as Cursor's
// badge and sidebar did (the frame's research, rule 4). A tea machine, pure: the ledger is reached
// through its one Cmd and its Sub, whose cells are below.
//
//   [asks] = init(null)                  load {after: 0}
//   load_ok {entries: [#7 filed, #7 asked a-1 "approve plan"], last: 2}
//   asksNow(asks)                        {asks: [{key: "7/a-1", ticket: 7, what: "approve plan", kind: "ask", ...}], ...}
//   {type: "later", key: "7/a-1"}        the ask leaves the count, and shows at the list's foot
//   {type: "back", key: "7/a-1"}         and is counted again
//   {type: "seen"}                       the list was opened: no ask is new any more
//
// What waits on the person is the tracker's own word for it (`headOf`, programs/tracker): a
// ticket whose head is `asks` waits on each open ask, and one whose head is `stuck` waits once,
// on its stuck run. A closed or done ticket waits on nothing, whatever ask it still holds. So the
// tracker's list and this count agree by construction.
//
// "Later" and "seen" are the person's, not the ledger's: no fact says them. They live here, in
// the host, so every window shows the same, and are lost when the host stops. A later lost brings
// its ask back into the count: the count errs toward more, never toward less.

/** One thing that waits on the person: an open ask, or a stuck run. */
export const Ask = Schema.Struct({
	/** Its key, the same on every read: `7/a-1` for ask a-1 on #7, `7/stuck/r-3` for a stuck run. */
	key: Schema.String,
	ticket: TicketNumber,
	/** The ticket's title. */
	title: Title,
	/** What it asks, in its own words, or why the run is stuck. */
	what: Schema.String,
	kind: Schema.Literals(["ask", "stuck"]),
	/** When it was asked, or the run ended stuck. */
	at: Schema.Finite,
	/** The person has opened the list since it came. */
	seen: Schema.Boolean,
});
export type Ask = typeof Ask.Type;

/**
 * What the frame shows, from the ledger: the live asks (the count), oldest first, the ones set
 * aside, and whether the ledger answers.
 *
 * `reach`: `reading` before the first read, `ok` once one worked, `failed` when the last failed.
 */
export const AsksNow = Schema.Struct({
	asks: Schema.Array(Ask),
	later: Schema.Array(Ask),
	reach: Schema.Literals(["reading", "ok", "failed"]),
	/** Why the last read failed, in words, or `null`. */
	why: Schema.NullOr(Schema.String),
});
export type AsksNow = typeof AsksNow.Type;

/** The asks machine's state. */
export interface Asks {
	readonly tickets: readonly Ticket[];
	/** The last row's place read so far. */
	readonly after: number;
	/** A load is out; `again`: and news came while it was, so one more follows. */
	readonly load: "idle" | "busy" | "again";
	readonly reach: AsksNow["reach"];
	readonly why: string | null;
	/** The keys the person set aside. */
	readonly later: readonly string[];
	/** The keys the person has seen in the list. */
	readonly seen: readonly string[];
	/** The clock's last tick, the time the tracker's head is read at. 0: no tick yet. */
	readonly now: number;
}

export type AsksMsg =
	| {readonly type: "moved"}
	/** The poll could not read the ledger. */
	| {readonly type: "failed"; readonly why: string}
	| {readonly type: "tick"; readonly now: number}
	| {readonly type: "later"; readonly key: string}
	| {readonly type: "back"; readonly key: string}
	| {readonly type: "seen"};

/** Read the ledger's tickets after `after`: the facts found, and the last row's place. */
export const load = Cmd.define("load", {
	input: Schema.Struct({after: Schema.Int}),
	ok: Schema.Struct({entries: Schema.Array(Entry), last: Schema.Int}),
	err: ["unreachable"],
});

/** The poll: rows after `after` are news; `failed`, and the first read that works is news too. */
export type PollSub = Sub<"poll", {readonly after: number; readonly failed: boolean}>;
/** The clock: the time, once a minute. */
export type ClockSub = Sub<"clock", Record<string, never>>;

type Step = readonly [Asks, readonly ReturnType<typeof load>[]];

const START: Asks = {
	tickets: [],
	after: 0,
	load: "busy",
	reach: "reading",
	why: null,
	later: [],
	seen: [],
	now: 0,
};

/** Why a cell failed, in words. */
const whyOf = (error: unknown): string =>
	typeof error === "object" && error !== null && "why" in error && typeof error.why === "string"
		? error.why
		: String(error);

/** A load came back, or failed: one more if news came meanwhile. */
const settled = (s: Asks): Step =>
	s.load === "again"
		? [{...s, load: "busy"}, [load({after: s.after})]]
		: [{...s, load: "idle"}, []];

export const asksMachine = defineMachine({
	types: {
		model: {} as Asks,
		msg: {} as AsksMsg,
		sub: {} as PollSub | ClockSub,
		ctx: undefined,
	},
	cmds: [load],
	init: (): Step => [START, [load({after: 0})]],
	update: {
		moved: (s): Step =>
			s.load === "idle"
				? [{...s, load: "busy"}, [load({after: s.after})]]
				: [{...s, load: "again"}, []],
		failed: (s, m): Step => [{...s, reach: "failed", why: m.why}, []],
		tick: (s, m): Step => [{...s, now: m.now}, []],
		later: (s, m): Step =>
			s.later.includes(m.key) ? [s, []] : [{...s, later: [...s.later, m.key]}, []],
		back: (s, m): Step => [{...s, later: s.later.filter((k) => k !== m.key)}, []],
		seen: (s): Step => {
			const keys = waitingOf(s.tickets, s.now).map((a) => a.key);
			const fresh = keys.filter((k) => !s.seen.includes(k));
			return fresh.length === 0 ? [s, []] : [{...s, seen: [...s.seen, ...fresh]}, []];
		},
		load_ok: (s, m): Step => {
			const folded = fold(s.tickets, m.value.entries);
			return settled({
				...s,
				tickets: folded.tickets,
				after: Math.max(s.after, m.value.last),
				reach: "ok",
				why: null,
			});
		},
		load_err: (s, m): Step => settled({...s, reach: "failed", why: whyOf(m.error)}),
	},
	subs: [
		{
			type: "poll",
			deps: (s) => (s.load === "idle" ? {after: s.after, failed: s.reach === "failed"} : null),
		} satisfies DepKeyedSub<Asks, PollSub>,
		{type: "clock", deps: () => ({})} satisfies DepKeyedSub<Asks, ClockSub>,
	],
});

/** A thing that waits, before the person's seen and later are put on it. */
type Waiting = Omit<Ask, "seen">;

/**
 * What waits on the person, oldest first, by the tracker's own head: each open ask of a ticket
 * whose head is `asks`, and the stuck run of one whose head is `stuck`.
 */
export const waitingOf = (tickets: readonly Ticket[], now: number): readonly Waiting[] =>
	tickets
		.flatMap((ticket): Waiting[] => {
			const head = headOf(ticket.timeline, now);
			const of = {ticket: ticket.number, title: ticket.title};
			if (head._tag === "asks")
				return head.asks.map((a) => ({
					...of,
					key: `${ticket.number}/${a.ask}`,
					what: a.what,
					kind: "ask",
					at: a.at,
				}));
			if (head._tag !== "stuck") return [];
			const ended = ticket.timeline.findLast((e) => e.fact.type === "ended");
			const run = ended?.fact.type === "ended" ? ended.fact.run : "run";
			return [
				{
					...of,
					key: `${ticket.number}/stuck/${run}`,
					what: words(head.why),
					kind: "stuck",
					at: ended?.at ?? now,
				},
			];
		})
		.sort((a, b) => a.at - b.at);

/** The frame's view of the asks: one value, for the top bar, the badge and the list alike. */
export const asksNow = (s: Asks): AsksNow => {
	const all = waitingOf(s.tickets, s.now).map((a) => ({...a, seen: s.seen.includes(a.key)}));
	return {
		asks: all.filter((a) => !s.later.includes(a.key)),
		later: all.filter((a) => s.later.includes(a.key)),
		reach: s.reach,
		why: s.why,
	};
};

/**
 * The asks to tell the person of, as the app's notification does: the live ones whose keys were
 * not there before. `null` before: the first value since the app attached, which tells of none,
 * so a start or a reconnect never shouts every old ask.
 */
export const newAsks = (before: ReadonlySet<string> | null, now: AsksNow): readonly Ask[] =>
	before === null ? [] : now.asks.filter((a) => !before.has(a.key));

/** Every key the person knows of: the live asks and the ones set aside. */
export const keysOf = (now: AsksNow): ReadonlySet<string> =>
	new Set([...now.asks, ...now.later].map((a) => a.key));

/** What a notification says of new asks: the one ask, in its ticket's words, or how many. */
export const noticeOf = (fresh: readonly [Ask, ...Ask[]]): {title: string; body: string} => {
	const [first, ...rest] = fresh;
	const said = (a: Ask) => (a.kind === "stuck" ? `stuck: ${a.what}` : a.what);
	if (rest.length === 0) return {title: `#${first.ticket} ${first.title}`, body: said(first)};
	return {
		title: `${fresh.length} new asks`,
		body: fresh.map((a) => `#${a.ticket} ${said(a)}`).join("\n"),
	};
};

// ---------------------------------------------------------------- the cells, on the `Ledger`

/** Rows read per call. */
const PAGE = 500;

/** Every ticket's row after `after`, read in pages. A row that does not read is left out. */
export const loadCell = (cmd: ReturnType<typeof load>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const entries: Entry[] = [];
		let last = cmd.after;
		for (;;) {
			const page = yield* ledger.read(last, PAGE, ROOT);
			for (const row of page) {
				const read = readRow(row);
				if (read.kind === "entry") entries.push(read.entry);
			}
			last = page.at(-1)?.pos ?? last;
			if (page.length < PAGE) return {entries, last};
		}
	}).pipe(Effect.mapError((e) => ({_tag: "unreachable" as const, why: e.message})));

/** How often the poll asks the ledger for news, as the tracker's does. */
export const POLL = Duration.seconds(1);

/**
 * `moved` once the ledger has a row after `after`, or once it answers again after a failure;
 * `failed` once a read fails while the last one worked.
 */
export const pollRunner = (sub: PollSub) =>
	Stream.tick(POLL).pipe(
		Stream.mapEffect(() =>
			Effect.gen(function* () {
				return yield* (yield* Ledger).read(sub.deps.after, 1, ROOT);
			}).pipe(
				Effect.map((rows): AsksMsg | null =>
					rows.length > 0 || sub.deps.failed ? {type: "moved"} : null,
				),
				Effect.catch((e) =>
					Effect.succeed<AsksMsg | null>(sub.deps.failed ? null : {type: "failed", why: e.message}),
				),
			),
		),
		Stream.filter((m): m is AsksMsg => m !== null),
		Stream.take(1),
	);

/** How often the clock ticks: the tracker's head reads the time, as its own list does. */
export const CLOCK = Duration.minutes(1);

/** `tick` with the time, at once and then once a minute. */
export const clockRunner = (_sub: ClockSub) =>
	Stream.tick(CLOCK).pipe(
		Stream.mapEffect(() => Clock.currentTimeMillis),
		Stream.map((now): AsksMsg => ({type: "tick", now})),
	);

/** How the machine runs: its cell and Subs, on the `Ledger` service. */
export const asksOptions = {
	ctx: undefined,
	interpret: {load: loadCell},
	subscribe: {poll: pollRunner, clock: clockRunner},
};
