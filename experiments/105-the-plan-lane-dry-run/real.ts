// Experiment 105's real pass: every agent of the lane is Claude (the model the job names, haiku),
// on the same fake GitHub and the same bare repository as the scripted runs. Nothing goes to a
// real repository. The planner reads code in one clone this host keeps of the bare repository, made
// at the start. Each reviewer reads the plan's clone its own turn put at the head first
// (`readingIn`, packages/pipeline/src/hosted/review-local.ts), as `deliver` does in tsh.
//
// Node at the edge: git through execFileSync, for the planner's clone.
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Layer} from "effect";
import {readingIn} from "../../packages/pipeline/src/hosted/review-local.ts";
import {liveBuilder} from "../../packages/pipeline/src/stages/build/builder.ts";
import {livePlanner} from "../../packages/pipeline/src/stages/plan/planner.ts";
import {liveReviewer} from "../../packages/pipeline/src/stages/review/reviewer.ts";
import {liveSorter} from "../../packages/pipeline/src/stages/sort/sorter.ts";

/** The live agents. `work`: the host's work folder, the one its `BuildWork` names. */
export const realAgents = (remote: string, work: string) => {
	const clone = join(work, "plan-read");
	execFileSync("git", ["-c", "core.hooksPath=/dev/null", "clone", "-q", remote, clone], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	return Layer.mergeAll(
		liveSorter(),
		livePlanner({repo: clone}),
		liveBuilder(),
		liveReviewer({repo: (pr) => readingIn(work, pr) ?? clone}),
	).pipe(Layer.provide(nodeServices), Layer.orDie);
};
