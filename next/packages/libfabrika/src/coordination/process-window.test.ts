// P33 / p79 and p80. Pure domain exports used by P11/P34:
// canRestart(previousTimes, now, period, intensity): boolean, proposed restart included.
// recoverActivity(raw): Result<idle | interrupted, LedgerError>, no IO or new ID allocation.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {ProcessManager} from "./process-manager.ts";
import {A, BRAIN, first, from, manager, storage} from "./process.test-support.ts";
import {Activity, canRestart, Dead, ProcessFact, recoverActivity, State} from "./process.ts";

describe("p79, inclusive restart window", () => {
	for (const [at, allowed] of [
		[8_999, true],
		[9_000, false],
		[9_001, false],
	] as const) {
		it(`plant, use > instead of >=: a previous restart at ${at} with now 10000, period 1000, intensity 1`, () => {
			expect(canRestart([at], 10_000, 1_000, 1)).toBe(allowed);
		});
	}
	it("plant, ignore the proposed restart: intensity allows exactly the configured total", () => {
		expect(canRestart([], 10_000, 1_000, 1)).toBe(true);
		expect(canRestart([9_000, 9_500], 10_000, 1_000, 2)).toBe(false);
		expect(canRestart([9_000, 9_500], 10_000, 1_000, 3)).toBe(true);
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
		expect(
			Result.match(recoverActivity(undefined), {
				onFailure: (error) => error.why,
				onSuccess: (value) => value._tag,
			}),
		).toBe("idle");
	});
	it("plant, new ID on constructor entry: an idle marker restores the same process", () => {
		const saved = Activity.cases.idle.make({process: A});
		expect(Result.getOrThrow(recoverActivity(JSON.parse(JSON.stringify(saved))))).toEqual(saved);
	});
	it("plant, label every entry crashed: an unfinished step reports only interruption", () => {
		const saved = Activity.cases.stepping.make({process: A, letter: "letter-17", build: "build-a"});
		expect(Result.getOrThrow(recoverActivity(saved))).toEqual({
			_tag: "interrupted",
			process: A,
			letter: "letter-17",
			build: "build-a",
			why: "interrupted",
		});
	});
	for (const saved of [
		null,
		{},
		{_tag: "idle", process: "counter:1"},
		{_tag: "stepping", process: A},
	]) {
		it(`plant, reset corrupt saved state: ${JSON.stringify(saved)} fails closed`, () => {
			const answer = recoverActivity(saved);
			expect(Result.isFailure(answer)).toBe(true);
			if (Result.isFailure(answer)) expect(answer.failure.why).toBe("bad_row");
		});
	}
});

describe("p80, supplied policy facts", () => {
	it("plant, omit until: both down shapes require the promised retry time", () => {
		const down = {process: A, why: "intensity", crashes: 3, until: 50_000};
		expect(Schema.is(ProcessFact)({_tag: "down", ...down})).toBe(true);
		expect(Schema.is(ProcessFact)({_tag: "down", process: A, why: "intensity", crashes: 3})).toBe(
			false,
		);
		expect(
			Schema.is(State)({_tag: "down", ...down, code: {program: "counter", hash: "build-a"}}),
		).toBe(true);
		expect(
			Schema.is(State)({
				_tag: "down",
				process: A,
				why: "intensity",
				crashes: 3,
				code: {program: "counter", hash: "build-a"},
			}),
		).toBe(false);
	});
	it.effect(
		"plant, choose a retry policy inside P33: down records exactly what P34 supplied",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(first(), from());
				yield* processes.exit(A, "interrupted", from());
				yield* processes.down(A, {why: "owner-policy", crashes: 17, until: 123_456}, from());
				expect(
					store
						.rows()
						.filter((row) => row._tag === "down")
						.map((row) => row.body),
				).toEqual([{process: A, why: "owner-policy", crashes: 17, until: 123_456, asked: BRAIN}]);
				expect(store.rows().filter((row) => row._tag === "restarted")).toEqual([]);
			}).pipe(Effect.provide(manager(store)));
		},
	);
	it("plant, fewer error classes than tries: dead keeps one class per attempt", () => {
		const dead = {
			process: A,
			program: "counter",
			name: "counter:1",
			tries: 3,
			limit: 3,
			m: "letter-17",
			build: "build-a",
			errors: ["TypeError", "RangeError", "TypeError"],
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
	});
});

describe("T319, next/ complete dead values", () => {
	const text = fc.string({minLength: 1, maxLength: 256});
	const complete = fc
		.record({
			process: fc.stringMatching(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
			program: text,
			name: fc.stringMatching(/^p:[a-z0-9._:-]{1,254}$/),
			m: text,
			build: text,
			errors: fc.array(text, {minLength: 1, maxLength: 32}),
		})
		.map((value) => ({
			...value,
			_tag: "dead" as const,
			tries: value.errors.length,
			limit: value.errors.length,
		}));
	for (const field of ["process", "program", "name"] as const)
		it(`plant, make ${field} optional or default it: complete dead values decode, removing ${field} fails`, () => {
			fc.assert(
				fc.property(complete, (value) => {
					expect(Result.isSuccess(Schema.decodeUnknownResult(Dead)(value))).toBe(true);
					const {[field]: _removed, ...missing} = value;
					expect(Result.isFailure(Schema.decodeUnknownResult(Dead)(missing))).toBe(true);
				}),
				{seed: 119120},
			);
		});
});
