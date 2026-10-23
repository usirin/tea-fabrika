import {Arbitrary, Effect, Schema} from "effect";
import type {Walked} from "./walk.ts";

// A property test over walks (experiment 118): Effect's own `Arbitrary` draws
// lists of choices, each walked by `./walk.ts` through the real machines, and
// shrinks the first list whose walk breaks a law. fast-check is not needed.

/** How long to look, and where to start. */
export interface Budget {
	/** Wall time to look for a break, in ms. Shrinking a break found in time may run past it. */
	readonly ms: number;
	readonly seed: number;
	/** The most choices in one input: the longest walk. */
	readonly length: number;
	/** Inputs per call to `checkEffect`. Each call starts small and grows to `length`. */
	readonly batch?: number;
}

/** What a property test found within its budget. */
export interface Sampled {
	readonly caught: boolean;
	/** Wall time until the break was found and shrunk, or the whole budget. */
	readonly ms: number;
	/** Inputs tried before the break, or in all. */
	readonly runs: number;
	/** The shrunk walk, up to the step that broke the law. `null`: not caught. */
	readonly path: readonly string[] | null;
	readonly why: string | null;
}

/** One choice: which of the moves possible, modulo how many there are. */
export const CHOICE = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 65_535}));

/**
 * Sample walks until one breaks a law or the budget runs out, then shrink it.
 * `run` walks one input; it must be pure. Reads the wall clock, as
 * `explore.ts` does for its `ms`.
 */
export const sample = (run: (choices: readonly number[]) => Walked, budget: Budget) =>
	Effect.gen(function* () {
		const choices = Arbitrary.array(Arbitrary.schema(CHOICE), {maxLength: budget.length});
		const batch = budget.batch ?? 100;
		const started = performance.now();
		let runs = 0;
		for (let round = 0; performance.now() - started < budget.ms; round++) {
			const r = yield* Arbitrary.checkEffect(choices, (cs) => run(cs).broke === null, {
				runs: batch,
				size: budget.length * 4,
				seed: `${budget.seed}:${round}`,
				maxShrinks: 5_000,
			});
			if (r._tag === "Falsified") {
				const shrunk = run(r.shrunkInput);
				return {
					caught: true,
					ms: Math.round(performance.now() - started),
					runs: runs + r.runs,
					path: shrunk.path,
					why: shrunk.broke?.why ?? null,
				} satisfies Sampled;
			}
			runs += batch;
		}
		return {
			caught: false,
			ms: Math.round(performance.now() - started),
			runs,
			path: null,
			why: null,
		} satisfies Sampled;
	});
