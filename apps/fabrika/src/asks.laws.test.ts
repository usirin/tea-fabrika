import {applyCell} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Asks, asksMachine, asksNow, load, type Marks, waitingOf} from "./asks.ts";

// The laws of the asks machine (asks.ts, `asksMachine`), on tea's pbt, judged from the frame's
// ticket and not from the code:
//
//   later        moves an ask out of the count and back, and changes nothing else. (That the
//                count and the list's foot split what waits, never both and never lost, is
//                `asksNow`'s, and asks.test.ts holds it.)
//   seen         takes the dot away, never an ask.
//   one read     the ledger is read once at a time, and news that came during a read is read
//                next. The poll is off while a read is out.
//   honest       a failed read says so, with why; the place read to never goes back.
//   marks wait   the marks kept from before (the flags) stay until the ledger is read; then a
//                read keeps exactly those whose asks wait, and later adds only an ask that waits.
//
// Any Msgs in any order feed them, as a broken world might send them: answers nobody asked for,
// ticks, later and back on keys that wait and keys that do not.

type Machine = typeof asksMachine;
type Msg = MsgOf<Machine>;
type Load = ReturnType<typeof load>;
type AsksStep = Step<Asks, Msg, Load>;

/** The flags: marks kept from before, some on asks that may wait, one on an ask that never does. */
const ctx: Marks = {later: ["1/a-1", "9/a-9"], seen: ["2/a-1", "9/a-9"]};
const OPTS = {numRuns: 300, seed: 1};
const NOON = new Date(2026, 9, 30, 12).getTime();
const malformed = {_tag: "malformed_result", issues: []} as const;

// ---------------------------------------------------------------- the facts a read brings

const owner = {kind: "user", id: "owner"} as const;
const agent = {kind: "agent", id: "build", for: "owner"} as const;
const ticket = fc.integer({min: 1, max: 3});
const ask = fc.constantFrom("a-1", "a-2");
const run = fc.constantFrom("r-1", "r-2");
/** One fact, by whoever may write it. Facts out of order are the fold's problems, not a throw. */
type Written = readonly [Entry["by"], Fact];
const by = (who: Entry["by"], f: Fact): Written => [who, f];
const fact: fc.Arbitrary<Written> = fc.oneof(
	{
		arbitrary: fc
			.constantFrom("Login fails", "Dark mode")
			.map((title) => by(owner, {type: "filed", title, body: ""})),
		weight: 3,
	},
	{
		arbitrary: ask.map((a) =>
			by(agent, {type: "asked", ask: a, what: "approve plan", picks: ["yes", "no"]}),
		),
		weight: 3,
	},
	{
		arbitrary: ask.map((a) => by(owner, {type: "answered", ask: a, pick: "yes", note: ""})),
		weight: 1,
	},
	{
		arbitrary: run.map((r) =>
			by(agent, {type: "started", run: r, stage: "build", task: "t-1", log: null}),
		),
		weight: 2,
	},
	{
		arbitrary: fc.tuple(run, fc.boolean()).map(([r, stuck]) =>
			by(agent, {
				type: "ended",
				run: r,
				stage: "build",
				outcome: stuck ? {kind: "stuck", why: "read_failed"} : {kind: "done", part: false},
				usd: 0.25,
				input: 1,
				output: 1,
				turns: 1,
			}),
		),
		weight: 2,
	},
	{arbitrary: fc.constant(by(owner, {type: "closed"})), weight: 1},
);
/** A read's rows: facts on a few tickets, a minute apart from the hour before noon. */
const entries = fc.array(fc.tuple(ticket, fact), {maxLength: 8}).map((rows) =>
	rows.map(
		([n, [by, f]], i): Entry => ({
			pos: i + 1,
			ticket: n,
			by,
			at: NOON - 3_600_000 + i * 60_000,
			fact: f,
		}),
	),
);
/** Keys that wait, and one that never does. */
const key = fc.constantFrom("1/a-1", "1/a-2", "2/a-1", "2/stuck/r-1", "3/stuck/r-2", "9/a-9");

