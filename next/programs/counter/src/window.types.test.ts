// P14 slice 1, next/ (ticket 698): S1.4, the counter's window contract. The types are checked by
// `tsc` over this file (the counter's tsconfig includes `src`); the runtime half checks the
// registration's decoder and key rows against the real program with generated values.
//
// The shape these checks hold the code to, from the approved plan:
// - `WindowProps<typeof counter>` (from `@kampus/libfabrika`): `data` is the program's selected view
//   data and `press` takes one of the program's own Msgs and nothing else.
// - `defineWindow(program, {data, View, keys})` hands the registration back, and refuses at compile
//   time a decoder for other data, a View for other props, or a key row for a command the program lacks.
// - `./program.ts` exports `counterModel`, the model schema the machine holds, and `counterKeys`, the
//   default key rows, one per input. `./window.tsx` exports `CounterWindow` and `counterWindow`.
import { defineWindow, type WindowProps } from "@kampus/libfabrika";
import { Exit, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { counter, counterKeys, counterMachine, counterModel } from "./program.ts";
import type { CounterWindow } from "./window.tsx";
import { counterWindow } from "./window.tsx";

type Props = WindowProps<typeof counter>;
type CounterMsg = typeof counterMachine.msg.Type;

describe("P14 S1.4: the counter's window accepts its own data and emits only its own messages", () => {
  it("type: props come from the real program, its selected data and its Msgs, nothing wider", () => {
    expectTypeOf<Props["data"]>().toEqualTypeOf<{ readonly count: number }>();
    expectTypeOf<Props["press"]>().parameter(0).toEqualTypeOf<CounterMsg>();
    expectTypeOf<Parameters<typeof CounterWindow>[0]>().toMatchTypeOf<Props>();
    // A press that took unknown would accept anything: the program's Msg is narrower than unknown.
    expectTypeOf<unknown>().not.toMatchTypeOf<Parameters<Props["press"]>[0]>();
    const press = (props: Props) => {
      props.press({ type: "inc" });
      props.press({ type: "dec" });
      props.press({ type: "reset" });
      // @ts-expect-error plus is not a counter Msg: the program has inc, dec and reset
      props.press({ type: "plus" });
      // @ts-expect-error a Msg carries only its own fields
      props.press({ type: "inc", by: 2 });
      // @ts-expect-error a press is a Msg, not a bare word
      props.press("inc");
    };
    expect(press).toBeTypeOf("function");
  });

  it("type: registration refuses another program's data, props or command names", () => {
    // @ts-expect-error a string count is not the program's view data
    const bad: Props = { data: { count: "1" }, press: () => undefined };
    expect(bad).toBeDefined();
    expect(defineWindow(counter, counterWindow)).toBe(counterWindow);
    // @ts-expect-error the view schema is not the program's
    defineWindow(counter, { ...counterWindow, data: Schema.Struct({ count: Schema.String }) });
    // @ts-expect-error a decoder for unknown data does not check the program's view
    defineWindow(counter, { ...counterWindow, data: Schema.Unknown });
    // @ts-expect-error a View that takes other props is not this program's window
    defineWindow(counter, { ...counterWindow, View: (props: { readonly name: string }) => props.name });
    // @ts-expect-error a key row for an input the counter does not have
    defineWindow(counter, { ...counterWindow, keys: { ...counterKeys, "counter.double": ["d"] } });
  });

  it("the registration decodes with the real model schema: generated data passes or fails as the program's model does", () => {
    expect(counterWindow.data).toBe(counterModel);
    expect(counterMachine.model).toBe(counterModel);
    const decode = Schema.decodeUnknownExit(counterWindow.data);
    const wrong = fc.oneof(
      fc.record({ count: fc.oneof(fc.string(), fc.double({ noInteger: true }), fc.boolean(), fc.constant(null)) }),
      fc.record({ total: fc.integer() }),
      fc.anything().filter((u) => typeof u !== "object" || u === null || !("count" in u)),
    );
    fc.assert(
      fc.property(fc.integer(), wrong, (count, other) => {
        const selected = counter.view.select({ count });
        expect(decode(selected), "the program's own selected data is accepted").toEqual(Exit.succeed(selected));
        expect(Exit.isFailure(decode(other)), "data the model refuses is refused").toBe(true);
      }),
      { seed: 119120, numRuns: 100 },
    );
  });

  it("the default key rows name exactly the counter's inputs, one non-empty row each", () => {
    expect(counterWindow.keys).toBe(counterKeys);
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(counter.inputs)), (input) => {
        const row: ReadonlyArray<string> | undefined = (counterKeys as Readonly<Record<string, ReadonlyArray<string>>>)[
          `counter.${input}`
        ];
        expect(row?.length, `counter.${input} has a default row`).toBeGreaterThan(0);
        expect(row!.every((key) => typeof key === "string" && key.length > 0)).toBe(true);
      }),
      { seed: 119120, numRuns: 100 },
    );
    expect(
      Object.keys(counterKeys)
        .map((command) => command.slice("counter.".length))
        .sort(),
    ).toEqual(Object.keys(counter.inputs).sort());
  });
});
