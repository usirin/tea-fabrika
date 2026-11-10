import { Context, Effect, Schema } from "effect";
import type { folders } from "./machine.ts";

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
export class FoldersUnreachable extends Schema.TaggedError<FoldersUnreachable>()("unreachable", {
  why: Schema.String,
}) {}

/** What a folder service gives: the folders, or why they could not be read. */
export interface RepoTreeShape {
  readonly folders: Effect.Effect<readonly string[], FoldersUnreachable>;
}

/** The door: the folders worth suggesting an area from. None unless an integration gives some. */
export const RepoTree = Context.Reference<RepoTreeShape>("@tea-fabrika/tracker/RepoTree", {
  defaultValue: () => ({ folders: Effect.succeed([]) }),
});

/**
 * Read the folders: the `folders` Cmd's cell. Its failure settles as plain data, `{_tag, why}`,
 * since a settled error folds into the machine's state like any Msg.
 */
export const foldersCell = (_cmd: ReturnType<typeof folders>) =>
  Effect.gen(function* () {
    return { folders: yield* (yield* RepoTree).folders };
  }).pipe(Effect.mapError((e) => ({ _tag: e._tag, why: e.why })));
