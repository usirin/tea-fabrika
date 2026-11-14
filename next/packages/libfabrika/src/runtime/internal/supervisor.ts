// The runner's recovery journal, next/ (P34c slice 2): one saved tea machine. Its `journal` names the
// one unfinished job; the runner performs it and sends the completion Msg only after the write
// succeeds. Nothing here reads a clock, a store or a service (0037, 0046).
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { ExitReason } from "../../processes/ExitReason.ts";
import { From } from "../../processes/Mailbox.ts";
import { canRestart, Start } from "../../processes/Process.ts";
import { ProcessId } from "../../ProcessId.ts";
import { Checkpoint } from "../ProcessStore.ts";
import { AttemptFields, Count, Deliveries, Failure, Millis, Observation, Policy, Receipt, Text } from "./recovery.ts";
import { Reply } from "./reply.ts";

/** @internal */
export { Policy };

/** @internal */
export const defaultPolicy: Policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const Attempt = Schema.Struct({ ...AttemptFields, phase: Schema.Literals(["fresh", "saved"]), at: Millis });
const FreshAttempt = Schema.Struct({ ...Attempt.fields, phase: Schema.Literal("fresh") });
const RestartRequest = Schema.Struct({ id: Text, build: Text });
const DownRecord = Schema.Struct({ process: ProcessId, reason: Text, crashes: Count, until: Millis });

/** Why a process is being replaced: a captured crash, or a person's restart request. */
const Origin = Schema.TaggedUnion({
  crash: { failure: Failure, reason: ExitReason },
  manual: { request: RestartRequest },
});
type Origin = typeof Origin.Type;

const StartTiming = Schema.TaggedUnion({ immediate: {}, scheduled: { until: Millis } });

const CodeChange = Schema.Struct({
  process: ProcessId,
  load: Text,
  program: Text,
  was: Text,
  checkpoint: Checkpoint,
  from: Schema.Int,
  ran: Schema.Array(Text),
  origin: From,
  pos: Millis,
  view: Schema.Unknown,
  wake: Schema.NullOr(Millis),
  maxDeliveries: Schema.NullOr(Deliveries),
}).check(
  Schema.makeFilter(
    (change) =>
      (change.was !== change.checkpoint.saved.build &&
        change.from <= change.checkpoint.saved.v &&
        change.checkpoint.turn === null &&
        change.origin.build === change.checkpoint.saved.build) ||
      "a prepared swap keeps a new checkpoint and its build's origin",
  ),
);

