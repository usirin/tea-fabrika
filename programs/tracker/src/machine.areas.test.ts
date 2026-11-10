import {replay} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika-old";
import type {AreaEntry} from "@kampus/pipeline/tickets/area";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {folders, load, save, shownOf, statusOf, type Tracker, tracker} from "./machine.ts";
import type {Write} from "./ticket.ts";

// Areas PR 1, today's version (docs/direction/areas.md, call 7; the plan's a6): the tracker's
// first open asks for the first areas. While the ledger has no area and the person has not
// skipped, the list page shows the suggestions; making them writes one `make_area` each, in the
// order ticked; a skip is the machine's own state, not a fact, and the step does not come back.
// The machine alone, with no ledger. Which rows are ticked, and the keys (Space, Enter, Esc), are
// the window's: the shots check those.
//
//   load_ok, no area, three open titles start "Lane"
//   // page.onboarding  [{_tag: "titles", word: "lane", tickets: 3}]
//   skip_onboarding
//   // page.onboarding  null, and it stays null
//
// Round 1b, the lead's two calls: the folders come through a read-only folder service (no folders
// by default), asked for once, with a `folders` Cmd, the first time the step shows; and the step
// has a box to type a name, since a fresh ledger may have nothing to suggest.
//
//   folders_ok {folders: ["apps/fabrika"]}
//   // page.onboarding  [..., {_tag: "folder", path: "apps/fabrika"}]

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

// made up: `AreaEntry`'s keys are a ticket `Entry`'s, less `ticket`.
const made = (pos: number, area: number, name: string): AreaEntry => ({
	pos,
	by: owner,
	at: pos,
	fact: {_tag: "area_made", area, name},
});

/**
 * A load back from the ledger. made up: the tracker's load reads `tracker/areas` beside the
 * tickets (the plan's "a second read of `AREAS`") and hands its rows back as `areas`.
 */
const loaded = (
	after: number,
	entries: readonly Entry[],
	areas: readonly AreaEntry[] = [],
	last = Math.max(after, ...entries.map((e) => e.pos), ...areas.map((a) => a.pos)),
) => load.ok(load({after}), {entries, broken: [], last, areas});

const LANE = [
	filed(1, 1, "Lane: a run hangs"),
	filed(2, 2, "Lane tests: one is flaky"),
	filed(3, 3, "lane checks: red on main"),
	filed(4, 4, "Login fails"),
];

// made up: the list page's `onboarding`, the suggestions it shows, or `null` when it shows none.
const onboardingOf = (s: Tracker) => {
	const {page} = shownOf(s);
	return page.kind === "list" ? page.onboarding : undefined;
};

// made up: the Msg a skip sends.
const SKIP: Msg = {type: "skip_onboarding"};

describe("the first open, with no area on the ledger (a6)", () => {
	it("holds the ledger's areas in the model, none yet", () => {
		const s = steps(loaded(0, LANE)).state;
		expect(s.areas.live.size).toBe(0);
	});

	it("shows the onboarding step on the list page, with the titles' suggestion", () => {
		expect(onboardingOf(steps(loaded(0, LANE)).state)).toContainEqual({
			_tag: "titles",
			word: "lane",
			tickets: 3,
		});
	});

	it("shows no step once the ledger has an area", () => {
		const s = steps(loaded(0, LANE, [made(5, 1, "pipeline")])).state;
		expect([...s.areas.live]).toEqual([[1, "pipeline"]]);
		expect(onboardingOf(s)).toBeNull();
	});

	it("shows no step once an area made elsewhere is read in a later load", () => {
		const s = steps(loaded(0, LANE), {type: "moved"}, loaded(4, [], [made(5, 1, "pipeline")]));
		expect(onboardingOf(s.state)).toBeNull();
	});

	it("makes the ticked ones one write each, in the order ticked", () => {
		// made up: `make_area`'s `Write` case, `{kind: "make_area", name}`.
		const writes: readonly Write[] = [
			{kind: "make_area", name: "lane"},
			{kind: "make_area", name: "app"},
			{kind: "make_area", name: "desk"},
		];
		const s = steps(
			loaded(0, LANE),
			...writes.map((write, i): Msg => ({type: "write", id: `w${i}`, write})),
		);
		expect(s.state.saving.map((w) => w.write)).toEqual(writes);
		// One at a time, the first ticked first.
		const saves = s.cmds.filter((c) => c.type === "save");
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatchObject({type: "save", id: "w0", write: writes[0]});
		// Once they are read back, the areas are in that order, and the step is gone.
		const back = steps(
			loaded(0, LANE),
			{type: "moved"},
			loaded(4, [], [made(5, 1, "lane"), made(6, 2, "app"), made(7, 3, "desk")]),
		).state;
		expect([...back.areas.live]).toEqual([
			[1, "lane"],
			[2, "app"],
			[3, "desk"],
		]);
		expect(onboardingOf(back)).toBeNull();
	});

	it("skips on Esc, writes nothing, and does not ask again as the ledger moves", () => {
		const skipped = steps(loaded(0, LANE), SKIP);
		expect(onboardingOf(skipped.state)).toBeNull();
		expect(skipped.cmds).toEqual(steps(loaded(0, LANE)).cmds);
		const later = steps(
			loaded(0, LANE),
			SKIP,
			{type: "moved"},
			loaded(4, [filed(5, 5, "Lane: one more")]),
		);
		expect(onboardingOf(later.state)).toBeNull();
		expect(later.state.areas.live.size).toBe(0);
	});
});

