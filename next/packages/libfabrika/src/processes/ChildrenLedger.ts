/**
 * The `Children` layer that starts and stops a child on the ledger.
 *
 * The answer is a function of the start id's state and the process table, read in one ledger turn:
 * a saved id answers its `started` forever, and an unsaved one is asked afresh. Only the write turn
 * writes, and it is `ProcessManager.start`'s own: the name's registration, its `started` line at
 * the start's id and its first letter, in one turn. Whatever that turn answers, the start reads
 * again once. A stop is checked in one turn and ended in `ProcessManager.exit`'s own.
 *
 * @stability unstable
 */
import { Cause, Effect, Equal, Exit, Layer, Option, Result, Schema, Tracer } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { short } from "../telemetry/Trace.ts";
import { Child, Children, ChildrenError, type ChildStop, INPUT_BYTES, type StartGrant, Started } from "./Children.ts";
import { ExitReason } from "./ExitReason.ts";
import { type From, inbox, letterLine } from "./Mailbox.ts";
import { ProcessError, ProcessName, type ProcessTable, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

const tag = (word: string): string => `fab.children.${word}`;

const decodeChild = Schema.decodeUnknownResult(Child);
const isName = Schema.is(ProcessName);
const decodeLetter = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Json }));

const refuse = (reason: Exclude<ChildrenError["reason"], "storage">) => new ChildrenError({ reason });
const storage = (cause: LedgerError) => new ChildrenError({ reason: "storage", cause });

/** The first letter's id in the child's inbox. */
const letterId = (id: string): string => JSON.stringify(["start", id]);

const encoder = new TextEncoder();

/** Whether the first letter's row fits, counted as the ledger counts it, so it is judged at decode. */
const fits = (child: Child, from: From, m: Schema.Json): boolean => {
  const line = letterLine(from, m);
  const texts = [inbox(child.name), letterId(child.id), line.by, line.for, line.sentAt, line.parent];
  return (
    [...texts, line.traceId, line.build, line._tag, JSON.stringify(line.body)].reduce(
      (n, text) => n + (text === null ? 0 : encoder.encode(text).length),
      0,
    ) <= INPUT_BYTES
  );
};

/**
 * The checks after decoding, in one turn and in this order: a saved start, the requester, the
 * member's permission or, with no member's letter behind the start, the grant, then whereis.
 * `none` is a free name the write turn may take.
 */
const answer = (
  table: ProcessTable,
  turn: LedgerTurn,
  child: Child,
  granted: (source: string, to: string) => boolean,
): Option.Option<Result.Result<Started, ChildrenError>> => {
  const saved = Option.getOrUndefined(table.saved(child.id));

  if (saved !== undefined) {
    const letter = [...turn.read(inbox(saved.name), 0)].find((e) => e.id === letterId(child.id));
    const m = letter === undefined ? Option.none() : Option.map(decodeLetter(letter.body), (body) => body.m);
    // The caller fields: name, program, requester and input, never the hash, so a rebuild retries alike.
    const same =
      saved.request._tag === "first" &&
      saved.name === child.name &&
      saved.request.code.program === child.code.program &&
      saved.request.requester?._tag === "process" &&
      saved.request.requester.process === child.requester.process &&
      (child.input === undefined ? Option.isNone(m) : Option.exists(m, (value) => Equal.equals(value, child.input)));
    return Option.some(
      same
        ? Result.succeed(Started.cases.started.make({ process: saved.state.process, name: saved.name, rev: saved.rev }))
        : Result.fail(refuse("id_reused")),
    );
  }

  const requester = Option.getOrUndefined(table.life(child.requester.process));

  if (requester === undefined || !table.isLive(child.requester.process)) {
    return Option.some(Result.fail(refuse("stale_sender")));
  }

  // A start a member's letter caused is the member's (0170); the requester's program holds no grant
  // for it. An ungranted start learns nothing of a name, its own included.
  if (!(child.permitted ?? granted(requester.state.code.program, child.code.program))) {
    return Option.some(Result.fail(refuse("forbidden")));
  }

  return Option.map(table.whereis(child.name), ({ program, state }) => {
    const life = { process: state.process, name: child.name };
    return program !== child.code.program
      ? Result.fail(refuse("name_taken"))
      : Result.succeed(
          state._tag === "live" ? Started.cases.already_started.make(life) : Started.cases.already_present.make(life),
        );
  });
};

/**
 * A stop's checks, in one turn: the name must be a child the requester's name started, then live.
 * Answers the child's life to end.
 */
const stopped = (table: ProcessTable, stop: ChildStop): Result.Result<string, ChildrenError> => {
  const requester = Option.getOrUndefined(table.life(stop.requester.process));
  const own =
    isName(stop.name) &&
    requester !== undefined &&
    Option.exists(table.starter(stop.name), (name) => name === requester.name);
  const current = own ? Option.getOrUndefined(table.whereis(stop.name)) : undefined;

  if (current === undefined) {
    return Result.fail(refuse("not_child"));
  }

  return current.state._tag === "live" ? Result.succeed(current.state.process) : Result.fail(refuse("noproc"));
};

/** Keeps a storage failure's cause with the caller: every nested span records only the safe reason,
 *  and a defect is replaced by a plain one with no detail. */
