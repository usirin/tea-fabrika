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
import { Array, Schema } from "effect";

const Client = Schema.Struct({
  client: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  // String encoding preserves every Number value across JSON, including non-finite values.
  at: Schema.NumberFromString,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** @internal */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Model = Schema.TaggedUnion({
  empty: {},
  watching: {
    clients: Schema.NonEmptyArray(Client).check(
      Schema.isMaxLength(1024),
      Schema.makeFilter((clients) => new Set(clients.map((c) => c.client)).size === clients.length),
    ),
  },
});

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open"), watch: Client }),
  Schema.Struct({ type: Schema.Literal("end"), client: Schema.String }),
]);

/** @internal */
export const watchers = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.empty.make({}), []],
  update: {
    open: (model, msg) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const held = model._tag === "empty" ? [] : model.clients.filter((c) => c.client !== msg.watch.client);
      return [Model.cases.watching.make({ clients: Array.append(held.slice(-1023), msg.watch) }), []];
    },
    end: (model, msg) => {
      if (model._tag === "empty") {
        return [model, []];
      }

      const clients = model.clients.filter((c) => c.client !== msg.client);
      const [first, ...rest] = clients;
      return [
        first === undefined ? Model.cases.empty.make({}) : Model.cases.watching.make({ clients: [first, ...rest] }),
        [],
      ];
    },
  },
});
