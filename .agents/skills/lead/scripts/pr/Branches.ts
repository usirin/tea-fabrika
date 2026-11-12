// Branches: the git questions the unlisted check asks of a checkout (0134). This file is the
// contract only (0095): `BranchesGit.layer` asks real git, `BranchesTest.layer` answers from a
// model in memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** A git call failed, so the check cannot tell; it never reads a failure as "nothing there". */
export class BranchesError extends Schema.TaggedError<BranchesError>()("BranchesError", {
  /** The git subcommand, such as `merge-tree`. */
  command: Schema.String,
  reason: Schema.String,
}) {}

/** One branch: on the laptop (`refs/heads/`) or pushed (`refs/remotes/origin/`), and its tip. */
export type Branch = {
  readonly name: string;
  readonly location: "local" | "origin";
  readonly tip: string;
};

export class Branches extends Context.Service<
  Branches,
  {
    /** Takes origin's branches as they are now, so a deleted one is gone from the list. */
    readonly refresh: Effect.Effect<void, BranchesError>;
    /** Every local and origin branch but main and origin's HEAD. */
    readonly list: Effect.Effect<ReadonlyArray<Branch>, BranchesError>;
    /** How many commits `tip` holds that origin/main does not. */
    readonly ahead: (tip: string) => Effect.Effect<number, BranchesError>;
    /**
     * Whether merging `tip` into origin/main would change nothing: its work is on main already,
     * by any road (a squash merge, a cherry-pick, the same edit made twice). A conflict is `false`.
     */
    readonly landsEmpty: (tip: string) => Effect.Effect<boolean, BranchesError>;
  }
>()("lead/pr/Branches") {}
