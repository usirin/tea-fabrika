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
