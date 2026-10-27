import {defineMachine, StoreRefusedError} from "@demlik/tea";
import {run, StoreFailed} from "@demlik/tea/effect";
import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {Cause, Effect, Exit, Layer, Schema} from "effect";
import {KeyValueStore} from "effect/persistence";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {call, defineProgram, kind, type MsgOf} from "./program.ts";
import {type Handle, StateRefused, type Storage, storageOf} from "./storage.ts";

// The laws of a kept state read through its machine's schema
// (docs/direction/an-old-host-is-named-then-restarted.md, section 1), on fast-check and tea's pbt.
// They are written from the rule, not from the code:
//
//   a save    is encoded by the schema, strictly: a key the schema does not name fails it, and
//             nothing is written, not even the index line.
//   a read    is decoded by the schema. A state it does not take was saved by older code: `read`
//             fails `StateRefused`, `migrate` answers tea's `refuse`, `list` shows it as refused.
//   refused   bytes are never booted and never written over, by any step of the storage, of tea's
//             `run`, or of a program's start and its check for unfinished runs.
//   `list`    shows every run kept, and one refused hides no other.
//
// The machine is a toy, a tray of items, so each law can say exactly which state is kept. Its
// bytes sit in a map the law can read, under one storage value, and under a second one over the
// same map as the next process would open it.

// ---------------------------------------------------------------- the toy

const Item = Schema.Struct({name: Schema.String, n: Schema.Int});
/** The tray's state, and the schema it is kept and read back through. */
const Tray = Schema.Union([
	Schema.Struct({phase: Schema.Literal("empty")}),
	Schema.Struct({
		phase: Schema.Literal("holding"),
		top: Item,
		items: Schema.Array(Item),
		notes: Schema.Record(Schema.String, Schema.String),
		left: Schema.NullOr(Schema.String),
	}),
]);
type Tray = typeof Tray.Type;
/** The tray as older code kept it: its items counted, not listed. */
const OlderTray = Schema.Struct({phase: Schema.Literal("holding"), count: Schema.Int});
type OlderTray = typeof OlderTray.Type;

type TrayMsg =
	| {readonly type: "put"; readonly name: string; readonly n: number}
	| {readonly type: "take"}
	| {readonly type: "note"; readonly key: string; readonly text: string};

/** Every state a tray was booted from, in order: a law reads it to see that refused bytes never were. */
const booted: unknown[] = [];

const tray = defineMachine({
	types: {model: {} as Tray, msg: {} as TrayMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => {
		booted.push(loaded);
		return [loaded ?? {phase: "empty"}, []];
	},
	update: {
		put: (s, m) => [
			s.phase === "empty"
				? {phase: "holding", top: {name: m.name, n: m.n}, items: [], notes: {}, left: null}
				: {...s, top: {name: m.name, n: m.n}, items: [...s.items, s.top]},
			[],
		],
		take: (s) => {
			if (s.phase === "empty") return [s, []];
			const [next, ...rest] = s.items;
			return [
				next === undefined ? {phase: "empty"} : {...s, top: next, items: rest, left: s.top.name},
				[],
			];
		},
		note: (s, m) => [s.phase === "empty" ? s : {...s, notes: {...s.notes, [m.key]: m.text}}, []],
	},
});

// ---------------------------------------------------------------- bytes a law can read

/** The bytes in memory, and a storage over them: each call is a new storage, as the next process opens it. */
const place = () => {
	const bytes = new Map<string, string>();
	const kv = KeyValueStore.makeStringOnly({
		get: (key) => Effect.sync(() => bytes.get(key)),
		set: (key, value) => Effect.sync(() => void bytes.set(key, value)),
		remove: (key) => Effect.sync(() => void bytes.delete(key)),
		clear: Effect.sync(() => bytes.clear()),
		size: Effect.sync(() => bytes.size),
	});
	return {bytes, open: (): Storage => storageOf(Layer.succeed(KeyValueStore.KeyValueStore, kv))};
};

/** Every key and its bytes, as they stand. */
const snapshot = (bytes: ReadonlyMap<string, string>) => new Map(bytes);
/** The bytes of one machine run: its two slots. */
const runBytes = (bytes: ReadonlyMap<string, string>, run: string, machine: string, id: string) =>
	[...bytes].filter(([key]) =>
		key.startsWith(
			`run/${encodeURIComponent(run)}/machine/${encodeURIComponent(machine)}/${encodeURIComponent(id)}/`,
		),
	);

const go = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const exitOf = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.exit(effect));
/** What a promise came to: its value, or the message it failed with. */
const settled = <A>(promise: Promise<A>) =>
	promise.then(
		(value) => ({ok: true as const, value}),
		(error: unknown) => ({
			ok: false as const,
			why: error instanceof Error ? error.message : String(error),
		}),
	);
