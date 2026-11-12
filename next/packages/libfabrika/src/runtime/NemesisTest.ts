// P17b slice 1, next/. The driver owns handles; this suite owns real-ledger read laws (0062).
// After build, run each plant once and restore by copy:
// Off: return success from fire/check. Fire outcomes: replace refused with fired or alter the request.
// Fire errors: replace the cause or leak a lower error. Paging/reopen: read only the first page.
// Captured/parked heads: chase the new tail or treat parked as a fresh head.
// Corruption: skip a bad send/position. Partial reads: swallow wait/read failures as clean.
// Secrets: inject each marker separately into the report, returned outcome, span attributes,
// events, links and health. Answer letters, shown program state and URLs belong to later slices.
import { describe, expect, it } from "@effect/vitest";
import type { Scope } from "effect";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema, Stream, Tracer } from "effect";
import { expectTypeOf } from "vitest";
import { inbox, letterLine } from "../processes/Mailbox.ts";
import { ProcessEvent } from "../processes/Process.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Chain, PROCESS } from "../telemetry/Trace.ts";
import * as Chaos from "./Chaos.ts";
import { BadRow, BadTarget, Nemesis, NemesisError, NotGranted, Off, Storage, Unreachable } from "./Nemesis.ts";
import * as NemesisLedger from "./NemesisLedger.ts";
import * as NemesisNone from "./NemesisNone.ts";

/** A fresh scoped file, yielding a scoped connection Effect that reopens that file. */
export type Database = Effect.Effect<Effect.Effect<Sql, never, Scope.Scope>, never, Scope.Scope>;
const arbitrary = { seed: 119120, runs: 25 };
const pure = { seed: 119120, runs: 100 };
const process = "process_0000000000e008000000000000";
const successor = "process_0000000000e008000000000001";

const target = Chaos.Target.make({
  program: "fabrika/checklist",
  name: "checklist:1",
  process,
  client: "client:1",
  key: "public:1",
});

const id = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000000");

const from = {
  by: "brain",
  for: "person",
  sentAt: "2026-11-12T00:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "1234567890abcdef1234567890abcdef",
  build: "test",
} as const;

type Needs = Layer.Services<ReturnType<typeof NemesisLedger.layer>>;
type Reader = Needs["Service"];
type Line = ReturnType<typeof letterLine>;

/** The Node driver supplies the next lower service, without this suite importing its module. */
export type Driver = {
  readonly database: Database;
  readonly ledger: Context.Key<Needs, Reader>;
  readonly ledgerLayer: (sql: Sql) => Layer.Layer<Needs>;
  readonly lineFor: (metadata: typeof from, event: typeof ProcessEvent.Type) => Line;
  readonly page: number;
  readonly error: (
    reason: "unreachable" | "bad_row" | "storage",
    cause: unknown,
  ) => Effect.Error<ReturnType<Reader["wait"]>>;
  readonly damage: (sql: Sql, key: string, kind: "json" | "body" | "zero" | "negative" | "fraction") => void;
};

const integer = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const ordinal = integer(1, 10000);
const request = (fault: typeof Chaos.Fault.Type, n: number) => Chaos.Fire.make({ id, ordinal: n, target, fault });
const fire = Arbitrary.schema(Chaos.Fault);
const fired = Arbitrary.schema(Chaos.Fired);

// Exact public errors and result types are checked by CI; no lower error may escape this service.
type Service = Nemesis["Service"];
expectTypeOf<Parameters<Service["fire"]>[0]>().toEqualTypeOf<typeof Chaos.Fire.Type>();
expectTypeOf<Effect.Success<ReturnType<Service["fire"]>>>().toEqualTypeOf<typeof Chaos.Fired.Type>();
expectTypeOf<Effect.Success<ReturnType<Service["check"]>>>().toEqualTypeOf<typeof Chaos.Report.Type>();
expectTypeOf<Effect.Error<ReturnType<Service["fire"]>>>().toEqualTypeOf<NemesisError>();
expectTypeOf<Effect.Error<ReturnType<Service["check"]>>>().toEqualTypeOf<NemesisError>();
expectTypeOf<Effect.Services<ReturnType<Service["fire"]>>>().toEqualTypeOf<never>();
expectTypeOf<Effect.Services<ReturnType<Service["check"]>>>().toEqualTypeOf<never>();
expectTypeOf<NemesisError["reason"]>().toEqualTypeOf<Off | BadTarget | NotGranted | Unreachable | BadRow | Storage>();

