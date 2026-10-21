import {Effect, FileSystem, Path, Ref, Semaphore, Stream} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {apply, checksAt, lastAt, NONE, type Ran, type Runs} from "./check-runs.ts";
import {type Exited, runChild, runLow} from "./child.ts";
import {prOf} from "./code-host-github.ts";
import {hostEnv, runEnv} from "./env.ts";
import type {CodeHost} from "./services.ts";
import type {RunCheck} from "./setup.ts";
import {cloneIn, urlOf} from "./stages/build/github.ts";
import type {Checks} from "./stages/review/pack.ts";
import type {PrFacts} from "./stages/ship/facts.ts";

// The checks a repository names in its fabrika.toml (`[[checks.run]]`), run
// by fabrika itself at each head of a pull request on GitHub, for a
// repository with no CI of its own, or with CI that does not run the checks
// it counts on. A wrapper around the GitHub `CodeHost`: every read is
// GitHub's, with the checks joined in.
//
//   prFacts         GitHub's checks state, joined with the last local run at
//                   that exact head. `checks.github = "none"`: GitHub's are
//                   not read, only the local run counts
//   change          the same, check by check, for a review
//   checksSettled   runs the checks of the head, unless a run already stood
//                   there, then waits on GitHub's as before (not with "none")
//
// Each run gets a fresh detached copy of the head, made from the build
// stage's clone of the repository, so nothing the builder left uncommitted
// reaches it. The copy runs the repository's install first, then each check
// in order, all under `runEnv`: no login in reach. The copy is removed when
// the run ends, however it ends. The runs are kept by ./check-runs.ts, the
// same fold the local code host keeps (./code-host-local.ts).
//
// A run whose copy could not be made, or moved while it ran, stood at no
// commit: it counts for nothing, and the head's checks stay pending, never
// green on a guess.

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** Every git call: no hook of the repo's, no pager, no prompt. */
const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];

/** The name the install's result is kept under, beside the checks. */
export const INSTALL = "install";

export interface LocalChecks {
	/** The build stage's work folder: each repository's clone is in it (`cloneIn`). */
	readonly work: string;
	/** Run first in each copy. `[]`: nothing. */
	readonly install: readonly string[];
	/** In this order. At least one: a wrapper with none would add a check that passes on nothing. */
	readonly checks: readonly [RunCheck, ...RunCheck[]];
	/** Which of GitHub's checks count beside these. `none`: only these. */
	readonly github: "every" | "required" | "none";
}

/** A check state as the ship gate reads it. A list that could not be read is a stuck one. */
const SHIP_OF: {readonly [S in Checks["state"]]: PrFacts["checks"]} = {
	green: "green",
	red: "red",
	pending: "pending",
	unknown: "stuck",
};
/** Worst first: the first state any side is in is the state of both. */
const SHIP_WORST = [
	"red",
	"stuck",
	"pending",
	"green",
] as const satisfies readonly PrFacts["checks"][];
const CHANGE_WORST = [
	"red",
	"unknown",
	"pending",
	"green",
] as const satisfies readonly Checks["state"][];

/** GitHub's checks state and the local run's, as one, for the ship gate. `github: null`: not counted. Pure. */
export function shipChecksOf(github: PrFacts["checks"] | null, local: Checks): PrFacts["checks"] {
	const states: readonly PrFacts["checks"][] = [
		SHIP_OF[local.state],
		...(github === null ? [] : [github]),
	];
	return SHIP_WORST.find((state) => states.includes(state)) ?? SHIP_OF[local.state];
}

/** GitHub's checks and the local run's, check by check, for a review. `github: null`: not counted. Pure. */
export function changeChecksOf(github: Checks | null, local: Checks): Checks {
	const states = [local.state, ...(github === null ? [] : [github.state])];
	return {
		state: CHANGE_WORST.find((state) => states.includes(state)) ?? local.state,
		required: [...(github?.required ?? []), ...local.required],
	};
}

