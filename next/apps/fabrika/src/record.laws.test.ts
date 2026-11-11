// T502 PR 2, next/. One set of laws, two drivers. Lead runs the wire group outside the box.
// Plants: omit the shell's cap; map the callee's bad_row to unreachable.
import { DatabaseSync } from "node:sqlite";
import { expect, it, layer } from "@effect/vitest";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Written } from "@kampus/libfabrika/telemetry/Records";
import type { SinkError } from "@kampus/libfabrika/telemetry/Sink";
import { Chain, Content, partName, SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import type { RecordShape } from "@kampus/libfabrika/workers/objects";
import { recordWrite, recordRead, recordContent, recordDelete } from "@kampus/libfabrika/workers/record";
import type { Scope } from "effect";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";

import { recordCall, recordWire } from "./record-wire.test-support.ts";

type Rows = Parameters<typeof recordWrite>[4];
type Deletion = Parameters<typeof recordDelete>[5];

type Part = {
  write: (chain: Chain, at: number, rows: Rows) => ReturnType<typeof recordWrite>;
  read: (chain: Chain, at: number, after: number) => ReturnType<typeof recordRead>;
  content: (chain: Chain, at: number, id: string) => ReturnType<typeof recordContent>;
  deleteContent: (chain: Chain, at: number, id: string, by: Deletion) => ReturnType<typeof recordDelete>;
};

type Driver = (name: string, cap: number) => Effect.Effect<Part, never, Scope.Scope>;
const Page = Schema.Struct({ spans: Schema.Array(SpanRow), after: Schema.Int, rolled: Schema.Boolean });
const Lookup = Schema.TaggedUnion({ found: { content: Schema.NullOr(Content) }, absent: { rolled: Schema.Boolean } });

class Wire extends Context.Service<Wire, { readonly driver: Driver }>()("t502/RecordLaws.Wire") {}

const node: Driver = Effect.fnUntraced(function* (name: string, cap: number) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db);
  // Only the state handles read by the four exported services; real SQLite, no fake queries.
  // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies only the platform handles the real record service reads
  const state = {
    id: { name },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
    },
  } as unknown as Parameters<typeof recordWrite>[0];
  return {
    write: (chain: Chain, at: number, rows: Rows) => recordWrite(state, cap, chain, at, rows),
    read: (chain: Chain, at: number, after: number) => recordRead(state, cap, chain, at, after),
    content: (chain: Chain, at: number, id: string) => recordContent(state, cap, chain, at, id),
    deleteContent: (chain: Chain, at: number, id: string, by: Deletion) => recordDelete(state, cap, chain, at, id, by),
  } satisfies RecordShape;
});

const Input = Schema.Struct({
  job: Schema.Boolean,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
  // The wire is JSON: non-finite numbers cannot cross it. Keep every other SpanRow field generated.
  rows: Schema.Array(
    Schema.Struct({
      span: SpanRow.check(Schema.makeFilter((row) => Schema.is(SpanRow)(JSON.parse(JSON.stringify(row))))),
      content: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  after: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 25 })),
  by: Schema.Struct({ by: Schema.String, at: Schema.Int, reason: Schema.String }),
});

// A lone surrogate is repaired differently by workerd's SQLite (three U+FFFD) and node:sqlite (one).
// A finding records it; this law compares well-formed text.
const wellFormed = (input: typeof Input.Type): typeof Input.Type => {
  const repair = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(/\p{Cs}/gu, "�");
    }

    if (Array.isArray(value)) {
      return value.map(repair);
    }

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key.replace(/\p{Cs}/gu, "�"), repair(item)]),
      );
    }

    return value;
  };
  return Schema.decodeUnknownSync(Input)(repair(input));
};

const cap = 64 * 1024;
const options = { arbitrary: { seed: 119120, runs: 30 } };
let sequence = 0;

const NodeLive = Layer.succeed(Wire, { driver: node });

// The wire instance is acquired by the layer, so the file's layer scope releases it.
const WireLive = Layer.effect(
  Wire,
  Effect.gen(function* () {
    const instance = yield* recordWire(cap);
    const driver: Driver = Effect.fnUntraced(function* (name: string) {
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])))(
        name,
      );
      const [project, part] = Option.getOrElse(decoded, () => ["invalid-name", name]);
      const stub = instance.record(project, part);
      const { write, read, content, deleteContent } = stub;

      if (write === undefined || read === undefined || content === undefined || deleteContent === undefined) {
        return yield* Effect.die(new Error("record binding is missing a method"));
      }

      const call = <A>(schema: Schema.Codec<A>, invoke: () => Promise<unknown>) =>
        recordCall(invoke).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value).pipe(Effect.orDie)),
        );
      return {
        write: (chain, at, rows) => call(Written, () => write(chain, at, rows)),
        read: (chain, at, after) => call(Page, () => read(chain, at, after)),
        content: (chain, at, id) => call(Lookup, () => content(chain, at, id)),
        deleteContent: (chain, at, id, by) => call(Lookup, () => deleteContent(chain, at, id, by)),
      } satisfies Part;
    });
    return { driver };
  }),
);

