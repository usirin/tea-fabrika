// P34, next/. Coordination owns protected dead writes and referee-authored status.
// P33's existing monitor/window tests stay untouched. These add the ended-process read and
// fixed dead operation that supervision needs, including file reopen and foreign ledger rows.
import {describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {TestClock} from "effect/testing";
import {Ledger} from "../data/ledger.ts";
import {lineFor} from "../data/log.ts";
import {type From} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	X,
	BRAIN,
	CLIENT,
	again,
	brain,
	facts,
	first,
	from,
	ids,
	manager,
	read,
	storage,
	watcher,
} from "./process.test-support.ts";
import {brainOnly, canRestart, Dead, type State} from "./process.ts";

type Failure = {readonly why: string};
type RecoveryManager = (typeof ProcessManager)["Service"] & {
	readonly status: (
		name: string,
	) => Effect.Effect<
		{name: string; state: typeof State.Type; at: number; restarts: ReadonlyArray<number>},
		Failure
	>;
	readonly dead: (
		process: string,
		dead: typeof Dead.Type,
		from: From,
	) => Effect.Effect<unknown, Failure>;
};
const dead = Dead.make({
	tries: 3,
	limit: 3,
	m: "poison",
	build: "build-a",
	errors: ["TypeError", "RangeError", "TypeError"],
});

describe("P34 coordination recovery", () => {
	it.effect(
		"p79 p80 plant, client clock or reset on replacement: status retains referee restart times at the exact edge",
		() =>
			Effect.gen(function* () {
				const disk = storage();
				const next = ids(A, B, W);
				yield* TestClock.setTime(1000);
				yield* ProcessManager.use((p) =>
					p.start(first(), from({sentAt: "2099-01-01T00:00:00Z"})),
				).pipe(Effect.provide(manager(disk, brain(), next.next)));
				for (const [at, old] of [
					[1100, A],
					[1200, B],
				] as const) {
					yield* TestClock.setTime(at);
					yield* Effect.gen(function* () {
						const p = yield* ProcessManager;
						yield* p.exit(old, "crashed", from());
						yield* p.start(again(old), from({sentAt: "1970-01-01T00:00:00Z"}));
					}).pipe(Effect.provide(manager(disk, brain(), next.next)));
					disk.reopen();
				}
				yield* Ledger.use((l) =>
					l.append(
						"processes/counter:1",
						"foreign-down",
						lineFor(from({by: CLIENT}), {
							_tag: "down",
							process: W,
							why: "forged",
							crashes: 99,
							until: 999999,
						}),
					),
				).pipe(Effect.provide(manager(disk)));
				yield* TestClock.setTime(6100);
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					expect(p.status, "P34 parent-checked status read is missing").toBeTypeOf("function");
					const status = yield* p.status("counter:1");
					expect(status).toMatchObject({
						name: "counter:1",
						state: {_tag: "live", process: W},
						at: 6100,
						restarts: [1100, 1200],
					});
					expect(canRestart(status.restarts, status.at, 5000, 2)).toBe(false);
					yield* TestClock.setTime(6101);
					const later = yield* p.status("counter:1");
					expect(later.restarts).toEqual([1100, 1200]);
					expect(canRestart(later.restarts, later.at, 5000, 2)).toBe(true);
				}).pipe(Effect.provide(manager(disk, brain(), next.next)));
			}),
	);

	it.effect(
		"p80 plant, info loses ended state: status preserves down deadline and refuses another parent",
		() =>
			Effect.gen(function* () {
				const disk = storage();
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					yield* p.start(first(), from());
					yield* p.exit(A, "saved_letter", from());
					yield* p.down(A, {why: "saved_letter", crashes: 2, until: 5001}, from());
					expect(p.status, "P34 status must include ended and down processes").toBeTypeOf(
						"function",
					);
					expect(yield* p.status("counter:1")).toMatchObject({
						state: {_tag: "down", process: A, until: 5001, crashes: 2},
					});
				}).pipe(Effect.provide(manager(disk)));
				disk.reopen();
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					expect(yield* Effect.flip(p.status("counter:1"))).toMatchObject({why: "not_parent"});
				}).pipe(Effect.provide(manager(disk, watcher(X))));
			}),
	);

	for (const [stream, tag] of [
		["notes", "dead"],
		[`${A}/dead`, "note"],
	] as const)
		it(`P33 authority plant, public dead append: shared write policy reserves ${tag} in ${stream}`, () => {
			expect(brainOnly({stream, id: "forged", tag})).toBe(true);
		});

	it.effect(
		"P33 authority plant, write dead as caller: only fixed parent-checked operation creates one brain row",
		() =>
			Effect.gen(function* () {
				const disk = storage();
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					yield* p.start(first(), from());
					expect(p.dead, "P34 fixed dead write is missing").toBeTypeOf("function");
					yield* p.dead(A, dead, from({by: CLIENT}));
				}).pipe(Effect.provide(manager(disk)));
				disk.reopen();
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					yield* p.dead(A, dead, from({by: CLIENT}));
					expect(yield* read(`${A}/dead`)).toMatchObject([
						{
							by: BRAIN,
							_tag: "dead",
							body: {m: "poison", tries: 3, errors: ["TypeError", "RangeError", "TypeError"]},
						},
					]);
				}).pipe(Effect.provide(manager(disk)));
				yield* Effect.gen(function* () {
					const p = (yield* ProcessManager) as RecoveryManager;
					expect(yield* Effect.flip(p.dead(A, dead, from()))).toMatchObject({why: "not_parent"});
				}).pipe(Effect.provide(manager(disk, watcher(X))));
			}),
	);

	it.effect(
		"p79 plant, new start ID after lost reply: repeated exit/start has one exact DOWN and successor",
		() =>
			Effect.gen(function* () {
				const disk = storage();
				const next = ids(A, B, W);
				yield* Effect.gen(function* () {
					const p = yield* ProcessManager;
					yield* p.start(first(), from());
					yield* p.monitor("watch-a", A, from());
					yield* p.exit(A, "crashed", from());
					yield* p.start(again(A), from());
				}).pipe(Effect.provide(manager(disk, brain(), next.next)));
				disk.reopen();
				yield* Effect.gen(function* () {
					const p = yield* ProcessManager;
					yield* p.exit(A, "crashed", from());
					expect((yield* p.start(again(A), from())).process).toBe(B);
					expect((yield* facts("counter:1")).filter((r) => r._tag === "exited")).toHaveLength(1);
					expect((yield* facts("counter:1")).filter((r) => r._tag === "restarted")).toHaveLength(1);
					expect(yield* read("client:window-a/inbox")).toMatchObject([
						{body: {m: {ref: "watch-a", process: A, to: brain().recipient}}},
					]);
					expect(next.calls()).toBe(2);
				}).pipe(Effect.provide(manager(disk, brain(), next.next)));
			}),
	);
});