// made up: the `folders` Cmd, its input `{}`, its answer `{folders}`, its error `unreachable`.
const foldersOk = (list: readonly string[]): Msg => folders.ok(folders({}), {folders: list}, 0);
const foldersErr: Msg = folders.err(folders({}), {_tag: "unreachable", why: "no network"}, 0);

const foldersAsked = (msgs: readonly Msg[]) =>
	steps(...msgs).cmds.filter((c) => c.type === "folders");

describe("the onboarding step's folders (round 1b)", () => {
	it("asks for the folders once, the first time the step shows", () => {
		expect(foldersAsked([])).toEqual([]);
		expect(foldersAsked([loaded(0, LANE)])).toHaveLength(1);
		expect(
			foldersAsked([loaded(0, LANE), {type: "moved"}, loaded(4, [filed(5, 5, "Lane: more")])]),
		).toHaveLength(1);
	});

	it("does not ask when the ledger already has an area", () => {
		expect(foldersAsked([loaded(0, LANE, [made(5, 1, "pipeline")])])).toEqual([]);
	});

	it("shows a folder suggestion for each folder read, beside the titles'", () => {
		const shown = onboardingOf(steps(loaded(0, LANE), foldersOk(["apps/fabrika"])).state);
		expect(shown).toContainEqual({_tag: "folder", path: "apps/fabrika"});
		expect(shown).toContainEqual({_tag: "titles", word: "lane", tickets: 3});
	});

	it("keeps the step working when the folders cannot be read, and says nothing of it", () => {
		const before = shownOf(steps(loaded(0, LANE)).state);
		const after = shownOf(steps(loaded(0, LANE), foldersErr).state);
		// Nothing new in the problems, the alerts or the failed write: a missing suggestion is no news.
		expect(after).toEqual(before);
		expect(onboardingOf(steps(loaded(0, LANE), foldersErr).state)).toContainEqual({
			_tag: "titles",
			word: "lane",
			tickets: 3,
		});
	});
});

// made up: a typed name is the same `make_area` write as a ticked one, with no `suggested`.
const typed = (name: string): Write => ({kind: "make_area", name});

describe("a name typed in the onboarding step (round 1b)", () => {
	it("makes an area with that name", () => {
		const s = steps(loaded(0, []), {type: "write", id: "t1", write: typed("lane work")});
		expect(s.cmds.filter((c) => c.type === "save")).toEqual([
			expect.objectContaining({id: "t1", write: typed("lane work")}),
		]);
		const back = steps(
			loaded(0, []),
			{type: "moved"},
			loaded(0, [], [made(1, 1, "lane work")]),
		).state;
		expect([...back.areas.live]).toEqual([[1, "lane work"]]);
	});

	it.each([
		["an empty name", ""],
		["a name of spaces", "   "],
	])("refuses %s, saves nothing, and says why", (_, name) => {
		const s = steps(loaded(0, []), {type: "write", id: "t1", write: typed(name)});
		expect(s.cmds.filter((c) => c.type === "save")).toEqual([]);
		expect(s.state.saving).toEqual([]);
		expect(s.state.failed?.write).toEqual(typed(name));
		expect(s.state.failed?.why).toMatch(/\S/);
	});

	it("refuses a name a live area has, in any case, and says which", () => {
		const s = steps(loaded(0, [], [made(1, 1, "pipeline")]), {
			type: "write",
			id: "t1",
			write: typed("Pipeline"),
		});
		expect(s.cmds.filter((c) => c.type === "save")).toEqual([]);
		expect(s.state.failed?.write).toEqual(typed("Pipeline"));
		expect(s.state.failed?.why).toMatch(/pipeline/i);
	});
});

