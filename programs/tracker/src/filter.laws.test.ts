import {replay} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {load, pulls, type Show, save, shownOf, type Tracker, tracker} from "./machine.ts";
import type {Pull} from "./pulls.ts";
import {type Entry, type Fact, summaryOf, type Ticket, type Write} from "./ticket.ts";

// The laws of the tracker's filters and its list of open pull requests, on tea's pbt: after
// every step of any list of Msgs, from the real init. The tickets come in through load_ok and
// the pull requests through pulls_ok, and the search is drawn from a few pieces of the titles,
// in mixed case and with spaces around, so it often hits and often misses.

type Machine = typeof tracker;
type Msg = MsgOf<Machine>;
type Cmd = ReturnType<typeof load> | ReturnType<typeof save> | ReturnType<typeof pulls>;
type TrackerStep = Step<Tracker, Msg, Cmd>;

// ---------------------------------------------------------------- generators

const owner = {kind: "user", id: "owner"} as const;
const ticket = fc.integer({min: 1, max: 5});
const id = fc.constantFrom("w1", "w2", "w3");

const TITLES = [
	"Login fails",
	"Docs typo",
	"Login page is slow",
	"Crash on save",
	"Dark mode for the list",
] as const;
const PULL_TITLES = ["Fix login", "docs: typo", "Save without a crash", "Dark Mode", "Bump effect"];
/** Pieces of the titles above, some in other case or with spaces around, and some that hit nothing. */
const FINDS = [
	"",
	"   ",
	"login",
	"LOGIN",
	"  Login ",
	"docs",
	"Typo ",
	"save",
	" MODE",
	"crash on",
	"o",
	"nothing like it",
	"zz",
];

const write: fc.Arbitrary<Write> = fc.oneof(
	fc.constantFrom(...TITLES).map((title): Write => ({kind: "file", title, body: ""})),
	ticket.map((t): Write => ({kind: "close", ticket: t})),
	ticket.map((t): Write => ({kind: "reopen", ticket: t})),
);
/** Mostly tickets filed, so a list has a few, and closes and reopens, so it has both states. */
const fact: fc.Arbitrary<Fact> = fc.oneof(
	{
		arbitrary: fc.constantFrom(...TITLES).map((title): Fact => ({type: "filed", title, body: ""})),
		weight: 3,
	},
	{arbitrary: fc.constant<Fact>({type: "closed"}), weight: 2},
	{arbitrary: fc.constant<Fact>({type: "reopened"}), weight: 1},
	{arbitrary: fc.constant<Fact>({type: "commented", body: "Seen it too."}), weight: 1},
);
const entry: fc.Arbitrary<Entry> = fc.record({
	pos: fc.nat({max: 30}),
	ticket,
	by: fc.constant(owner),
	at: fc.nat({max: 30}),
	fact,
});
const pull: fc.Arbitrary<Pull> = fc
	.record({
		number: fc.integer({min: 1, max: 9}),
		title: fc.constantFrom(...PULL_TITLES),
		draft: fc.boolean(),
		at: fc.nat({max: 30}),
	})
	.map((p) => ({
		...p,
		repo: "https://github.com/owner/repo",
		url: `https://github.com/owner/repo/pull/${p.number}`,
	}));
const after = fc.nat({max: 30});
const show = fc.constantFrom<Show>("open", "closed", "all");
const find = fc.constantFrom(...FINDS);
const saveOf = (i: string, w: Write, next: number) => save({id: i, write: w, next});

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	list: arbConstantMsg("list"),
	open: arbRecordMsg("open", {ticket}),
	write: arbRecordMsg("write", {id, write}),
	quit: arbConstantMsg("quit"),
	moved: arbConstantMsg("moved"),
	show: arbRecordMsg("show", {show}),
	find: arbRecordMsg("find", {text: find}),
	refresh: arbConstantMsg("refresh"),
	load_ok: fc
		.record({
			after,
			entries: fc.array(entry, {maxLength: 6}),
			broken: fc.constant([]),
			last: fc.nat({max: 30}),
		})
		.map(({after: a, ...value}) => load.ok(load({after: a}), value, 0)),
	load_err: after.map((a) => load.err(load({after: a}), {_tag: "unreachable"}, 0)),
	save_ok: fc.tuple(id, write, ticket).map(([i, w, t]) => save.ok(saveOf(i, w, t), {ticket: t}, 0)),
	save_err: fc
		.tuple(id, write, fc.constantFrom("unreachable" as const, "refused" as const))
		.map(([i, w, tag]) => save.err(saveOf(i, w, 1), {_tag: tag}, 0)),
	pulls_ok: fc.array(pull, {maxLength: 4}).map((list) => pulls.ok(pulls({}), {pulls: list}, 0)),
	pulls_err: fc.constant(pulls.err(pulls({}), {_tag: "unreachable"}, 0)),
};
/** Lists of Msgs, long enough to load tickets, read pull requests, and filter them a few times. */
const lists = fc.array(arbMsg(table), {maxLength: 40, size: "max"});
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

