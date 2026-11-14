// P39 slice 1, L9 (0095): `Jobs.ts` holds the contract, with its service type written out in the
// jobs module's own types and error, and its one layer is the sibling `JobsLedger.ts`, read through
// its module. No ledger name (`LedgerTurn`, `LedgerError`, `Line`) is part of the contract. tsc
// checks the uncalled function below.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Context, type Effect, type Layer, Schema, type Stream } from "effect";
import type { ProcessId } from "../ProcessId.ts";
import type { Executor, Job, Recorded, Request, Result } from "./Job.ts";
import type * as JobsFront from "./Jobs.ts";
import { Jobs, JobsError } from "./Jobs.ts";
import type * as JobsLedger from "./JobsLedger.ts";

type Receipt = { readonly rev: number; readonly arrivedAt: number };
type Taken = Receipt & { readonly execution: string };

const checkTypes = () => {
  // The five calls, as the contract writes them. A ledger type or error in any of them fails here.
  expectTypeOf<Context.Service.Shape<typeof Jobs>>().toEqualTypeOf<{
    readonly forProcess: (process: typeof ProcessId.Type) => Stream.Stream<Job, JobsError>;
    readonly request: (request: Request, recorded: Recorded) => Effect.Effect<JobsFront.Receipt, JobsError>;
    readonly take: (id: string, executor: Executor, recorded: Recorded) => Effect.Effect<JobsFront.Taken, JobsError>;
    readonly started: (
      id: string,
      execution: string,
      recorded: Recorded,
    ) => Effect.Effect<JobsFront.Receipt, JobsError>;
    readonly finish: (
      id: string,
      execution: string,
      result: Result,
      recorded: Recorded,
    ) => Effect.Effect<JobsFront.Receipt, JobsError>;
    readonly read: (id: string) => Effect.Effect<Job, JobsError>;
  }>();
  // A receipt is where the referee placed the event and when it arrived; a take adds its execution.
  expectTypeOf<JobsFront.Receipt>().toEqualTypeOf<Receipt>();
  expectTypeOf<JobsFront.Taken>().toEqualTypeOf<Taken>();
  // The layer serves Jobs and fails with nothing of its own while it is built.
  expectTypeOf<Layer.Success<typeof JobsLedger.layer>>().toEqualTypeOf<Jobs>();
  expectTypeOf<Layer.Error<typeof JobsLedger.layer>>().toEqualTypeOf<never>();
  // No static layer is left on the class, and the contract module exports no layer.
  expectTypeOf<"layer" extends keyof typeof Jobs ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof JobsFront ? true : false>().toEqualTypeOf<false>();
};

const REASONS = [
  "not_found",
  "conflict",
  "not_target",
  "lacks_capability",
  "wrong_execution",
  "wrong_state",
  "bad_input",
  "storage",
] as const;

it.prop(
  "L9: every JobsError reason is the jobs module's own, and the service class has no static layer",
  { reason: Schema.Literals(REASONS) },
  ({ reason }) => {
    expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
    expect(Object.hasOwn(Jobs, "layer")).toBe(false);
    const error = new JobsError({ reason });
    expect([error._tag, error.reason]).toEqual(["JobsError", reason]);
    // The error is a schema value of its own, so a refusal crosses a wire as the module wrote it.
    expect(Schema.decodeUnknownSync(JobsError)(Schema.encodeSync(JobsError)(error))).toMatchObject({ reason });
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