const failed = Effect.fnUntraced(function* <A>(
  work: Effect.Effect<A, NemesisError>,
  tag: NemesisError["reason"]["_tag"],
) {
  const exit = yield* Effect.exit(work);
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isSuccess(exit)) {
    throw new Error("expected a typed Nemesis failure");
  }

  expect(Cause.hasFails(exit.cause), "a defect is not a typed service failure").toBe(true);
  const error = Cause.squash(exit.cause);
  expect(error).toBeInstanceOf(NemesisError);

  if (!(error instanceof NemesisError)) {
    throw new Error("wrong service error");
  }

  expect(error.reason._tag).toBe(tag);
  return error;
});

const append = Effect.fnUntraced(function* (ledger: Reader, stream: string, key: string, line: Line) {
  const placed = yield* ledger.append(stream, key, line);
  expect(placed._tag).toBe("placed");

  if (placed._tag !== "placed") {
    throw new Error("test history was refused");
  }

  return placed;
});

const service = (Ledger: Driver["ledger"]) =>
  Effect.fnUntraced(function* (ledger: Reader, operation: Service["fire"]) {
    const context = yield* Layer.build(
      NemesisLedger.layer(operation).pipe(Layer.provide(Layer.succeed(Ledger, ledger))),
    );
    return Context.get(context, Nemesis);
  });

const head = Effect.fnUntraced(function* (ledger: Reader, stream: string) {
  const waited = yield* ledger.wait(stream, 0);
  return waited._tag === "ready" ? waited.rev : 0;
});

const seed = (lineFor: Driver["lineFor"]) =>
  Effect.fnUntraced(function* (ledger: Reader, count: number, body: string) {
    for (let i = 0; i < count; i++) {
      // Other streams create global revision jumps without inbox gaps.
      yield* append(ledger, "unrelated", `other-${i}`, letterLine(from, { unrelated: i }));
      yield* append(ledger, inbox(target.name), `letter-${i}`, letterLine(from, { item: i, body }));
    }

    const restart = yield* append(
      ledger,
      `processes/${target.name}`,
      "restart-1",
      lineFor(
        from,
        ProcessEvent.cases.restarted.make({
          name: target.name,
          after: process,
          process: successor,
          reason: "crash",
          build: "test",
        }),
      ),
    );
    return { boundary: yield* head(ledger, inbox(target.name)), processBoundary: restart.rev };
  });

const readReport = Effect.fnUntraced(function* (nemesis: Service) {
  const report = yield* nemesis.check(target);
  const codec = Schema.toCodecJson(Chaos.Report);
  expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(report))).toEqual(report);
  return report;
});

const marker = Arbitrary.schema(Schema.String.check(Schema.isMinLength(12), Schema.isMaxLength(24))).pipe(
  Arbitrary.map((text) => `PRIVATE_${text}_" /ü_END`),
);

const noLeak = (output: unknown, secret: string) => {
  const text = JSON.stringify(output);

  for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), encodeURI(secret)]) {
    expect(text.includes(form), "private content entered public output").toBe(false);
  }
};

