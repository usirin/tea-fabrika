import {applyCell} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {
	type Asks,
	asksMachine,
	asksNow,
	keysOf,
	load,
	type Marks,
	marksOf,
	NO_MARKS,
	newAsks,
	noticeOf,
	readMarks,
} from "./asks.ts";

// The asks count, folded from the ledger's facts as the tracker folds them: what waits on the
// person, what was set aside, and what was seen.

const owner = {kind: "user", id: "owner"} as const;
const agent = (id: string) => ({kind: "agent", id, for: "owner"}) as const;
const MINUTE = 60_000;
const NOON = new Date(2026, 9, 30, 12).getTime();

type Msg = MsgOf<typeof asksMachine>;
type Load = ReturnType<typeof load>;
const step = (s: Asks, m: Msg): readonly [Asks, readonly Load[]] =>
	applyCell<Asks, Msg, Load>(asksMachine, s, m);

/** Facts as the ledger would hold them, a minute apart from noon, on the tickets named. */
const entriesOf = (...facts: readonly (readonly [number, Entry["by"], Fact])[]): Entry[] =>
	facts.map(([ticket, by, fact], i) => ({pos: i + 1, ticket, by, at: NOON + i * MINUTE, fact}));

const filed = (ticket: number, title: string) =>
	[ticket, owner, {type: "filed", title, body: ""}] as const;
const asked = (ticket: number, ask: string, what: string) =>
	[ticket, agent("plan"), {type: "asked", ask, what, picks: ["yes", "no"]}] as const;
const answered = (ticket: number, ask: string) =>
	[ticket, owner, {type: "answered", ask, pick: "yes", note: ""}] as const;
const started = (ticket: number, run: string) =>
	[ticket, agent("build"), {type: "started", run, stage: "build", task: "t-1", log: null}] as const;
const ended = (ticket: number, run: string, outcome: Extract<Fact, {type: "ended"}>["outcome"]) =>
	[
		ticket,
		agent("build"),
		{type: "ended", run, stage: "build", outcome, usd: 0.25, input: 1, output: 1, turns: 1},
	] as const;

/**
 * The machine, on the marks kept from before, after its first load came back with these entries,
 * and the clock's first tick.
 */
const loaded = (entries: readonly Entry[], kept: Marks = NO_MARKS): Asks => {
	const [start, first] = asksMachine.init(null, kept);
	const cmd = first[0];
	if (cmd === undefined) throw new Error("the machine starts with a load");
	const [read] = step(start, load.ok(cmd, {entries, last: entries.length}, 0));
	const [ticked] = step(read, {type: "tick", now: NOON + HOUR});
	return ticked;
};
const HOUR = 60 * MINUTE;

const facts = entriesOf(
	filed(7, "Login fails"),
	asked(7, "a-1", "approve plan"),
	filed(8, "Dark mode"),
	started(8, "r-1"),
	ended(8, "r-1", {kind: "stuck", why: "read_failed"}),
	filed(9, "Old one"),
	asked(9, "a-1", "is it a duplicate?"),
	answered(9, "a-1"),
	filed(10, "Closed with an ask"),
	asked(10, "a-1", "still needed?"),
	[10, owner, {type: "closed"}],
	filed(11, "Running"),
	started(11, "r-2"),
);

