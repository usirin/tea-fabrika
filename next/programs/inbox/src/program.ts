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
import { Machine } from "@demlik/tea/effect";
import { Program } from "@kampus/libfabrika";
import { Schema } from "effect";

const Fact = Schema.Struct({ stream: Schema.NonEmptyString, rev: Schema.Int });

const Added = {
  id: Schema.NonEmptyString,
  fact: Fact,
  window: Schema.NonEmptyString,
  method: Schema.Literal("email"),
  location: Schema.String,
  arrivedAt: Schema.Int,
};

/** A brain notice pointing to the email recovery fact that caused it. */
export const Row = Schema.TaggedUnion({ added: Added });

const Model = Schema.Struct({ rows: Schema.Array(Row) });

const Msg = Schema.Union([Schema.Struct({ type: Schema.Literal("added"), ...Added })]);

/** Keeps the first letter for each fact, in arrival order, without Cmds. */
export const inboxMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { rows: [] }, []],
  update: {
    added: (model, msg) => {
      if (model.rows.some((row) => row.id === msg.id)) {
        return [model, []];
      }

      const { type: _type, ...fields } = msg;
      return [{ rows: [...model.rows, Row.cases.added.make(fields)] }, []];
    },
  },
});

/** Every row the program shares with its watchers. */
export const inboxView = Schema.Struct({ rows: Schema.Array(Row) });

/** Only saved brain letters add rows. No client or agent input is declared. */
export const inbox = Program.make({
  name: "fabrika/inbox",
  machine: inboxMachine,
  state: { v: 1, upgrades: [] },
  view: (model): typeof inboxView.Type => ({ rows: model.rows }),
  refuse: () => null,
  inputs: {},
  outputs: {},
  writes: {},
  wake: () => null,
});
