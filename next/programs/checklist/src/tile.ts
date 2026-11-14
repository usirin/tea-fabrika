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
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { checklistMachine } from "./program.ts";

const press = Cmd.make("press", {
  input: Schema.Struct({ m: Schema.toType(checklistMachine.msg) }),
  ok: Schema.Null,
  err: [],
});

/** The add field belongs to this tab. The parent turns its press into a letter. */
export const tile = Machine.make({
  model: Schema.Struct({ draft: Schema.String.check(Schema.isMaxLength(80)) }),
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("typed"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("submit") }),
  ]),
  cmds: [press],
  init: () => [{ draft: "" }, []],
  update: {
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
    typed: (_s, m) => [{ draft: m.text.slice(0, 80) }, []],
    submit: (s) => (s.draft === "" ? [s, []] : [{ draft: "" }, [press({ m: { type: "add", name: s.draft } })]]),
  },
});
