// P11's public test kit. Helpers throw a diagnostic on divergence and return void on agreement.
// syncTest(machine, ctx, {msgs, encode, decode, equals, seed}) checks one supplied Msg list.
// senderTest({inputs, expected, writes, owner, seed}) compares an independent expected-write table.
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const Model = Schema.Struct({ count: Schema.Int, carry: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });

const report = Cmd.make("report", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Null,
  err: [],
});

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [report],
  init: (loaded) => [loaded ?? { count: 0, carry: 2 }, []],
  update: {
    add: (s, m) => [{ count: s.count + m.n, carry: s.carry + 1 }, [report({ n: s.carry })]],
    report_ok: (s) => [s, []],
    report_err: (s) => [s, []],
  },
});

const equals = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const encode = Schema.encodeSync(Model);
const decode = Schema.decodeUnknownSync(Model);

const msgs = [
  { type: "add", n: 1 },
  { type: "add", n: 2 },
  { type: "add", n: -3 },
] as const;

describe("S2 syncTest catches its plants", () => {
  it("plant, reject everything: a real tea machine passes generated lists without handlers", async () => {
    const { syncTest } = await import("./testing.ts");
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -10, max: 10 }), { maxLength: 12 }), (ns) => {
        expect(() =>
          syncTest(machine, {}, { msgs: ns.map((n) => ({ type: "add", n })), encode, decode, equals, seed: SEED }),
        ).not.toThrow();
      }),
      { seed: SEED, numRuns: 80 },
    );
  });
  it("plant, lose a queued field: catches a model that agrees at the end but emits a wrong Cmd", async () => {
    const { syncTest } = await import("./testing.ts");
    const dropped = (s: typeof Model.Type) => ({ count: s.count });
    const restored = (raw: unknown) => ({
      count: Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int }))(raw).count,
      carry: 0,
    });
    expect(() => syncTest(machine, {}, { msgs, encode: dropped, decode: restored, equals, seed: SEED })).toThrow();
  });
  it("plant, compare final model only: catches a Cmd difference even when all models match", async () => {
    const { syncTest } = await import("./testing.ts");
    let loaded = false;
    const tricky = {
      ...machine,
      init: (saved: typeof Model.Type | null) => {
        loaded = saved !== null;
        return machine.init(saved, {});
      },
      update: {
        ...machine.update,
        add: (s: typeof Model.Type, m: typeof Msg.Type) =>
          [{ count: s.count + m.n, carry: s.carry + 1 }, [report({ n: loaded ? 999 : s.carry })]] as const,
      },
    };
    expect(() => syncTest(tricky, {}, { msgs, encode, decode, equals, seed: SEED })).toThrow();
  });
  it("plant, skip the first or last cut: boot and final saves are checked even for an empty list", async () => {
    const { syncTest } = await import("./testing.ts");

    for (const list of [[], msgs] as const) {
      let saves = 0;
      const cuts: number[] = [];
      syncTest(
        machine,
        {},
        {
          msgs: list,
          encode: (s: typeof Model.Type) => {
            cuts.push(s.count);
            saves++;
            return encode(s);
          },
          decode,
          equals,
          seed: SEED,
        },
      );
      expect(saves).toBe(list.length + 1);
      expect(cuts[0]).toBe(0);
      expect(cuts.at(-1)).toBe(0);
    }
  });
  it("plant, skip JSON text: a value JSON cannot save must fail", async () => {
    const { syncTest } = await import("./testing.ts");
    expect(() =>
      syncTest(
        machine,
        {},
        {
          msgs,
          encode: (s: typeof Model.Type) => ({ ...s, carry: Number.NaN }),
          decode,
          equals,
          seed: SEED,
        },
      ),
    ).toThrow();
  });
});

describe("p69 senderTest catches its plants", () => {
  const owner = { key: "owner", for: "person", _tag: "agent" } as const;
  const person = { key: "window", for: "person", _tag: "person" } as const;
  const agent = { key: "agent", for: "person", _tag: "agent" } as const;
  const inputs = [
    { parent: "pa", by: person },
    { parent: "pb", by: agent },
  ];
  const expected = [
    { id: "wa", by: person },
    { id: "wb", by: agent },
    { id: "background", by: owner },
  ];
  const writes = [
    { id: "wa", parent: "pa", by: person },
    { id: "wb", parent: "pb", by: agent },
    { id: "background", parent: null, by: owner },
  ];
  it("plant, reject own: interleaved queued replies and explicit own agree with the input oracle", async () => {
    const { senderTest } = await import("./testing.ts");
    expect(() => senderTest({ inputs, expected, writes, owner, seed: SEED })).not.toThrow();
  });
  it("plant, latest Msg wins: a queued agent write cannot inherit the later person's reply", async () => {
    const { senderTest } = await import("./testing.ts");
    const wrong = [writes[0]!, { ...writes[1]!, parent: "pa", by: person }, writes[2]!];
    expect(() => senderTest({ inputs, expected, writes: wrong, owner, seed: SEED })).toThrow();
  });
  it("plant, drop parent and call it own: changing the observed parent must not change the oracle", async () => {
    const { senderTest } = await import("./testing.ts");
    const wrong = [writes[0]!, { ...writes[1]!, parent: null, by: owner }, writes[2]!];
    expect(() => senderTest({ inputs, expected, writes: wrong, owner, seed: SEED })).toThrow();
  });

  for (const fault of ["missing", "duplicate", "extra"] as const) {
    it(`plant, ${fault} write: every expected write matches exactly once`, async () => {
      const { senderTest } = await import("./testing.ts");
      const wrong =
        fault === "missing"
          ? writes.slice(1)
          : fault === "duplicate"
            ? [...writes, writes[0]!]
            : [...writes, { ...writes[0]!, id: "unexpected" }];
      expect(() => senderTest({ inputs, expected, writes: wrong, owner, seed: SEED })).toThrow();
    });
  }
});
