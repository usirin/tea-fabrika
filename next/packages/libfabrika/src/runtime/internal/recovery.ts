import { Schema } from "effect";
import { ExitReason } from "../../processes/ExitReason.ts";
import { From } from "../../processes/Mailbox.ts";
import { Start } from "../../processes/Process.ts";
import { ProcessId } from "../../ProcessId.ts";

/** @internal */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/** @internal */
export const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** @internal */
export const Text = Schema.NonEmptyString;
/** How many times one letter is tried before it moves to the dead letters: 1 to 32. */
/** @internal */
export const Deliveries = Count.check(Schema.isLessThanOrEqualTo(32));

/** @internal */
export const Policy = Schema.Struct({
  maxDeliveries: Deliveries,
  intensity: Count,
  periodMs: Count,
  backoff: Schema.Struct({ minMs: Count, maxMs: Count, resetAfterMs: Count }),
}).check(
  Schema.makeFilter((p) => {
    if (p.intensity < p.maxDeliveries || p.backoff.minMs > p.backoff.maxMs) {
      return "invalid restart policy";
    }

    // The first intensity waits must fit in one window, or the brake cannot trip.
    let total = 0;
    let wait = p.backoff.minMs;

    for (let n = 0; n < p.intensity; n++) {
      total += wait;

      if (total >= p.periodMs) {
        return "restart waits exceed the window";
      }

      wait = Math.min(wait * 2, p.backoff.maxMs);
    }

    return true;
  }),
);
/** @internal */
export type Policy = typeof Policy.Type;

// The saved journal's shape. It sits here, beside its data, because RecoveryStore (coordination)
// validates every save and may not import the machine in `supervisor.ts`, which owns its Msgs and
// transitions.

/** @internal */
export const AttemptFields = { process: ProcessId, letter: Text, build: Text, seq: Count };

/** @internal */
export const Failure = Schema.TaggedUnion({
  fresh: { ...AttemptFields, error: Text },
  saved: { ...AttemptFields, error: Text },
  interrupted: AttemptFields,
});
/** @internal */
export type Failure = typeof Failure.Type;

/** @internal */
export const Observation = Schema.Struct({
  seq: Count,
  process: ProcessId,
  letter: Text,
  phase: Schema.Literals(["fresh", "saved", "interrupted"]),
  error: Schema.optionalKey(Text),
  at: Millis,
});

/** @internal */
export const Receipt = Schema.Struct({
  letter: Text,
  input: Schema.Json,
  digest: Schema.optionalKey(Text),
  errors: Schema.Array(Text),
  tries: Millis,
  result: Schema.NullOr(Schema.TaggedStruct("refused", { reason: Schema.Literal("dead") })),
  process: ProcessId,
}).check(
  Schema.makeFilter((r) =>
    r.input !== null || (r.digest !== undefined && r.tries === 0 && r.result === null)
      ? true
      : "a failed delivery keeps its input; an accepted delivery keeps its digest",
  ),
);

/** @internal */
export const Attempt = Schema.Struct({ ...AttemptFields, phase: Schema.Literals(["fresh", "saved"]), at: Millis });
const RestartRequest = Schema.Struct({ id: Text, build: Text });
const DownRecord = Schema.Struct({ process: ProcessId, reason: Text, crashes: Count, until: Millis });

/**
 * Why a process is being replaced: a captured crash, or a person's restart request.
 * @internal
 */
export const Origin = Schema.TaggedUnion({
  crash: { failure: Failure, reason: ExitReason },
  manual: { request: RestartRequest },
});
/** @internal */
export type Origin = typeof Origin.Type;

/** @internal */
export const StartTiming = Schema.TaggedUnion({ immediate: {}, scheduled: { until: Millis } });

/** @internal */
export const Journal = Schema.TaggedUnion({
  idle: { process: ProcessId },
  stepping: { attempt: Attempt },
  writing_dead: { failure: Failure.cases.fresh, reason: ExitReason, from: From },
  writing_exit: { process: ProcessId, origin: Origin, from: From },
  writing_down: { recovery: DownRecord, origin: Origin, from: From },
  waiting_recovery: { recovery: DownRecord, origin: Origin },
  waiting_start: { request: Start.cases.again, origin: Origin, timing: StartTiming, from: From },
  checkpointing: { after: ProcessId, process: ProcessId, origin: Origin },
});

/** @internal */
export const Supervision = Schema.Struct({
  v: Schema.Literal(2),
  name: Text,
  policy: Policy,
  seq: Millis,
  journal: Journal,
  build: Text,
  restarts: Schema.Array(Millis),
  observations: Schema.Array(Observation),
  receipts: Schema.Array(Receipt),
  /** The program's own delivery limit, from its declaration. It wins over the policy's. */
  maxDeliveries: Schema.optionalKey(Deliveries),
  crashes: Millis,
  healthyAt: Millis,
  /** Completed person restarts, so a repeated request completes once. */
  requests: Schema.Array(Schema.Struct({ id: Text, build: Text, process: ProcessId })),
}).check(
  Schema.makeFilter((s) => {
    const j = s.journal;

    // Dead work names its exact fresh failure, so its terminal receipt must be that letter's own.
    if (j._tag === "writing_dead") {
      return (
        s.receipts.some((r) => r.letter === j.failure.letter && r.process === j.failure.process && r.result !== null) ||
        "dead work keeps its terminal receipt"
      );
    }

    if (j._tag === "checkpointing" && j.after === j.process) {
      return "a checkpoint's successor is not its predecessor";
    }

    // The process this journal replaces, which a crash origin's failure must name.
    const replaced =
      j._tag === "writing_exit"
        ? j.process
        : j._tag === "writing_down" || j._tag === "waiting_recovery"
          ? j.recovery.process
          : j._tag === "waiting_start"
            ? j.request.after
            : j._tag === "checkpointing"
              ? j.after
              : null;

    if (replaced === null || !("origin" in j)) {
      return true;
    }

    if (j.origin._tag === "crash") {
      return j.origin.failure.process === replaced || "a crash origin names the process it replaces";
    }

    // A person's restart starts with its own saved request ID and build.
    return (
      j._tag !== "waiting_start" ||
      (j.request.id === j.origin.request.id && j.request.code.hash === j.origin.request.build) ||
      "a person's restart starts with its saved request"
    );
  }),
);
/** @internal */
export type Supervision = typeof Supervision.Type;
