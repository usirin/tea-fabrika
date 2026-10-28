import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Entry, fold, Ticket, TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";
import {Head, headOf, OpenAsk, openAsksOf} from "./head.ts";
import {PullRequest} from "./pull-requests.ts";
import {Row, rowsOf} from "./rows.ts";
import {Summary, summaryOf, Write} from "./ticket.ts";

// The tracker's machine: the tickets as last read from the ledger, the ticket open in the window,
// and the writes waiting their turn. Pure: the ledger is reached through its two Cmds and its Sub,
// whose cells are in ./ledger.ts.
//
//   load   read the ledger after `seen`, and fold what comes back onto the tickets
//   save   put one write on the ledger. One at a time, in the order asked, so a close and then a
//          reopen land in that order
//   poll   a Sub, on while no load is out: it says `moved` once the ledger has rows after `seen`,
//          so a fact written from elsewhere shows up (another app on the same home, an agent later)
//   pull_requests  read the open pull requests of the connected repositories (./pull-requests.ts);
//          `pull_requests_wait`, a Sub on while none is out, says `refresh` when it is time to read
//          them again
//   clock  a Sub, always on until it quits: `tick` with the time, once a minute, as Elm's
//          `Time.every`. A ticket's top line says "idle" from the clock alone (./head.ts), so the
//          time is in the state and the view stays a pure function of it
//
// What the list shows is part of the state too, as in Elm's Model: `show` (open, closed or all)
// and `find` (the title search). `shownOf`, the view, picks the tickets and pull requests by them.
// A reload, a second window or a new client of the same run shows the same filter.
//
//   replay(tracker, {ctx: undefined, msgs: [{type: "write", id: "w1", write: {kind: "file", title: "Login fails", body: ""}}]})
//   // state.saving [{id: "w1", ...}], cmds [load {after: 0}, save {id: "w1", write, next: 1}]
//
// The state is not kept anywhere: the ledger is. A tracker started again loads it all again.

/** Read the ledger after `after`: the facts found, the rows that did not read, and the last row's place. */
export const load = Cmd.define("load", {
	input: Schema.Struct({after: Schema.Int}),
	ok: Schema.Struct({
		entries: Schema.Array(Entry),
		broken: Schema.Array(Schema.String),
		last: Schema.Int,
	}),
	err: ["unreachable"],
});

/**
 * Put one write on the ledger. `id`: the message id, so the same write sent twice lands once.
 * `next`: for a new ticket, the first number to try; a number taken already is passed over.
 */
export const save = Cmd.define("save", {
	input: Schema.Struct({id: Schema.String, write: Write, next: TicketNumber}),
	ok: Schema.Struct({ticket: TicketNumber}),
	err: ["unreachable", "refused"],
});

/** Read the open pull requests of every connected repository. */
export const pullRequests = Cmd.define("pull_requests", {
	input: Schema.Struct({}),
	ok: Schema.Struct({pullRequests: Schema.Array(PullRequest)}),
	err: ["unreachable"],
});

type LoadCmd = ReturnType<typeof load>;
type SaveCmd = ReturnType<typeof save>;
type PullRequestsCmd = ReturnType<typeof pullRequests>;

/** The poll, as its runner sees it: rows after `after` are news. */
export type PollSub = Sub<"poll", {readonly after: number}>;
/** The wait before the pull requests are read again. */
export type PullRequestsSub = Sub<"pull_requests_wait", Record<string, never>>;
/** The clock: the time, once a minute. */
export type ClockSub = Sub<"clock", Record<string, never>>;

/** Which tickets the list shows: open ones (the start), closed ones, or all. */
export const Show = Schema.Literals(["open", "closed", "all"]);
export type Show = typeof Show.Type;

/** The title search: what a person types, up to a title's length. */
export const Find = Schema.String.check(Schema.isMaxLength(256));

