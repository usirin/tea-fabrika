// P27a, next/. Controlled outside receipts, real live coordinator and permanent records.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import * as fc from "fast-check";
import {IdGenerator, InputId} from "../data/id.ts";
import {SpanSink} from "../data/sink.ts";
import {
	faultWorld,
	forSchema,
	FROM,
	Positive,
	production,
	request,
	SEED,
	TestProcessId,
	TestInstanceId,
	withIds,
	type EntryModule,
	type Hit,
	type JournalModule,
	type LiveModule,
	type NemesisModule,
} from "./p27.test-support.ts";

describe("P27a live faults", () => {
	it.effect("plant: expose off, missing-adapter or unsigned revoke actions as ready", () =>
		Effect.gen(function* () {
			yield* production<LiveModule>("./live.ts", "LiveNemesis");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Target");
			yield* forSchema(N.Target, (target) =>
				Effect.scoped(
					Effect.gen(function* () {
						const off = yield* faultWorld({chaos: {_tag: "off"}});
						const offers = yield* N.Nemesis.use((n) => n.offers(target)).pipe(
							Effect.provide(off.live()),
						);
						expect(offers.filter((o) => o._tag === "ready")).toEqual([]);
						const live = yield* faultWorld();
						const available = yield* N.Nemesis.use((n) => n.offers(target)).pipe(
							Effect.provide(live.live()),
						);
						expect(available.some((o) => o.fault === "revoke_key" && o._tag === "ready")).toBe(
							false,
						);
						expect(
							available.filter((o) => o._tag === "unavailable").every((o) => Boolean(o.why)),
						).toBe(true);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect("plant: accept a newer session or instance receipt for an old exact hit", () =>
		Effect.gen(function* () {
			yield* production<LiveModule>("./live.ts", "LiveNemesis");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(
				Schema.Struct({
					target: N.Target,
					replace: Schema.Literals(["session", "instance", "letter"]),
				}),
				({target, replace}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const ids = yield* IdGenerator;
							const session = yield* ids.next(TestProcessId);
							const instance = yield* ids.next(TestInstanceId);
							const letter = yield* ids.next(InputId);
							const raw =
								replace === "session"
									? {
											_tag: "client",
											client: target.client,
											session,
											gateway: "gateway-a",
											key: target.key,
										}
									: replace === "instance"
										? {
												_tag: "object",
												target: "process",
												name: target.name,
												instance,
												process: target.process,
											}
										: {_tag: "step", name: target.name, process: target.process, letter, times: 1};
							const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)(raw);
							const fault = yield* Schema.decodeUnknownEffect(N.Fault)(
								replace === "session"
									? {_tag: "drop_socket", client: target.client}
									: replace === "instance"
										? {_tag: "abort", target: "process", name: target.name}
										: {_tag: "fail_step", pid: target.process, times: 1},
							);
							const w = yield* faultWorld({resolve: [hit]});
							const r = yield* request(fault, target);
							yield* w.fire(r);
							const next =
								replace === "session"
									? yield* ids.next(TestProcessId)
									: replace === "instance"
										? yield* ids.next(TestInstanceId)
										: yield* ids.next(InputId);
							const wrong = {...hit, [replace]: next};
							const receipt = {
								tick: r.tick,
								hit: wrong,
								consumed: null,
								outcome: {_tag: "fired"},
								span: {process: w.descriptor.id, traceId: FROM.traceId, spanId: "0000000000000001"},
							};
							expect(yield* Effect.flip(w.journal((j) => j.observe(receipt)))).toMatchObject({
								why: "conflict",
							});
							expect(
								(yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did"),
							).toHaveLength(0);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("plant: abort_all succeeds after the first member or includes unrelated objects", () =>
		Effect.gen(function* () {
			yield* production<LiveModule>("./live.ts", "LiveNemesis");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(Schema.Struct({target: N.Target, count: Positive}), ({target, count}) =>
				Effect.scoped(
					Effect.gen(function* () {
						const ids = yield* IdGenerator;
						const hits: Hit[] = [];
						for (let i = 0; i < Math.max(2, count); i++)
							hits.push(
								yield* Schema.decodeUnknownEffect(N.FaultHit)({
									_tag: "object",
									target: "process",
									name: `${target.name}:${i}`,
									process: target.process,
									instance: yield* ids.next(TestInstanceId),
								}),
							);
						const w = yield* faultWorld({resolve: hits});
						const fault = yield* Schema.decodeUnknownEffect(N.Fault)({_tag: "abort_all"});
						const r = yield* request(fault, target);
						yield* w.fire(r);
						const order = fc.sample(
							fc.shuffledSubarray(hits, {minLength: hits.length, maxLength: hits.length}),
							{seed: SEED, numRuns: 1},
						)[0]!;
						for (let i = 0; i < order.length; i++) {
							yield* w.journal((j) =>
								j.observe({
									tick: r.tick,
									hit: order[i],
									consumed: null,
									outcome: {_tag: "fired"},
									span: {
										process: w.descriptor.id,
										traceId: FROM.traceId,
										spanId: String(i + 1).padStart(16, "0"),
									},
								}),
							);
							yield* w.reopen;
							yield* w.journal((j) => j.resume);
							const did = (yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did");
							expect(did).toHaveLength(i === order.length - 1 ? 1 : 0);
						}
						expect(w.calls.every((c) => c.request.target.name === target.name)).toBe(true);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect(
		"plant: flush before span end or omit failures; every fault phase reaches permanent records",
		() =>
			Effect.gen(function* () {
				yield* production<LiveModule>("./live.ts", "LiveNemesis");
				const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
				yield* forSchema(
					Schema.Struct({fault: N.Fault, target: N.Target, failed: Schema.Boolean}),
					({fault, target, failed}) =>
						Effect.scoped(
							Effect.gen(function* () {
								const w = yield* faultWorld();
								const r = yield* request(fault, target);
								w.control.flushFails = failed;
								const fire = yield* Effect.exit(w.fire(r));
								if (failed) {
									expect(Exit.isFailure(fire)).toBe(true);
									expect(w.calls).toHaveLength(0);
								}
								w.control.flushFails = false;
								yield* w.journal((j) => j.resume);
								const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
									_tag: "client",
									client: target.client,
									session: yield* (yield* IdGenerator).next(TestProcessId),
									gateway: "gateway-a",
									key: target.key,
								});
								const observation = {
									tick: r.tick,
									hit,
									consumed: r.tick,
									outcome: {_tag: "refused", why: "unreachable"},
									span: {
										process: w.descriptor.id,
										traceId: FROM.traceId,
										spanId: "0000000000000001",
									},
								};
								yield* Effect.exit(w.journal((j) => j.observe(observation)));
								const context = w.contexts[0];
								if (context !== undefined)
									yield* Effect.exit(
										w.complete({
											process: context.process,
											cmd: context.cmd,
											outcome: {_tag: "Err", error: {_tag: "NemesisError", why: "unreachable"}},
										}),
									);
								const evidence = yield* w.evidence;
								yield* Effect.gen(function* () {
									yield* Effect.exit(w.H.explainFaults(evidence));
									yield* SpanSink.use((sink) => sink.flush);
								}).pipe(
									Effect.annotateSpans({"fab.process": w.descriptor.id}),
									Effect.provide(w.base()),
								);
								yield* w.reopen;
								const spans = yield* w.permanent;
								for (const phase of [
									"chaos.fire",
									"chaos.observe",
									"chaos.complete",
									"chaos.check",
								]) {
									const rows = spans.filter((s) => s.name === phase);
									expect(rows.length, phase).toBeGreaterThan(0);
									expect(
										rows.every((s) => BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano)),
									).toBe(true);
								}
								expect(
									spans.some((s) => !s.ok && typeof s.attributes["error.type"] === "string"),
								).toBe(true);
							}),
						).pipe(withIds),
				);
			}),
	);

	it.effect("plant: throwing constructors for outside receipts and handler replies", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
			const J = yield* production<JournalModule>("../coordination/fault-journal.ts", "Observation");
			const E = yield* production<EntryModule>("../app/entry.ts", "HandlerReply");
			yield* forSchema(Schema.Struct({fault: N.Fault, target: N.Target}), ({fault, target}) =>
				Effect.gen(function* () {
					const r = yield* request(fault, target);
					yield* Schema.decodeUnknownEffect(N.FaultRequest)(r);
					const session = yield* (yield* IdGenerator).next(TestProcessId);
					const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
						_tag: "client",
						client: target.client,
						session,
						gateway: "gateway-a",
						key: target.key,
					});
					yield* Schema.decodeUnknownEffect(J.Observation)({
						tick: r.tick,
						hit,
						consumed: null,
						outcome: {_tag: "fired"},
						span: {process: session, traceId: FROM.traceId, spanId: "0000000000000001"},
					});
				}).pipe(withIds),
			);
			yield* forSchema(E.HandlerReply, (valid) =>
				Schema.decodeUnknownEffect(E.HandlerReply)(valid),
			);
			for (const schema of [N.FaultRequest, N.FaultHit, J.Observation, E.HandlerReply]) {
				for (const raw of fc.sample(fc.anything(), {seed: SEED, numRuns: 100})) {
					const exit = yield* Effect.exit(Schema.decodeUnknownEffect(schema)(raw));
					expect(Exit.isFailure(exit)).toBe(true);
				}
			}
		}),
	);
});
