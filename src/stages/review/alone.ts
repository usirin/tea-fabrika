import {Effect} from "effect";
import type {CodeHost} from "../../services.ts";
import {nameOf} from "../outcome.ts";
import {reviewGate} from "./gate.ts";
import type {ReviewName, ReviewOutcome} from "./outcome.ts";
import {type Ask, type Pack, readPack} from "./pack.ts";
import {type Comment, render} from "./render.ts";
import {DEFAULT_EFFORT, DEFAULT_MODEL, type Ran, Reviewer} from "./reviewer.ts";
import {readForm, type Sheet} from "./sheet.ts";
import {type KindVerdict, outcomeOf, verdictsOf} from "./verdict.ts";

// The first piece of the review stage, run alone on one pull request:
//
//   Gather  pack      everything a reviewer needs, read by code
//   Check   gate      anything to review, and is the pack whole (a red check stops here)
//   Draft   reviewer  the one agent job: a form
//   Check   verdict   pure code over the sheet
//           render    the sheet printed as markdown
//
// It only reads. It is given the read side of the code host and nothing
// else, so it cannot post, and the compiler says so. There is no machine with
// phases here yet: the five steps are one function, top to bottom.

/** What a run was asked for, from the command line. */
export interface Plan extends Ask {
	/** A local clone that holds the commit. */
	readonly repo: string;
	readonly model: string;
	readonly effort: "low" | "medium" | "high";
	readonly maxUsd: number;
}

export const USAGE =
	"usage: node src/stages/review/run.ts <pull request url> --rubrics <folder> --repo <local clone> [--head <commit>] [--model <name>] [--effort low|medium|high] [--max-usd <dollars>]";

const EFFORTS = ["low", "medium", "high"] as const;
/** The dollars one run may cost when nobody says. */
export const DEFAULT_MAX_USD = 2;

/** The command line, read. `null`: not that. */
export function planOf(argv: readonly string[]): Plan | null {
	const [pr, ...flags] = argv;
	const given = (flag: string): string | null => {
		const at = flags.indexOf(flag);
		const value = at === -1 ? undefined : flags[at + 1];
		return value === undefined || value.startsWith("--") ? null : value;
	};
	const rubrics = given("--rubrics");
	const repo = given("--repo");
	const head = given("--head");
	const effort = given("--effort") ?? DEFAULT_EFFORT;
	const maxUsd = Number(given("--max-usd") ?? DEFAULT_MAX_USD);
	if (
		pr === undefined ||
		!/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(pr) ||
		rubrics === null ||
		repo === null
	)
		return null;
	// A commit is named whole: a short one could be two commits.
	if (flags.includes("--head") && (head === null || !/^[0-9a-f]{40}$/.test(head))) return null;
	if (!(EFFORTS as readonly string[]).includes(effort) || !(maxUsd > 0)) return null;
	return {
		pr,
		head,
		rubrics,
		repo,
		model: given("--model") ?? DEFAULT_MODEL,
		effort: effort as Plan["effort"],
		maxUsd,
	};
}

/** How far a run got, and what it has to show for it. Every one but `wait` ends in an outcome and its name. */
export type Alone =
	/** The pull request could not be read at all. */
	| {readonly reached: "read"; readonly outcome: ReviewOutcome; readonly name: ReviewName}
	/** The gate stopped it: no reviewer was started. */
	| {
			readonly reached: "gate";
			readonly pack: Pack;
			readonly outcome: ReviewOutcome;
			readonly name: ReviewName;
	  }
	/** A required check is still running. A machine would wait; this piece does not, so it has no outcome. */
	| {readonly reached: "wait"; readonly pack: Pack}
	/** The reviewer ran and left no sheet. `problems`: why, in words. */
	| {
			readonly reached: "draft";
			readonly pack: Pack;
			readonly ran: Ran;
			readonly problems: readonly string[];
			readonly outcome: ReviewOutcome;
			readonly name: ReviewName;
	  }
	| {
			readonly reached: "verdict";
			readonly pack: Pack;
			readonly ran: Ran;
			readonly sheet: Sheet;
			readonly verdicts: readonly KindVerdict[];
			readonly comments: readonly Comment[];
			readonly outcome: ReviewOutcome;
			readonly name: ReviewName;
	  };

const named = <O extends ReviewOutcome>(outcome: O) => ({
	outcome,
	name: nameOf(outcome) as ReviewName,
});

/** One review, from the read to the printout. Never fails: every way it can go wrong is an outcome. */
export const alone = (ask: Ask): Effect.Effect<Alone, never, CodeHost | Reviewer> =>
	Effect.gen(function* () {
		const read = yield* Effect.option(readPack(ask));
		if (read._tag === "None")
			return {reached: "read", ...named({kind: "stuck", why: "read_failed"})} satisfies Alone;
		const pack = read.value;
		const gate = reviewGate(pack);
		if (gate.answer === "stop")
			return {reached: "gate", pack, ...named(gate.outcome)} satisfies Alone;
		if (gate.answer === "wait_for_checks") return {reached: "wait", pack} satisfies Alone;

		const {brief} = gate;
		const drafted = yield* (yield* Reviewer).draft(brief);
		const {spend, tools, refused} = drafted;
		const ran: Ran = {spend, tools, refused};
		const failed = (problems: readonly string[]): Alone => ({
			reached: "draft",
			pack,
			ran,
			problems,
			...named({kind: "stuck", why: "draft_failed"}),
		});
		if (drafted.answer === "broke") return failed([drafted.error]);
		if (drafted.answer === "misfit")
			return failed(["what the reviewer handed back does not read as a form"]);
		const made = readForm(brief, drafted.form);
		if (made.answer === "problems") return failed(made.problems);

		const verdicts = verdictsOf(brief.kinds, made.sheet);
		return {
			reached: "verdict",
			pack,
			ran,
			sheet: made.sheet,
			verdicts,
			comments: render(brief, made.sheet, verdicts),
			...named(outcomeOf(brief, verdicts)),
		} satisfies Alone;
	});
