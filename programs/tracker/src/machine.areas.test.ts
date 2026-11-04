import {replay} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika-old";
import type {AreaEntry} from "@kampus/pipeline/tickets/area";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {load, shownOf, type Tracker, tracker} from "./machine.ts";
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
