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
// output." The tracker's line in tsh is its `statusOf`.
// made up: how the line names the areas. Only that each live one's name is in it is held here.
describe("after Enter on the onboarding, the areas made show (round 1c)", () => {
	it("names each area made in the tracker's line in tsh, once the ledger has them", () => {
		const ticked: readonly Write[] = [
			{kind: "make_area", name: "lane", suggested: {_tag: "titles", word: "lane", tickets: 3}},
			{kind: "make_area", name: "apps/fabrika", suggested: {_tag: "folder", path: "apps/fabrika"}},
		];
		// Enter: one write each, in the order ticked; each save answers with its area.
		const answered = (i: number, area: number): Msg =>
			save.ok(save({id: `w${i}`, write: ticked[i] as Write, next: 5}), {area}, 0);
		const before = steps(loaded(0, LANE), foldersOk(["apps/fabrika"])).state;
		expect(statusOf(before)).not.toMatch(/lane|apps\/fabrika/);
		const after = steps(
			loaded(0, LANE),
			foldersOk(["apps/fabrika"]),
			...ticked.map((write, i): Msg => ({type: "write", id: `w${i}`, write})),
			answered(0, 1),
			answered(1, 2),
			{type: "moved"},
			loaded(4, [], [made(5, 1, "lane"), made(6, 2, "apps/fabrika")]),
		).state;
		expect(after.saving).toEqual([]);
		expect(onboardingOf(after)).toBeNull();
		expect(statusOf(after)).toContain("lane");
		expect(statusOf(after)).toContain("apps/fabrika");
	});
});
