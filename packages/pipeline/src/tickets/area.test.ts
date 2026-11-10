import type {Row, Writer} from "@kampus/fabrika-old";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	AREAS,
	type AreaEntry,
	AreaFact,
	AreaName,
	AreaNumber,
	type Areas,
	areaRefused,
	areasOf,
	liveOf,
	readAreaRow,
	suggestedName,
	suggestionsOf,
} from "./area.ts";
import type {Ticket} from "./ticket.ts";

// Areas PR 1, today's version (docs/direction/areas.md, the plan's a1, a2 and a5): the project's
// areas on their own stream, folded into the live ones and where each merged one went, and the
// suggestions a person picks the first ones from. Pure: no ledger here.
//
//   area_made {area: 1, name: "pipeline"}, area_made {area: 2, name: "lane"}, area_merged {area: 2, into: 1}
//   areasOf(...)   {areas: {live: {1: "pipeline"}, into: {2: 1}}, problems: []}
//   liveOf(areas, 2)   1

const owner: Writer = {kind: "user", id: "owner"};

type Fact = typeof AreaFact.Type;
type Made = Extract<Fact, {readonly _tag: "area_made"}>;

// made up: the plan names `AreaEntry` but not its keys. These are a ticket `Entry`'s, less `ticket`.
const entriesOf = (facts: readonly Fact[]): readonly AreaEntry[] =>
	facts.map((fact, i) => ({pos: i + 1, by: owner, at: (i + 1) * 1000, fact}));

const made = (area: number, name: string, suggested?: Made["suggested"]): Fact => ({
	_tag: "area_made",
	area,
	name,
	...(suggested === undefined ? {} : {suggested}),
});

const renamed = (area: number, name: string): Fact => ({_tag: "area_renamed", area, name});
const merged = (area: number, into: number): Fact => ({_tag: "area_merged", area, into});

/** A map's pairs, smallest key first, so two maps compare by what they hold. */
const pairs = <V>(map: ReadonlyMap<number, V>): readonly (readonly [number, V])[] =>
	[...map].sort(([a], [b]) => a - b);

describe("an area's facts", () => {
	it("are kept under the stream `tracker/areas`", () => {
		expect(AREAS).toBe("tracker/areas");
	});

	it("number an area from 1, a whole number", () => {
		const ok = Schema.is(AreaNumber);
		expect([1, 2, 14].map(ok)).toEqual([true, true, true]);
		expect([0, -1, 1.5].map(ok)).toEqual([false, false, false]);
	});

	it("name an area with 1 to 32 characters and no space at either end", () => {
		const ok = Schema.is(AreaName);
		expect(["pipeline", "lane work", "a", "x".repeat(32)].map(ok)).toEqual([
			true,
			true,
			true,
			true,
		]);
		expect(["", " pipeline", "pipeline ", "x".repeat(33)].map(ok)).toEqual([
			false,
			false,
			false,
			false,
		]);
	});

	it("read with `_tag`, and a ticket's fact is not one", () => {
		const decode = Schema.decodeUnknownOption(AreaFact);
		expect(
			decode({
				_tag: "area_made",
				area: 1,
				name: "pipeline",
				suggested: {_tag: "titles", word: "lane", tickets: 21},
			})._tag,
		).toBe("Some");
		expect(
			decode({
				_tag: "area_made",
				area: 2,
				name: "app",
				suggested: {_tag: "folder", path: "apps/fabrika"},
			})._tag,
		).toBe("Some");
		expect(decode({_tag: "area_merged", area: 3, into: 1})._tag).toBe("Some");
		expect(decode({type: "filed", title: "Login fails", body: ""})._tag).toBe("None");
		expect(decode({_tag: "area_made", area: 0, name: "pipeline"})._tag).toBe("None");
	});
});

// ---------------------------------------------------------------- a1: what the fold keeps

/**
 * The fold as the note says it, written plainly: the model the law holds `areasOf` to. A made area
 * takes the next number; a name is taken when another live area has it, ignoring case; a rename or
 * merge needs a live area; a merge goes into another live area. Anything else is refused, and the
 * areas stay as they were.
 *
 * The test writer's reading where the note is silent: a merged area's old name is free again, and
 * a merge into a merged area is refused (the menu offers only live ones).
 */
