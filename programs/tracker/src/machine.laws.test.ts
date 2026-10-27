import {applyCell} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {load, over, PROBLEMS, pullRequests, save, Tracker, tracker} from "./machine.ts";
import type {Entry, Fact, Write} from "./ticket.ts";

// The tracker's laws, on tea's pbt: after every step of any list of Msgs, from the real init.
// The ledger's answers are drawn too, so an answer can come late, twice, or for a write that is
// not the one out. The "something good" laws drive the machine on from wherever a list left it,
// with the answers a working ledger would give.

type Machine = typeof tracker;
type Msg = MsgOf<Machine>;
type Cmd = ReturnType<typeof load> | ReturnType<typeof save> | ReturnType<typeof pullRequests>;
type TrackerStep = Step<Tracker, Msg, Cmd>;

// ---------------------------------------------------------------- generators

const owner = {kind: "user", id: "owner"} as const;
const ticket = fc.integer({min: 1, max: 3});
/** Three message ids, so an answer often names the write that is out, and often does not. */
const id = fc.constantFrom("w1", "w2", "w3");
const write: fc.Arbitrary<Write> = fc.oneof(
	fc.constant<Write>({kind: "file", title: "Login fails", body: ""}),
	ticket.map((t): Write => ({kind: "close", ticket: t})),
	ticket.map((t): Write => ({kind: "reopen", ticket: t})),
	ticket.map((t): Write => ({kind: "comment", ticket: t, body: "Seen it too."})),
);
const fact: fc.Arbitrary<Fact> = fc.constantFrom<Fact>(
	{type: "filed", title: "Login fails", body: ""},
	{type: "commented", body: "Seen it too."},
	{type: "closed"},
	{type: "reopened"},
);
const entry: fc.Arbitrary<Entry> = fc.record({
	pos: fc.nat({max: 30}),
	ticket,
	by: fc.constant(owner),
	at: fc.nat({max: 30}),
	fact,
});
const after = fc.nat({max: 30});
const saveOf = (i: string, w: Write, next: number) => save({id: i, write: w, next});

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	list: arbConstantMsg("list"),
	open: arbRecordMsg("open", {ticket}),
	write: arbRecordMsg("write", {id, write}),
	quit: arbConstantMsg("quit"),
	moved: arbConstantMsg("moved"),
	// The filter and the pull requests have laws of their own (filter.laws.test.ts). They are drawn
	// here too, so the laws of the ledger hold with them in the list.
	show: arbRecordMsg("show", {
		show: fc.constantFrom("open" as const, "closed" as const, "all" as const),
	}),
	find: arbRecordMsg("find", {text: fc.constantFrom("", "login")}),
	refresh: arbConstantMsg("refresh"),
	pull_requests_ok: fc.constant(pullRequests.ok(pullRequests({}), {pullRequests: []}, 0)),
	pull_requests_err: fc.constant(pullRequests.err(pullRequests({}), {_tag: "unreachable"}, 0)),
	load_ok: fc
		.record({
			after,
			entries: fc.array(entry, {maxLength: 4}),
			// Up to ten rows that do not read, so a few reads go past the most problems kept.
			broken: fc.array(fc.constant("row 9: broken"), {maxLength: 10}),
			last: fc.nat({max: 30}),
		})
		.map(({after: a, ...value}) => load.ok(load({after: a}), value, 0)),
	load_err: after.map((a) => load.err(load({after: a}), {_tag: "unreachable"}, 0)),
	save_ok: fc.tuple(id, write, ticket).map(([i, w, t]) => save.ok(saveOf(i, w, t), {ticket: t}, 0)),
	save_err: fc
		.tuple(id, write, fc.constantFrom("unreachable" as const, "refused" as const))
		.map(([i, w, tag]) => save.err(saveOf(i, w, 1), {_tag: tag}, 0)),
};
/** Lists of Msgs, long enough to queue a few writes and answer them. */
const lists = fc.array(arbMsg(table), {maxLength: 40, size: "max"});
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

// ---------------------------------------------------------------- what a step did