/** One entry per Msg type, the Cmd's answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	moved: arbConstantMsg("moved"),
	failed: arbRecordMsg("failed", {why: fc.constantFrom("refused", "timed out")}),
	tick: fc
		.integer({min: 0, max: 3})
		.map((h) => ({type: "tick", now: NOON + h * 3_600_000}) as const),
	later: arbRecordMsg("later", {key}),
	back: arbRecordMsg("back", {key}),
	seen: arbConstantMsg("seen"),
	load_ok: fc
		.tuple(entries, fc.nat({max: 40}))
		.map(([es, last]) => load.ok(load({after: 0}), {entries: es, last}, 0)),
	load_err: fc.constant({type: load.errType, cmd: load({after: 0}), error: malformed, at: 0}),
};
const weights = {load_ok: 4, moved: 3, later: 2, back: 2, seen: 2};
const lists = fc.array(arbMsg(table, {weights}), {maxLength: 30, size: "max"});

// ---------------------------------------------------------------- how a law is checked

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const everyStep = (name: string, holds: (step: AsksStep, machine: Machine) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, (step) => holds(step, machine), OPTS),
});
const everyTrace = (
	name: string,
	holds: (steps: readonly AsksStep[], machine: Machine) => boolean,
): Law => ({
	name,
	check: (machine) => propertyTrace(machine, ctx, lists, (steps) => holds(steps, machine), OPTS),
});

const keys = (asks: readonly {readonly key: string}[]) => asks.map((a) => a.key).sort();
const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((k, i) => k === b[i]);
const isAnswer = (msg: Msg) => msg.type === "load_ok" || msg.type === "load_err";
const pollOf = (machine: Machine, s: Asks) =>
	machine.subs?.find((sub) => sub.type === "poll")?.deps(s) ?? null;

// ---------------------------------------------------------------- the laws

const laterMoves = everyStep(
	"later takes an ask out of the count, back brings it in, and neither changes what waits",
	({prev, msg, next}) => {
		if (msg.type !== "later" && msg.type !== "back") return true;
		const before = asksNow(prev);
		const after = asksNow(next);
		const waiting = keys([...after.asks, ...after.later]);
		if (!same(keys([...before.asks, ...before.later]), waiting)) return false;
		if (!waiting.includes(msg.key)) return true;
		return msg.type === "later"
			? !keys(after.asks).includes(msg.key)
			: keys(after.asks).includes(msg.key);
	},
);

const seenOnlyDot = everyStep("seen takes the dot away and never an ask", ({prev, msg, next}) => {
	if (msg.type !== "seen") return true;
	const before = asksNow(prev);
	const after = asksNow(next);
	return (
		same(keys(before.asks), keys(after.asks)) &&
		same(keys(before.later), keys(after.later)) &&
		after.asks.every((a) => a.seen)
	);
});

const oneRead = everyTrace("the ledger is asked for at most one read per answer", (steps) => {
	// The first read is out from the start.
	let out = 1;
	for (const {msg, cmds} of steps) {
		if (isAnswer(msg)) out = 0;
		out += cmds.length;
		if (out > 1) return false;
	}
	return true;
});

const newsRead = everyTrace(
	"news that came during a read is read next: the answer asks again",
	(steps) => {
		let out = true;
		let news = false;
		for (const {msg, cmds} of steps) {
			if (msg.type === "moved" && out) news = true;
			if (isAnswer(msg) && out) {
				if (news && cmds.length !== 1) return false;
				news = false;
				out = cmds.length > 0;
			} else if (cmds.length > 0) out = true;
		}
		return true;
	},
);

const pollOff = everyStep(
	"the poll is off while a read is out, and on once it came back with nothing to read",
	({msg, cmds, next}, machine) => {
		const poll = pollOf(machine, next);
		if (cmds.length > 0) return poll === null;
		if (isAnswer(msg)) return poll !== null;
		return true;
	},
);

const failureSaid = everyStep(
	"a failed read says so, with why, until a read works",
	({msg, next}) => {
		const now = asksNow(next);
		if (msg.type === "failed" || msg.type === "load_err")
			return now.reach === "failed" && now.why !== null;
		if (msg.type === "load_ok") return now.reach === "ok" && now.why === null;
		return true;
	},
);

const neverBack = everyStep(
	"the place read to never goes back",
	({prev, next}) => next.after >= prev.after,
);

const marksWait = everyStep(
	"a read keeps exactly the marks whose asks wait, and later sets aside only what waits",
	({prev, msg, next}) => {
		const waiting = new Set(waitingOf(next.tickets, next.now).map((a) => a.key));
		if (msg.type === "later")
			return next.later.every((k) => prev.later.includes(k) || waiting.has(k));
		if (msg.type !== "load_ok") return true;
		const kept = (keys: readonly string[]) => keys.filter((k) => waiting.has(k));
		return same(next.later, kept(prev.later)) && same(next.seen, kept(prev.seen));
	},
);

const LAWS = [
	laterMoves,
	seenOnlyDot,
	oneRead,
	newsRead,
	pollOff,
	failureSaid,
	neverBack,
	marksWait,
];

const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = asksMachine.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...asksMachine,
	update: {...real, ...update},
});

const PLANTS = {
	/** Later drops the ask: it leaves the count and the list's foot both. */
	laterDrops: plant({
		later: (s, m) => [
			{...s, tickets: s.tickets.filter((t) => !m.key.startsWith(`${t.number}/`))},
			[],
		],
	}),
	/** Back does nothing. */
	backIgnored: plant({back: (s) => [s, []]}),
	/** Opening the list sets every later ask back into the count. */
	seenBringsBack: plant({seen: (s, m) => real.seen({...s, later: []}, m)}),
	/** News always starts a read, one out or not. */
	readsTwice: plant({moved: (s) => [{...s, load: "busy"}, [load({after: s.after})]]}),
	/** News during a read is dropped. */
	forgetsNews: plant({moved: (s, m) => (s.load === "idle" ? real.moved(s, m) : [s, []])}),
	/** The poll runs while a read is out. */
	pollAlways: {
		...asksMachine,
		subs: (asksMachine.subs ?? []).map((sub) =>
			sub.type === "poll" ? {...sub, deps: (s: Asks) => ({after: s.after, failed: false})} : sub,
		),
	} as Machine,
	/** A read that worked keeps the last failure's words. */
	keepsFailure: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, reach: s.reach, why: s.why}, cmds];
		},
	}),
	/** A read keeps the marks of asks answered since. */
	keepsAnswered: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, later: s.later, seen: s.seen}, cmds];
		},
	}),
	/** A read forgets every mark, as the host did before it kept them. */
	forgetsMarks: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, later: [], seen: []}, cmds];
		},
	}),
	/** Later sets aside a key that waits on nothing. */
	laterAnything: plant({
		later: (s, m) => (s.later.includes(m.key) ? [s, []] : [{...s, later: [...s.later, m.key]}, []]),
	}),
	/** A read's last row is taken as is, even an older one. */
	readsBack: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, after: m.value.last}, cmds];
		},
	}),
};

