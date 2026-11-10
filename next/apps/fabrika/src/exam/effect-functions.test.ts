// T285, PR 1, next/. Plants are source fixtures, as in the other lint exams.
import { Effect, Tracer } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asks } from "./edges.ts";
import { plant } from "./plant.ts";

const CODE = "fabrika(effect-functions)";
const FILE = "next/packages/libfabrika/src/data/tracing.ts";

const source = [
  'import {Effect, Stream} from "effect";',
  "declare const append: () => Effect.Effect<void>;",
  'export const wrapped = () => append().pipe(Effect.withSpan("ledger.append"));',
  'export function blocked() { return append().pipe(Effect.withSpan("ledger.append")); }',
  'const service = { append: () => append().pipe(Effect.withSpan("ledger.append")) };',
  'const ring = () => append().pipe(Effect.withSpan("ledger.ring"), Effect.catchCause(() => Effect.void));',
  'const cmdSpan = (job: string) => (work: Effect.Effect<void>) => work.pipe(Effect.withSpan("runner.cmd"));',
  'const direct = () => Effect.withSpan(append(), "ledger.append");',
  'const chained = () => append().pipe(Effect.withSpan("ledger.append")).pipe(Effect.asVoid);',
  'const inner = Effect.fnUntraced(function* () { yield* append().pipe(Effect.withSpan("part")); yield* append(); });',
  'const consumed = () => Stream.runCollect(Stream.empty.pipe(Stream.withSpan("mailbox.receive")));',
  'const traced = Effect.fn("ledger.append")(function* () { return yield* append(); });',
  "const helper = Effect.fnUntraced(function* () { return yield* append(); });",
  "const plain = () => append();",
  'const outer = () => Effect.gen(function* () { yield* append().pipe(Effect.withSpan("part")); yield* append(); });',
  'const callback = Effect.forEach([], () => append().pipe(Effect.withSpan("item")), {concurrency: 1});',
].join("\n");

describe("effect-functions", async () => {
  const all = await plant({
    [FILE]: source,
    "next/packages/libfabrika/src/data/tracing.test.ts": source,
    "packages/fabrika/src/tracing.ts": source,
    "next/packages/libfabrika/src/data/alias.ts": [
      'import {Effect as E} from "effect";',
      'const append = () => E.void.pipe(E.withSpan("ledger.append"));',
    ].join("\n"),
    "next/packages/libfabrika/src/data/namespace.ts": [
      'import * as E from "effect/Effect";',
      'const append = () => E.void.pipe(E.withSpan("ledger.append"));',
    ].join("\n"),
  });

  it("rejects function spans, including append, recovery, curried and direct wrappers", () => {
    expect(all(CODE, FILE)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("accepts inner spans, consumed stream spans, named fn, untraced helpers and callbacks", () => {
    expect(all(CODE, FILE).filter((line) => line >= 10)).toEqual([]);
  });

  it("recognizes Effect imports under another name", () => {
    expect(all(CODE, "next/packages/libfabrika/src/data/alias.ts")).toEqual([2]);
    expect(all(CODE, "next/packages/libfabrika/src/data/namespace.ts")).toEqual([2]);
  });

  it("leaves today's version alone", () => {
    expect(all(CODE, "packages/fabrika/src/tracing.ts")).toEqual([]);
  });

  it("accepts test helpers that manufacture spans as sink input", () => {
    expect(all(CODE, "next/packages/libfabrika/src/data/tracing.test.ts")).toEqual([]);
  });

  it("the exam's generated edge reads keep answers and one named function span", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (old) => {
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const before = new Map<string, string>();
        const after = new Map<string, string>();

        for (const [index, present] of old.entries()) {
          const path = `next/test-${index}.ts`;
          const source = `// oxlint-disable-next-line fabrika/no-promises -- edge: case ${index}\nconst value = 1;`;

          if (present) {
            before.set(path, source);
          }

          after.set(path, source);
        }

        const found = Effect.runSync(asks(before, after).pipe(Effect.withTracer(tracer)));
        expect(found.map((edge) => edge.path).sort()).toEqual(
          old.flatMap((present, index) => (present ? [] : [`next/test-${index}.ts`])).sort(),
        );
        expect(spans.map((s) => s.name)).toEqual(["exam.asks"]);
        expect(spans[0]!.status._tag).toBe("Ended");
      }),
      { seed: 119120, numRuns: 40 },
    );
  });
});
