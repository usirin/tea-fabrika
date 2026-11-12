// next/, P17b. The controller belongs to the test scope, so replacements share one arm.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { Effect, Ref, Schema } from "effect";

export const ErrorClass = Schema.Literals(["TypeError", "RangeError", "URIError"]);
const Attempt = Schema.Struct({ process: Schema.String, error: ErrorClass });

export const Before = Schema.Struct({
  name: Schema.String,
  process: Schema.String,
  letter: Schema.String,
  phase: Schema.Literals(["fresh", "saved"]),
});

export const Model = Schema.TaggedUnion({
  off: {},
  armed: {
    name: Schema.String,
    letter: Schema.String,
    errors: Schema.Array(ErrorClass),
    attempts: Schema.Array(Attempt),
  },
});

export const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("arm"),
    name: Schema.String,
    letter: Schema.String,
    errors: Schema.Array(ErrorClass),
  }),
  Schema.Struct({ type: Schema.Literal("before"), ...Before.fields }),
]);

export const controller = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.off.make({}), []],
  update: {
    arm: (_model, msg) => [Model.cases.armed.make({ ...msg, attempts: [] }), []],
    before: (model, msg) => {
      if (model._tag !== "armed" || msg.phase !== "fresh" || msg.name !== model.name || msg.letter !== model.letter) {
        return [model, []];
      }

      const error = model.errors[model.attempts.length];
      return error === undefined
        ? [model, []]
        : [{ ...model, attempts: [...model.attempts, { process: msg.process, error }] }, []];
    },
  },
});

const errors = { TypeError, RangeError, URIError };

export const make = Effect.fn("StepFaultTest.make")(function* () {
  const state = yield* Ref.make(controller.init(null, {})[0]);
  const send = (msg: typeof Msg.Type) =>
    Ref.modify(state, (previous) => {
      const [next] = applyCell(controller, previous, msg);
      return [[previous, next] as const, next];
    });
  return {
    arm: (name: string, letter: string, classes: ReadonlyArray<typeof ErrorClass.Type>) =>
      send({ type: "arm", name, letter, errors: classes }).pipe(Effect.asVoid),
    before: Effect.fnUntraced(function* (input: typeof Before.Type) {
      const [previous, next] = yield* send({ type: "before", ...input });

      if (previous._tag === "armed" && next._tag === "armed" && next.attempts.length > previous.attempts.length) {
        const attempt = next.attempts.at(-1);

        if (attempt !== undefined) {
          return yield* Effect.die(new errors[attempt.error]("controlled private step failure"));
        }
      }
    }),
    saved: Ref.get(state),
  };
});
