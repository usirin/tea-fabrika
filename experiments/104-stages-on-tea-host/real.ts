// Experiment 104's real world: the stages' live services on GitHub, and real Claude agents (haiku).
// Every write goes to one repository, `SANDBOX`: the GitHub `Outside` refuses any other before it
// sends, and the harness makes and cleans up its issues, pull requests and branches there only.
import {Layer} from "effect";
import {hostEnv} from "../../packages/fabrika/src/agents/claude/env.ts";
import type {Ledger} from "../../packages/pipeline/src/asks/ledger.ts";
import {gitHubCodeHost} from "../../packages/pipeline/src/code-host-github.ts";
import {BuildWork} from "../../packages/pipeline/src/hosted/build.ts";
import {gitHubOutside} from "../../packages/pipeline/src/hosted/outside.ts";
import {sh} from "../../packages/pipeline/src/sh.ts";
import {liveBuilder} from "../../packages/pipeline/src/stages/build/builder.ts";
import {gitHubBuild} from "../../packages/pipeline/src/stages/build/github.ts";
import {livePlanner} from "../../packages/pipeline/src/stages/plan/planner.ts";
import {githubPlanHost, noFacts} from "../../packages/pipeline/src/stages/plan/services.ts";
import {liveReviewer} from "../../packages/pipeline/src/stages/review/reviewer.ts";

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

/**
 * Build: the ticket read on GitHub, its plan read on `ledger`, the builder in a copy under
 * `work`, git as this host. Since 2026-10-21 a ticket is built only once a plan naming it is
 * approved on that ledger; a label never lets it.
 */
export const realBuild = (work: string, ledger: Layer.Layer<Ledger>) =>
	Layer.mergeAll(
		gitHubBuild({work, ledger}),
		liveBuilder(),
		Layer.succeed(BuildWork, {
			dir: work,
			env: {...hostEnv(), GIT_TERMINAL_PROMPT: "0"},
			install: false,
		}),
	);
