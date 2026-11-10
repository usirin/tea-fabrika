// p28, who belongs (docs/plan/tier-1-detail.md, "Properties", widened 2026-11-06; P9's plan writes
// it out), for `coordination/members.ts`: the grant tree, equal device roots, one live sheet, and
// the limits. Written before the module (Tier 1, P9, ticket 236).
//
// The shape these tests hold the module to, from the plan's "The shape" and flags 5 and 7:
// - `foldMembers(facts)` folds `founded`, `granted`, `denied`, `revoked` and `added` in order into
//   `Members`: `person` and `name` from the first `founded`, `keys` as key -> {rank, live, under},
//   and `spent`, the recovery keys that signed once.
// - `founded`: each of `keys` a `person` root, `window` under `keys[0]`. A second `founded` changes
//   nothing.
// - `granted`, signed by a live `person` key of `grant.for`: the key, rank from `as`, under the
//   signer. `revoked`, signed by a live `person` key of `revoke.for`, naming any of that person's
//   keys but its own: that key not live, forever.
// - `added`, signed by a live `person` key: `adds.person` makes a root and its window under it;
//   `adds.recovery` makes a recovery root and ends every other live sheet. Signed by a live, unspent
//   `recovery` key: `adds.person` only, then the signer is spent. `drops` stop forever.
// - `denied` changes nothing. A window, agent, recovery or spent key signing a grant or a revoke
//   changes nothing. A dropped key never comes back.
// - `admitted(members, key)`: rank `window` or `agent`, live, and every key above it live; anything
//   else is `{why: "not_granted"}`.
// Signatures are not checked here, so `signed` values are opaque text with the signer named.
import {describe, expect, it} from "@effect/vitest";
import {Result, Schema} from "effect";
import * as fc from "fast-check";
import {
	admitted,
	allows,
	EMPTY,
	foldMembers,
	type MemberFact,
	type Members,
	Saw,
	Took,
} from "./members.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 300;

// The ids are in the open id study's TypeID shape; the prefixes are made up (the plan's "Ids").
const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const OTHER = "person_01m6v5270hg0000000000000zz"; // some other person, on the same ledger
const NAME = "home";
const TO = "ledger:home";
const SENT = "2026-11-07T21:10:01.204Z";

const SAW = {
	code: "4417",
	label: "Firefox on a Mac",
	where: "Istanbul",
	how: "compare",
	check: "touch",
	has: ["window"],
} as const;

const TOOK = {label: "Mac A", where: "Istanbul", how: "panel", check: "touch"} as const;

const addSaw = (how: "sheet" | "recovery" | "device", old: "lost" | "kept" | null = null) => ({
	how,
	check: "touch" as const,
	where: "Istanbul",
	has: [],
	typed: how === "sheet",
	kept: how === "sheet" ? ("print" as const) : null,
	old,
});

const signed = (signer: string) => ({
	text: `signed by ${signer}`,
	armored: "-----SSHSIG-----",
	signer,
});

