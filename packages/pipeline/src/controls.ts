import type {CmdInput} from "@demlik/tea";
import type {CheckingSchema} from "@demlik/tea/effect";
import {Schema} from "effect";
import {checkRun} from "./primitives.ts";

// Controls: a check is trusted only when it is red where it must fail and
// green where it must pass (docs/direction/new-combos.md, "Controls"). Labs
// call the two negative and positive controls.
//
//   on the bad input   on the good input   the answer
//   red                green               ok
//   green              green               missed: too weak, or it already works
//   red                red                 false_alarm: the check is wrong, or a bug today
//   green              red                 backwards: wrong both ways
//
// One side alone is a control too, and the test writer knows only one side
// per Property, on the plan's base:
//
//   a new Property      mustFail(onBase)   missed is `already_passes`
//   an existing one     mustPass(onBase)   false_alarm is `fails_on_base`
//   a mutant            mustFail(onMutant) missed is a mutant that lived
//
// The pure core comes first. Then a small child that runs the check on each
// side it was given and answers once every run is back.

/** What a check said on one input. */
export const Result = Schema.Literals(["red", "green"]);
export type Result = typeof Result.Type;

/** A control's answer: the check is trusted, or which way it failed. */
export type Controlled =
	| {readonly kind: "ok"}
	/** Green where it must fail. */
	| {readonly kind: "missed"}
	/** Red where it must pass. */
	| {readonly kind: "false_alarm"}
	/** Green where it must fail and red where it must pass, both at once. */
	| {readonly kind: "backwards"};

const ok = {kind: "ok"} as const;
const missed = {kind: "missed"} as const;
const falseAlarm = {kind: "false_alarm"} as const;

/** The negative control alone: on a known break, the check must be red. */
export const mustFail = (onBad: Result): typeof ok | typeof missed =>
	onBad === "red" ? ok : missed;

/** The positive control alone: on input that is right, the check must be green. */
export const mustPass = (onGood: Result): typeof ok | typeof falseAlarm =>
	onGood === "green" ? ok : falseAlarm;

/** Both controls. Neither failure hides the other. */
export function controls(onBad: Result, onGood: Result): Controlled {
	const bad = mustFail(onBad);
	const good = mustPass(onGood);
	if (bad.kind === "missed" && good.kind === "false_alarm") return {kind: "backwards"};
	return bad.kind === "missed" ? bad : good;
}

// ---------------------------------------------------------------- the child

/** Which control a run is for. */
export const Side = Schema.Literals(["bad", "good"]);
export type Side = typeof Side.Type;

/** One value per side, at least one side: a control with neither is not a control. */
export type Sides<T> =
	| {readonly bad: T; readonly good: T}
	| {readonly bad: T; readonly good: null}
	| {readonly bad: null; readonly good: T};

/** Only the good side. TypeScript does not narrow `Sides<T>` on `bad === null` while `T` is open, so this says it. */
const goodOnly = <T>(sides: Sides<T>): sides is {readonly bad: null; readonly good: T} =>
	sides.bad === null;

/** One side's run: asked, with its Cmd kept for a restart, or back with its result. */
export type Run<C> =
	| {readonly at: "asked"; readonly cmd: C}
	| {readonly at: "ran"; readonly result: Result};

export type Controlling<C> =
	| {readonly phase: "running"; readonly key: string; readonly sides: Sides<Run<C>>}
	| {readonly phase: "done"; readonly key: string; readonly answer: Controlled}
	/** The check itself could not run on one side, so it says nothing about the check. */
	| {readonly phase: "could_not_run"; readonly key: string; readonly side: Side};

/** The answer from every side's result, or `null` while one is still out. */
function answerOf<C>(sides: Sides<Run<C>>): Controlled | null {
	const result = (run: Run<C> | null) => (run === null || run.at === "asked" ? null : run.result);
	const bad = result(sides.bad);
	const good = result(sides.good);
	if (sides.bad !== null && bad === null) return null;
	if (sides.good !== null && good === null) return null;
	if (bad !== null && good !== null) return controls(bad, good);
	if (bad !== null) return mustFail(bad);
	return good === null ? null : mustPass(good);
}

/**
 * Controls as a child. The Elm answer: `init` sends `Cmd.batch` of one check
 * run per side, the model holds a `Maybe Result` for each, `update` fills one
 * as its run comes back, and once every side asked for is filled the answer
 * is known. Each run is a `checkRun` Cmd carrying the child's `key` and its
 * `side`, so the parent knows whose answer it is and which side it fills.
 * `resultOf` reads the check's verdict as red or green.
 */
export function createControls<const N extends string, I extends CmdInput, V>(config: {
	readonly name: N;
	/** What the check runs on: a known break on the bad side, input that is right on the good. */
	readonly input: CheckingSchema<I>;
	readonly verdict: CheckingSchema<V>;
	readonly resultOf: (verdict: V) => Result;
}) {
	const input: CheckingSchema<{readonly key: string; readonly side: Side; readonly on: I}> =
		Schema.Struct({key: Schema.String, side: Side, on: config.input});
	const run = checkRun(`${config.name}_control`, {input, verdict: config.verdict});
	type Cmd = ReturnType<typeof run>;
	type State = Controlling<Cmd>;

	const ask = (key: string, side: Side, on: I): Run<Cmd> => ({
		at: "asked",
		cmd: run({key, side, on}),
	});

	/** Start: one run per side given. */
	function start(key: string, on: Sides<I>): readonly [State, readonly Cmd[]] {
		const sides: Sides<Run<Cmd>> = goodOnly(on)
			? {bad: null, good: ask(key, "good", on.good)}
			: {bad: ask(key, "bad", on.bad), good: on.good === null ? null : ask(key, "good", on.good)};
		const state: State = {phase: "running", key, sides};
		return [state, asked(state)];
	}

	/** One side's run came back. A side not asked, or already back, changes nothing. */
	function ran(s: State, side: Side, verdict: V): State {
		if (s.phase !== "running") return s;
		const was = s.sides[side];
		if (was === null || was.at === "ran") return s;
		const back: Run<Cmd> = {at: "ran", result: config.resultOf(verdict)};
		const sides: Sides<Run<Cmd>> =
			side === "bad" ? {...s.sides, bad: back} : {...s.sides, good: back};
		const answer = answerOf(sides);
		return answer === null ? {...s, sides} : {phase: "done", key: s.key, answer};
	}

	/** One side's run could not run: the controls say nothing, and the parent decides. */
	const failed = (s: State, side: Side): State =>
		s.phase === "running" && s.sides[side]?.at === "asked"
			? {phase: "could_not_run", key: s.key, side}
			: s;

	/** The runs still out, which a restart sends again. */
	function asked(s: State): readonly Cmd[] {
		if (s.phase !== "running") return [];
		return [s.sides.bad, s.sides.good].flatMap((r) =>
			r !== null && r.at === "asked" ? [r.cmd] : [],
		);
	}

	return {name: config.name, run, start, ran, failed, asked} as const;
}
