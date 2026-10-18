import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Layer, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {runChild} from "../../child";
import {answerOf, type Gh, prOf} from "../../code-host-github";
import {codeHostWritesOn} from "../../code-host-github-writes";
import {hostEnv} from "../../env";
import {SANDBOX, sandboxOnly} from "../../sandbox";
import {CodeHostWrites} from "../../services";
import type {TextKind} from "../review/pack";

// The loop's writes to a pull request, on the sandbox alone:
//
//   ReviewWrites    post a review's verdict as a comment, in today's
//                   fabrika's marker format, so the ship stage reads it the
//                   way it reads a verdict a reviewer posted
//   sandboxWrites   ship's two writes (enqueue, re-run red checks), each
//                   held to the sandbox before it is made
//
// The only calls that write here:
//
//   post     gh api --method POST repos/<sandbox>/issues/<n>/comments -f body=<verdict>
//   enqueue, rerunChecks   as src/code-host-github-writes.ts lists them
//
// Each checks the pull request it was handed against the sandbox first, and
// dies on any other (`sandboxOnly`). The comment's repository is the sandbox
// constant, never read out of the url.

type Failed = {readonly _tag: "unknown"};

/** A verdict to post on one pull request, at one head. */
export interface Verdict {
	readonly pr: string;
	readonly head: string;
	readonly kind: TextKind;
	readonly verdict: "pass" | "fail";
	/** The one-line reason after the marker. */
	readonly reason: string;
	/** The rendered review, under the marker. */
	readonly text: string;
}

/** The marker line: `review-code: PASS @ <head> — <reason>`, as fabrika's ship verb and this repo's ship stage read it. */
export const markerOf = (v: Verdict): string =>
	`${v.kind}: ${v.verdict === "pass" ? "PASS" : "FAIL"} @ ${v.head} — ${v.reason.replace(/\s+/g, " ").trim()}`;

/** The whole comment. */
export const commentOf = (v: Verdict): string => `${markerOf(v)}\n\n${v.text}`;

export class ReviewWrites extends Context.Service<
	ReviewWrites,
	{
		/** Post one verdict. Read before written: a comment that already opens with the same marker is not posted again. */
		readonly post: (verdict: Verdict) => Effect.Effect<void, Failed>;
	}
>()("ReviewWrites") {}

const Comments = Schema.Array(Schema.Struct({body: Schema.String}));

/** `ReviewWrites` over one `gh`. */
export const reviewWritesOn = (gh: Gh): ReviewWrites["Service"] => ({
	post: (v) =>
		Effect.gen(function* () {
			yield* sandboxOnly(v.pr);
			const at = prOf(v.pr);
			if (at === null) return yield* Effect.fail<Failed>({_tag: "unknown"});
			const path = `repos/${SANDBOX}/issues/${at.number}/comments`;
			const marker = markerOf(v);
			const there = yield* answerOf(gh, Comments, ["api", `${path}?per_page=100`]);
			if (there.some((comment) => comment.body.split("\n")[0]?.trim() === marker)) return;
			yield* gh(["api", "--method", "POST", path, "-f", `body=${commentOf(v)}`]);
		}),
});

/** Ship's writes, each held to the sandbox before it is made. */
export const sandboxWritesOn = (gh: Gh): CodeHostWrites["Service"] => {
	const writes = codeHostWritesOn(gh);
	return {
		enqueue: (pr, head) => sandboxOnly(pr).pipe(Effect.andThen(writes.enqueue(pr, head))),
		rerunChecks: (pr, head) => sandboxOnly(pr).pipe(Effect.andThen(writes.rerunChecks(pr, head))),
	};
};

/** `gh` on Effect's `ChildProcess`, with the host's short environment. */
const ghOn = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const gh: Gh = (args) =>
		runChild("gh", args, {env: hostEnv()}).pipe(
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
			Effect.flatMap((exited) =>
				exited.code === 0 ? Effect.succeed(exited.out) : Effect.fail<Failed>({_tag: "unknown"}),
			),
		);
	return gh;
});

/** `ReviewWrites` and ship's `CodeHostWrites` on GitHub, writing to the sandbox alone. */
export const gitHubSandboxWrites = (): Layer.Layer<ReviewWrites | CodeHostWrites> =>
	Layer.effectContext(
		ghOn.pipe(
			Effect.map((gh) =>
				Context.make(ReviewWrites, reviewWritesOn(gh)).pipe(
					Context.add(CodeHostWrites, sandboxWritesOn(gh)),
				),
			),
		),
	).pipe(Layer.provide(nodeServices));
