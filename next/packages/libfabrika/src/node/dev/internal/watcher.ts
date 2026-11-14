import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

const Inputs = { failedInputs: Schema.optionalKey(Schema.NullOr(Schema.String)) };
const Model = Schema.TaggedUnion({ booting: Inputs, watching: Inputs });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attempted") }),
  Schema.Struct({ type: Schema.Literal("rebuilt"), failedInputs: Schema.NullOr(Schema.String) }),
]);

/** Tracks the first install attempt and the inputs of the last failed build. @internal */
export const watcher = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  types: { ctx: {} as Record<string, never> },
  init: (loaded) => [loaded ?? Model.cases.booting.make({}), []],
  update: {
    attempted: (model) => {
      if (model._tag === "booting") {
        return [Model.cases.watching.make({ failedInputs: model.failedInputs ?? null }), []];
      }

      return [model, []];
    },
    rebuilt: (model, msg) => [{ ...model, failedInputs: msg.failedInputs }, []],
  },
});
