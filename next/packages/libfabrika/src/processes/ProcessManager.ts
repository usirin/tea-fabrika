/**
 * The process manager: the one writer of process lifecycle events, after OTP's process calls.
 *
 * It starts and ends processes, keeps watches and writes their `DOWN` letters. Every line it
 * writes carries the brain's own writer key, and the process table trusts no other.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Option, Result, Schema, Stream } from "effect";
import { type Ledger, type LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { lineFor } from "../ledger/Log.ts";
import type { Rev } from "../Rev.ts";
import { short } from "../telemetry/Trace.ts";
import { decodeExitReason, type ExitReason } from "./ExitReason.ts";
import { processMail } from "./internal/processMail.ts";
import { type From, inbox, type Letter, letterLine, Mailbox } from "./Mailbox.ts";
import {
  type Caller,
  clientInbox,
  Dead,
  DeadInput,
  Down,
  NoProc,
  ProcessError,
  ProcessEvent,
  type ProcessInfo,
  ProcessTable,
  signalId,
  type Start,
  type StartAnswer,
  type State,
} from "./Process.ts";

const tag = (word: string): string => `fab.process.${word}`;
const id = (...parts: ReadonlyArray<Schema.Json>): string => JSON.stringify(parts);
const Send = Schema.TaggedStruct("send", { m: Down });
type Policy = { readonly reason: string; readonly crashes: number; readonly until: number };
type Failure = ProcessError | LedgerError;
/**
 * Trusted wiring, never decoded from public params: who calls, and `by`, the brain's own writer
 * key. Every event this manager writes carries that `by`, and its fold trusts no other.
 */
type Wiring = Caller & { readonly by: string };

const failed = Effect.fnUntraced(function* (error: Failure) {
  yield* Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason });
});

/**
 * Service that starts, ends and watches processes, and writes every process lifecycle event.
 *
 * **Details**
 *
 * Each call reads the process table and writes what it decides in one ledger turn, so no decision
 * rests on a read that has gone stale. A call repeated after it was saved answers the same and
 * adds no second line. A refusal fails with `ProcessError` and writes nothing; a ledger fault
 * fails with `LedgerError`.
 *
 * **Gotchas**
 *
 * The caller is trusted wiring, fixed when the layer is built. `exit`, `down`, `dead`, `status`,
 * `resolve` and a restart are refused `not_parent` unless that caller's `owner` registered the
 * name. A watch delivers to that caller's `recipient`.
 *
 * @stability unstable
 * @category services
 */
export class ProcessManager extends Context.Service<
  ProcessManager,
  {
    /**
     * Places a new process: the first under a free name, or the next after one that ended. `first`
     * is a child's first letter, written in the start's own turn, at `["start", id]`.
     */
    readonly start: (
      request: Start,
      from: From,
      first?: { readonly m: Schema.Json },
    ) => Effect.Effect<StartAnswer, Failure>;
    /**
     * Ends a live process with `reason`, writes a `DOWN` to each of its watchers, and ends the
     * watches the process itself held.
     */
    readonly exit: (process: string, reason: ExitReason, from: From) => Effect.Effect<void, Failure>;
    /** Every live process. */
    readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, LedgerError>;
    /** A name's current state and its restart times, with `at`, the clock when the answer was made. */
    readonly status: (name: string) => Effect.Effect<
      {
        readonly name: string;
        readonly state: typeof State.Type;
        readonly at: number;
        readonly restarts: ReadonlyArray<number>;
      },
      Failure
    >;
    /**
     * The name a process id belongs to, with that name's current state, which may already be a
     * newer process than the one asked about.
     */
    readonly resolve: (
      process: string,
    ) => Effect.Effect<{ readonly name: string; readonly state: typeof State.Type }, Failure>;
    /** Writes a letter that reached its delivery limit to `<process>/dead`, once per letter. */
    readonly dead: (process: string, dead: typeof DeadInput.Type, from: From) => Effect.Effect<void, Failure>;
    readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
    /**
     * Watches `process` under the caller's own `ref`. A target that is not live gets its `DOWN`,
     * with `noproc`, in the same turn.
     */
    readonly monitor: (ref: string, process: string, from: From) => Effect.Effect<void, Failure>;
    /** Cancels the caller's own live watch under `ref`. With no such watch it writes nothing. */
    readonly demonitor: (ref: string, from: From) => Effect.Effect<void, Failure>;
    /**
     * A live process's letters past the log rev `after`, oldest first. A `DOWN` signal whose watch
     * was canceled, or that is for another recipient, is left out.
     */
    readonly receive: (process: string, after: Rev) => Stream.Stream<Letter, Failure>;
    /**
     * Writes that a supervisor gave up on a process that is no longer live: the reason, the crash
     * count, and the time it waits until.
     */
    readonly down: (process: string, policy: Policy, from: From) => Effect.Effect<void, Failure>;
    /**
     * The process table inside one ledger turn, trusting only the brain's lines, for a caller that
     * decides and writes in that turn, as a child's start does.
     */
    readonly table: (turn: LedgerTurn) => ProcessTable;
  }