const saves = (step: TrackerStep) => step.cmds.filter((c) => c.type === "save");
const loads = (step: TrackerStep) => step.cmds.filter((c) => c.type === "load");
const isLoadAnswer = (msg: Msg) => msg.type === "load_ok" || msg.type === "load_err";
/** The step answered the save that was out: the one for the write at the front. */
const answeredFront = ({prev, msg}: TrackerStep) =>
	(msg.type === "save_ok" || msg.type === "save_err") && prev.saving[0]?.id === msg.cmd.id;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Step `machine` on from `from`, keeping every Cmd it asks for. */
const drive = (machine: Machine, from: Tracker, msgs: readonly Msg[]) => {
	let s = from;
	const cmds: Cmd[] = [];
	for (const msg of msgs) {
		const [next, out] = applyCell<Tracker, Msg, Cmd>(machine, s, msg);
		s = next;
		cmds.push(...out);
	}
	return {s, cmds};
};

/** A working ledger: it takes the save that is out, again and again, at most `n` times. */
const ledgerTakes = (machine: Machine, from: Tracker, n: number) => {
	let s = from;
	const cmds: Cmd[] = [];
	for (let i = 0; i < n; i += 1) {
		const front = s.saving[0];
		if (front === undefined) break;
		const answer = save.ok(saveOf(front.id, front.write, 1), {ticket: 1}, 0);
		const step = drive(machine, s, [answer]);
		s = step.s;
		cmds.push(...step.cmds);
	}
	return {s, cmds};
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

const oneSaveOut = every(
	"one save is out at a time: one goes when a new write reaches the front of the queue, and only then",
	(step) => {
		const front = step.next.saving[0];
		const newFront = front !== undefined && (step.prev.saving.length === 0 || answeredFront(step));
		const sent = saves(step);
		if (!newFront) return sent.length === 0;
		return sent.length === 1 && sent[0]?.id === front.id && same(sent[0]?.write, front.write);
	},
);

const inOrder = every(
	"writes wait in the order asked; one leaves only when its save is answered, and none is taken after a quit",
	(step) => {
		const {prev, msg, next} = step;
		const kept = answeredFront(step) ? prev.saving.slice(1) : prev.saving;
		const added = msg.type === "write" && !prev.quitting ? [{id: msg.id, write: msg.write}] : [];
		return same(next.saving, [...kept, ...added]);
	},
);

const quitStays = every(
	"once asked to quit, it stays quitting",
	({prev, next}) => !prev.quitting || next.quitting,
);

const oneReadOut = every(
	"one read of the ledger is out at a time: a read goes only when none is out, or when the one out came back",
	(step) => {
		const sent = loads(step);
		if (sent.length === 0) return true;
		const free = step.prev.load === "idle" || isLoadAnswer(step.msg);
		return sent.length === 1 && free && step.next.load === "busy";
	},
);

const neverBack = every(
	"it never reads from before what it has seen: the place seen never goes back, and each read starts there",
	(step) =>
		step.next.seen >= step.prev.seen && loads(step).every((c) => c.after === step.next.seen),
);

const fewProblems = every(
	`it keeps at most ${PROBLEMS} problems`,
	({next}) => next.problems.length <= PROBLEMS,
);

const quitFinishes: Law = {
	name: "a quit that was asked for does finish, once the ledger takes what is left to save",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(_, last) => {
				const quit = drive(machine, last, [{type: "quit"}]).s;
				return over(ledgerTakes(machine, quit, quit.saving.length + 1).s);
			},
			OPTS,
		),
};

const writeLands: Law = {
	name: "a write asked for before a quit is sent to the ledger, once the writes before it are taken",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(_, last) => {
				if (last.quitting) return true;
				const mine: Write = {kind: "file", title: "Mine", body: ""};
				const asked = drive(machine, last, [{type: "write", id: "mine", write: mine}]);
				const taken = ledgerTakes(machine, asked.s, asked.s.saving.length + 1);
				return [...asked.cmds, ...taken.cmds].some((c) => c.type === "save" && c.id === "mine");
			},
			OPTS,
		),
};

