import { Cmd } from "@demlik/tea/effect";
import * as Loop from "@kampus/libfabrika/loops/Loop";
import * as Program from "@kampus/libfabrika/runtime/Program";
import { Result, Schema } from "effect";

const BeatEvent = Schema.TaggedStruct("beat", { due: Schema.Number, period: Schema.Int });
const Own = Schema.TaggedStruct("own", { event: BeatEvent });
const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Schema.Json }),
  ok: Schema.Json,
  err: ["not_delivered", "ended", "spent"],
});
const loop = Result.getOrThrow(Loop.make({
  period: "300 millis",
  cmd: write,
  job: (due, period) => write({ stream: "beats", write: Own.make({ event: BeatEvent.make({ due, period }) }) }),
}));
export const beat = Program.make({
  name: "loops/beat",
  machine: loop.machine,
  state: { v: 1, upgrades: [] },
  view: (model) => model,
  refuse: () => null,
  inputs: {},
  outputs: {},
  writes: { beat: { schema: BeatEvent, personOnly: false } },
  wake: Loop.wake,
});
