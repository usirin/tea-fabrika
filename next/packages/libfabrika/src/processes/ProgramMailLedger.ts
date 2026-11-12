// Program mail on the ledger, next/ (P41 slice 1). One transaction saves the receipt in the source's
// outbox and the letter in the target's inbox, both under the command's `/mail` ID. A repeat answers
// the first receipt and appends nothing; a stale sender, a name outside the host's grant or a
// missing name writes nothing at all, and a send never registers or starts a name.
import { Effect, Equal, Layer, Option, Result, Schema } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { lineFor, valueFor } from "../ledger/Log.ts";
import { QuotaRefused } from "../ledger/WritePolicy.ts";
import { short } from "../telemetry/Trace.ts";
import { granted, mailId, businessRef } from "./internal/programMail.ts";
import { inbox, letterBody, letterLine } from "./Mailbox.ts";
import { ProcessError, ProcessTable, State } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";
import {
  type Delivery,
  type Grants,
  type MailRefusal,
  ProgramMail,
  ProgramMailError,
  type Receipt,
} from "./ProgramMail.ts";
import { Quotas } from "./Quotas.ts";

const tag = (word: string): string => `fab.mail.${word}`;

/** What the source's outbox keeps beside the letter: who sent it, to which life, under which grant. */
const Mailed = Schema.TaggedStruct("mailed", {
  command: Schema.String,
  source: Schema.Struct({ name: Schema.String, process: Schema.String }),
  to: Schema.Struct({ name: Schema.String, state: State }),
  ref: Schema.NullOr(Schema.String),
  grant: Schema.Struct({ source: Schema.String, to: Schema.String }),
});

const decodeMailed = Schema.decodeUnknownOption(Mailed);
const decodeSent = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Json }));

const outbox = (name: string): string => `${name}/outbox`;

const refuse = (reason: typeof MailRefusal.Type) => new ProgramMailError({ reason });
const storage = (cause: LedgerError) => new ProgramMailError({ reason: "storage", cause });

/** The saved receipt for this delivery's ID, or a refusal when the ID was first used otherwise. */
const saved = (
  turn: LedgerTurn,
  delivery: Delivery,
  m: Schema.Json,
): Option.Option<Result.Result<Receipt, ProgramMailError>> => {
  const id = mailId(delivery.command);
  const entry = [...turn.read(outbox(delivery.source.name), 0)].find((e) => e.id === id);

  if (entry === undefined) {
    return Option.none();
  }

  const mailed = decodeMailed(valueFor(entry));
  const letter = Option.flatMap(mailed, ({ to }) =>
    Option.fromUndefinedOr([...turn.read(inbox(to.name), 0)].find((e) => e.id === id)),
  );
  const body = Option.flatMap(letter, (l) => decodeSent(l.body));

  if (
    Option.isNone(mailed) ||
    Option.isNone(letter) ||
    Option.isNone(body) ||
    entry.by !== delivery.from.by ||
    mailed.value.to.name !== delivery.to ||
    !Equal.equals(body.value.m, m)
  ) {
    return Option.some(Result.fail(refuse("id_reused")));
  }

  const { command, source, to, ref, grant } = mailed.value;
  const l = letter.value;
  return Option.some(
    Result.succeed({
      id,
      command,
      source,
      to,
      m: body.value.m,
      ref,
      grant,
      from: {
        by: l.by,
        for: l.for,
        sentAt: l.sentAt,
        seen: l.seen,
        parent: l.parent,
        traceId: l.traceId,
        build: l.build,
      },
      arrivedAt: l.arrivedAt,
      rev: l.rev,
      pos: l.pos,
    }),
  );
};

/** The newest lifecycle rev of each name the send depends on: a change means look again. */
const heads = (turn: LedgerTurn, names: ReadonlyArray<string>): string =>
  JSON.stringify(
    [ProcessTable.stream, ...names.map(ProcessTable.events)].map(
      (stream) => [...turn.read(stream, 0)].at(-1)?.rev ?? 0,
    ),
  );

export const layer = (config: {
  readonly grants: Grants;
}): Layer.Layer<ProgramMail, never, LedgerTransaction | ProcessManager> =>
  Layer.effect(
    ProgramMail,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const quotas = Option.getOrUndefined(yield* Effect.serviceOption(Quotas));
      const manager = yield* ProcessManager;
      const transact = <A>(step: (turn: LedgerTurn) => A) =>
        tx
          .transact(step)
          .pipe(
            Effect.mapError((error) =>
              error.cause instanceof QuotaRefused
                ? refuse("quota")
                : error.reason === "refused"
                  ? refuse("bad_message")
                  : storage(error),
            ),
          );
      const lookup = (failure: ProcessError | LedgerError, refusal: typeof MailRefusal.Type) =>
        failure instanceof ProcessError ? refuse(refusal) : storage(failure);
      const deliver = Effect.fn("program_mail.deliver")(
        function* (delivery: Delivery) {
          yield* Effect.annotateCurrentSpan({
            ...short({
              [tag("command")]: delivery.command,
              [tag("to")]: delivery.to,
              [tag("source")]: delivery.source.name,
            }),
            "fab.process": delivery.source.process,
          });
          const m = letterBody(delivery.m);

          if (Option.isNone(m)) {
            return yield* refuse("bad_message");
          }

          // A saved receipt answers first, so a sender fenced since then still reads its own.
          const first = yield* transact((turn) => saved(turn, delivery, m.value));

          if (Option.isSome(first)) {
            return yield* Effect.fromResult(first.value);
          }

          const names = [delivery.source.name, delivery.to];

          for (;;) {
            const seen = yield* transact((turn) => heads(turn, names));
            const source = yield* manager
              .resolve(delivery.source.process)
              .pipe(Effect.mapError((e) => lookup(e, "stale_sender")));

            if (
              source.name !== delivery.source.name ||
              source.state._tag !== "live" ||
              source.state.process !== delivery.source.process
            ) {
              return yield* refuse("stale_sender");
            }

            if (!granted(config.grants, delivery.source.name, delivery.to)) {
              return yield* refuse("forbidden");
            }

            const target = yield* manager.status(delivery.to).pipe(Effect.mapError((e) => lookup(e, "no_name")));
            const committed = yield* transact((turn) => {
              const commit = () => {
                // A lifecycle write since the checks above: check again before anything is written.
                if (heads(turn, names) !== seen) {
                  return Option.none();
                }

                const prior = saved(turn, delivery, m.value);

                if (Option.isSome(prior)) {
                  return prior;
                }

                const id = mailId(delivery.command);
                turn.append(inbox(delivery.to), id, letterLine(delivery.from, m.value));
                turn.append(
                  outbox(delivery.source.name),
                  id,
                  lineFor(
                    delivery.from,
                    Mailed.make({
                      command: delivery.command,
                      source: { name: delivery.source.name, process: delivery.source.process },
                      to: { name: delivery.to, state: target.state },
                      ref: businessRef(m.value),
                      grant: { source: delivery.source.name, to: delivery.to },
                    }),
                  ),
                );
                return saved(turn, delivery, m.value);
              };
              return quotas === undefined ? commit() : quotas.ordinary(delivery.source.process, commit);
            });

            if (Option.isSome(committed)) {
              return yield* Effect.fromResult(committed.value);
            }
          }
        },
        Effect.tap((receipt) =>
          Effect.annotateCurrentSpan({
            [tag("answer")]: "queued",
            [tag("rev")]: receipt.rev,
            [tag("pos")]: receipt.pos,
          }),
        ),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );
      return ProgramMail.of({ deliver });
    }),
  );
