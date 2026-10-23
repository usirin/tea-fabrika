import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {hostEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, FileSystem, Layer, Path} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runLow} from "../../child.ts";
import type {Gh} from "../../code-host-github.ts";
import {cloneIn, urlOf} from "../build/github.ts";
import {ticketOf} from "../build/ticket.ts";
import {githubPlanHost, PlanHost} from "./services.ts";

// The ticket on GitHub, planned at main as it is now: the repository's clone
// under the work folder (the one build pushes from, `cloneIn`), made when it
// is not there and fetched, and the commit `origin/main` names after the
// fetch handed to the planner as the ticket's `at`. A clone's own HEAD is
// where it was when it was made, so a plan read at it would read old code.
// A clone that cannot be made or fetched is a ticket that cannot be read:
// never a plan read at a guess.

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** Every git call: no hook of the repo's, no pager, no prompt. */
const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];

/** `PlanHost` over GitHub, each ticket planned at its repository's main as fetched now. */
export const planAtMain = (gh: Gh, work: string): Layer.Layer<PlanHost> =>
	Layer.effect(
		PlanHost,
		Effect.gen(function* () {
			const inner = yield* PlanHost;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const ok = (ran: Exited): Effect.Effect<string, Failed> =>
				ran.code === 0 ? Effect.succeed(ran.out.trim()) : failed;
			// git fetches here, so it runs with gh's login, and runs none of the repository's code.
			const git = (args: readonly string[]) =>
				Effect.provideService(
					runLow("git", [...GIT_FIRST, ...args], {env: {...hostEnv(), GIT_TERMINAL_PROMPT: "0"}}),
					ChildProcessSpawner.ChildProcessSpawner,
					spawner,
				).pipe(Effect.flatMap(ok));
			const mainOf = (url: string) =>
				Effect.gen(function* () {
					const at = ticketOf(url);
					if (at === null) return yield* failed;
					const clone = cloneIn(work, at);
					const there = yield* fs
						.exists(path.join(clone, ".git"))
						.pipe(Effect.orElseSucceed(() => false));
					if (!there) {
						yield* fs
							.makeDirectory(path.dirname(clone), {recursive: true})
							.pipe(Effect.mapError(() => ({_tag: "unknown" as const})));
						yield* git(["clone", "--no-checkout", "--quiet", urlOf(at), clone]);
					}
					yield* git(["-C", clone, "fetch", "--prune", "--quiet", "origin"]);
					return yield* git(["-C", clone, "rev-parse", "--verify", "origin/main^{commit}"]);
				});
			return {
				ticket: (url: string) =>
					// The ticket's text and the fetch do not wait on each other.
					Effect.all([inner.ticket(url), mainOf(url)], {concurrency: "unbounded"}).pipe(
						Effect.map(([ticket, main]) => ({...ticket, at: main})),
					),
			};
		}),
	).pipe(Layer.provide(Layer.merge(githubPlanHost(gh), nodeServices)));
