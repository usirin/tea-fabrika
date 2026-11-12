// next/, P17b. The controller belongs to the test scope, so replacements share one arm.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

export const ErrorClass = Schema.Literals(["TypeError", "RangeError", "URIError"]);
const Attempt = Schema.Struct({ process: Schema.String, error: ErrorClass });

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
    before: (model, msg) => {
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