// ---------------------------------------------------------------- the tests

describe("the asks machine's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(asksMachine);
	});

	it("the lists reach each way a read can be, and each thing that waits", () => {
		const reached = fc.sample(lists, OPTS).flatMap((msgs) => {
			let s = asksMachine.init(null, ctx)[0];
			const seen: Asks[] = [s];
			for (const m of msgs) {
				s = applyCell<Asks, Msg, Load>(asksMachine, s, m)[0];
				seen.push(s);
			}
			return seen;
		});
		expect(new Set(reached.map((s) => s.load))).toEqual(new Set(["busy", "again", "idle"]));
		expect(new Set(reached.map((s) => s.reach))).toEqual(new Set(["reading", "ok", "failed"]));
		const kinds = reached.flatMap((s) => waitingOf(s.tickets, s.now).map((a) => a.kind));
		expect(new Set(kinds)).toEqual(new Set(["ask", "stuck"]));
		expect(reached.some((s) => s.later.length > 0 && asksNow(s).later.length > 0)).toBe(true);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			laterDrops: [laterMoves.name],
			backIgnored: [laterMoves.name],
			seenBringsBack: [seenOnlyDot.name],
			// A second read asked straight away leaves the answer nothing to ask again for.
			readsTwice: [oneRead.name, newsRead.name],
			forgetsNews: [newsRead.name],
			pollAlways: [pollOff.name],
			keepsFailure: [failureSaid.name],
			readsBack: [neverBack.name],
			keepsAnswered: [marksWait.name],
			forgetsMarks: [marksWait.name],
			laterAnything: [marksWait.name],
		});
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
