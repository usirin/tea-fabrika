// P14 slice 2, next/ (ticket 828): the checklist window's contract, law L20's checklist half (type) of
// the approved plan. Written before `window.tsx` and `tile.ts`. The types are checked by `tsc` over this
// file (CI's typecheck job, 0133); the runtime half checks that the registration hands back its parts.
//
// The shape these checks hold the code to, from the plan:
// - `checklistWindow = defineWindow(checklist, {data: checklistView, View, keys: {}, tile, refused})`.
// - The View's props are `WindowProps<typeof checklist>` and the tile props: `tile`, the tile machine's
//   Model, and `send`, which takes only the tile machine's Msgs.
// - The tile machine's `press` Cmd carries one of the program's Msgs, and nothing wider.
// - `refused(m, reason)` takes only the program's Msgs.
import { Cmd, Machine } from "@demlik/tea/effect";
import { defineWindow, type WindowProps } from "@kampus/libfabrika";
import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { checklist, type checklistMachine, checklistView } from "./program.ts";
import { tile } from "./tile.ts";
import { checklistWindow } from "./window.tsx";

type Msg = typeof checklistMachine.msg.Type;
type Props = Parameters<typeof checklistWindow.View>[0];
type TileMsg = typeof tile.msg.Type;

/** A tile machine whose press carries a Msg the checklist does not have. */
const wrongPress = Cmd.make("press", {
  input: Schema.Struct({ m: Schema.Struct({ type: Schema.Literal("plus") }) }),
  ok: Schema.Null,
  err: [],
});

const wrongTile = Machine.make({
  model: Schema.Struct({ draft: Schema.String }),
  msg: Schema.Struct({ type: Schema.Literal("submit") }),
  cmds: [wrongPress],
  init: () => [{ draft: "" }, []],
  update: { submit: (s) => [s, [wrongPress({ m: { type: "plus" } })]] },
});

describe("L20: the checklist window's contract", () => {
  // pinned: L20's compile-time contract must reject calls from another program or tile.
  it("pinned: the View's props are the program's data and Msgs and the tile's own Model and Msgs", () => {
    expectTypeOf<Props["data"]>().toEqualTypeOf<Readonly<typeof checklistView.Type>>();
    expectTypeOf<Props["press"]>().parameter(0).toEqualTypeOf<Msg>();
    expectTypeOf<Props>().toMatchTypeOf<WindowProps<typeof checklist>>();
    expectTypeOf<Props["tile"]>().toEqualTypeOf<typeof tile.model.Type>();
    expectTypeOf<Props["send"]>().parameter(0).toEqualTypeOf<TileMsg>();
    expectTypeOf<unknown>().not.toMatchTypeOf<Parameters<Props["send"]>[0]>();
    expectTypeOf<NonNullable<typeof checklistWindow.refused>>().parameter(0).toEqualTypeOf<Msg>();
    expectTypeOf<unknown>().not.toMatchTypeOf<Parameters<NonNullable<typeof checklistWindow.refused>>[0]>();
    const use = (props: Props) => {
      props.press({ type: "check", name: "milk" });
      props.send({ type: "submit" });
      // @ts-expect-error a press is one of the checklist's Msgs: it has no `toggle`
      props.press({ type: "toggle", name: "milk" });
      // @ts-expect-error `add` needs its `name`
      props.press({ type: "add" });
      // @ts-expect-error `send` takes the tile's Msgs, not the program's
      props.send({ type: "check", name: "milk" });
    };
    expect(use).toBeTypeOf("function");
  });

  // pinned: L20's invalid registrations must fail CI's typecheck.
  it("pinned: the registration refuses another view, a tile that presses another program's Msg and a refusal for other Msgs", () => {
    expect(defineWindow(checklist, checklistWindow)).toBe(checklistWindow);
    // @ts-expect-error the counter's view schema is not the checklist's
    defineWindow(checklist, { ...checklistWindow, data: Schema.Struct({ count: Schema.Int }) });
    // @ts-expect-error a decoder for unknown data does not check the checklist's view
    defineWindow(checklist, { ...checklistWindow, data: Schema.Unknown });
    // @ts-expect-error a tile whose press is not a checklist Msg
    defineWindow(checklist, { ...checklistWindow, tile: wrongTile });
    defineWindow(checklist, {
      ...checklistWindow,
      // @ts-expect-error a refusal's words are for the checklist's own Msgs
      refused: (m: { readonly type: "plus" }, reason: string) => `${m.type} ${reason}`,
    });
    // @ts-expect-error a key row for an input the checklist does not have
    defineWindow(checklist, { ...checklistWindow, keys: { "checklist.toggle": ["t"] } });
  });

  // pinned: the registration is Tier 1 wiring, chosen once in this slice.
  it("pinned: the registration hands back its own parts: the view schema, the tile machine and no key rows yet", () => {
    expect(checklistWindow.data).toBe(checklistView);
    expect(checklistWindow.tile).toBe(tile);
    expect(checklistWindow.keys).toEqual({});
    expect(checklistWindow.refused).toBeTypeOf("function");
  });
});