const newsIsRead: Law = {
	name: "news on the ledger is read: once the reads out are back, a move asks for the rows after what was seen",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(_, last) => {
				let s = last;
				for (let i = 0; i < 3 && s.load !== "idle"; i += 1) {
					const back = load.ok(load({after: s.seen}), {entries: [], broken: [], last: s.seen}, 0);
					s = drive(machine, s, [back]).s;
				}
				const moved = drive(machine, s, [{type: "moved"}]);
				return moved.cmds.some((c) => c.type === "load" && c.after === s.seen);
			},
			OPTS,
		),
};

const LAWS = [
	oneSaveOut,
	inOrder,
	quitStays,
	oneReadOut,
	neverBack,
	fewProblems,
	quitFinishes,
	writeLands,
	newsIsRead,
];

/** The names of the laws `machine` breaks. */
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

const real = tracker.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...tracker,
	update: {...real, ...update},
});

const PLANTS = {
	/** Every write goes out at once, even while one is out. */
	sendsEveryWrite: plant({
		write: (s, m) => {
			const [next] = real.write(s, m);
			return [next, [saveOf(m.id, m.write, 1)]];
		},
	}),
	/** A write after a quit is still taken. */
	writesAfterQuit: plant({write: (s, m) => real.write({...s, quitting: false}, m)}),
	/** Going back to the list forgets the quit. */
	listForgetsQuit: plant({list: (s) => [{...s, open: null, quitting: false}, []]}),
	/** A move reads the ledger even while a read is out. */
	readsTwice: plant({moved: (s) => [{...s, load: "busy"}, [load({after: s.seen})]]}),
	/** A read sets the place seen to where it ended, even if that is before. */
	seesBack: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, seen: m.value.last}, cmds];
		},
	}),
	/** Problems are never cut down. */
	keepsAllProblems: plant({
		load_ok: (s, m) => {
			const [next, cmds] = real.load_ok(s, m);
			return [{...next, problems: [...s.problems, ...m.value.broken]}, cmds];
		},
	}),
	/** A save taken drops every write that waited behind it. */
	dropsWhatWaits: plant({
		save_ok: (s, m) => real.save_ok({...s, saving: s.saving.slice(0, 1)}, m),
	}),
	/** A quit is not heard. */
	deafToQuit: plant({quit: (s) => [s, []]}),
	/** A move is not heard. */
	deafToMoves: plant({moved: (s) => [s, []]}),
} satisfies Readonly<Record<string, Machine>>;

describe("the tracker's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(tracker);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			sendsEveryWrite: [oneSaveOut.name],
			writesAfterQuit: [inOrder.name, quitStays.name],
			listForgetsQuit: [quitStays.name],
			readsTwice: [oneReadOut.name],
			seesBack: [neverBack.name],
			keepsAllProblems: [fewProblems.name],
			dropsWhatWaits: [inOrder.name, writeLands.name],
			deafToQuit: [quitFinishes.name],
			deafToMoves: [newsIsRead.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});

// ---------------------------------------------------------------- law: every reachable state is kept

/**
 * Every state `machine` reaches from its init, saved through `Tracker` (the schema the program's
 * `tickets` kind declares) and loaded back. It is kept nowhere today, but this is what it would be
 * read back through.
 */
const keepsEvery = (machine: Machine, runs = 150) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("tracker:r1", null));
			const store = handle.store("tickets", "tickets", Tracker);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
			}
		}),
		{numRuns: runs, seed: 1},
	);

describe("the tracker's state is kept", () => {
	it("every state it reaches from its init saves and loads back equal", async () => {
		await keepsEvery(tracker);
	});

	it("the law is seen to fail on a planted mistake: a tracker that keeps the whole answer of a read dies at its first save", async () => {
		const keepsTheAnswer = plant({
			load_ok: (s, m) => {
				const [next, cmds] = real.load_ok(s, m);
				return [{...next, ...m.value}, cmds];
			},
		});
		await expect(keepsEvery(keepsTheAnswer, 20)).rejects.toThrow(/Counterexample/);
	});
});
