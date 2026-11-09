// P27a, next/. Actual gateway rules, controlled sends and absolute alarm time.
import {mkdtempSync, rmSync} from "node:fs";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {
	disk,
	forSchema,
	Positive,
	production,
	request,
	SEED,
	TestProcessId,
	withIds,
	type GatewayModule,
	type GatewayReply,
	type NemesisModule,
} from "../chaos/p27.test-support.ts";
import {IdGenerator, InputId} from "../data/id.ts";

describe("P27a gateway faults", () => {
	it.effect("plant: suppress before durable placing or suppress an unrelated session/request", () =>
		Effect.gen(function* () {
			const G = yield* production<GatewayModule>("../transport/gateway-fault.ts", "GatewayFault");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(
				Schema.Struct({target: N.Target, payload: Schema.Json, pos: Positive}),
				({target, payload, pos}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const home = yield* Effect.acquireRelease(
								Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
								(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
							);
							const store = yield* disk(home, "gateway.db");
							const ids = yield* IdGenerator;
							const session = yield* ids.next(TestProcessId);
							const replacement = yield* ids.next(TestProcessId);
							const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
								_tag: "client",
								client: target.client,
								session,
								key: target.key,
								gateway: "gateway-a",
							});
							const fault = yield* Schema.decodeUnknownEffect(N.Fault)({
								_tag: "drop_answer",
								client: target.client,
							});
							const r = yield* request(fault, target);
							const input = yield* ids.next(InputId);
							const sent: GatewayReply[] = [];
							const closed: string[] = [];
							const receipts: unknown[] = [];
							const io = {
								now: () => 1000,
								send: (reply: GatewayReply) =>
									Effect.sync(() => {
										sent.push(reply);
									}),
								close: (s: string) =>
									Effect.sync(() => {
										closed.push(s);
									}),
								alarm: () => Effect.void,
								observe: (raw: unknown) =>
									Effect.sync(() => {
										receipts.push(raw);
									}),
							};
							const layer = () => G.GatewayFault.layer(store.sql, io);
							const real = {session, request: input, placing: {rev: pos + 10, pos}, payload};
							yield* G.GatewayFault.use((g) => g.arm(r, hit)).pipe(Effect.provide(layer()));
							yield* G.GatewayFault.use((g) => g.outgoing({...real, session: replacement})).pipe(
								Effect.provide(layer()),
							);
							expect(sent).toEqual([{...real, session: replacement}]);
							expect(receipts).toEqual([]);
							expect(closed).toEqual([]);
							yield* G.GatewayFault.use((g) => g.outgoing(real)).pipe(Effect.provide(layer()));
							expect(sent).toHaveLength(1);
							expect(closed).toEqual([session]);
							expect(receipts).toContainEqual(
								expect.objectContaining({
									tick: r.tick,
									hit,
									consumed: expect.objectContaining({request: input, placing: real.placing}),
								}),
							);
							yield* store.reopen;
							yield* G.GatewayFault.use((g) => g.outgoing({...real, session: replacement})).pipe(
								Effect.provide(layer()),
							);
							expect(sent.at(-1)).toEqual({...real, session: replacement});
							expect(receipts).toHaveLength(1);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("plant: memory timer, moved deadline, duplicate release or stop strands traffic", () =>
		Effect.gen(function* () {
			const G = yield* production<GatewayModule>("../transport/gateway-fault.ts", "GatewayFault");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(
				Schema.Struct({
					target: N.Target,
					ms: Positive,
					repeats: Positive,
					stop: Schema.Boolean,
					payload: Schema.Json,
				}),
				({target, ms, repeats, stop, payload}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const home = yield* Effect.acquireRelease(
								Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
								(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
							);
							const store = yield* disk(home, "gateway.db");
							const ids = yield* IdGenerator;
							const session = yield* ids.next(TestProcessId);
							const input = yield* ids.next(InputId);
							const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
								_tag: "client",
								client: target.client,
								session,
								key: target.key,
								gateway: "gateway-a",
							});
							const fault = yield* Schema.decodeUnknownEffect(N.Fault)({
								_tag: "delay",
								client: target.client,
								ms,
							});
							const r = yield* request(fault, target);
							const sent: GatewayReply[] = [];
							const alarms: Array<number | null> = [];
							let now = 1000;
							const receipt: unknown[] = [];
							const layer = () =>
								G.GatewayFault.layer(store.sql, {
									now: () => now,
									send: (reply) =>
										Effect.sync(() => {
											sent.push(reply);
										}),
									close: () => Effect.void,
									alarm: (at) =>
										Effect.sync(() => {
											alarms.push(at);
										}),
									observe: (raw) =>
										Effect.sync(() => {
											receipt.push(raw);
										}),
								});
							const reply = {session, request: input, placing: {rev: 1, pos: 1}, payload};
							yield* G.GatewayFault.use((g) =>
								g.arm(r, hit).pipe(Effect.andThen(g.outgoing(reply))),
							).pipe(Effect.provide(layer()));
							expect(sent).toHaveLength(0);
							expect(alarms.at(-1)).toBe(1000 + ms);
							const cuts = fc.sample(fc.integer({min: 0, max: ms - 1}), {
								seed: SEED,
								numRuns: repeats,
							});
							for (const cut of cuts) {
								now = 1000 + cut;
								yield* store.reopen;
								yield* G.GatewayFault.use((g) => g.due(now)).pipe(Effect.provide(layer()));
								expect(sent).toHaveLength(0);
							}
							if (stop)
								yield* G.GatewayFault.use((g) => g.stop(r.tick)).pipe(Effect.provide(layer()));
							for (let i = 0; i < repeats; i++) {
								now = 1000 + ms + i;
								yield* store.reopen;
								yield* G.GatewayFault.use((g) => g.due(now)).pipe(Effect.provide(layer()));
							}
							expect(sent).toEqual([reply]);
							expect(receipt).toHaveLength(1);
						}),
					).pipe(withIds),
			);
		}),
	);
});