/** The GitHub `CodeHost`, with the repository's own checks run beside it. */
export const withLocalChecks = (
	inner: CodeHost["Service"],
	settings: LocalChecks,
): Effect.Effect<
	CodeHost["Service"],
	never,
	ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const ref = yield* Ref.make<Runs>(NONE);
		const lock = yield* Semaphore.make(1);
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);
		const names = [
			...(settings.install.length > 0 ? [INSTALL] : []),
			...settings.checks.map((check) => check.name),
		];
		const counted = settings.github !== "none";

		const ok = (ran: Exited): Effect.Effect<string, Failed> =>
			ran.code === 0 ? Effect.succeed(ran.out) : failed;
		/** git in the clone: it fetches, so it needs gh's login, and runs none of the repository's code. */
		const gitHost = (args: readonly string[]) =>
			on(
				runLow("git", [...GIT_FIRST, ...args], {env: {...hostEnv(), GIT_TERMINAL_PROMPT: "0"}}),
			).pipe(Effect.flatMap(ok));
		const gitIn = (dir: string, args: readonly string[]) =>
			on(
				runChild("git", [...GIT_FIRST, "-C", dir, ...args], {
					env: {...runEnv(), GIT_TERMINAL_PROMPT: "0"},
				}),
			).pipe(Effect.flatMap(ok));
		const commitOf = (dir: string) =>
			gitIn(dir, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).pipe(
				Effect.map((out) => out.trim()),
			);
		/** One command in the copy, under `runEnv`: green when it answers 0. */
		const runIn = (copy: string, command: readonly string[]) => {
			const [program, ...args] = command;
			return program === undefined
				? Effect.succeed("green" as const)
				: on(runLow(program, args, {cwd: copy, env: runEnv()})).pipe(
						Effect.map((ran) => (ran.code === 0 ? ("green" as const) : ("red" as const))),
						Effect.orElseSucceed(() => "red" as const),
					);
		};

		/** The clone the build stage made, made here when it is not there, with the pull request's head fetched into it. */
		const cloneWith = (pr: string) =>
			Effect.gen(function* () {
				const at = prOf(pr);
				if (at === null) return yield* failed;
				const clone = cloneIn(settings.work, at);
				const there = yield* fs
					.exists(path.join(clone, ".git"))
					.pipe(Effect.orElseSucceed(() => false));
				if (!there) {
					yield* fs
						.makeDirectory(path.dirname(clone), {recursive: true})
						.pipe(Effect.mapError(() => ({_tag: "unknown" as const})));
					yield* gitHost(["clone", "--no-checkout", "--quiet", urlOf(at), clone]);
				}
				yield* gitHost(["-C", clone, "fetch", "--quiet", "origin", `pull/${at.number}/head`]);
				return clone;
			});

		/** The install, then every check, in a fresh copy of `head`. */
		const runAt = (pr: string, head: string): Effect.Effect<Ran> =>
			Effect.gen(function* () {
				const clone = yield* cloneWith(pr);
				const dir = yield* fs
					.makeTempDirectoryScoped({prefix: "fabrika-checks-"})
					.pipe(Effect.mapError(() => ({_tag: "unknown" as const})));
				const copy = path.join(dir, "at");
				yield* Effect.acquireRelease(
					gitIn(clone, ["worktree", "add", "--detach", "--quiet", copy, head]),
					() => gitIn(clone, ["worktree", "remove", "--force", copy]).pipe(Effect.ignore),
				);
				const before = yield* commitOf(copy);
				const installed =
					settings.install.length === 0
						? []
						: [{name: INSTALL, state: yield* runIn(copy, settings.install)}];
				// A copy whose install failed runs no check: each is red, never left pending.
				const results = [
					...installed,
					...(yield* Effect.forEach(
						settings.checks,
						(check) =>
							installed.some((r) => r.state === "red")
								? Effect.succeed({name: check.name, state: "red" as const})
								: Effect.map(runIn(copy, check.run), (state) => ({name: check.name, state})),
						{concurrency: 1},
					)),
				];
				const after = yield* commitOf(copy);
				return {asked: head, at: before === after && before === head ? head : null, results};
			}).pipe(
				Effect.scoped,
				Effect.catch(() => Effect.succeed<Ran>({asked: head, at: null, results: []})),
			);

		/** Run the checks of `head` unless a run already stood there. One run at a time. */
		const settle = (pr: string, head: string) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (lastAt(yield* Ref.get(ref), head) !== null) return;
					const ran = yield* runAt(pr, head);
					yield* Ref.update(ref, (runs) => apply(runs, {type: "ran", ...ran}));
				}),
			);
		const localAt = (head: string) =>
			Effect.map(Ref.get(ref), (runs) => checksAt(runs, head, names));

		const host: CodeHost["Service"] = {
			prFacts: (pr) =>
				Effect.gen(function* () {
					const facts = yield* inner.prFacts(pr);
					const local = yield* localAt(facts.head);
					return {...facts, checks: shipChecksOf(counted ? facts.checks : null, local)};
				}),
			change: (pr, head) =>
				Effect.gen(function* () {
					const change = yield* inner.change(pr, head);
					const local = yield* localAt(change.head);
					return {...change, checks: changeChecksOf(counted ? change.checks : null, local)};
				}),
			checksSettled: (pr, head, after) =>
				Stream.fromEffect(settle(pr, head)).pipe(
					Stream.flatMap(() =>
						counted ? inner.checksSettled(pr, head, after) : Stream.succeed(undefined),
					),
				),
			leftQueue: inner.leftQueue,
		};
		return host;
	});
