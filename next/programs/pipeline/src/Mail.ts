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

const reply = <F extends Schema.Struct.Fields>(fields: F) => ({
  type: Schema.tag("reply"),
  ref: Ref,
  change: CodeHost.ChangeId,
  ...fields,
});

export const Reply = Schema.TaggedUnion({
  merged: reply({
    head: CodeHost.Commit,
    commit: CodeHost.Commit,
    tree: CodeHost.Tree,
    checked: CodeHost.Tree,
  }),
  red: reply({ head: CodeHost.Commit, runs: Schema.NonEmptyArray(Ci.CheckRun) }),
  conflict: reply({ main: CodeHost.Commit, paths: Schema.Array(CodeHost.Path) }),
  moved: reply({ head: CodeHost.Commit }),
  closed: reply({ state: Schema.Literals(["draft", "closed", "merged", "missing"]) }),
  unset: reply({ kind: Kind }),
  abandoned: reply({}),
  behind: reply({
    head: CodeHost.Commit,
    main: CodeHost.Commit,
    rounds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
});

const Name = Schema.NonEmptyString.check(Schema.isMaxLength(256));

export const Enqueue = Schema.Struct({
  type: Schema.Literal("enqueue"),
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Schema.optionalKey(Schema.Struct({ to: Name, ref: Ref.check(Schema.isMaxLength(256)) })),
});

export const Drop = Schema.Struct({ type: Schema.Literal("drop"), change: CodeHost.ChangeId });
export const Resume = Schema.Struct({ type: Schema.Literal("resume") });
