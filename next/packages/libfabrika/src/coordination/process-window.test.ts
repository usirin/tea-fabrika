// P33 / p79 and p80. Pure domain exports used by P11/P34:
// canRestart(previousTimes, now, period, intensity): boolean, proposed restart included.
// recoverActivity(raw): Result<idle | interrupted, LedgerError>, no IO or new ID allocation.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {ProcessManager} from "./process-manager.ts";
import {A, BRAIN, first, from, manager, storage} from "./process.test-support.ts";
import {Activity, canRestart, Dead, ProcessFact, recoverActivity, State} from "./process.ts";

const text = fc.string({minLength: 1, maxLength: 40});
const processId = fc.stringMatching(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const policy = fc.record({why: text, crashes: fc.integer({min: 1, max: 32}), until: fc.nat()});

describe("p79, inclusive restart window", () => {
	it("plant, use > instead of >=: the restart window includes its lower boundary", () => {
		fc.assert(
			fc.property(
				fc.nat({max: 1_000_000}),
				fc.nat({max: 10_000}),
				fc.integer({min: -1, max: 1}),
				(now, period, offset) => {
					const at = now - period + offset;
					expect(canRestart([at], now, period, 1)).toBe(offset < 0);
				},
			),
			{
				seed: 119120,
				examples: [
					[10_000, 1_000, -1],
					[10_000, 1_000, 0],
					[10_000, 1_000, 1],
				],
			},
		);
	});
	it("plant, ignore the proposed restart: intensity allows exactly the configured total", () => {
		fc.assert(
			fc.property(
				fc.nat({max: 1_000_000}),
				fc.integer({min: 1, max: 10_000}),
				fc.array(fc.nat({max: 1_000}), {maxLength: 30}),
				(now, period, offsets) => {
					const times = offsets.map((offset) => now - Math.min(offset, period));
					expect(canRestart([], now, period, 1)).toBe(true);
					if (times.length > 0) expect(canRestart(times, now, period, times.length)).toBe(false);
					expect(canRestart(times, now, period, times.length + 1)).toBe(true);
				},
			),
			{seed: 119120, examples: [[10_000, 1_000, [1_000, 500]]]},
		);
	});
	it("plant, timestamp order matters: permuting recorded restarts cannot change the answer", () => {
		fc.assert(
			fc.property(fc.array(fc.integer({min: 0, max: 10_000}), {maxLength: 40}), (times) => {
				expect(canRestart(times, 10_000, 1_000, 3)).toBe(
					canRestart([...times].reverse(), 10_000, 1_000, 3),
				);
			}),
			{seed: 119120},
		);
	});
});

describe("p79, saved activity is not a crash detector", () => {
	it("P11 plant, decode an absent marker: a marker never written wakes as idle", () => {
		fc.assert(
			fc.property(
				fc.option(
					processId.map((process) => Activity.cases.idle.make({process})),
					{nil: undefined},
				),
				(saved) => {
					expect(
						Result.match(recoverActivity(saved), {
							onFailure: (error) => error.why,
							onSuccess: (value) => value._tag,
						}),
					).toBe("idle");
				},
			),
			{seed: 119120, examples: [[undefined]]},
		);
	});
	it("plant, new ID on constructor entry: an idle marker restores the same process", () => {
		fc.assert(
			fc.property(processId, (process) => {
				const saved = Activity.cases.idle.make({process});
				expect(Result.getOrThrow(recoverActivity(JSON.parse(JSON.stringify(saved))))).toEqual(
					saved,
				);
			}),
			{seed: 119120, examples: [[A]]},
		);
	});
	it("plant, label every entry crashed: an unfinished step reports only interruption", () => {
		fc.assert(
			fc.property(processId, text, text, (process, letter, build) => {
				const saved = Activity.cases.stepping.make({process, letter, build});
				expect(Result.getOrThrow(recoverActivity(saved))).toEqual({
					_tag: "interrupted",
					process,
					letter,
					build,
					why: "interrupted",
				});
			}),
			{seed: 119120, examples: [[A, "letter-17", "build-a"]]},
		);
	});
	const corrupt = [null, {}, {_tag: "idle", process: "counter:1"}, {_tag: "stepping", process: A}];
	it("plant, reset corrupt saved state: corrupt activity fails closed", () => {
		fc.assert(
			fc.property(
				fc.jsonValue().filter((value) => !Schema.is(Activity)(value)),
				(saved) => {
					const answer = recoverActivity(saved);
					expect(Result.isFailure(answer)).toBe(true);
					if (Result.isFailure(answer)) expect(answer.failure.why).toBe("bad_row");
				},
			),
			{seed: 119120, examples: corrupt.map((saved): [typeof saved] => [saved])},
		);
	});
});

describe("p80, supplied policy facts", () => {
	it("plant, omit until: both down shapes require the promised retry time", () => {
		fc.assert(
			fc.property(processId, policy, (process, supplied) => {
				const down = {process, ...supplied};
				expect(Schema.is(ProcessFact)({_tag: "down", ...down})).toBe(true);
				expect(
					Schema.is(ProcessFact)({
						_tag: "down",
						process,
						why: supplied.why,
						crashes: supplied.crashes,
					}),
				).toBe(false);
				expect(
					Schema.is(State)({_tag: "down", ...down, code: {program: "counter", hash: "build-a"}}),
				).toBe(true);
				expect(
					Schema.is(State)({
						_tag: "down",
						process,
						why: supplied.why,
						crashes: supplied.crashes,
						code: {program: "counter", hash: "build-a"},
					}),
				).toBe(false);
			}),
			{seed: 119120, examples: [[A, {why: "intensity", crashes: 3, until: 50_000}]]},
		);
	});
	it("plant, choose a retry policy inside P33: down records exactly what P34 supplied", async () => {
		await fc.assert(
			fc.asyncProperty(policy, (supplied) => {
				const store = storage();
				return Effect.gen(function* () {
					const processes = yield* ProcessManager;
					yield* processes.start(first(), from());
					yield* processes.exit(A, "interrupted", from());
					yield* processes.down(A, supplied, from());
					expect(
						store
							.rows()
							.filter((row) => row._tag === "down")
							.map((row) => row.body),
					).toEqual([{process: A, ...supplied, asked: BRAIN}]);
					expect(store.rows().filter((row) => row._tag === "restarted")).toEqual([]);
				}).pipe(Effect.provide(manager(store)), Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[{why: "owner-policy", crashes: 17, until: 123_456}]]},
		);
	});
	it("plant, fewer error classes than tries: dead keeps one class per attempt", () => {
		fc.assert(
			fc.property(fc.array(text, {minLength: 2, maxLength: 31}), (classes) => {
				const dead = {
					tries: classes.length,
					limit: classes.length,
					m: "letter-17",
					build: "build-a",
					errors: classes,
				};
				expect(Schema.is(Dead)(Dead.make(dead))).toBe(true);
				for (const errors of [
					[],
					["TypeError"],
					[...dead.errors, "Error"],
					["", "TypeError", "Error"],
					[new Error("message"), "Error", "Error"],
				]) {
					expect(Schema.is(Dead)({_tag: "dead", ...dead, errors})).toBe(false);
				}
			}),
			{seed: 119120, examples: [[["TypeError", "RangeError", "TypeError"]]]},
		);
	});
});
