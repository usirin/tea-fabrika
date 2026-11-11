// Tally, next/: its pure laws, written the way the counter's are. The view lists every counter in
// order, refusals name a missing or taken counter, and the saved model survives every JSON cut.
import { propertyInvariant } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Program, ProgramLoader } from "@kampus/libfabrika";
import { syncTest } from "@kampus/libfabrika/testing";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { tally, tallyMachine } from "./program.ts";

const SEED = 119120;

const name = fc.constantFrom("a", "b", "c", "d");

type Msg = typeof tally.msg.Type;
type Model = typeof tally.state.schema.Type;

const msg: fc.Arbitrary<Msg> = fc.oneof(
  name.map((n) => ({ type: "add" as const, name: n })),
  fc.tuple(name, name).map(([from, to]) => ({ type: "rename" as const, from, to })),
  fc.tuple(name, fc.integer({ min: -5, max: 5 })).map(([n, by]) => ({ type: "bump" as const, name: n, by })),
  name.map((n) => ({ type: "remove" as const, name: n })),
);

const msgs = fc.array(msg, { maxLength: 30 });

/** The expected model, written as a plain map from the Msgs, not from the machine. */
const expectedAfter = (prev: Model, m: Msg): Model => {
  const names = prev.counters.map((c) => c.name);

  switch (m.type) {
    case "add":
      return names.includes(m.name) ? prev : { counters: [...prev.counters, { name: m.name, count: 0 }] };
    case "rename":
      return !names.includes(m.from) || names.includes(m.to)
        ? prev
        : { counters: prev.counters.map((c) => (c.name === m.from ? { ...c, name: m.to } : c)) };
    case "bump":
      return { counters: prev.counters.map((c) => (c.name === m.name ? { ...c, count: c.count + m.by } : c)) };
    case "remove":
      return { counters: prev.counters.filter((c) => c.name !== m.name) };
  }
};

const load = Effect.gen(function* () {
  return (yield* (yield* ProgramLoader).load("tally")).stepper;
}).pipe(Effect.provide(ProgramLoader.layer({ tally }, {})));

describe("tally laws", () => {
  it("Program.make keeps the exported machine, and declares its ports", () => {
    expect(tally.machine).toBe(tallyMachine);
    expect(tally.state.schema).toBe(tallyMachine.model);
    expect(tally.msg).toBe(tallyMachine.msg);
    expect(Schema.decodeUnknownSync(Program.schema)(tally)).toMatchObject({
      name: "tally",
      state: { v: 1 },
      writes: {},
    });
    expect(tally.inputs.bump.personOnly).toBe(false);

    for (const port of ["add", "rename", "remove"] as const) {
      expect(tally.inputs[port].personOnly).toBe(true);
    }

    expect(tally.inputs.count._tag).toBe("read");
  });

  it("scenario: every tea step matches the plain map, and names stay unique", () => {
    propertyInvariant(
      tally.machine,
      {},
      msgs,
      ({ prev, msg: m, next, cmds }: { prev: Model; msg: Msg; next: Model; cmds: ReadonlyArray<unknown> }) => {
        const names = next.counters.map((c) => c.name);
        return (
          JSON.stringify(next) === JSON.stringify(expectedAfter(prev, m)) &&
          new Set(names).size === names.length &&
          cmds.length === 0
        );
      },
      { seed: SEED, numRuns: 100 },
    );
  });

  it("every JSON cut preserves every later model", () => {
    fc.assert(
      fc.property(msgs, (list) => {
        syncTest(
          tally.machine,
          {},
          {
            msgs: list,
            encode: Schema.encodeSync(tally.state.schema),
            decode: Schema.decodeUnknownSync(tally.state.schema),
            equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
            seed: SEED,
          },
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("the stepper refuses exactly the Msgs that name a missing or taken counter", () => {
    const p = Effect.runSync(load);
    fc.assert(
      fc.property(msgs, msg, (list, last) => {
        let model: unknown = (p.init(null) as { model: unknown }).model;

        for (const m of list) {
          const step = p.step(model, m);

          if (step._tag === "stepped") {
            model = step.model;
          }
        }

        const before = Schema.decodeUnknownSync(tally.state.schema)(model);
        const names = before.counters.map((c) => c.name);
        const step = p.step(model, last);
        const want =
          last.type === "add"
            ? names.includes(last.name)
              ? "taken"
              : null
            : last.type === "rename"
              ? !names.includes(last.from)
                ? "missing"
                : names.includes(last.to)
                  ? "taken"
                  : null
              : names.includes(last.name)
                ? null
                : "missing";

        expect(step).toMatchObject(
          want === null
            ? { _tag: "stepped", view: { counters: expectedAfter(before, last).counters } }
            : { _tag: "refused", reason: want },
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("the count read port answers from the view", () => {
    fc.assert(
      fc.property(msgs, name, (list, n) => {
        const model = list.reduce(expectedAfter, { counters: [] });
        const view = tally.view.select(model);
        const port = tally.inputs.count;
        expect(port.answer(view, { name: n })).toBe(model.counters.find((c) => c.name === n)?.count ?? null);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("the stepper refuses a Msg the machine does not know", () => {
    const p = Effect.runSync(load);
    expect(p.step({ counters: [] }, { type: "unknown" })).toMatchObject({ _tag: "refused", reason: "bad_msg" });
  });
});
