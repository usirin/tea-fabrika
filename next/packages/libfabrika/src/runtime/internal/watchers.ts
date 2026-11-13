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
