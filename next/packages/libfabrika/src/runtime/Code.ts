// Selected code in next/: checked asks for a fact; only folding code.loaded changes the model.
import { Machine, Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { ProgramName } from "../packs/ProgramName.ts";
import { Hash } from "./Built.ts";

export const From = Schema.Literals(["watch", "deploy", "boot", "restart"]);

export const CodeEvent = Schema.TaggedUnion({
  "code.loaded": { program: ProgramName, hash: Hash, was: Schema.NullOr(Hash), from: From },
  "code.failed": {
    program: ProgramName,
    hash: Schema.NullOr(Hash),
    reason: Schema.Literals(["bundle", "compiler", "load", "name", "too_large"]),
    path: Schema.optionalKey(Schema.String),
    line: Schema.optionalKey(Schema.Int),
  },
});

export const Selected = Schema.Record(ProgramName, Schema.Struct({ hash: Hash, load: Schema.String }));

const append = Cmd.make("append", {
  input: Schema.Struct({ id: Schema.String, event: CodeEvent.cases["code.loaded"] }),
  ok: Schema.Void,
  err: [],
});

const swap = Cmd.make("swap", {
  input: Schema.Struct({ load: Schema.String, program: ProgramName, hash: Hash }),
  ok: Schema.Void,
  err: [],
});

export const code = Machine.make({
  model: Selected,
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("checked"), id: Schema.String, program: ProgramName, hash: Hash, from: From }),
    Schema.Struct({ type: Schema.Literal("loaded"), id: Schema.String, program: ProgramName, hash: Hash }),
  ]),
  cmds: [append, swap],
  types: { ctx: {} as Record<string, never> },
  init: (saved) => [saved ?? {}, []],
  update: {
    checked: (m, msg) =>
      m[msg.program]?.hash === msg.hash
        ? [m, []]
        : [
            m,
            [
              append({
                id: msg.id,
                event: CodeEvent.cases["code.loaded"].make({
                  program: msg.program,
                  hash: msg.hash,
                  was: m[msg.program]?.hash ?? null,
                  from: msg.from,
                }),
              }),
            ],
          ],
    loaded: (m, msg) => [
      { ...m, [msg.program]: { hash: msg.hash, load: msg.id } },
      [swap({ load: msg.id, program: msg.program, hash: msg.hash })],
    ],
  },
});
