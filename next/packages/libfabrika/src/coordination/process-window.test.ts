// P33 / p79 and p80, next/: real restart policy and recovery functions.
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Result, Schema} from "effect";
import {ProcessId} from "../data/trace.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	BRAIN,
	brain,
	first,
	from,
	manager,
	storage,
	watcher,
	W,
} from "./process.test-support.ts";
import {Activity, canRestart, Dead, ProcessFact, recoverActivity, State} from "./process.ts";

const text = Schema.NonEmptyString.check(Schema.isMaxLength(40));
// The old integer generator never made -0; JSON storage cannot distinguish it from 0.
const policy = Schema.Struct({
	why: ProcessFact.cases.down.fields.why,
	crashes: ProcessFact.cases.down.fields.crashes,
	until: ProcessFact.cases.down.fields.until.check(Schema.makeFilter((n) => !Object.is(n, -0))),
});
const nat = (max: number) => Schema.Int.check(Schema.isBetween({minimum: 0, maximum: max}));
// Effect 4.1.1 has no examples option. Each callback also checks its old inputs.
const options = {arbitrary: {seed: 119120, runs: 100}};

describe("p79, inclusive restart window", () => {
	it.prop(
		"plant, use > instead of >=: the restart window includes its lower boundary",
		[nat(1_000_000), nat(10_000), Schema.Int.check(Schema.isBetween({minimum: -1, maximum: 1}))],
		([now, period, offset]) => {
			for (const [n, p, o] of [
				[10_000, 1_000, -1],
				[10_000, 1_000, 0],
				[10_000, 1_000, 1],
				[now, period, offset],
			] as const)
				expect(canRestart([n - p + o], n, p, 1)).toBe(o < 0);
		},
		options,
	);
	it.prop(
		"plant, ignore the proposed restart: intensity allows exactly the configured total",
		[
			nat(1_000_000),
			Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 10_000})),
			Schema.Array(nat(1_000)).check(Schema.isMaxLength(30)),
		],
		([now, period, offsets]) => {
			for (const [n, p, os] of [
				[10_000, 1_000, [1_000, 500]],
				[now, period, offsets],
			] as const) {
				const times = os.map((offset) => n - Math.min(offset, p));
				expect(canRestart([], n, p, 1)).toBe(true);
				if (times.length > 0) expect(canRestart(times, n, p, times.length)).toBe(false);
				expect(canRestart(times, n, p, times.length + 1)).toBe(true);
			}
		},
		options,
	);
	it.prop(
		"plant, timestamp order matters: permuting recorded restarts cannot change the answer",
		[Schema.Array(nat(10_000)).check(Schema.isMaxLength(40))],
		([times]) => {
			expect(canRestart(times, 10_000, 1_000, 3)).toBe(
				canRestart([...times].reverse(), 10_000, 1_000, 3),
			);
		},
		options,
	);
});

describe("p79, saved activity is not a crash detector", () => {
	it.prop(
		"P11 plant, decode an absent marker: a marker never written wakes as idle",
		[Schema.UndefinedOr(Activity.cases.idle)],
		([generated]) => {
			for (const saved of [undefined, generated])
				expect(
					Result.match(recoverActivity(saved), {
						onFailure: (error) => error.why,
						onSuccess: (value) => value._tag,
					}),
				).toBe("idle");
		},
		options,
	);
	it.prop(
		"plant, new ID on constructor entry: an idle marker restores the same process",
		[ProcessId],
		([generated]) => {
			for (const process of [A, generated]) {
				const saved = Activity.cases.idle.make({process});
				expect(Result.getOrThrow(recoverActivity(JSON.parse(JSON.stringify(saved))))).toEqual(
					saved,
				);
			}
		},
		options,
	);
	it.prop(
		"plant, label every entry crashed: an unfinished step reports only interruption",
		[ProcessId, Activity.cases.stepping.fields.letter, Activity.cases.stepping.fields.build],
		([process, letter, build]) => {
			for (const [p, l, b] of [
				[A, "letter-17", "build-a"],
				[process, letter, build],
			] as const) {
				const saved = Activity.cases.stepping.make({process: p, letter: l, build: b});
				expect(Result.getOrThrow(recoverActivity(saved))).toEqual({
					_tag: "interrupted",
					process: p,
					letter: l,
					build: b,
					why: "interrupted",
				});
			}
		},
		options,
	);
	const corrupt = [null, {}, {_tag: "idle", process: "counter:1"}, {_tag: "stepping", process: A}];
	it.prop(
		"plant, reset corrupt saved state: corrupt activity fails closed",
		[Arbitrary.schema(Schema.Json).pipe(Arbitrary.filter((value) => !Schema.is(Activity)(value)))],
		([generated]) => {
			for (const saved of [...corrupt, generated]) {
				const answer = recoverActivity(saved);
				expect(Result.isFailure(answer)).toBe(true);
				if (Result.isFailure(answer)) expect(answer.failure.why).toBe("bad_row");
			}
		},
		options,
	);
});