const model = (facts: readonly Fact[]) => {
	const live = new Map<number, string>();
	const into = new Map<number, number>();
	let refused = 0;
	const taken = (name: string, but?: number) =>
		[...live].some(([n, other]) => n !== but && other.toLowerCase() === name.toLowerCase());
	for (const fact of facts) {
		switch (fact._tag) {
			case "area_made":
				if (fact.area !== live.size + into.size + 1 || taken(fact.name)) refused++;
				else live.set(fact.area, fact.name);
				break;
			case "area_renamed":
				if (!live.has(fact.area) || taken(fact.name, fact.area)) refused++;
				else live.set(fact.area, fact.name);
				break;
			case "area_merged":
				if (fact.area === fact.into || !live.has(fact.area) || !live.has(fact.into)) refused++;
				else {
					live.delete(fact.area);
					into.set(fact.area, fact.into);
				}
				break;
		}
	}
	return {live, into, refused};
};

const NAMES = ["pipeline", "Pipeline", "app", "lane", "desk", "lane work"] as const;
const number = fc.integer({min: 1, max: 5});
const name = fc.constantFrom(...NAMES);

/** Any fact, from a few numbers and names, so numbers clash and names repeat often. */
const anyFact: fc.Arbitrary<Fact> = fc.oneof(
	{arbitrary: fc.tuple(number, name).map(([a, n]) => made(a, n)), weight: 3},
	{arbitrary: fc.tuple(number, name).map(([a, n]) => renamed(a, n)), weight: 1},
	{arbitrary: fc.tuple(number, number).map(([a, b]) => merged(a, b)), weight: 2},
);

/**
 * A history that mostly fits: areas 1 to `k` made in order under names of their own, then merges and
 * renames among them, some of which still do not fit (a merge of one merged before, into itself).
 */
const mostlyFits: fc.Arbitrary<readonly Fact[]> = fc.integer({min: 1, max: 6}).chain((k) =>
	fc
		.array(
			fc.oneof(
				fc
					.tuple(fc.integer({min: 1, max: k}), fc.integer({min: 1, max: k}))
					.map(([a, b]) => merged(a, b)),
				fc.tuple(fc.integer({min: 1, max: k}), name).map(([a, n]) => renamed(a, n)),
			),
			{maxLength: 10},
		)
		.map((later) => [...Array.from({length: k}, (_, i) => made(i + 1, `area ${i + 1}`)), ...later]),
);

const anyHistory = fc.oneof(fc.array(anyFact, {maxLength: 14}), mostlyFits);

describe("areasOf (a1)", () => {
	it("keeps what fits and refuses the rest, one problem each, for any list of facts", () => {
		fc.assert(
			fc.property(anyHistory, (facts) => {
				const want = model(facts);
				const {areas, problems} = areasOf(entriesOf(facts));
				expect(pairs(areas.live)).toEqual(pairs(want.live));
				expect(pairs(areas.into)).toEqual(pairs(want.into));
				expect(problems).toHaveLength(want.refused);
			}),
			{numRuns: 300},
		);
	});

	it("folds the note's example: a merge moves the number, a rename keeps it", () => {
		const {areas, problems} = areasOf(
			entriesOf([
				made(1, "pipeline", {_tag: "titles", word: "lane", tickets: 21}),
				made(2, "app", {_tag: "folder", path: "apps/fabrika"}),
				made(3, "lane"),
				merged(3, 1),
				renamed(2, "desk"),
			]),
		);
		expect(problems).toEqual([]);
		expect(pairs(areas.live)).toEqual([
			[1, "pipeline"],
			[2, "desk"],
		]);
		expect(pairs(areas.into)).toEqual([[3, 1]]);
	});

	it.each([
		["a number out of order", [made(2, "pipeline")]],
		["a number made twice", [made(1, "pipeline"), made(1, "app")]],
		["a name taken, in another case", [made(1, "pipeline"), made(2, "Pipeline")]],
		["a rename onto a name taken", [made(1, "pipeline"), made(2, "app"), renamed(2, "PIPELINE")]],
		["a rename of an area never made", [made(1, "pipeline"), renamed(2, "app")]],
		[
			"a rename of a merged area",
			[made(1, "pipeline"), made(2, "lane"), merged(2, 1), renamed(2, "x")],
		],
		["a merge of an area never made", [made(1, "pipeline"), merged(2, 1)]],
		["a merge into an area never made", [made(1, "pipeline"), merged(1, 2)]],
		["a merge into itself", [made(1, "pipeline"), merged(1, 1)]],
		[
			"a merge of a merged area",
			[made(1, "pipeline"), made(2, "lane"), merged(2, 1), merged(2, 1)],
		],
	] as const)("refuses %s, into problems, and keeps the rest", (_, facts) => {
		const {problems} = areasOf(entriesOf(facts));
		expect(problems).toHaveLength(1);
	});
});

