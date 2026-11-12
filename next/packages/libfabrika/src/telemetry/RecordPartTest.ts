// P12, next/. A single real SQLite part, reopened as an object would be on storage wake.
// P37 already owns manager traversal. Here the new adapter must not alias multiple parts.
// The laws, and no driver (0062): a runner in the module that owns a driver calls
// `RecordPartTest.suite(open)`, and `open` acquires each store in a scope (0061).
import { describe, expect, it } from "@effect/vitest";
import { Effect, type PlatformError, type Scope } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import type { SpanRow } from "./Trace.ts";

/** One test store. Each `use` holds one handle open for its body and closes it before it returns. */
export interface Store {
  readonly use: <A, E, R>(body: (sql: Sql) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Scope.Scope>>;
}

/** `file`: every use reopens the same file in a folder the scope removes. `memory`: its own database. */
export type Open = (mode: "file" | "memory") => Effect.Effect<Store, PlatformError.PlatformError, Scope.Scope>;

type Lookup = { _tag: "found"; content: unknown } | { _tag: "absent"; rolled: boolean };

type Part = {
  write: (rows: ReadonlyArray<{ span: SpanRow; content: string | null }>) => Effect.Effect<unknown, unknown>;
  read: (after: number) => Effect.Effect<{ spans: ReadonlyArray<SpanRow>; after: number; rolled: boolean }, unknown>;
  content: (span: string) => Effect.Effect<Lookup, unknown>;
  deleteContent: (span: string, by: { by: string; at: number; reason: string }) => Effect.Effect<Lookup, unknown>;
};

const SEED = 119120;
const pageBoundary: [number, string, number] = [503, "private failure", 42];
const rollAtCap: [number[], number, number] = [[1, 2], 1000, 0];

/** The page law's three generators, in their order: total, content, deletion time. */
const Page: [fc.Arbitrary<number>, fc.Arbitrary<string>, fc.Arbitrary<number>] = [
  fc.integer({ min: 501, max: 550 }),
  fc.string(),
  fc.nat(),
];

/** The roll law's three generators, in their order: two distinct IDs, the cap, the part index. */
const Roll: [fc.Arbitrary<number[]>, fc.Arbitrary<number>, fc.Arbitrary<number>] = [
  fc.uniqueArray(fc.nat(), { minLength: 2, maxLength: 2 }),
  fc.integer({ min: 1, max: 1_000_000 }),
  fc.nat({ max: 1000 }),
];

const span = (n: number): SpanRow => ({
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: n.toString(16).padStart(16, "0"),
  parentSpanId: null,
  name: "runner.step",
  kind: "internal",
  startTimeUnixNano: "1794096000000000000",
  endTimeUnixNano: "1794096000001000000",
  attributes: {},
  events: [],
  links: [],
  resource: { attributes: { "fab.object": "record-test" } },
  ok: true,
});

const reopen = (open: Open, total: number, content: string, at: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      // oxlint-disable-next-line fabrika/no-promises -- edge: the law loads the adapter as its wiring plant does
      const { recordPart } = yield* Effect.promise(() => import("./RecordPart.ts"));
      const store = yield* open("file");
      const rows = Array.from({ length: total }, (_, n) => ({
        span: span(n),
        content: n === total - 1 ? content : null,
      }));
      yield* store.use((sql) =>
        Effect.gen(function* () {
          const part: Part = recordPart(sql, { _tag: "spans" }, 0, 1_000_000_000);
          expect(yield* part.write(rows)).toEqual({ _tag: "written" });
        }),
      );
      // The first handle has closed; a new one reads the same file.
      yield* store.use((sql) =>
        Effect.gen(function* () {
          const part: Part = recordPart(sql, { _tag: "spans" }, 0, 1_000_000_000);
          // T641: the reopened file already holds the first write, before the retry writes again.
          expect((yield* part.read(0)).spans).toEqual(rows.slice(0, 500).map((r) => r.span));
          expect(yield* part.write(rows)).toEqual({ _tag: "written" });
          const first = yield* part.read(0);
          const last = yield* part.read(first.after);
          expect(first.spans).toEqual(rows.slice(0, 500).map((r) => r.span));
          expect(last.spans).toEqual(rows.slice(500).map((r) => r.span));
          expect(yield* part.content(span(total - 1).spanId)).toMatchObject({
            _tag: "found",
            content: { _tag: "kept", message: content },
          });
          const by = { by: "person-test", at, reason: "requested" };
          yield* part.deleteContent(span(total - 1).spanId, by);
          yield* part.deleteContent(span(total - 1).spanId, { ...by, at: at + 1 });
          expect(yield* part.content(span(total - 1).spanId)).toMatchObject({
            _tag: "found",
            content: { _tag: "deleted", ...by },
          });
          expect((yield* part.read(500)).spans).toHaveLength(total - 500);
        }),
      );
    }),
  );

const separate = (open: Open, [oldId, freshId]: number[], cap: number, index: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      // oxlint-disable-next-line fabrika/no-promises -- edge: the law loads the adapter as its wiring plant does
      const { recordPart } = yield* Effect.promise(() => import("./RecordPart.ts"));
      const a = yield* open("memory");
      const b = yield* open("memory");
      // Both databases stay open, each in its own use, while the assertions run.
      yield* a.use((inner) =>
        b.use((other) =>
          Effect.gen(function* () {
            let size = 0;
            const sql: Sql = { ...inner, size: () => size };
            const first: Part = recordPart(sql, { _tag: "spans" }, index, cap);
            const next: Part = recordPart(other, { _tag: "spans" }, index + 1, 1_000_000_000);
            const old = { span: span(oldId!), content: null };
            const fresh = { span: span(freshId!), content: null };
            yield* first.write([old]);
            size = cap;
            expect(yield* first.write([old])).toEqual({ _tag: "written" });
            expect(yield* first.write([old, fresh])).toEqual({
              _tag: "rolled",
              next: `spans/${index + 1}`,
              had: [old.span.spanId],
            });
            yield* next.write([fresh]);
            expect((yield* first.read(0)).spans).toEqual([old.span]);
            expect((yield* next.read(0)).spans).toEqual([fresh.span]);
            expect(yield* first.content(fresh.span.spanId)).toEqual({
              _tag: "absent",
              rolled: true,
            });
          }),
        ),
      );
    }),
  );

export const suite = (open: Open) =>
  describe("P12 single record part", () => {
    it.effect("P37 wiring plant: reopen, page past 500, and retry without duplicating a span", () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each generated case
        const property = fc.asyncProperty(...Page, (...input) => Effect.runPromise(reopen(open, ...input)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 20, examples: [pageBoundary] }));
      }),
    );
    it.effect("P37 wiring plant: check held IDs before cap, return had, keep each part separate", () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each generated case
        const property = fc.asyncProperty(...Roll, (...input) => Effect.runPromise(separate(open, ...input)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, examples: [rollAtCap] }));
      }),
    );
  });