export const suite = ({ database, ledger: Ledger, ledgerLayer, lineFor, page: PAGE, error, damage: corrupt }: Driver) =>
  describe("P17b history and off contract, next/", () => {
    it.effect.prop(
      "Off refuses both operations with its own nested typed error",
      [fire, ordinal],
      ([fault, n]) =>
        Effect.gen(function* () {
          const off = yield* Nemesis;
          yield* failed(off.fire(request(fault, n)), "Off");
          yield* failed(off.check(target), "Off");
        }).pipe(Effect.provide(NemesisNone.layer)),
      { arbitrary: pure },
    );

    it.effect.prop(
      "supplied fire preserves fired and refused outcomes and the exact request",
      [fire, fired, ordinal],
      ([fault, outcome, n]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            const asked = request(fault, n);
            const nemesis = yield* service(Ledger)(ledger, (received) =>
              Effect.sync(() => {
                expect(received).toEqual(asked);
                return outcome;
              }),
            );
            expect(yield* nemesis.fire(asked)).toEqual(outcome);
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "supplied fire keeps each typed failure and its original cause",
      [fire, ordinal, marker],
      ([fault, n, secret]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            const cause = new RangeError(secret);

            for (const reason of [
              new Off({ cause }),
              new BadTarget({ cause }),
              new NotGranted({ cause }),
              new Unreachable({ cause }),
              new BadRow({ cause }),
              new Storage({ cause }),
            ]) {
              const error = new NemesisError({ reason });
              const nemesis = yield* service(Ledger)(ledger, () => Effect.fail(error));
              const result = yield* failed(nemesis.fire(request(fault, n)), reason._tag);
              expect(result.reason.cause).toBe(cause);
            }
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "full reads include later pages and survive a new database connection",
      [integer(PAGE + 1, PAGE * 3 + 17), marker],
      ([count, body]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const expected = yield* Effect.scoped(
              Effect.gen(function* () {
                const sql = yield* open;
                const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
                return yield* seed(lineFor)(ledger, count, body);
              }),
            );
            // The first connection has closed. This layer reads the same file through a fresh handle.
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            const nemesis = yield* service(Ledger)(ledger, () => Effect.die("check must never fire"));
            const report = yield* readReport(nemesis);
            expect(report).toMatchObject({
              stream: inbox(target.name),
              ...expected,
              processStream: `processes/${target.name}`,
              letters: count,
              doubled: 0,
              gaps: 0,
            });
            expect(report.restarts).toContainEqual(
              expect.objectContaining({
                ref: "restart-1",
                rev: expected.processBoundary,
                name: target.name,
                after: process,
                process: successor,
              }),
            );
            noLeak(report, body);
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "each read stops at its captured head while later writes continue",
      [integer(PAGE + 1, PAGE * 2 + 7), integer(1, 8)],
      ([count, tails]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            const expected = yield* seed(lineFor)(ledger, count, "body");
            // Each real wait captures a head, then appends a tail before the reader can consume a page.
            const concurrent: Reader = {
              ...ledger,
              wait: (stream, after) =>
                Effect.gen(function* () {
                  expect(after, "capture uses the nonblocking wait from zero").toBe(0);
                  const captured = yield* ledger.wait(stream, after);

                  for (let i = 0; i < tails; i++) {
                    yield* append(
                      ledger,
                      stream,
                      `tail-${i}`,
                      stream === inbox(target.name)
                        ? letterLine(from, { late: i })
                        : lineFor(
                            from,
                            ProcessEvent.cases.restarted.make({
                              name: target.name,
                              after: process,
                              process: successor,
                              reason: "late",
                              build: "test",
                            }),
                          ),
                    );
                  }

                  return captured;
                }),
            };
            const nemesis = yield* service(Ledger)(concurrent, () => Effect.die("check must never fire"));
            const report = yield* readReport(nemesis);
            expect(report).toMatchObject({ ...expected, letters: count, doubled: 0, gaps: 0 });
            expect(report.restarts.map((row) => row.ref)).toEqual(["restart-1"]);
            expect(yield* head(ledger, inbox(target.name))).toBeGreaterThan(expected.boundary);
            expect(yield* head(ledger, `processes/${target.name}`)).toBeGreaterThan(expected.processBoundary);
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "parked heads are empty snapshots even when a write follows the capture",
      [ordinal],
      ([n]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            const concurrent: Reader = {
              ...ledger,
              wait: (stream, after) =>
                Effect.gen(function* () {
                  const captured = yield* ledger.wait(stream, after);
                  expect(captured._tag).toBe("parked");
                  yield* append(ledger, stream, `late-${n}`, letterLine(from, { n }));
                  return captured;
                }),
            };
            const nemesis = yield* service(Ledger)(concurrent, () => Effect.die("check must never fire"));
            expect(yield* readReport(nemesis)).toMatchObject({
              boundary: 0,
              processBoundary: 0,
              letters: 0,
              doubled: 0,
              gaps: 0,
              restarts: [],
            });
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "a corrupt known send or invalid position on any page fails the whole check",
      [
        Arbitrary.all({
          count: integer(PAGE + 1, PAGE * 2 + 7),
          pick: integer(0, 1000000),
          damage: Arbitrary.schema(Schema.Literals(["json", "body", "zero", "negative", "fraction"])),
        }),
      ],
      ([{ count, pick, damage }]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            yield* seed(lineFor)(ledger, count, "body");
            // Schema/SQL corruption is injected below the reader, never implemented by a fake checker.
            const key = `letter-${pick % count}`;

            corrupt(sql, key, damage);
            const nemesis = yield* service(Ledger)(ledger, () => Effect.die("check must never fire"));
            yield* failed(nemesis.check(target), "BadRow");
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "wait and partial read failures translate lower errors without losing their causes",
      [
        Arbitrary.schema(Schema.Literals(["unreachable", "bad_row", "storage"])),
        Arbitrary.schema(Schema.Literals(["inbox-wait", "process-wait", "inbox-read", "process-read"])),
        marker,
      ],
      ([reason, part, secret]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            yield* seed(lineFor)(ledger, 3, "body");
            const lower = error(reason, new Error(secret));
            const affected = part.startsWith("inbox") ? inbox(target.name) : `processes/${target.name}`;
            const broken: Reader = {
              ...ledger,
              wait: (stream, after) =>
                stream === affected && part.endsWith("wait") ? Effect.fail(lower) : ledger.wait(stream, after),
              read: (stream, after) =>
                stream === affected && part.endsWith("read")
                  ? ledger.read(stream, after).pipe(Stream.take(1), Stream.concat(Stream.fail(lower)))
                  : ledger.read(stream, after),
            };
            const nemesis = yield* service(Ledger)(broken, () => Effect.die("check must never fire"));
            const translated = yield* failed(
              nemesis.check(target),
              reason === "unreachable" ? "Unreachable" : reason === "bad_row" ? "BadRow" : "Storage",
            );
            expect(translated.reason.cause).toBe(lower);
          }),
        ),
      { arbitrary },
    );

    it.effect.prop(
      "[secrets] reports, fire/refusal outputs, stored job spans and health omit private content",
      [marker, marker, fire, fired, Arbitrary.schema(Schema.Boolean)],
      ([body, errorText, fault, outcome, refuse]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const ledger = Context.get(yield* Layer.build(ledgerLayer(sql)), Ledger);
            yield* seed(lineFor)(ledger, 3, body);
            const telemetry = yield* Layer.build(SpanSink.layer(sql, { object: "chaos-test" }));
            const sink = Context.get(telemetry, SpanSink);
            const tracer = Context.get(telemetry, Tracer.Tracer);
            const live = yield* service(Ledger)(ledger, () =>
              refuse
                ? Effect.fail(new NemesisError({ reason: new BadTarget({ cause: new Error(errorText) }) }))
                : Effect.succeed(outcome),
            );
            const off = Context.get(yield* Layer.build(NemesisNone.layer), Nemesis);
            const outputs = yield* Effect.gen(function* () {
              const report = yield* readReport(live);
              const answer = yield* Effect.result(live.fire(request(fault, 1)));
              const offFire = yield* failed(off.fire(request(fault, 2)), "Off");
              const offCheck = yield* failed(off.check(target), "Off");
              return { report, answer, offFire, offCheck };
            }).pipe(Effect.withSpan("chaos.test", { attributes: { [PROCESS]: process } }), Effect.withTracer(tracer));
            // The operation spans have ended before flush. These are stored JobRecord rows, not a spy.
            const records = RecordManager.sql(() => sql, 1024 ** 3);
            yield* sink.flush.pipe(Effect.provide(Layer.merge(records, Archive.memory)));
            const rows = yield* RecordManager.use((manager) =>
              Stream.runCollect(manager.read(Chain.cases.job.make({ process }))),
            ).pipe(Effect.provide(records));
            const own = rows.filter((row) => /nemesis/i.test(row.name));
            expect(own.filter((row) => /fire/i.test(row.name)).length).toBeGreaterThanOrEqual(2);
            expect(own.filter((row) => /check/i.test(row.name)).length).toBeGreaterThanOrEqual(2);
            const health = sql
              .exec("SELECT * FROM measurements")
              .filter((row) => typeof row["piece"] === "string" && /nemesis/i.test(row["piece"]));
            expect(health.length).toBeGreaterThanOrEqual(4);

            // Each named output is visited separately; an empty list cannot stand in for stored spans.
            // Failed fire keeps its private cause in memory; it produces no public outcome.
            // Its real stored span and health row are inspected below, including the failure branch.
            const returned = outputs.answer._tag === "Success" ? [outputs.answer.success] : [];

            for (const output of [outputs.report, ...returned, outputs.offFire, outputs.offCheck, own, health]) {
              noLeak(output, body);
              noLeak(output, errorText);
            }
          }),
        ),
      { arbitrary },
    );
  });
