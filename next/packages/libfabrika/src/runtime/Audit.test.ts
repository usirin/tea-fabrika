// P13 slice 2, next/. Selection is exercised through the same execution entry used by a box.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { nodeExecution } from "./Execution.ts";
import { capture, unleaked } from "./RepliesTest.ts";

const Model = Schema.Struct({ versions: Schema.Record(Schema.String, Schema.Int) });

const Metadata = Schema.Struct({
  type: Schema.Literal("save"),
  note: Schema.String,
  base: Schema.Int,
  reason: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.Struct({ note: Schema.String, version: Schema.Int })),
});

const Save = Schema.Struct({ ...Metadata.fields, body: Schema.String });
const parameters = { seed: 119120, numRuns: 100 };

const raised = (body: string): never => {
  throw new Error(body);
};

const Tape = fc.array(fc.record({ pick: fc.noBias(fc.nat()), move: fc.noBias(fc.nat()) }), {
  minLength: 8,
  maxLength: 32,
});

const Samples = Arbitrary.array(Arbitrary.schema(Save), { minLength: 8, maxLength: 32 });

const declared = (select: (msg: typeof Save.Type) => unknown, data: Schema.Codec<unknown, unknown> = Metadata) => ({
  name: "audit-fixture",
  machine: Machine.make({
    model: Model,
    msg: Save,
    cmds: [],
    init: (saved) => [saved ?? { versions: {} }, []],
    update: { save: (s) => [s, []] },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Save,
  view: {
    data: Model,
    select: () => {
      throw new Error("audit called view");
    },
  },
  refuse: () => {
    throw new Error("audit called refusal");
  },
  wake: () => {
    throw new Error("audit called wake");
  },
  inputs: {},
  outputs: {},
  writes: {},
  audit: { data, select },
});

const metadata = (m: typeof Save.Type) =>
  Metadata.make({
    type: m.type,
    note: m.note,
    base: m.base,
    ...(m.reason === undefined ? {} : { reason: m.reason }),
    ...(m.from === undefined ? {} : { from: m.from }),
  });

describe("P13 safe audit", () => {
  it.live.prop(
    "A1: selected save metadata is exact across body changes and forged identity",
    [Samples],
    ([samples]) =>
      Effect.gen(function* () {
        const versions = new Map<string, number>();
        const execution = nodeExecution(declared(metadata));

        for (const [n, sample] of samples.entries()) {
          const base = versions.get(sample.note) ?? 0;
          const input = Save.make({ ...sample, base });
          const want = metadata(input);

          for (const body of [input.body, `${input.body}"/雪\n${n}`]) {
            expect(yield* execution.audit({ ...input, body, by: { key: body }, for: body, unrelated: body })).toEqual(
              want,
            );
          }

          versions.set(sample.note, base + 1);
        }

        // A program without an audit declaration records only the message type.
        const { audit: _audit, ...minimal } = declared(metadata);
        expect(yield* nodeExecution(minimal).audit(samples[0]!)).toEqual({ type: "save" });
      }),
    { arbitrary: { seed: 119120, runs: 100 } },
  );

  it("A5, A12 [secrets]: decode, selector and output failures are typed and printable without their input", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(Tape, (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const bodies: Array<string> = [];
              const outputs: Array<string> = [];
              const spans = capture();
              const versions = new Map<string, number>();

              for (const [n, cell] of tape.entries()) {
                const note = `note-${cell.pick % 3}`;
                const base = versions.get(note) ?? 0;
                const body = JSON.stringify({ private: cell.pick, line: `"/雪\n${n}` });
                const input = Save.make({ type: "save", note, base, body });
                bodies.push(body);
                const modes = ["decode", "selector", "output", "json"] as const;
                const mode = modes[cell.move % modes.length]!;
                reached.add(mode);
                const program =
                  mode === "selector"
                    ? declared(() => raised(body))
                    : mode === "output"
                      ? declared(() => ({ type: "save", note, base: body }))
                      : mode === "json"
                        ? declared(() => ({ hidden: 1n }), Schema.Unknown)
                        : declared(metadata);
                const execution = nodeExecution(program);
                const exit = yield* Effect.exit(
                  execution.audit(mode === "decode" ? { ...input, base: body } : input),
                ).pipe(Effect.withTracer(spans.tracer));
                expect(Exit.isFailure(exit)).toBe(true);

                if (Exit.isFailure(exit)) {
                  expect(Cause.hasDies(exit.cause)).toBe(false);
                  const error = Cause.squash(exit.cause);
                  expect(error).toMatchObject({ _tag: "AuditError", reason: { _tag: expect.any(String) } });
                  outputs.push(String(error), JSON.stringify(error), Cause.pretty(exit.cause));
                }

                // Repair on the same input is the positive control for every failure edge.
                expect(yield* nodeExecution(declared(metadata)).audit(input)).toEqual(metadata(input));
                versions.set(note, base + 1);
              }

              unleaked([...outputs, ...spans.text()], bodies);
            }),
          ),
        ),
      ),
      parameters,
    );
    expect([...reached]).toEqual(expect.arrayContaining(["decode", "selector", "output", "json"]));
  });
});