const isRefusal = (
	migrated: unknown,
): migrated is {readonly _tag: "refusal"; readonly reason: string} =>
	typeof migrated === "object" &&
	migrated !== null &&
	(migrated as {_tag?: unknown})._tag === "refusal";

// ---------------------------------------------------------------- generators

const name = fc.constantFrom("cup", "jar", "", "lid e", "é");
const item = fc.record({name, n: fc.integer({min: -1000, max: 1000})});
const key = fc.constantFrom("a", "b", "k e", "");
const tray$: fc.Arbitrary<Tray> = fc.oneof(
	fc.constant({phase: "empty"} as const),
	fc.record({
		phase: fc.constant("holding" as const),
		top: item,
		items: fc.array(item, {maxLength: 3}),
		notes: fc.dictionary(key, name, {maxKeys: 2}),
		left: fc.option(name, {nil: null}),
	}),
);
const older$: fc.Arbitrary<OlderTray> = fc.record({
	phase: fc.constant("holding" as const),
	count: fc.integer({min: 0, max: 9}),
});
/** A key the tray's schema names nowhere, and what it holds. */
const excess = fc.record({
	key: fc.constantFrom("extra", "count", "try"),
	value: fc.oneof(fc.integer(), fc.string({maxLength: 3}), fc.constant(null), fc.boolean()),
});

/**
 * `t` with one more key, where the schema names none: on the state itself, on its top item, or on
 * one of its items. `at` picks the place among those the state has.
 */
const withExcess = (
	t: Tray,
	at: number,
	extra: {readonly key: string; readonly value: unknown},
) => {
	if (t.phase === "empty") return {...t, [extra.key]: extra.value};
	const places = 2 + t.items.length;
	const where = at % places;
	if (where === 0) return {...t, [extra.key]: extra.value};
	if (where === 1) return {...t, top: {...t.top, [extra.key]: extra.value}};
	return {
		...t,
		items: t.items.map((it, i) => (i === where - 2 ? {...it, [extra.key]: extra.value} : it)),
	};
};

const RUN = "tray:r1";
const MACHINE = "tray";
const OPTS = {numRuns: 150, seed: 1};
const FEW = {numRuns: 40, seed: 1};

// ---------------------------------------------------------------- law: a save is strict

describe("a save is encoded by its schema, strictly", () => {
	it("a state with a key its schema lacks is refused, and every stored byte stays as it was, the index too", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.option(tray$, {nil: null}),
				tray$,
				fc.nat(),
				excess,
				fc.constantFrom("t", "fresh"),
				async (before, base, at, extra, id) => {
					const {bytes, open} = place();
					const handle = await go(open().open(RUN, null));
					if (before !== null) await handle.store(MACHINE, "t", Tray).save(before);
					const was = snapshot(bytes);
					const loose = withExcess(base, at, extra) as Tray;
					const saved = await settled(handle.store(MACHINE, id, Tray).save(loose));
					expect(saved).toEqual({
						ok: false,
						why: expect.stringContaining("does not fit its own schema"),
					});
					expect(snapshot(bytes)).toEqual(was);
					const next = await go(open().open(RUN, null));
					expect(await go(next.read(MACHINE, "t", Tray))).toEqual(before);
					expect(next.found.machines).toEqual(before === null ? [] : [{machine: MACHINE, id: "t"}]);
				},
			),
			OPTS,
		);
	});

	it("the same state without the key is kept, and loads back equal (the law above refuses only the key)", async () => {
		await fc.assert(
			fc.asyncProperty(tray$, async (t) => {
				const {open} = place();
				const handle = await go(open().open(RUN, null));
				const store = handle.store(MACHINE, "t", Tray);
				await store.save(t);
				expect(store.migrate(await store.load())).toEqual(t);
			}),
			OPTS,
		);
	});
});