>()("@kampus/libfabrika/processes/ProcessManager") {
  static readonly layer = (
    caller: Wiring,
    nextId: Effect.Effect<string>,
  ): Layer.Layer<ProcessManager, never, LedgerTransaction> =>
    Layer.effect(
      ProcessManager,
      Effect.gen(function* () {
        const tx = yield* LedgerTransaction;
        const fold = (turn: LedgerTurn) => ProcessTable.read(turn.read, caller.by);
        // The brain writes every line here; `from` keeps the call's person, parent and trace, and
        // `asked` keeps the caller's own key. The fold trusts `by` alone and never reads `asked`.
        const line = (from: From, event: Parameters<typeof lineFor>[1]) =>
          lineFor({ ...from, by: caller.by }, { ...event, asked: from.by });
        const checked = Effect.fnUntraced(function* <A>(
          step: (table: ProcessTable, turn: LedgerTurn) => Result.Result<A, ProcessError>,
        ) {
          return yield* Effect.fromResult(yield* tx.transact((turn) => step(fold(turn), turn)));
        });
        const signal = (
          table: ProcessTable,
          turn: LedgerTurn,
          watch: { readonly ref: string; readonly round: number },
          process: string,
          reason: (typeof Down.Type)["reason"],
          to: (typeof Down.Type)["to"],
          from: From,
        ) => {
          const { ref, round } = watch;
          const inbox =
            to._tag === "client" ? clientInbox(to.client) : `${Option.getOrThrow(table.life(to.process)).name}/inbox`;
          const letter = signalId(to, ref, round);

          // A retried call may find this signal already written. Only the brain's own row counts;
          // another writer's row at this id makes the append refuse, and the whole turn with it.
          if ([...turn.read(inbox, 0)].some((entry) => entry.id === letter && entry.by === caller.by)) {
            return;
          }

          turn.append(inbox, letter, line(from, Send.make({ m: Down.make({ ref, process, reason, to }) })));
        };
        const start = Effect.fn("process.start")(function* (
          request: Start,
          from: From,
          first?: { readonly m: Schema.Json },
        ) {
          yield* Effect.annotateCurrentSpan(
            short({
              [tag("name")]: request.name,
              [tag("program")]: request.code.program,
              [tag("hash")]: request.code.hash,
            }),
          );
          const saved = yield* checked((table) => table.start(request, caller, from));
          const answer = Option.isSome(saved)
            ? saved.value
            : yield* Effect.gen(function* () {
                const process = yield* nextId;
                return yield* checked((table, turn) => {
                  const current = table.start(request, caller, from);

                  if (Result.isFailure(current)) {
                    return Result.fail(current.failure);
                  }

                  if (Option.isSome(current.success)) {
                    return Result.succeed(current.success.value);
                  }

                  if (table.collision(process)) {
                    return Result.fail(new ProcessError({ reason: "id_collision" }));
                  }

                  if (request._tag === "first") {
                    turn.append(
                      ProcessTable.stream,
                      id("registered", request.name),
                      line(
                        from,
                        ProcessEvent.cases.registered.make({
                          name: request.name,
                          program: request.code.program,
                          owner: caller.owner,
                        }),
                      ),
                    );
                  }

                  const placed = turn.append(
                    ProcessTable.events(request.name),
                    request.id,
                    line(
                      from,
                      ProcessEvent.cases.started.make({
                        process,
                        name: request.name,
                        ...request.code,
                        ...(request._tag === "first" && request.requester !== undefined
                          ? { requester: request.requester }
                          : {}),
                      }),
                    ),
                  );

                  // The first letter keeps the caller's own `from`: it is the requester's mail, not the brain's.
                  if (first !== undefined) {
                    turn.append(inbox(request.name), id("start", request.id), letterLine(from, first.m));
                  }

                  if (request._tag === "again") {
                    turn.append(
                      ProcessTable.events(request.name),
                      id("restarted", process),
                      line(
                        from,
                        ProcessEvent.cases.restarted.make({
                          process,
                          after: request.after,
                          name: request.name,
                          reason: request.reason,
                          build: request.code.hash,
                        }),
                      ),
                    );
                  }

                  return Result.succeed({ process, rev: placed.rev });
                });
              });
          yield* Effect.annotateCurrentSpan({
            "fab.process": answer.process,
            [tag("answer")]: "placed",
            [tag("rev")]: answer.rev,
          });
          return answer;
        }, Effect.tapError(failed));
        const exit = Effect.fn("process.exit")(function* (process: string, input: ExitReason, from: From) {
          yield* Effect.annotateCurrentSpan({ "fab.process": process });
          // The reason is decoded before the turn opens: text, an unknown tag or noproc writes nothing.
          const reason = yield* Effect.fromResult(decodeExitReason(input)).pipe(
            Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
          );
          yield* checked((table, turn) => {
            const life = table.exit(process, reason, caller.owner);

            if (Result.isFailure(life)) {
              return Result.fail(life.failure);
            }

            if (life.success.state._tag !== "live") {
              return Result.succeed(undefined);
            }

            turn.append(
              ProcessTable.events(life.success.name),
              id("exited", process),
              line(from, ProcessEvent.cases.exited.make({ process, reason })),
            );

            for (const watch of table.inbound(process)) {
              signal(table, turn, watch, process, reason, watch.to, from);
            }

            for (const watch of table.outbound(process)) {
              turn.append(
                ProcessTable.stream,
                id("demonitored", watch.to, watch.ref, watch.round),
                line(
                  from,
                  ProcessEvent.cases.demonitored.make({
                    ref: watch.ref,
                    to: watch.to,
                    reason: "watcher_exited",
                  }),
                ),
              );
            }

            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const monitor = Effect.fn("process.monitor")(function* (ref: string, process: string, from: From) {
          yield* Effect.annotateCurrentSpan({
            "fab.process": process,
            ...short({ [tag("ref")]: ref }),
          });
          yield* checked((table, turn) => {
            const round = table.monitor(ref, process, caller.recipient);

            if (Result.isFailure(round)) {
              return Result.fail(round.failure);
            }

            if (Option.isNone(round.success)) {
              return Result.succeed(undefined);
            }

            turn.append(
              ProcessTable.stream,
              id("monitored", caller.recipient, ref, round.success.value),
              line(from, ProcessEvent.cases.monitored.make({ ref, process, to: caller.recipient })),
            );

            if (!table.isLive(process)) {
              signal(
                table,
                turn,
                { ref, round: round.success.value },
                process,
                NoProc.make({}),
                caller.recipient,
                from,
              );
            }

            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const demonitor = Effect.fn("process.demonitor")(function* (ref: string, from: From) {
          yield* Effect.annotateCurrentSpan(short({ [tag("ref")]: ref }));
          yield* checked((table, turn) => {
            const watch = table.demonitor(ref, caller.recipient);

            if (Option.isSome(watch)) {
              turn.append(
                ProcessTable.stream,
                id("demonitored", caller.recipient, ref, watch.value.round),
                line(
                  from,
                  ProcessEvent.cases.demonitored.make({
                    ref,
                    to: caller.recipient,
                    reason: "canceled",
                  }),
                ),
              );
            }

            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const down = Effect.fn("process.down")(function* (process: string, policy: Policy, from: From) {
          yield* Effect.annotateCurrentSpan({ "fab.process": process });
          yield* checked((table, turn) => {
            const life = table.down(process, policy.reason, caller.owner);

            if (Result.isFailure(life)) {
              return Result.fail(life.failure);
            }

            turn.append(
              ProcessTable.events(life.success.name),
              id("down", process, policy),
              line(from, ProcessEvent.cases.down.make({ process, ...policy })),
            );
            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const receive = (process: string, after: Rev): Stream.Stream<Letter, Failure> =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ "fab.process": process, [tag("after")]: after });
              const mail = yield* checked((table, turn) => {
                const life = table.life(process);

                if (Option.isNone(life) || !table.isLive(process)) {
                  return Result.fail(new ProcessError({ reason: "ended" }));
                }

                return Result.succeed(processMail(table, process, turn.read(`${life.value.name}/inbox`, after)));
              });
              const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
              yield* Effect.annotateCurrentSpan({
                [tag("letters")]: mail.length,
                ...(mail.length === 0
                  ? {}
                  : { [tag("lag")]: Math.max(...mail.map(({ arrivedAt }) => now - arrivedAt)) }),
              });
              return Stream.fromIterable(mail.map(({ letter }) => letter));
            }).pipe(Effect.tapError(failed)),
          ).pipe(Stream.withSpan("process.receive"));
        const info = Effect.fn("process.info")(function* () {
          return yield* tx.transact((turn) => fold(turn).info);
        });
        return {
          resolve: Effect.fn("process.resolve")(function* (process: string) {
            return yield* checked((table) => {
              const old = table.parent(process, caller.owner);
              return Result.isFailure(old) ? Result.fail(old.failure) : table.status(old.success.name, caller.owner);
            });
          }),
          status: Effect.fn("process.status")(function* (name: string) {
            const status = yield* checked((table) => table.status(name, caller.owner));
            return { ...status, at: yield* Effect.clockWith((clock) => clock.currentTimeMillis) };
          }),
          dead: Effect.fn("process.dead")(function* (process: string, dead: typeof DeadInput.Type, from: From) {
            const input = yield* Schema.decodeUnknownEffect(DeadInput)(dead).pipe(
              Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
            );
            yield* checked((table, turn) => {
              const life = table.parent(process, caller.owner);

              if (Result.isFailure(life)) {
                return Result.fail(life.failure);
              }

              const value = Dead.make({
                ...input,
                process: life.success.state.process,
                program: life.success.state.code.program,
                name: life.success.name,
              });
              const stream = `${process}/dead`;
              const key = id("dead", process, value.m);
              const prior = [...turn.read(stream, 0)].find((entry) => entry.id === key && entry.by === caller.by);

              if (prior === undefined) {
                turn.append(stream, key, line(from, value));
              }

              return Result.succeed(undefined);
            });
          }),
          start,
          exit,
          monitor,
          demonitor,
          down,
          receive,
          table: fold,
          info: info(),
          isLive: Effect.fn("process.isLive")(function* (process: string) {
            return yield* tx.transact((turn) => fold(turn).isLive(process));
          }),
        };
      }),
    );
}

/**
 * The manager's calls as plain Effects, for a manager another object owns, such as the Worker's
 * Project. A receive collects its letters so the call can cross an RPC; the Stream is rebuilt here.
 * Refusals keep their ProcessError; a transport failure stays the caller's LedgerError.
 */
export type ProcessCalls = Omit<Context.Service.Shape<typeof ProcessManager>, "receive" | "table"> & {
  readonly receive: (process: string, after: Rev) => Effect.Effect<ReadonlyArray<Letter>, Failure>;
};

/** `by` is the brain's own writer key: a turn this side is given folds as the brain's does. */
export const remoteProcessManager = (calls: ProcessCalls, by: string): Layer.Layer<ProcessManager> =>
  Layer.succeed(ProcessManager, {
    ...calls,
    table: (turn) => ProcessTable.read(turn.read, by),
    receive: (process, after) =>
      Stream.unwrap(Effect.map(calls.receive(process, after), (letters) => Stream.fromIterable(letters))),
  });

/**
 * Layer that provides `Mailbox` and `ProcessManager` together, over one ledger.
 *
 * **Details**
 *
 * `caller` is trusted wiring: who calls, and the brain's own writer key. `nextId` makes the id of
 * each new process.
 *
 * @stability unstable
 * @category layers
 */
export const CoordinationLayer = (
  caller: Wiring,
  nextId: Effect.Effect<string>,
): Layer.Layer<Mailbox | ProcessManager, never, Ledger | LedgerTransaction> =>
  Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, nextId));