// ---------------------------------------------------------------- a2: where a merged area went

/** Follows `into` from `n` at most `into.size` steps: a live area, or null when it never gets to one. */
const walk = (areas: Areas, n: number): number | null => {
	let at = n;
	for (let steps = 0; steps <= areas.into.size; steps++) {
		if (areas.live.has(at)) return at;
		const next = areas.into.get(at);
		if (next === undefined) return null;
		at = next;
	}
	return null;
};

describe("liveOf (a2)", () => {
	it("ends every area ever made on a live one, and a live one on itself", () => {
		fc.assert(
			fc.property(anyHistory, (facts) => {
				const {areas} = areasOf(entriesOf(facts));
				// Checked first, by a bounded walk, so a loop fails here instead of hanging `liveOf`.
				for (const n of areas.into.keys()) expect(walk(areas, n)).not.toBeNull();
				for (const n of areas.live.keys()) expect(liveOf(areas, n)).toBe(n);
				for (const [n, next] of areas.into) {
					const end = liveOf(areas, n);
					expect(areas.live.has(end)).toBe(true);
					expect(end).toBe(liveOf(areas, next));
				}
			}),
			{numRuns: 300},
		);
	});

	it("can never loop: from any merged area, `into` reaches a live one", () => {
		fc.assert(
			fc.property(anyHistory, (facts) => {
				const {areas} = areasOf(entriesOf(facts));
				for (const n of areas.into.keys()) expect(walk(areas, n)).not.toBeNull();
			}),
			{numRuns: 300},
		);
	});

	it("follows a chain of merges to its end", () => {
		const {areas} = areasOf(
			entriesOf([
				made(1, "pipeline"),
				made(2, "lane"),
				made(3, "lane work"),
				merged(3, 2),
				merged(2, 1),
			]),
		);
		expect([3, 2].map((n) => walk(areas, n))).toEqual([1, 1]);
		expect([liveOf(areas, 3), liveOf(areas, 2), liveOf(areas, 1)]).toEqual([1, 1, 1]);
	});

	it("refuses the merge that would close a loop: 1 into 3, once 3 went into 1", () => {
		const {areas, problems} = areasOf(
			entriesOf([
				made(1, "pipeline"),
				made(2, "lane"),
				made(3, "lane work"),
				merged(3, 1),
				merged(1, 3),
			]),
		);
		expect(problems).toHaveLength(1);
		expect(walk(areas, 3)).toBe(1);
		expect(liveOf(areas, 3)).toBe(1);
	});
});

// ---------------------------------------------------------------- a5: suggestions, never facts

const WORDS = ["Lane", "lane", "LANE", "Tracker", "pipeline", "Docs"] as const;
const SECOND = ["", " tests", " checks"] as const;

/**
 * A title: a word and maybe a second one before a colon, as "Lane tests: the build fails", or no
 * colon at all, as "Login fails".
 */
const title = fc.oneof(
	{
		arbitrary: fc
			.tuple(fc.constantFrom(...WORDS), fc.constantFrom(...SECOND))
			.map(([w, s]) => `${w}${s}: something broke`),
		weight: 4,
	},
	{arbitrary: fc.constantFrom("Login fails", "Docs typo", "lane is slow"), weight: 1},
);