const Journal = Schema.TaggedUnion({
  idle: { process: ProcessId },
  checking: { attempt: FreshAttempt },
  stepping: { attempt: Attempt },
  swapping: { change: CodeChange },
  writing_reply: { attempt: FreshAttempt, reply: Reply },
  clearing_attempt: { attempt: Attempt },
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

    if (j._tag === "swapping") {
      return s.build === j.change.was || "an unfinished swap keeps the previous build";
    }

    if (j._tag === "stepping" && j.attempt.phase === "fresh") {
      return (
        s.receipts.some((r) => r.letter === j.attempt.letter && r.input !== null) ||
        "fresh stepping keeps its admitted input"
      );
    }

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

const msg = <T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) =>
  Schema.Struct({ type: Schema.Literal(type), ...fields });

const Msg = Schema.Union([
  msg("swapped", { process: ProcessId, build: Text }),
  msg("swap_prepared", { change: CodeChange }),
  msg("swap_completed", { load: Text }),
  msg("received", { receipt: Receipt }),
  msg("compacted", { letter: Text, digest: Text }),
  msg("limited", { maxDeliveries: Schema.NullOr(Deliveries) }),
  msg("begin", { process: ProcessId, letter: Text, build: Text, phase: Attempt.fields.phase, at: Millis }),
  msg("admitted", { seq: Count, receipt: Receipt }),
  msg("refused", { seq: Count, reply: Reply }),
  msg("reply_written", { seq: Count }),
  msg("abandoned", { seq: Count }),
  msg("attempt_cleared", { seq: Count }),
  msg("check_threw", { seq: Count, receipt: Receipt, error: Text, reason: ExitReason, from: From }),
  msg("finished", { seq: Count }),
  msg("threw", { seq: Count, error: Text, reason: ExitReason, from: From }),
  msg("interrupted", { process: ProcessId, letter: Text, build: Text, reason: ExitReason, from: From, at: Millis }),
  msg("dead_written", { seq: Count }),
  msg("exit_written", { process: ProcessId, restarts: Schema.Array(Millis), at: Millis, program: Text }),
  msg("down_written", { process: ProcessId }),
  msg("due", { at: Millis, program: Text, from: From }),
  msg("started", { id: Text, process: ProcessId, at: Millis }),
  msg("checkpointed", { after: ProcessId, process: ProcessId, restarts: Schema.Array(Millis), at: Millis }),
  msg("adopted", { process: ProcessId, build: Text, restarts: Schema.Array(Millis) }),
  msg("restart_requested", {
    id: Text,
    build: Text,
    live: Schema.Boolean,
    process: ProcessId,
    program: Text,
    from: From,
  }),
  msg("healthy", { at: Millis }),
]);

/** @internal */
export type SupervisorMsg = typeof Msg.Type;

type Ctx = {
  readonly policy: Policy;
  readonly process: string;
  readonly name: string;
  readonly build: string;
  readonly at: number;
};

const DEAD = Schema.TaggedStruct("refused", { reason: Schema.Literal("dead") }).make({ reason: "dead" });

const unchanged = (s: Supervision) => [s, []] as const;

const crashReason = (failure: Failure) =>
  failure._tag === "saved" ? "saved_letter" : failure._tag === "fresh" ? "step" : "interrupted";

/** The successor's start request, after the process that ended. */
const again = (s: Supervision, id: string, after: string, reason: string, code: { program: string; hash: string }) =>
  Start.cases.again.make({ id, name: s.name, after, reason, code });

/** A captured crash's exit, still to write. */
const exiting = (failure: Failure, reason: ExitReason, from: From) =>
  Journal.cases.writing_exit.make({
    process: failure.process,
    origin: Origin.cases.crash.make({ failure, reason }),
    from,
  });

/** One captured failure: its observation and its crash, counted once. */
const observe = (
  s: Supervision,
  failure: Failure,
  seen: typeof Observation.Type,
  journal: Supervision["journal"],
): Supervision => ({
  ...s,
  seq: Math.max(s.seq, failure.seq),
  crashes: s.crashes + 1,
  observations: [...s.observations, seen],
  journal,
});

/** The process a waiting recovery replaces, which a live successor may be adopted for. */
const waitingFor = (j: Supervision["journal"]): { after: string; origin: Origin } | null =>
  j._tag === "waiting_recovery" || j._tag === "writing_down"
    ? { after: j.recovery.process, origin: j.origin }
    : j._tag === "waiting_start" && j.timing._tag === "scheduled"
      ? { after: j.request.after, origin: j.origin }
      : null;

/** Check and update failures share one observation and delivery charge. */
const failed = (
  s: Supervision,
  attempt: typeof Attempt.Type,
  error: string,
  reason: ExitReason,
  from: From,
): ReturnType<typeof unchanged> => {
  const { phase, at, ...fields } = attempt;
  const failure = (phase === "fresh" ? Failure.cases.fresh : Failure.cases.saved).make({
    ...fields,
    error,
  });
  const seen = { seq: attempt.seq, process: fields.process, letter: fields.letter, phase, error, at };

  if (failure._tag !== "fresh") {
    return [observe(s, failure, seen, exiting(failure, reason, from)), []];
  }

  const old = s.receipts.find((r) => r.letter === failure.letter);

  if (old === undefined) {
    return unchanged(s);
  }

  // Observation and the fresh delivery's charge change together, in one saved step.
  const errors = [...old.errors, error];
  const terminal = errors.length >= (s.maxDeliveries ?? s.policy.maxDeliveries);
  const receipt = {
    ...old,
    errors,
    tries: errors.length,
    process: failure.process,
    result: terminal ? DEAD : null,
  };
  const journal = terminal
    ? Journal.cases.writing_dead.make({ failure, reason, from })
    : exiting(failure, reason, from);
  return [
    {
      ...observe(s, failure, seen, journal),
      receipts: s.receipts.map((r) => (r.letter === failure.letter ? receipt : r)),
    },
    [],
  ];
};

/** @internal */
export const supervisor = Machine.make({
  model: Supervision,
  msg: Msg,
  cmds: [],
  types: { ctx: {} as Ctx },
  init: (saved, ctx) => [
    saved ??
      Supervision.make({
        v: 2,
        name: ctx.name,
        policy: Schema.decodeUnknownSync(Policy)(ctx.policy),
        seq: 0,
        journal: Journal.cases.idle.make({ process: ctx.process }),
        build: ctx.build,
        restarts: [],
        observations: [],
        receipts: [],
        crashes: 0,
        healthyAt: ctx.at,
        requests: [],
      }),
    [],
  ],
  update: {
    swap_prepared: (s, m) =>
      s.journal._tag === "idle" && s.journal.process === m.change.process && s.build === m.change.was
        ? [{ ...s, journal: Journal.cases.swapping.make({ change: m.change }) }, []]
        : unchanged(s),
    swap_completed: (s, m) => {
      if (s.journal._tag !== "swapping" || s.journal.change.load !== m.load) {
        return unchanged(s);
      }

      const { change } = s.journal;
      const { maxDeliveries: _limit, ...kept } = s;
      return [
        {
          ...kept,
          build: change.checkpoint.saved.build,
          journal: Journal.cases.idle.make({ process: change.process }),
          ...(change.maxDeliveries === null ? {} : { maxDeliveries: change.maxDeliveries }),
        },
        [],
      ];
    },
    swapped: (s, m) =>
      s.journal._tag === "idle" && s.journal.process === m.process ? [{ ...s, build: m.build }, []] : unchanged(s),
    received: (s, m) =>
      s.receipts.some((r) => r.letter === m.receipt.letter)
        ? unchanged(s)
        : [{ ...s, receipts: [...s.receipts, m.receipt] }, []],
    compacted: (s, m) =>
      s.receipts.some((r) => r.letter === m.letter && r.tries === 0 && r.input !== null)
        ? [
            {
              ...s,
              receipts: s.receipts.map((r) =>
                r.letter === m.letter && r.tries === 0 ? { ...r, input: null, digest: m.digest } : r,
              ),
            },
            [],
          ]
        : unchanged(s),
    limited: (s, m) => {
      if ((s.maxDeliveries ?? null) === m.maxDeliveries) {
        return unchanged(s);
      }

      const { maxDeliveries: _old, ...rest } = s;
      return [m.maxDeliveries === null ? rest : { ...rest, maxDeliveries: m.maxDeliveries }, []];
    },
    begin: (s, m) => {
      if (s.journal._tag !== "idle" || s.journal.process !== m.process) {
        return unchanged(s);
      }

      const { type: _type, ...fields } = m;
      const attempt = { ...fields, seq: s.seq + 1 };
      const journal =
        m.phase === "fresh"
          ? Journal.cases.checking.make({ attempt: FreshAttempt.make({ ...attempt, phase: "fresh" }) })
          : Journal.cases.stepping.make({ attempt });
      return [{ ...s, seq: attempt.seq, journal }, []];
    },
    admitted: (s, m) => {
      const j = s.journal;

      if (
        j._tag !== "checking" ||
        j.attempt.seq !== m.seq ||
        j.attempt.letter !== m.receipt.letter ||
        m.receipt.input === null
      ) {
        return unchanged(s);
      }

      const receipts = s.receipts.some((r) => r.letter === m.receipt.letter) ? s.receipts : [...s.receipts, m.receipt];
      return [{ ...s, receipts, journal: Journal.cases.stepping.make({ attempt: j.attempt }) }, []];
    },
    refused: (s, m) => {
      const j = s.journal;
      return j._tag === "checking" &&
        j.attempt.seq === m.seq &&
        m.reply.id === j.attempt.letter &&
        m.reply.name === s.name
        ? [{ ...s, journal: Journal.cases.writing_reply.make({ attempt: j.attempt, reply: m.reply }) }, []]
        : unchanged(s);
    },
    reply_written: (s, m) =>
      s.journal._tag === "writing_reply" && s.journal.attempt.seq === m.seq
        ? [{ ...s, journal: Journal.cases.idle.make({ process: s.journal.attempt.process }) }, []]
        : unchanged(s),
    abandoned: (s, m) => {
      const j = s.journal;
      return (j._tag === "checking" || j._tag === "stepping") && j.attempt.seq === m.seq
        ? [{ ...s, journal: Journal.cases.clearing_attempt.make({ attempt: j.attempt }) }, []]
        : unchanged(s);
    },
    attempt_cleared: (s, m) =>
      s.journal._tag === "clearing_attempt" && s.journal.attempt.seq === m.seq
        ? [{ ...s, journal: Journal.cases.idle.make({ process: s.journal.attempt.process }) }, []]
        : unchanged(s),
    check_threw: (s, m) => {
      const j = s.journal;

      if (
        j._tag !== "checking" ||
        j.attempt.seq !== m.seq ||
        m.receipt.letter !== j.attempt.letter ||
        m.receipt.input === null
      ) {
        return unchanged(s);
      }

      const receipts = s.receipts.some((r) => r.letter === m.receipt.letter) ? s.receipts : [...s.receipts, m.receipt];
      return failed({ ...s, receipts }, j.attempt, m.error, m.reason, m.from);
    },
    finished: (s, m) =>
      s.journal._tag === "stepping" && s.journal.attempt.seq === m.seq
        ? [{ ...s, journal: Journal.cases.idle.make({ process: s.journal.attempt.process }) }, []]
        : unchanged(s),
    threw: (s, m) => {
      if (s.journal._tag !== "stepping" || s.journal.attempt.seq !== m.seq) {
        return unchanged(s);
      }

      return failed(s, s.journal.attempt, m.error, m.reason, m.from);
    },
    interrupted: (s, m) => {
      const j = s.journal;
      // The saved attempt's identity wins; an activity marker alone gets the next sequence.
      const attempt =
        (j._tag === "stepping" || j._tag === "checking") && j.attempt.process === m.process
          ? j.attempt
          : j._tag === "idle" && j.process === m.process
            ? { process: m.process, letter: m.letter, build: m.build, seq: s.seq + 1, at: m.at }
            : null;

      if (attempt === null) {
        return unchanged(s);
      }

      const { process, letter, build, seq } = attempt;
      const failure = Failure.cases.interrupted.make({ process, letter, build, seq });
      const seen = { seq, process, letter, phase: "interrupted" as const, at: attempt.at };
      return [observe(s, failure, seen, exiting(failure, m.reason, m.from)), []];
    },
    dead_written: (s, m) =>
      s.journal._tag === "writing_dead" && s.journal.failure.seq === m.seq
        ? [{ ...s, journal: exiting(s.journal.failure, s.journal.reason, s.journal.from) }, []]
        : unchanged(s),
    exit_written: (s, m) => {
      const j = s.journal;

      if (j._tag !== "writing_exit" || j.process !== m.process) {
        return unchanged(s);
      }

      const { origin, from } = j;

      // A person's restart starts its successor at once, on the build it asked for.
      if (origin._tag === "manual") {
        const { id, build } = origin.request;
        const request = again(s, id, m.process, "restart", { program: m.program, hash: build });
        const timing = StartTiming.cases.immediate.make({});
        return [
          { ...s, restarts: m.restarts, journal: Journal.cases.waiting_start.make({ request, origin, timing, from }) },
          [],
        ];
      }

      const crashes = Math.max(s.crashes, 1);
      const wait = Math.min(s.policy.backoff.minMs * 2 ** Math.min(crashes - 1, 53), s.policy.backoff.maxMs);
      const until = m.at + wait;
      const reason = crashReason(origin.failure);

      // Inside the restart budget the successor waits its backoff, and nothing goes down.
      if (canRestart(m.restarts, until, s.policy.periodMs, s.policy.intensity)) {
        const request = again(s, `recover:${m.process}:${s.seq}`, m.process, reason, {
          program: m.program,
          hash: s.build,
        });
        const timing = StartTiming.cases.scheduled.make({ until });
        return [
          { ...s, restarts: m.restarts, journal: Journal.cases.waiting_start.make({ request, origin, timing, from }) },
          [],
        ];
      }

      // The brake: N crashes in T. Down waits until the window has room again.
      const times = m.restarts.filter((at) => at >= until - s.policy.periodMs).toSorted((a, b) => a - b);
      const edge = times[times.length - s.policy.intensity];
      const held = edge === undefined ? until : Math.max(until, edge + s.policy.periodMs + 1);
      const recovery = { process: m.process, reason, crashes, until: held };
      return [{ ...s, restarts: m.restarts, journal: Journal.cases.writing_down.make({ recovery, origin, from }) }, []];
    },
    down_written: (s, m) =>
      s.journal._tag === "writing_down" && s.journal.recovery.process === m.process
        ? [
            {
              ...s,
              journal: Journal.cases.waiting_recovery.make({ recovery: s.journal.recovery, origin: s.journal.origin }),
            },
            [],
          ]
        : unchanged(s),
    due: (s, m) => {
      const j = s.journal;

      if (j._tag !== "waiting_recovery" || m.at < j.recovery.until) {
        return unchanged(s);
      }

      const { process, reason, until } = j.recovery;
      const request = again(s, `recover:${process}:${s.seq}`, process, reason, { program: m.program, hash: s.build });
      const timing = StartTiming.cases.scheduled.make({ until });
      return [
        { ...s, journal: Journal.cases.waiting_start.make({ request, origin: j.origin, timing, from: m.from }) },
        [],
      ];
    },
    started: (s, m) => {
      const j = s.journal;

      if (
        j._tag !== "waiting_start" ||
        j.request.id !== m.id ||
        (j.timing._tag === "scheduled" && m.at < j.timing.until)
      ) {
        return unchanged(s);
      }

      return [
        {
          ...s,
          journal: Journal.cases.checkpointing.make({ after: j.request.after, process: m.process, origin: j.origin }),
        },
        [],
      ];
    },
    checkpointed: (s, m) => {
      const j = s.journal;

      if (j._tag !== "checkpointing" || j.after !== m.after || j.process !== m.process) {
        return unchanged(s);
      }

      // A person's request is completed with the restart history that records its successor.
      const manual = j.origin._tag === "manual" ? j.origin.request : null;
      return [
        {
          ...s,
          journal: Journal.cases.idle.make({ process: m.process }),
          build: manual?.build ?? s.build,
          restarts: m.restarts,
          healthyAt: m.at,
          requests: manual === null ? s.requests : [...s.requests, { ...manual, process: m.process }],
        },
        [],
      ];
    },
    adopted: (s, m) => {
      const waiting = waitingFor(s.journal);

      if (waiting === null || waiting.after === m.process) {
        return unchanged(s);
      }

      const journal = Journal.cases.checkpointing.make({ ...waiting, process: m.process });
      return [{ ...s, journal, build: m.build, restarts: m.restarts }, []];
    },
    restart_requested: (s, m) => {
      const j = s.journal;
      const settled = j._tag === "idle" || (waitingFor(j) !== null && j._tag !== "writing_down");

      if (!settled || s.requests.some((r) => r.id === m.id)) {
        return unchanged(s);
      }

      const origin = Origin.cases.manual.make({ request: { id: m.id, build: m.build } });
      const journal = m.live
        ? Journal.cases.writing_exit.make({ process: m.process, origin, from: m.from })
        : Journal.cases.waiting_start.make({
            request: again(s, m.id, m.process, "restart", { program: m.program, hash: m.build }),
            origin,
            timing: StartTiming.cases.immediate.make({}),
            from: m.from,
          });
      return [{ ...s, journal }, []];
    },
    healthy: (s, m) =>
      s.journal._tag === "idle" && m.at - s.healthyAt >= s.policy.backoff.resetAfterMs
        ? [{ ...s, crashes: 0, healthyAt: m.at }, []]
        : unchanged(s),
  },
});