// Round 1c. The plan: "PR 1 shows the onboarding, and the areas it makes show in tsh's `tracker`
// output." The tracker's line in tsh is its `statusOf`. Round 2: the builder's words, held exactly.
describe("after Enter on the onboarding, the areas made show (round 1c)", () => {
	it("names each area made in the tracker's line in tsh, once the ledger has them", () => {
		// A folder makes the name of its last part, as Enter does.
		const ticked: readonly Write[] = [
			{kind: "make_area", name: "lane", suggested: {_tag: "titles", word: "lane", tickets: 3}},
			{kind: "make_area", name: "fabrika", suggested: {_tag: "folder", path: "apps/fabrika"}},
		];
		// Enter: one write each, in the order ticked; each save answers with its area.
		const answered = (i: number, area: number): Msg =>
			save.ok(save({id: `w${i}`, write: ticked[i] as Write, next: 5}), {area}, 0);
		const before = steps(loaded(0, LANE), foldersOk(["apps/fabrika"])).state;
		expect(statusOf(before)).toBe("4 open, 0 closed");
		const after = steps(
			loaded(0, LANE),
			foldersOk(["apps/fabrika"]),
			...ticked.map((write, i): Msg => ({type: "write", id: `w${i}`, write})),
			answered(0, 1),
			answered(1, 2),
			{type: "moved"},
			loaded(4, [], [made(5, 1, "lane"), made(6, 2, "fabrika")]),
		).state;
		expect(after.saving).toEqual([]);
		expect(onboardingOf(after)).toBeNull();
		expect(statusOf(after)).toBe("4 open, 0 closed; areas: lane, fabrika");
	});

	it("names only the live areas: a merged one is gone from the line", () => {
		const s = steps(
			loaded(0, LANE, [
				made(5, 1, "lane"),
				made(6, 2, "desk"),
				{pos: 7, by: owner, at: 7, fact: {_tag: "area_merged", area: 2, into: 1}},
			]),
		).state;
		expect(statusOf(s)).toBe("4 open, 0 closed; areas: lane");
	});
});

// Round 2, from the mutation step: a write refused in the machine asks for nothing at all.
describe("an area write refused in the machine", () => {
	it("gives no Cmd, and the write already out stays the one out", () => {
		const filing: Write = {kind: "file", title: "Login fails", body: ""};
		const ready = steps(loaded(0, [], [made(1, 1, "pipeline")]), {
			type: "write",
			id: "f1",
			write: filing,
		}).state;
		const [next, cmds] = tracker.update.write(ready, {
			type: "write",
			id: "t1",
			write: typed("PIPELINE"),
		});
		expect(cmds).toEqual([]);
		expect(next.saving).toEqual([{id: "f1", write: filing}]);
		expect(next.failed?.write).toEqual(typed("PIPELINE"));
	});
});

