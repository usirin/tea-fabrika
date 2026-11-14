/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
// The counter, next/: the first real program (Tier 1, P11). A pure tea machine and its
// declarations. Its window is a separate export (`./window`, P14), so this entry reaches no React.
import { Machine } from "@demlik/tea/effect";
import { Program } from "@kampus/libfabrika";
import { Schema } from "effect";

/** The counter's model, which is also its view: the window checks what it shows against it. */
export const counterModel = Schema.Struct({ count: Schema.Int });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);

export const counterMachine = Machine.make({
  model: counterModel,
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
  name: "fabrika/counter",
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

/** The default key rows for the counter's three inputs, as data beside them (P14). A person's
 *  `keybindings.toml` rebinds or unbinds each; the window's buttons offer the same actions. */
export const counterKeys = {
  "counter.inc": ["+"],
  "counter.dec": ["-"],
  "counter.reset": ["0"],
} as const satisfies Readonly<Record<`counter.${keyof typeof counter.inputs}`, ReadonlyArray<string>>>;
