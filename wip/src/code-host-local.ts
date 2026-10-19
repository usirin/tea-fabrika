import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Layer, Path, Ref, Semaphore, Stream} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {Ledger} from "./asks/ledger.ts";
import {criteriaOf, foldLedger} from "./asks/rules.ts";
import {apply, checksAt, lastAt, NONE, type Ran, type Runs} from "./check-runs.ts";
import {type Exited, runChild, runLow} from "./child.ts";
import {kindsNeeded, MOST_FILES, rulesOfBoth, textKindOf} from "./code-host-github.ts";
import {runEnv} from "./env.ts";
import {type PlanId, readPlanId, readTaskId, type TaskId} from "./ids.ts";
import {CodeHost} from "./services.ts";
import type {Change, Criterion} from "./stages/review/pack.ts";
import {repoRulesOf} from "./stages/rules.ts";

// `CodeHost` over a git working copy on this machine: what a review reads
// about one task of a plan at one commit, with no pull request
// (docs/direction/done-is-per-criterion.md, "One PR per plan"). The review
// machine runs on it unchanged. Its `pr` is a task, `<plan>/tasks/<task>`
// (`taskTarget`), and its `change` reads:
//
//   head      the commit asked for, or the copy's HEAD now
//   diff      git diff from where the branch left `base` to the head
//   files     the same diff's names, each with its kind; the kinds by the
//             same rules as GitHub's reader, over `.fabrika.jsonc` at the
//             base and at the head
//   rules     CLAUDE.md and AGENTS.md at `base`, never at the head
//   criteria  the task's own, from the plan's book in the ledger, by id and
//             version: not from any ticket's text
//   ticket    the plan's ticket, `part_of_it`: where the criteria record
//             keeps the rows (`ledgerRecord`)
//   checks    the commands in `checks`, as the last run at this exact head
//             left them (./check-runs.ts). None yet: pending
//
// `checksSettled` is what runs them: the review machine waits on it while the
// checks are pending, so a run starts only when a review waits for one. Each
// run gets a fresh detached copy of the head (`git worktree add --detach`),
// so neither a file the builder left uncommitted nor a commit made while it
// runs reaches its results. The copy is removed when the run ends, however
// it ends. Checks run under `runEnv` (no login in reach) and `nice -n 19`.
//
// Node is not touched here: Effect's `ChildProcess`, `FileSystem` and `Path`,
// as `@effect/platform-node` gives them, at the one `Layer.provide` below.

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** What this reader does not say. Shown beside its change wherever one is printed. */
export const NOT_READ: readonly string[] = [
	"state: a task has no pull request, so it is always `open`.",
	"deviations: always `absent`. A builder's notes are not read from its commits.",
	"ticket: the plan's first ticket, as `part_of_it`. A plan with no ticket reads `none`, and the gate sends it back.",
	"checks: kept in memory. A restart forgets them, and the next review runs them again.",
	"checks: only how each command ended. What it printed is not kept.",
];

/** One check: a name for the report, and the command, run in the copy's root. */
export interface LocalCheck {
	readonly name: string;
	readonly run: readonly [string, ...string[]];
}

export interface LocalSettings {
	/** The plan's working copy: a git working tree on the plan's one branch. Read, never changed. */
	readonly repo: string;
	/** What the branch is compared against, and where the rules are read: a ref or a commit, `origin/main`. */
	readonly base: string;
	/** Run in this order at each head reviewed. At least one: a review with no checks would pass on none. */
	readonly checks: readonly [LocalCheck, ...LocalCheck[]];
}

/** A task of a plan, as the review machine's `pr` names it: `owner/repo#N/tasks/t1`. */
export const taskTarget = (plan: PlanId, task: TaskId): string => `${plan}/tasks/${task}`;

/** The plan and task a target names. `null`: it names none. */
export function taskOf(target: string): {readonly plan: PlanId; readonly task: TaskId} | null {
	const found = /^(.+)\/tasks\/([^/]+)$/.exec(target);
	const plan = readPlanId(found?.[1] ?? "");
	const task = readTaskId(found?.[2] ?? "");
	return plan === null || task === null ? null : {plan, task};
}

/** Every git call: no hook of the repo's, no pager, no prompt. */
const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];

