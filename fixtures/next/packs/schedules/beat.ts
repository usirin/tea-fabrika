import { Cmd } from "@demlik/tea/effect";
import * as ScheduledJob from "@kampus/libfabrika/schedules/ScheduledJob";
import { Program } from "@kampus/libfabrika/runtime/Program";
import { Result, Schema } from "effect";

const BeatEvent = Schema.TaggedStruct("beat", { due: Schema.Number, period: Schema.Int });
const Own = Schema.TaggedStruct("own", { event: BeatEvent });
const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Schema.Json }),
  ok: Schema.Json,
  err: ["not_delivered", "ended", "spent"],
});
const scheduled = Result.getOrThrow(ScheduledJob.make({
  period: "300 millis",
  cmd: write,
  work: (due, period) => write({ stream: "beats", write: Own.make({ event: BeatEvent.make({ due, period }) }) }),
}));
export const beat = Program.make({
  name: "schedules/beat",
  machine: scheduled.machine,
  state: { v: 1, upgrades: [] },
  view: (model) => model,
  refuse: () => null,
  inputs: {},
  outputs: {},
  writes: { beat: { schema: BeatEvent, personOnly: false } },
  wake: ScheduledJob.wake,
});
