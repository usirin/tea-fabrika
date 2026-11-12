import { Ci, CodeHost } from "@kampus/libfabrika";
import { Schema } from "effect";
import { Kind } from "./Change.ts";

export const Ref = Schema.NonEmptyString;

export const Land = Schema.Struct({
  type: Schema.Literal("land"),
  ref: Ref,
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Schema.NonEmptyString,
});

export const Abandon = Schema.Struct({ type: Schema.Literal("abandon"), ref: Ref });

export const Reply = Schema.TaggedUnion({
  merged: {
    ref: Ref,
    change: CodeHost.ChangeId,
    head: CodeHost.Commit,
    commit: CodeHost.Commit,
    tree: CodeHost.Tree,
    checked: CodeHost.Tree,
  },
  red: { ref: Ref, change: CodeHost.ChangeId, head: CodeHost.Commit, runs: Schema.NonEmptyArray(Ci.CheckRun) },
  conflict: { ref: Ref, change: CodeHost.ChangeId, main: CodeHost.Commit, paths: Schema.Array(CodeHost.Path) },
  moved: { ref: Ref, change: CodeHost.ChangeId, head: CodeHost.Commit },
  closed: { ref: Ref, change: CodeHost.ChangeId, state: Schema.Literals(["draft", "closed", "merged", "missing"]) },
  unset: { ref: Ref, change: CodeHost.ChangeId, kind: Kind },
  abandoned: { ref: Ref, change: CodeHost.ChangeId },
});
