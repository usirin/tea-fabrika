/**
 * The program runner: one process's turns. Under one permit a turn catches the process up on its
 * inbox, finds a resend, steps the fresh input purely, saves that it is about to append, appends
 * through the gateway's checked writer, folds what landed and installs it. Only then do its Cmds
 * run, each saved as dispatched first, each answer saved as a letter before the program sees it. A
 * wake folds saved letters and runs none of their Cmds.
 *
 * @stability unstable
 */
import { applyCell, type Outcome } from "@demlik/tea";
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
  Stream,
  Tracer,
} from "effect";
import { type SessionManagerError } from "../access/SessionManager.ts";
import {
  Activity,
  DeadInput,
  Down,
  type Appended,
  brainOnly,
  type From,
  type History,
  inNoticeSpace,
  inRunnerSpace,
  inSignalSpace,
  LedgerError,
  Mailbox,
  MemberEvent,
  NotGranted,
  ParentText,
  type Placed,
  ProcessEvent,
  ProcessStore,
  ProcessManager,
  type ProcessError,
  Recipient,
  RuntimeRecord,
  RunnerMail,
  SessionManager,
  sha256,
  SigningRefused,
  SignRequest,
  type SinkError,
  type Sql,
  type Writer,
} from "../coordination/index.ts";
import { InputId } from "../Id.ts";
import { Children, INPUT_BYTES, Started } from "../processes/Children.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { ProcessName } from "../processes/Process.ts";
import { MailRefusal } from "../processes/ProgramMail.ts";
import * as Chaos from "./Chaos.ts";
import type { WatcherManager } from "./Entry.ts";
import {
  Alarm,
  CheckedWriter,
  type Event,
  Incoming,
  type Loaded,
  ProgramLoader,
  Recording,
  type View,
} from "./Entry.ts";
import { fromFailure } from "./internal/exitReason.ts";
import { Failure, Policy, type Receipt } from "./internal/recovery.ts";
import { defaultPolicy, supervisor, Supervision, type SupervisorMsg } from "./internal/supervisor.ts";
import { MailDelivery } from "./MailDelivery.ts";
import { diff } from "./Patch.ts";
import { Admission, ProgramDown, Refusal, Step, Write } from "./Program.ts";
import { recoveryStore, RecoveryStoreError } from "./RecoveryStore.ts";
import { Replies, type RepliesError } from "./Replies.ts";
import * as RepliesSql from "./RepliesSql.ts";
import { Queued, SendInput } from "./Send.ts";
import { ExitInput, StartChildInput } from "./StartChild.ts";
import { StepFault } from "./StepFault.ts";
import type { WatchersError } from "./Watchers.ts";
import { Watchers } from "./Watchers.ts";
import * as WatchersSql from "./WatchersSql.ts";

export {
  /**
   * The restart policy a new recovery journal gets when neither the program's declaration nor the
   * runner's wiring gives one, and the delivery limit when the wiring's policy leaves it out: 3
   * deliveries of one letter, a restart intensity of 5 over a 5000 ms period, and a backoff from 100
   * ms to 800 ms that resets after 5000 ms.
   *
   * @stability unstable
   * @category models
   */
  defaultPolicy,
  /**
   * Schema for the saved supervision state the runner keeps for one process: its name, restart
   * policy, build, recent restarts and the journal of the one unfinished recovery job.
   *
   * @stability unstable
   * @category schemas
   */
  Supervision,
} from "./internal/supervisor.ts";

/**
 * Schema for what `msg` answers: the input's placing in the inbox (`accepted`), or why it was not
 * taken (`refused`).
 *
 * @stability unstable
 * @category schemas
 */
export const Sent = Schema.TaggedUnion({
  accepted: { rev: Schema.Int, pos: Schema.Int },
  refused: Refusal.fields,
});
/**
 * What `msg` answers, as `Sent` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Sent = typeof Sent.Type;

/**
 * What `open` answers: the inbox position the view was made at, and the view.
 *
 * @stability unstable
 * @category models
 */
export type Opened = { readonly rev: number; readonly view: View };

/**
 * The process a runner steps: its id, its registered name (its inbox), its program, the build of
 * the code stepping it, and its checked owner, the writer of its own writes.
 *
 * @stability unstable
 * @category models
 */
export type Descriptor = {
  readonly id: string;
  readonly name: string;
  readonly program: string;
  readonly build: string;
  readonly owner: Writer;
};

/** A Cmd the runner has saved as dispatched and not yet seen answered. Its id is stable: the
 *  process, the inbox position of the letter whose step made it, and its index there. */
const Dispatched = Schema.Struct({
  id: Schema.NonEmptyString,
  cmd: Schema.Json,
  state: Schema.Literal("dispatched"),
  parent: Schema.NullOr(ParentText),
  traceId: Schema.String,
  build: Schema.String,
  /** A host Cmd this life owes until it is answered, kept under its first name from when only Send
   *  was one; a replayed letter's was the life before's. */
  mail: Schema.optionalKey(Schema.Literal(true)),
  /** A start_child or exit whose operands can never fit a row, saved without them so its row
   *  fits: the one refusal it can get, after the loader for a program it kept. */
  oversize: Schema.optionalKey(Schema.Literals(["bad_cmd", "no_program", "bad_name", "bad_input"])),
});
type Dispatched = typeof Dispatched.Type;
const decodeDispatched = Schema.decodeUnknownResult(Schema.Array(Dispatched));

/** The turn a crash may cut: an input stepped and about to be appended. */
const Turn = Schema.TaggedUnion({ prepared: { id: Schema.NonEmptyString } });

/** The runtime's own events and lifecycle events a program may never write, even if declared. */
const RESERVED = new Set([
  ...Object.keys(ProcessEvent.cases),
  ...Object.keys(MemberEvent.cases),
  ...Object.keys(RuntimeRecord.cases),
]);

/** The Cmd the runner itself performs: a checked write, signed for its parent or the owner. */
const WRITE = "write";
const WriteCmd = Schema.Struct({ stream: Schema.NonEmptyString, write: Write });
const decodeWriteCmd = Schema.decodeUnknownResult(WriteCmd);

/** The Cmd the runner mails itself, as the sender the host bound. */
const SEND = "send";
const decodeSendInput = Schema.decodeUnknownResult(SendInput);
const isRefusal = Schema.is(MailRefusal);

/** The Cmds a program asks its supervisor for: a child by name, and the end of its own life. */
const START_CHILD = "start_child";
const EXIT = "exit";

/** The Cmds the runner performs as the host: each is owed by this life until it is answered. */
const HOST = new Set([SEND, START_CHILD, EXIT]);

/**
 * A Cmd's operands, without the `type` its maker adds, when its input schema names every one. The
 * names are checked before the strict decode, since an empty struct takes any field.
 */
const operands = (cmd: unknown, fields: object): Option.Option<Record<string, unknown>> => {
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd)) {
    return Option.none();
  }

  const { type: _type, ...rest } = cmd as Record<string, unknown>;
  return Object.keys(rest).every((key) => Object.hasOwn(fields, key)) ? Option.some(rest) : Option.none();
};

const strictStartChild = Schema.decodeUnknownOption(StartChildInput, { onExcessProperty: "error" });
const strictExit = Schema.decodeUnknownOption(ExitInput, { onExcessProperty: "error" });
const decodeStartChild = (cmd: unknown) => Option.flatMap(operands(cmd, StartChildInput.fields), strictStartChild);
const decodeExit = (cmd: unknown) => Option.flatMap(operands(cmd, ExitInput.fields), strictExit);
const isName = Schema.is(ProcessName);
const encoder = new TextEncoder();

/** A start_child's operands without its input: what every `ok` answer echoes, so no row holds the
 *  first letter twice. */
const withoutInput = (cmd: unknown): unknown => {
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd) || !Object.hasOwn(cmd, "input")) {
    return cmd;
  }

  const { input: _input, ...rest } = cmd as Record<string, unknown>;
  return rest;
};

const fitsText = (value: string): boolean => value.length <= 256;
const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value) ?? "").length;
const decodeKept = Schema.decodeUnknownOption(Schema.Struct({ program: Schema.String }));

/** Keeps oversized invalid operands out of the checkpoint and answer. A valid first letter stays
 *  whole in the split checkpoint and reaches the ledger's row check. Refusals keep a start's own
 *  order: `no_program`, then `bad_name`, then `bad_input`. */
const oversized = (cmd: unknown): Option.Option<Pick<Dispatched, "cmd" | "oversize">> => {
  const type = Option.getOrUndefined(Option.map(decodeTyped(cmd), (c) => c.type));

  if ((type !== START_CHILD && type !== EXIT) || bytes(cmd) <= INPUT_BYTES) {
    return Option.none();
  }

  const input = type === START_CHILD ? decodeStartChild(cmd) : Option.none();

  if (Option.isNone(input)) {
    return Option.some({ cmd: { type }, oversize: "bad_cmd" });
  }

  const { program, name } = input.value;

  // Checkpoint rows can split. The ledger judges the first letter, not the whole Cmd.
  if (fitsText(program) && fitsText(name) && bytes(input.value.input) <= INPUT_BYTES) {
    return Option.none();
  }

  const kept = { type, ...(fitsText(program) ? { program } : {}), ...(fitsText(name) ? { name } : {}) };
  return Option.some({
    cmd: kept,
    oversize: !fitsText(program) ? "no_program" : fitsText(name) && isName(name) ? "bad_input" : "bad_name",
  });
};

