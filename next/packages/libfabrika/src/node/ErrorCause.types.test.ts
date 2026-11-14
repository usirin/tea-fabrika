// T695, next/, C8. Every exported error that translates a failure takes a diagnostic `cause` of any
// value, and no service's error union widens to `unknown` because of it. The type half is checked by
// `pnpm typecheck`; the run half sees each field kept on a generated cause.
// Plants: remove the cause field from one class, or widen one service's error to `unknown`.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { Effect, Stream } from "effect";
import * as fc from "fast-check";
import { IdError } from "../Id.ts";
import type * as Id from "../Id.ts";
import type { Ledger } from "../ledger/Ledger.ts";
import { LedgerError } from "../ledger/Ledger.ts";
import { ProcessError } from "../processes/Process.ts";
import { BuildError, type decodeBuilt } from "../runtime/Built.ts";
import type { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramDown } from "../runtime/Program.ts";
import type { RecoveryStore } from "../runtime/RecoveryStore.ts";
import { RunnerError } from "../runtime/Runner.ts";
import type { SpanSink } from "../telemetry/Sink.ts";
import { SinkError } from "../telemetry/Trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const causes = fc.oneof(
  fc.anything(),
  fc.string().map((message) => new Error(message)),
  fc.record({ code: fc.string() }, { noNullPrototype: true }),
);

/** One value of each translating class, made with `cause`. Each line compiles only with the field. */
const made = (cause: unknown) => [
  new LedgerError({ reason: "bad_row", cause }),
  new IdError({ reason: "entropy", cause }),
  new BuildError({ reason: "table", cause }),
  new RunnerError({ reason: "bad_input", cause }),
  new ProcessError({ reason: "bad_text", cause }),
  new SinkError({ reason: "storage", held: 0, cause }),
  new ProgramDown({ reason: "load", cause }),
];

describe("T695, C8: error types accept a diagnostic cause", () => {
  it("type: each class's cause is optional and `unknown`, and service errors stay their own class", () => {
    expectTypeOf<LedgerError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<IdError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<BuildError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<RunnerError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ProcessError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<SinkError["cause"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ProgramDown["cause"]>().toEqualTypeOf<unknown>();

    // A refusal with no underlying failure still compiles without one.
    expectTypeOf(new LedgerError({ reason: "refused" })).toEqualTypeOf<LedgerError>();
    expectTypeOf(new RunnerError({ reason: "bad_client" })).toEqualTypeOf<RunnerError>();

    // The field never widens what a service may fail with.
    type Append = ReturnType<(typeof Ledger)["Service"]["append"]>;
    expectTypeOf<Effect.Error<Append>>().toEqualTypeOf<LedgerError>();
    expectTypeOf<Stream.Error<ReturnType<(typeof Ledger)["Service"]["read"]>>>().toEqualTypeOf<LedgerError>();
    expectTypeOf<Effect.Error<(typeof ProcessStore)["Service"]["load"]>>().toEqualTypeOf<LedgerError>();
    // Its own error since ticket 921 slice 1, read by tag: `runtime/Runtime.types.test.ts` holds the rest.
    type Load = Effect.Error<(typeof RecoveryStore)["Service"]["load"]>;
    expectTypeOf<Load["_tag"]>().toEqualTypeOf<"RecoveryStoreError">();
    expectTypeOf<Effect.Error<ReturnType<typeof decodeBuilt>>>().toEqualTypeOf<BuildError>();
    expectTypeOf<Effect.Error<ReturnType<(typeof SpanSink)["Service"]["summaries"]>>>().toEqualTypeOf<SinkError>();
    type Next = ReturnType<(typeof Id.Generator)["Service"]["next"]>;
    expectTypeOf<Effect.Error<Next>>().toEqualTypeOf<IdError>();
  });

  it("each translating class keeps a generated cause as given", async () => {
    await fc.assert(
      fc.property(causes, (cause) => {
        for (const error of made(cause)) {
          expect(Object.is(error.cause, cause), `${error._tag} keeps its cause`).toBe(true);
        }
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
