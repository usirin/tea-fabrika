import {Context, Effect} from "effect";
import type {folders} from "./machine.ts";

// The folders of the connected repositories, for the onboarding step's suggestions only: the
// `RepoTree` door, as `PullRequests` is the door for the open pull requests. GitHub is one
// integration behind it (./github.ts). A folder is never an area: a person ticks one, and the
// area it makes is theirs (docs/direction/areas.md, call 5).
//
//   RepoTree.folders
//   // ["programs/tracker", "packages/pipeline", "apps/fabrika", ...]
//
// With no integration given, it has no folders, so a test or a host that reads no repository
// needs nothing here, and the step suggests from the titles alone.

/** The folders could not be read, and why in words. */
export type FoldersUnreachable = {readonly _tag: "unreachable"; readonly why: string};

export interface RepoTreeShape {
	readonly folders: Effect.Effect<readonly string[], FoldersUnreachable>;
}

/** The door: the folders worth suggesting an area from. None unless an integration gives some. */
export const RepoTree = Context.Reference<RepoTreeShape>("@tea-fabrika/tracker/RepoTree", {
	defaultValue: () => ({folders: Effect.succeed([])}),
});

/** Read the folders: the `folders` Cmd's cell. */
export const foldersCell = (_cmd: ReturnType<typeof folders>) =>
	Effect.gen(function* () {
		return {folders: yield* (yield* RepoTree).folders};
	});
