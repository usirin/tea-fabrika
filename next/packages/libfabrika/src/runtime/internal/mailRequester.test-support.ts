// P41 slice 1's requester, next/ (ticket 744): one tea machine, made by one factory per pair. A
// checked `start` saves `waiting(ref)` and emits the built-in Send to its peer; only an answer with
// the same `ref` moves it to `answered`. `queued` is a delivery receipt, never a business answer, and
// a late one leaves an answered request as it is. A permanent send refusal moves it to `failed`.
// It shares the message shape with the responder, never the responder's code.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Program } from "../Program.ts";
import { send } from "../Send.ts";

/** @internal */
export const Model = Schema.TaggedUnion({
  idle: {},
  waiting: { ref: Schema.String },
  answered: { ref: Schema.String, value: Schema.Int },
  failed: { ref: Schema.String, reason: Schema.String },
});
/** @internal */
export type Model = typeof Model.Type;

/** `to` and `claim` let a law aim one request elsewhere, or have it claim another sender. */
const Start = Schema.Struct({
  type: Schema.Literal("start"),
  ref: Schema.NonEmptyString,
  value: Schema.Int,
  to: Schema.optionalKey(Schema.NonEmptyString),
  claim: Schema.optionalKey(Schema.NonEmptyString),
  parent: Schema.optionalKey(Schema.String),
});

const Answer = Schema.Struct({
  type: Schema.Literal("answer"),
  ref: Schema.String,
  value: Schema.Int,
  parent: Schema.optionalKey(Schema.String),
});

/** @internal */
export const Msg = Schema.Union([Start, Answer]);

const idle = Model.cases.idle.make({});

/** @internal The requester named `self`, whose requests go to `peer`. */
export const mailRequester = (config: { readonly self: string; readonly peer: string }) => {
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [send],
    init: (loaded) => [loaded ?? idle, []],
    update: {
      start: (s, m) => {
        if (s._tag === "waiting") {
          return [s, []];
        }

        const body = { type: "request", ref: m.ref, value: m.value, reply: config.self };
        // A claimed sender rides beside the operands, as a program could try; the host binds the real one.
        const input =
          m.claim === undefined
            ? { to: m.to ?? config.peer, m: body }
            : { to: m.to ?? config.peer, m: body, source: m.claim };
        return [Model.cases.waiting.make({ ref: m.ref }), [send(input)]];
      },
      answer: (s, m) =>
        s._tag === "waiting" && s.ref === m.ref
          ? [Model.cases.answered.make({ ref: m.ref, value: m.value }), []]
          : [s, []],
      send_ok: (s) => [s, []],
      send_err: (s, m) =>
        s._tag === "waiting" &&
        m.cmd.m !== null &&
        typeof m.cmd.m === "object" &&
        "ref" in m.cmd.m &&
        m.cmd.m.ref === s.ref
          ? [Model.cases.failed.make({ ref: s.ref, reason: m.error._tag }), []]
          : [s, []],
    },
  });
  return Program.make({
    name: `requester-${config.self}`,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: (s, m) => (m.type === "start" && s._tag === "waiting" ? { reason: "busy" } : null),
    inputs: { start: "Start a request", answer: "An answer from a responder" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};
