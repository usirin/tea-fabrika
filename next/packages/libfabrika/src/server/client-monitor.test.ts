import {Effect, Layer, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {p18Ids} from "../client/tile.test-support.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {
	BRAIN,
	brain,
	data,
	first,
	from,
	ids,
	manager,
	storage,
} from "../coordination/process.test-support.ts";
import {clientInbox} from "../coordination/process.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell} from "../data/ledger.ts";
import {lineFor, PAGE} from "../data/log.ts";

const options = {seed: 119120, numRuns: 30};
const mail = Schema.TaggedStruct("send", {m: Schema.Json});
const scanned = (
	rows: ReadonlyArray<{readonly rev: number}>,
	after: number,
	page: {readonly after: number},
) => {
	const expected = rows.filter((e) => e.rev > after).slice(0, PAGE);
	expect(page.after).toBe(expected.at(-1)?.rev ?? after);
};
const retained = <A>(before: ReadonlyArray<A>, after: ReadonlyArray<A>) => {
	for (const entry of before) expect(after).toContainEqual(entry);
};

describe("P18 authenticated ClientMonitor", () => {
	// Plants: choose to/by/inbox from public params instead of the checked connection binding.
	it("public routing refuses recipient, session, writer and inbox overrides before any write", async () => {
		const {ClientMonitor} = await import("./client-monitor.ts");
		const {routeClientMonitor} = await import("./client.ts");
		await fc.assert(
			fc.asyncProperty(
				p18Ids,
				fc.constantFrom("client", "session", "to", "by", "writer", "inbox"),
				async (v, field) => {
					const store = storage();
					const binding = {client: v.client, session: v.sessionA, by: BRAIN};
					const layer = ClientMonitor.layer(binding, ids(v.processB).next).pipe(
						Layer.provideMerge(data(store.sql)),
					);
					await Effect.runPromise(
						Effect.gen(function* () {
							for (const [method, params] of [
								["process.monitor", {pid: v.processA, ref: v.refA}],
								["process.demonitor", {ref: v.refA}],
								["client.inbox", {after: 0}],
								["client.wait", {after: 0}],
							] as const) {
								const before = store.rows();
								const answer = yield* routeClientMonitor(
									method,
									{
										...params,
										[field]: field === "to" ? {client: "other", session: v.sessionB} : "other",
									},
									from(),
								);
								expect(answer._tag).toBe("refused");
								expect(store.rows()).toEqual(before);
							}
							yield* (yield* ClientMonitor).monitor(v.refA, v.processA, from());
							const page = yield* (yield* ClientMonitor).read(0);
							expect(page.letters).toHaveLength(1);
							expect(page.letters[0]?.m.to).toMatchObject({
								_tag: "client",
								client: v.client,
								session: v.sessionA,
							});
						}).pipe(Effect.provide(layer)),
					);
				},
			),
			options,
		);
	});

	// Plants: delete canceled history, or cancel watches by client without checking session.
	it("demonitor flushes queued signals without deleting rows; delayed close touches only its session", async () => {
		const {ClientMonitor} = await import("./client-monitor.ts");
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.boolean(), async (v, closeFirst) => {
				const store = storage();
				const oldLayer = ClientMonitor.layer(
					{client: v.client, session: v.sessionA, by: BRAIN},
					ids(v.processA).next,
				).pipe(Layer.provideMerge(data(store.sql)));
				const newLayer = ClientMonitor.layer(
					{client: v.client, session: v.sessionB, by: BRAIN},
					ids(v.processB).next,
				).pipe(Layer.provideMerge(data(store.sql)));
				await Effect.runPromise(
					Effect.gen(function* () {
						const old = yield* ClientMonitor.pipe(Effect.provide(oldLayer));
						const current = yield* ClientMonitor.pipe(Effect.provide(newLayer));
						yield* old.monitor(v.refA, v.processA, from());
						yield* current.monitor(v.refB, v.processA, from());
						const history = store.rows();
						if (closeFirst) yield* old.close(from());
						else yield* old.demonitor(v.refA, from());
						yield* old.close(from());
						expect((yield* old.read(0)).letters).toEqual([]);
						expect(
							(yield* current.read(0)).letters.map((letter: {m: {ref: string}}) => letter.m.ref),
						).toEqual([v.refB]);
						expect(store.rows().filter((e) => history.some((h) => h.rev === e.rev))).toEqual(
							history,
						);
						retained(history, store.rows());
						store.reopen();
						expect((yield* current.read(0)).letters).toHaveLength(1);
					}),
				);
			}),
			options,
		);
	});

	// Plants: advance only over accepted signals, or stop scanning after the first raw page.
	it("raw paging advances across plain, malformed and canceled mail, including file reopen", async () => {
		const {ClientMonitor} = await import("./client-monitor.ts");
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.integer({min: PAGE + 1, max: PAGE * 2 + 3}), async (v, count) => {
				const store = storage();
				const layer = ClientMonitor.layer(
					{client: v.client, session: v.sessionA, by: BRAIN},
					ids(v.processA).next,
				).pipe(Layer.provideMerge(data(store.sql)));
				await Effect.runPromise(
					Effect.gen(function* () {
						const tx = yield* LedgerTransaction;
						yield* tx.transact((turn) => {
							for (let i = 0; i < count; i++)
								turn.append(
									clientInbox(v.client),
									`junk-${i}`,
									lineFor(from(), mail.make({m: i % 2 ? {_tag: "DOWN"} : {text: "mail"}})),
								);
						});
						const monitor = yield* ClientMonitor;
						yield* monitor.monitor(v.refA, v.processA, from());
						let after = 0,
							more = true,
							pages = 0;
						const found: Array<string> = [];
						while (more) {
							const page = yield* monitor.read(after);
							scanned(
								store.rows().filter((e) => e.stream === clientInbox(v.client)),
								after,
								page,
							);
							expect(page.after).toBeGreaterThan(after);
							expect(
								store
									.rows()
									.filter(
										(e) =>
											e.stream === clientInbox(v.client) && e.rev > after && e.rev <= page.after,
									).length,
							).toBeLessThanOrEqual(PAGE);
							found.push(...page.letters.map((letter: {m: {ref: string}}) => letter.m.ref));
							after = page.after;
							more = page.more;
							pages++;
							expect(pages).toBeLessThanOrEqual(4);
							store.reopen();
						}
						expect(found).toEqual([v.refA]);
						expect((yield* monitor.read(after)).letters).toEqual([]);
					}).pipe(Effect.provide(layer)),
				);
			}),
			{...options, numRuns: 8},
		);
	});

	// Plants: register after replying, restore an answered wait, or keep registration in memory.
	it("wait registration survives reopen and racing appends, rings and duplicate replies", async () => {
		const {ClientMonitor} = await import("./client-monitor.ts");
		await fc.assert(
			fc.asyncProperty(
				p18Ids,
				fc.boolean(),
				fc.nat({max: 3}),
				async (v, appendFirst, duplicates) => {
					const store = storage();
					const rings: Array<{to: string; stream: string; rev: number}> = [];
					const bell = Layer.succeed(Doorbell, {
						ring: (to, stream, rev) =>
							Effect.sync(() => {
								rings.push({to, stream, rev});
							}),
					});
					const layer = ClientMonitor.layer(
						{client: v.client, session: v.sessionA, by: BRAIN},
						ids(v.processB).next,
					).pipe(Layer.provideMerge(data(store.sql, bell)));
					await Effect.runPromise(
						Effect.gen(function* () {
							const monitor = yield* ClientMonitor;
							if (appendFirst) yield* monitor.monitor(v.refA, v.processA, from());
							const answer = yield* monitor.wait(0);
							expect(answer._tag).toBe(appendFirst ? "ready" : "parked");
							store.reopen();
							if (!appendFirst) yield* monitor.monitor(v.refA, v.processA, from());
							if (!appendFirst)
								expect(rings).toMatchObject([{to: "gateway:test", stream: clientInbox(v.client)}]);
							for (let i = 0; i <= duplicates; i++) {
								expect((yield* monitor.wait(0))._tag).toBe("ready");
								expect((yield* monitor.read(0)).letters).toHaveLength(1);
							}
						}).pipe(Effect.provide(layer)),
					);
				},
			),
			options,
		);
	});

	it("real P33 exit reaches only the authenticated binding and canceled signals stay in history", async () => {
		const {ClientMonitor} = await import("./client-monitor.ts");
		await fc.assert(
			fc.asyncProperty(p18Ids, async (v) => {
				const store = storage();
				const base = data(store.sql);
				const clients = ClientMonitor.layer(
					{client: v.client, session: v.sessionA, by: BRAIN},
					ids(v.processB).next,
				).pipe(Layer.provideMerge(base));
				const processes = manager(store, brain(), ids(v.processA).next);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* ProcessManager.use((pm) => pm.start(first(), from())).pipe(
							Effect.provide(processes),
						);
						const monitor = yield* ClientMonitor;
						yield* monitor.monitor(v.refA, v.processA, from());
						yield* ProcessManager.use((pm) => pm.exit(v.processA, "crashed", from())).pipe(
							Effect.provide(processes),
						);
						const page = yield* monitor.read(0);
						expect(
							page.letters.map((letter: {m: {process: string; why: string}}) => [
								letter.m.process,
								letter.m.why,
							]),
						).toEqual([[v.processA, "crashed"]]);
						yield* monitor.demonitor(v.refA, from());
						expect((yield* monitor.read(0)).letters).toEqual([]);
						expect(
							store.rows().filter((e) => e.stream === clientInbox(v.client) && e._tag === "send"),
						).toHaveLength(1);
					}).pipe(Effect.provide(clients)),
				);
			}),
			options,
		);
	});

	it("plants: a stalled cursor and deleted history fail the same checks over real SQLite rows", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.integer({min: PAGE + 1, max: PAGE * 2}), async (v, count) => {
				const store = storage();
				await Effect.runPromise(
					LedgerTransaction.use((tx) =>
						tx.transact((turn) => {
							for (let n = 0; n < count; n++)
								turn.append(
									clientInbox(v.client),
									`plant-mail-${n}`,
									lineFor(from(), mail.make({m: {text: "mail"}})),
								);
						}),
					).pipe(Effect.provide(data(store.sql))),
				);
				const history = store.rows();
				expect(() => scanned(history, 0, {after: 0})).toThrow();
				expect(() => retained(history, history.slice(1))).toThrow();
			}),
			{...options, numRuns: 3},
		);
	});
});
