import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Entry, fold, Summary, summaryOf, Ticket, TicketNumber, Write} from "./ticket.ts";

// The tracker's machine: the tickets as last read from the ledger, the ticket open in the window,
// and the writes waiting their turn. Pure: the ledger is reached through its two Cmds and its Sub,
// whose cells are in ./ledger.ts.
//
//   load   read the ledger after `seen`, and fold what comes back onto the tickets
//   save   put one write on the ledger. One at a time, in the order asked, so a close and then a
//          reopen land in that order
//   poll   a Sub, on while no load is out: it says `moved` once the ledger has rows after `seen`,
//          so a fact written from elsewhere shows up (another app on the same home, an agent later)
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

type LoadCmd = ReturnType<typeof load>;
type SaveCmd = ReturnType<typeof save>;

/** The poll, as its runner sees it: rows after `after` are news. */
export type PollSub = Sub<"poll", {readonly after: number}>;

/** A write asked for and not on the ledger yet, under its message id. */
export interface Saving {
	readonly id: string;
	readonly write: Write;
}

export const Failed = Schema.Struct({write: Write, why: Schema.String});
export type Failed = typeof Failed.Type;

export interface Tracker {
	/** A load has come back, so the tickets say what the ledger holds. */
	readonly ready: boolean;
	/** `busy`: a load is out. `again`: one is out, and another is owed once it is back. */
	readonly load: "idle" | "busy" | "again";
	/** The place of the last ledger row read. */
	readonly seen: number;
	/** Oldest first. */
	readonly tickets: readonly Ticket[];
	/** The ticket open in the window. `null`: the list. */
	readonly open: number | null;
	/** In the order asked. The first is out now. */
	readonly saving: readonly Saving[];
	/** The last write that did not land, until the next write is asked for. */
	readonly failed: Failed | null;
	/** Rows and facts that did not fit, in words: the newest few. */
	readonly problems: readonly string[];
	/** Why the last load failed. `null`: it did not. */
	readonly unreachable: string | null;
	/** Asked to quit: it ends once nothing is left to save. */
	readonly quitting: boolean;
}

export type TrackerMsg =
	| {readonly type: "list"}
	| {readonly type: "open"; readonly ticket: number}
	| {readonly type: "write"; readonly id: string; readonly write: Write}
	| {readonly type: "quit"}
	| {readonly type: "moved"};

type Step = readonly [Tracker, readonly (LoadCmd | SaveCmd)[]];

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
	types: {model: {} as Tracker, msg: {} as TrackerMsg, sub: {} as PollSub, ctx: undefined},
	cmds: [load, save],
	init: (): Step => [start, [load({after: 0})]],
	update: {
		list: (s): Step => [{...s, open: null}, []],
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

/** The page: the list, newest first, or one ticket (`null`: no ticket has that number yet). */
export const Page = Schema.Union([
	Schema.Struct({kind: Schema.Literal("list"), tickets: Schema.Array(Summary)}),
	Schema.Struct({
		kind: Schema.Literal("ticket"),
		number: TicketNumber,
		ticket: Schema.NullOr(Ticket),
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
});
export type Shown = typeof Shown.Type;

export const shownOf = (s: Tracker): Shown => ({
	ready: s.ready,
	page:
		s.open === null
			? {kind: "list", tickets: s.tickets.map(summaryOf).reverse()}
			: {
					kind: "ticket",
					number: s.open,
					ticket: s.tickets.find((t) => t.number === s.open) ?? null,
				},
	saving: s.saving.map((w) => w.write),
	failed: s.failed,
	problems: s.problems,
	unreachable: s.unreachable,
	quitting: s.quitting,
});
