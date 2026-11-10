import {CodeTree} from "@kampus/pipeline/services";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {FoldersUnreachable, RepoTree} from "./folders.ts";
import {gitHubRepoTree} from "./github.ts";

// Areas PR 1, round 2 (from the mutation step): the tracker's folders on GitHub, over the
// pipeline's `CodeTree`, which a test stands in. Every connected repository is read, in the
// settings' order; a list that came back is kept for the session, and a read that failed is tried
// again by the next one that asks.
//
//   gitHubRepoTree({repos: [a, b], under: ["apps"]}).folders
//   // [...a's apps folders, ...b's apps folders]

const A = "https://github.com/example/app";
const B = "https://github.com/example/tools";

/** A `CodeTree` that answers each repository's folders, or fails for one in `breaks`, and its calls. */
const fakeTree = (
	answers: Readonly<Record<string, readonly string[]>>,
	breaks = new Set<string>(),
) => {
	const calls: (readonly [string, readonly string[]])[] = [];
	const layer = Layer.succeed(CodeTree, {
		folders: (repo, under) =>
			Effect.suspend(() => {
				calls.push([repo, under]);
				return breaks.has(repo)
					? Effect.fail({_tag: "unknown" as const})
					: Effect.succeed(answers[repo] ?? []);
			}),
	});
	return {layer, calls};
};

const read = (times: number, layer: Layer.Layer<CodeTree>, repos = [A, B]) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const tree = yield* RepoTree;
			const out: ({readonly ok: readonly string[]} | {readonly err: unknown})[] = [];

			for (let i = 0; i < times; i++) {
				out.push(
					yield* tree.folders.pipe(
						Effect.match({onSuccess: (ok) => ({ok}), onFailure: (err) => ({err})}),
					),
				);
			}

			return out;
		}).pipe(
			Effect.provide(
				gitHubRepoTree({repos, under: ["apps", "programs"]}).pipe(Layer.provide(layer)),
			),
		),
	);

describe("the folders of the connected repositories", () => {
	it("reads each repository under the settings' paths, in the settings' order, as one list", async () => {
		const {layer, calls} = fakeTree({
			[A]: ["apps/fabrika"],
			[B]: ["programs/tracker", "apps/desk"],
		});
		const [got] = await read(1, layer);
		expect(got).toEqual({ok: ["apps/fabrika", "programs/tracker", "apps/desk"]});
		expect(calls).toEqual([
			[A, ["apps", "programs"]],
			[B, ["apps", "programs"]],
		]);
	});

	it("reads once a session: a list that came back is kept", async () => {
		const {layer, calls} = fakeTree({[A]: ["apps/fabrika"], [B]: []});
		const got = await read(3, layer);
		expect(got).toEqual([{ok: ["apps/fabrika"]}, {ok: ["apps/fabrika"]}, {ok: ["apps/fabrika"]}]);
		expect(calls).toHaveLength(2);
	});

	it("fails, naming the repository, when one cannot be read, and the next ask reads again", async () => {
		const {layer, calls} = fakeTree({[A]: ["apps/fabrika"]}, new Set([B]));
		const got = await read(2, layer);
		const failed = expect.objectContaining({
			_tag: "unreachable",
			why: "could not read tools's folders",
		});
		expect(got).toEqual([{err: failed}, {err: failed}]);
		// Not kept: each ask read both again.
		expect(calls).toHaveLength(4);
	});

	// Round 4, the review's finding 7: the error's `_tag` is written by Effect Schema, as a
	// `TaggedError`, not by hand.
	it("fails with a `FoldersUnreachable`, an Effect Schema tagged error", async () => {
		const {layer} = fakeTree({}, new Set([A]));
		const [got] = await read(1, layer, [A]);
		const err = got !== undefined && "err" in got ? got.err : undefined;
		expect(err).toBeInstanceOf(FoldersUnreachable);
		expect(err).toMatchObject({_tag: "unreachable", why: "could not read app's folders"});
	});

	it("has no folders with no repository connected, and asks nothing", async () => {
		const {layer, calls} = fakeTree({});
		expect(await read(1, layer, [])).toEqual([{ok: []}]);
		expect(calls).toEqual([]);
	});
});
