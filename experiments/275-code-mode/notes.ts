// Experiment 275, lab code. A minimal notes program for next/'s brain: list, read, and save with
// `base`, the version the writer saw. A save on an old version is refused, so a repeat writes nothing.
// P13's real program has laws on its branch but no source yet, so this stands in for it.
import { Machine } from "@demlik/tea/effect";
import { Input, Program } from "@kampus/libfabrika";
import { Schema } from "effect";

const Note = Schema.Struct({ note: Schema.String, body: Schema.String, version: Schema.Int });
const Model = Schema.Struct({ notes: Schema.Array(Note) });
type Model = typeof Model.Type;

const Save = Schema.Struct({
  type: Schema.Literal("save"),
  note: Schema.String,
  /** The version the writer saw. 0 makes a new note. */
  base: Schema.Int,
  body: Schema.String,
});

const Msg = Schema.Union([Save]);
type Msg = typeof Msg.Type;

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { notes: [] }, []],
  update: {
    save: (s, m) => {
      const found = s.notes.find((n) => n.note === m.note);
      return [
        {
          notes:
            found === undefined
              ? [...s.notes, { note: m.note, body: m.body, version: 1 }]
              : s.notes.map((n) => (n.note === m.note ? { ...n, body: m.body, version: n.version + 1 } : n)),
        },
        [],
      ];
    },
  },
});

const refuse = (s: Model, m: Msg) => {
  const found = s.notes.find((n) => n.note === m.note);
  const now = found?.version ?? 0;
  return m.base === now ? null : { reason: "stale", now };
};

export const program = Program.make({
  name: "fabrika/counter",
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse,
  inputs: {
    save: "Save a note's whole body over the version you read (base). An old base is refused.",
    list: Input.cases.read.make({
      schema: Schema.Struct({}),
      description: "List every note: its id, version and first line",
      answer: (v: Model) => v.notes.map((n) => ({ note: n.note, version: n.version, title: n.body.split("\n")[0] })),
    }),
    read: Input.cases.read.make({
      schema: Schema.Struct({ note: Schema.String }),
      description: "Read one note's body and version",
      answer: (v: Model, q: { readonly note: string }) => v.notes.find((n) => n.note === q.note) ?? null,
    }),
  },
  outputs: {},
  writes: {},
  wake: () => null,
});

/** The schema each input takes, by name, as the door's tools are made from it. */
export const inputSchemas = {
  list: Schema.Struct({}),
  read: Schema.Struct({ note: Schema.String }),
  save: Save.mapFields(({ type: _type, ...rest }) => rest),
};