/** Pending deliveries keep their original parent, including one saved before input TypeIDs. */
const Delivery = Schema.Struct({
  ...Incoming.fields,
  envelope: Schema.Struct({ ...Incoming.fields.envelope.fields, id: ParentText }),
});
type Delivery = typeof Delivery.Type;
const decodeDelivery = Schema.decodeUnknownEffect(Delivery);
const Typed = Schema.Struct({ type: Schema.String });
const decodeTyped = Schema.decodeUnknownOption(Typed);
const decodeDown = Schema.decodeUnknownOption(Down);

const inputDigest = Effect.fnUntraced(function* (input: Delivery) {
  return yield* sha256(
    new TextEncoder().encode(JSON.stringify([input.envelope.by, input.envelope.input, input.sentAt, input.seen])),
  );
});

const PROCESS = "fab.process";
const tag = (word: string): string => `fab.runner.${word}`;

/** What a process holds between turns. */
type Live = {
  readonly loaded: Omit<Loaded, "stepper">;
  readonly model: unknown;
  readonly view: unknown;
  readonly wake: number | null;
  readonly v: number;
  /** The last inbox rev folded, and that letter's inbox position. */
  readonly after: number;
  readonly pos: number;
  readonly cmds: ReadonlyArray<Dispatched>;
};

/** A failed Cmd's settled Msg error: its case is its reason. */
const failure = (reason: string) => Schema.TaggedStruct(reason, {}).make({});

/**
 * What the wiring gives a runner beside its services: the restart policy, where recovery is kept,
 * and a hook that cuts a recovery short.
 *
 * @stability unstable
 * @category models
 */
export type RunnerOptions = {
  /** The trusted wiring's policy. Without `maxDeliveries`, a letter is tried 3 times. */
  readonly policy?: Omit<Policy, "maxDeliveries"> & { readonly maxDeliveries?: number };
  /**
   * The object's SQL for the recovery journal, the terminal replies and the watchers, the
   * registered name the journal is kept under, and the most bytes that database may hold.
   */
  readonly recovery: { readonly sql: Sql; readonly name: string; readonly capacity: number };
  /**
   * Called at each named cut point in recovery, right after a step is saved. A failure it returns
   * stops the turn there, which is how a test cuts a recovery short. Left out, nothing is called.
   */
  readonly fault?: (cut: string) => Effect.Effect<void, LedgerError>;
};

/**
 * Service that runs one process: it takes each input in turn, steps the program, saves what
 * happened, and only then runs the Cmds the step asked for.
 *
 * **Details**
 *
 * One call is one turn, and turns never overlap. A turn catches the process up on its inbox, finds
 * a resend, steps the fresh input purely, saves that it is about to append, appends through the
 * gateway's checked writer, folds what landed and installs it. A Cmd is saved as dispatched before
 * it runs, and its answer is saved as a letter before the program sees it. The order is the point:
 * nothing runs before the fact it rests on is saved, and a resend of an accepted input answers its
 * first placing.
 *
 * **Gotchas**
 *
 * A wake folds saved letters and runs none of their Cmds again. The process's ended spans are
 * flushed after every call, on success and on failure.
 *
 * @stability unstable
 * @category services
 */
export class ProgramRunner extends Context.Service<
  ProgramRunner,
  {
    /** Registers a watcher and answers the current view. */
    readonly open: (client: string) => Effect.Effect<Opened, RunnerFailure>;
    /**
     * Takes one delivered input: the gateway's internal delivery, never a public request. Answers
     * `accepted` with the input's place in the inbox, or `refused` with the reason.
     */
    readonly msg: (input: unknown) => Effect.Effect<Sent, RunnerFailure>;
    /** Save the one alarm for newly arrived mail, without running or starting the recipient. */
    readonly mailed: Effect.Effect<void, RunnerFailure>;
    /** The object's alarm fired at `at`: the program's timer, if it asked for one by then. */
    readonly due: (at: number) => Effect.Effect<void, RunnerFailure>;
    /** The new process's first turn, OTP's init/1: loads the program and arms its alarm. Safe to
     *  call again: a live runner only catches up. */
    readonly init: () => Effect.Effect<void, RunnerFailure>;
    /**
     * Restarts the process on request, outside a crash: a live process is ended and a new one
     * starts under the same name, on `build`. A request `id` already taken answers again without a
     * second restart; the same `id` with another `build` fails with `bad_input`.
     */
    readonly restart: (request: { readonly id: string; readonly build: string }) => Effect.Effect<void, RunnerFailure>;
  }
