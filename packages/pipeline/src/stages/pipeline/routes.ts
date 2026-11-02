import {Schema} from "effect";
import type {ShipName} from "../ship/outcome.ts";

// Where a ship refusal at `exam_merge` goes (self-fix PR 10, Part 3). Today's version.
//
//   A ship send names what is wrong with the exam's pull request. Each has one row here, typed over
//   ship's own names, so a send ship gains and this table lacks does not compile. Every send there is
//   fixable (experiment 193's classes), so no row asks a person or stops the lane.
//
//   EXAM_MERGE_SENDS["send:builder:conflicts"]
//   // {_tag: "back", step: "exam", with: "files", bound: "rounds"}: the exam writer redoes those files
//
// These are the first rows of PR 11's `ROUTES`, in its `Move` shape. PR 11 widens `step` to every
// lane step and adds the other moves; no row here moves.

/** The steps a row here sends the lane to. PR 11 widens it to every lane step. */
const Step = Schema.Literals(["exam", "exam_review"]);

/** What a step sent back is handed, besides its plan: the reason it runs again. */
export const With = Schema.Literals(["names", "findings", "comment", "files"]);
export type With = typeof With.Type;

/**
 * Where the lane goes after an outcome. `run`: that step, now. `back`: that step again, with what it
 * must fix, counted against `bound`. `fresh`: take main in, then run `then`. `once`: the same step
 * again as a new run; a second time stops with its why.
 */
export const Move = Schema.Union([
	Schema.TaggedStruct("run", {step: Step}),
	Schema.TaggedStruct("back", {step: Step, with: With, bound: Schema.Literals(["rounds", "once"])}),
	Schema.TaggedStruct("fresh", {then: Step}),
	Schema.TaggedStruct("once", {}),
]);
export type Move = typeof Move.Type;

type Step = typeof Step.Type;

export const run = (step: Step): Move => ({_tag: "run", step});
/** Back to `step` with what it must fix. Each one counts a round, as a build round does. */
export const back = (step: Step, why: With): Move => ({
	_tag: "back",
	step,
	with: why,
	bound: "rounds",
});
export const fresh = (then: Step): Move => ({_tag: "fresh", then});
export const once: Move = {_tag: "once"};

/** Every `send` ship can end with, by its printed name. */
type ShipSend = Extract<ShipName, `send:${string}`>;

/** A ship send at `exam_merge`, and where it goes. Each `back` counts an exam round. */
export const EXAM_MERGE_SENDS = {
	/** Code first: format and checks, then a fresh review. */
	"send:reviewer:no_review": run("exam_review"),
	/** Format and checks by code; still red goes to the exam writer from there. */
	"send:builder:checks_red": run("exam_review"),
	/** Main merged into the exam branch, then the same. */
	"send:builder:behind": fresh("exam_review"),
	"send:builder:review_failed": back("exam", "findings"),
	/** The exam writer redoes those files on main. */
	"send:builder:conflicts": back("exam", "files"),
	"send:builder:bot_comment": back("exam", "comment"),
	/** Ship again, as a new run; twice: stop, with ship's why. */
	"send:builder:ejected": once,
} as const satisfies Record<ShipSend, Move>;
