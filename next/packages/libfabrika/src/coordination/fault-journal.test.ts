// P27a, next/. Journal phases, cuts and exact receipts. No outside action is retried by tests.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import * as fc from "fast-check";
import {
	faultWorld,
	forSchema,
	FROM,
	LAW,
	Positive,
	production,
	request,
	SEED,
	TestProcessId,
	withIds,
	type JournalModule,
	type NemesisModule,
} from "../chaos/p27.test-support.ts";
import {IdGenerator} from "../data/id.ts";
import {brainOnly} from "./process.ts";

describe("P27a fault journal", () => {
	it.effect.prop(
		"plant: allow manufactured chaos facts; runtime streams and tags are reserved",
		{
			experiment: Schema.NonEmptyString,
			suffix: Schema.NonEmptyString,
		},
		({experiment, suffix}) =>
			Effect.sync(() => {
				for (const tag of ["chaos.selected", "chaos.did"]) {
					expect(brainOnly({stream: `chaos/${experiment}`, id: suffix, tag})).toBe(true);
					expect(brainOnly({stream: "ordinary", id: suffix, tag})).toBe(true);
				}
				expect(brainOnly({stream: `chaos/${experiment}`, id: suffix, tag: "ordinary"})).toBe(true);
			}),
		LAW,
	);

	it.effect("plant: forget an armed phase after reopen or change its target on retry", () =>
		Effect.gen(function* () {
			yield* production<JournalModule>("../coordination/fault-journal.ts", "FaultJournal");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
			yield* forSchema(
				Schema.Struct({fault: N.Fault, target: N.Target, repeats: Positive}),
				({fault, target, repeats}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const w = yield* faultWorld();
							const r = yield* request(fault, target);
							const context = {
								cmd: "saved-cmd",
								process: w.descriptor.id,
								name: "chaos:1",
								build: FROM.build,
								parent: r.tick,
								traceId: FROM.traceId,
							};
							yield* w.journal((j) => j.begin(r, context));
							const saved = yield* w.journal((j) => j.read(r.tick));
							expect(saved).not.toBeNull();
							for (let i = 0; i < repeats; i++) {
								yield* w.reopen;
								yield* w.journal((j) => j.begin(r, context));
							}
							expect(yield* w.journal((j) => j.read(r.tick))).toEqual(saved);
							const altered = {...r, target: {...r.target, client: `${target.client}-replacement`}};
							expect(yield* Effect.flip(w.journal((j) => j.begin(altered, context)))).toMatchObject(
								{why: "conflict"},
							);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("plant: refire uncertain actions during replay or answer delivery", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fault");
			yield* forSchema(
				Schema.Struct({fault: N.Fault, target: N.Target, repeats: Positive}),
				({fault, target, repeats}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const w = yield* faultWorld();
							const r = yield* request(fault, target);
							yield* w.fire(r);
							const calls = w.calls.length;
							const did = (yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did");
							for (let i = 0; i < repeats; i++) {
								yield* w.reopen;
								yield* w.journal((j) => j.resume);
								yield* w.fire(r);
							}
							expect(w.calls).toHaveLength(calls);
							expect(
								(yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did"),
							).toEqual(did);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("plant: repeat an uncertain outside action after reopening its saved arm", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(Schema.Struct({target: N.Target, repeats: Positive}), ({target, repeats}) =>
				Effect.scoped(
					Effect.gen(function* () {
						const session = yield* (yield* IdGenerator).next(TestProcessId);
						const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
							_tag: "client",
							client: target.client,
							session,
							key: target.key,
							gateway: "gateway-a",
						});
						const fault = yield* Schema.decodeUnknownEffect(N.Fault)({
							_tag: "drop_socket",
							client: target.client,
						});
						const w = yield* faultWorld({resolve: [hit]});
						const r = yield* request(fault, target);
						yield* w.fire(r);
						expect(w.calls).toHaveLength(1);
						for (let i = 0; i < repeats; i++) {
							yield* w.reopen;
							yield* w.journal((j) => j.resume);
							yield* w.fire(r);
						}
						expect(w.calls).toHaveLength(1);
						expect(
							(yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did"),
						).toHaveLength(0);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect("plant: storage failure proceeds or corrupt saved work starts afresh", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
			yield* forSchema(
				Schema.Struct({fault: N.Fault, target: N.Target, slot: Positive}),
				({fault, target, slot}) =>
					Effect.scoped(
						Effect.gen(function* () {
							for (const [at, after] of fc
								.sample(fc.tuple(fc.integer({min: 0, max: 16}), fc.boolean()), {
									seed: SEED,
									numRuns: 100,
								})
								.slice(slot - 1, slot)) {
								const w = yield* faultWorld();
								const r = yield* request(fault, target);
								w.stores.journal.cut.at = at;
								w.stores.journal.cut.after = after;
								const exit = yield* Effect.exit(w.fire(r));
								w.stores.journal.cut.at = -1;
								yield* w.reopen;
								if (Exit.isFailure(exit)) expect(w.calls).toHaveLength(0);
								if ((yield* w.journal((j) => j.read(r.tick))) === null) {
									yield* w.journal((j) =>
										j.begin(
											r,
											w.contexts[0] ?? {
												cmd: "saved-cmd",
												process: w.descriptor.id,
												name: "chaos:1",
												build: FROM.build,
												parent: r.tick,
												traceId: FROM.traceId,
											},
										),
									);
								}
								// Corrupt the actual saved payload, regardless of the builder's table/column names.
								const db = w.stores.journal.db();
								const tables = db
									.prepare(
										"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
									)
									.all();
								for (const row of tables) {
									const name = String(row.name).replaceAll('"', '""');
									const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
									for (const col of columns.filter(
										(c) => String(c.type).toUpperCase() === "TEXT" && Number(c.pk) === 0,
									)) {
										const column = String(col.name).replaceAll('"', '""');
										db.exec(`UPDATE "${name}" SET "${column}" = 'not-json'`);
									}
								}
								const before = w.calls.length;
								expect(yield* Effect.flip(w.journal((j) => j.resume))).toMatchObject({
									why: "bad_row",
								});
								expect(w.calls).toHaveLength(before);
							}
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect(
		"plant: accept another tick, session, instance or stable letter in an observation",
		() =>
			Effect.gen(function* () {
				const J = yield* production<JournalModule>(
					"../coordination/fault-journal.ts",
					"Observation",
				);
				const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
				yield* forSchema(Schema.Struct({fault: N.Fault, target: N.Target}), ({fault, target}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const w = yield* faultWorld();
							const r = yield* request(fault, target);
							const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
								_tag: "client",
								client: target.client,
								session: yield* (yield* IdGenerator).next(TestProcessId),
								gateway: "gateway-a",
								key: target.key,
							});
							const receipt = yield* Schema.decodeUnknownEffect(J.Observation)({
								tick: r.tick,
								hit,
								consumed: null,
								outcome: {_tag: "fired"},
								span: {process: w.descriptor.id, traceId: FROM.traceId, spanId: "0000000000000001"},
							});
							// Unsolicited receipts cannot create a completed action, even when their shape is valid.
							expect(yield* Effect.flip(w.journal((j) => j.observe(receipt)))).toMatchObject({
								why: "bad_input",
							});
						}),
					).pipe(withIds),
				);
			}),
	);
});