>()("@kampus/libfabrika/runtime/Runner.ProgramRunner") {
  /** Load in process, keeping the pure stepper available to callers of ProgramLoader. */
  static readonly layer = (
    initial: Descriptor,
    options: RunnerOptions,
  ): Layer.Layer<
    ProgramRunner,
    never,
    ProgramLoader | ProcessStore | ProcessManager | Mailbox | CheckedWriter | WatcherManager | Alarm | Recording
  > => Layer.unwrap(Effect.map(ProgramLoader, (loader) => ProgramRunner.withLoader(initial, loader, options)));

  /** Worker programs keep their pure stepper inside the box; the runner needs only execution. */
  static readonly withLoader = (
    initial: Descriptor,
    loader: {
      readonly load: (name: string, build?: string) => Effect.Effect<Omit<Loaded, "stepper">, ProgramDown>;
    },
    options: RunnerOptions,
  ): Layer.Layer<
    ProgramRunner,
    never,
    ProcessStore | ProcessManager | Mailbox | CheckedWriter | WatcherManager | Alarm | Recording
  > =>
    Layer.effect(
      ProgramRunner,
      Effect.gen(function* () {
        const rootStore = yield* ProcessStore;
        let store = rootStore;
        let process = initial;
        const manager = yield* ProcessManager;
        const recovery = recoveryStore(options.recovery.sql, { ...options.recovery, schema: Supervision });
        const replies = yield* Replies.pipe(Effect.provide(RepliesSql.layer(options.recovery.sql, options.recovery)));
        let supervision: Supervision | null = null;
        let woke = false;
        const mailbox = yield* Mailbox;
        const checked = yield* CheckedWriter;
        const watches = yield* Watchers.pipe(Effect.provide(WatchersSql.layer(options.recovery.sql, initial)));
        const alarm = yield* Alarm;
        const recording = yield* Recording;
        const sessions = yield* Effect.serviceOption(SessionManager);
        const delivery = yield* Effect.serviceOption(MailDelivery);
        const children = yield* Effect.serviceOption(Children);
        // Read the lifecycle from its machine; the runner keeps no second copy.
        const ended = Effect.map(
          Effect.suspend(() => manager.status(process.name)),
          ({ state }) => state._tag === "ended" && state.process === process.id && state.reason._tag === "normal",
        );
        const stepFault = yield* Effect.serviceOption(StepFault);
        /** Sends running now, sends a drain of ordinary mail made, and when a failed send is retried. */
        const sending = new Set<string>();
        let drained: ReadonlyArray<Dispatched> = [];
        let mailRetry: number | null = null;
        let sendRetry: number | null = null;
        const permit = yield* Semaphore.make(1);
        const commandPermit = yield* Semaphore.make(1);
        let live: Live | null = null;
        let alarmAt: number | null | undefined;
        /** Writes left dispatched by an earlier process life: retried once loaded. */
        let retry: ReadonlyArray<Dispatched> = [];

        const now = Effect.map(DateTime.now, DateTime.formatIso);
        /** The current trace: every runner call runs inside its own span. */
        const traceId = Effect.currentSpan.pipe(
          Effect.map((span) => span.traceId),
          Effect.orDie,
        );
        const from = Effect.fnUntraced(function* (parent: string | null, traceId: string) {
          return {
            by: process.owner.key,
            for: process.owner.for,
            sentAt: yield* now,
            seen: 0,
            parent,
            traceId,
            build: process.build,
          } satisfies From;
        });

        const fault = (cut: string) => options.fault?.(cut) ?? Effect.void;
        const coordinator = Effect.succeed(manager);
        const currentRecovery = Effect.suspend(() =>
          supervision === null ? Effect.fail(new LedgerError({ reason: "bad_row" })) : Effect.succeed(supervision),
        );
        /** Steps the journal, saves what it returns, and installs that only once it is saved. */
        const send = Effect.fnUntraced(function* (msg: SupervisorMsg) {
          const s = yield* currentRecovery;
          const next = yield* Effect.try({
            try: () => applyCell(supervisor, s, msg)[0],
            catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
          });

          if (next !== s) {
            yield* recovery.save(next);
            supervision = next;
          }

          return next;
        });
        /** A completion the open work must take: one it refuses is a broken saved journal. */
        const complete = Effect.fnUntraced(function* (msg: SupervisorMsg) {
          const s = supervision;

          if ((yield* send(msg)) === s) {
            return yield* new LedgerError({ reason: "bad_row" });
          }
        });
        /** Which delivery limit wins: the program's own, else the wiring's (3 when it sets none). */
        const deliveries = (s: Supervision): number => s.maxDeliveries ?? s.policy.maxDeliveries;
        /** The journal is replacing its process: no program work runs until it is idle again. */
        const recovering = (s: Supervision | null): boolean =>
          s !== null && s.journal._tag !== "idle" && s.journal._tag !== "stepping" && s.journal._tag !== "checking";
        /** When recovery waits: down's own wait, or a successor's start that is not due yet. */
        const waitUntil = (s: Supervision | null): number | null => {
          const j = s?.journal;
          return j?._tag === "writing_down" || j?._tag === "waiting_recovery"
            ? j.recovery.until
            : j?._tag === "waiting_start" && j.timing._tag === "scheduled"
              ? j.timing.until
              : null;
        };
        /** One object alarm: program work is eligible only while live. */
        const setAlarm = Effect.fnUntraced(function* (retryAt?: number) {
          // The process table's machine owns normal exit, including after a lost checkpoint.
          if (!recovering(supervision) && (yield* ended)) {
            if (alarmAt !== null) {
              yield* alarm.set(null);
              alarmAt = null;
            }

            return;
          }

          const running = !recovering(supervision) && (supervision === null || (yield* manager.isLive(process.id)));
          const waited = waitUntil(supervision);
          const owes = running && (live?.cmds.some((cmd) => cmd.mail === true) ?? false);
          const now = yield* Clock.currentTimeMillis;
          const backoff = supervision?.policy.backoff.minMs ?? defaultPolicy.backoff.minMs;
          sendRetry = !owes ? null : sendRetry !== null && sendRetry > now ? sendRetry : now + backoff;
          const times = [waited, running ? mailRetry : null, sendRetry].filter((at) => at !== null);
          const until = retryAt ?? (times.length === 0 ? null : Math.min(...times));

          // Loading supplies the live program's wake; do not clear it before then.
          if (running && live === null && until === null) {
            return;
          }

          const wake = running ? (live?.wake ?? null) : null;
          const next = wake === null ? until : until === null ? wake : Math.min(wake, until);

          if (alarmAt === next) {
            return;
          }

          yield* alarm.set(next);
          alarmAt = next;
        });
        const adopt = Effect.fnUntraced(function* (id: string, build: string) {
          if (process.id === id && process.build === build) {
            return;
          }

          store = yield* rootStore.select(id);
          process = { ...process, id, build };
          live = null;
          retry = [];
        });
        /** Performs the work the saved journal names, sending each completion after its write. */
        const resume = Effect.fnUntraced(function* () {
          while (supervision !== null) {
            const s: Supervision = supervision;
            const j = s.journal;
            const p = yield* coordinator;

            switch (j._tag) {
              case "writing_reply": {
                yield* replies.rememberReply(j.reply);
                yield* store.activity(Activity.cases.idle.make({ process: j.attempt.process }));
                yield* complete({ type: "reply_written", seq: j.attempt.seq });
                break;
              }
              case "clearing_attempt": {
                yield* store.activity(Activity.cases.idle.make({ process: j.attempt.process }));
                yield* complete({ type: "attempt_cleared", seq: j.attempt.seq });
                break;
              }
              case "writing_dead": {
                const { failure } = j;
                const receipt = s.receipts.find(
                  (r) => r.letter === failure.letter && r.process === failure.process && r.result !== null,
                );

                if (receipt === undefined) {
                  return yield* new LedgerError({ reason: "bad_row" });
                }

                yield* p
                  .dead(
                    failure.process,
                    DeadInput.make({
                      tries: receipt.tries,
                      limit: deliveries(s),
                      m: receipt.letter,
                      build: s.build,
                      errors: receipt.errors,
                    }),
                    j.from,
                  )
                  .pipe(
                    Effect.withSpan("runner.dead", {
                      attributes: {
                        [PROCESS]: failure.process,
                        [tag("letter")]: receipt.letter,
                        [tag("attempt")]: receipt.tries,
                        [tag("build")]: s.build,
                      },
                    }),
                  );
                yield* fault("after_dead");
                yield* complete({ type: "dead_written", seq: failure.seq });
                break;
              }
              case "writing_exit": {
                // A person's restart ends the live process with shutdown; a captured failure is a crash.
                const reason = j.origin._tag === "manual" ? ExitReason.cases.shutdown.make({}) : j.origin.reason;
                yield* p.exit(j.process, reason, j.from);
                yield* fault("after_exit");
                const status = yield* p.status(process.name);
                yield* complete({
                  type: "exit_written",
                  process: j.process,
                  restarts: status.restarts,
                  at: status.at,
                  program: process.program,
                });
                live = null;
                retry = [];
                break;
              }
              case "writing_down": {
                yield* p.down(j.recovery.process, j.recovery, j.from);
                yield* fault("after_down");
                yield* complete({ type: "down_written", process: j.recovery.process });
                break;
              }
              case "waiting_start": {
                const status = yield* p.status(s.name);
                const until = j.timing._tag === "scheduled" ? j.timing.until : undefined;

                // The successor waits its backoff: the alarm resumes it when due.
                if (until !== undefined && status.at < until) {
                  return;
                }

                const timing = {
                  [PROCESS]: j.request.after,
                  [tag("until")]: until ?? status.at,
                  [tag("lag")]: Math.max(0, status.at - (until ?? status.at)),
                };
                const restart = p.start(j.request, j.from).pipe(
                  Effect.withSpan("runner.restart", {
                    attributes: {
                      ...timing,
                      // The build being started, which a manual restart may change from the current one.
                      [tag("build")]: j.request.code.hash,
                      [tag("crashes")]: s.crashes,
                    },
                  }),
                );
                // A supervised start has a wait; an explicit Restart has none.
                const started = yield* until === undefined
                  ? restart
                  : restart.pipe(Effect.withSpan("runner.recover", { attributes: timing }));
                yield* fault("after_start");
                yield* complete({ type: "started", id: j.request.id, process: started.process, at: status.at });
                break;
              }
              case "checkpointing": {
                const previous = yield* rootStore.select(j.after);
                const next = yield* rootStore.select(j.process);
                const checkpoint = yield* previous.load;

                if (j.origin._tag === "manual" && checkpoint !== null) {
                  // Keep the accepted turn in the index without carrying its rejected model.
                  const prepared = Schema.decodeUnknownOption(Turn)(checkpoint.turn);

                  if (Option.isSome(prepared) && (yield* previous.placedByAny(prepared.value.id)) === null) {
                    const accepted = yield* Stream.runHead(
                      mailbox
                        .read(s.name, checkpoint.saved.after)
                        .pipe(Stream.filter((letter) => letter.id === prepared.value.id)),
                    );

                    if (Option.isSome(accepted)) {
                      const { id, rev, pos } = accepted.value;
                      yield* previous.save(checkpoint, [{ id, rev, pos }]);
                    }
                  }
                } else if (j.origin._tag === "crash" && (yield* next.load) === null) {
                  // The turn is the acceptance marker until its letter is indexed.
                  if (checkpoint !== null) {
                    yield* next.save({ ...checkpoint, cmds: [] });
                  }
                }

                yield* fault("after_checkpoint");
                const status = yield* p.status(s.name);
                const done = yield* send({
                  type: "checkpointed",
                  after: j.after,
                  process: j.process,
                  restarts: status.restarts,
                  at: status.at,
                });
                yield* adopt(j.process, done.build);
                break;
              }
              default:
                return;
            }
          }
        });
        const continueRecovery = Effect.fnUntraced(function* () {
          // A live process with nothing to recover keeps its alarm: re-arming a past program wake on
          // every call would fire it again.
          const working = recovering(supervision);
          yield* resume().pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                if (exit._tag === "Success" || supervision === null || !recovering(supervision)) {
                  return;
                }

                const at = yield* Clock.currentTimeMillis;
                yield* setAlarm(at + supervision.policy.backoff.minMs);
              }),
            ),
          );

          if (working || recovering(supervision)) {
            yield* setAlarm();
          }
        });
        /** Saves one captured failure, then performs the recovery its journal names. */
        const observed = Effect.fnUntraced(function* (
          msg: SupervisorMsg,
          process: string,
          thrown?: { readonly failure: Failure; readonly content: unknown },
        ) {
          yield* complete(msg);

          if (thrown !== undefined && thrown.failure._tag !== "interrupted") {
            const { failure } = thrown;
            yield* Effect.exit(
              // The original failure text belongs only in the span's deletable content.
              Effect.fail(thrown.content).pipe(
                Effect.withSpan("runner.throw", {
                  attributes: {
                    [PROCESS]: failure.process,
                    "error.type": failure.error,
                    [tag("letter")]: failure.letter,
                    [tag("build")]: failure.build,
                    [tag("phase")]: failure._tag,
                    [tag("attempt")]: failure.seq,
                  },
                }),
              ),
            );
          }

          yield* fault("after_observation");
          yield* store.activity(Activity.cases.idle.make({ process }));
          yield* continueRecovery();
        });
        const interrupted = ExitReason.cases.crashed.make({ phase: "interrupted" });
        const ensure = Effect.fnUntraced(function* (time?: number) {
          const p = yield* coordinator;
          const status = yield* p.status(initial.name);

          if (supervision === null) {
            supervision = yield* recovery.load;

            if (supervision === null) {
              const loaded = yield* loader.load(status.state.code.program, status.state.code.hash);
              const policy = yield* Effect.try({
                try: () => {
                  const wiring = options.policy ?? defaultPolicy;
                  return Schema.decodeUnknownSync(Policy)(
                    loaded.declaration.policy ?? {
                      ...wiring,
                      maxDeliveries: wiring.maxDeliveries ?? defaultPolicy.maxDeliveries,
                    },
                  );
                },
                catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
              });
              supervision = supervisor.init(null, {
                policy,
                process: status.state.process,
                name: initial.name,
                build: status.state.code.hash,
                at: status.at,
              })[0];
            }
          }

          // Another starter placed a successor while this one waited: adopt it.
          const j = supervision.journal;
          const waited =
            j._tag === "writing_down" || j._tag === "waiting_recovery"
              ? j.recovery.process
              : j._tag === "waiting_start" && j.timing._tag === "scheduled"
                ? j.request.after
                : null;

          if (status.state._tag === "live" && waited !== null && status.state.process !== waited) {
            yield* send({
              type: "adopted",
              process: status.state.process,
              build: status.state.code.hash,
              restarts: status.restarts,
            });
          }

          yield* continueRecovery();
          const resumed = yield* currentRecovery;
          const now = resumed.journal;
          const current =
            now._tag === "idle"
              ? now.process
              : now._tag === "stepping" || now._tag === "checking"
                ? now.attempt.process
                : null;

          if (current !== null) {
            yield* adopt(current, resumed.build);
          }

          if (!woke) {
            // One captured identity, one interruption: the saved attempt wins over the marker.
            const marker = yield* store.readActivity;
            const letter =
              (now._tag === "stepping" || now._tag === "checking") && now.attempt.process === process.id
                ? now.attempt.letter
                : now._tag === "idle" && marker?._tag === "stepping" && marker.process === process.id
                  ? marker.letter
                  : null;

            if (letter !== null) {
              const meta = yield* from(null, yield* traceId);
              yield* observed(
                {
                  type: "interrupted",
                  process: process.id,
                  letter,
                  build: process.build,
                  reason: interrupted,
                  from: meta,
                  at: status.at,
                },
                process.id,
              );
            }

            woke = true;
          }

          const waiting = (yield* currentRecovery).journal;

          if (time !== undefined && waiting._tag === "waiting_recovery" && status.at >= waiting.recovery.until) {
            const meta = yield* from(null, yield* traceId);
            yield* send({ type: "due", at: status.at, program: process.program, from: meta });
            yield* continueRecovery();
          }

          const latest = yield* currentRecovery;

          if (latest.journal._tag === "idle") {
            yield* send({ type: "healthy", at: status.at });
          }

          if (recovering(latest)) {
            yield* setAlarm();
          }
        });

        const step = Effect.fnUntraced(function* (
          reason: ProgramDown["reason"],
          letter: string,
          f: () => Effect.Effect<Step, RunnerFailure>,
          receipt?: Receipt,
        ) {
          if (supervision !== null) {
            // The permit excludes an active callback. Pending work here belongs to a failed live call;
            // a reopened runner has already captured its interruption in ensure.
            const pending = supervision.journal;

            if (pending._tag === "checking" || pending._tag === "stepping") {
              yield* complete({ type: "abandoned", seq: pending.attempt.seq });
              yield* continueRecovery();
            }

            const status = yield* (yield* coordinator).status(process.name);
            const phase = reason === "step" ? "fresh" : "saved";
            yield* complete({ type: "begin", process: process.id, letter, build: process.build, phase, at: status.at });
          }

          yield* store.activity(Activity.cases.stepping.make({ process: process.id, letter, build: process.build }));
          const result = yield* Effect.gen(function* () {
            if (Option.isSome(stepFault)) {
              yield* stepFault.value.before({
                name: process.name,
                process: process.id,
                letter,
                phase: reason === "step" ? "fresh" : "saved",
              });
            }

            return yield* Effect.suspend(f);
          }).pipe(Effect.exit);
          const j = supervision?.journal;

          if (j !== undefined && result._tag === "Failure") {
            const failed = Cause.findError(result.cause);

            if (j._tag !== "stepping" && j._tag !== "checking") {
              return yield* Effect.failCause(result.cause);
            }

            const { phase: _phase, at, ...attempt } = j.attempt;
            const meta = yield* from(null, yield* traceId);

            if (Cause.hasInterrupts(result.cause)) {
              yield* observed(
                { type: "interrupted", ...attempt, reason: interrupted, from: meta, at },
                attempt.process,
              );
              return yield* Effect.failCause(result.cause);
            }

            // A throw is the step's own crash and keeps its class. Any other typed failure is the host's.
            const wrapped = Result.isSuccess(failed)
              ? failed.success
              : new ProgramDown({ reason, cause: Result.getOrUndefined(Cause.findDefect(result.cause)) });

            if (!Schema.is(ProgramDown)(wrapped)) {
              return yield* Effect.failCause(result.cause);
            }

            if (wrapped.source !== undefined) {
              yield* complete({ type: "abandoned", seq: attempt.seq });
              yield* continueRecovery();
              return yield* wrapped;
            }

            const original = Object.hasOwn(wrapped, "cause") ? wrapped.cause : wrapped;
            const error = wrapped.errorClass;
            const failure = (reason === "step" ? Failure.cases.fresh : Failure.cases.saved).make({ ...attempt, error });
            const msg: SupervisorMsg =
              j._tag === "checking" && receipt !== undefined
                ? { type: "check_threw", seq: attempt.seq, receipt, error, reason: fromFailure(failure), from: meta }
                : { type: "threw", seq: attempt.seq, error, reason: fromFailure(failure), from: meta };
            // The original program failure wins even when its observation cannot be saved.
            yield* observed(msg, attempt.process, { failure, content: original }).pipe(Effect.mapError(() => wrapped));
            return yield* wrapped;
          }

          if (j?._tag === "stepping") {
            yield* send({ type: "finished", seq: j.attempt.seq });
          }

          return yield* result.pipe(
            Effect.onExit((exit) =>
              store
                .activity(Activity.cases.idle.make({ process: process.id }))
                .pipe(Effect.catch((error) => (exit._tag === "Failure" ? Effect.void : Effect.fail(error)))),
            ),
          );
        });

        const stepped = Effect.fnUntraced(function* (step: Step, reason: ProgramDown["reason"]) {
          return yield* step._tag === "stepped" ? Effect.succeed(step) : Effect.fail(new ProgramDown({ reason }));
        });

        /** A throw in the program's init is supervision's, as a step's is: observed, then the wait.
         *  The journal takes the attempt, under the letter `<pid>/init`, only once init has thrown,
         *  so a load whose init returns leaves the journal and its counts as they were. */
        const booted = (init: Effect.Effect<Step, ProgramDown>): Effect.Effect<Step, RunnerFailure> =>
          init.pipe(
            Effect.catchIf(
              (down: ProgramDown) => supervision !== null && down.source === undefined,
              Effect.fnUntraced(function* (down: ProgramDown): Effect.fn.Return<never, RunnerFailure> {
                const { at } = yield* (yield* coordinator).status(process.name);
                const letter = `${process.id}/init`;
                yield* complete({
                  type: "begin",
                  process: process.id,
                  letter,
                  build: process.build,
                  phase: "saved",
                  at,
                });
                const j = supervision?.journal;

                if (j?._tag !== "stepping" || j.attempt.letter !== letter) {
                  return yield* new LedgerError({ reason: "bad_row", cause: down });
                }

                const { phase: _phase, at: _at, ...attempt } = j.attempt;
                const error = down.errorClass;
                const failure = Failure.cases.saved.make({ ...attempt, error });
                const meta = yield* from(null, yield* traceId);
                yield* observed(
                  { type: "threw", seq: attempt.seq, error, reason: fromFailure(failure), from: meta },
                  attempt.process,
                  { failure, content: Object.hasOwn(down, "cause") ? down.cause : down },
                ).pipe(Effect.mapError(() => down));
                return yield* down;
              }),
            ),
          );

        /** Loads the program and its checkpoint, climbing saved state through its upgrades. */
        const load = Effect.fnUntraced(function* () {
          const loaded = yield* loader.load(process.program, process.build);
          const program = loaded.declaration;

          if (supervision !== null) {
            yield* send({ type: "limited", maxDeliveries: program.maxDeliveries ?? null });
          }

          const saved = yield* store.load;

          if (saved === null) {
            const boot = yield* stepped(yield* booted(loaded.execution.init(null)), "load");
            const fresh: Live = {
              loaded,
              model: boot.model,
              view: boot.view,
              wake: boot.wake,
              v: program.v,
              after: 0,
              pos: 0,
              cmds: [],
            };
            return { live: fresh, dirty: false };
          }

          const decoded = decodeDispatched(saved.cmds);

          if (Result.isFailure(decoded)) {
            return yield* new ProgramDown({ reason: "saved_state", error: "ProgramDown", cause: decoded.failure });
          }

          const cmds = decoded.success;
          const { saved: next, ran } = yield* loaded.execution.upgrade(saved.saved);
          const boot = yield* stepped(yield* booted(loaded.execution.init(next.model)), "saved_state");
          const upgraded = saved.saved.v !== next.v || ran.length > 0;

          if (upgraded) {
            yield* store.record(
              `upgrade:${saved.saved.v}-${next.v}:${next.after}`,
              RuntimeRecord.cases["state.upgraded"].make({
                program: program.name,
                from: saved.saved.v,
                to: next.v,
                ran,
                build: process.build,
              }),
              yield* from(null, yield* traceId),
            );
          }

          const pos =
            next.after === 0
              ? 0
              : Option.match(yield* Stream.runHead(mailbox.read(process.name, next.after - 1)), {
                  onNone: () => 0,
                  onSome: (letter) => (letter.rev === next.after ? letter.pos : 0),
                });
          retry = cmds.filter(
            (cmd) => cmd.mail === true || Option.exists(decodeTyped(cmd.cmd), (c) => c.type === WRITE),
          );
          const woke: Live = {
            loaded,
            model: boot.model,
            view: boot.view,
            wake: boot.wake,
            v: next.v,
            after: next.after,
            pos,
            cmds,
          };
          return { live: woke, dirty: upgraded || saved.turn !== null };
        });

        const checkpoint = (state: Live, turn: unknown) => ({
          saved: { v: state.v, build: process.build, model: state.model, after: state.after },
          turn,
          cmds: state.cmds,
        });

        /** Shows the installed view to every watcher and sets the alarm. */
        const publish = Effect.fnUntraced(function* (before: Live, after: Live) {
          if (after.pos !== before.pos) {
            const patch = diff(before.view, after.view);

            yield* watches.publish({
              type: "patch",
              base: before.pos,
              rev: after.pos,
              patch,
            });
          }

          yield* setAlarm();
        });

        const exits = (state: Live, job: Dispatched): boolean =>
          cmdType(job) === EXIT &&
          job.oversize === undefined &&
          state.loaded.declaration.cmds.includes(EXIT) &&
          Option.isSome(decodeExit(job.cmd));

        /**
         * Accepted letters fold; other mail takes the fresh checks and cannot fail the process.
         * Every first fold saves its Cmds, but only this call's letter returns Cmds to run.
         */
        const catchUp = Effect.fnUntraced(function* (
          state: Live,
          options: { readonly mine?: string; readonly dirty?: boolean } = {},
        ) {
          if (yield* ended) {
            return { state, fresh: [] as ReadonlyArray<Dispatched>, mine: Option.none<History>() };
          }

          const letters = yield* Stream.runCollect(mailbox.read(process.name, state.after));
          const saved = yield* store.load;

          if (letters.length === 0 && options.dirty !== true) {
            return { state, fresh: [] as ReadonlyArray<Dispatched>, mine: Option.none<History>() };
          }

          if (saved === null) {
            yield* store.save(checkpoint(state, null));
          }

          let model = state.model;
          let view = state.view;
          let wake = state.wake;
          const fresh: Array<Dispatched> = [];
          let cmds = state.cmds;
          const placed: Array<Placed> = [];
          const prepared = Schema.decodeUnknownOption(Turn)(saved?.turn);
          // The raw inbox keeps canceled signals; the manager filters them for this process.
          const signals = new Set(
            letters.some((letter) => inSignalSpace(letter.id))
              ? (yield* Stream.runCollect(manager.receive(process.id, state.after))).map((letter) => letter.id)
              : [],
          );
          let mine = Option.none<History>();
          const drain: Array<Dispatched> = [];
          let alive: boolean | undefined;
          let stop = letters.length;
          let skippedNotices = 0;

          for (const [index, letter] of letters.entries()) {
            const signal = inSignalSpace(letter.id);

            if (signal && !signals.has(letter.id)) {
              continue;
            }

            const down = signal ? decodeDown(letter.m) : Option.none();

            if (signal && !Option.exists(down, (m) => m.to._tag === "process" && m.to.process === process.id)) {
              continue;
            }

            const own = inRunnerSpace(letter.id) && letter.id.startsWith(`${process.id}/`);
            const ending = cmds.findIndex((job) => exits(state, job));

            // Only answers to Cmds before exit may still fold. Ordinary mail waits for the next life.
            if (ending >= 0 && !cmds.slice(0, ending).some((job) => own && letter.id === `${job.id}/answer`)) {
              stop = Math.min(stop, index);
              continue;
            }

            const accepted =
              signal ||
              own ||
              letter.id === options.mine ||
              Option.exists(prepared, (turn) => turn.id === letter.id) ||
              (yield* store.placed(letter.id)) !== null ||
              // An earlier life of this name accepted it; an old life's own mail never drives this one.
              (!inRunnerSpace(letter.id) && (yield* store.placedByAny(letter.id)) !== null);

            // A stopped life leaves its ordinary mail, in order, to the life that follows it.
            if (!accepted) {
              alive = alive ?? (yield* manager.isLive(process.id));

              if (!alive) {
                stop = index;
                break;
              }
            }

            const input = Option.isSome(down) ? { ...down.value, type: down.value._tag } : letter.m;
            const m = accepted && !own && letter.parent !== null ? stamp(input, letter.parent) : input;
            const folded = accepted
              ? yield* stepped(
                  yield* step("saved_letter", letter.id, () => state.loaded.execution.fold(model, m)),
                  "saved_letter",
                )
              : yield* receive(state, model, letter.id, letter.m);

            if (folded._tag === "refused") {
              if (inNoticeSpace(letter.id)) {
                skippedNotices++;
              }

              continue;
            }

            yield* store.record(
              `step:${letter.id}`,
              RuntimeRecord.cases.stepped.make({
                input: letter.id,
                pos: letter.pos,
                build: process.build,
              }),
              yield* from(letter.parent, letter.traceId),
            );
            model = folded.model;
            view = folded.view;
            wake = folded.wake;
            placed.push({ id: letter.id, rev: letter.rev, pos: letter.pos });

            if (own && letter.id.endsWith("/answer")) {
              cmds = cmds.filter((cmd) => cmd.id !== letter.id.slice(0, -"/answer".length));
            }

            const owed = !accepted || letter.id === options.mine;
            // Host Cmds retry by stable id after a prepared turn's checkpoint failed.
            const preparedTurn = Option.exists(prepared, (turn) => turn.id === letter.id);
            const dispatched = folded.cmds.map((cmd, index): Dispatched => ({
              id: `${process.id}/${letter.pos}/${index}`,
              cmd,
              state: "dispatched",
              parent: letter.parent,
              traceId: letter.traceId,
              build: process.build,
              ...((owed || preparedTurn) && Option.exists(decodeTyped(cmd), (c) => HOST.has(c.type))
                ? { mail: true as const }
                : {}),
              ...Option.getOrElse(oversized(cmd), () => ({})),
            }));
            cmds = [...cmds, ...dispatched];

            if (letter.id === options.mine) {
              mine = Option.some(letter);
              fresh.push(...dispatched);
            } else {
              drain.push(...dispatched.filter((job) => !accepted || job.mail === true));
            }
          }

          if (skippedNotices > 0) {
            yield* Effect.annotateCurrentSpan(tag("notices.skipped"), skippedNotices);
          }

          const last = letters.slice(0, stop).at(-1);
          const next: Live = {
            ...state,
            model,
            view,
            wake,
            after: last?.rev ?? state.after,
            pos: last?.pos ?? state.pos,
            cmds,
          };
          yield* store.save(checkpoint(next, null), placed);
          drained = [...drained, ...drain];
          live = next;
          yield* publish(state, next);
          return { state: next, fresh: fresh as ReadonlyArray<Dispatched>, mine };
        });

        const receive = Effect.fnUntraced(function* (state: Live, model: unknown, id: string, m: unknown) {
          const refused = Step.cases.refused.make({ reason: "bad_msg" });

          if (hasParent(m)) {
            return refused;
          }

          if (!inNoticeSpace(id)) {
            const port = inputPort(state, m);

            if (port === undefined || !port.write || port.personOnly) {
              return refused;
            }
          }

          return yield* (inNoticeSpace(id) ? Effect.succeed(true) : state.loaded.execution.admit(m)).pipe(
            Effect.flatMap((admitted) => (admitted ? state.loaded.execution.step(model, m) : Effect.succeed(refused))),
            Effect.catchIf(
              (error) => error.reason === "step" && error.source === undefined,
              () => Effect.succeed(refused),
            ),
          );
        });

        /** The live process, loaded and caught up. */
        const ready = Effect.fnUntraced(function* () {
          yield* ensure();

          if (recovering(supervision)) {
            return yield* new ProgramDown({ reason: "saved_letter" });
          }

          let state: Live;

          if (live !== null) {
            state = (yield* catchUp(live)).state;
          } else {
            const { live: loaded, dirty } = yield* load();
            state = (yield* catchUp(loaded, { dirty })).state;
          }

          live = state;
          yield* setAlarm();
          return state;
        });

        /** Takes the writes and sends an earlier life left dispatched, and the Cmds a drain of
         *  ordinary mail made, to run them once. */
        const takeRetry = () => {
          const taken = [...retry, ...drained].filter((job) => live?.cmds.some((cmd) => cmd.id === job.id));
          retry = [];
          drained = [];
          return taken;
        };

        // --- Cmds ---------------------------------------------------------------------------

        const at = Clock.currentTimeMillis;
        /** The Cmd an answer echoes. A start_child's `ok` drops its input; a start_child's or exit's
         *  `err` keeps only its type, since a refused operand may hold anything its program put there. */
        const echo = (job: Dispatched, outcome: "ok" | "err"): unknown => {
          const type = cmdType(job);
          return type !== START_CHILD && type !== EXIT ? job.cmd : outcome === "err" ? { type } : withoutInput(job.cmd);
        };
        const ok = Effect.fnUntraced(function* (job: Dispatched, value: unknown) {
          return yield* Effect.map(at, (time) => ({
            type: `${cmdType(job)}_ok`,
            cmd: echo(job, "ok"),
            value,
            at: time,
          }));
        });
        const err = Effect.fnUntraced(function* (job: Dispatched, reason: string, error: unknown = failure(reason)) {
          return yield* Effect.map(at, (time) => ({
            type: `${cmdType(job)}_err`,
            cmd: echo(job, "err"),
            error,
            reason,
            at: time,
          }));
        });

        /** The span one Cmd runs in. */
        const cmdSpan = Effect.fn("runner.cmd")(function* <A, E>(job: Dispatched, work: Effect.Effect<A, E>) {
          yield* Effect.annotateCurrentSpan({
            [PROCESS]: process.id,
            [tag("cmd")]: cmdType(job),
            [tag("id")]: job.id,
          });
          return yield* work;
        });

        /** A checked write: the event must be declared, not reserved, and match its schema. */
        const write = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
          const input = decodeWriteCmd(job.cmd);

          if (Result.isFailure(input)) {
            return yield* err(job, "bad_cmd");
          }

          const { stream, write: asked } = input.success;
          const event = asked.event;
          const kind = typeof event._tag === "string" ? event._tag : null;
          const writes = state.loaded.declaration.writes;
          const policy = kind !== null && Object.hasOwn(writes, kind) ? writes[kind] : undefined;

          if (kind === null || RESERVED.has(kind) || policy === undefined || !isEvent(event)) {
            return yield* err(job, "bad_cmd");
          }

          if (
            brainOnly({ stream, id: job.id, tag: kind }) ||
            stream === "gateway" ||
            stream.startsWith("gateway/") ||
            (stream.endsWith("/inbox") && stream !== `${process.name}/inbox`)
          ) {
            return yield* err(job, "forbidden");
          }

          if (!(yield* state.loaded.execution.check(kind, event))) {
            return yield* err(job, "bad_cmd");
          }

          const commit = (links: ReadonlyArray<Tracer.SpanLink>) =>
            Effect.fn("runner.write", {
              attributes: {
                [PROCESS]: process.id,
                [tag("write")]: job.id,
                [tag("stream")]: stream,
              },
              links,
            })(function* <E>(appended: Effect.Effect<Appended, E>) {
              return yield* appended;
            });
          const attempt: Effect.Effect<Appended, WriteFailure> = Effect.gen(function* () {
            if (asked._tag === "own") {
              if (policy.personOnly) {
                return yield* new SigningRefused({ reason: "person_only" });
              }

              return yield* commit([])(checked.own(job.id, stream, event));
            }

            if (checked.sign === undefined && Option.isNone(sessions)) {
              return yield* Effect.die(new Error("a caused write needs a SessionManager"));
            }

            const session = yield* checked.sign !== undefined
              ? checked.sign(job.id, asked.parent, kind)
              : Option.getOrThrow(sessions)
                  .signer(asked.parent, process.id, kind)
                  .pipe(Effect.provideService(SignRequest, { id: job.id }));
            return yield* commit([{ span: Tracer.externalSpan(session.span), attributes: {} }])(
              checked.commit(job.id, session, stream, event),
            );
          });
          // A refusal is the Cmd's answer; a storage failure is not, so the Cmd stays dispatched.
          const answer = yield* attempt.pipe(
            Effect.map((placed): Result.Result<Appended, string> => Result.succeed(placed)),
            Effect.catchIf(
              (e): e is SigningRefused | NotGranted => e instanceof SigningRefused || e instanceof NotGranted,
              (e) =>
                Effect.succeed<Result.Result<Appended, string>>(
                  Result.fail(e instanceof SigningRefused ? e.reason : "not_granted"),
                ),
            ),
          );

          if (Result.isFailure(answer)) {
            return yield* err(job, answer.failure);
          }

          if (answer.success._tag === "refused") {
            return yield* err(job, answer.success.reason);
          }

          return yield* ok(job, answer.success);
        });

        /** The built-in Send, mailed as this life, never as a sender the Cmd claims. A refusal is its
         *  answer; a storage or wake failure is not, so the Send stays dispatched. */
        const mail = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
          const input = decodeSendInput(job.cmd);

          if (Result.isFailure(input) || !state.loaded.declaration.cmds.includes(SEND) || Option.isNone(delivery)) {
            return yield* err(job, "bad_cmd");
          }

          const queued = yield* delivery.value
            .send({
              command: job.id,
              source: { name: process.name, process: process.id },
              to: input.success.to,
              m: input.success.m,
              from: yield* from(job.parent, job.traceId),
            })
            .pipe(Effect.result);

          if (Result.isSuccess(queued)) {
            return yield* ok(job, Schema.encodeSync(Queued)(queued.success));
          }

          const { reason } = queued.failure;

          if (isRefusal(reason)) {
            return yield* err(job, reason);
          }

          return yield* new LedgerError({
            reason: reason === "storage" ? "storage" : "unreachable",
            message: Cause.pretty(Cause.fail(queued.failure)),
          });
        });

        /** The built-in start_child: the loader names the program and its hash, this life is the
         *  requester and this Cmd's id is the start's. A refusal is its answer; storage is not, so the
         *  Cmd stays dispatched, and its failure carries the reason only. */
        const startChild = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
          // An oversize start kept only the operands that fit, and its refusal, judged at dispatch.
          const input = job.oversize === undefined ? decodeStartChild(job.cmd) : Option.none();
          const program = Option.map(job.oversize === undefined ? input : decodeKept(job.cmd), (c) => c.program);

          if (
            !state.loaded.declaration.cmds.includes(START_CHILD) ||
            Option.isNone(children) ||
            job.oversize === "bad_cmd" ||
            (Option.isNone(program) && job.oversize !== "no_program")
          ) {
            return yield* err(job, "bad_cmd");
          }

          if (Option.isNone(program)) {
            return yield* err(job, "no_program");
          }

          const code = yield* loader.load(program.value, process.build).pipe(Effect.result);

          if (Result.isFailure(code)) {
            return code.failure.reason === "no_program"
              ? yield* err(job, "no_program")
              : yield* new LedgerError({ reason: "unreachable" });
          }

          // Operands over the row limit were never saved: the refusal order goes on without Children.start.
          if (Option.isNone(input)) {
            return yield* err(job, job.oversize ?? "bad_cmd");
          }

          const { name, input: first } = input.value;

          // The Worker's loader names its build's hash; the Node loader runs this runner's build.
          const hash =
            "hash" in code.success && typeof code.success.hash === "string" ? code.success.hash : process.build;
          const started = yield* children.value
            .start(
              {
                id: job.id,
                name,
                code: { program: program.value, hash },
                requester: Recipient.cases.process.make({ process: process.id }),
                ...(first === undefined ? {} : { input: first }),
              },
              yield* from(job.parent, job.traceId),
            )
            .pipe(Effect.result);

          if (Result.isSuccess(started)) {
            return yield* ok(job, Schema.encodeSync(Started)(started.success));
          }

          const { reason } = started.failure;
          return reason === "storage" ? yield* new LedgerError({ reason: "storage" }) : yield* err(job, reason);
        });

        /** The built-in exit: this life ends with `normal`, as OTP's `{stop, normal, State}`, and
         *  answers nothing. `null` is the ended life; a malformed exit is answered `bad_cmd`. */
        const stop = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
          if (!exits(state, job)) {
            return yield* err(job, "bad_cmd");
          }

          const tracer = yield* Tracer.Tracer;
          const safe = Tracer.make({
            context: tracer.context,
            span(options) {
              const span = tracer.span(options);
              const attribute = span.attribute.bind(span);
              span.attribute = (key, value) => {
                if (key !== "fab.ledger.code") {
                  attribute(key, key === "error.type" ? "LedgerError" : value);
                }
              };
              const end = span.end.bind(span);
              span.end = (time, exit) =>
                end(time, Exit.isSuccess(exit) ? exit : Exit.fail(new LedgerError({ reason: "storage" })));
              return span;
            },
          });
          yield* manager.exit(process.id, ExitReason.cases.normal.make({}), yield* from(job.parent, job.traceId)).pipe(
            Effect.withTracer(safe),
            Effect.mapError(() => new LedgerError({ reason: "storage" })),
            Effect.catchDefect(() => Effect.die(new Error("process.exit failed"))),
          );
          return null;
        });

        /** A handler's Cmd. Only a declared Cmd with a handler runs; its answer is checked. */
        const handle = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
          const type = cmdType(job);
          const declared = state.loaded.declaration.cmds.includes(type);
          const run = state.loaded.handler(type);

          if (!declared || Option.isNone(run)) {
            return yield* err(job, "bad_cmd");
          }

          // The handler's own failure ends its span failed, with the message as deletable content.
          const exit = yield* cmdSpan(job, run.value(job.cmd)).pipe(Effect.exit);

          if (exit._tag === "Failure") {
            // An interrupted handler stays dispatched: nobody knows whether it acted.
            if (Cause.hasInterrupts(exit.cause)) {
              return yield* Effect.interrupt;
            }

            return yield* err(job, "handler_failed");
          }

          const outcome: Outcome<unknown, unknown> = exit.value;
          // The box checks the declared tag and encodes the answer; an Err
          // also carries its tag as `reason`, as the runner's own errors do.
          return yield* state.loaded.execution.reply(job.cmd, { ...outcome, at: yield* at }).pipe(
            Effect.map((m) => {
              const tag = outcome._tag === "Err" ? errTag(outcome.error) : undefined;
              return tag !== undefined && typeof m === "object" && m !== null && !Array.isArray(m)
                ? { ...m, reason: tag }
                : m;
            }),
            Effect.catchIf(
              (error) => error.reason === "step" && error.source === undefined,
              () => err(job, "bad_cmd"),
            ),
          );
        });

        /** Runs one saved Cmd, saves its answer as a letter, and folds it. Answers the Cmds that
         *  answer's step made. A failure that is not an answer leaves the Cmd dispatched. */
        const dispatch = Effect.fnUntraced(function* (
          job: Dispatched,
        ): Effect.fn.Return<ReadonlyArray<Dispatched>, RunnerFailure> {
          if (!job.id.startsWith(`${process.id}/`) || (yield* ended) || recovering(supervision)) {
            return [];
          }

          const origin = process;
          const originStore = store;
          const state = live;

          if (state === null) {
            return [];
          }

          const type = cmdType(job);
          const m = yield* type === WRITE
            ? cmdSpan(job, write(state, job))
            : type === SEND
              ? cmdSpan(job, mail(state, job))
              : type === START_CHILD
                ? cmdSpan(job, startChild(state, job))
                : type === EXIT
                  ? cmdSpan(job, stop(state, job))
                  : handle(state, job);

          if (m === null) {
            // The life ended: what it still owed, the Cmds listed after its exit included, never runs.
            return yield* permit.withPermit(
              Effect.gen(function* () {
                if (origin.id === process.id && live !== null) {
                  live = { ...live, cmds: [] };
                  yield* store.save(checkpoint(live, null));
                  yield* setAlarm();
                }

                return [];
              }),
            );
          }

          return yield* permit.withPermit(
            Effect.gen(function* () {
              const answer = `${job.id}/answer`;

              if (origin.id !== process.id || recovering(supervision)) {
                yield* originStore.record(
                  answer,
                  RuntimeRecord.cases["cmd.answered"].make({
                    m: Schema.decodeUnknownSync(Schema.Json)(m),
                    cmd: job.id,
                    build: origin.build,
                  }),
                  { ...(yield* from(job.parent, job.traceId)), build: origin.build },
                );
                const old = yield* originStore.load;

                if (old !== null) {
                  yield* originStore.save({
                    ...old,
                    cmds: old.cmds.filter(
                      (cmd) => typeof cmd !== "object" || cmd === null || !("id" in cmd) || cmd.id !== job.id,
                    ),
                  });
                }

                return [];
              }

              const current = yield* ready();
              const sent = yield* mailbox
                .send(process.name, answer, m, yield* from(job.parent, job.traceId))
                .pipe(Effect.provideService(RunnerMail, { process: process.id, name: process.name }));

              if (sent._tag === "refused") {
                return yield* new LedgerError({ reason: "refused", message: sent.reason });
              }

              return (yield* catchUp(current, { mine: answer })).fresh;
            }),
          );
        });

        /** Sets the alarm that tries a failed drain again. The permit is held. */
        const retryLater = Effect.gen(function* () {
          const backoff = supervision?.policy.backoff.minMs ?? defaultPolicy.backoff.minMs;
          mailRetry = (yield* Clock.currentTimeMillis) + backoff;
          yield* setAlarm();
        });

        /** A host Cmd runs once at a time while dispatched; its owed entry keeps the retry alarm. */
        const sendOnce = (job: Dispatched): Effect.Effect<ReadonlyArray<Dispatched>, RunnerFailure> =>
          Effect.suspend(() => {
            if (sending.has(job.id) || live?.cmds.some((cmd) => cmd.id === job.id) !== true) {
              return Effect.succeed([]);
            }

            sending.add(job.id);
            return dispatch(job).pipe(Effect.ensuring(Effect.sync(() => sending.delete(job.id))));
          });

        /** Runs Cmds in order, each one's follow-ups before the next. */
        const runAll = Effect.fnUntraced(function* (
          jobs: ReadonlyArray<Dispatched>,
        ): Effect.fn.Return<void, RunnerFailure> {
          yield* Effect.forEach(
            jobs,
            (job) => Effect.flatMap(HOST.has(cmdType(job)) ? sendOnce(job) : dispatch(job), runAll),
            {
              concurrency: 1,
              discard: true,
            },
          );
        });

        /** One public call: its span, saved writes and recovery under the permit, its Cmds, then
         *  the flush, on success and failure. */
        const call = (name: string) => {
          const operation = Effect.fn(name)(function* <A>(
            turn: Effect.Effect<{ readonly answer: A; readonly jobs: ReadonlyArray<Dispatched> }, RunnerFailure>,
            time?: number,
          ) {
            // The process this call starts on: a successor's calls carry its own ID.
            yield* Effect.annotateCurrentSpan({ [PROCESS]: process.id, [tag("name")]: process.name });
            const { answer, jobs } = yield* permit.withPermit(
              Effect.gen(function* () {
                // The platform consumes the alarm before due enters this wrapper.
                if (time !== undefined) {
                  alarmAt = undefined;
                }

                yield* ensure(time);
                const { answer, jobs } = yield* turn;
                return { answer, jobs: [...takeRetry(), ...jobs] };
              }),
            );

            if (jobs.length > 0) {
              yield* commandPermit.withPermit(runAll(jobs));
            }

            return answer;
          });
          return Effect.fnUntraced(function* <A>(
            turn: Effect.Effect<{ readonly answer: A; readonly jobs: ReadonlyArray<Dispatched> }, RunnerFailure>,
            time?: number,
          ) {
            const exit = yield* Effect.exit(operation(turn, time));
            return yield* recording.flush.pipe(
              Effect.flatMap(() => exit),
              Effect.catch((error) => (exit._tag === "Failure" ? exit : Effect.fail(error))),
            );
          });
        };
        const open = call("runner.open");
        const msg = call("runner.step");
        const due = call("runner.due");
        const init = call("runner.init");
        const restart = call("runner.restart.request");

        return {
          mailed: permit
            .withPermit(
              Effect.gen(function* () {
                mailRetry = Math.min(mailRetry ?? Infinity, yield* Clock.currentTimeMillis);
                yield* setAlarm();
                yield* Effect.annotateCurrentSpan({ "fab.mail.to": process.name, "fab.mail.alarm": alarmAt });
              }),
            )
            .pipe(Effect.withSpan("runner.mailed")),
          open: (client: string) =>
            open(
              Effect.gen(function* () {
                const state = yield* ready();

                if (client.length === 0 || client.length > 256) {
                  return yield* new RunnerError({ reason: "bad_client" });
                }

                yield* watches.open(client, {
                  type: "whole",
                  rev: state.pos,
                  view: state.view,
                });
                return { answer: { rev: state.pos, view: state.view }, jobs: [] };
              }),
            ),
          msg: (raw: unknown) =>
            msg(
              Effect.gen(function* () {
                const input = yield* decodeDelivery(raw).pipe(
                  Effect.mapError((cause) => new RunnerError({ reason: "bad_input", cause })),
                );
                yield* Effect.annotateCurrentSpan(tag("letter"), input.id);
                // An accepted letter answers its first placing, before any receipt check. Its
                // clocks may differ on a resend; the input it asked may not.
                const placed = (yield* store.placed(input.id)) ?? (yield* store.placedByAny(input.id));

                if (placed !== null) {
                  const letter = yield* Stream.runHead(mailbox.read(process.name, placed.rev - 1));
                  const asked = JSON.stringify(input.envelope.input);

                  if (Option.exists(letter, (l) => l.id === input.id && JSON.stringify(l.m) !== asked)) {
                    return { answer: Sent.cases.refused.make({ reason: "id_reused" }), jobs: [] };
                  }

                  return yield* accept(yield* ready(), input);
                }

                // A life that ended itself steps no later letter.
                if (yield* ended) {
                  return { answer: Sent.cases.refused.make({ reason: "ended" }), jobs: [] };
                }

                const receipt = supervision?.receipts.find((r) => r.letter === input.id);

                if (receipt !== undefined) {
                  const digest =
                    receipt.digest ??
                    (yield* decodeDelivery(receipt.input).pipe(
                      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
                      Effect.flatMap(inputDigest),
                    ));

                  if ((yield* inputDigest(input)) !== digest) {
                    return { answer: Sent.cases.refused.make({ reason: "id_reused" }), jobs: [] };
                  }

                  if (receipt.result !== null) {
                    return { answer: Sent.cases.refused.make({ reason: "dead" }), jobs: [] };
                  }
                }

                // A program's refusal is terminal: it answers again before any fresh check, and only
                // for the writer and input it first answered.
                const terminal = yield* replies.reply(process.name, input.id);

                if (terminal !== null) {
                  if ((yield* inputDigest(input)) !== terminal.digest) {
                    return { answer: Sent.cases.refused.make({ reason: "id_reused" }), jobs: [] };
                  }

                  const { _tag: _case, ...reason } = terminal.answer;
                  return { answer: Sent.cases.refused.make(reason), jobs: [] };
                }

                return yield* accept(yield* ready(), input);
              }),
            ),
          due: (time: number) =>
            due(
              Effect.gen(function* () {
                if ((yield* ended) || recovering(supervision)) {
                  yield* setAlarm();
                  return { answer: undefined, jobs: [] };
                }

                // Any alarm tries again every host Cmd a failure left dispatched.
                mailRetry = null;
                const state = yield* ready();
                const sends = state.cmds.filter((cmd) => cmd.mail === true);

                if (state.wake === null || state.wake > time) {
                  yield* setAlarm();
                  return { answer: undefined, jobs: sends };
                }

                const id = `${process.id}/due/${time}/${state.pos}`;
                const placed = yield* store.placed(id);
                const saved = yield* Stream.runHead(
                  mailbox
                    .read(process.name, placed === null ? state.after : placed.rev - 1)
                    .pipe(Stream.filter((letter) => letter.id === id)),
                );
                const arrivedAt = yield* Clock.currentTimeMillis;
                const sent = yield* mailbox
                  .send(
                    process.name,
                    id,
                    Option.isSome(saved) ? saved.value.m : { type: "timer", at: time, arrivedAt },
                    yield* from(null, yield* traceId),
                  )
                  .pipe(Effect.provideService(RunnerMail, { process: process.id, name: process.name }));

                if (sent._tag === "refused") {
                  return yield* new LedgerError({ reason: "refused", message: sent.reason });
                }

                const { fresh } = yield* catchUp(state, { mine: id });
                return { answer: undefined, jobs: [...sends, ...fresh] };
              }).pipe(
                // A storage failure while draining leaves the alarm that tries it again.
                Effect.onExit((exit) =>
                  exit._tag === "Failure" &&
                  Option.exists(
                    Cause.findErrorOption(exit.cause),
                    (error) => Schema.is(LedgerError)(error) || Schema.is(RecoveryStoreError)(error),
                  ) &&
                  !Cause.hasInterrupts(exit.cause)
                    ? retryLater
                    : Effect.void,
                ),
              ),
              time,
            ),
          init: () =>
            init(
              Effect.gen(function* () {
                if (!recovering(supervision)) {
                  // A program that throws in init is supervision's: once it holds the crash, the start answers.
                  yield* ready().pipe(
                    Effect.catchIf(
                      (error) => error._tag === "ProgramDown" && recovering(supervision),
                      () => Effect.void,
                    ),
                  );
                }

                return { answer: undefined, jobs: [] };
              }),
            ),
          restart: (request: { readonly id: string; readonly build: string }) =>
            restart(
              Effect.gen(function* () {
                const s = yield* currentRecovery;
                const j = s.journal;
                const flying =
                  (j._tag === "writing_exit" || j._tag === "waiting_start" || j._tag === "checkpointing") &&
                  j.origin._tag === "manual"
                    ? j.origin.request
                    : undefined;
                const prior =
                  s.requests.find((r) => r.id === request.id) ?? (flying?.id === request.id ? flying : undefined);

                if (prior !== undefined) {
                  if (prior.build !== request.build) {
                    return yield* new RunnerError({ reason: "bad_input" });
                  }

                  if (!recovering(s)) {
                    yield* ready();
                  }

                  return { answer: undefined, jobs: [] };
                }

                const status = yield* (yield* coordinator).status(process.name);
                yield* send({
                  type: "restart_requested",
                  ...request,
                  live: status.state._tag === "live",
                  process: status.state.process,
                  program: process.program,
                  from: yield* from(null, yield* traceId),
                });
                yield* continueRecovery();
                yield* ready();
                return { answer: undefined, jobs: [] };
              }),
            ),
        };

        /** A fresh input's turn. The permit is held. */
        function accept(
          state: Live,
          input: Delivery,
        ): Effect.Effect<{ readonly answer: Sent; readonly jobs: ReadonlyArray<Dispatched> }, RunnerFailure> {
          return Effect.gen(function* () {
            if (
              brainOnly({ stream: `${process.name}/inbox`, id: input.id, tag: "send" }) ||
              hasParent(input.envelope.input)
            ) {
              return { answer: Sent.cases.refused.make({ reason: "bad_msg" }), jobs: [] };
            }

            const prior = (yield* store.placed(input.id)) ?? (yield* store.placedByAny(input.id));

            if (prior !== null) {
              const letter = yield* Stream.runHead(mailbox.read(process.name, prior.rev - 1));

              if (
                Option.exists(
                  letter,
                  (l) => l.id === input.id && (l.by !== input.envelope.by.key || l.for !== input.envelope.by.for),
                )
              ) {
                return { answer: Sent.cases.refused.make({ reason: "id_reused" }), jobs: [] };
              }

              return { answer: Sent.cases.accepted.make({ rev: prior.rev, pos: prior.pos }), jobs: [] };
            }

            if ((yield* ended) || state.cmds.some((job) => exits(state, job))) {
              return { answer: Sent.cases.refused.make({ reason: "ended" }), jobs: [] };
            }

            const port = inputPort(state, input.envelope.input);

            if (port === undefined || !port.write || (port.personOnly && input.envelope.by._tag !== "person")) {
              return { answer: Sent.cases.refused.make({ reason: "bad_msg" }), jobs: [] };
            }

            const m = stamp(input.envelope.input, input.envelope.id);

            const receipt: Receipt = {
              letter: input.id,
              input: yield* Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
                Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
              ),
              digest: yield* inputDigest(input),
              errors: [],
              tries: 0,
              result: null,
              process: process.id,
            };
            const preparation = yield* Effect.result(
              step(
                "step",
                input.id,
                () =>
                  Effect.gen(function* () {
                    const j = (yield* currentRecovery).journal;

                    if (j._tag !== "checking") {
                      return yield* new LedgerError({ reason: "bad_row" });
                    }

                    const seq = j.attempt.seq;
                    // Port and fresh checks share the same saved attempt and model.
                    const valid = yield* state.loaded.execution.admit(m);

                    // Only the host knows this process's trusted binding; a target literal cannot prove it.
                    if (valid && process.program === "fabrika/chaos") {
                      const start = Schema.decodeUnknownOption(
                        Schema.Struct({ type: Schema.Literal("start"), ...Chaos.Start.fields }),
                      )(m);

                      if (
                        Option.isSome(start) &&
                        (start.value.target.name === process.name || start.value.target.process === process.id)
                      ) {
                        yield* complete({ type: "abandoned", seq });
                        yield* continueRecovery();
                        return Step.cases.refused.make({ reason: "bad_target" });
                      }
                    }

                    const admission = valid
                      ? yield* state.loaded.execution.fresh(state.model, m)
                      : Admission.cases.invalid.make({});

                    if (admission._tag === "admitted") {
                      yield* complete({ type: "admitted", seq, receipt });
                      return yield* state.loaded.execution.update(state.model, m);
                    }

                    const parent = Schema.decodeUnknownOption(InputId)(input.envelope.id);

                    if (admission._tag === "invalid" || Option.isNone(parent)) {
                      yield* complete({ type: "abandoned", seq });
                      yield* continueRecovery();
                      return Step.cases.refused.make(admission._tag === "invalid" ? { reason: "bad_msg" } : admission);
                    }

                    yield* complete({
                      type: "refused",
                      seq,
                      reply: {
                        name: process.name,
                        id: input.id,
                        parent: parent.value,
                        by: input.envelope.by.key,
                        for: input.envelope.by.for,
                        digest: yield* inputDigest(input),
                        answer: Step.cases.refused.make(admission),
                      },
                    });
                    yield* continueRecovery();
                    const kept = yield* replies.reply(process.name, input.id);

                    if (kept === null) {
                      return yield* new LedgerError({ reason: "bad_row" });
                    }

                    return kept.answer;
                  }),
                receipt,
              ),
            );

            if (Result.isFailure(preparation)) {
              const terminal = supervision?.receipts.find((r) => r.letter === input.id)?.result;

              if (
                preparation.failure instanceof ProgramDown &&
                preparation.failure.source === undefined &&
                terminal !== null &&
                terminal !== undefined &&
                supervision !== null &&
                supervision.journal._tag !== "writing_dead" &&
                supervision.journal._tag !== "writing_exit"
              ) {
                return { answer: Sent.cases.refused.make({ reason: "dead" }), jobs: [] };
              }

              return yield* Effect.fail(preparation.failure);
            }

            const prepared = preparation.success;

            if (prepared._tag === "refused") {
              const { _tag: _case, ...reason } = prepared;
              return { answer: Sent.cases.refused.make(reason), jobs: [] };
            }

            // Reading an old delivery never authorizes a new write with a legacy input ID.
            const incoming = yield* Schema.decodeUnknownEffect(Incoming)(input).pipe(
              Effect.mapError((cause) => new RunnerError({ reason: "bad_input", cause })),
            );
            yield* store.save(checkpoint(state, Turn.cases.prepared.make({ id: input.id })));
            const appended = yield* checked.append(incoming);

            if (appended._tag === "refused") {
              yield* store.save(checkpoint(state, null));
              return { answer: Sent.cases.refused.make({ reason: appended.reason }), jobs: [] };
            }

            // The inbox now holds the accepted input. Failed deliveries keep their original body.
            if (supervision !== null) {
              const receipt = supervision.receipts.find((r) => r.letter === input.id);

              if (receipt !== undefined && receipt.tries === 0) {
                yield* send({
                  type: "compacted",
                  letter: input.id,
                  digest: receipt.digest ?? (yield* inputDigest(input)),
                });
              }
            }

            const { fresh } = yield* catchUp(state, { mine: input.id, dirty: true });
            return {
              answer: Sent.cases.accepted.make({ rev: appended.rev, pos: appended.pos }),
              jobs: fresh,
            };
          });
        }
      }),
    );
}

