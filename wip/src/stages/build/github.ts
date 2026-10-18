import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, FileSystem, Layer, Path, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild, runLow} from "../../child";
import {answerOf, type Gh} from "../../code-host-github";
import {hostEnv, runEnv} from "../../env";
import {SANDBOX, SANDBOX_URL, sandboxOnly} from "../../sandbox";
import {BuildHost, BuildWrites, type Copied} from "./services";
import {branchOf, readTicket} from "./ticket";

// The build stage's services, live: git and gh on this machine, run through
// Effect's `ChildProcess`. Every write here is listed, whole, below. There is
// no other.
//
//   copy   git clone --no-checkout <sandbox> <work>/clone           (once)
//          git -C <clone> fetch --prune origin
//          git -C <clone> worktree add -B build/<n> <work>/trees/<n> <origin/build/<n> or origin/main>
//          pnpm install --frozen-lockfile                           (in the copy, once)
//   push   git add -A; git commit; git push <sandbox> HEAD:refs/heads/build/<n>
//   open   gh api repos/<sandbox>/pulls: PATCH the open one, or POST a new one
//
// Each names the sandbox by the constant in src/sandbox.ts, never by a value
// it was handed: these services have no repository to be told. And each
// checks the ticket it was handed against the sandbox first (`sandboxOnly`),
// so a call that skipped the program's input schema still writes nothing.
//
// The repo's own code never runs with a login in reach. `pnpm install` runs
// its lifecycle scripts under `runEnv`, which holds no token. git is run with
// the repo's hooks turned off (`core.hooksPath`, `--no-verify`), so a hook
// in the copy never runs under `hostEnv`, which holds gh's login.
//
// Node is not touched here: Effect's `ChildProcess`, `FileSystem` and `Path`,
// as `@effect/platform-node` gives them, at the one `Layer.provide` below.

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** Every git call: no prompt, no hook of the repo's, no pager. */
const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];

/** A run that answered 0, as its stdout; anything else, the one failure. */
const ok = (exited: Exited): Effect.Effect<string, Failed> =>
	exited.code === 0 ? Effect.succeed(exited.out) : failed;

const PullRequest = Schema.Struct({html_url: Schema.String, number: Schema.Finite});
const PullRequests = Schema.Array(PullRequest);

export interface BuildConfig {
	/** The folder the clone and the working copies are kept in. Made when it is not there. */
	readonly work: string;
}