// ---------------------------------------------------------------- what is wanted, said again

/** A title matches when the search, trimmed, is empty, or is in the title in any case. */
const matches = (text: string, title: string) => {
	const wanted = text.trim().toLowerCase();
	return wanted === "" || title.toLowerCase().includes(wanted);
};
const fitsShow = (s: Show, t: {readonly state: Ticket["state"]}) => s === "all" || t.state === s;
const fits = (s: Tracker, t: Ticket) => fitsShow(s.show, t) && matches(s.find, t.title);

const asked = (step: TrackerStep) => step.cmds.filter((c) => c.type === "pulls");
const isPullsAnswer = (msg: Msg) => msg.type === "pulls_ok" || msg.type === "pulls_err";
/** Deep equal, or throw with the difference, so a failed law says what it saw. */
const same = (a: unknown, b: unknown) => {
	expect(a).toEqual(b);
	return true;
};
/** The list page, or `null` when a ticket is open. */
const listOf = (s: Tracker) => {
	const page = shownOf(s).page;
	return page.kind === "list" ? page : null;
};

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: TrackerStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law, OPTS),
});

// The machine's own laws: a planted mistake in one cell is caught below, in this file.

const filterOnly = every(
	"show and find set the filter, ask for nothing, and change nothing else",
	({prev, msg, next, cmds}) => {
		if (msg.type === "show") return cmds.length === 0 && same(next, {...prev, show: msg.show});
		if (msg.type === "find") return cmds.length === 0 && same(next, {...prev, find: msg.text});
		return true;
	},
);

const oneReadOut = every(
	"one pulls read is out at a time: one goes only when none is out, and the read is busy until it is answered",
	(step) => {
		const {prev, msg, next} = step;
		const sent = asked(step);
		if (prev.pulls.ask === "busy" && next.pulls.ask === "idle") return isPullsAnswer(msg);
		const went = prev.pulls.ask === "idle" && next.pulls.ask === "busy";
		return went ? sent.length === 1 : sent.length === 0;
	},
);

const refreshReads = every(
	"a refresh asks for one pulls read when none is out and it is not quitting, and else does nothing",
	({prev, msg, next, cmds}) => {
		if (msg.type !== "refresh") return true;
		if (prev.pulls.ask === "idle" && !prev.quitting)
			return same(cmds, [pulls({})]) && same(next, {...prev, pulls: {...prev.pulls, ask: "busy"}});
		return cmds.length === 0 && same(next, prev);
	},
);

const okIsKept = every(
	"a pulls list that comes back is kept as read, its why is cleared, and no read is out",
	({msg, next}) =>
		msg.type !== "pulls_ok" || same(next.pulls, {ask: "idle", list: msg.value.pulls, why: null}),
);

const errKeepsList = every(
	"a pulls read that fails says why, keeps the list it had, and no read is out",
	({prev, msg, next}) =>
		msg.type !== "pulls_err" ||
		(next.pulls.ask === "idle" &&
			typeof next.pulls.why === "string" &&
			next.pulls.why.length > 0 &&
			same(next.pulls.list, prev.pulls.list)),
);

const answersTouchPulls = every(
	"a pulls answer changes only the pulls part, and asks for nothing",
	({prev, msg, next, cmds}) =>
		!isPullsAnswer(msg) || (cmds.length === 0 && same(next, {...prev, pulls: next.pulls})),
);

const quitStopsReads = every(
	"after a quit, no step asks for a new pulls read",
	(step) => !step.next.quitting || asked(step).length === 0,
);

const waitIsOn: Law = {
	name: "the pulls_wait Sub is on exactly while no pulls read is out and it is not quitting",
	check: (machine) => {
		const on = (s: Tracker) => {
			const sub = machine.subs?.find((u) => u.type === "pulls_wait");
			if (sub === undefined) throw new Error("the machine has no pulls_wait Sub");
			const deps = sub.deps(s);
			return deps !== null && deps !== undefined;
		};
		const wanted = (s: Tracker) => s.pulls.ask === "idle" && !s.quitting;
		propertyInvariant(
			machine,
			ctx,
			lists,
			({prev, next}) => on(prev) === wanted(prev) && on(next) === wanted(next),
			OPTS,
		);
	},
};