describe("p80, supplied policy facts", () => {
	it.prop(
		"plant, omit until: both down shapes require the promised retry time",
		[ProcessId, policy],
		([process, supplied]) => {
			for (const [p, s] of [
				[A, {why: "intensity", crashes: 3, until: 50_000}],
				[process, supplied],
			] as const) {
				const down = {process: p, ...s};
				expect(Schema.is(ProcessFact)({_tag: "down", ...down})).toBe(true);
				expect(
					Schema.is(ProcessFact)({_tag: "down", process: p, why: s.why, crashes: s.crashes}),
				).toBe(false);
				expect(
					Schema.is(State)({_tag: "down", ...down, code: {program: "counter", hash: "build-a"}}),
				).toBe(true);
				expect(
					Schema.is(State)({
						_tag: "down",
						process: p,
						why: s.why,
						crashes: s.crashes,
						code: {program: "counter", hash: "build-a"},
					}),
				).toBe(false);
			}
		},
		options,
	);
	it.effect.prop(
		"plant, choose a retry policy inside P33: down records exactly what P34 supplied",
		[policy],
		([generated]) =>
			Effect.forEach(
				[{why: "owner-policy", crashes: 17, until: 123_456}, generated],
				(supplied) => {
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
					}).pipe(Effect.provide(manager(store)));
				},
				{concurrency: 1},
			),
		{arbitrary: {seed: 119120, runs: 20}},
	);
	// Dead needs dependent generation: errors.length must equal tries.
	const dead = Arbitrary.array(Arbitrary.schema(text), {minLength: 2, maxLength: 31}).pipe(
		Arbitrary.map((errors) =>
			Dead.make({
				tries: errors.length,
				limit: errors.length,
				m: "letter-17",
				build: "build-a",
				errors,
			}),
		),
	);
	it.prop(
		"plant, fewer error classes than tries: dead keeps one class per attempt",
		[dead],
		([generated]) => {
			for (const value of [
				Dead.make({
					tries: 3,
					limit: 3,
					m: "letter-17",
					build: "build-a",
					errors: ["TypeError", "RangeError", "TypeError"],
				}),
				generated,
			]) {
				expect(Schema.is(Dead)(Dead.make(value))).toBe(true);
				for (const errors of [
					[],
					["TypeError"],
					[...value.errors, "Error"],
					["", "TypeError", "Error"],
					[new Error("message"), "Error", "Error"],
				])
					expect(Schema.is(Dead)({...value, errors})).toBe(false);
			}
		},
		options,
	);
	it.effect.prop(
		"down refuses a live child and a caller who is not its parent",
		[policy],
		([supplied]) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
					Effect.provide(manager(store, brain())),
				);
				const before = store.rows();
				for (const [caller, why] of [
					[brain(), "alive"],
					[watcher(W), "not_parent"],
				] as const) {
					const answer = yield* ProcessManager.use((p) =>
						Effect.result(p.down(A, supplied, from())),
					).pipe(Effect.provide(manager(store, caller)));
					expect(Result.isFailure(answer)).toBe(true);
					if (Result.isFailure(answer)) expect(answer.failure.why).toBe(why);
					expect(store.rows()).toEqual(before);
				}
			});
		},
		{arbitrary: {seed: 119120, runs: 20}},
	);
});