/** The pull requests as last read. */
export const PullRequestsRead = Schema.Struct({
	/** `busy`: a read is out. */
	ask: Schema.Literals(["idle", "busy"]),
	/** `null`: none has come back yet. */
	list: Schema.NullOr(Schema.Array(PullRequest)),
	/** Why the last read failed; `null` once one comes back. The list read before stays. */
	why: Schema.NullOr(Schema.String),
});
export type PullRequestsRead = typeof PullRequestsRead.Type;

/** A write asked for and not on the ledger yet, under its message id. */
export const Saving = Schema.Struct({id: Schema.String, write: Write});
export type Saving = typeof Saving.Type;

export const Failed = Schema.Struct({write: Write, why: Schema.String});
export type Failed = typeof Failed.Type;

/** The machine's state, and its schema. It is kept nowhere today, but it says what it holds. */
export const Tracker = Schema.Struct({
	/** A load has come back, so the tickets say what the ledger holds. */
	ready: Schema.Boolean,
	/** `busy`: a load is out. `again`: one is out, and another is owed once it is back. */
	load: Schema.Literals(["idle", "busy", "again"]),
	/** The place of the last ledger row read. */
	seen: Schema.Int,
	/** Oldest first. */
	tickets: Schema.Array(Ticket),
	/** The ticket open in the window. `null`: the list. */
	open: Schema.NullOr(Schema.Int),
	/** In the order asked. The first is out now. */
	saving: Schema.Array(Saving),
	/** The last write that did not land, until the next write is asked for. */
	failed: Schema.NullOr(Failed),
	/** Rows and facts that did not fit, in words: the newest few. */
	problems: Schema.Array(Schema.String),
	/** Why the last load failed. `null`: it did not. */
	unreachable: Schema.NullOr(Schema.String),
	/** Asked to quit: it ends once nothing is left to save. */
	quitting: Schema.Boolean,
	/** Which tickets the list shows. */
	show: Show,
	/** The title search. "" finds every title. */
	find: Find,
	pullRequests: PullRequestsRead,
	/** The time at the clock's last tick. 0: no tick yet, so no ticket is idle yet. */
	now: Schema.Finite,
});
export type Tracker = typeof Tracker.Type;

export type TrackerMsg =
	| {readonly type: "list"}
	| {readonly type: "open"; readonly ticket: number}
	| {readonly type: "write"; readonly id: string; readonly write: Write}
	| {readonly type: "quit"}
	| {readonly type: "moved"}
	| {readonly type: "show"; readonly show: Show}
	| {readonly type: "find"; readonly text: string}
	| {readonly type: "refresh"}
	| {readonly type: "tick"; readonly now: number};

type Step = readonly [Tracker, readonly (LoadCmd | SaveCmd | PullRequestsCmd)[]];

/** The most problems kept. */
export const PROBLEMS = 20;

const start: Tracker = {
	ready: false,
	load: "busy",
	seen: 0,
	tickets: [],
	open: null,
	saving: [],
	failed: null,
	problems: [],
	unreachable: null,
	quitting: false,
	show: "open",
	find: "",
	pullRequests: {ask: "busy", list: null, why: null},
	now: 0,
};

/** The number a new ticket tries first: one past the newest known. */
const nextNumber = (s: Tracker) => (s.tickets.at(-1)?.number ?? 0) + 1;

/** Send the first write waiting, if there is one. */
const sendFirst = (s: Tracker): readonly SaveCmd[] => {
	const first = s.saving[0];
	return first === undefined ? [] : [save({id: first.id, write: first.write, next: nextNumber(s)})];
};

/** A write landed or failed: the next one goes, and the ledger is read again. */
const settled = (s: Tracker, rest: readonly Saving[]): Step => {
	const next = {...s, saving: rest};
	const sent = sendFirst(next);
	if (s.load !== "idle") return [{...next, load: "again"}, sent];
	return [{...next, load: "busy"}, [load({after: s.seen}), ...sent]];
};

const isFirst = (s: Tracker, id: string) => s.saving[0]?.id === id;

const why = (error: {readonly _tag: string; readonly [detail: string]: unknown}) =>
	typeof error.why === "string" ? error.why : error._tag;

