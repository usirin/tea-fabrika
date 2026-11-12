import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { checklistMachine } from "./program.ts";

const press = Cmd.make("press", {
  input: Schema.Struct({ m: checklistMachine.msg }),
  ok: Schema.Null,
  err: [],
});

/** The add field belongs to this tab. The parent turns its press into a letter. */
export const tile = Machine.make({
  model: Schema.Struct({ draft: Schema.String.check(Schema.isMaxLength(80)) }),
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("typed"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("submit") }),
  ]),
  cmds: [press],
  init: () => [{ draft: "" }, []],
  update: {
    typed: (_s, m) => [{ draft: m.text.slice(0, 80) }, []],
    submit: (s) => (s.draft === "" ? [s, []] : [{ draft: "" }, [press({ m: { type: "add", name: s.draft } })]]),
  },
});
