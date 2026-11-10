import type { WindowProps } from "@kampus/libfabrika";
import { defineWindow } from "@kampus/libfabrika";
import { Schema } from "effect";
import * as fc from "fast-check";
// P14, next/ (Tier 1, ticket 286): the counter's window props, messages and decoder agree with
// `Program.make` (the plan's "Checked views and typed counter props"). Written before `window.tsx`,
// the client's `WindowProps` and `defineWindow`; until they exist `tsc` reports the missing names,
// and the runtime checks fail on the missing module.
//
// The shape these checks hold the code to, from the plan's sketch (the build may add more):
// - `WindowProps<typeof counter>` (from `@kampus/libfabrika`): `{data, press}` with `data` the
//   program's view data and `press` taking one of the program's own Msgs and nothing else.
// - `defineWindow(program, registration)` (same package): the registration `{data, View, keys}` back,
//   refused at compile time when `data` is not the program's view schema, `View` takes other props, or
//   the keys name a Msg the program lacks.
// - `./program.ts` also exports `counterKeys`: the default key rows `counter.inc`, `counter.dec` and
//   `counter.reset`, one per input, beside `counter` and `counterMachine`, which stay as they are.
// - `./window.tsx` exports `counterWindow` (`data` is `counterMachine.model`) and `CounterWindow`.
import { describe, expect, expectTypeOf, it } from "vitest";
import { counter, counterKeys, counterMachine } from "./program.ts";
import { counterWindow, type CounterWindow } from "./window.tsx";

type Props = WindowProps<typeof counter>;
type CounterMsg = typeof counterMachine.msg.Type;

describe("counter window types", () => {
  it("props are inferred from the real program: its data, its Msgs, nothing more", () => {
    expectTypeOf<Props["data"]>().toEqualTypeOf<{ readonly count: number }>();
    expectTypeOf<Props["press"]>().parameter(0).toEqualTypeOf<CounterMsg>();
    expectTypeOf<Parameters<typeof CounterWindow>[0]>().toMatchTypeOf<Props>();
    const press = (props: Props) => {
      props.press({ type: "inc" });
      props.press({ type: "dec" });
      props.press({ type: "reset" });
      // @ts-expect-error plus is not a counter Msg: the program has inc, dec and reset
      props.press({ type: "plus" });
      // @ts-expect-error a Msg carries only its own fields
      props.press({ type: "inc", by: 2 });
    };
    expect(press).toBeTypeOf("function");
  });

  it("a string count and a wrong view schema are refused", () => {
    // @ts-expect-error a string count is not the program's view data
    const bad: Props = { data: { count: "1" }, press: () => undefined };
    expect(bad).toBeDefined();
    defineWindow(counter, counterWindow);
    // @ts-expect-error the view schema is not the program's
    defineWindow(counter, { ...counterWindow, data: Schema.Struct({ count: Schema.String }) });
    // @ts-expect-error a View that takes other props is not this program's window
    defineWindow(counter, { ...counterWindow, View: (props: { readonly name: string }) => props.name });
  });

  it("the registration's decoder is the real model schema, and its keys name the program's Msgs", () => {
    expect(counterWindow.data).toBe(counterMachine.model);
    fc.assert(
      fc.property(fc.integer(), fc.anything(), (count, other) => {
        const decode = Schema.decodeUnknownSync(counterWindow.data);
        expect(decode({ count })).toEqual({ count });
        // Program.make's own view decoder is the generic Json one, so only this check refuses a string count.
        expect(() => decode({ count: String(count) })).toThrow();
        fc.pre(typeof other !== "object" || other === null);
        expect(() => decode(other)).toThrow();
      }),
      { seed: 119120, numRuns: 100 },
    );
    // The default rows sit beside the program's inputs as data, and the window registers those rows.
    expect(counterKeys).toEqual({
      "counter.inc": ["+"],
      "counter.dec": ["-"],
      "counter.reset": ["0"],
    });
    expect(counterWindow.keys).toBe(counterKeys);
    expect(
      Object.keys(counterKeys)
        .map((c) => c.slice("counter.".length))
        .sort(),
    ).toEqual(Object.keys(counter.inputs).sort());
  });
});
