// Ticket 884, slice 1, next/: the inbox program's rows, window input type and view.
// I2 needs runner wiring in the app, as the checklist's RunnerTest suite does (0062).
import { applyCell } from "@demlik/tea";
import { propertyInvariant } from "@demlik/tea/pbt";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { WindowMsg, WindowProps } from "@kampus/libfabrika";
import { Arbitrary, Effect, Schema } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const RUNS = 100;
const load = () => import("./program.ts");

// Independent shapes from the approved plan, pinned to the product's schemas in I4 (0135).
const Fields = {
  id: Schema.NonEmptyString,
  fact: Schema.Struct({ stream: Schema.NonEmptyString, rev: Schema.Int }),
  window: Schema.NonEmptyString,
  method: Schema.Literal("email"),
  location: Schema.String,
  arrivedAt: Schema.Int,
};

const Row = Schema.TaggedUnion({ added: Fields });
const Model = Schema.Struct({ rows: Schema.Array(Row) });
const Msg = Schema.Struct({ type: Schema.Literal("added"), ...Fields });

const Moves = Arbitrary.array(
  Arbitrary.schema(
    Schema.Struct({
      body: Msg,
      retry: Schema.Boolean,
      pick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  { minLength: 2, maxLength: 40 },
);

describe("ticket 884 the inbox program, slice 1", () => {
  it.effect.prop(
    "I1: each fact appears once, with its first payload and in first-arrival order, without Cmds",
    { moves: Moves },
    ({ moves }) =>
      Effect.gen(function* () {
        const { inboxMachine } = yield* Effect.promise(load);
        const [first, initialCmds] = inboxMachine.init(null, {});
        expect(first).toEqual({ rows: [] });
        expect(initialCmds).toEqual([]);
        let model = first;
        const msgs: Array<typeof Msg.Type> = [];
        const rows = new Map<string, typeof Row.Type>();
        const expected: Array<ReadonlyArray<typeof Row.Type>> = [];

        for (const { body, retry, pick } of moves) {
          // Choose a repeat from the reached Model. Its other fields may differ from the first letter.
          const known = model.rows[pick % Math.max(1, model.rows.length)];
          const msg = retry && known !== undefined ? { ...body, id: known.id } : body;
          msgs.push(msg);

          if (!rows.has(msg.id)) {
            const { type: _type, ...fields } = msg;
            rows.set(msg.id, Row.cases.added.make(fields));
          }

          expected.push([...rows.values()]);
          [model] = applyCell(inboxMachine, model, msg);
        }

        // tea replays the generated tape from the real init and checks every transition.
        let index = 0;
        propertyInvariant(
          inboxMachine,
          {},
          fc.constant(msgs),
          ({ next, cmds }) => {
            expect(next.rows).toEqual(expected[index++]);
            expect(cmds).toEqual([]);
            return true;
          },
          { seed: SEED, numRuns: 1 },
        );
      }),
    { arbitrary: { seed: SEED, runs: RUNS } },
  );

  it.effect("pinned: I3 WindowMsg is never because the inbox program has no input port", () =>
    Effect.gen(function* () {
      // Type law: CI checks these pins and the rejected press. No tile exists in slice 1.
      const { inbox } = yield* Effect.promise(load);
      expectTypeOf<WindowMsg<typeof inbox>>().toEqualTypeOf<never>();
      const press = (window: WindowProps<typeof inbox>, msg: typeof Msg.Type) => {
        // @ts-expect-error Only the brain may send added; a window has no legal press.
        window.press(msg);
      };
      expectTypeOf(press).returns.toBeVoid();
      expect(Object.keys(inbox.inputs)).toEqual([]);
    }),
  );

  it.effect.prop(
    "I4: the view decodes through inboxView and keeps every row field in order",
    { model: Arbitrary.all({ rows: Arbitrary.array(Arbitrary.schema(Row), { maxLength: 40 }) }) },
    ({ model }) =>
      Effect.gen(function* () {
        const { inbox, inboxView } = yield* Effect.promise(load);
        // pinned: the exam's copied shapes must equal the product schemas (0135).
        expectTypeOf<typeof Model.Type>().toEqualTypeOf<typeof inbox.state.schema.Type>();
        expectTypeOf<typeof Msg.Type>().toEqualTypeOf<typeof inbox.msg.Type>();
        expectTypeOf<typeof Row.Type>().toEqualTypeOf<(typeof inboxView.Type)["rows"][number]>();
        expectTypeOf<typeof Model.Type>().toEqualTypeOf<typeof inboxView.Type>();
        const view = inbox.view.select(model);
        expect(Schema.decodeUnknownSync(inboxView, { onExcessProperty: "error" })(view)).toEqual(view);
        expect(view).toEqual(model);
      }),
    { arbitrary: { seed: SEED, runs: RUNS } },
  );
});
