import { CheckRun } from "@kampus/libfabrika/ci/Ci";
import { ChangeId, Commit, Tree, Path } from "@kampus/libfabrika/codehost/CodeHost";
import { Schema } from "effect";
import { Kind } from "./Change.ts";

export const Ref = Schema.NonEmptyString;

export const Land = Schema.Struct({
  type: Schema.Literal("land"),
  ref: Ref,
  change: ChangeId,
  head: Commit,
  reply: Schema.NonEmptyString,
});

export const Abandon = Schema.Struct({ type: Schema.Literal("abandon"), ref: Ref });

export const Reply = Schema.TaggedUnion({
  merged: { ref: Ref, change: ChangeId, head: Commit, commit: Commit, tree: Tree, checked: Tree },
  red: { ref: Ref, change: ChangeId, head: Commit, runs: Schema.NonEmptyArray(CheckRun) },
  conflict: { ref: Ref, change: ChangeId, main: Commit, paths: Schema.Array(Path) },
  moved: { ref: Ref, change: ChangeId, head: Commit },
  closed: { ref: Ref, change: ChangeId, state: Schema.Literals(["draft", "closed", "merged", "missing"]) },
  unset: { ref: Ref, change: ChangeId, kind: Kind },
  abandoned: { ref: Ref, change: ChangeId },
});
