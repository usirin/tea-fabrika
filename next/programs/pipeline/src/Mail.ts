/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
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
