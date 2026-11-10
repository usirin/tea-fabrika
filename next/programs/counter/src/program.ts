// The counter, next/: the first real program (Tier 1, P11). A pure tea machine and its
// declarations, nothing else: no window until P14.
import { Machine } from "@demlik/tea/effect";
import { Program } from "@kampus/libfabrika";
import { Schema } from "effect";

const Model = Schema.Struct({ count: Schema.Int });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);

export const counterMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { count: 0 }, []],
  update: {
    inc: (s) => [{ count: s.count + 1 }, []],
    dec: (s) => [{ count: s.count - 1 }, []],
    reset: () => [{ count: 0 }, []],
  },
});

export const counter = Program.make({
  name: "counter",
  machine: counterMachine,
  state: { v: 1, upgrades: [] },
  view: (model) => ({ count: model.count }),
  refuse: () => null,
  inputs: {
    inc: "Add one",
    dec: "Take one away",
    reset: "Back to zero",
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
