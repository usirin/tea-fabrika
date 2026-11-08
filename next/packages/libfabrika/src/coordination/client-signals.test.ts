import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {p18Ids, p18Reason} from "../client/tile.test-support.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {type Entry, lineFor, valueFor} from "../data/log.ts";
import {ProcessManager} from "./process-manager.ts";
import {BRAIN, brain, first, from, ids, manager, storage} from "./process.test-support.ts";
import {clientInbox, Down, ProcessTable, Recipient, signalId} from "./process.ts";

const options = {seed: 119120, numRuns: 40};
const send = Schema.TaggedStruct("send", {m: Schema.Json});
const classify = (
	table: ProcessTable,
	entry: Entry,
	m: unknown,
	to: typeof Recipient.cases.client.Type,
) => table.deliverClient(entry, m, to);
const check = (answer: string, expected: string) => expect(answer).toBe(expected);

describe("P18 client signals share P33 authority", () => {
	const authority = async (deliver = classify) => {
		await fc.assert(
			fc.asyncProperty(p18Ids, p18Reason, fc.integer({min: 1, max: 4}), async (v, why, rounds) => {
				const store = storage();
				const to = Recipient.cases.client.make({client: v.client, session: v.sessionA});
				await Effect.runPromise(
					Effect.gen(function* () {
						const processes = yield* ProcessManager;
						yield* processes.start(first(), from());
						for (let round = 1; round <= rounds; round++) {
							yield* processes.monitor(v.refA, v.processA, from());
							if (round < rounds) yield* processes.demonitor(v.refA, from());
						}
						yield* processes.exit(v.processA, why, from());
					}).pipe(
						Effect.provide(manager(store, {...brain(), recipient: to}, ids(v.processA).next)),
					),
				);
				store.reopen();
				const table = new ProcessTable(store.rows(), BRAIN);
				const entry = store.rows().find((e) => e.id === signalId(to, v.refA, rounds))!;
				const m = Schema.decodeUnknownSync(send)(valueFor(entry)).m;
				check(deliver(table, entry, m, to), "signal");
				check(deliver(table, {...entry, by: "SHA256:forged"}, m, to), "mail");
				check(deliver(table, {...entry, id: "ordinary-mail"}, m, to), "mail");
				const down = Schema.decodeUnknownSync(Down)(m);
				for (const bad of [
					null,
					{},
					{_tag: "DOWN"},
					{...down, why: 4},
					{...down, process: v.processB},
					{...down, ref: v.refB},
				])
					check(deliver(table, entry, bad, to), "mail");
				for (const recipient of [
					Recipient.cases.client.make({...to, session: v.sessionB}),
					Recipient.cases.client.make({...to, client: `other-${v.client}`}),
				])
					check(deliver(table, entry, m, recipient), "drop");
				if (rounds > 1)
					check(deliver(table, {...entry, id: signalId(to, v.refA, rounds - 1)}, m, to), "drop");
				check(deliver(new ProcessTable([], BRAIN), entry, m, to), "mail");
			}),
			options,
		);
	};
	it("checks writer, ID, round, target, ref and exact recipient over real SQLite history", () =>
		authority());

	it("cancel flushes delivery, retains history and renews references in a later round", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.integer({min: 1, max: 4}), async (v, repeats) => {
				const store = storage();
				const to = Recipient.cases.client.make({client: v.client, session: v.sessionA});
				await Effect.runPromise(
					Effect.gen(function* () {
						const process = yield* ProcessManager;
						yield* process.monitor(v.refA, v.processA, from()); // absent => noproc
						const before = store.rows();
						for (let n = 0; n < repeats; n++) yield* process.demonitor(v.refA, from());
						const canceled = new ProcessTable(store.rows(), BRAIN);
						const old = before.find((e) => e.id === signalId(to, v.refA, 1))!;
						const m = Schema.decodeUnknownSync(send)(valueFor(old)).m;
						check(classify(canceled, old, m, to), "drop");
						expect(store.rows().filter((e) => before.some((b) => b.rev === e.rev))).toEqual(before);
						expect(canceled.watching(to)).toEqual([]);
						yield* process.monitor(v.refA, v.processA, from());
						const current = new ProcessTable(store.rows(), BRAIN);
						check(classify(current, old, m, to), "drop");
						const fresh = store.rows().find((e) => e.id === signalId(to, v.refA, 2))!;
						check(
							classify(current, fresh, Schema.decodeUnknownSync(send)(valueFor(fresh)).m, to),
							"signal",
						);
						expect(current.watching(to)).toEqual([{ref: v.refA, process: v.processA}]);
					}).pipe(Effect.provide(manager(store, {...brain(), recipient: to}))),
				);
			}),
			options,
		);
	});

	it("ordinary and malformed mail never gains signal authority", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.jsonValue(), async (v, m) => {
				const store = storage();
				const to = Recipient.cases.client.make({client: v.client, session: v.sessionA});
				await Effect.runPromise(
					LedgerTransaction.use((tx) =>
						tx.transact((turn) =>
							turn.append(clientInbox(v.client), "plain-mail", lineFor(from(), send.make({m}))),
						),
					).pipe(Effect.provide(manager(store))),
				);
				const table = new ProcessTable(store.rows(), BRAIN);
				check(classify(table, store.rows()[0]!, m, to), "mail");
			}),
			options,
		);
	});

	it("plants: trusting every DOWN or accepting another session fails the same SQLite authority law", async () => {
		await expect(authority(() => "signal")).rejects.toMatchObject({
			cause: {name: "AssertionError"},
		});
		await expect(
			authority((table, entry, m, to) => {
				// Plant only the session comparison: all other checks remain the real P18 checks.
				const down = Schema.decodeUnknownResult(Down)(m);
				return down._tag === "Success" && down.success.to._tag === "client"
					? table.deliverClient(entry, m, down.success.to)
					: classify(table, entry, m, to);
			}),
		).rejects.toMatchObject({cause: {name: "AssertionError"}});
	});
});
