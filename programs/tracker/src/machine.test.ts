import {replay} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika";
import {describe, expect, it} from "vitest";
import {load, over, pullRequests, save, shownOf, statusOf, tracker} from "./machine.ts";
import type {Entry, Write} from "./ticket.ts";

// The machine alone, with no ledger: Msgs in, then the state, the Cmds and the Subs out.

type Msg = MsgOf<typeof tracker>;
const steps = (...msgs: readonly Msg[]) => replay(tracker, {ctx: undefined, msgs});

const owner = {kind: "user", id: "owner"} as const;
const filed = (pos: number, ticket: number, title: string): Entry => ({
	pos,
	ticket,
	by: owner,
	at: pos,
	fact: {type: "filed", title, body: ""},
});
const loaded = (after: number, entries: readonly Entry[], last = entries.at(-1)?.pos ?? after) =>
	load.ok(load({after}), {entries, broken: [], last});

const file: Write = {kind: "file", title: "Login fails", body: ""};
const close: Write = {kind: "close", ticket: 1};
const reopen: Write = {kind: "reopen", ticket: 1};
const wrote = (id: string, write: Write): Msg => ({type: "write", id, write});

describe("the tracker's machine", () => {
	it("reads the whole ledger first, and is not ready until that comes back", () => {
		const first = steps();
		expect(first.cmds).toEqual([load({after: 0}), pullRequests({})]);
		expect(first.state.ready).toBe(false);
		// Only the clock: no poll while the first read is out.
		expect(first.subs.map((s) => s.type)).toEqual(["clock"]);
		expect(statusOf(first.state)).toBe("reading the ledger");

		const read = steps(loaded(0, [filed(1, 1, "Login fails"), filed(4, 2, "Docs typo")]));
		expect(read.state.ready).toBe(true);
		expect(read.state.seen).toBe(4);
		expect(read.state.tickets.map((t) => t.title)).toEqual(["Login fails", "Docs typo"]);
		expect(statusOf(read.state)).toBe("2 open, 0 closed");
		// Idle now: the poll is on, from where the read ended.
		expect(read.subs.map((s) => [s.type, s.deps])).toEqual([
			["poll", {after: 4}],
			["clock", {}],
		]);
	});

	it("keeps the time a tick brings, and nothing else changes", () => {
		const before = steps(loaded(0, []));
		const after = steps(loaded(0, []), {type: "tick", now: 5_000});
		expect(after.state).toEqual({...before.state, now: 5_000});
		expect(after.cmds).toEqual(before.cmds);
	});

	it("writes one at a time, in the order asked, and reads the ledger after each", () => {
		const asked = steps(loaded(0, []), wrote("w1", file), wrote("w2", close), wrote("w3", reopen));
		expect(asked.cmds).toEqual([
			load({after: 0}),
			pullRequests({}),
			save({id: "w1", write: file, next: 1}),
		]);
		expect(asked.state.saving.map((s) => s.id)).toEqual(["w1", "w2", "w3"]);
		expect(statusOf(asked.state)).toBe("0 open, 0 closed, saving 3");

		const first = save({id: "w1", write: file, next: 1});
		const after = steps(
			loaded(0, []),
			wrote("w1", file),
			wrote("w2", close),
			wrote("w3", reopen),
			save.ok(first, {ticket: 1}),
		);
		expect(after.cmds.slice(3)).toEqual([
			load({after: 0}),
			save({id: "w2", write: close, next: 1}),
		]);
		expect(after.state.saving.map((s) => s.id)).toEqual(["w2", "w3"]);
	});

	it("owes a read when a write lands while one is out, and makes it once that one is back", () => {
		const first = save({id: "w1", write: file, next: 1});
		const s = steps(wrote("w1", file), save.ok(first, {ticket: 1}));
		expect(s.state.load).toBe("again");
		const back = steps(wrote("w1", file), save.ok(first, {ticket: 1}), loaded(0, []));
		expect(back.state.load).toBe("busy");
		expect(back.cmds.at(-1)).toEqual(load({after: 0}));
	});

	it("keeps a write that did not land, says why, and goes on with the next", () => {
		const first = save({id: "w1", write: file, next: 1});
		const s = steps(
			loaded(0, []),
			wrote("w1", file),
			wrote("w2", close),
			save.err(first, {_tag: "unreachable", why: "disk full"}),
		);
		expect(s.state.failed).toEqual({write: file, why: "disk full"});
		expect(s.state.saving.map((w) => w.id)).toEqual(["w2"]);
		// The next write asked for clears it: the person has moved on.
		const refused = save.err(first, {_tag: "refused", why: "no inbox"});
		expect(steps(loaded(0, []), wrote("w1", file), refused).state.failed?.why).toBe("no inbox");
		expect(
			steps(loaded(0, []), wrote("w1", file), refused, wrote("w3", file)).state.failed,
		).toBeNull();
	});

	it("quits only once nothing is left to save, and writes nothing asked after", () => {
		const first = save({id: "w1", write: file, next: 1});
		const quitting = steps(loaded(0, []), wrote("w1", file), {type: "quit"}, wrote("w2", close));
		expect(over(quitting.state)).toBe(false);
		expect(quitting.state.saving.map((w) => w.id)).toEqual(["w1"]);
		expect(quitting.subs).toEqual([]);
		const done = steps(
			loaded(0, []),
			wrote("w1", file),
			{type: "quit"},
			save.ok(first, {ticket: 1}),
		);
		expect(over(done.state)).toBe(true);
	});

	it("loads again when the poll says the ledger moved, and only when no load is out", () => {
		expect(steps(loaded(0, []), {type: "moved"}).cmds.at(-1)).toEqual(load({after: 0}));
		expect(steps({type: "moved"}).cmds).toEqual([load({after: 0}), pullRequests({})]);
	});

	it("shows the list newest first, or the ticket open, and null for a number nobody filed", () => {
		const entries = [filed(1, 1, "Login fails"), filed(2, 2, "Docs typo")];
		const list = shownOf(steps(loaded(0, entries)).state);
		expect(list.page.kind === "list" && list.page.tickets.map((t) => t.number)).toEqual([2, 1]);
		const open = shownOf(steps(loaded(0, entries), {type: "open", ticket: 1}).state);
		expect(open.page.kind === "ticket" && open.page.opened?.ticket.title).toBe("Login fails");
		const none = shownOf(steps(loaded(0, entries), {type: "open", ticket: 9}).state);
		expect(none.page).toEqual({kind: "ticket", number: 9, opened: null});
		const back = shownOf(
			steps(loaded(0, entries), {type: "open", ticket: 1}, {type: "list"}).state,
		);
		expect(back.page.kind).toBe("list");
	});

	it("says a load that failed, and clears it once one works", () => {
		const failed = steps(load.err(load({after: 0}), {_tag: "unreachable", why: "no file"}));
		expect(failed.state).toMatchObject({ready: true, load: "idle", unreachable: "no file"});
		const fine = steps(
			load.err(load({after: 0}), {_tag: "unreachable", why: "no file"}),
			{type: "moved"},
			loaded(0, []),
		);
		expect(fine.state.unreachable).toBeNull();
	});
});
