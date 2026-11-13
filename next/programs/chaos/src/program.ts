import { ChaosMachine, Program } from "@kampus/libfabrika";

export const chaos = Program.make({
  name: "fabrika/chaos",
  machine: ChaosMachine.chaosMachine,
  state: { v: 1, upgrades: [] },
  view: (model) => model,
  refuse: ChaosMachine.refuse,
  inputs: {
    start: { description: "Start a bounded chaos experiment", personOnly: true },
    stop: { description: "Stop scheduling faults", personOnly: true },
  },
  outputs: {},
  writes: {},
  wake: ChaosMachine.wake,
});
