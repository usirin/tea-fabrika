import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

const Model = Schema.TaggedUnion({ booting: {}, watching: {} });
const Msg = Schema.Struct({ type: Schema.Literal("attempted") });

/** Tracks whether this watcher has completed its first install attempt. @internal */
export const watcher = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  types: { ctx: {} as Record<string, never> },
  init: (loaded) => [loaded ?? Model.cases.booting.make({}), []],
  update: {
    attempted: (model) => {
      if (model._tag === "booting") {
        return [Model.cases.watching.make({}), []];
      }

      return [model, []];
    },
  },
});
