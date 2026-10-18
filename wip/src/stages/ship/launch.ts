import {randomUUID} from "node:crypto";
import {type BadShape, type ListenersOf, start, tell} from "@tea-fabrika/tea-program";
import {memoryStorage} from "@tea-fabrika/tea-program/storage";
import {Effect, Layer} from "effect";
import {NOT_READ} from "../../code-host-github.ts";
import {type CodeHost, CodeHostWrites} from "../../services.ts";
import type {Look} from "./look.ts";
import {shipProgram} from "./program.ts";

// What `run.ts` needs to start the ship program from a command line: the
// arguments read into the program's flag, its input values and the GitHub
// service's settings, the line that says which mode it is in, the services,
// and the printing. Kept here, apart from the script, so tests can reach every
// piece.
//
// The command line splits three ways. `--write` is the program's flag `mode`.
// Each url is a value told on the program's input `pr`, in order: the
// launcher stands where `review | ship` would. `--own` and `--reviewers` are
// settings of the GitHub reader (`CodeHost`): who the repo treats as its own
// is a fact about the repo, not about this run, and the machine never reads
// them.

type ShipProgram = typeof shipProgram;

/** What a run was asked for, from the command line. */
export interface Plan {
	/** The pull requests named before the first flag. Their shape is the program's to check. */
	readonly prs: readonly [string, ...string[]];
	readonly mode: "read" | "write";
	/** The accounts the repo treats as its own. */
	readonly own: readonly string[];
	/** The accounts whose review verdicts count. */
	readonly reviewers: readonly string[];
}

/**
 * `<pull request url>... --own a,b [--reviewers c,d] [--write]`, read.
 * `null`: no pull request before the flags, or no `--own`. Writing is off
 * unless `--write` is there. Whether each url is a pull request's is not
 * judged here: the program's input says, as `bad_shape`.
 */
export function planOf(argv: readonly string[]): Plan | null {
	const first = argv.findIndex((arg) => arg.startsWith("--"));
	const named = first === -1 ? argv : argv.slice(0, first);
	const flags = first === -1 ? [] : argv.slice(first);
	const accounts = (flag: string): readonly string[] => {
		const at = flags.indexOf(flag);
		return at === -1
			? []
			: (flags[at + 1] ?? "").split(",").filter((login) => login !== "" && !login.startsWith("--"));
	};
	const [pr, ...more] = named;
	const own = accounts("--own");
	const reviewers = accounts("--reviewers");
	if (pr === undefined || own.length === 0) return null;
	return {
		prs: [pr, ...more],
		mode: flags.includes("--write") ? "write" : "read",
		own,
		reviewers: reviewers.length === 0 ? own : reviewers,
	};
}

/**
 * The first url of a plan the program's input `pr` would refuse, as
 * `bad_shape`, or `undefined` when every one fits. Asked before the program
 * starts, so a bad url runs nothing and makes no service.
 */
export function checked(plan: Plan, program: ShipProgram = shipProgram): BadShape | undefined {
	for (const pr of plan.prs) {
		const why = program.inputs.pr.shape.problem(pr);
		if (why !== undefined) return {kind: "bad_shape", name: "pr", why};
	}
	return undefined;
}

/** The one line a run opens with, so nobody has to guess which mode it is in. */
export const modeLine = (plan: Plan): string =>
	plan.mode === "write"
		? `mode: WRITE. This run may put ${plan.prs.join(", ")} in the merge queue and start its red checks again.`
		: `mode: read only. Nothing on ${plan.prs.join(", ")} will be changed.`;

/** The services a run is made from. Each is a call, so the write side exists only when it is asked for. */
export interface Parts {
	readonly reads: () => Layer.Layer<CodeHost>;
	readonly writes: () => Layer.Layer<CodeHostWrites>;
}

const refuse = () =>
	Effect.die(new Error("this run only reads: it has no write side, and asked for one"));
/** The write side of a read-only run: there is none. A call to it is a bug, and dies. */
export const noWrites = Layer.succeed(CodeHostWrites, {
	enqueue: refuse,
	merge: refuse,
	rerunChecks: refuse,
});

/** The services for a plan. `parts.writes` is called only in write mode. */
export const servicesOf = (plan: Plan, parts: Parts) =>
	Layer.suspend(() =>
		Layer.mergeAll(parts.reads(), plan.mode === "write" ? parts.writes() : noWrites),
	);

/**
 * Start the ship program on a plan, with `listeners` on its outputs from the
 * first instant, tell it each url in order, close its input, and wait for it
 * to end: like `printf '%s\n' <urls> | ship`. Answers `{kind: "ran"}`, or
 * `bad_shape` for a url that does not fit, before any service is made. A run
 * that fails fails this too.
 * `program`: one over a ship machine with other limits, for a test.
 */
export const launch = (
	plan: Plan,
	parts: Parts,
	listeners: ListenersOf<ShipProgram>,
	program: ShipProgram = shipProgram,
) =>
	Effect.gen(function* () {
		const bad = checked(plan, program);
		if (bad !== undefined) return bad;
		return yield* shipEach(plan, parts, listeners, program);
	});

const shipEach = (
	plan: Plan,
	parts: Parts,
	listeners: ListenersOf<ShipProgram>,
	program: ShipProgram,
) =>
	Effect.gen(function* () {
		// A command line's run is never started again: it keeps nothing past the process, and says so.
		const started = yield* start(program, {mode: plan.mode}, listeners, {
			id: `ship:${randomUUID()}`,
			storage: memoryStorage(),
		});
		if (started.kind === "bad_shape") return started;
		const {run, close} = started;
		for (const pr of plan.prs) {
			const word = tell(run, "pr", pr);
			if (word !== "queued")
				return yield* Effect.die(new Error(`ship did not take ${pr}: ${word}`));
		}
		close("pr");
		const end = yield* run.ended;
		if (end.kind === "failed") return yield* Effect.failCause(end.cause);
		return {kind: "ran"} as const;
	}).pipe(Effect.scoped, Effect.provide(servicesOf(plan, parts)));

/** What read mode prints for one pull request: what it found, the next step in words, and what the reader does not read. */
export const shown = (found: Look) => {
	const next =
		found.wouldSend?.type === "ship_enqueue"
			? "would enqueue: not sent, this run only reads"
			: found.wouldSend?.type === "ship_rerun_checks"
				? "would run the red checks again, once: not sent, this run only reads"
				: found.wouldWaitFor === "checks"
					? "would wait for the checks on this head, then read again: this run does not wait"
					: found.facts === null
						? "nothing: the pull request could not be read"
						: "nothing: the machine stops here with this outcome";
	return {...found, next, notRead: NOT_READ};
};
