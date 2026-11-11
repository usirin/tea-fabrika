// BoxGit: the Git questions the box rm command asks of MAIN and of one box's copied metadata. This file is
// the contract only (0095): `BoxGitProcess.layer` asks real git, `BoxGitTest.layer` answers from a
// model in memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** A git call that exited non-zero or wrote anything to stderr: the inspection cannot be trusted. */
export class BoxGitError extends Schema.TaggedError<BoxGitError>()("BoxGitError", {
  /** The git subcommand, such as `status`. */
  command: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A private git dir holding copies of a box's small metadata, read against the box's work tree. */
export type Inspection = { readonly gitDir: string; readonly work: string };

/** One ref a `for-each-ref` listed, with the object it names. */
export type Ref = { readonly ref: string; readonly oid: string };

export class BoxGit extends Context.Service<
  BoxGit,
  {
    /** `ls-files --stage -v -z` on the copy: each index entry, its one-letter flag first (`H `). */
    readonly indexEntries: (at: Inspection) => Effect.Effect<ReadonlyArray<string>, BoxGitError>;
    /** Whether `status --untracked-files=no` names any tracked change. */
    readonly trackedChanges: (at: Inspection) => Effect.Effect<boolean, BoxGitError>;
    /** Every ref of the copy, remotes included. */
    readonly refs: (at: Inspection) => Effect.Effect<ReadonlyArray<Ref>, BoxGitError>;
    /** The objects `rev-parse --verify <ref>^{object}` names in the copy. */
    readonly objectsAt: (at: Inspection, ref: string) => Effect.Effect<ReadonlyArray<string>, BoxGitError>;
    /** The tips MAIN keeps: its branches, tags, `refs/keep/`, stash and notes. Never its remotes. */
    readonly retained: Effect.Effect<ReadonlyArray<string>, BoxGitError>;
    /** Every object `rev-list --objects` reaches from these tips in MAIN, annotated tags included. */
    readonly reachable: (tips: ReadonlyArray<string>) => Effect.Effect<ReadonlySet<string>, BoxGitError>;
  }
>()("lead/box/BoxGit") {}
