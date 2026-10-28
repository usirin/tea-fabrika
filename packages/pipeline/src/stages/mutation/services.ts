import {Context, type Effect, Schema} from "effect";
import type {Result} from "../../controls.ts";
import {Survived} from "./mutant.ts";
import {type CodeRef, type Scope, Span} from "./scope.ts";

// The two services the mutation step's Cmds talk to. The machine names
// neither tool: StrykerJS is the first Layer behind `MutationRunner`
// (./stryker.ts), and a test stands a fake in (./scripted.ts).

/** One Stryker run, as asked. `most`: the most mutants it runs, a fixed-seed sample past that. */
export const RunAsk = Schema.Struct({
	head: Schema.String,
	spans: Schema.Array(Span),
	seed: Schema.Int,
	most: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type RunAsk = typeof RunAsk.Type;

/** What one run found, by count, and each mutant that survived. Named after Stryker's statuses. */
export const Ran = Schema.Struct({
	/** The mutants made on the lines, less the ones the ignorer took out. */
	found: Schema.Int,
	/** How many of them it ran: all of them, or a sample of `most`. */
	ran: Schema.Int,
	/** Taken out by the ignorer (./ignorer.ts): Stryker's `Ignored`. */
	ignored: Schema.Int,
	/** No test failed on them, but the typecheck rejects them: Stryker's `CompileError`, not counted. */
	compileErrors: Schema.Int,
	killed: Schema.Int,
	survived: Schema.Array(Survived),
});
export type Ran = typeof Ran.Type;

export type CouldNotRun = {readonly _tag: "could_not_run"};

/** Runs code at a head: the repo's own tests, and mutation testing over some of its lines. */
export class MutationRunner extends Context.Service<
	MutationRunner,
	{
		/** The repo's own tests at `head`: green when all pass. */
		readonly tests: (head: string) => Effect.Effect<Result, CouldNotRun>;
		/** Mutants over `spans` at `head`, each run against the repo's own tests. */
		readonly run: (ask: RunAsk) => Effect.Effect<Ran, CouldNotRun>;
	}
>()("MutationRunner") {}

/** Reads what the build changed. */
export class MutationScope extends Context.Service<
	MutationScope,
	{
		/**
		 * The diff from `base` to `head`, the lines of each kept Property's
		 * code at `head`, and each file of `exam` at `head`, hashed with `hashOf`.
		 */
		readonly read: (
			base: string,
			head: string,
			kept: readonly CodeRef[],
			exam: readonly string[],
		) => Effect.Effect<Scope, {readonly _tag: "unknown"}>;
	}
>()("MutationScope") {}
