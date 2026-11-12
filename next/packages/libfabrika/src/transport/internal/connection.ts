import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Attached, Wait, Who } from "../Wire.ts";

const Online = {
  client: Schema.String,
  identity: Who,
  version: Schema.Int,
  watching: Schema.Boolean,
  waits: Schema.Array(Wait),
  has: Attached.cases.online.fields.has,
  build: Attached.cases.online.fields.build,
};

const Model = Schema.TaggedUnion({
  unloaded: {},
  new: { attached: Attached.cases.new },
  waiting: { attached: Attached.cases.waiting },
  idle: Online,
  busy: Online,
});
/** @internal */
export type Model = typeof Model.Type;
type Online = typeof Model.cases.idle.Type | typeof Model.cases.busy.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("observed"), attached: Attached }),
  Schema.Struct({ type: Schema.Literal("started") }),
  Schema.Struct({ type: Schema.Literal("finished") }),
  Schema.Struct({ type: Schema.Literal("waited"), wait: Wait }),
  Schema.Struct({ type: Schema.Literal("answered"), wait: Wait }),
]);
/** @internal */
export type Msg = typeof Msg.Type;

const MAX_WAITS = 64;
const MAX_BYTES = 16_384;

/**
 * True once hello is done: only these states hold waits and a busy marker.
 *
 * @internal
 */
export const online = (m: Model): m is Online => m._tag === "idle" || m._tag === "busy";

const fields = (s: Omit<Online, "_tag">) => ({
  client: s.client,
  identity: s.identity,
  version: s.version,
  watching: s.watching,
  waits: s.waits,
  ...(s.has === undefined ? {} : { has: s.has }),
  ...(s.build === undefined ? {} : { build: s.build }),
});

/** The named state a saved attachment stands for. */
const loaded = (attached: typeof Attached.Type): Model => {
  if (attached._tag === "new") {
    return Model.cases.new.make({ attached });
  }

  if (attached._tag === "waiting") {
    return Model.cases.waiting.make({ attached });
  }

  const s = fields(attached);
  return attached.busy ? Model.cases.busy.make(s) : Model.cases.idle.make(s);
};

/**
 * The attachment a loaded state saves, in the format it always had; `unloaded` saves nothing.
 *
 * @internal
 */
export const attachment = (model: Model): typeof Attached.Type | null => {
  if (model._tag === "unloaded") {
    return null;
  }

  if (model._tag === "new" || model._tag === "waiting") {
    return model.attached;
  }

  return Attached.cases.online.make({
    client: model.client,
    identity: model.identity,
    version: model.version,
    waits: model.waits,
    watching: model.watching,
    busy: model._tag === "busy",
    ...(model.has === undefined ? {} : { has: model.has }),
    ...(model.build === undefined ? {} : { build: model.build }),
  });
};

/** The limits measure the saved attachment as UTF-8 JSON, metadata included. */
const admits = (s: Online, next: Online, wait: typeof Wait.Type) =>
  !s.waits.some((w) => w.id === wait.id) &&
  next.waits.length <= MAX_WAITS &&
  new TextEncoder().encode(JSON.stringify(attachment(next))).length <= MAX_BYTES;

/** @internal */
export const connection = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.unloaded.make({}), []],
  update: {
    observed: (_, m) => [loaded(m.attached), []],
    started: (s) => [s._tag === "idle" ? Model.cases.busy.make(fields(s)) : s, []],
    finished: (s) => [s._tag === "busy" ? Model.cases.idle.make(fields(s)) : s, []],
    waited: (s, m) => {
      if (s._tag !== "idle" && s._tag !== "busy") {
        return [s, []];
      }

      const next = { ...s, waits: [...s.waits, m.wait] };
      return [admits(s, next, m.wait) ? next : s, []];
    },
    answered: (s, m) => {
      if (s._tag !== "idle" && s._tag !== "busy") {
        return [s, []];
      }

      const { id, stream, after } = m.wait;
      const matching = s.waits.some((w) => w.id === id && w.stream === stream && w.after === after);
      return [matching ? { ...s, waits: s.waits.filter((w) => w.id !== id) } : s, []];
    },
  },
});