// ---------------------------------------------------------------- law: read, migrate and list agree

/** A value as it may sit in storage: a tray, older code's tray, a tray with one field wrong or one key more, or any JSON. */
const stored$: fc.Arbitrary<unknown> = fc.oneof(
	tray$,
	older$,
	fc.tuple(tray$, fc.nat(), excess).map(([t, at, extra]) => withExcess(t, at, extra)),
	tray$.map((t) => (t.phase === "empty" ? {phase: "full"} : {...t, top: {...t.top, n: 1.5}})),
	tray$.map((t) => (t.phase === "empty" ? {} : {...t, items: null})),
	fc.jsonValue({maxDepth: 3}),
);

/** What the schema itself says of a stored value: the rule is that the schema is the check. */
const decodeTray = Schema.decodeUnknownExit(Tray);

describe("read, migrate and list agree on every stored value", () => {
	it("what one takes the others take, as the same state; what one refuses the others refuse, for the same reason; the schema decides", async () => {
		const seen = {kept: 0, refused: 0, nothing: 0};
		await fc.assert(
			fc.asyncProperty(stored$, async (raw) => {
				const {open} = place();
				const older = await go(open().open(RUN, null));
				await older.store(MACHINE, "x", Schema.Unknown).save(raw);
				const handle = await go(open().open(RUN, null));
				const store = handle.store(MACHINE, "x", Tray);
				const kept = await store.load();
				const migrated = store.migrate(kept);
				const read = await exitOf(handle.read(MACHINE, "x", Tray));
				const listed = (await go(handle.list(MACHINE, Tray))).filter((l) => l.id === "x");

				// What was kept is what was saved, read back as JSON.
				expect(kept).toEqual(JSON.parse(JSON.stringify(raw)));
				if (kept === null) {
					// JSON null is "nothing kept" to all three.
					seen.nothing += 1;
					expect({migrated, read: Exit.isSuccess(read) ? read.value : "failed", listed}).toEqual({
						migrated: null,
						read: null,
						listed: [],
					});
					return;
				}
				const decoded = decodeTray(kept);
				if (Exit.isSuccess(decoded)) {
					seen.kept += 1;
					expect(migrated).toEqual(decoded.value);
					expect(Exit.isSuccess(read) ? read.value : "failed").toEqual(decoded.value);
					expect(listed).toEqual([{kind: "kept", id: "x", state: decoded.value}]);
					return;
				}
				seen.refused += 1;
				expect(isRefusal(migrated)).toBe(true);
				expect(Exit.isFailure(read)).toBe(true);
				const failure = Exit.isFailure(read) ? Cause.squash(read.cause) : null;
				expect(failure).toBeInstanceOf(StateRefused);
				const refused = failure as StateRefused;
				expect(listed).toEqual([{kind: "refused", id: "x", why: refused.why}]);
				expect(isRefusal(migrated) ? migrated.reason : "").toBe(refused.message);
			}),
			{numRuns: 300, seed: 1},
		);
		// A law that holds only because nothing tried to break it is not a law that holds.
		expect(seen.kept).toBeGreaterThan(50);
		expect(seen.refused).toBeGreaterThan(50);
		expect(seen.nothing).toBeGreaterThan(0);
	});

	it("nothing kept is nothing to all three: migrate says null, read says null, list leaves it out", async () => {
		const {open} = place();
		const handle = await go(open().open(RUN, null));
		const store = handle.store(MACHINE, "none", Tray);
		expect(store.migrate(await store.load())).toBeNull();
		expect(await go(handle.read(MACHINE, "none", Tray))).toBeNull();
		expect(await go(handle.list(MACHINE, Tray))).toEqual([]);
	});
});

