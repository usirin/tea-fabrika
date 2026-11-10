import {Denied, Ledger, type Row, Stale, streams, type Writer, writerOf} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {AREAS, type AreaEntry, areasOf} from "@kampus/pipeline/tickets/area";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {tracker} from "./index.ts";
import {Author, loadCell, saveCell} from "./ledger.ts";
import type {load, save} from "./machine.ts";
import type {Write} from "./ticket.ts";

// Areas PR 1, today's version (docs/direction/areas.md, the plan's a3 and a4): the tracker's save
// puts a person's area facts on `tracker/areas`, refuses them from an agent on a ledger with no
// door, and gives two people who make an area at once two numbers, n and n+1. On a ledger in
// memory, with no window.
//
//   save {id: "w1", write: {kind: "make_area", name: "pipeline"}}
//   // tracker/areas/inbox  {_tag: "area_made", area: 1, name: "pipeline"}   user:owner

type Ledgers = Ledger["Service"];

const OWNER: Writer = {kind: "user", id: "github:7"};
const SECOND: Writer = {kind: "user", id: "github:8"};
const AGENT: Writer = {kind: "agent", id: "triage", for: "github:7"};

const INBOX = streams(AREAS).inbox;

/** One write through the tracker's save, as `by`, on `ledger`. `next` is a ticket's; an area takes its own. */
const saved = (ledger: Ledgers, by: Writer, id: string, write: Write) =>
	saveCell({id, write, next: 1} as ReturnType<typeof save>).pipe(
		Effect.provideService(Ledger, ledger),
		Effect.provideService(Author, by),
	);

// made up: `make_area`'s `Write` case is `{kind: "make_area", name}`, as the plan's input; the
// other two the same, from `rename_area` and `merge_area`.
const make = (name: string): Write => ({kind: "make_area", name});
const rename = (area: number, name: string): Write => ({kind: "rename_area", area, name});
const merge = (area: number, into: number): Write => ({kind: "merge_area", area, into});

/** The areas stream's rows, or none when nobody wrote it yet. */
const rowsOn = (ledger: Ledgers) =>
	ledger.readStream(INBOX, 0, -1).pipe(Effect.orElseSucceed((): readonly Row[] => []));

/** The rows as the fold reads them. made up: `AreaEntry`'s keys are a ticket `Entry`'s, less `ticket`. */
const entriesOf = (rows: readonly Row[]): readonly AreaEntry[] =>
	rows.map((row) => {
		const by = writerOf(row.writer);

		if (by === null) {
			throw new Error(`row ${row.pos} has no writer`);
		}

		return {pos: row.pos, by, at: row.at, fact: JSON.parse(row.data)};
	});

/** The `area_made` facts on the stream, by number: what each made, and who. */
const madeOn = (rows: readonly Row[]) =>
	rows
		.map((row) => ({row, fact: JSON.parse(row.data) as {_tag: string; area: number; name: string}}))
		.filter(({fact}) => fact._tag === "area_made")
		.map(({row, fact}) => [fact.area, fact.name, row.writer] as const)
		.sort(([a], [b]) => a - b);

/**
 * `raw`, with `other` run in full just before this ledger's `at`-th call (from 0), once. So `other`
 * lands between any two steps of the save that runs on it, whatever those steps are.
 */
const interleaved = (raw: Ledgers, at: number, other: Effect.Effect<unknown>) => {
	let calls = 0;
	let ran = false;
	const before = Effect.suspend(() => {
		if (ran || calls++ !== at) {
			return Effect.void;
		}

		ran = true;
		return Effect.asVoid(other);
	});
	const ledger = new Proxy(raw, {
		get(target, key, receiver) {
			const value: unknown = Reflect.get(target, key, receiver);

			if (typeof value !== "function" || key === "watch") {
				return value;
			}

			return (...args: unknown[]) =>
				Effect.andThen(
					before,
					Effect.suspend(() => value.apply(target, args)),
				);
		},
	});
	return {ledger, ran: () => ran};
};

