import {
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {queue, queueKind, type Waiting} from "./queue.ts";

// The work queue as its kind keeps it, on tea's pbt: every state `queue` reaches from its init,
// from a fresh start and from a kept one, driven by any list of its Msgs, saves through the schema
// `queueKind` declares and loads back equal. A start after a kill reads the queue back through that
// schema, and works what it finds: a state it cannot read is work lost.

type Machine = typeof queue;
type Msg = MsgOf<Machine>;

const ctx = stubCtxThrowingProxy<undefined>();
/** A few items, so one is told twice, done while it waits, and dropped while it is worked. */
const item = fc.constantFrom("o/r#1", "o/r#2", "o/r#3", "o/r#4");
/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	told: arbRecordMsg("told", {item}),
	done: arbRecordMsg("done", {item}),
	cleared: arbRecordMsg("cleared", {item}),
	dropped: arbRecordMsg("dropped", {item}),
};
const lists = fc.array(arbMsg(table, {weights: {told: 3}}), {maxLength: 30, size: "max"});
/** A queue a run kept before it was killed: one item worked and owed its tidy-up, two waiting. */
const KEPT: Waiting = {items: ["o/r#2", "o/r#3"], clearing: ["o/r#1"]};

/** Every queue `machine` reaches from `loaded`, saved through the kind's schema and loaded back. */
const keepsEvery = (machine: Machine, loaded: Waiting | null, runs = 150) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("build:r1", null));
			const store = handle.store("queue", "queue", queueKind.state);
			for (const s of foldEvents(machine, ctx, loaded, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
			}
		}),
		{numRuns: runs, seed: 1},
	);

describe("the work queue is kept", () => {
	it("every queue it reaches, from a fresh start and from a kept one, saves and loads back equal", async () => {
		await keepsEvery(queue, null);
		await keepsEvery(queue, KEPT);
	});

	it("a queue kept before `clearing` was there reads with none owed, and every queue after it is kept", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uniqueArray(item, {maxLength: 4}), lists, async (items, list) => {
				const handle = await Effect.runPromise(memoryStorage().open("build:r1", null));
				const Older = Schema.Struct({items: Schema.Array(Schema.String)});
				await handle.store("queue", "queue", Older).save({items});
				const store = handle.store("queue", "queue", queueKind.state);
				const loaded = store.migrate(await store.load());
				expect(loaded).toEqual({items, clearing: []});
				for (const s of foldEvents(queue, ctx, loaded as Waiting, list).states) {
					await store.save(s);
					expect(store.migrate(await store.load())).toEqual(s);
				}
			}),
			{numRuns: 60, seed: 1},
		);
	});

	it("the law is seen to fail on a planted mistake: a queue that keeps each Msg it was told dies at its first save", async () => {
		const keepsTheMsg: Machine = {
			...queue,
			update: {
				...queue.update,
				told: (s, m) => [{...s, items: [...s.items, m.item], last: m} as Waiting, []],
			},
		};
		await expect(keepsEvery(keepsTheMsg, null, 20)).rejects.toThrow(/Counterexample/);
	});
});