describe("the asks", () => {
	it("counts each open ask and each stuck run, oldest first, and nothing answered or closed", () => {
		const now = asksNow(loaded(facts));
		expect(now.asks.map((a) => [a.key, a.ticket, a.kind, a.what])).toEqual([
			["7/a-1", 7, "ask", "approve plan"],
			["8/stuck/r-1", 8, "stuck", "read failed"],
		]);
		expect(now.asks.map((a) => a.title)).toEqual(["Login fails", "Dark mode"]);
		expect(now.reach).toBe("ok");
	});

	it("takes an ask set aside out of the count, shows it as later, and brings it back", () => {
		const [aside] = step(loaded(facts), {type: "later", key: "7/a-1"});
		const now = asksNow(aside);
		expect(now.asks.map((a) => a.key)).toEqual(["8/stuck/r-1"]);
		expect(now.later.map((a) => a.key)).toEqual(["7/a-1"]);
		const [back] = step(aside, {type: "back", key: "7/a-1"});
		expect(asksNow(back).asks.map((a) => a.key)).toEqual(["7/a-1", "8/stuck/r-1"]);
	});

	it("marks every ask seen once the list opens, and a newer one comes unseen", () => {
		const [seen] = step(loaded(facts), {type: "seen"});
		expect(asksNow(seen).asks.every((a) => a.seen)).toBe(true);
		const more = entriesOf(
			...facts.map((e) => [e.ticket, e.by, e.fact] as const),
			asked(11, "a-2", "merge?"),
		);
		const [busy, cmds] = step(seen, {type: "moved"});
		const cmd = cmds[0];
		if (cmd === undefined) throw new Error("news asks for a load");
		const [read] = step(
			busy,
			load.ok(cmd, {entries: more.slice(facts.length), last: more.length}, 0),
		);
		const now = asksNow(read);
		expect(now.asks.map((a) => [a.key, a.seen])).toEqual([
			["7/a-1", true],
			["8/stuck/r-1", true],
			["11/a-2", false],
		]);
	});

	it("loads once at a time: news while a load is out asks for one more after it", () => {
		const s = loaded([]);
		const [busy, first] = step(s, {type: "moved"});
		expect(first).toHaveLength(1);
		const [again, none] = step(busy, {type: "moved"});
		expect(none).toHaveLength(0);
		expect(again.load).toBe("again");
		const cmd = first[0];
		if (cmd === undefined) throw new Error("news asks for a load");
		const [, next] = step(again, load.ok(cmd, {entries: [], last: 0}, 0));
		expect(next).toHaveLength(1);
	});

	it("tells of an ask only once it is new, never on the first value after an attach", () => {
		const now = asksNow(loaded(facts));
		expect(newAsks(null, now)).toEqual([]);
		expect(newAsks(new Set(["7/a-1"]), now).map((a) => a.key)).toEqual(["8/stuck/r-1"]);
		expect(newAsks(keysOf(now), now)).toEqual([]);
		const [one, two] = now.asks;
		if (one === undefined || two === undefined) throw new Error("two asks");
		expect(noticeOf([one])).toEqual({title: "#7 Login fails", body: "approve plan"});
		expect(noticeOf([one, two])).toEqual({
			title: "2 new asks",
			body: "#7 approve plan\n#8 stuck: read failed",
		});
	});

	it("starts on the marks kept from before: later and seen as they were", () => {
		const now = asksNow(loaded(facts, {later: ["8/stuck/r-1"], seen: ["7/a-1", "8/stuck/r-1"]}));
		expect(now.asks.map((a) => [a.key, a.seen])).toEqual([["7/a-1", true]]);
		expect(now.later.map((a) => a.key)).toEqual(["8/stuck/r-1"]);
	});

	it("drops a kept mark at the first read once its ask waits no more: answered, or closed", () => {
		const kept = {later: ["9/a-1", "7/a-1", "10/a-1"], seen: ["9/a-1", "8/stuck/r-1"]};
		const [start] = asksMachine.init(null, kept);
		// Before the ledger is read, nothing is known to be gone: the marks stay.
		expect(marksOf(start)).toEqual(kept);
		const now = loaded(facts, kept);
		expect(marksOf(now)).toEqual({later: ["7/a-1"], seen: ["8/stuck/r-1"]});
		expect(asksNow(now).later.map((a) => a.key)).toEqual(["7/a-1"]);
	});

	it("sets aside only an ask that waits: one answered since the list was drawn is gone", () => {
		const s = loaded(facts);
		const [same] = step(s, {type: "later", key: "9/a-1"});
		expect(same).toBe(s);
		const [back] = step(s, {type: "back", key: "7/a-1"});
		expect(back).toBe(s);
	});

	it("reads kept marks back, and refuses a broken or older file with why", () => {
		expect(readMarks(null)).toEqual({kind: "none"});
		expect(readMarks('{"later":["7/a-1"],"seen":[]}')).toEqual({
			kind: "read",
			marks: {later: ["7/a-1"], seen: []},
		});
		for (const text of ["", "{", '{"later":["7/a-1"]}', '{"later":[],"seen":[],"open":[]}', "[]"]) {
			const read = readMarks(text);
			expect(read.kind, text).toBe("refused");
			expect(read.kind === "refused" && read.why.length > 0, text).toBe(true);
		}
	});

	it("says the ledger failed, and keeps the count it had", () => {
		const [failed] = step(loaded(facts), {type: "failed", why: "connection refused"});
		const now = asksNow(failed);
		expect(now.reach).toBe("failed");
		expect(now.why).toBe("connection refused");
		expect(now.asks).toHaveLength(2);
	});
});