describe("an area write on a ledger with no door (a3)", () => {
	it("is refused from an agent, and nothing lands", async () => {
		const ledger = memoryService();
		const {why, rows} = await Effect.runPromise(
			Effect.gen(function* () {
				const why = yield* Effect.flip(saved(ledger, AGENT, "w1", make("pipeline")));
				return {why, rows: yield* rowsOn(ledger)};
			}),
		);
		expect(why).toMatchObject({_tag: "refused"});
		expect(String((why as {why?: unknown}).why)).toMatch(/only a person/);
		expect(rows).toEqual([]);
	});

	it("is refused from an agent for a rename and a merge, and the person's areas stand", async () => {
		const ledger = memoryService();
		const {refused, rows} = await Effect.runPromise(
			Effect.gen(function* () {
				yield* saved(ledger, OWNER, "w1", make("pipeline"));
				yield* saved(ledger, OWNER, "w2", make("lane"));
				const refused = [
					yield* Effect.flip(saved(ledger, AGENT, "w3", rename(1, "lane work"))),
					yield* Effect.flip(saved(ledger, AGENT, "w4", merge(2, 1))),
				];
				return {refused, rows: yield* rowsOn(ledger)};
			}),
		);
		expect(refused).toMatchObject([{_tag: "refused"}, {_tag: "refused"}]);
		expect(rows.map((r) => [r.kind, r.writer])).toEqual([
			["area_made", "user:github:7"],
			["area_made", "user:github:7"],
		]);
	});

	it("gives an agent no tool for any of the three: each input is a person's only", () => {
		expect(
			[tracker.inputs.make_area, tracker.inputs.rename_area, tracker.inputs.merge_area].map(
				(i) => i.personOnly,
			),
		).toEqual([true, true, true]);
	});
});

describe("an area write from a person", () => {
	it("puts one fact each, kept under its own `_tag` as the row's kind, and the fold reads them", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				yield* saved(ledger, OWNER, "w1", make("pipeline"));
				yield* saved(ledger, OWNER, "w2", make("lane"));
				yield* saved(ledger, OWNER, "w3", rename(1, "lane work"));
				yield* saved(ledger, OWNER, "w4", merge(2, 1));
				return yield* rowsOn(ledger);
			}),
		);
		const facts = rows.map((r) => JSON.parse(r.data));
		expect(facts).toEqual([
			{_tag: "area_made", area: 1, name: "pipeline"},
			{_tag: "area_made", area: 2, name: "lane"},
			{_tag: "area_renamed", area: 1, name: "lane work"},
			{_tag: "area_merged", area: 2, into: 1},
		]);
		// The door refuses by the row's kind, so the kind must be the fact's own.
		expect(rows.map((r) => r.kind)).toEqual(facts.map((f) => f._tag));
		const {areas, problems} = areasOf(entriesOf(rows));
		expect(problems).toEqual([]);
		expect([...areas.live]).toEqual([[1, "lane work"]]);
	});

	it("makes areas in the order asked: 1, 2, 3", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				for (const [i, name] of ["pipeline", "app", "desk"].entries()) {
					yield* saved(ledger, OWNER, `w${i}`, make(name));
				}

				return yield* rowsOn(ledger);
			}),
		);
		expect(madeOn(rows).map(([n, name]) => [n, name])).toEqual([
			[1, "pipeline"],
			[2, "app"],
			[3, "desk"],
		]);
	});
});

// Round 1b: the onboarding step's "type a name" box. A typed name is the same write as a ticked
// one, with no `suggested`. The save reads the stream before it writes, so a name someone else
// took a moment ago is refused here even when the window had not seen it yet.
describe("a typed name", () => {
	it("makes an `area_made` with that name, and no `suggested`", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			saved(ledger, OWNER, "t1", make("lane work")).pipe(Effect.andThen(rowsOn(ledger))),
		);
		expect(rows.map((r) => JSON.parse(r.data))).toStrictEqual([
			{_tag: "area_made", area: 1, name: "lane work"},
		]);
	});

	it("is refused when a live area has it, in any case, says which, and nothing lands", async () => {
		const ledger = memoryService();
		const {why, rows} = await Effect.runPromise(
			Effect.gen(function* () {
				yield* saved(ledger, OWNER, "w1", make("pipeline"));
				const why = yield* Effect.flip(saved(ledger, SECOND, "t1", make("Pipeline")));
				return {why, rows: yield* rowsOn(ledger)};
			}),
		);
		expect(why).toMatchObject({_tag: "refused"});
		expect(String((why as {why?: unknown}).why)).toMatch(/pipeline/i);
		expect(madeOn(rows).map(([n, name]) => [n, name])).toEqual([[1, "pipeline"]]);
	});
});

