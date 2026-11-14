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
// One terminal reply, next/: a program's refusal kept under its registered name and stable letter
// (Tier 1, P13). Insert-only: the first reply remembered stays, and a later one changes nothing.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { InputId } from "../../Id.ts";
import { Refusal } from "../Program.ts";

/** @internal */
export const Reply = Schema.Struct({
  name: Schema.NonEmptyString,
  /** The stable letter, `Incoming.id`; never the envelope's input ID. */
  id: Schema.NonEmptyString,
  /** The envelope's input ID the first refusal answered. */
  parent: InputId,
  by: Schema.NonEmptyString,
  for: Schema.NonEmptyString,
  /** Binds the checked writer and the original input, as a delivery receipt does. */
  digest: Schema.NonEmptyString,
  answer: Schema.TaggedStruct("refused", Refusal.fields),
});

/** @internal */
export const Model = Schema.TaggedUnion({
  empty: {},
  remembered: { reply: Reply },
});

const Msg = Schema.Struct({ type: Schema.Literal("remember"), reply: Reply });

/** @internal */
export const reply = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.empty.make({}), []],
  update: {
    remember: (s, m) => [s._tag === "empty" ? Model.cases.remembered.make({ reply: m.reply }) : s, []],
  },
});