const guarded = <A>(work: Effect.Effect<A, ChildrenError>, defect: string) =>
  Effect.gen(function* () {
    const tracer = yield* Tracer.Tracer;
    const safe = Tracer.make({
      context: tracer.context,
      span(options) {
        const span = tracer.span(options);
        const attribute = span.attribute.bind(span);
        span.attribute = (key, value) => {
          if (key !== "fab.ledger.code") {
            attribute(key, key === "error.type" ? "ChildrenError" : value);
          }
        };
        const end = span.end.bind(span);
        span.end = (time, exit) => {
          const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
          end(
            time,
            Exit.isSuccess(exit)
              ? exit
              : Exit.fail(
                  new ChildrenError({
                    reason:
                      Option.isSome(error) && error.value instanceof ChildrenError ? error.value.reason : "storage",
                  }),
                ),
          );
        };
        return span;
      },
    });
    return yield* work.pipe(
      Effect.withTracer(safe),
      Effect.catchCause((cause) => (Cause.hasDies(cause) ? Effect.die(new Error(defect)) : Effect.failCause(cause))),
    );
  });

/**
 * Layer that provides `Children` on the ledger, through `LedgerTransaction` and `ProcessManager`.
 *
 * **Details**
 *
 * `grants` is the host's closed list of which program may start which. A start is judged in this
 * order: the name, the rest of the request, a saved `id`, a live requester, the permission, then
 * the name's current holder. The permission is the member's verdict the start carries, or, with
 * none, the grant. A start with neither is refused `forbidden` before it can learn whether a name
 * exists.
 *
 * A stop ends the child with `shutdown` through `ProcessManager.exit`, which writes each watcher's
 * `DOWN`. A child that ends between the check and the exit is `noproc`.
 *
 * **Gotchas**
 *
 * A storage failure's cause goes to the caller only. The spans of a start record the reason and
 * never the cause, and a defect inside a start is replaced by a plain one with no detail.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (config: {
  readonly grants: ReadonlyArray<typeof StartGrant.Type>;
}): Layer.Layer<Children, never, LedgerTransaction | ProcessManager> =>
  Layer.effect(
    Children,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const manager = yield* ProcessManager;
      const granted = (source: string, to: string) => config.grants.some((g) => g.source === source && g.to === to);
      const look = (child: Child) =>
        tx.transact((turn) => answer(manager.table(turn), turn, child, granted)).pipe(Effect.mapError(storage));

      const start = Effect.fn("children.start")(
        function* (input: Child, from: From) {
          // Decode first: the name is judged before any other field.
          if (!isName((input as { readonly name?: unknown } | undefined)?.name)) {
            return yield* refuse("bad_name");
          }

          const decoded = decodeChild(input);

          if (
            Result.isFailure(decoded) ||
            (decoded.success.input !== undefined && !fits(decoded.success, from, decoded.success.input))
          ) {
            return yield* refuse("bad_input");
          }

          const child = decoded.success;
          yield* Effect.annotateCurrentSpan(
            short({
              [tag("name")]: child.name,
              [tag("program")]: child.code.program,
              [tag("hash")]: child.code.hash,
            }),
          );

          // Two passes at most: after the write turn the id is saved, the name is taken, or the
          // requester has ended, so the second pass always answers.
          for (let pass = 1; ; pass++) {
            const found = yield* look(child);

            if (Option.isSome(found)) {
              return yield* Effect.fromResult(found.value);
            }

            if (pass > 1) {
              return yield* Effect.die(new Error("a start found its name free after its write turn"));
            }

            // Placed or refused, the next pass reads what the write turn left.
            yield* manager
              .start(
                Start.cases.first.make({
                  id: child.id,
                  name: child.name,
                  code: child.code,
                  requester: child.requester,
                }),
                from,
                ...(child.input === undefined ? [] : [{ m: child.input }]),
              )
              .pipe(
                Effect.catch((error) =>
                  error instanceof ProcessError
                    ? Effect.void
                    : // The ledger refuses a first letter over its row limit, and the whole turn with it.
                      Effect.fail(error.reason === "refused" ? refuse("bad_input") : storage(error)),
                ),
              );
          }
        },
        Effect.tap((started) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: started._tag, "fab.process": started.process }),
        ),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );
      const stop = Effect.fn("children.stop")(
        function* (asked: ChildStop, from: From) {
          yield* Effect.annotateCurrentSpan(short({ [tag("name")]: asked.name }));
          const child = yield* tx
            .transact((turn) => stopped(manager.table(turn), asked))
            .pipe(Effect.mapError(storage), Effect.flatMap(Effect.fromResult));
          yield* manager
            .exit(child, ExitReason.cases.shutdown.make({}), from)
            .pipe(
              Effect.catch((error) =>
                error instanceof ProcessError
                  ? error.reason === "ended"
                    ? Effect.fail(refuse("noproc"))
                    : Effect.die(new Error(`a stop's exit was refused: ${error.reason}`))
                  : Effect.fail(storage(error)),
              ),
            );
        },
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );
      return Children.of({
        start: (input, from) => guarded(start(input, from), "children.start failed"),
        stop: (asked, from) => guarded(stop(asked, from), "children.stop failed"),
      });
    }),
  );
