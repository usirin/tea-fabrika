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
// next/, P17b. The controller belongs to the test scope, so replacements share one arm.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

export const ErrorClass = Schema.Literals(["TypeError", "RangeError", "URIError"]);
const Attempt = Schema.Struct({ process: Schema.String, error: ErrorClass });

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Before = Schema.Struct({
  name: Schema.String,
  process: Schema.String,
  letter: Schema.String,
  phase: Schema.Literals(["fresh", "saved"]),
});

export const Model = Schema.TaggedUnion({
  off: {},
  armed: {
    name: Schema.String,
    letter: Schema.String,
    errors: Schema.Array(ErrorClass),
    attempts: Schema.Array(Attempt),
  },
});

export const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("arm"),
    name: Schema.String,
    letter: Schema.String,
    errors: Schema.Array(ErrorClass),
  }),
  Schema.Struct({ type: Schema.Literal("before"), ...Before.fields }),
]);

export const controller = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.off.make({}), []],
  update: {
    arm: (_model, msg) => [Model.cases.armed.make({ ...msg, attempts: [] }), []],
    before: (model, msg) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      if (model._tag !== "armed" || msg.phase !== "fresh" || msg.name !== model.name || msg.letter !== model.letter) {
        return [model, []];
      }

      const error = model.errors[model.attempts.length];
      return error === undefined
        ? [model, []]
        : [{ ...model, attempts: [...model.attempts, { process: msg.process, error }] }, []];
    },
  },
});
