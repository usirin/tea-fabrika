// Starting a child on the ledger, next/ (P42 slice 1). The answer is a function of the start id's
// state and the process table, read in one ledger turn: a saved id answers its `started` forever,
// an unsaved one is asked afresh, in the plan's order. Only the write turn writes, and it is
// `ProcessManager.start`'s own: the name's registration, its `started` line at the start's id and
// its first letter, in one turn. Whatever that turn answers, the start reads again once.
import { Cause, Effect, Equal, Exit, Layer, Option, Result, Schema, Tracer } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { short } from "../telemetry/Trace.ts";
import { Child, Children, ChildrenError, INPUT_BYTES, type StartGrant, Started } from "./Children.ts";
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
 * Steps 2 to 5 of the plan in one turn: a saved start, the requester, the grant, then whereis.
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

  // An ungranted program learns nothing of a name, its own included.
  if (!granted(requester.state.code.program, child.code.program)) {
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
      return Children.of({
        start: Effect.fnUntraced(function* (input, from) {
          const tracer = yield* Tracer.Tracer;
          // Storage causes stay with the caller. Every nested span records only the safe reason.
          const safe = Tracer.make({
            context: tracer.context,
            span(options) {
              const span = tracer.span(options);
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
                            Option.isSome(error) && error.value instanceof ChildrenError
                              ? error.value.reason
                              : "storage",
                        }),
                      ),
                );
              };
              return span;
            },
          });
          return yield* start(input, from).pipe(
            Effect.withTracer(safe),
            Effect.catchCause((cause) =>
              Cause.hasDies(cause) ? Effect.die(new Error("children.start failed")) : Effect.failCause(cause),
            ),
          );
        }),
      });
    }),
  );