const services = (settings: LocalSettings, ref: Ref.Ref<Runs>) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const ledger = yield* Ledger;
		const lock = yield* Semaphore.make(1);
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);
		const names = settings.checks.map((check) => check.name);

		const gitIn = (dir: string, args: readonly string[]) =>
			on(
				runChild("git", [...GIT_FIRST, "-C", dir, ...args], {
					env: {...runEnv(), GIT_TERMINAL_PROMPT: "0"},
				}),
			);
		const ok = (ran: Exited): Effect.Effect<string, Failed> =>
			ran.code === 0 ? Effect.succeed(ran.out) : failed;
		/** What git printed, or `null` when it said no. */
		const maybe = (ran: Exited): string | null => (ran.code === 0 ? ran.out : null);
		const git = (args: readonly string[]) => gitIn(settings.repo, args);
		/** A file's text at a commit. `null`: it is not there. */
		const show = (at: string, file: string) =>
			git(["show", `${at}:${file}`]).pipe(Effect.map(maybe));
		const commitOf = (dir: string, rev: string) =>
			gitIn(dir, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).pipe(
				Effect.flatMap(ok),
				Effect.map((out) => out.trim()),
			);

		/** The task's criteria, from the plan's book, and the ticket its rows are kept under. */
		const planned = (task: {readonly plan: PlanId; readonly task: TaskId}) =>
			Effect.map(ledger.entries, (entries) => {
				const state = foldLedger(entries);
				const track = state.plans.get(task.plan);
				if (track === undefined) return {criteria: null, ticket: "none" as const};
				const criteria = criteriaOf(state, task.plan, task.task).map(
					(c): Criterion => ({
						id: c.id,
						version: c.version,
						text: c.text,
						checked: false,
						evidence: null,
					}),
				);
				const [ticket] = track.tickets;
				return {
					criteria,
					ticket:
						ticket === undefined ? ("none" as const) : {id: ticket, link: "part_of_it" as const},
				};
			});

		const change = (target: string, asked: string | null): Effect.Effect<Change, Failed> =>
			Effect.gen(function* () {
				const task = taskOf(target);
				// A commit that starts with `-` would be read by git as a flag.
				if (task === null || asked?.startsWith("-")) return yield* failed;
				const head = yield* commitOf(settings.repo, asked ?? "HEAD");
				const from = (yield* git(["merge-base", settings.base, head]).pipe(
					Effect.flatMap(ok),
				)).trim();
				const listed =
					maybe(yield* git(["diff", "--name-only", "-z", "--no-renames", from, head]))
						?.split("\0")
						.filter((name) => name !== "") ?? null;
				const paths = listed !== null && listed.length < MOST_FILES ? listed : null;
				const diff =
					paths === null
						? null
						: maybe(
								yield* git(["diff", "--no-color", "--no-ext-diff", "--no-renames", from, head]),
							);
				// The base's and the head's: a change cannot take itself out of a review.
				const kindRules = rulesOfBoth([
					yield* show(settings.base, ".fabrika.jsonc"),
					yield* show(head, ".fabrika.jsonc"),
				]);
				const blob = (text: string | null) => (text === null ? null : {text});
				// The base's only: a change cannot rewrite the rules it is held to.
				const rules = repoRulesOf({
					claudeMd: blob(yield* show(settings.base, "CLAUDE.md")),
					agentsMd: blob(yield* show(settings.base, "AGENTS.md")),
				});
				const {criteria, ticket} = yield* planned(task);
				return {
					pr: target,
					head,
					replay: asked !== null,
					state: "open",
					ticket,
					criteria,
					// A diff that did not come leaves the files without their text: neither is given.
					files:
						paths === null || diff === null
							? null
							: paths.map((file) => ({path: file, kind: textKindOf(file)})),
					kinds:
						paths === null || paths.length === 0 || kindRules === null
							? null
							: kindsNeeded(paths, kindRules),
					diff,
					deviations: {state: "absent"},
					checks: checksAt(yield* Ref.get(ref), head, names),
					rules,
				};
			});

		/**
		 * Every check, in order, in a fresh copy of `head`. The copy is read
		 * before the first check and after the last: a run whose copy moved
		 * stood at no one commit (`at: null`). A copy that could not be made
		 * is a run at no commit too: it counts for nothing, and is kept so the
		 * runs say it happened.
		 */
		const runAt = (head: string): Effect.Effect<Ran> =>
			Effect.gen(function* () {
				const dir = yield* fs.makeTempDirectoryScoped({prefix: "local-checks-"});
				const copy = path.join(dir, "at");
				yield* Effect.acquireRelease(
					git(["worktree", "add", "--detach", "--quiet", copy, head]).pipe(Effect.flatMap(ok)),
					() => git(["worktree", "remove", "--force", copy]).pipe(Effect.ignore),
				);
				const before = yield* commitOf(copy, "HEAD");
				const results = yield* Effect.forEach(
					settings.checks,
					(check) =>
						on(runLow(check.run[0], check.run.slice(1), {cwd: copy, env: runEnv()})).pipe(
							Effect.map((ran) => ({
								name: check.name,
								state: ran.code === 0 ? ("green" as const) : ("red" as const),
							})),
						),
					{concurrency: 1},
				);
				const after = yield* commitOf(copy, "HEAD");
				return {asked: head, at: before === after ? after : null, results};
			}).pipe(
				Effect.scoped,
				Effect.catch(() => Effect.succeed<Ran>({asked: head, at: null, results: []})),
			);

		/** Run the checks of `head` unless a run already stood there. One run at a time. */
		const settle = (head: string) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (lastAt(yield* Ref.get(ref), head) !== null) return;
					const ran = yield* runAt(head);
					yield* Ref.update(ref, (runs) => apply(runs, {type: "ran", ...ran}));
				}),
			);

		const host: CodeHost["Service"] = {
			// A task has no pull request: ship reads one only after the plan's pull request opens.
			prFacts: () => failed,
			change,
			// `after` names GitHub's re-runs. Here a run is never started again for a head it stood at.
			checksSettled: (_target, head) => Stream.fromEffect(settle(head)),
			// No pull request, so no merge queue: nothing is ever said.
			leftQueue: () => Stream.never,
		};
		return host;
	});

/**
 * `CodeHost` over one plan's working copy, reading each task's criteria from
 * the `Ledger`. `runs`: every check run so far, for a reader or a test.
 */
export function localCodeHost(settings: LocalSettings) {
	const ref = Ref.makeUnsafe<Runs>(NONE);
	const layer: Layer.Layer<CodeHost, never, Ledger> = Layer.effect(
		CodeHost,
		services(settings, ref),
	).pipe(Layer.provide(nodeServices));
	return {layer, runs: () => Effect.runSync(Ref.get(ref))};
}
