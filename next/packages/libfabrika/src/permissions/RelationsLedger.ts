/**
 * The relations store on the ledger stream `permissions/relations`.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Effect, Layer, Result, Schema } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { type Line, lineFor, valueFor } from "../ledger/Log.ts";
import { relations, seal } from "./internal/relationsTable.ts";
import { type Change, Row, STREAM, type Tuples } from "./Relation.ts";
import { Relations, RelationsError } from "./Relations.ts";

const known: ReadonlySet<string> = new Set(Object.keys(Row.cases));
const decodeRow = Schema.decodeUnknownResult(Row);

/** A ledger failure as the store's own error, its cause kept (0043). */
const translate = (error: LedgerError): RelationsError =>
  new RelationsError({
    reason: error.reason === "refused" ? "refused" : error.reason === "bad_row" ? "bad_row" : "storage",
    cause: error,
  });

/**
 * Layer that provides `Relations` on the ledger, trusting only the rows `by` wrote.
 *
 * **Details**
 *
 * `within` reads the whole stream in the caller's turn and steps the relations machine once per
 * row, in the referee's order. It skips an entry whose `by` is not `by`, so a program's write to
 * the stream changes nothing, and an entry whose case is not a row case. A row of the brain's that
 * does not decode fails with `bad_row`. `write` runs one `LedgerTransaction` turn and appends each
 * change under its id with `by` in place of the writer's own key: a resend is one line, and an id
 * reused with another row rolls the whole batch back as `refused`.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (config: {
  /** The brain's own key: the one writer the fold trusts and the `by` of every write. */
  readonly by: string;
}): Layer.Layer<Relations, never, LedgerTransaction> =>
  Layer.effect(
    Relations,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const { by } = config;

      const within = (turn: LedgerTurn): Result.Result<Tuples, RelationsError> => {
        let model = relations.init(null, undefined)[0];

        for (const entry of turn.read(STREAM, 0)) {
          if (entry.by !== by || !known.has(entry._tag)) {
            continue;
          }

          const row = decodeRow(valueFor(entry));

          if (Result.isFailure(row)) {
            return Result.fail(new RelationsError({ reason: "bad_row", cause: row.failure }));
          }

          model = applyCell(relations, model, { type: "recorded", row: row.success })[0];
        }

        return Result.succeed(seal(model));
      };

      const write = Effect.fn("relations.write")(function* (
        changes: ReadonlyArray<Change>,
        writer: Omit<Line, "_tag" | "body">,
      ) {
        yield* Effect.annotateCurrentSpan({ "fab.permissions.changes": changes.length });
        yield* tx
          .transact((turn) => {
            for (const change of changes) {
              turn.append(STREAM, change.id, lineFor({ ...writer, by }, change.row));
            }
          })
          .pipe(Effect.mapError(translate));
      });

      return { within, write };
    }),
  );
