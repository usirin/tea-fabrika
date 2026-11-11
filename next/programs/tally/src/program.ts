// Tally, next/: a named list of counters a person can add, rename, bump and remove. A pure tea
// machine and its declarations, shaped like the counter. Bump is the one input an agent may call.
import { Machine } from "@demlik/tea/effect";
import { Input, Program } from "@kampus/libfabrika";
import { Schema } from "effect";

const Name = Schema.NonEmptyString;

const Counter = Schema.Struct({ name: Name, count: Schema.Int });

const Model = Schema.Struct({ counters: Schema.Array(Counter) });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), name: Name }),
  Schema.Struct({ type: Schema.Literal("rename"), from: Name, to: Name }),
  Schema.Struct({ type: Schema.Literal("bump"), name: Name, by: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("remove"), name: Name }),
]);
type Msg = typeof Msg.Type;

const has = (model: Model, name: string): boolean => model.counters.some((c) => c.name === name);

export const tallyMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { counters: [] }, []],
  update: {
    add: (s, m) => [has(s, m.name) ? s : { counters: [...s.counters, { name: m.name, count: 0 }] }, []],
    rename: (s, m) => [
      !has(s, m.from) || has(s, m.to)
        ? s
        : { counters: s.counters.map((c) => (c.name === m.from ? { name: m.to, count: c.count } : c)) },
      [],
    ],
    bump: (s, m) => [
      { counters: s.counters.map((c) => (c.name === m.name ? { name: c.name, count: c.count + m.by } : c)) },
      [],
    ],
    remove: (s, m) => [{ counters: s.counters.filter((c) => c.name !== m.name) }, []],
  },
});

/** Why an input is refused before it steps: the counter it names is missing, or taken. */
const refuse = (model: Model, msg: Msg) => {
  switch (msg.type) {
    case "add":
      return has(model, msg.name) ? { reason: "taken" } : null;
    case "rename":
      return !has(model, msg.from) ? { reason: "missing" } : has(model, msg.to) ? { reason: "taken" } : null;
    case "bump":
    case "remove":
      return has(model, msg.name) ? null : { reason: "missing" };
  }
};

const CountQuery = Schema.Struct({ name: Name });

export const tally = Program.make({
  name: "tally",
  machine: tallyMachine,
  state: { v: 1, upgrades: [] },
  view: (model) => ({ counters: model.counters.map((c) => ({ name: c.name, count: c.count })) }),
  refuse,
  inputs: {
    add: { description: "Add a counter at zero, by a new name", personOnly: true },
    rename: { description: "Give a counter a new name", personOnly: true },
    remove: { description: "Remove a counter", personOnly: true },
    bump: "Add `by` (negative to take away) to the counter called `name`",
    count: Input.cases.read.make({
      schema: CountQuery,
      description: "The count of the counter called `name`, or null if there is none",
      answer: (view: { counters: ReadonlyArray<{ name: string; count: number }> }, q) =>
        view.counters.find((c) => c.name === q.name)?.count ?? null,
    }),
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
