// P33 / p79 and p80, next/: real restart policy and recovery functions.
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {fcProcessIds} from "../id.test-support.ts";
import * as Id from "../id.ts";
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
import {Activity, canRestart, Dead, ProcessEvent, recoverActivity, State} from "./process.ts";

// fast-check 4.10.2's default JSON has no hard depth bound. Effect 4.1.1's
// recursive Schema.Json spends one shared size budget, so no finite size
// preserves that range. Keep the old generator for this input only.
const unboundedJson = Arbitrary.schema(
	Schema.Int.check(Schema.isBetween({minimum: -2_147_483_648, maximum: 2_147_483_647})),
).pipe(
	Arbitrary.map((seed) =>
		Schema.decodeUnknownSync(Schema.Json)(fc.sample(fc.jsonValue(), {seed, numRuns: 1})[0]),
	),
);

const text = Schema.NonEmptyString.check(Schema.isMaxLength(40));

// The old integer generator never made -0; JSON storage cannot distinguish it from 0.
const policy = Schema.Struct({
	reason: ProcessEvent.cases.down.fields.reason,
	crashes: ProcessEvent.cases.down.fields.crashes,
	until: ProcessEvent.cases.down.fields.until.check(
		Schema.isBetween({minimum: -2_147_483_648, maximum: 2_147_483_647}),
		Schema.makeFilter((n) => !Object.is(n, -0)),
	),
});

const nat = (max: number) => Schema.Int.check(Schema.isBetween({minimum: 0, maximum: max}));
// Effect 4.1.1 has no examples option. Each callback also checks its old inputs.
// Retain 0..40 times/texts and 2..31 errors. Explicit number bounds above
// keep the old full nat range without making every string that large.
const options = {arbitrary: {seed: 119120, runs: 100, size: 40}};
// The schema generates every free base32 character, both version characters and all eight variants.
const processIds = Arbitrary.schema(Id.Process);

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
			] as const) {
				expect(canRestart([n - p + o], n, p, 1)).toBe(o < 0);
			}
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

				if (times.length > 0) {
					expect(canRestart(times, n, p, times.length)).toBe(false);
				}

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
		[processIds.pipe(Arbitrary.map((process) => Activity.cases.idle.make({process})))],
		([generated]) => {
			for (const saved of [undefined, generated]) {
				expect(
					Result.match(recoverActivity(saved), {
						onFailure: (error) => error.reason,
						onSuccess: (value) => value._tag,
					}),
				).toBe("idle");
			}
		},
		options,
	);
	it.prop(
		"plant, new ID on constructor entry: an idle marker restores the same process",
		[processIds],
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
		[processIds, Activity.cases.stepping.fields.letter, Activity.cases.stepping.fields.build],
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
					reason: "interrupted",
				});
			}
		},
		options,
	);
	const corrupt = [null, {}, {_tag: "idle", process: "counter:1"}, {_tag: "stepping", process: A}];
	it.prop(
		"plant, reset corrupt saved state: corrupt activity fails closed",
		[unboundedJson.pipe(Arbitrary.filter((value) => !Schema.is(Activity)(value)))],
		([generated]) => {
			for (const saved of [...corrupt, generated]) {
				const answer = recoverActivity(saved);
				expect(Result.isFailure(answer)).toBe(true);

				if (Result.isFailure(answer)) {
					expect(answer.failure.reason).toBe("bad_row");
				}
			}
		},
		options,
	);
});

describe("T540, next/ process UUIDv7 refusals", () => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	it.prop(
		"plant, relax the process ID pattern: decode refuses each malformed part",
		[
			Schema.Struct({
				process: Id.Process,
				version: Schema.Literals([...alphabet].filter((char) => !"ef".includes(char))),
				variant: Schema.Literals([...alphabet].filter((char) => !"89abrstv".includes(char))),
				first: Schema.Literals([...alphabet.slice(8)]),
				length: Schema.Union([
					nat(25),
					Schema.Int.check(Schema.isBetween({minimum: 27, maximum: 52})),
				]),
				char: Schema.String.check(Schema.isPattern(/^[^0-9a-hjkmnp-tv-z]$/u)),
				position: nat(25),
				prefix: Schema.String.check(Schema.makeFilter((prefix) => prefix !== "process")),
			}),
		],
		([{process, version, variant, first, length, char, position, prefix}]) => {
			const suffix = process.slice("process_".length);
			const replace = (at: number, char: string) =>
				`process_${suffix.slice(0, at)}${char}${suffix.slice(at + 1)}`;
			expect(Result.isSuccess(Schema.decodeUnknownResult(Id.Process)(process))).toBe(true);

			for (const [part, invalid] of [
				["version", replace(10, version)],
				["variant", replace(13, variant)],
				["first character", replace(0, first)],
				["length", `process_${suffix.repeat(2).slice(0, length)}`],
				["alphabet", replace(position, char)],
				["prefix", `${prefix}_${suffix}`],
			]) {
				expect(Result.isFailure(Schema.decodeUnknownResult(Id.Process)(invalid)), part).toBe(true);
			}
		},
		options,
	);
});

describe("p80, supplied policy events", () => {
	it.prop(
		"plant, omit until: both down shapes require the promised retry time",
		[processIds, policy],
		([process, supplied]) => {
			for (const [p, s] of [
				[A, {reason: "intensity", crashes: 3, until: 50_000}],
				[process, supplied],
			] as const) {
				const down = {process: p, ...s};
				expect(Schema.is(ProcessEvent)({_tag: "down", ...down})).toBe(true);
				expect(
					Schema.is(ProcessEvent)({_tag: "down", process: p, reason: s.reason, crashes: s.crashes}),
				).toBe(false);
				expect(
					Schema.is(State)({_tag: "down", ...down, code: {program: "counter", hash: "build-a"}}),
				).toBe(true);
				expect(
					Schema.is(State)({
						_tag: "down",
						process: p,
						reason: s.reason,
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
				[{reason: "owner-policy", crashes: 17, until: 123_456}, generated],
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
		{arbitrary: {seed: 119120, runs: 20, size: 40}},
	);
	// Dead needs dependent generation: errors.length must equal tries.
	const dead = Arbitrary.all({
		process: Arbitrary.schema(Id.Process),
		program: Arbitrary.schema(Dead.fields.program),
		name: Arbitrary.schema(Dead.fields.name),
		errors: Arbitrary.array(Arbitrary.schema(text), {minLength: 2, maxLength: 31}),
	}).pipe(
		Arbitrary.map(({errors, ...identity}) =>
			Dead.make({
				...identity,
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
					process: A,
					program: "counter",
					name: "counter:1",
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
				]) {
					expect(Schema.is(Dead)({...value, errors})).toBe(false);
				}
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

				for (const [caller, reason] of [
					[brain(), "alive"],
					[watcher(W), "not_parent"],
				] as const) {
					const answer = yield* ProcessManager.use((p) =>
						Effect.result(p.down(A, supplied, from())),
					).pipe(Effect.provide(manager(store, caller)));
					expect(Result.isFailure(answer)).toBe(true);

					if (Result.isFailure(answer)) {
						expect(answer.failure.reason).toBe(reason);
					}

					expect(store.rows()).toEqual(before);
				}
			});
		},
		{arbitrary: {seed: 119120, runs: 20, size: 40}},
	);
});

describe("T319, next/ complete dead values", () => {
	const text = fc.string({minLength: 1, maxLength: 256});
	const complete = fc
		.record({
			process: fcProcessIds,
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

	for (const field of ["process", "program", "name"] as const) {
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
	}
});
