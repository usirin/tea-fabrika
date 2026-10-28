import {Schema} from "effect";
import {type Controlling, createControls, Result} from "../../controls.ts";
import {countedAs, type Facts, Finding, type Silence} from "../../rate.ts";
import {outcomesOf} from "../outcome.ts";

// The test writer's second job (docs/direction/the-test-writer.md): after
// the mutation step, it answers each mutant that lived in one of three ways.
// This file is that job's code side; the writer's Draft for it is the same
// refine combo as the first job's and is not wired here.
//
//   test     a new test kills it: red on the mutant, green on the original.
//            Both controls, so `controls(onBad, onGood)` via the Controls child
//   cannot   it changes nothing a test can see: the owner is asked
//   noise    a test could tell it apart but would only lock a detail: a
//            Finding for Rate, which the owner rates "fix" or "noise"

/** A mutant that lived, as the mutation step names it: `file:line:column`. */
export const MutantId = Schema.String.check(Schema.isPattern(/^[^:\s]+:[1-9][0-9]*:[0-9]+$/));

export const MutantAnswer = Schema.Union([
	Schema.Struct({
		mutant: MutantId,
		answer: Schema.Literal("test"),
		/** The test's name, in `file`. */
		test: Schema.String,
		file: Schema.String,
	}),
	Schema.Struct({mutant: MutantId, answer: Schema.Literal("cannot"), why: Schema.String}),
	Schema.Struct({mutant: MutantId, answer: Schema.Literal("noise"), why: Schema.String}),
]);
export type MutantAnswer = typeof MutantAnswer.Type;
type Of<A extends MutantAnswer["answer"]> = Extract<MutantAnswer, {readonly answer: A}>;

/** The rule a `noise` answer is rated under: the owner's "fix" says the writer was wrong to let it live. */
export const NOISE_RULE = "test_writer/noise";

/**
 * What silence means under `NOISE_RULE`: a `noise` answer is the writer's own
 * call, and only the owner's "noise" lets the mutant live. An unrated one
 * stays open, shipped or not.
 */
export const NOISE_SILENCE: Silence = "open";

/** A `noise` answer, as the Finding the owner rates. */
export const findingOf = (a: Of<"noise">): Finding => ({id: a.mutant, rule: NOISE_RULE});

/**
 * What the owner's rating does to a noise answer, by Rate's own count:
 * "fix" sends it back for a test, "noise" lets it live, and not yet rated
 * waits, even once its change ships. Only a rating in a row a user wrote
 * counts: an agent's is as if never made.
 */
export const ratedAs = (a: Of<"noise">, facts: Facts) => {
	const says = countedAs(findingOf(a), facts, NOISE_SILENCE);
	return says === null ? "open" : says === "fix" ? "write_test" : "lives";
};

/**
 * One kill check: the test, run on the tests' commit with the mutant in
 * (the bad side) and without it (the good side). `mutant: null` is the
 * original code.
 */
export const kills = createControls({
	name: "mutant_kill",
	input: Schema.Struct({
		commit: Schema.String,
		mutant: Schema.NullOr(MutantId),
		file: Schema.String,
		test: Schema.String,
	}),
	verdict: Result,
	resultOf: (r) => r,
});

type KillCmd = ReturnType<typeof kills.run>;
export type Killing = Readonly<Record<string, Controlling<KillCmd>>>;

const mutants = outcomesOf({
	/** Every `test` answer kills its mutant. `findings`: the `noise` answers, for the owner to rate. */
	done: {findings: Schema.Array(Finding)},
	send: {},
	/** `disable`: a mutant changes nothing a test can see, and a disable comment needs the owner's approval. */
	ask: {owner: ["disable"]},
	skip: [],
	/** `not_killed`: a new test missed its mutant, or failed on the original. `run_failed`: a run could not run. */
	stuck: ["not_killed", "run_failed"],
});
export const MutantsOutcome = mutants.schema;
export type MutantsOutcome = typeof MutantsOutcome.Type;

/**
 * Start one Controls child per `test` answer, keyed by its mutant. The Elm
 * answer: a dict of child models, each started with its own `init`
 * (`Cmd.batch` of both runs) and stepped by key as its answers come back.
 */
export function startKills(
	commit: string,
	answers: readonly MutantAnswer[],
): readonly [Killing, readonly KillCmd[]] {
	const children: Record<string, Controlling<KillCmd>> = {};
	const cmds: KillCmd[] = [];
	for (const a of answers) {
		if (a.answer !== "test") continue;
		const on = {commit, file: a.file, test: a.test};
		const [child, asked] = kills.start(a.mutant, {
			bad: {...on, mutant: a.mutant},
			good: {...on, mutant: null},
		});
		children[a.mutant] = child;
		cmds.push(...asked);
	}
	return [children, cmds];
}

/** One run came back: step the child it is for. An answer for no child changes nothing. */
export function killRan(killing: Killing, cmd: KillCmd, result: Result | null): Killing {
	const child = killing[cmd.key];
	if (child === undefined) return killing;
	const next = result === null ? kills.failed(child, cmd.side) : kills.ran(child, cmd.side, result);
	return {...killing, [cmd.key]: next};
}

/** The job's outcome once every kill check is back. `null`: one is still running. */
export function outcomeOf(
	answers: readonly MutantAnswer[],
	killing: Killing,
): MutantsOutcome | null {
	const children = Object.values(killing);
	if (children.some((c) => c.phase === "running")) return null;
	if (children.some((c) => c.phase === "could_not_run")) return {kind: "stuck", why: "run_failed"};
	if (children.some((c) => c.phase === "done" && c.answer.kind !== "ok"))
		return {kind: "stuck", why: "not_killed"};
	if (answers.some((a) => a.answer === "cannot"))
		return {kind: "ask", who: "owner", for: "disable"};
	const findings = answers.flatMap((a) => (a.answer === "noise" ? [findingOf(a)] : []));
	return {kind: "done", part: false, findings};
}