// ---------------------------------------------------------------- law: list shows every run

/** One write to the index: a tray saved, older code's tray saved, or a run cleared, of the tray or of another machine. */
type Write =
	| {readonly do: "save"; readonly machine: string; readonly id: string; readonly state: Tray}
	| {readonly do: "older"; readonly machine: string; readonly id: string; readonly state: OlderTray}
	| {readonly do: "clear"; readonly machine: string; readonly id: string};

const id$ = fc.constantFrom("a", "b", "c/1", "d e", "é", "older");
const machine$ = fc.constantFrom(MACHINE, MACHINE, MACHINE, "other");
const write$: fc.Arbitrary<Write> = fc.oneof(
	{
		weight: 3,
		arbitrary: fc.record({
			do: fc.constant("save" as const),
			machine: machine$,
			id: id$,
			state: tray$,
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			do: fc.constant("older" as const),
			machine: machine$,
			id: id$,
			state: older$,
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({do: fc.constant("clear" as const), machine: machine$, id: id$}),
	},
);

describe("list shows every run", () => {
	it("every run of the machine kept and not cleared is listed once, kept with its state or refused, and a refused one hides no other, in this process and in the next", async () => {
		let mixed = 0;
		await fc.assert(
			fc.asyncProperty(fc.array(write$, {maxLength: 14}), fc.boolean(), async (writes, restart) => {
				const {open} = place();
				const storage = open();
				const handle = await go(storage.open(RUN, null));
				const model = new Map<string, Write>();
				for (const w of writes) {
					if (w.do === "clear") await go(handle.clear(w.machine, w.id));
					else if (w.do === "save") await handle.store(w.machine, w.id, Tray).save(w.state);
					else await handle.store(w.machine, w.id, OlderTray).save(w.state);
					if (w.machine !== MACHINE) continue;
					if (w.do === "clear") model.delete(w.id);
					else model.set(w.id, w);
				}
				const reader: Handle = restart ? await go(open().open(RUN, null)) : handle;
				const listed = await go(reader.list(MACHINE, Tray));
				const want = [...model.values()].map((w) =>
					w.do === "save"
						? {kind: "kept", id: w.id, state: w.state}
						: {kind: "refused", id: w.id, why: expect.any(String)},
				);
				const byId = (a: {readonly id: string}, b: {readonly id: string}) =>
					a.id.localeCompare(b.id);
				expect([...listed].sort(byId)).toEqual(want.sort(byId));
				if (listed.some((l) => l.kind === "kept") && listed.some((l) => l.kind === "refused"))
					mixed += 1;
			}),
			OPTS,
		);
		// Lists with refused and kept runs side by side, where one could hide another.
		expect(mixed).toBeGreaterThan(30);
	});
});

// ---------------------------------------------------------------- law: refused bytes stay

/** One later step, of the storage, of tea's `run`, or of a program on the same run. */
type Later =
	| {readonly do: "reopen"}
	| {readonly do: "restart"}
	| {readonly do: "read"}
	| {readonly do: "list"}
	| {readonly do: "load"}
	| {readonly do: "boot"}
	| {readonly do: "start"}
	| {readonly do: "save"; readonly id: string; readonly state: Tray}
	| {readonly do: "clear"; readonly id: string}
	| {readonly do: "close"}
	| {readonly do: "sent"}
	| {readonly do: "end"};

const other$ = fc.constantFrom("a", "b");
const later$: fc.Arbitrary<Later> = fc.oneof(
	fc.constantFrom<Later>(
		{do: "reopen"},
		{do: "restart"},
		{do: "read"},
		{do: "list"},
		{do: "load"},
		{do: "boot"},
		{do: "start"},
		{do: "close"},
		{do: "sent"},
		{do: "end"},
	),
	fc.record({do: fc.constant("save" as const), id: other$, state: tray$}),
	fc.record({do: fc.constant("clear" as const), id: other$}),
);

/** The tray as a program: `main` starts the refused run, then another, and puts an item in it. */
const trays = defineProgram({
	name: "trays",
	description: "Starts a tray older code kept, then a new one.",
	inputs: {},
	outputs: {},
	machines: {
		tray: kind({
			machine: tray,
			state: Tray,
			parent: "main",
			options: () => ({ctx: undefined}),
			// A tray has no unfinished work: the check for unfinished runs, at `main`'s end, clears every
			// run of it. It must come to the refused one and leave it as it is.
			recovered: () => null,
			drawing: () => ({name: "tray", steps: {}}),
			status: (s) => s.phase,
		}),
	},
	main: ({machines}) =>
		Effect.gen(function* () {
			const old = yield* machines.tray.get("old").start({type: "take"}).pipe(Effect.exit);
			const failure = Exit.isFailure(old) ? Cause.squash(old.cause) : null;
			if (!(failure instanceof StateRefused)) return yield* Effect.die("the older tray started");
			const fresh = yield* machines.tray.get("a").start({type: "put", name: "cup", n: 1});
			yield* fresh.dispatch({type: "take"}).pipe(Effect.orDie);
		}).pipe(Effect.scoped),
});

describe("refused bytes are never booted and never written over", () => {
	it("by any later step: a newer open, the next process, a read, a list, a load, tea's run, a program's start and its check, another run's save or clear, a closed input, an outbox line, an end", async () => {
		const tried = new Set<string>();
		await fc.assert(
			fc.asyncProperty(older$, fc.array(later$, {maxLength: 8}), async (old, steps) => {
				const {bytes, open} = place();
				let storage = open();
				const first = await go(storage.open(RUN, null));
				await first.store(MACHINE, "old", OlderTray).save(old);
				const planted = runBytes(bytes, RUN, MACHINE, "old");
				expect(planted.length).toBeGreaterThan(0);
				booted.length = 0;
				let handle = await go(storage.open(RUN, null));
				let sent = 0;

				for (const step of steps) {
					tried.add(step.do);
					switch (step.do) {
						case "reopen":
							handle = await go(storage.open(RUN, null));
							break;
						case "restart":
							storage = open();
							handle = await go(storage.open(RUN, null));
							break;
						case "read": {
							const read = await exitOf(handle.read(MACHINE, "old", Tray));
							expect(Exit.isFailure(read) && Cause.squash(read.cause) instanceof StateRefused).toBe(
								true,
							);
							break;
						}
						case "list":
							expect((await go(handle.list(MACHINE, Tray))).find((l) => l.id === "old")?.kind).toBe(
								"refused",
							);
							break;
						case "load": {
							const store = handle.store(MACHINE, "old", Tray);
							expect(isRefusal(store.migrate(await store.load()))).toBe(true);
							break;
						}
						case "boot": {
							// tea's own run, handed the refused run's store: it never boots, and writes nothing.
							const booting = await exitOf(
								Effect.scoped(
									Effect.gen(function* () {
										const going = yield* run(tray, {
											ctx: undefined,
											store: handle.store(MACHINE, "old", Tray),
										});
										const runtime = yield* going.ready;
										yield* runtime.dispatch({type: "take"});
									}),
								),
							);
							// tea's Effect engine says so as a failed load, caused by the store's refusal.
							const why = Exit.isFailure(booting) ? Cause.squash(booting.cause) : null;
							expect(why).toBeInstanceOf(StoreFailed);
							expect(why).toMatchObject({operation: "load"});
							expect((why as StoreFailed).cause).toBeInstanceOf(StoreRefusedError);
							break;
						}
						case "start": {
							const called = await go(call(trays, {}, {keeping: {id: RUN, storage}}));
							expect(called).toMatchObject({kind: "called", ended: {kind: "ended"}});
							handle = await go(storage.open(RUN, null));
							break;
						}
						case "save":
							await handle.store(MACHINE, step.id, Tray).save(step.state);
							break;
						case "clear":
							await go(handle.clear(MACHINE, step.id));
							break;
						case "close":
							await go(handle.close("in"));
							break;
						case "sent":
							sent += 1;
							await go(handle.sent("out", sent, {n: sent}));
							break;
						case "end":
							await go(handle.end("ended"));
							break;
					}
					expect(runBytes(bytes, RUN, MACHINE, "old")).toEqual(planted);
					// Booted from nothing, or from a tray this code saved: never from older code's bytes.
					expect(booted.filter((b) => b !== null && Exit.isFailure(decodeTray(b)))).toEqual([]);
				}
				const last = await go(open().open(RUN, null));
				expect(last.found.machines).toContainEqual({machine: MACHINE, id: "old"});
				expect(await go(last.read(MACHINE, "old", OlderTray))).toEqual(old);
			}),
			FEW,
		);
		expect([...tried].sort()).toEqual(
			[
				"boot",
				"clear",
				"close",
				"end",
				"list",
				"load",
				"read",
				"reopen",
				"restart",
				"save",
				"sent",
				"start",
			].sort(),
		);
	});

	it("the law is seen to fail on a planted mistake: a store that loads on trust, as before this rule, boots older code's bytes", async () => {
		const {open} = place();
		const handle = await go(open().open(RUN, null));
		await handle.store(MACHINE, "old", OlderTray).save({phase: "holding", count: 2});
		const store = handle.store(MACHINE, "old", Tray);
		const trusting = {...store, migrate: (raw: unknown) => raw as Tray | null};
		booted.length = 0;
		// tea saves the state its init made from the bytes, and that save dies on the older key: by
		// then the machine was booted with them, which is what the law above rules out.
		await exitOf(
			Effect.scoped(
				Effect.gen(function* () {
					const going = yield* run(tray, {ctx: undefined, store: trusting});
					yield* going.ready;
				}),
			),
		);
		expect(booted.filter((b) => b !== null && Exit.isFailure(decodeTray(b)))).toEqual([
			{phase: "holding", count: 2},
		]);
	});
});

// ---------------------------------------------------------------- law: every reachable state is kept

type Msg = MsgOf<typeof tray>;
const table: MsgArbitraryTable<Msg> = {
	put: arbRecordMsg("put", {name, n: fc.integer({min: -1000, max: 1000})}),
	take: fc.constant({type: "take"} as const),
	note: arbRecordMsg("note", {key, text: name}),
};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 30});