for (const [kind, live] of [
  ["node", NodeLive],
  ["wire", WireLive],
] as const) {
  layer(live)(`RecordPart ${kind}`, (it) => {
    it.effect.prop(
      "rows, retry, cursor, content and deletion agree with SQLite",
      { input: Input },
      ({ input: generated }) =>
        Effect.gen(function* () {
          const input = wellFormed(generated);
          const chain = input.job
            ? Chain.cases.job.make({ process: `process_01m6v5270hf3c8x2q7w9z4k5${String(input.at).padStart(2, "0")}` })
            : Chain.cases.spans.make({});
          const name = JSON.stringify([`law-${sequence++}`, partName(chain, input.at)]);
          const { driver } = yield* Wire;
          const actual = yield* driver(name, cap),
            oracle = yield* node(name, cap);
          const rows = input.rows.map((r, index) => ({ ...r, span: { ...r.span, spanId: String(index) } }));
          const exercise = (part: Part) =>
            Effect.gen(function* () {
              // The cap is checked before a batch: this first batch lands whole,
              // even if it crosses the cap. Its identical retry has no fresh rows.
              const write = yield* part.write(chain, input.at, rows);
              const retry = yield* part.write(chain, input.at, rows);
              const read = yield* part.read(chain, input.at, input.after);
              const contents = yield* Effect.forEach(rows, (row) => part.content(chain, input.at, row.span.spanId), {
                concurrency: 1,
              });
              const deleted = yield* part.deleteContent(chain, input.at, "0", input.by);
              const again = yield* part.deleteContent(chain, input.at, "0", { ...input.by, reason: "second deletion" });
              const after = yield* part.content(chain, input.at, "0");
              const missing = yield* part.content(chain, input.at, "missing");
              return { write, retry, read, contents, deleted, again, after, missing };
            });
          const result = yield* exercise(actual);
          expect(result).toEqual(yield* exercise(oracle));
          expect(result.write).toEqual({ _tag: "written" });
          expect(result.read).toMatchObject({
            spans: rows.slice(input.after).map((r) => ({ spanId: r.span.spanId })),
            after: Math.max(input.after, rows.length),
            rolled: false,
          });
          expect(result.again).toEqual(result.deleted);
          expect(result.missing).toEqual({ _tag: "absent", rolled: false });
        }),
      options,
    );

    it.effect.prop(
      "a full part rolls with the same next and held IDs on both drivers",
      { input: Input },
      ({ input: generated }) =>
        Effect.gen(function* () {
          const input = wellFormed(generated);
          const chain = Chain.cases.spans.make({});
          const name = JSON.stringify([`full-${sequence++}`, partName(chain, input.at)]);
          const rows = input.rows.map((row, index) => ({
            ...row,
            span: { ...row.span, spanId: String(index) },
            content: "x".repeat(cap) + (row.content ?? ""),
          }));
          const fresh = { ...rows[0]!, span: { ...rows[0]!.span, spanId: "fresh" } };
          const exercise = (part: Part) =>
            Effect.gen(function* () {
              // One batch lands whole; the next mixed batch must see the crossed cap.
              expect(yield* part.write(chain, input.at, rows)).toEqual({ _tag: "written" });
              const written = yield* part.write(chain, input.at, [...rows, fresh]);
              const page = yield* part.read(chain, input.at, 0);
              return { written, page };
            });
          const { driver } = yield* Wire;
          const actual = yield* exercise(yield* driver(name, cap));
          expect(actual).toEqual(yield* exercise(yield* node(name, cap)));
          expect(actual.written).toEqual({
            _tag: "rolled",
            next: partName(chain, input.at + 1),
            had: rows.map((row) => row.span.spanId),
          });
          expect(actual.page).toMatchObject({
            spans: rows.map((row) => ({ spanId: row.span.spanId })),
            after: rows.length,
            rolled: true,
          });
        }),
      options,
    );

    it.effect.prop(
      "a name that cannot decode fails as SinkError bad_row over either driver",
      { text: Schema.String },
      ({ text }) =>
        Effect.gen(function* () {
          const { driver } = yield* Wire;
          const part = yield* driver(`not-json:${text}`, cap);
          const chain = Chain.cases.spans.make({});

          const calls: ReadonlyArray<Effect.Effect<unknown, SinkError>> = [
            part.write(chain, 0, []),
            part.read(chain, 0, 0),
            part.content(chain, 0, "missing"),
            part.deleteContent(chain, 0, "missing", { by: "fixture", at: 0, reason: text }),
          ];

          for (const call of calls) {
            const result = yield* Effect.result(call);
            expect(Result.match(result, { onSuccess: () => null, onFailure: (e) => e })).toMatchObject({
              _tag: "SinkError",
              reason: "bad_row",
              held: 0,
            });
          }
        }),
      options,
    );
  });
}

// A whole instance at cap 1 cannot start, since its own spans roll forever.
it.effect.prop(
  "a cap below the initialized database rolls before a fresh row",
  { input: Input },
  ({ input: generated }) =>
    Effect.gen(function* () {
      const input = wellFormed(generated);
      const chain = Chain.cases.spans.make({});
      const name = JSON.stringify([`cap-${sequence++}`, partName(chain, input.at)]);
      const part = yield* node(name, 1);
      const expected = yield* (yield* node(name, 1)).write(chain, input.at, input.rows);
      expect(yield* part.write(chain, input.at, input.rows)).toEqual(expected);
      expect(expected).toEqual({ _tag: "rolled", next: partName(chain, input.at + 1), had: [] });
      expect(yield* part.read(chain, input.at, 0)).toEqual({ spans: [], after: 0, rolled: true });
    }),
  options,
);
