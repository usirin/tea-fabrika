// Experiment 87: Gherkin steps, each registered as one of our moves.
//
// A step is a Given, When or Then (Gherkin's word) AND a move (ours). The
// wrappers below take both, so every step in the library says which move it is,
// and `87-scenarios.ts` counts them from the source with no run.
//
//   Given("act", ...)      writes a scratch world: files, a repo, a store
//   Given("provide", ...)  hands the code under test a fake service (no move:
//                          Elm's flags and simulated effects, Effect's Layer)
//   When("act", ...)       the user does the thing: runs the command, dispatches
//   When("listen", ...)    the world moves on its own: a Sub fires, a save lands
//   Then("check", ...)     reads the world (a Gather) and judges it (a Check)
//
// A Then must answer its problems as a list of sentences, empty for a pass. A
// Then that answers anything else fails the scenario: "checks nothing" is a
// failure here, not a silent pass. That is the one guard the glue gets for free.
//
// The names are capitalised on purpose. A module that exports `then` is a
// thenable: `await import()` of it calls that `then` and never settles. Vitest
// imports setup files that way, so a lower-case `then` hung the run silently.
//
// With STEP_LOG set, every step that runs appends one JSON line there: its
// word, move, pattern and the file that holds it. That is how the runner tells
// which steps a ticket shared with the others (`node:fs`, at the edge).
import {appendFileSync} from "node:fs";
import {Given as given, Then as then, When as when} from "quickpickle";

/** What a Then answers: what is wrong, one sentence each. None is a pass. */
export type Problems = readonly string[];

/** The world a scenario runs in. Steps keep their data on `data`, by name. */
export interface World {
	readonly data: Record<string, unknown>;
	/** quickpickle's own: which scenario and step are running. */
	readonly info?: {readonly scenario?: string; readonly step?: string};
}

type Args = readonly unknown[];
type Step<R> = (world: World, ...args: Args) => R | Promise<R>;

/** Every step registered, with its Gherkin word and its move. */
export const registered: {
	readonly word: string;
	readonly move: string;
	readonly pattern: string;
}[] = [];

/** The glue file that registers a step: `lib/common.ts` or `<ticket>/steps.ts`. */
function caller(): string {
	const frames = new Error().stack?.split("\n") ?? [];
	const found = frames.map((f) => /(lib\/common\.ts|[\w-]+\/steps\.ts)/.exec(f)?.[1]).find(Boolean);
	return found ?? "unknown";
}

const log = (line: object) => {
	const file = process.env.STEP_LOG;
	if (file !== undefined) appendFileSync(file, `${JSON.stringify(line)}\n`);
};

/**
 * Register one step. Each use is noted, and a failure too, with the scenario it
 * failed in: vitest's JSON report keeps only the stack of a quickpickle failure.
 */
function register(word: string, move: string, pattern: string, fn: Step<void>) {
	const from = caller();
	registered.push({word, move, pattern});
	return async (world: World, ...args: Args) => {
		log({word, move, pattern, from});
		try {
			await fn(world, ...args);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log({failed: pattern, scenario: world.info?.scenario ?? "", message});
			throw error;
		}
	};
}

export const Given = (move: "act" | "provide" | "gather", pattern: string, fn: Step<void>) => {
	given(pattern, register("Given", move, pattern, fn));
};

export const When = (move: "act" | "listen", pattern: string, fn: Step<void>) => {
	when(pattern, register("When", move, pattern, fn));
};

export const Then = (move: "check" | "judge", pattern: string, fn: Step<Problems>) => {
	const checked = async (world: World, ...args: Args) => {
		const problems: unknown = await fn(world, ...args);
		if (!Array.isArray(problems)) {
			throw new Error(
				`the ${move} step "${pattern}" answered no list of problems: it checks nothing`,
			);
		}
		if (problems.length > 0) throw new Error(problems.join("\n"));
	};
	then(pattern, register("Then", move, pattern, checked));
};

/** A problem when `ok` is false, none when it holds. */
export const expectThat = (ok: boolean, problem: string): Problems => (ok ? [] : [problem]);

/** Read a value a step put on the world, or stop with a sentence saying which step is missing. */
export function need<T>(world: World, key: string): T {
	if (!(key in world.data)) throw new Error(`no "${key}" yet: an earlier step should have set it`);
	return world.data[key] as T;
}