const ctx = stubCtxThrowingProxy<undefined>();
/** Every state `machine` reaches from its init, by any list of Msgs, saves and loads back equal. */
const keepsEvery = (machine: typeof tray) =>
	fc.assert(
		fc.asyncProperty(lists, async (msgs) => {
			const {states} = foldEvents(machine, ctx, null, msgs);
			const handle = await go(place().open().open(RUN, null));
			const store = handle.store(MACHINE, "t", Tray);
			for (const state of states) {
				await store.save(state);
				expect(store.migrate(await store.load())).toEqual(state);
			}
		}),
		OPTS,
	);

/** A planted mistake: the first item put is the whole Msg, its `type` with it, a key the schema lacks. */
const keepsTheMsg: typeof tray = {
	...tray,
	update: {
		...tray.update,
		put: (s, m) =>
			s.phase === "empty"
				? [{phase: "holding", top: m, items: [], notes: {}, left: null}, []]
				: tray.update.put(s, m),
	},
};

describe("the toy's own states", () => {
	it("every state the tray reaches from its init saves and loads back equal, so the laws above are on a schema that fits its machine", async () => {
		await keepsEvery(tray);
	});

	it("the law is seen to fail on a planted mistake: a tray that keeps a whole Msg in its state dies at its first save", async () => {
		await expect(keepsEvery(keepsTheMsg)).rejects.toThrow(
			'Counterexample: [[{"type":"put","name":"cup","n":0}]]',
		);
	});
});
