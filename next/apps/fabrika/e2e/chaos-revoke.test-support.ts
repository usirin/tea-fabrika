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
// next/, p90's one scoped hold. The Worker drives it; this file performs no I/O.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Model = Schema.TaggedUnion({
  idle: {},
  armed: { process: Schema.String },
  held: { process: Schema.String },
  released: { process: Schema.String },
});

export const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("arm"), process: Schema.String }),
  Schema.Struct({ type: Schema.Literal("arrive"), process: Schema.String }),
  Schema.Struct({ type: Schema.Literal("release") }),
]);

export const controller = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.idle.make({}), []],
  update: {
    arm: (model, msg) => [model._tag === "idle" ? Model.cases.armed.make({ process: msg.process }) : model, []],
    arrive: (model, msg) => [
      model._tag === "armed" && model.process === msg.process ? Model.cases.held.make({ process: msg.process }) : model,
      [],
    ],
    release: (model) => [
      model._tag === "armed" || model._tag === "held" ? Model.cases.released.make({ process: model.process }) : model,
      [],
    ],
  },
});
