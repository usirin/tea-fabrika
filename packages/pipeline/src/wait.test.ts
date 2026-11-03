import {Clock, Effect, Exit, Fiber} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ROUTES, Service} from "./stages/pipeline/routes.ts";
import {WAITS, waitOut} from "./wait.ts";

// Today's version. Self-fix PR 11b, "waits and records" (docs/plan/pipeline-self-fix.md, PR 11,
// `wait`). One schedule, in one place: from 1 second, doubling, up to 100 seconds apart, and no cap on
// tries (docs/direction/jidoka-and-andon.md#bounds). A transient error never reaches the lane. A
// refusal does, at once, and the lane stops with its real why.
//
//   waitOut(read, (e) => e.why === "unreachable")
//   // tries at 0 s, 1 s, 3 s, 7 s, ... 127 s, 227 s, 327 s, ... until the read answers

type Broke = {readonly _tag: "transient" | "refusal"; readonly try: number};

/** The wait before try `n + 1`, the first try being 0: 1 s doubling, 100 s at most. */
const gapAfter = (n: number): number => Math.min(1_000 * 2 ** n, 100_000);

/**
 * A call that fails with `fails[i]` on try `i` and answers `"read"` past them, waited out under the
 * TestClock: the clock time of each try, and how it ended.
 */
const tried = (fails: readonly Broke["_tag"][]) =>
	Effect.gen(function* () {
		const times: number[] = [];
		const call = Effect.gen(function* () {
			times.push(yield* Clock.currentTimeMillis);
			const at = times.length - 1;
			const fail = fails[at];
			return fail === undefined ? "read" : yield* Effect.fail<Broke>({_tag: fail, try: at});
		});
		let over = false;
		const fiber = yield* Effect.forkChild(
			Effect.exit(waitOut(call, (e: Broke) => e._tag === "transient")).pipe(
				Effect.ensuring(Effect.sync(() => void (over = true))),
			),
		);
		// A second of virtual time at a time, with room for the waiting fiber to run, until it ends.
		for (let s = 0; !over && s < 100_000; s++) {
			yield* TestClock.adjust("1 second");
			for (let k = 0; k < 5; k++) yield* Effect.yieldNow;
		}
		const exit = yield* Fiber.join(fiber);
		return {times, exit};
	}).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

const gapsIn = (times: readonly number[]) => times.slice(1).map((t, i) => t - (times[i] ?? 0));

describe("the one wait", () => {
	it("waits 1 second, then doubles each time, to at most 100 seconds apart", async () => {
		const {times, exit} = await tried(Array.from({length: 11}, () => "transient" as const));
		expect(Exit.isSuccess(exit) ? exit.value : exit).toBe("read");
		expect(gapsIn(times)).toEqual([
			1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 100_000, 100_000, 100_000, 100_000,
		]);
	});

	it("has no cap on tries: 40 transient errors in a row, and the call still answers", async () => {
		const {times, exit} = await tried(Array.from({length: 40}, () => "transient" as const));
		expect(Exit.isSuccess(exit) ? exit.value : exit).toBe("read");
		expect(times).toHaveLength(41);
	});

	it("never tries a refusal again: it reaches the caller as it was", async () => {
		const {times, exit} = await tried(["refusal"]);
		expect(times).toEqual([0]);
		expect(exit).toEqual(Exit.fail({_tag: "refusal", try: 0}));
	});

	// The law: whatever came before, a transient error never reaches the caller, and a refusal does at
	// once, with nothing tried after it.
	it("law: any run of transient errors is waited out; the first refusal ends it, at its own try", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom("transient" as const, "refusal" as const), {maxLength: 12}),
				async (fails) => {
					const {times, exit} = await tried(fails);
					const refused = fails.indexOf("refusal");
					if (refused === -1) {
						expect(Exit.isSuccess(exit) ? exit.value : exit).toBe("read");
						expect(times).toHaveLength(fails.length + 1);
					} else {
						expect(exit).toEqual(Exit.fail({_tag: "refusal", try: refused}));
						expect(times).toHaveLength(refused + 1);
					}
					expect(gapsIn(times)).toEqual(gapsIn(times).map((_, n) => gapAfter(n)));
				},
			),
			{numRuns: 40, seed: 119120},
		);
	});
});

describe("the services that wait", () => {
	const waiting = () => new Set(Array.isArray(WAITS) ? WAITS : Object.keys(WAITS));

	it("WAITS names each service a `wait` row can name, and no other", () => {
		expect([...waiting()].sort()).toEqual([...Service.literals].sort());
	});

	it("every `wait` row in the route table names a service in WAITS", () => {
		const named = Object.entries(ROUTES).flatMap(([step, rows]) =>
			Object.entries(
				rows as Readonly<Record<string, {readonly _tag: string; readonly in?: string}>>,
			)
				.filter(([, move]) => move._tag === "wait")
				.map(([name, move]) => ({row: `${step} ${name}`, in: move.in})),
		);
		expect(named.length).toBeGreaterThan(0);
		expect(named.filter((r) => r.in === undefined || !waiting().has(r.in))).toEqual([]);
	});
});