// Round 2, from the mutation step: what a save keeps on the row, what it answers, and what a load
// makes of a row that does not read.
const loaded = (ledger: Ledgers) =>
	loadCell({after: 0} as ReturnType<typeof load>).pipe(Effect.provideService(Ledger, ledger));

describe("a ticked suggestion, saved", () => {
	it.each([
		["the titles' word", {_tag: "titles", word: "lane", tickets: 21} as const],
		["a folder", {_tag: "folder", path: "apps/fabrika"} as const],
	])(
		"keeps %s on the row as `suggested`, and the load reads it back whole",
		async (_, suggested) => {
			const ledger = memoryService();
			const write: Write = {kind: "make_area", name: "lane", suggested};
			const {rows, read} = await Effect.runPromise(
				Effect.gen(function* () {
					yield* saved(ledger, OWNER, "w1", write);
					return {rows: yield* rowsOn(ledger), read: yield* loaded(ledger)};
				}),
			);
			// What the person was shown and took is written once, at the save: lost here, it is lost for good.
			expect(rows.map((r) => JSON.parse(r.data))).toStrictEqual([
				{_tag: "area_made", area: 1, name: "lane", suggested},
			]);
			expect(read.areas.map((e) => e.fact)).toStrictEqual([
				{_tag: "area_made", area: 1, name: "lane", suggested},
			]);
		},
	);
});

describe("what an area save answers", () => {
	it("answers the area made, and the same write sent twice answers it again and lands once", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* saved(ledger, OWNER, "w1", make("lane"));
				const again = yield* saved(ledger, OWNER, "w1", make("lane"));
				const next = yield* saved(ledger, OWNER, "w2", make("desk"));
				return {first, again, next, rows: yield* rowsOn(ledger)};
			}),
		);
		expect(seen.first).toEqual({area: 1});
		expect(seen.again).toEqual({area: 1});
		expect(seen.next).toEqual({area: 2});
		expect(madeOn(seen.rows).map(([n, name]) => [n, name])).toEqual([
			[1, "lane"],
			[2, "desk"],
		]);
	});

	it("answers the area renamed or merged", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* saved(ledger, OWNER, "w1", make("lane"));
				yield* saved(ledger, OWNER, "w2", make("desk"));
				return [
					yield* saved(ledger, OWNER, "w3", rename(1, "lane work")),
					yield* saved(ledger, OWNER, "w4", merge(2, 1)),
				];
			}),
		);
		expect(seen).toEqual([{area: 1}, {area: 2}]);
	});
});

describe("a load of many areas", () => {
	it("reads past one page: 501 areas, every one, and the last row's place", async () => {
		const ledger = memoryService();
		const read = await Effect.runPromise(
			Effect.gen(function* () {
				yield* ledger.register(AREAS, "user:github:7");

				for (let n = 1; n <= 501; n++) {
					yield* ledger.send(INBOX, `w${n}`, {
						kind: "area_made",
						writer: "user:github:7",
						data: {_tag: "area_made", area: n, name: `area ${n}`},
					});
				}

				const rows = yield* rowsOn(ledger);
				return {load: yield* loaded(ledger), last: rows.at(-1)?.pos};
			}),
		);
		expect(read.load.areas).toHaveLength(501);
		expect(read.load.areas.at(-1)?.fact).toEqual({_tag: "area_made", area: 501, name: "area 501"});
		expect(read.load.last).toBe(read.last);
		expect(areasOf(read.load.areas).areas.live.size).toBe(501);
	});
});

describe("a row on the areas that does not read", () => {
	/** A row on the areas' inbox, written by hand: its data is not an area fact. */
	const brokenRow = (ledger: Ledgers) =>
		Effect.gen(function* () {
			yield* ledger.register(AREAS, "user:github:7");
			yield* ledger.send(INBOX, "x1", {kind: "area_made", writer: "user:github:7", data: "lane"});
		});

	it("is in the load's `broken`, one line naming its row, and a clean load has none", async () => {
		const clean = memoryService();
		const dirty = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* saved(clean, OWNER, "w1", make("lane"));
				yield* brokenRow(dirty);
				return {clean: yield* loaded(clean), dirty: yield* loaded(dirty)};
			}),
		);
		expect(seen.clean.broken).toEqual([]);
		expect(seen.clean.areas).toHaveLength(1);
		expect(seen.dirty.areas).toEqual([]);
		expect(seen.dirty.broken).toHaveLength(1);
		expect(seen.dirty.broken[0]).toMatch(/^row \d+ on the areas: /);
	});

	it("does not stop a save: the next area is still 1, and it lands", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* brokenRow(ledger);
				const answer = yield* saved(ledger, OWNER, "w1", make("lane"));
				return {answer, read: yield* loaded(ledger)};
			}),
		);
		expect(seen.answer).toEqual({area: 1});
		expect(seen.read.areas.map((e) => e.fact)).toEqual([
			{_tag: "area_made", area: 1, name: "lane"},
		]);
	});
});

