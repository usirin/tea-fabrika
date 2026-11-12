// BoxGitTest.layer: the BoxGit service in memory, answering from one model of MAIN and the box.
// Any call the model marks as failing fails, as real git does on an exit or stderr.
import { Effect, Layer } from "effect";
import { BoxGit, BoxGitError, type Ref } from "./BoxGit.ts";

export type Model = {
  /** The box's index entries, as `ls-files --stage -v` prints them. */
  readonly index: ReadonlyArray<string>;
  readonly dirty: boolean;
  /** The box's refs, remotes included. */
  readonly refs: ReadonlyArray<Ref>;
  /** What each ref of the box, HEAD included, names. */
  readonly objects: Readonly<Record<string, string>>;
  /** MAIN's retained tips, and every object they reach. */
  readonly retained: ReadonlyArray<string>;
  readonly reachable: ReadonlyArray<string>;
  /** The subcommands that fail, such as `status`. */
  readonly failing: ReadonlyArray<string>;
};

export const layer = (model: Model): Layer.Layer<BoxGit> => {
  const answer = <A>(command: string, value: A) =>
    model.failing.includes(command) ? Effect.fail(new BoxGitError({ command })) : Effect.succeed(value);

  return Layer.succeed(
    BoxGit,
    BoxGit.of({
      indexEntries: () => answer("ls-files", [...model.index, ""]),
      trackedChanges: () => answer("status", model.dirty),
      refs: () => answer("for-each-ref", model.refs),
      objectsAt: (_at, ref) => {
        const oid = model.objects[ref];
        return oid === undefined ? Effect.fail(new BoxGitError({ command: "rev-parse" })) : answer("rev-parse", [oid]);
      },
      retained: answer("for-each-ref", model.retained),
      reachable: (tips) =>
        answer("rev-list", new Set(tips.some((tip) => model.retained.includes(tip)) ? model.reachable : [])),
    }),
  );
};