const services = (config: BuildConfig) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);
		const env = {...hostEnv(), GIT_TERMINAL_PROMPT: "0"};
		const git = (args: readonly string[]) => on(runChild("git", [...GIT_FIRST, ...args], {env}));
		const gitLow = (args: readonly string[]) => on(runLow("git", [...GIT_FIRST, ...args], {env}));
		const gh: Gh = (args) => on(runChild("gh", args, {env})).pipe(Effect.flatMap(ok));
		const exists = (at: string) => fs.exists(at).pipe(Effect.orElseSucceed(() => false));

		const clone = path.join(config.work, "clone");
		const treeOf = (number: number) => path.join(config.work, "trees", String(number));

		const copy = (ticket: string, number: number): Effect.Effect<Copied, Failed> =>
			Effect.gen(function* () {
				yield* sandboxOnly(ticket);
				const branch = branchOf(number);
				const tree = treeOf(number);
				if (!(yield* exists(path.join(clone, ".git")))) {
					yield* fs
						.makeDirectory(config.work, {recursive: true})
						.pipe(Effect.mapError(() => ({_tag: "unknown" as const})));
					yield* gitLow(["clone", "--no-checkout", SANDBOX_URL, clone]).pipe(Effect.flatMap(ok));
				}
				yield* gitLow(["-C", clone, "fetch", "--prune", "origin"]).pipe(Effect.flatMap(ok));
				if (!(yield* exists(tree))) {
					// A copy removed by hand is still on git's list until it is pruned.
					yield* git(["-C", clone, "worktree", "prune"]).pipe(Effect.flatMap(ok));
					const pushed = yield* git([
						"-C",
						clone,
						"rev-parse",
						"--verify",
						"--quiet",
						`refs/remotes/origin/${branch}`,
					]);
					const from = pushed.code === 0 ? `origin/${branch}` : "origin/main";
					yield* git(["-C", clone, "worktree", "add", "--no-track", "-B", branch, tree, from]).pipe(
						Effect.flatMap(ok),
					);
				}
				if (!(yield* exists(path.join(tree, "node_modules"))))
					yield* on(
						runLow("pnpm", ["install", "--frozen-lockfile"], {cwd: tree, env: runEnv()}),
					).pipe(Effect.flatMap(ok));
				// The real path: the agent's Check judges paths as they are written.
				const real = yield* fs
					.realPath(tree)
					.pipe(Effect.mapError(() => ({_tag: "unknown" as const})));
				const base = (yield* git(["-C", real, "rev-parse", "HEAD"]).pipe(
					Effect.flatMap(ok),
				)).trim();
				return {tree: real, branch, base};
			});

		const push = (
			ticket: string,
			copied: Copied,
			message: string,
		): Effect.Effect<{head: string; changed: boolean}, Failed> =>
			Effect.gen(function* () {
				yield* sandboxOnly(ticket);
				const at = ["-C", copied.tree];
				yield* git([...at, "add", "-A"]).pipe(Effect.flatMap(ok));
				// 1: something is staged. 0: nothing is, so this round's commit, if any, is already made.
				const staged = yield* git([...at, "diff", "--cached", "--quiet"]);
				if (staged.code === 1)
					yield* git([...at, "commit", "--no-verify", "-q", "-m", message]).pipe(
						Effect.flatMap(ok),
					);
				else if (staged.code !== 0) return yield* failed;
				const head = (yield* git([...at, "rev-parse", "HEAD"]).pipe(Effect.flatMap(ok))).trim();
				// Never forced: a branch that moved on GitHub is a failure to read, not one to overwrite.
				yield* gitLow([
					...at,
					"push",
					"--no-verify",
					SANDBOX_URL,
					`HEAD:refs/heads/${copied.branch}`,
				]).pipe(Effect.flatMap(ok));
				return {head, changed: head !== copied.base};
			});

		const open = (
			ticket: string,
			number: number,
			title: string,
			body: string,
		): Effect.Effect<string, Failed> =>
			Effect.gen(function* () {
				yield* sandboxOnly(ticket);
				const [owner] = SANDBOX.split("/");
				const branch = branchOf(number);
				const pulls = `repos/${SANDBOX}/pulls`;
				const found = yield* answerOf(gh, PullRequests, [
					"api",
					`${pulls}?head=${owner}:${branch}&state=open&per_page=10`,
				]);
				const [standing] = found;
				if (standing !== undefined) {
					yield* gh([
						"api",
						"--method",
						"PATCH",
						`${pulls}/${standing.number}`,
						"-f",
						`title=${title}`,
						"-f",
						`body=${body}`,
					]);
					return standing.html_url;
				}
				const made = yield* answerOf(gh, PullRequest, [
					"api",
					"--method",
					"POST",
					pulls,
					"-f",
					`title=${title}`,
					"-f",
					`head=${branch}`,
					"-f",
					"base=main",
					"-f",
					`body=${body}`,
				]);
				return made.html_url;
			});

		return Context.make(BuildHost, {ticket: readTicket(gh)}).pipe(
			Context.add(BuildWrites, {copy, push, open}),
		);
	});

/** `BuildHost` and `BuildWrites` on this machine's git and gh, writing to the sandbox alone. */
export const gitHubBuild = (config: BuildConfig): Layer.Layer<BuildHost | BuildWrites> =>
	Layer.effectContext(services(config)).pipe(Layer.provide(nodeServices));
