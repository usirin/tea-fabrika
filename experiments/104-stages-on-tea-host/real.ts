// Experiment 104's real world: the stages' live services on GitHub, and real Claude agents (haiku).
// Every write goes to one repository, `SANDBOX`: the GitHub `Outside` refuses any other before it
// sends, and the harness makes and cleans up its issues, pull requests and branches there only.
import {Layer} from "effect";
import {gitHubCodeHost} from "../../packages/fabrika/src/pipeline/code-host-github.ts";
import {hostEnv} from "../../packages/fabrika/src/pipeline/env.ts";
import {BuildWork} from "../../packages/fabrika/src/pipeline/hosted/build.ts";
import {gitHubOutside} from "../../packages/fabrika/src/pipeline/hosted/outside.ts";
import {sh} from "../../packages/fabrika/src/pipeline/sh.ts";
import {liveBuilder} from "../../packages/fabrika/src/pipeline/stages/build/builder.ts";
import {gitHubBuild} from "../../packages/fabrika/src/pipeline/stages/build/github.ts";
import {livePlanner} from "../../packages/fabrika/src/pipeline/stages/plan/planner.ts";
import {githubPlanHost, noFacts} from "../../packages/fabrika/src/pipeline/stages/plan/services.ts";
import {liveReviewer} from "../../packages/fabrika/src/pipeline/stages/review/reviewer.ts";

/** The one repository experiment 104 writes to. */
export const SANDBOX = "kamp-us/tea-fabrika-sandbox";

export const realOutside = () => gitHubOutside([SANDBOX]);

/** Review: the pull request read on GitHub, the reviewer reading `clone` (it holds the head). */
export const realReview = (clone: string) =>
	Layer.mergeAll(gitHubCodeHost({own: [], reviewers: []}), liveReviewer({repo: clone}));

/** Plan: the ticket read on GitHub, no gathered facts, the planner reading `clone`. */
export const realPlan = (clone: string) =>
	Layer.mergeAll(
		githubPlanHost((args) => sh("gh", args)),
		noFacts,
		livePlanner({repo: clone}),
	);

/** Build: the ticket read on GitHub, the builder in a copy under `work`, git as this host. */
export const realBuild = (work: string) =>
	Layer.mergeAll(
		gitHubBuild({work}),
		liveBuilder(),
		Layer.succeed(BuildWork, {
			dir: work,
			env: {...hostEnv(), GIT_TERMINAL_PROMPT: "0"},
			install: false,
		}),
	);