const ticketsOf = (rows: readonly (readonly [string, Ticket["state"]])[]): readonly Ticket[] =>
	rows.map(([t, state], i) => ({number: i + 1, title: t, state, timeline: []}));

const anyTickets = fc
	.array(fc.tuple(title, fc.constantFrom<Ticket["state"]>("open", "open", "closed")), {
		maxLength: 30,
	})
	.map(ticketsOf);

/** Some live areas, by name, so a suggestion can clash with one. */
const anyAreas: fc.Arbitrary<Areas> = fc
	.subarray(["lane", "Tracker", "desk"])
	.map((names) => ({live: new Map(names.map((n, i) => [i + 1, n])), into: new Map()}));

const NO_AREAS: Areas = {live: new Map(), into: new Map()};

/**
 * What the note says the titles suggest: the first word before a colon, in lower case, of three or
 * more open titles, with how many share it, less every live area's name, ignoring case.
 */
const wordsWanted = (tickets: readonly Ticket[], areas: Areas) => {
	const counts = new Map<string, number>();
	for (const t of tickets) {
		if (t.state !== "open" || !t.title.includes(":")) continue;
		const word = t.title.split(":")[0]?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
		if (word !== "") counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	const names = new Set([...areas.live.values()].map((n) => n.toLowerCase()));
	return [...counts]
		.filter(([word, n]) => n >= 3 && !names.has(word))
		.sort(([a], [b]) => a.localeCompare(b));
};

const wordsGot = (tickets: readonly Ticket[], areas: Areas) =>
	// made up: the plan gives `suggestionsOf(tickets, folders)`; "never an area that exists" needs the areas too.
	suggestionsOf(tickets, [], areas)
		.flatMap((s) => (s._tag === "titles" ? [[s.word, s.tickets] as const] : []))
		.sort(([a], [b]) => a.localeCompare(b));

describe("suggestionsOf (a5)", () => {
	it("gives each word three or more open titles share, once, with its count, and no area that exists", () => {
		fc.assert(
			fc.property(anyTickets, anyAreas, (tickets, areas) => {
				expect(wordsGot(tickets, areas)).toEqual(wordsWanted(tickets, areas));
			}),
			{numRuns: 300},
		);
	});

	it("counts `Lane`, `Lane tests` and `Lane checks` as one word, lane", () => {
		const tickets = ticketsOf([
			["Lane: a run hangs", "open"],
			["Lane tests: one is flaky", "open"],
			["Lane checks: red on main", "open"],
			["Login fails", "open"],
		]);
		expect(wordsGot(tickets, NO_AREAS)).toEqual([["lane", 3]]);
	});

	it("does not count a closed ticket, and two titles are not enough", () => {
		const tickets = ticketsOf([
			["Lane: a run hangs", "open"],
			["Lane tests: one is flaky", "open"],
			["Lane checks: red on main", "closed"],
		]);
		expect(wordsGot(tickets, NO_AREAS)).toEqual([]);
	});

	it("offers each folder it is given", () => {
		const got = suggestionsOf(ticketsOf([]), ["programs/tracker", "apps/fabrika"], NO_AREAS);
		const paths = got.flatMap((s) => (s._tag === "folder" ? [s.path] : []));
		expect(paths.sort()).toEqual(["apps/fabrika", "programs/tracker"]);
	});

	// Round 2, from the mutation step: the order shown, and one suggestion per name.
	it("puts the words most first, a tie by name, then the folders in the order given", () => {
		const tickets = ticketsOf([
			...["a", "b", "c"].map((x): [string, Ticket["state"]] => [`Lane: ${x}`, "open"]),
			...["a", "b", "c", "d"].map((x): [string, Ticket["state"]] => [`Desk: ${x}`, "open"]),
			...["a", "b", "c"].map((x): [string, Ticket["state"]] => [`App: ${x}`, "open"]),
		]);
		expect(suggestionsOf(tickets, ["programs/tracker", "apps/fabrika"], NO_AREAS)).toEqual([
			{_tag: "titles", word: "desk", tickets: 4},
			{_tag: "titles", word: "app", tickets: 3},
			{_tag: "titles", word: "lane", tickets: 3},
			{_tag: "folder", path: "programs/tracker"},
			{_tag: "folder", path: "apps/fabrika"},
		]);
	});

	it("gives one suggestion per name: a folder whose name a word or an earlier folder has is left out", () => {
		const tickets = ticketsOf(
			["a", "b", "c"].map((x): [string, Ticket["state"]] => [`Tracker: ${x}`, "open"]),
		);
		expect(
			suggestionsOf(tickets, ["programs/tracker", "apps/fabrika", "packages/Fabrika"], NO_AREAS),
		).toEqual([
			{_tag: "titles", word: "tracker", tickets: 3},
			{_tag: "folder", path: "apps/fabrika"},
		]);
	});

	it("leaves out a folder whose name a live area has, ignoring case", () => {
		const areas: Areas = {live: new Map([[1, "Fabrika"]]), into: new Map()};
		expect(suggestionsOf(ticketsOf([]), ["apps/fabrika", "apps/desk"], areas)).toEqual([
			{_tag: "folder", path: "apps/desk"},
		]);
	});

	// Round 4, the review's finding 5: a suggestion a person ticks must make an area the fold takes,
	// so its name is one `AreaName` lets through.
	it("never suggests a name `AreaName` refuses, from a title's word or a folder", () => {
		const part = fc.oneof(
			fc.constantFrom("tracker", "desk", " desk", "desk "),
			fc.integer({min: 30, max: 34}).map((n) => "x".repeat(n)),
		);
		const words = fc.oneof(
			fc.constantFrom("Lane", "Desk"),
			fc.integer({min: 30, max: 34}).map((n) => "w".repeat(n)),
		);
		const tickets = fc
			.array(words, {maxLength: 6})
			.map((ws) =>
				ticketsOf(
					ws.flatMap((w) =>
						["a", "b", "c"].map((x): [string, Ticket["state"]] => [`${w}: ${x}`, "open"]),
					),
				),
			);
		const folders = fc.array(
			fc.tuple(fc.constantFrom("apps", "programs"), part).map(([under, p]) => `${under}/${p}`),
			{maxLength: 6},
		);
		fc.assert(
			fc.property(tickets, folders, anyAreas, (t, f, areas) => {
				for (const s of suggestionsOf(t, f, areas))
					expect(Schema.is(AreaName)(suggestedName(s)), JSON.stringify(s)).toBe(true);
			}),
			{numRuns: 300},
		);
	});

	it("leaves out a folder or a word over 32 characters, or with a space at an end, and keeps the rest", () => {
		const long = "x".repeat(33);
		const word = "w".repeat(33);
		const tickets = ticketsOf(
			["a", "b", "c"].map((x): [string, Ticket["state"]] => [`${word}: ${x}`, "open"]),
		);
		expect(
			suggestionsOf(
				tickets,
				[`apps/${long}`, `apps/${"y".repeat(32)}`, "apps/desk ", "apps/tracker"],
				NO_AREAS,
			),
		).toEqual([
			{_tag: "folder", path: `apps/${"y".repeat(32)}`},
			{_tag: "folder", path: "apps/tracker"},
		]);
	});
});

describe("suggestedName", () => {
	it("is the word for the titles, and a folder's last part", () => {
		expect(suggestedName({_tag: "titles", word: "lane", tickets: 3})).toBe("lane");
		expect(suggestedName({_tag: "folder", path: "apps/fabrika"})).toBe("fabrika");
		expect(suggestedName({_tag: "folder", path: "apps/fabrika/"})).toBe("fabrika");
		expect(suggestedName({_tag: "folder", path: "desk"})).toBe("desk");
	});
});

describe("an area fact from an agent", () => {
	const agent: Writer = {kind: "agent", id: "triage", for: "owner"};
	it.each([
		["area_made", [made(1, "lane")], made(2, "desk")],
		["area_renamed", [made(1, "lane")], {_tag: "area_renamed", area: 1, name: "desk"} as Fact],
		[
			"area_merged",
			[made(1, "lane"), made(2, "desk")],
			{_tag: "area_merged", area: 2, into: 1} as Fact,
		],
	])(
		"is kept out of the fold: an agent's %s changes nothing, one problem says so",
		(tag, before, fact) => {
			const people = entriesOf(before);
			const {areas, problems} = areasOf([
				...people,
				{pos: people.length + 1, by: agent, at: 0, fact},
			]);
			expect(areas).toEqual(areasOf(people).areas);
			expect(problems).toEqual([
				`row ${people.length + 1} on the areas: ${tag} written by an agent, but only a person writes it`,
			]);
		},
	);
});

describe("why a fact does not fit (areaRefused)", () => {
	const two: Areas = {
		live: new Map([
			[1, "lane"],
			[3, "desk"],
		]),
		into: new Map([[2, 1]]),
	};
	it.each([
		[made(3, "app"), "area 3 made, but the next number is 4"],
		[made(4, ""), "an area's name is 1 to 32 characters, with no space at either end"],
		[made(4, " app"), "an area's name is 1 to 32 characters, with no space at either end"],
		[made(4, "x".repeat(33)), "an area's name is 1 to 32 characters, with no space at either end"],
		[made(4, "Lane"), 'the area "lane" has that name already'],
		[made(4, "app"), null],
		[{_tag: "area_renamed", area: 2, name: "app"}, "a rename of area 2, which is not live"],
		[{_tag: "area_renamed", area: 1, name: "DESK"}, 'the area "desk" has that name already'],
		[{_tag: "area_renamed", area: 1, name: "Lane"}, null],
		[{_tag: "area_merged", area: 1, into: 1}, "area 1 merged into itself"],
		[{_tag: "area_merged", area: 2, into: 1}, "a merge of area 2, which is not live"],
		[{_tag: "area_merged", area: 1, into: 2}, "a merge into area 2, which is not live"],
		[{_tag: "area_merged", area: 3, into: 1}, null],
	] as const)("%o: %s", (fact, why) => {
		expect(areaRefused(two, fact as Fact)).toBe(why);
	});
});

describe("an area row read back (readAreaRow)", () => {
	const row = (data: unknown, kind = "area_made"): Row => ({
		pos: 4,
		stream: `${AREAS}/inbox`,
		rev: 1,
		writer: "user:owner",
		kind,
		at: 1000,
		data: JSON.stringify(data),
		id: "w1",
	});

	it.each([
		{_tag: "folder", path: "apps/fabrika"},
		{_tag: "titles", word: "lane", tickets: 21},
	] as const)("keeps a suggestion whole: %o", (suggested) => {
		const fact = {...made(1, "fabrika"), suggested};
		expect(readAreaRow(row(fact))).toStrictEqual({
			_tag: "entry",
			entry: {pos: 4, by: owner, at: 1000, fact},
		});
	});

	it("is broken when its data is not an area fact, or is kept under another kind", () => {
		expect(readAreaRow(row("lane"))).toEqual({
			_tag: "broken",
			why: "row 4 on the areas: its data is not an area fact",
		});
		expect(readAreaRow(row(made(1, "lane"), "area_renamed"))).toEqual({
			_tag: "broken",
			why: "row 4 on the areas: an area_made fact kept as area_renamed",
		});
	});

	it("is another stream's when it is not on the areas' inbox", () => {
		expect(readAreaRow({...row(made(1, "lane")), stream: "tracker/ticket/1/inbox"})).toEqual({
			_tag: "other",
		});
	});

	// Round 4, the review's finding 7: a union we define is told apart by `_tag`, which Effect Schema
	// writes, never by a hand-written `kind`.
	it("tells its three cases apart by `_tag`, and has no `kind`", () => {
		const reads = [
			readAreaRow(row(made(1, "lane"))),
			readAreaRow(row("lane")),
			readAreaRow({...row(made(1, "lane")), stream: "tracker/ticket/1/inbox"}),
		];
		expect(reads.map((r) => (r as {readonly _tag?: unknown})._tag)).toEqual([
			"entry",
			"broken",
			"other",
		]);
		for (const r of reads) expect(r).not.toHaveProperty("kind");
	});
});