/**
 * Error for a call the runner refuses before the program sees it.
 *
 * **Details**
 *
 * `bad_input` is a delivery that does not decode, or a restart request that reuses an `id` with
 * another build. `bad_client` is a watcher's client id that is empty or over 256 characters.
 *
 * @stability unstable
 * @category errors
 */
export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
  reason: Schema.Literals(["bad_input", "bad_client"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

type RunnerFailure =
  | LedgerError
  | RecoveryStoreError
  | SessionManagerError
  | ProgramDown
  | RunnerError
  | SinkError
  | ProcessError
  | NotGranted
  | RepliesError
  | WatchersError;

/** Why a checked write did not land: a refusal, or a fault in the ledger or the session table. */
type WriteFailure = LedgerError | SessionManagerError | SigningRefused | NotGranted;

const cmdType = (job: Dispatched): string =>
  Option.match(decodeTyped(job.cmd), { onNone: () => "", onSome: (c) => c.type });

const hasParent = (m: unknown): boolean => typeof m === "object" && m !== null && "parent" in m;

const stamp = (m: unknown, parent: string): unknown => (typeof m === "object" && m !== null ? { ...m, parent } : m);

const inputPort = (state: Live, m: unknown) =>
  Option.match(decodeTyped(m), {
    onNone: () => undefined,
    onSome: ({ type }) => {
      const inputs = state.loaded.declaration.inputs;
      return Object.hasOwn(inputs, type) ? inputs[type] : undefined;
    },
  });

const isEvent = (u: Readonly<Record<string, Schema.Json>>): u is Event => typeof u._tag === "string";

/** An Err outcome's tag, when its error is tagged. */
const errTag = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;
