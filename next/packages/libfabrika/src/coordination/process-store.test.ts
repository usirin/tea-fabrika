// P11 SQL adapter contract. One object stores {saved, turn, cmds}; load is null before its first save.
// layer(sql, {process}) needs Ledger only for record(id, RuntimeRecord, From).
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import type {LedgerError} from "../data/ledger.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {processId} from "../id.test-support.ts";
import * as Id from "../id.ts";
import {type From} from "./mailbox.ts";
import {
	Checkpoint as CheckpointSchema,
	Placed,
	ProcessStore,
	RuntimeRecord,
} from "./process-store.ts";
import {Activity} from "./process.ts";

// fast-check 4.10.2's default JSON has no hard depth bound. Effect 4.1.1's
// recursive Schema.Json spends one shared size budget, so no finite size
// preserves that range. Keep the old generator for this input only.
const unboundedJson = Arbitrary.schema(
	Schema.Int.check(Schema.isBetween({minimum: -2_147_483_648, maximum: 2_147_483_647})),
).pipe(
	Arbitrary.map((seed) =>
		Schema.decodeUnknownSync(Schema.Json)(fc.sample(fc.jsonValue(), {seed, numRuns: 1})[0]),
	),
);

const PROCESS = Effect.runSync(processId);
const folder = mkdtempSync(join(tmpdir(), "p11-store-"));
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
let files = 0;
const database = () => {
	const path = join(folder, `${++files}.db`);
	let db = new DatabaseSync(path);
	opened.push(db);
	let backend = nodeSql(db);
	let fail = false;
	const sql: Sql = {
		exec: (q, ...values) => backend.exec(q, ...values),
		transaction: (f) =>
			backend.transaction(() => {
				const answer = f();
				if (fail) throw new Error("SQLITE_FULL at commit");
				return answer;
			}),
		size: () => backend.size(),
	};
	return {
		sql,
		db: () => db,
		arm: (on: boolean) => {
			fail = on;
		},
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			opened.push(db);
			backend = nodeSql(db);
		},
	};
};
const data = (sql: Sql) =>
	Ledger.sql(sql, {reader: "p11-store"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
const from: From = {
	by: "SHA256:brain",
	for: "person",
	sentAt: "2026-11-08T01:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "build-a",
};
const checkpoint: typeof CheckpointSchema.Type = {
	saved: {v: 1, build: "build-a", model: {count: 2}, after: 4},
	turn: null,
	cmds: [],
};
// Match 4ddc0ed7: full 32-bit v/cursor, build 0..10, unbounded JSON depth,
// and 0..5 Cmds. Size 12 below also retains nonempty strings of length 11..12.
const nat = (schema: typeof Placed.fields.pos) =>
	schema.check(Schema.isBetween({minimum: 0, maximum: 2_147_483_647}));
const checkpointArb = Arbitrary.all({
	saved: Arbitrary.all({
		v: Arbitrary.schema(
			CheckpointSchema.fields.saved.fields.v.check(
				Schema.isBetween({minimum: -2_147_483_648, maximum: 2_147_483_647}),
			),
		),
		build: Arbitrary.schema(
			CheckpointSchema.fields.saved.fields.build.check(Schema.isMaxLength(10)),
		),
		model: unboundedJson,
		after: Arbitrary.schema(nat(CheckpointSchema.fields.saved.fields.after)),
	}),
	turn: unboundedJson,
	cmds: Arbitrary.array(unboundedJson, {maxLength: 5}),
}).pipe(
	// JSON storage canonicalizes -0 to 0.
	Arbitrary.map((value): typeof CheckpointSchema.Type => JSON.parse(JSON.stringify(value))),
);
const options = {arbitrary: {seed: 119120, runs: 20, size: 12}};
// Effect 4.1.1 has no examples option; run the old input beside each generated input.
const examples =
	<A extends ReadonlyArray<unknown>, E, R>(
		cases: ReadonlyArray<A>,
		law: (...args: A) => Effect.Effect<unknown, E, R>,
	) =>
	(args: A) =>
		Effect.forEach([...cases, args], (input) => Effect.suspend(() => law(...input)), {
			discard: true,
			concurrency: 1,
		});
type Checkpoint = {
	readonly saved: {
		readonly v: number;
		readonly build: string;
		readonly model: unknown;
		readonly after: number;
	};
	readonly turn: unknown;
	readonly cmds: ReadonlyArray<unknown>;
};
type Store = {
	readonly load: Effect.Effect<Checkpoint | null, LedgerError>;
	readonly save: (value: Checkpoint) => Effect.Effect<void, LedgerError>;
	readonly record: (id: string, fact: unknown, from: From) => Effect.Effect<unknown, LedgerError>;
};

describe("P11 process storage", () => {
	it.effect.prop(
		"malformed checkpoints fail as bad_row without replacing the saved state",
		[checkpointArb],
		examples([[checkpoint]], (checkpoint: typeof CheckpointSchema.Type) => {
			const disk = database();
			return Effect.gen(function* () {
				const store = yield* ProcessStore;
				yield* store.save(checkpoint);
				expect(
					yield* Effect.flip(store.save({...checkpoint, saved: {...checkpoint.saved, v: "bad"}})),
				).toMatchObject({_tag: "LedgerError", why: "bad_row"});
				expect(yield* store.load).toEqual(checkpoint);
				disk
					.db()
					.prepare("UPDATE process_state SET checkpoint=? WHERE process=?")
					.run(JSON.stringify({...checkpoint, saved: {...checkpoint.saved, v: "bad"}}), PROCESS);
				expect(yield* Effect.flip(store.load)).toMatchObject({
					_tag: "LedgerError",
					why: "bad_row",
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			);
		}),
		options,
	);
	it.effect.prop(
		"plant, touch storage during Layer build: tables are created only by a call",
		[Schema.NonEmptyString.check(Schema.isMaxLength(12))],
		examples([[PROCESS]], (process: string) => {
			let calls = 0;
			const sql: Sql = {
				exec: () => {
					calls++;
					throw new Error("offline");
				},
				transaction: (f) => f(),
				size: () => 0,
			};
			return Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				expect(calls).toBe(0);
				expect(yield* Effect.flip(store.load)).toMatchObject({
					_tag: "LedgerError",
					why: "storage",
				});
				expect(calls).toBeGreaterThan(0);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(sql, {process}).pipe(Layer.provide(data(database().sql))),
				),
			);
		}),
		options,
	);
	it.effect.prop(
		"plant, keep state in memory: reopen retains version, build, cursor, turn and Cmd dispatch",
		[checkpointArb],
		examples([[checkpoint]], (checkpoint: typeof CheckpointSchema.Type) =>
			Effect.gen(function* () {
				const disk = database();
				const pending = {
					...checkpoint,
					turn: {
						_tag: "prepared",
						id: "letter-a",
						input: {type: "add", n: 3},
						parent: `in-${PROCESS}-2`,
						span: {traceId: from.traceId, spanId: "00f067aa0ba902b7"},
						sentAt: from.sentAt,
						seen: from.seen,
						next: {...checkpoint.saved, model: {count: 5}},
						cmds: [],
					},
					cmds: [
						{id: "stable-cmd", _tag: "dispatched", input: {type: "save", n: 2}, build: "build-a"},
					],
				};
				yield* Effect.gen(function* () {
					const store: Store = yield* ProcessStore;
					expect(yield* store.load).toBeNull();
					yield* store.save(pending);
				}).pipe(
					Effect.provide(
						ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
					),
				);
				disk.reopen();
				yield* Effect.gen(function* () {
					const store: Store = yield* ProcessStore;
					expect(yield* store.load).toEqual(pending);
				}).pipe(
					Effect.provide(
						ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
					),
				);
			}),
		),
		options,
	);
	it.effect.prop(
		"plant, save partial checkpoint: a failed transaction retains all original state",
		[checkpointArb],
		examples([[checkpoint]], (checkpoint: typeof CheckpointSchema.Type) => {
			const disk = database();
			return Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				yield* store.save(checkpoint);
				disk.arm(true);
				expect(
					yield* Effect.flip(
						store.save({
							...checkpoint,
							saved: {...checkpoint.saved, after: 9, model: {count: 9}},
						}),
					),
				).toMatchObject({why: "storage"});
				disk.arm(false);
				expect(yield* store.load).toEqual(checkpoint);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			);
		}),
		options,
	);
	it.prop(
		"plant, make runtime records arbitrary writes: only stepped and state.upgraded decode",
		[
			RuntimeRecord.cases.stepped.fields.input.check(Schema.isMaxLength(12)),
			nat(RuntimeRecord.cases.stepped.fields.pos),
			Schema.Array(
				RuntimeRecord.cases["state.upgraded"].fields.ran.value.check(Schema.isMaxLength(10)),
			).check(Schema.isMaxLength(8)),
		],
		(generated) => {
			for (const [input, pos, ran] of [["a", 2, ["one", "two"]], generated] as const) {
				const decode = Schema.decodeUnknownSync(RuntimeRecord);
				expect(decode({_tag: "stepped", input, pos, build: "build-a"})).toMatchObject({
					_tag: "stepped",
				});
				expect(
					decode({
						_tag: "state.upgraded",
						program: "counter",
						from: 1,
						to: 3,
						ran,
						build: "build-b",
					}),
				).toMatchObject({ran});
				for (const raw of [
					{_tag: "granted"},
					{_tag: "started"},
					{_tag: "stepped", input, pos: -pos - 1, build: "build-a"},
					{_tag: "stepped", input, pos: -1, build: "build-a"},
				])
					expect(() => decode(raw)).toThrow();
			}
		},
		{arbitrary: {seed: 119120, runs: 100, size: 12}},
	);
	it.effect.prop(
		"plant, append stepped twice: runtime record retries have the first placing and build",
		[
			RuntimeRecord.cases.stepped.fields.input.check(Schema.isMaxLength(12)),
			nat(RuntimeRecord.cases.stepped.fields.pos),
			RuntimeRecord.cases.stepped.fields.build.check(
				Schema.isPattern(/^[\x20-\x7e]+$/),
				Schema.isMaxLength(12),
			),
		],
		examples([["letter-a", 1, "build-a"]], (input: string, pos: number, build: string) => {
			const disk = database();
			return Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				const ledger = yield* Ledger;
				const fact = {_tag: "stepped", input, pos, build};
				const placed = yield* store.record("step:letter-a", fact, {...from, build});
				expect(yield* store.record("step:letter-a", fact, {...from, build})).toEqual(placed);
				const rows = yield* Stream.runCollect(ledger.read(PROCESS, 0));
				expect(rows).toHaveLength(1);
				expect(rows[0]).toMatchObject({
					_tag: "stepped",
					body: {input, pos},
					build,
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provideMerge(data(disk.sql))),
				),
			);
		}),
		options,
	);
	it.effect.prop(
		"selected stores keep checkpoints, first placings and valid activity",
		[
			checkpointArb,
			Arbitrary.schema(
				Schema.Struct({...Placed.fields, rev: nat(Placed.fields.rev), pos: nat(Placed.fields.pos)}),
			).pipe(
				Arbitrary.map((value) => ({
					...value,
					id: JSON.stringify(value.id),
					rev: value.rev + 0,
					pos: value.pos + 0,
				})),
			),
			// ProcessId's compatibility filter is opaque to generation; use its source schema.
			// Id.Process keeps every free base32 position, both version chars and all eight variants.
			Arbitrary.schema(
				Schema.Union([
					Schema.Struct({...Activity.cases.idle.fields, process: Id.Process}),
					Schema.Struct({...Activity.cases.stepping.fields, process: Id.Process}),
				]),
			).pipe(Arbitrary.filter((value) => value.process !== PROCESS)),
		],
		([value, placed, activity]) => {
			const disk = database();
			const values = new Map<string, unknown>();
			const storage = {
				get: (key: string) => Effect.sync(() => values.get(key)),
				put: (key: string, value: unknown) =>
					Effect.sync(() => {
						values.set(key, value);
					}),
				sync: () => Effect.void,
			};
			return Effect.gen(function* () {
				const store = yield* ProcessStore;
				const selected = yield* store.select(activity.process);
				expect(selected).toBeDefined();
				expect(yield* Effect.exit(selected.load)).toMatchObject({_tag: "Success", value: null});
				expect(yield* Effect.exit(selected.placed(placed.id))).toMatchObject({
					_tag: "Success",
					value: null,
				});
				expect(yield* selected.placedByAny(placed.id)).toBeNull();
				expect((yield* Effect.exit(store.save(value, [placed])))._tag).toBe("Success");
				expect(yield* store.placed(placed.id)).toEqual(placed);
				expect(yield* store.placedByAny(placed.id)).toEqual(placed);
				expect(yield* selected.load).toBeNull();
				expect(yield* selected.placed(placed.id)).toBeNull();
				expect(yield* selected.placedByAny(placed.id)).toEqual(placed);
				yield* selected.save({...value, turn: {selected: true}});
				expect(yield* selected.load).toEqual({...value, turn: {selected: true}});
				expect(yield* store.load).toEqual(value);
				expect(yield* selected.readActivity).toBeUndefined();
				yield* selected.activity(activity);
				expect(yield* selected.readActivity).toEqual(activity);
				values.set("activity", {_tag: "stepping", process: "bad"});
				expect(yield* Effect.exit(Effect.flip(selected.readActivity))).toMatchObject({
					_tag: "Success",
					value: {_tag: "LedgerError", why: "bad_row"},
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS, storage}).pipe(
						Layer.provide(data(disk.sql)),
					),
				),
			);
		},
		options,
	);
});
