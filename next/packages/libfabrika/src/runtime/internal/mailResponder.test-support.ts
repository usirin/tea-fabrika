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
// P41 slice 1's responder, next/ (ticket 744): one tea machine with one `ready` state. Each admitted
// request is answered with its successor, sent to the name the request asks the reply to go to; a
// negative value is refused by the program, so no answer is ever sent for it. `approve` is a
// person-only port, so program mail can never enter it. Command outcomes are messages here too.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Program } from "../Program.ts";
import { send } from "../Send.ts";

/** @internal */
export const Model = Schema.TaggedStruct("ready", {
  /** Requests answered. */
  answered: Schema.Int,
  /** Send outcomes seen, so an outcome is a message that changes the model. */
  queued: Schema.Int,
  refused: Schema.Int,
});
/** @internal */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Model = typeof Model.Type;

const Request = Schema.Struct({
  type: Schema.Literal("request"),
  ref: Schema.NonEmptyString,
  value: Schema.Int,
  reply: Schema.NonEmptyString,
  parent: Schema.optionalKey(Schema.String),
});

const Approve = Schema.Struct({ type: Schema.Literal("approve"), parent: Schema.optionalKey(Schema.String) });
/** @internal */
export const Msg = Schema.Union([Request, Approve]);

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [send],
  init: (loaded) => [loaded ?? Model.make({ answered: 0, queued: 0, refused: 0 }), []],
  update: {
    request: (s, m) => [
      { ...s, answered: s.answered + 1 },
      [send({ to: m.reply, m: { type: "answer", ref: m.ref, value: m.value + 1 } })],
    ],
    approve: (s) => [s, []],
    send_ok: (s) => [{ ...s, queued: s.queued + 1 }, []],
    send_err: (s) => [{ ...s, refused: s.refused + 1 }, []],
  },
});

/** @internal */
export const mailResponder = Program.make({
  name: "responder",
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse: (_s, m) => (m.type === "request" && m.value < 0 ? { reason: "negative" } : null),
  inputs: {
    request: "Answer a request",
    approve: { description: "Approve", personOnly: true },
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