export const tracker = defineMachine({
	types: {
		model: {} as Tracker,
		msg: {} as TrackerMsg,
		sub: {} as PollSub | PullRequestsSub | ClockSub,
		ctx: undefined,
	},
	cmds: [load, save, pullRequests],
	init: (): Step => [start, [load({after: 0}), pullRequests({})]],
	update: {
		list: (s): Step => [{...s, open: null}, []],
		show: (s, m): Step => [{...s, show: m.show}, []],
		find: (s, m): Step => [{...s, find: m.text}, []],
		tick: (s, m): Step => [{...s, now: m.now}, []],
		refresh: (s): Step =>
			s.pullRequests.ask === "idle" && !s.quitting
				? [{...s, pullRequests: {...s.pullRequests, ask: "busy"}}, [pullRequests({})]]
				: [s, []],
		pull_requests_ok: (s, m): Step => [
			{...s, pullRequests: {ask: "idle", list: m.value.pullRequests, why: null}},
			[],
		],
		pull_requests_err: (s, m): Step => [
			{...s, pullRequests: {...s.pullRequests, ask: "idle", why: why(m.error)}},
			[],
		],
		open: (s, m): Step => [{...s, open: m.ticket}, []],
		write: (s, m): Step => {
			if (s.quitting) return [s, []];
			const next = {...s, saving: [...s.saving, {id: m.id, write: m.write}], failed: null};
			return [next, s.saving.length === 0 ? sendFirst(next) : []];
		},
		quit: (s): Step => [{...s, quitting: true}, []],
		moved: (s): Step =>
			s.load === "idle" ? [{...s, load: "busy"}, [load({after: s.seen})]] : [s, []],

		load_ok: (s, m): Step => {
			const folded = fold(s.tickets, m.value.entries);
			const next: Tracker = {
				...s,
				ready: true,
				tickets: folded.tickets,
				seen: Math.max(s.seen, m.value.last),
				problems: [...s.problems, ...m.value.broken, ...folded.problems].slice(-PROBLEMS),
				unreachable: null,
			};
			return s.load === "again"
				? [{...next, load: "busy"}, [load({after: next.seen})]]
				: [{...next, load: "idle"}, []];
		},
		load_err: (s, m): Step => {
			const next: Tracker = {...s, ready: true, unreachable: why(m.error)};
			return s.load === "again"
				? [{...next, load: "busy"}, [load({after: s.seen})]]
				: [{...next, load: "idle"}, []];
		},

		save_ok: (s, m): Step => (isFirst(s, m.cmd.id) ? settled(s, s.saving.slice(1)) : [s, []]),
		save_err: (s, m): Step =>
			isFirst(s, m.cmd.id)
				? settled({...s, failed: {write: m.cmd.write, why: why(m.error)}}, s.saving.slice(1))
				: [s, []],
	},
	subs: [
		{
			type: "poll",
			deps: (s) => (s.load === "idle" && !s.quitting ? {after: s.seen} : null),
		} satisfies DepKeyedSub<Tracker, PollSub>,
		{
			type: "pull_requests_wait",
			deps: (s) => (s.pullRequests.ask === "idle" && !s.quitting ? {} : null),
		} satisfies DepKeyedSub<Tracker, PullRequestsSub>,
		{
			type: "clock",
			deps: (s) => (s.quitting ? null : {}),
		} satisfies DepKeyedSub<Tracker, ClockSub>,
	],
});

/** It is over: asked to quit, with nothing left to save. */
export const over = (s: Tracker) => s.quitting && s.saving.length === 0;

/** Its status line, for a host's list of runs. */
export const statusOf = (s: Tracker): string => {
	if (!s.ready) return "reading the ledger";
	const open = s.tickets.filter((t) => t.state === "open").length;
	const counts = `${open} open, ${s.tickets.length - open} closed`;
	return s.saving.length === 0 ? counts : `${counts}, saving ${s.saving.length}`;
};

// ---------------------------------------------------------------- what the window is shown

