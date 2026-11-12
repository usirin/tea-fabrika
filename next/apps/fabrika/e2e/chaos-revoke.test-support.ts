// next/, p90's one scoped hold. The Worker drives it; this file performs no I/O.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

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