describe("two people make an area at once (a4)", () => {
	/** Both made, numbered n and n+1, each by its own writer, and the fold refuses neither. */
	const bothLand = (rows: readonly Row[]) => {
		const made = madeOn(rows);
		expect(made.map(([n]) => n)).toEqual([1, 2]);
		expect(made.map(([, name, writer]) => [name, writer]).sort()).toEqual([
			["app", "user:github:8"],
			["pipeline", "user:github:7"],
		]);
		expect(areasOf(entriesOf(rows)).problems).toEqual([]);
	};

	it("both land, as 1 and 2, when the two saves run side by side", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.all(
					[saved(ledger, OWNER, "a1", make("pipeline")), saved(ledger, SECOND, "b1", make("app"))],
					{concurrency: "unbounded"},
				);
				return yield* rowsOn(ledger);
			}),
		);
		bothLand(rows);
	});

	// The second person's save lands in full between any two of the first one's ledger calls: after
	// the first read the next number, before it wrote, and so on. Every place gives n and n+1.
	it.each(Array.from({length: 12}, (_, at) => at))(
		"both land, as 1 and 2, when the other's lands just before call %i of one",
		async (at) => {
			const raw = memoryService();
			const other = saved(raw, SECOND, "b1", make("app")).pipe(Effect.orDie);
			const {ledger, ran} = interleaved(raw, at, other);
			const rows = await Effect.runPromise(
				Effect.gen(function* () {
					yield* saved(ledger, OWNER, "a1", make("pipeline"));

					// The save made fewer calls than `at`: the other one comes after it, then.
					if (!ran()) {
						yield* other;
					}

					return yield* rowsOn(raw);
				}),
			);
			bothLand(rows);
		},
	);
});

// Round 4, owed by the mutation step: what an area save says when the ledger will not take its
// row. Each is a `refused` in words, and nothing lands.
describe("an area save the ledger will not take", () => {
	/** `raw`, with every `append` failing with `error`, and how many appends it got. */
	const appendFails = (raw: Ledgers, error: () => Denied | Stale) => {
		let appends = 0;
		const ledger = new Proxy(raw, {
			get(target, key, receiver) {
				const value: unknown = Reflect.get(target, key, receiver);

				if (typeof value !== "function") {
					return value;
				}

				if (key !== "append") {
					return (...args: unknown[]) => value.apply(target, args);
				}

				return () =>
					Effect.suspend(() => {
						appends++;
						return Effect.fail(error());
					});
			},
		});
		return {ledger, appends: () => appends};
	};

	it("is refused, naming the stream, when the ledger denies the write", async () => {
		const raw = memoryService();
		const {ledger} = appendFails(raw, () => new Denied({stream: INBOX}));
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const why = yield* Effect.flip(saved(ledger, OWNER, "w1", make("lane")));
				return {why, rows: yield* rowsOn(raw)};
			}),
		);
		expect(seen.why).toEqual({_tag: "refused", why: "the ledger refused tracker/areas/inbox"});
		expect(seen.rows).toEqual([]);
	});

	it("is refused after 1,000 tries when every one is stale, and tries no more", async () => {
		const raw = memoryService();
		const {ledger, appends} = appendFails(raw, () => new Stale({stream: INBOX, rev: 0}));
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const why = yield* Effect.flip(saved(ledger, OWNER, "w1", make("lane")));
				return {why, rows: yield* rowsOn(raw)};
			}),
		);
		expect(seen.why).toEqual({
			_tag: "refused",
			why: "the ledger refused tracker/areas/inbox: 1000 tries, each one stale",
		});
		expect(appends()).toBe(1000);
		expect(seen.rows).toEqual([]);
	});
});