/**
 * The page: the list, or one ticket (`null`: no ticket has that number yet). The list holds the
 * tickets `show` and `find` pick, newest first, and the open pull requests whose titles `find`
 * picks, in the order read (none when it shows closed tickets). `counts`: how many tickets of each
 * state and how many pull requests `find` picks, so a person sees what the filter hides.
 */
/** A ticket on the list: its summary and its top line, so the owner scans one column. */
export const Listed = Schema.Struct({...Summary.fields, head: Head});
export type Listed = typeof Listed.Type;

/**
 * One ticket's page. `head`: its top line (./head.ts). `rows`: one per fact, oldest first
 * (./rows.ts). `asks`: the asks with no answer yet, each drawn with its box, even on a closed
 * ticket. The page's `opened` is `null` when no ticket has that number yet.
 */
export const Opened = Schema.Struct({
	ticket: Ticket,
	head: Head,
	rows: Schema.Array(Row),
	asks: Schema.Array(OpenAsk),
});
export type Opened = typeof Opened.Type;

export const Page = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("list"),
		tickets: Schema.Array(Listed),
		pullRequests: Schema.Array(PullRequest),
		counts: Schema.Struct({open: Schema.Int, closed: Schema.Int, pullRequests: Schema.Int}),
	}),
	Schema.Struct({
		kind: Schema.Literal("ticket"),
		number: TicketNumber,
		opened: Schema.NullOr(Opened),
	}),
]);

export const Shown = Schema.Struct({
	ready: Schema.Boolean,
	page: Page,
	/** Writes not on the ledger yet, in the order asked. */
	saving: Schema.Array(Write),
	failed: Schema.NullOr(Failed),
	problems: Schema.Array(Schema.String),
	unreachable: Schema.NullOr(Schema.String),
	quitting: Schema.Boolean,
	filter: Schema.Struct({show: Show, find: Find}),
	/** `read`: the pull requests have been read once. `why`: why the last read failed. */
	github: Schema.Struct({read: Schema.Boolean, why: Schema.NullOr(Schema.String)}),
});
export type Shown = typeof Shown.Type;

/** A title the search finds: every title for "", else one with the text in it, in any case. */
export const finds = (find: string, title: string): boolean => {
	const text = find.trim().toLowerCase();
	return text === "" || title.toLowerCase().includes(text);
};

const fits = (show: Show, state: Ticket["state"]) => show === "all" || show === state;

const listOf = (s: Tracker): Shown["page"] => {
	const found = s.tickets.filter((t) => finds(s.find, t.title));
	const prsFound = (s.pullRequests.list ?? []).filter((pr) => finds(s.find, pr.title));
	return {
		kind: "list",
		tickets: found
			.filter((t) => fits(s.show, t.state))
			.map((t) => ({...summaryOf(t), head: headOf(t.timeline, s.now)}))
			.reverse(),
		pullRequests: s.show === "closed" ? [] : prsFound,
		counts: {
			open: found.filter((t) => t.state === "open").length,
			closed: found.filter((t) => t.state === "closed").length,
			pullRequests: prsFound.length,
		},
	};
};

/** One ticket as its page shows it, at `now`. */
export const openedOf = (ticket: Ticket, now: number): Opened => ({
	ticket,
	head: headOf(ticket.timeline, now),
	rows: rowsOf(ticket.timeline),
	asks: openAsksOf(ticket.timeline),
});

const ticketOf = (s: Tracker, number: number): Shown["page"] => {
	const ticket = s.tickets.find((t) => t.number === number);
	return {kind: "ticket", number, opened: ticket === undefined ? null : openedOf(ticket, s.now)};
};

export const shownOf = (s: Tracker): Shown => ({
	ready: s.ready,
	page: s.open === null ? listOf(s) : ticketOf(s, s.open),
	saving: s.saving.map((w) => w.write),
	failed: s.failed,
	problems: s.problems,
	unreachable: s.unreachable,
	quitting: s.quitting,
	filter: {show: s.show, find: s.find},
	github: {read: s.pullRequests.list !== null, why: s.pullRequests.why},
});
