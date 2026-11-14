/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
    added: (model, msg) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