// Round 2, the lead's call: read your own writes. Once a save answers `{area}`, the machine knows
// that area, as Elm's update folds its own landed write into the model, and a rename or a merge of
// it goes out at once, with no load in between.
describe("an area this tracker just made (read your own writes)", () => {
	const write = (id: string, w: Write): Msg => ({type: "write", id, write: w});
	const landed = (id: string, w: Write, area: number): Msg =>
		save.ok(save({id, write: w, next: 5}), {area}, 0);

	it("takes a rename of it right after its save answers, before any load", () => {
		const lane = typed("lane");
		const renamed: Write = {kind: "rename_area", area: 1, name: "lane work"};
		const s = steps(
			loaded(0, LANE),
			write("w0", lane),
			landed("w0", lane, 1),
			write("w1", renamed),
		);
		expect(s.state.failed).toBeNull();
		expect(s.state.saving).toEqual([{id: "w1", write: renamed}]);
		expect(s.cmds.filter((c) => c.type === "save").map((c) => c.id)).toEqual(["w0", "w1"]);
	});

	it("takes a merge of two it just made, before any load", () => {
		const lane = typed("lane");
		const desk = typed("desk");
		const merged: Write = {kind: "merge_area", area: 2, into: 1};
		const s = steps(
			loaded(0, LANE),
			write("w0", lane),
			write("w1", desk),
			landed("w0", lane, 1),
			landed("w1", desk, 2),
			write("w2", merged),
		);
		expect(s.state.failed).toBeNull();
		expect(s.state.saving).toEqual([{id: "w2", write: merged}]);
		expect(s.cmds.filter((c) => c.type === "save").map((c) => c.id)).toEqual(["w0", "w1", "w2"]);
	});
});