// The window's laws: what `shownOf` gives for every state reached. Their planted mistakes go
// into `shownOf` by hand (see the list at the end of this file), as these laws call it directly.

const ticketsFit = every(
	"the list shows only tickets whose state fits show and whose title matches the search",
	({next}) => {
		const page = listOf(next);
		if (page === null) return true;
		return page.tickets.every((t) => fitsShow(next.show, t) && matches(next.find, t.title));
	},
);

const ticketsAll = every(
	"the list shows every ticket that fits the filter, newest first, as its summary",
	({next}) => {
		const page = listOf(next);
		if (page === null) return true;
		const wanted = next.tickets
			.filter((t) => fits(next, t))
			.map(summaryOf)
			.sort((a, b) => b.number - a.number);
		return same(page.tickets, wanted);
	},
);

const pullsShown = every(
	"the list shows the pull requests read whose title matches, in the order read, and none under closed",
	({next}) => {
		const page = listOf(next);
		if (page === null) return true;
		const read = next.pulls.list ?? [];
		const wanted = next.show === "closed" ? [] : read.filter((p) => matches(next.find, p.title));
		return same(page.pulls, wanted);
	},
);

const countsMatch = every(
	"the counts say how many tickets with a matching title are open and closed, and how many pull requests read match, whatever show is",
	({next}) => {
		const page = listOf(next);
		if (page === null) return true;
		const found = next.tickets.filter((t) => matches(next.find, t.title));
		return same(page.counts, {
			open: found.filter((t) => t.state === "open").length,
			closed: found.filter((t) => t.state === "closed").length,
			pulls: (next.pulls.list ?? []).filter((p) => matches(next.find, p.title)).length,
		});
	},
);

const filterShown = every(
	"the window is shown the filter, whether GitHub was read, and why the last read failed",
	({next}) => {
		const shown = shownOf(next);
		return (
			same(shown.filter, {show: next.show, find: next.find}) &&
			same(shown.github, {read: next.pulls.list !== null, why: next.pulls.why})
		);
	},
);

const MACHINE_LAWS = [
	filterOnly,
	oneReadOut,
	refreshReads,
	okIsKept,
	errKeepsList,
	answersTouchPulls,
	quitStopsReads,
	waitIsOn,
];
const VIEW_LAWS = [ticketsFit, ticketsAll, pullsShown, countsMatch, filterShown];

// ---------------------------------------------------------------- planted mistakes

const real = tracker.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...tracker,
	update: {...real, ...update},
});

/** Each machine law, with one mistake it must catch. */
const PLANTS: readonly {readonly law: Law; readonly mistake: string; readonly machine: Machine}[] =
	[
		{
			law: filterOnly,
			mistake: "a search goes back to the list",
			machine: plant({find: (s, m) => [{...s, find: m.text, open: null}, []]}),
		},
		{
			law: oneReadOut,
			mistake: "a refresh reads again while a read is out",
			machine: plant({
				refresh: (s) => [{...s, pulls: {...s.pulls, ask: "busy"}}, [pulls({})]],
			}),
		},
		{
			law: refreshReads,
			mistake: "a refresh is not heard",
			machine: plant({refresh: (s) => [s, []]}),
		},
		{
			law: okIsKept,
			mistake: "a list that comes back keeps the old why",
			machine: plant({
				pulls_ok: (s, m) => {
					const [next, cmds] = real.pulls_ok(s, m);
					return [{...next, pulls: {...next.pulls, why: s.pulls.why}}, cmds];
				},
			}),
		},
		{
			law: errKeepsList,
			mistake: "a failed read empties the list",
			machine: plant({
				pulls_err: (s, m) => {
					const [next, cmds] = real.pulls_err(s, m);
					return [{...next, pulls: {...next.pulls, list: []}}, cmds];
				},
			}),
		},
		{
			law: answersTouchPulls,
			mistake: "a failed pulls read is shown as the ledger being unreachable",
			machine: plant({
				pulls_err: (s, m) => {
					const [next, cmds] = real.pulls_err(s, m);
					return [{...next, unreachable: "GitHub is unreachable"}, cmds];
				},
			}),
		},
		{
			law: quitStopsReads,
			mistake: "a refresh reads even after a quit",
			machine: plant({
				refresh: (s) =>
					s.pulls.ask === "idle"
						? [{...s, pulls: {...s.pulls, ask: "busy"}}, [pulls({})]]
						: [s, []],
			}),
		},
		{
			law: waitIsOn,
			mistake: "the pulls_wait Sub stays on after a quit",
			machine: {
				...tracker,
				subs: (tracker.subs ?? []).map((sub) =>
					sub.type === "pulls_wait"
						? {...sub, deps: (s: Tracker) => sub.deps({...s, quitting: false})}
						: sub,
				),
			},
		},
	];

