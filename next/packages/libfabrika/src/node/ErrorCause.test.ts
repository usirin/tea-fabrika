// T695, next/. Runs the modules' error-cause suites on the real node:sqlite driver (0062): each
// suite takes a fresh `Sql`, and this module owns the driver. The span sink's laws need that
// driver too, so they sit here: `telemetry/Sink.ts:393`, and C7 on every stored span output.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as fc from "fast-check";
import * as GatewayCauseTest from "../gateway/GatewayCauseTest.ts";
import { Doorbell, Ledger, type LedgerCalls, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerCauseTest from "../ledger/LedgerCauseTest.ts";
import * as LedgerRemote from "../ledger/LedgerRemote.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { lineFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import * as RuntimeCauseTest from "../runtime/RuntimeCauseTest.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { SpanSink } from "../telemetry/Sink.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;
const PROCESS = "process_0000000000e008000000000000";

const opened: Array<DatabaseSync> = [];

const fresh = (): Sql => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  return nodeSql(db);
};

/** Gives back every database a case opened when the case's scope closes (0061): `fresh` is sync. */
const closesOpened = Effect.addFinalizer(() =>
  Effect.sync(() => {
    for (const db of opened.splice(0)) {
      if (db.isOpen) {
        db.close();
      }
    }
  }),
);

/** Each suite's properties: seed 119120, 100 runs, each case an Effect on the real code in a scope. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(Effect.scoped(Effect.andThen(closesOpened, check(value))))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

// The ledger suite's stored-row plant: a required integer column holds text.
LedgerCauseTest.suite(law, fresh, (sql, text) => {
  sql.exec("UPDATE entries SET seen = ? WHERE pos = 1", text);
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

RuntimeCauseTest.suite(law, {
  fresh,
  ledger: (sql, reader) => LedgerSql.layer(sql, { reader }).pipe(Layer.provide(quiet)),
  transactions: (sql) => LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet)),
  lineFor,
  append: (stream, id, line) => Ledger.use((ledger) => ledger.append(stream, id, line)),
  LedgerError,
});

GatewayCauseTest.suite(law, { fresh });

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** The same `Sql`, but each transaction throws `failure`. */
const throwing = (sql: Sql, failure: unknown): Sql => ({
  ...sql,
  transaction: () => {
    throw failure;
  },
});

describe("T695, the span sink keeps what failed", () => {
  // C1, Sink.ts:393. Plant: `new SinkError({ reason: "storage", held: held.length })`.
  law(
    "C1: a summaries call whose commit throws is `storage` with the thrown value as its cause",
    fc.record({ failure: failures, from: fc.nat(), span: fc.boolean() }),
    ({ failure, from, span }) =>
      Effect.gen(function* () {
        const sink = SpanSink.layer(throwing(fresh(), failure), { object: PROCESS });
        const error = yield* Effect.flip(
          Effect.gen(function* () {
            if (span) {
              // A span that ends first is held in memory; the summaries call meets the same disk.
              yield* Effect.void.pipe(Effect.withSpan("probe"));
            }

            return yield* SpanSink.use((s) => s.summaries(from, from + 3_600_000));
          }).pipe(Effect.provide(sink)),
        );
        expect(error.reason).toBe("storage");
        expect(error.cause).toBe(failure);
      }),
  );
});

// C7 [secrets]. A cause stays in memory; what the sink stores never holds its input-bearing text.
// Sentinels are made up per run. Each one is checked raw, JSON-escaped and URL-encoded, and as its
// bare core word, over every row of every table the sink wrote: unsent span rows and their content,
// and the health rows. Plants, one at a time: keep the raw cause at each translating site the
// failures below pass through, so `Cause.pretty` at `telemetry/Sink.ts:181` formats it.
const words = fc.stringMatching(/^[a-z]{12}$/).map((word) => `sntl${word}`);