// Round 4, the lead's call on the review's findings 1, 2 and 4: pending writes, as Replicache and
// Linear keep them. The areas are folded from the ledger's rows alone; this tracker's own saves
// that no load has read back yet are `pending`, shown folded on top. Each load drops the pending
// ones it read back and folds the rest on top again, so the ledger's order always wins.
//
//   knows {1: "x"}; another person renames 1 to "b" (row 3, unread); this tracker renames 1 to "a" (row 4)
//   save_ok {area: 1}           // shows "a", pending [area_renamed 1 "a"]
//   load_ok {areas: [row 3, row 4]}
//   // the ledger folds to "a"; shows "a", pending [], no problem line
describe("this tracker's own area writes, pending until a load reads them back", () => {
	const other = {kind: "user", id: "other"} as const;
	const ask = (id: string, w: Write): Msg => ({type: "write", id, write: w});
	const answered = (id: string, w: Write, area: number): Msg =>
		save.ok(save({id, write: w, next: 5}), {area}, 0);
	const renamedRow = (pos: number, by: AreaEntry["by"], name: string): AreaEntry => ({
		pos,
		by,
		at: pos,
		fact: {_tag: "area_renamed", area: 1, name},
	});
	/** A load back from the ledger with rows on the areas that did not read. */
	const loadedBroken = (after: number, broken: readonly string[], last: number) =>
		load.ok(load({after}), {entries: [], broken, last, areas: []});

	const ONE = [filed(1, 1, "Login fails")];
	const toA: Write = {kind: "rename_area", area: 1, name: "a"};
	const KNOWN = [loaded(0, ONE, [made(2, 1, "x")]), ask("w1", toA)];

	it("shows its rename at once, and keeps it after a load reads another's rename before it", () => {
		const now = steps(...KNOWN, answered("w1", toA, 1)).state;
		expect(statusOf(now)).toBe("1 open, 0 closed; areas: a");
		const after = steps(
			...KNOWN,
			answered("w1", toA, 1),
			loaded(2, [], [renamedRow(3, other, "b"), renamedRow(4, owner, "a")]),
		).state;
		// The ledger holds "b" then "a": it ends "a", and so does the tracker.
		expect(statusOf(after)).toBe("1 open, 0 closed; areas: a");
		expect(after.problems).toEqual(now.problems);
		// made up: `pending`, this tracker's area facts not read back yet (the lead's name for it).
		expect(now.pending).toEqual([{_tag: "area_renamed", area: 1, name: "a"}]);
		expect(after.pending).toEqual([]);
	});

	it("shows another's rename when the ledger puts it after this tracker's own", () => {
		const after = steps(
			...KNOWN,
			answered("w1", toA, 1),
			loaded(2, [], [renamedRow(3, owner, "a"), renamedRow(4, other, "b")]),
		).state;
		expect(statusOf(after)).toBe("1 open, 0 closed; areas: b");
		expect(after.problems).toEqual([]);
		expect(after.pending).toEqual([]);
	});

	it("keeps its rename on top when a load that was out reads only another's, then drops it once read", () => {
		// The load goes out before the save answers, so it may come back without this tracker's row.
		const before = [...KNOWN, {type: "moved"} as const, answered("w1", toA, 1)];
		const half = steps(...before, loaded(2, [], [renamedRow(3, other, "b")]));
		expect(statusOf(half.state)).toBe("1 open, 0 closed; areas: a");
		expect(half.cmds.filter((c) => c.type === "load").at(-1)).toMatchObject({after: 3});
		const whole = steps(
			...before,
			loaded(2, [], [renamedRow(3, other, "b")]),
			loaded(3, [], [renamedRow(4, owner, "a")]),
		).state;
		expect(statusOf(whole)).toBe("1 open, 0 closed; areas: a");
		expect(whole.problems).toEqual([]);
		expect(half.state.pending).toEqual([{_tag: "area_renamed", area: 1, name: "a"}]);
		expect(whole.pending).toEqual([]);
	});

	// Finding 2: the read-back, with a ticked suggestion kept whole on the row.
	it("reads its own made area back once: nothing pending, no problem line, the area shown once", () => {
		const suggested = {_tag: "titles", word: "lane", tickets: 3} as const;
		const lane: Write = {kind: "make_area", name: "lane", suggested};
		const asked = [loaded(0, LANE), ask("w1", lane), answered("w1", lane, 1)];
		const row: AreaEntry = {
			pos: 5,
			by: owner,
			at: 5,
			fact: {_tag: "area_made", area: 1, name: "lane", suggested},
		};
		const now = steps(...asked).state;
		const back = steps(...asked, loaded(4, [], [row])).state;
		expect(back.problems).toEqual(now.problems);
		expect(statusOf(back)).toBe("4 open, 0 closed; areas: lane");
		const later = steps(...asked, loaded(4, [], [row]), {type: "moved"}, loaded(5, [], [])).state;
		expect(later.problems).toEqual(now.problems);
		expect(statusOf(later)).toBe("4 open, 0 closed; areas: lane");
		expect(now.pending).toEqual([{_tag: "area_made", area: 1, name: "lane", suggested}]);
		expect(back.pending).toEqual([]);
		expect(later.pending).toEqual([]);
	});

	it("leaves nothing pending when a load read its row before its save answered", () => {
		// The load was out while the save landed, and read the row; the answer comes after it.
		const lane = typed("lane");
		const s = steps(
			loaded(0, LANE),
			ask("w1", lane),
			{type: "moved"},
			loaded(4, [], [made(5, 1, "lane")]),
			answered("w1", lane, 1),
			loaded(5, [], []),
		).state;
		expect(s.problems).toEqual([]);
		expect(statusOf(s)).toBe("4 open, 0 closed; areas: lane");
		expect(s.pending).toEqual([]);
	});

	// Finding 4. Pinned the way Replicache drops a pending mutation: a load sent after the save
	// answered has read past the save's row, whether that row read or not, so it ends the pending
	// fact. A load already out when the save answered may not hold the row, so it ends nothing.
	describe("a pending fact whose row reads as broken", () => {
		const lane = typed("lane");
		const BROKEN = "row 5 on the areas: its data is not an area fact";

		it("is pending no more after the load sent once its save answered, and is not shown", () => {
			const s = steps(
				loaded(0, LANE),
				ask("w1", lane),
				answered("w1", lane, 1),
				loadedBroken(4, [BROKEN], 5),
			).state;
			expect(statusOf(s)).toBe("4 open, 0 closed");
			expect(s.problems).toContain(BROKEN);
			expect(s.pending).toEqual([]);
		});

		it("stays pending through a load that was out before the answer, and goes with the next", () => {
			const before = [loaded(0, LANE), ask("w1", lane), {type: "moved"} as const];
			const half = steps(...before, answered("w1", lane, 1), loaded(4, [], [])).state;
			expect(statusOf(half)).toBe("4 open, 0 closed; areas: lane");
			const whole = steps(
				...before,
				answered("w1", lane, 1),
				loaded(4, [], []),
				loadedBroken(4, [BROKEN], 5),
			).state;
			expect(statusOf(whole)).toBe("4 open, 0 closed");
			expect(half.pending).toEqual([{_tag: "area_made", area: 1, name: "lane"}]);
			expect(whole.pending).toEqual([]);
		});
	});
});
