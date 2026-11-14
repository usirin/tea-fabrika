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
// One terminal reply, next/: a program's refusal kept under its registered name and stable letter
// (Tier 1, P13). Insert-only: the first reply remembered stays, and a later one changes nothing.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { InputId } from "../../Id.ts";
import { Refusal } from "../Program.ts";

/** @internal */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