/** Where a sentinel rides: a message (and so a stack), a nested object, or a cause's cause. */
const carriers = (text: string): ReadonlyArray<unknown> => [
  new Error(text),
  { nested: { deep: [text] } },
  new TypeError("outer", { cause: new Error(text) }),
];

const forms = (core: string, text: string) => [core, text, JSON.stringify(text).slice(1, -1), encodeURIComponent(text)];

/** Every row of every table in `sql`, as JSON text. */
const dump = (sql: Sql): string =>
  sql
    .exec("SELECT name FROM sqlite_master WHERE type='table'")
    .map((table) => JSON.stringify(sql.exec(`SELECT * FROM "${String(table.name)}"`)))
    .join("\n");

type Flow = "ledger_rejects" | "ledger_decode" | "archive_rejects" | "store_throws";
const flows = fc.constantFrom<Flow>("ledger_rejects", "ledger_decode", "archive_rejects", "store_throws");

/** One failing operation whose failure holds `text`, inside a span the sink stores. */
const fail = (flow: Flow, text: string, carrier: unknown): Effect.Effect<unknown, unknown> => {
  if (flow === "ledger_rejects" || flow === "ledger_decode") {
    const answer = flow === "ledger_rejects" ? null : { _tag: "ready", rev: { input: text } };
    const calls: LedgerCalls = {
      append: () => (answer === null ? Promise.reject(carrier) : Promise.resolve(answer)),
      read: () => (answer === null ? Promise.reject(carrier) : Promise.resolve([{ rev: { input: text } }])),
      wait: () => (answer === null ? Promise.reject(carrier) : Promise.resolve(answer)),
    };
    return Ledger.use((ledger) => ledger.wait("notes:1", 0)).pipe(
      Effect.provide(LedgerRemote.layer(calls, { reader: "connection:t1" })),
    );
  }

  if (flow === "archive_rejects") {
    return Archive.use((archive) => archive.put("spans/1", new Uint8Array([1]))).pipe(
      Effect.provide(
        Archive.bucket({
          put: () => Promise.reject(carrier),
          head: () => Promise.reject(carrier),
        }),
      ),
    );
  }

  const disk = fresh();
  const broken: Sql = {
    ...disk,
    exec: () => {
      throw carrier;
    },
  };
  const store = ProcessStore.layer(broken, { process: PROCESS }).pipe(
    Layer.provide(
      LedgerSql.layer(disk, { reader: PROCESS }).pipe(
        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
      ),
    ),
  );
  return ProcessStore.use((s) => s.load).pipe(Effect.provide(store));
};

describe("T695, C7 [secrets]: the span sink stores no input-bearing detail of a cause", () => {
  law(
    "C7: generated decode, storage and RPC failures carrying sentinels leave no sentinel in any stored row",
    fc.record({
      steps: fc.array(fc.record({ flow: flows, word: words, carrier: fc.nat({ max: 2 }) }), {
        minLength: 1,
        maxLength: 4,
      }),
      decor: fc.constantFrom(' "quoted" ', " /path?x=1&y=2 ", "\n\t", " ü "),
    }),
    ({ steps, decor }) =>
      Effect.gen(function* () {
        const sql = fresh();
        const kept: Array<unknown> = [];

        yield* Effect.gen(function* () {
          for (const { flow, word, carrier } of steps) {
            const text = `${decor}${word}${decor}`;
            const value = carriers(text)[carrier];
            const failed = yield* Effect.flip(fail(flow, text, value).pipe(Effect.withSpan(`probe.${flow}`)));
            kept.push(failed);
          }
        }).pipe(Effect.provide(SpanSink.layer(sql, { object: PROCESS })));

        // The failures are real: each step failed, and the sink stored a row for it.
        expect(kept).toHaveLength(steps.length);
        const stored = dump(sql);
        expect(stored).toContain("probe.");

        for (const { word } of steps) {
          for (const form of forms(word, `${decor}${word}${decor}`)) {
            expect(stored.includes(form), "a stored span row holds a cause's input-bearing text").toBe(false);
          }
        }
      }),
  );
});
