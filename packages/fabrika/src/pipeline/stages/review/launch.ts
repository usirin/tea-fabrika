import {randomUUID} from "node:crypto";
import {Effect, Layer} from "effect";
import {type BadShape, type ListenersOf, offer, start} from "../../../program/program.ts";
import {memoryStorage} from "../../../program/storage.ts";
import {memoryRecord} from "../../criteria/record.ts";
import type {CodeHost} from "../../services.ts";
import {reviewProgram} from "./program.ts";
import {
	DEFAULT_BUDGET,
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EFFORTS,
	type Reviewer,
} from "./reviewer.ts";

// What `run.ts` needs to start the review program from a command line: the
// arguments read into the program's flags, its input values and the live
// reviewer's setting, the services, and the launch. Kept apart from the
// script, so tests can reach every piece.
//
// The command line splits three ways. `--rubrics`, `--model`, `--effort` and
// `--budget` are the program's flags: how this run reviews. Each url is a
// value told on its input `pr`, in order: the launcher stands where an
// upstream program would. `--repo` is a setting of the live reviewer: where
// this computer keeps a clone to copy the code out of, like ship's `--own`.

type ReviewProgram = typeof reviewProgram;

export const USAGE =
	"usage: node src/stages/review/run.ts <pull request url>... --rubrics <folder> --repo <local clone> [--model <name>] [--effort low|medium|high] [--budget <dollars>]";

/** What a run was asked for, from the command line. */
export interface Plan {
	/** The urls named before the first flag. Their shape is the program's to check. */
	readonly prs: readonly [string, ...string[]];
	readonly rubrics: string;
	readonly repo: string;
	readonly model: string;
	readonly effort: string;
	readonly budget: number;
}

/**
 * The command line, read. `null`: no url before the flags, no rubric folder,
 * or no clone. Whether each value fits is not judged here: the program's
 * flags and input say, as `bad_shape`.
 */
export function planOf(argv: readonly string[]): Plan | null {
	const first = argv.findIndex((arg) => arg.startsWith("--"));
	const named = first === -1 ? argv : argv.slice(0, first);
	const flags = first === -1 ? [] : argv.slice(first);
	const given = (flag: string): string | null => {
		const at = flags.indexOf(flag);
		const value = at === -1 ? undefined : flags[at + 1];
		return value === undefined || value.startsWith("--") ? null : value;
	};
	const [pr, ...more] = named;
	const rubrics = given("--rubrics");
	const repo = given("--repo");
	if (pr === undefined || rubrics === null || repo === null) return null;
	const budget = given("--budget");
	return {
		prs: [pr, ...more],
		rubrics,
		repo,
		model: given("--model") ?? DEFAULT_MODEL,
		effort: given("--effort") ?? DEFAULT_EFFORT,
		budget: budget === null ? DEFAULT_BUDGET : Number(budget),
	};
}

/** The program's flags, from a plan. */
export const flagsOf = (plan: Plan) => ({
	rubrics: plan.rubrics,
	model: plan.model,
	effort: plan.effort as (typeof EFFORTS)[number],
	budget: plan.budget,
});

/**
 * The first flag or url of a plan the program would refuse, as `bad_shape`,
 * or `undefined` when all fit. Asked before the program starts, so a bad
 * value runs nothing and makes no service.
 */
export function checked(plan: Plan, program: ReviewProgram = reviewProgram): BadShape | undefined {
	const flags = flagsOf(plan);
	for (const name of Object.keys(program.flags) as (keyof typeof flags)[]) {
		const why = program.flags[name].shape.problem(flags[name]);
		if (why !== undefined) return {kind: "bad_shape", name, why};
	}
	for (const pr of plan.prs) {
		const why = program.inputs.pr.shape.problem(pr);
		if (why !== undefined) return {kind: "bad_shape", name: "pr", why};
	}
	return undefined;
}

export const modeLine = (plan: Plan): string =>
	`mode: read only. Nothing on ${plan.prs.join(", ")} will be changed, and nothing will be posted.`;

/** The services a run is made from. Each is a call, so none is made for a plan that does not fit. */
export interface Parts {
	readonly reads: () => Layer.Layer<CodeHost>;
	readonly reviewer: () => Layer.Layer<Reviewer>;
}

/**
 * Start the review program on a plan, with `listeners` on its outputs from
 * the first instant, tell it each url in order, close its input, and wait for
 * it to end: like `printf '%s\n' <urls> | review`. Answers `{kind: "ran"}`,
 * or `bad_shape` before any service is made.
 */
export const launch = (
	plan: Plan,
	parts: Parts,
	listeners: ListenersOf<ReviewProgram>,
	program: ReviewProgram = reviewProgram,
) =>
	Effect.gen(function* () {
		const bad = checked(plan, program);
		if (bad !== undefined) return bad;
		return yield* reviewEach(plan, parts, listeners, program);
	});

const reviewEach = (
	plan: Plan,
	parts: Parts,
	listeners: ListenersOf<ReviewProgram>,
	program: ReviewProgram,
) =>
	Effect.gen(function* () {
		// A command line's run is never started again: it keeps nothing past the process, and says so.
		const started = yield* start(program, flagsOf(plan), listeners, {
			id: `review:${randomUUID()}`,
			storage: memoryStorage(),
		});
		if (started.kind === "bad_shape") return started;
		const {run, close} = started;
		// Offered: a list longer than the input holds waits for review to read, like a file piped into a command.
		for (const pr of plan.prs) {
			const word = yield* offer(run, "pr", pr);
			if (word !== "queued")
				return yield* Effect.die(new Error(`review did not take ${pr}: ${word}`));
		}
		close("pr");
		const end = yield* run.ended;
		if (end.kind === "failed") return yield* Effect.failCause(end.cause);
		return {kind: "ran"} as const;
	}).pipe(
		Effect.scoped,
		// The verdict rows go to a record in memory: like the run, they are kept nowhere past the process.
		Effect.provide(
			Layer.suspend(() => Layer.mergeAll(parts.reads(), parts.reviewer(), memoryRecord().layer)),
		),
	);