let made = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++made).padStart(26, "0")}`;

const founded = (
	keys: ReadonlyArray<string> = ["pA"],
	window: string | null = "wA",
): MemberFact => ({
	_tag: "founded",
	id: P,
	name: NAME,
	keys: [...keys],
	window,
});

const granted = (
	signer: string,
	key: string,
	over: {readonly as?: "window" | "agent"; readonly for?: string; readonly id?: string} = {},
): MemberFact => ({
	_tag: "granted",
	grant: {
		id: over.id ?? nextId("grant"),
		key,
		for: over.for ?? P,
		to: TO,
		as: over.as ?? "window",
		saw: SAW,
		sentAt: SENT,
	},
	signed: signed(signer),
});

const revoked = (signer: string, key: string, over: {readonly for?: string} = {}): MemberFact => ({
	_tag: "revoked",
	revoke: {id: nextId("revoke"), key, for: over.for ?? P, to: TO, saw: TOOK, sentAt: SENT},
	signed: signed(signer),
});

const addedDevice = (
	signer: string,
	key: string,
	window: string,
	over: {
		readonly drops?: ReadonlyArray<string>;
		readonly old?: "lost" | "kept" | null;
		readonly for?: string;
	} = {},
): MemberFact => ({
	_tag: "added",
	add: {
		id: nextId("add"),
		for: over.for ?? P,
		to: TO,
		adds: {_tag: "person", key, window},
		drops: [...(over.drops ?? [])],
		saw: addSaw(over.old == null ? "device" : "recovery", over.old ?? null),
		sentAt: SENT,
	},
	signed: signed(signer),
});

const addedSheet = (
	signer: string,
	key: string,
	over: {readonly drops?: ReadonlyArray<string>; readonly for?: string} = {},
): MemberFact => ({
	_tag: "added",
	add: {
		id: nextId("add"),
		for: over.for ?? P,
		to: TO,
		adds: {_tag: "recovery", key, v: 1},
		drops: [...(over.drops ?? [])],
		saw: addSaw("sheet"),
		sentAt: SENT,
	},
	signed: signed(signer),
});

const denied = (key: string, by: string): MemberFact => ({
	_tag: "denied",
	id: nextId("deny"),
	key,
	saw: SAW,
	by,
});

/** Members as plain data, so two folds compare whatever order their maps were filled in. */
const view = (m: Members) => ({
	person: m.person,
	name: m.name,
	keys: [...m.keys.entries()]
		.map(([key, k]) => ({key, rank: k.rank, live: k.live, under: k.under}))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
	spent: [...m.spent].sort(),
});

const isIn = (m: Members, key: string): boolean => "as" in admitted(m, key);

const liveWith = (m: Members, rank: string): ReadonlyArray<string> =>
	[...m.keys.entries()]
		.filter(([key, k]) => k.rank === rank && k.live && !m.spent.has(key))
		.map(([key]) => key)
		.sort();

/** Recovery keys that are live and not spent: the sheets that still work. */
const liveSheets = (m: Members) => liveWith(m, "recovery");
const livePersons = (m: Members) => liveWith(m, "person");

/** Every key above `key` live, walking `under` to a root. A loop counts as not live. */
const chainLive = (m: Members, key: string): boolean => {
	let at = m.keys.get(key)?.under ?? null;

	for (let step = 0; at !== null; step++) {
		const above = m.keys.get(at);

		if (above === undefined || !above.live || step > m.keys.size) {
			return false;
		}

		at = above.under;
	}

	return true;
};

// ---- Random fact lists, over a small pool of keys so facts often touch the same keys ----

const PERSONS = ["pA", "pB", "pC", "pD"] as const;
const WINDOWS = ["wA", "wB", "wC", "wD"] as const; // WINDOWS[i] is PERSONS[i]'s window
const LEAVES = ["t1", "t2", "t3", "g1", "g2"] as const; // tabs and agents, let in by a grant
const SHEETS = ["r1", "r2", "r3"] as const;
const STRANGER = "x1";
const ALL: ReadonlyArray<string> = [...PERSONS, ...WINDOWS, ...LEAVES, ...SHEETS, STRANGER];
// Keys no random list names, for a step a test adds on top.
const FRESH_LEAF = "t9";

const FRESH_DEVICES = [
	["pY", "wY"],
	["pZ", "wZ"],
] as const;

const signer = fc.oneof(
	{weight: 6, arbitrary: fc.constantFrom(...PERSONS)},
	{weight: 2, arbitrary: fc.constantFrom(...SHEETS)},
	{weight: 2, arbitrary: fc.constantFrom(...WINDOWS, ...LEAVES, STRANGER)},
);

const forWhom = fc.oneof(
	{weight: 9, arbitrary: fc.constant(P)},
	{weight: 1, arbitrary: fc.constant(OTHER)},
);

const anyKey = fc.constantFrom(...ALL);
const drops = (most: number) => fc.uniqueArray(anyKey, {maxLength: most});

const laterFact: fc.Arbitrary<() => MemberFact> = fc.oneof(
	{
		weight: 6,
		arbitrary: fc
			.record({
				by: signer,
				key: fc.constantFrom(...LEAVES),
				as: fc.constantFrom("window", "agent"),
				for: forWhom,
			})
			.map((g) => () => granted(g.by, g.key, {as: g.as, for: g.for})),
	},
	{
		weight: 3,
		arbitrary: fc
			.record({by: signer, key: anyKey, for: forWhom})
			.map((r) => () => revoked(r.by, r.key, {for: r.for})),
	},
	{
		weight: 3,
		arbitrary: fc
			.record({
				by: signer,
				pair: fc.integer({min: 0, max: 3}),
				drops: drops(2),
				old: fc.constantFrom(null, "lost", "kept"),
				for: forWhom,
			})
			.map(
				(a) => () =>
					addedDevice(a.by, PERSONS[a.pair] ?? "pA", WINDOWS[a.pair] ?? "wA", {
						drops: a.drops,
						old: a.old,
						for: a.for,
					}),
			),
	},
	{
		weight: 2,
		arbitrary: fc
			.record({by: signer, key: fc.constantFrom(...SHEETS), drops: drops(1), for: forWhom})
			.map((s) => () => addedSheet(s.by, s.key, {drops: s.drops, for: s.for})),
	},
	{
		weight: 1,
		arbitrary: fc.record({key: anyKey, by: signer}).map((d) => () => denied(d.key, d.by)),
	},
	{
		weight: 1,
		arbitrary: fc
			.record({keys: fc.constantFrom(["pC"], ["pD", "pB"]), window: fc.constantFrom("wC", null)})
			.map((f) => (): MemberFact => ({
				_tag: "founded",
				id: OTHER,
				name: "another",
				keys: f.keys,
				window: f.window,
			})),
	},
);

const first = fc
	.record({
		keys: fc.constantFrom(["pA"], ["pA", "pB"], ["pA", "pB", "pC"]),
		window: fc.constantFrom("wA", null),
	})
	.map((f) => founded(f.keys, f.window));

/** A whole history: `founded` first, then up to 30 facts of any kind. Each fact gets its own id. */
const history = fc
	.tuple(first, fc.array(laterFact, {maxLength: 30}))
	.map(([head, rest]) => [head, ...rest.map((make) => make())]);

/** A history with two devices from the start, so tests that need two live devices often get them. */
const twoDevices = fc
	.tuple(fc.constantFrom(["pA", "pB"], ["pA", "pB", "pC"]), fc.array(laterFact, {maxLength: 20}))
	.map(([keys, rest]) => [founded(keys, "wA"), ...rest.map((make) => make())]);

const prefixes = (facts: ReadonlyArray<MemberFact>) =>
	facts.map((_, i) => foldMembers(facts.slice(0, i + 1)));

// Distinct from the fixed roots and windows used around each generated subject.
const leafKey = fc
	.string()
	.filter(
		(key) =>
			![...PERSONS, ...WINDOWS, ...SHEETS, "g1", "t2", "t3", "pY", "wY", "pZ", "wZ"].includes(key),
	);

const sheetKey = fc
	.string()
	.filter((key) => ![...PERSONS, ...WINDOWS, "r2", "pY", "wY", "pZ", "wZ"].includes(key));

const opts = <A>(example: A): fc.Parameters<[A]> => ({
	seed: SEED,
	numRuns: RUNS,
	includeErrorInReport: true,
	examples: [[example]],
});

describe("p28, recorded choices and founding limits", () => {
	it("admission and removal records accept link and an absent check", () => {
		fc.assert(
			fc.property(
				fc.record({
					code: fc.string(),
					label: fc.string(),
					where: fc.string(),
					has: fc.array(fc.string()),
				}),
				(fields) => {
					expect(Schema.is(Saw)({...fields, how: "link", check: "touch"})).toBe(true);
					expect(Schema.is(Saw)({...fields, how: "compare", check: "none"})).toBe(true);
					expect(
						Schema.is(Took)({
							label: fields.label,
							where: fields.where,
							how: "panel",
							check: "none",
						}),
					).toBe(true);
				},
			),
			{seed: SEED, numRuns: RUNS},
		);
	});
	it("a founding window needs both its key and a first person key", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(
					fc.string().map((s) => `person:${s}`),
					{maxLength: 5},
				),
				fc.option(
					fc.string().map((s) => `window:${s}`),
					{nil: null},
				),
				(keys, window) => {
					const members = foldMembers([founded(keys, window)]);
					expect([...members.keys.keys()]).toEqual(
						window !== null && keys.length > 0 ? [...keys, window] : keys,
					);

					if (window !== null && keys.length > 0) {
						expect(members.keys.get(window)?.under).toBe(keys[0]);
					}
				},
			),
			{seed: SEED, numRuns: RUNS},
		);
	});
	it("a fresh fact can name the same live recovery key without changing its rank", () => {
		fc.assert(
			fc.property(
				fc.string().map((s) => `sheet:${s}`),
				(key) => {
					const start = Result.getOrThrow(allows(EMPTY, founded()));
					const once = Result.getOrThrow(allows(start, addedSheet("pA", key)));
					const twice = allows(once, addedSheet("pA", key));
					expect(Result.isSuccess(twice), "same live sheet may join again").toBe(true);

					if (Result.isSuccess(twice)) {
						expect(twice.success.members).toEqual(once.members);
					}
				},
			),
			{seed: SEED, numRuns: RUNS},
		);
	});
});

describe("p28, the traced history from the plan", () => {
	it("founding, two devices, a sheet, an agent, then Mac A lost and recovered with the sheet", () => {
		fc.assert(
			fc.property(leafKey, (tab) => {
				const facts = [
					founded(["pA"], "wA"),
					granted("pA", tab),
					addedDevice("pA", "pB", "wB"),
					granted("pB", "t2"),
					addedSheet("pB", "r1"),
					granted("pA", "g1", {as: "agent"}),
				];
				const before = foldMembers(facts);
				expect(before.person).toBe(P);
				expect(before.name).toBe(NAME);
				expect(livePersons(before)).toEqual(["pA", "pB"]);
				expect(before.keys.get("pB")?.under).toBeNull(); // a device is a root, never under another
				expect(before.keys.get("wB")).toEqual({rank: "window", live: true, under: "pB"});
				expect(before.keys.get(tab)).toEqual({rank: "window", live: true, under: "pA"});
				expect(before.keys.get("t2")).toEqual({rank: "window", live: true, under: "pB"});
				expect(before.keys.get("g1")).toEqual({rank: "agent", live: true, under: "pA"});
				expect(liveSheets(before)).toEqual(["r1"]);
				expect(admitted(before, "g1")).toEqual({key: "g1", person: P, as: "agent"});

				// A window key and an agent's key sign nothing that counts.
				const tried = [...facts, granted("wB", "t3"), revoked("g1", "pB")];
				expect(view(foldMembers(tried))).toEqual(view(before));

				const lost = addedDevice("r1", "pC", "wC", {drops: ["pA", "wA"], old: "lost"});
				const after = foldMembers([...tried, lost]);

				for (const out of ["pA", "wA", tab, "g1"]) {
					expect(isIn(after, out), out).toBe(false);
				}

				for (const kept of ["wB", "t2", "wC"]) {
					expect(isIn(after, kept), kept).toBe(true);
				}

				expect(livePersons(after)).toEqual(["pB", "pC"]);
				expect([...after.spent]).toEqual(["r1"]);
				expect(liveSheets(after)).toEqual([]);
				expect(after.person).toBe(P);
				expect(after.name).toBe(NAME);

				// The same sheet typed on Mac X: spent at the step before, so nothing.
				const stolen = foldMembers([...tried, lost, addedDevice("r1", "pX", "wX", {old: "lost"})]);
				expect(view(stolen)).toEqual(view(after));
				expect(admitted(after, "t2")).toEqual({key: "t2", person: P, as: "window"});
				expect(admitted(after, tab)).toEqual({why: "not_granted"});
				expect(admitted(after, "pC")).toEqual({why: "not_granted"});
			}),
			opts("t1"),
		);
	});
});

describe("p28, founding", () => {
	it("each founding key is a person root, and the window hangs under the first one (flag 7)", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.string(), {minLength: 3, maxLength: 12}),
				([one, two, window, ...rest]) => {
					const m = foldMembers([founded([one!, two!, ...rest], window!)]);
					expect(m.keys.get(one!)).toEqual({rank: "person", live: true, under: null});
					expect(m.keys.get(two!)).toEqual({rank: "person", live: true, under: null});

					for (const key of rest) {
						expect(m.keys.get(key)).toEqual({rank: "person", live: true, under: null});
					}

					expect(m.keys.get(window!)).toEqual({rank: "window", live: true, under: one});
					expect([...m.spent]).toEqual([]);
				},
			),
			opts(["pA", "pB", "wA"]),
		);
	});

	it("the founding window is admitted with no grant", () => {
		fc.assert(
			fc.property(
				fc.string().filter((key) => key !== "pA"),
				(window) => {
					expect(admitted(foldMembers([founded(["pA"], window)]), window)).toEqual({
						key: window,
						person: P,
						as: "window",
					});
				},
			),
			opts("wA"),
		);
	});

	it("a founding with no window admits nobody", () => {
		fc.assert(
			fc.property(fc.uniqueArray(fc.string()), (keys) => {
				const m = foldMembers([founded(keys, null)]);
				expect([...ALL, ...keys].filter((key) => isIn(m, key))).toEqual([]);
			}),
			opts(["pA"]),
		);
	});

	it("plant, a second founded accepted: any later founded, anywhere, changes nothing", () => {
		const second: MemberFact = {
			_tag: "founded",
			id: OTHER,
			name: "another",
			keys: ["pC"],
			window: "wC",
		};
		fc.assert(
			fc.property(
				fc.string().filter((key) => !["pA", "wA", "t1"].includes(key)),
				(window) => {
					const later = {...second, window};
					const once = foldMembers([founded(), granted("pA", "t1")]);
					const twice = foldMembers([founded(), later, granted("pA", "t1"), later]);
					expect(view(twice)).toEqual(view(once));
					expect(isIn(twice, window)).toBe(false);
				},
			),
			opts("wC"),
		);
		fc.assert(
			fc.property(history, fc.nat(), (facts, at) => {
				const i = 1 + (at % facts.length);
				const withSecond = [...facts.slice(0, i), second, ...facts.slice(i)];
				expect(view(foldMembers(withSecond))).toEqual(view(foldMembers(facts)));
				expect(foldMembers(withSecond).person).toBe(P);
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});
});

describe("p28, grants", () => {
	it("a good thing happens: a grant by a live person key admits that key, as what it says", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const m = foldMembers([founded(), granted("pA", key), granted("pA", "g1", {as: "agent"})]);
				expect(admitted(m, key)).toEqual({key, person: P, as: "window"});
				expect(admitted(m, "g1")).toEqual({key: "g1", person: P, as: "agent"});
			}),
			opts("t1"),
		);
		let ran = 0;
		fc.assert(
			fc.property(history, fc.nat(), (facts, pick) => {
				const before = foldMembers(facts);
				const signers = livePersons(before);
				const by = signers[pick % Math.max(1, signers.length)];

				if (by === undefined) {
					return;
				}

				ran++;
				const as = pick % 2 === 0 ? "window" : "agent";
				const after = foldMembers([...facts, granted(by, FRESH_LEAF, {as})]);
				expect(admitted(after, FRESH_LEAF)).toEqual({key: FRESH_LEAF, person: P, as});
				expect(after.keys.get(FRESH_LEAF)?.under).toBe(by);
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(RUNS / 2);
	});

	it("a grant for another person, or by a key nobody let in, changes nothing", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const base = [founded(), granted("pA", "t1")];
				const m = foldMembers(base);
				expect(view(foldMembers([...base, granted("pA", key, {for: OTHER})]))).toEqual(view(m));
				expect(view(foldMembers([...base, granted(STRANGER, key)]))).toEqual(view(m));
			}),
			opts("t2"),
		);
	});

	it("plant, an agent's approve accepted: a window, agent, recovery or spent key signs nothing", () => {
		fc.assert(
			fc.property(
				leafKey.filter((key) => key !== "t1"),
				(key) => {
					const base = [
						founded(["pA", "pB"], "wA"),
						granted("pA", "t1"),
						granted("pA", "g1", {as: "agent"}),
						addedSheet("pA", "r1"),
					];
					const m = foldMembers(base);

					for (const by of ["wA", "t1", "g1", "r1"]) {
						expect(view(foldMembers([...base, granted(by, key)])), `${by} grants`).toEqual(view(m));
						expect(view(foldMembers([...base, revoked(by, "pB")])), `${by} revokes`).toEqual(
							view(m),
						);
					}

					for (const by of ["wA", "t1", "g1"]) {
						const adds = addedDevice(by, "pY", "wY");
						expect(view(foldMembers([...base, adds])), `${by} adds a device`).toEqual(view(m));
						expect(
							view(foldMembers([...base, addedSheet(by, "r2")])),
							`${by} makes a sheet`,
						).toEqual(view(m));
					}
				},
			),
			opts(FRESH_LEAF),
		);
		let ran = 0;
		fc.assert(
			fc.property(history, (facts) => {
				const m = foldMembers(facts);
				const weak = [...m.keys.entries()]
					.filter(([key, k]) => k.rank !== "person" || m.spent.has(key))
					.map(([key]) => key);
				const target = [...m.keys.keys()].find((key) => isIn(m, key)) ?? "pA";

				for (const by of weak) {
					ran++;
					expect(view(foldMembers([...facts, granted(by, FRESH_LEAF)])), by).toEqual(view(m));
					expect(view(foldMembers([...facts, revoked(by, target)])), by).toEqual(view(m));
				}
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(RUNS);
	});
});

describe("p28, a removed key stays out", () => {
	it("plant, last fact wins for revoke: a revoked key is never let in again", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const m = foldMembers([
					founded(["pA", "pB"], "wA"),
					granted("pA", key),
					revoked("pB", key),
					granted("pA", key),
					granted("pB", key),
				]);
				expect(isIn(m, key)).toBe(false);
				expect(m.keys.get(key)?.live).toBe(false);
			}),
			opts("t1"),
		);
	});

	it("a dropped device never comes back, by a grant, an add or a second founded", () => {
		fc.assert(
			fc.property(
				fc.string().filter((key) => key !== "pB" && key !== "wA"),
				(root) => {
					const m = foldMembers([
						founded([root, "pB"], "wA"),
						revoked("pB", root),
						addedDevice("pB", root, "wA"),
						{_tag: "founded", id: P, name: NAME, keys: [root], window: "wA"},
					]);
					expect(m.keys.get(root)?.live).toBe(false);
					expect(isIn(m, "wA")).toBe(false);
					expect(livePersons(m)).toEqual(["pB"]);
				},
			),
			opts("pA"),
		);
	});

	it("a revoke may not name its signer's own key (flag 7)", () => {
		fc.assert(
			fc.property(
				fc.string().filter((key) => key !== "pB" && key !== "wA"),
				(root) => {
					const base = [founded([root, "pB"], "wA")];
					const m = foldMembers([...base, revoked(root, root)]);
					expect(view(m)).toEqual(view(foldMembers(base)));
				},
			),
			opts("pA"),
		);
	});

	it("a revoke for another person changes nothing", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const base = [founded(["pA", "pB"], "wA"), granted("pA", key)];
				expect(view(foldMembers([...base, revoked("pB", key, {for: OTHER})]))).toEqual(
					view(foldMembers(base)),
				);
			}),
			opts("t1"),
		);
	});

	it("over any list: a key that goes out never comes back, and a key not live never lives again", () => {
		fc.assert(
			fc.property(history, (facts) => {
				const folds = prefixes(facts);
				const wasIn = new Set<string>();
				const wentOut = new Set<string>();
				const wasDead = new Set<string>();

				for (const m of folds) {
					for (const key of ALL) {
						const now = isIn(m, key);
						expect(wentOut.has(key) && now, `${key} came back`).toBe(false);

						if (wasIn.has(key) && !now) {
							wentOut.add(key);
						}

						if (now) {
							wasIn.add(key);
						}

						const entry = m.keys.get(key);
						expect(wasDead.has(key) && entry?.live === true, `${key} lived again`).toBe(false);

						if (entry !== undefined && !entry.live) {
							wasDead.add(key);
						}
					}
				}
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});
});

describe("p28, the grant tree", () => {
	it("plant, a dropped device whose tabs stay: its window, tabs and agents all go with it", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const m = foldMembers([
					founded(["pA", "pB"], "wA"),
					granted("pA", key),
					granted("pA", "g1", {as: "agent"}),
					granted("pB", "t2"),
					revoked("pB", "pA"),
				]);

				for (const out of ["wA", key, "g1"]) {
					expect(isIn(m, out), out).toBe(false);
				}

				expect(isIn(m, "t2")).toBe(true);
			}),
			opts("t1"),
		);
	});

	it("over any list: a key is admitted exactly while it is a live window or agent with every key above it live", () => {
		fc.assert(
			fc.property(history, (facts) => {
				for (const m of prefixes(facts)) {
					for (const key of [...ALL, ...m.keys.keys()]) {
						const k = m.keys.get(key);
						const should =
							k !== undefined &&
							(k.rank === "window" || k.rank === "agent") &&
							k.live &&
							chainLive(m, key);
						const answer = admitted(m, key);
						expect(answer, key).toEqual(
							should ? {key, person: m.person, as: k?.rank} : {why: "not_granted"},
						);
					}
				}
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});

	it("over any list: person and recovery keys never dial, and a device never hangs under another", () => {
		fc.assert(
			fc.property(history, (facts) => {
				const m = foldMembers(facts);

				for (const [key, k] of m.keys) {
					if (k.rank !== "person" && k.rank !== "recovery") {
						continue;
					}

					expect(admitted(m, key), key).toEqual({why: "not_granted"});
					expect(k.under, key).toBeNull();
				}

				expect(m.person).toBe(P);
				expect(m.name).toBe(NAME);
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});
});

describe("p28, devices are equal roots", () => {
	it("plant, a dropped device that takes another with it: Mac B and its tab stay when Mac A goes", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const base = [founded(["pA"], "wA"), addedDevice("pA", "pB", "wB"), granted("pB", key)];
				const m = foldMembers([...base, revoked("pB", "pA")]);
				expect(livePersons(m)).toEqual(["pB"]);
				expect(isIn(m, "wB")).toBe(true);
				expect(isIn(m, key)).toBe(true);
			}),
			opts("t2"),
		);
	});

	it("plant, a removed device that spends the sheet: removing a device leaves the live sheet alone", () => {
		fc.assert(
			fc.property(sheetKey, (key) => {
				const base = [founded(["pA", "pB"], "wA"), addedSheet("pA", key)];

				for (const drop of [revoked("pB", "pA"), addedDevice("pB", "pY", "wY", {drops: ["pA"]})]) {
					const m = foldMembers([...base, drop]);
					expect(liveSheets(m)).toEqual([key]);
					expect([...m.spent]).toEqual([]);
				}
			}),
			opts("r1"),
		);
	});

	it("over any list: dropping one device never drops another, nor the live sheet", () => {
		let ran = 0;
		fc.assert(
			fc.property(twoDevices, fc.nat(), fc.boolean(), (facts, pick, byAdd) => {
				const before = foldMembers(facts);
				const devices = livePersons(before);

				if (devices.length < 2) {
					return;
				}

				ran++;
				const by = devices[pick % devices.length] ?? "pA";
				const gone = devices.find((key) => key !== by) ?? "pB";
				const [key, window] = FRESH_DEVICES[0];
				const drop = byAdd ? addedDevice(by, key, window, {drops: [gone]}) : revoked(by, gone);
				const after = foldMembers([...facts, drop]);
				expect(after.keys.get(gone)?.live).toBe(false);
				const others = devices.filter((d) => d !== gone);
				expect(livePersons(after).filter((d) => others.includes(d))).toEqual(others);
				expect(liveSheets(after)).toEqual(liveSheets(before));
				expect([...after.spent].sort()).toEqual([...before.spent].sort());
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(RUNS / 4);
	});

	it("over any list: any live device may add and drop, and the result is the same whichever signed", () => {
		let ran = 0;
		fc.assert(
			fc.property(twoDevices, fc.nat(), fc.boolean(), (facts, pick, byAdd) => {
				const m = foldMembers(facts);
				const [one, two] = livePersons(m);

				if (one === undefined || two === undefined) {
					return;
				}

				const targets = [...m.keys.keys()].filter((key) => key !== one && key !== two);
				const target = targets[pick % Math.max(1, targets.length)];

				if (target === undefined) {
					return;
				}

				ran++;
				const [key, window] = FRESH_DEVICES[0];
				const by = (signer: string) =>
					byAdd ? addedDevice(signer, key, window, {drops: [target]}) : revoked(signer, target);
				const viaOne = foldMembers([...facts, by(one)]);
				const viaTwo = foldMembers([...facts, by(two)]);
				expect(view(viaOne)).toEqual(view(viaTwo));
				expect(viaOne.keys.get(target)?.live).toBe(false);
				expect(isIn(viaOne, window)).toBe(byAdd);
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(RUNS / 4);
	});
});

describe("p28, the sheet", () => {
	it("plant, two live sheets: making a new sheet ends the old one, whatever drops says (flag 7)", () => {
		fc.assert(
			fc.property(sheetKey, (key) => {
				const base = [founded(["pA", "pB"], "wA"), addedSheet("pA", key)];
				const m = foldMembers([...base, addedSheet("pB", "r2")]);
				expect(liveSheets(m)).toEqual(["r2"]);
				expect(livePersons(m)).toEqual(["pA", "pB"]);
				// The old sheet cannot sign any more.
				const used = foldMembers([
					...base,
					addedSheet("pB", "r2"),
					addedDevice(key, "pY", "wY", {old: "lost"}),
				]);
				expect(isIn(used, "wY")).toBe(false);
			}),
			opts("r1"),
		);
	});

	it("plant, a spent sheet used twice: a sheet lets in one device, once", () => {
		fc.assert(
			fc.property(sheetKey, (key) => {
				const base = [founded(["pA"], "wA"), addedSheet("pA", key)];
				const once = foldMembers([
					...base,
					addedDevice(key, "pY", "wY", {old: "lost", drops: ["pA"]}),
				]);
				expect(isIn(once, "wY")).toBe(true);
				expect(livePersons(once)).toEqual(["pY"]);
				expect([...once.spent]).toEqual([key]);
				const twice = foldMembers([
					...base,
					addedDevice(key, "pY", "wY", {old: "lost", drops: ["pA"]}),
					addedDevice(key, "pZ", "wZ", {old: "lost", drops: ["pY"]}),
				]);
				expect(view(twice)).toEqual(view(once));
			}),
			opts("r1"),
		);
	});

	it("a sheet never grants a tab or an agent, and never makes a sheet", () => {
		fc.assert(
			fc.property(sheetKey, (key) => {
				const base = [founded(["pA"], "wA"), addedSheet("pA", key)];
				const m = foldMembers(base);
				expect(view(foldMembers([...base, granted(key, "t1")]))).toEqual(view(m));
				expect(view(foldMembers([...base, addedSheet(key, "r2")]))).toEqual(view(m));
			}),
			opts("r1"),
		);
	});

	it("over any list: at most one sheet is live at every step", () => {
		fc.assert(
			fc.property(history, (facts) => {
				for (const m of prefixes(facts)) {
					expect(liveSheets(m).length).toBeLessThanOrEqual(1);
				}
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});

	it("over any list: a new sheet by a live device is the one live sheet after it", () => {
		let ran = 0;
		fc.assert(
			fc.property(history, fc.nat(), (facts, pick) => {
				const m = foldMembers(facts);
				const devices = livePersons(m);
				const by = devices[pick % Math.max(1, devices.length)];

				if (by === undefined) {
					return;
				}

				ran++;
				const after = foldMembers([...facts, addedSheet(by, "r9")]);
				expect(liveSheets(after)).toEqual(["r9"]);
				expect(livePersons(after)).toEqual(devices);
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(RUNS / 2);
	});

	it("over any list: a recovery lets in the new device and its window, once, and the person stays", () => {
		let ran = 0;
		fc.assert(
			fc.property(history, fc.uniqueArray(anyKey, {maxLength: 3}), (facts, dropped) => {
				const m = foldMembers(facts);
				const [sheet] = liveSheets(m);

				if (sheet === undefined) {
					return;
				}

				ran++;
				const [[key, window], [key2, window2]] = FRESH_DEVICES;
				const used = [...facts, addedDevice(sheet, key, window, {old: "lost", drops: dropped})];
				const after = foldMembers(used);
				expect(admitted(after, window)).toEqual({key: window, person: P, as: "window"});
				expect(after.keys.get(key)).toEqual({rank: "person", live: true, under: null});
				expect(after.spent.has(sheet)).toBe(true);
				expect(liveSheets(after)).toEqual([]);
				expect(after.person).toBe(m.person);
				expect(after.name).toBe(m.name);

				for (const gone of dropped) {
					expect(isIn(after, gone), gone).toBe(false);
				}

				const again = foldMembers([...used, addedDevice(sheet, key2, window2, {old: "lost"})]);
				expect(view(again)).toEqual(view(after));
			}),
			{seed: SEED, numRuns: RUNS},
		);
		expect(ran).toBeGreaterThan(10);
	});
});

describe("p28, what changes nothing", () => {
	it("plant, denied blocks a later grant: a denied key is let in by a later grant", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const m = foldMembers([founded(), denied(key, "pA"), granted("pA", key)]);
				expect(admitted(m, key)).toEqual({key, person: P, as: "window"});
			}),
			opts("t1"),
		);
	});

	it("over any list: a denied anywhere changes who belongs in no way", () => {
		fc.assert(
			fc.property(history, fc.nat(), anyKey, signer, (facts, at, key, by) => {
				const i = 1 + (at % facts.length);
				const withDenied = [...facts.slice(0, i), denied(key, by), ...facts.slice(i)];
				expect(view(foldMembers(withDenied))).toEqual(view(foldMembers(facts)));
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});

	it("over any list: the same fact twice changes nothing", () => {
		fc.assert(
			fc.property(history, fc.nat(), (facts, at) => {
				const i = at % facts.length;
				const again = facts[i] ?? founded();
				const twice = [...facts.slice(0, i + 1), again, ...facts.slice(i + 1)];
				expect(view(foldMembers(twice))).toEqual(view(foldMembers(facts)));
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});

	it("is pure: folding the same list twice gives the same members, and leaves the list as it was", () => {
		fc.assert(
			fc.property(history, (facts) => {
				const copy = structuredClone(facts);
				expect(view(foldMembers(facts))).toEqual(view(foldMembers(facts)));
				expect(facts).toEqual(copy);
			}),
			{seed: SEED, numRuns: 100},
		);
	});
});

// Gaps the mutation step found on the build (ticket 236): laws the tests above held loose.
describe("p28, the rule's answer for a key that is out", () => {
	it("a revoked key granted again is refused as revoked, and stays out", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const facts = [founded(["pA", "pB"], "wA"), granted("pA", key), revoked("pB", key)];
				const folded = facts.reduce(
					(at, fact) => Result.getOrElse(allows(at, fact), () => at),
					EMPTY,
				);
				const again = allows(folded, granted("pA", key));
				expect(Result.isFailure(again) && again.failure).toBe("revoked");
				expect(isIn(foldMembers([...facts, granted("pA", key)]), key)).toBe(false);
			}),
			opts("t1"),
		);
	});

	it("a live key granted again as what it is changes nothing and is not refused", () => {
		fc.assert(
			fc.property(leafKey, (key) => {
				const facts = [founded(["pA", "pB"], "wA"), granted("pA", key)];
				const folded = facts.reduce(
					(at, fact) => Result.getOrElse(allows(at, fact), () => at),
					EMPTY,
				);
				const again = allows(folded, granted("pB", key));
				expect(Result.isSuccess(again)).toBe(true);

				if (Result.isSuccess(again)) {
					expect(view(again.success.members)).toEqual(view(folded.members));
				}
			}),
			opts("t1"),
		);
	});
});

describe("p28, a device never drops itself", () => {
	it("a device that names its own key in drops stays live, and its window stays in", () => {
		fc.assert(
			fc.property(
				fc.string().filter((key) => !["pA", "wA", "pB"].includes(key)),
				(window) => {
					const m = foldMembers([
						founded(["pA"], "wA"),
						addedDevice("pA", "pB", window, {drops: ["pA", "wA"]}),
					]);
					expect(livePersons(m)).toEqual(["pA", "pB"]);
					expect(isIn(m, window)).toBe(true);
					// The signer's own key is skipped; the rest of drops still stops.
					expect(isIn(m, "wA")).toBe(false);
				},
			),
			opts("wB"),
		);
	});
});
