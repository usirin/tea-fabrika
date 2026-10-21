// Experiment 105's real pass: every agent of the lane is Claude (the model the job names, haiku),
// on the same fake GitHub and the same bare repository as the scripted runs. Nothing goes to a
// real repository. The planner and the reviewer read code in one clone this host keeps of the
// bare repository; before each review it is moved to the plan's branch as it is then, which is the
// head the review is of while one host runs one review at a time (the write-up's holes say more).
//
// Node at the edge: git through execFileSync, for the clone.
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Layer} from "effect";
import {liveBuilder} from "../../packages/fabrika/src/pipeline/stages/build/builder.ts";
import {livePlanner} from "../../packages/fabrika/src/pipeline/stages/plan/planner.ts";
import {liveReviewer} from "../../packages/fabrika/src/pipeline/stages/review/reviewer.ts";
import {liveSorter} from "../../packages/fabrika/src/pipeline/stages/sort/sorter.ts";

const git = (args: readonly string[]) =>
	execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

/** The live agents, reading a clone of `remote` kept under `work`. `branch`: the plan's. */
export const realAgents = (remote: string, work: string, branch: string) => {
	const clone = join(work, "read");
	git(["clone", "-q", remote, clone]);
	/** The clone at the plan's branch as it is now, or main before the branch is there. */
	const fresh = () => {
		git(["-C", clone, "fetch", "-q", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
		const there = git(["-C", clone, "branch", "-r", "--list", `origin/${branch}`]) !== "";
		git(["-C", clone, "checkout", "-q", "--detach", there ? `origin/${branch}` : "origin/main"]);
		return clone;
	};
	return Layer.mergeAll(
		liveSorter(),
		livePlanner({repo: clone}),
		liveBuilder(),
		liveReviewer({repo: () => fresh()}),
	).pipe(Layer.provide(nodeServices), Layer.orDie);
};
