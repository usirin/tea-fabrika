// P11 real counter, next/. The pure contract uses inc/dec/reset and view {count}.
// No window export exists until P14. No copied counter implementation lives in the library.
import { propertyInvariant } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";

const SEED = 119120;
// Defer export lookup so the red base's missing exports do not prevent law collection.
const LIBRARY = "@kampus/libfabrika";
const TESTING = "@kampus/libfabrika/testing";

const msgs = fc.array(fc.constantFrom({ type: "inc" }, { type: "dec" }, { type: "reset" }), {
  maxLength: 30,
});

describe("P11 real counter laws", () => {
  it("Program.make keeps the exported machine and uses its own schemas", async () => {
    const { counter, counterMachine } = await import("./program.ts");
    fc.assert(
      fc.property(fc.integer(), fc.constantFrom("inc", "dec", "reset"), (count, type) => {
        expect(counter.machine).toBe(counterMachine);
        expect(counter.state.schema).toBe(counterMachine.model);
        expect(counter.msg).toBe(counterMachine.msg);
        expect(counter.view.data).toBe(Schema.Json);
        expectTypeOf(counter.view.select({ count }).count).toEqualTypeOf<number>();
        expect(counter.view.select({ count })).toEqual({ count });
        expect(counter.wake({ count })).toBeNull();
        const port = counter.inputs[type];
        expect(port.personOnly).toBe(false);
        expect(port.description.trim().length).toBeGreaterThan(0);
        expect(Schema.decodeUnknownSync(port.schema)({ type })).toEqual({ type });
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
  it("S2 plant, lose saved count: every JSON cut preserves every later model and Cmd", async () => {
    const { counter } = await import("./program.ts");
    const { syncTest }: typeof import("@kampus/libfabrika/testing") = await import(TESTING);
    fc.assert(
      fc.property(msgs, (list) => {
        syncTest(
          counter.machine,
          {},
          {
            msgs: list,
            encode: Schema.encodeSync(counter.state.schema),
            decode: Schema.decodeUnknownSync(counter.state.schema),
            equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
            seed: SEED,
          },
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
  it("plant, break an update: inc, dec and reset obey arithmetic at every tea step", async () => {
    const { counter } = await import("./program.ts");
    propertyInvariant(
      counter.machine,
      {},
      msgs,
      ({
        prev,
        msg,
        next,
        cmds,
      }: {
        prev: { count: number };
        msg: { type: string };
        next: { count: number };
        cmds: ReadonlyArray<unknown>;
      }) => {
        const expected = msg.type === "inc" ? prev.count + 1 : msg.type === "dec" ? prev.count - 1 : 0;
        return next.count === expected && cmds.length === 0;
      },
      { seed: SEED, numRuns: 100 },
    );
  });
  it("plant, leave a declaration out: real program declares saved state, ports, view and fact policy", async () => {
    const { counter } = await import("./program.ts");
    const { Program, ProgramLoader }: typeof import("@kampus/libfabrika") = await import(LIBRARY);
    expect(Schema.decodeUnknownSync(Program.schema)(counter)).toMatchObject({
      name: "counter",
      state: { v: 1 },
      writes: {},
    });
    const p = Effect.runSync(
      Effect.gen(function* () {
        return (yield* (yield* ProgramLoader).load("counter")).stepper;
      }).pipe(Effect.provide(ProgramLoader.layer({ counter }, {}))),
    );
    const boot = p.init(null);
    expect(boot).toMatchObject({ _tag: "stepped", view: { count: 0 }, cmds: [] });

    for (const type of ["inc", "dec", "reset"] as const) {
      expect(counter.refuse({ count: 0 }, { type })).toBeNull();
    }

    expect(p.step({ count: 0 }, { type: "inc", value: "wrong" })).toMatchObject({
      _tag: "stepped",
      view: { count: 1 },
    });
    expect(p.step({ count: 0 }, { type: "unknown" })).toMatchObject({ _tag: "refused", why: "bad_msg" });
  });
});
