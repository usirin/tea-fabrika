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
import { Machine } from "@demlik/tea/effect";
import { Array, Schema } from "effect";

const Client = Schema.Struct({
  client: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  // String encoding preserves every Number value across JSON, including non-finite values.
  at: Schema.NumberFromString,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** @internal */
export const Model = Schema.TaggedUnion({
  empty: {},
  watching: {
    clients: Schema.NonEmptyArray(Client).check(
      Schema.isMaxLength(1024),
      Schema.makeFilter((clients) => new Set(clients.map((c) => c.client)).size === clients.length),
    ),
  },
});

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open"), watch: Client }),
  Schema.Struct({ type: Schema.Literal("end"), client: Schema.String }),
]);

/** @internal */
export const watchers = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.empty.make({}), []],
  update: {
    open: (model, msg) => {
      const held = model._tag === "empty" ? [] : model.clients.filter((c) => c.client !== msg.watch.client);
      return [Model.cases.watching.make({ clients: Array.append(held.slice(-1023), msg.watch) }), []];
    },
    end: (model, msg) => {
      if (model._tag === "empty") {
        return [model, []];
      }

      const clients = model.clients.filter((c) => c.client !== msg.client);
      const [first, ...rest] = clients;
      return [
        first === undefined ? Model.cases.empty.make({}) : Model.cases.watching.make({ clients: [first, ...rest] }),
        [],
      ];
    },
  },
});