// ---------------------------------------------------------------- the tests

const owned = (pos: number, number: number, f: Fact): Entry => ({
	pos,
	ticket: number,
	by: owner,
	at: pos,
	fact: f,
});
const filed = (pos: number, number: number, title: string) =>
	owned(pos, number, {type: "filed", title, body: ""});
const pr = (number: number, title: string, draft = false): Pull => ({
	repo: "https://github.com/owner/repo",
	number,
	title,
	url: `https://github.com/owner/repo/pull/${number}`,
	draft,
	at: number,
});
const steps = (...msgs: readonly Msg[]) => replay(tracker, {ctx: undefined, msgs});

describe("the tracker's filters and pull requests", () => {
	it("starts on open tickets with no search, and asks for the ledger and the pull requests", () => {
		const first = steps();
		expect(first.cmds).toHaveLength(2);
		expect(first.cmds).toEqual(expect.arrayContaining([load({after: 0}), pulls({})]));
		expect(first.state.show).toBe("open");
		expect(first.state.find).toBe("");
		expect(first.state.pulls).toEqual({ask: "busy", list: null, why: null});
		expect(shownOf(first.state).github).toEqual({read: false, why: null});
	});

	it("filters a worked example: closed hidden first, the search in any case, pulls beside", () => {
		const tickets = load.ok(
			load({after: 0}),
			{
				entries: [
					filed(1, 1, "Login fails"),
					filed(2, 2, "Docs typo"),
					filed(3, 3, "Login page is slow"),
					owned(4, 3, {type: "closed"}),
				],
				broken: [],
				last: 4,
			},
			0,
		);
		const read = pulls.ok(pulls({}), {pulls: [pr(7, "Fix login"), pr(8, "Bump effect", true)]}, 0);
		const search: Msg = {type: "find", text: "  LOGIN "};

		const open = listOf(steps(tickets, read, search).state);
		expect(open?.tickets.map((t) => t.number)).toEqual([1]);
		expect(open?.pulls.map((p) => p.number)).toEqual([7]);
		expect(open?.counts).toEqual({open: 1, closed: 1, pulls: 1});

		const all = listOf(steps(tickets, read, search, {type: "show", show: "all"}).state);
		expect(all?.tickets.map((t) => t.number)).toEqual([3, 1]);

		const closed = listOf(steps(tickets, read, search, {type: "show", show: "closed"}).state);
		expect(closed?.tickets.map((t) => t.number)).toEqual([3]);
		expect(closed?.pulls).toEqual([]);
		expect(closed?.counts).toEqual({open: 1, closed: 1, pulls: 1});

		const none = listOf(steps(tickets, read, {type: "find", text: "nothing like it"}).state);
		expect(none?.tickets).toEqual([]);
		expect(none?.pulls).toEqual([]);
		expect(none?.counts).toEqual({open: 0, closed: 0, pulls: 0});
	});

	it("keeps the list it had when a read fails, and says why", () => {
		const read = pulls.ok(pulls({}), {pulls: [pr(7, "Fix login")]}, 0);
		const again = steps(read, {type: "refresh"});
		expect(again.cmds.filter((c) => c.type === "pulls")).toHaveLength(2);
		const failed = steps(read, {type: "refresh"}, pulls.err(pulls({}), {_tag: "unreachable"}, 0));
		expect(failed.state.pulls.list).toEqual([pr(7, "Fix login")]);
		expect(failed.state.pulls.ask).toBe("idle");
		expect(shownOf(failed.state).github.read).toBe(true);
		expect(shownOf(failed.state).github.why).toEqual(expect.stringMatching(/./));
	});

	it.each([...MACHINE_LAWS, ...VIEW_LAWS].map((law) => [law.name, law] as const))(
		"%s",
		(_, law) => {
			law.check(tracker);
		},
	);

	it.each(PLANTS.map((p) => [p.mistake, p] as const))(
		"the planted mistake %s is caught",
		(_, {law, machine}) => {
			expect(() => law.check(machine)).toThrow();
		},
	);

	it("every machine law has a planted mistake", () => {
		expect(MACHINE_LAWS.filter((law) => !PLANTS.some((p) => p.law === law))).toEqual([]);
	});
});

// Planted mistakes for the window's laws, to put into `shownOf` by hand, one at a time:
//
//   ticketsFit    under show "open", closed tickets are listed too
//   ticketsAll    the search is case-sensitive ("LOGIN" misses "Login fails")
//   pullsShown    the pull requests are listed under show "closed" too
//   countsMatch   counts.open counts every open ticket, ignoring the search
//   filterShown   github.read is true only when the list read is not empty
