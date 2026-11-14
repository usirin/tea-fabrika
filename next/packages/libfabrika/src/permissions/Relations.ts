/**
 * The relations store: the live tuples inside a ledger turn, and the brain's writes of relation
 * rows. This file is the contract only (0095); its layers are `RelationsLedger` and
 * `RelationsMemory`.
 *
 * @stability unstable
 */
import { Context, Schema, type Effect, type Result } from "effect";
import type { LedgerTurn } from "../ledger/LedgerTransaction.ts";
import type { Line } from "../ledger/Log.ts";
import type { Change, Tuples } from "./Relation.ts";

/**
 * The error the relations store fails with.
 *
 * **Details**
 *
 * `bad_row`: a row the brain wrote does not decode. `refused`: the ledger refused a line of the
 * batch, so nothing of it was written. On the ledger that is any refusal the referee gives:
 * `id_reused` (an id already holds another row, or another writer's line), `seen_ahead`,
 * `too_big`, `bad_trace`, `bad_parent` or `bad_line`. The turn's `LedgerError`, kept as the cause,
 * says only `refused`, not which. The memory layer gives it for an id reused with another row.
 * `storage`: the ledger failed. The cause is kept.
 *
 * @stability unstable
 * @category errors
 */
export class RelationsError extends Schema.TaggedError<RelationsError>()("RelationsError", {
  reason: Schema.Literals(["bad_row", "refused", "storage"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service for relation rows: read the live tuples, and write rows as the brain.
 *
 * **Details**
 *
 * `within(turn)` folds the relation stream inside the caller's own ledger turn, so a check and the
 * write it allows see the same rows. `write(changes, writer)` writes each change once, by its id,
 * in one turn: the batch lands whole or not at all.
 *
 * **Gotchas**
 *
 * The memory layer ignores the turn and answers from its own changes.
 *
 * @stability unstable
 * @category services
 */
export class Relations extends Context.Service<
  Relations,
  {
    readonly within: (turn: LedgerTurn) => Result.Result<Tuples, RelationsError>;
    readonly write: (
      changes: ReadonlyArray<Change>,
      writer: Omit<Line, "_tag" | "body">,
    ) => Effect.Effect<void, RelationsError>;
  }
>()("@kampus/libfabrika/permissions/Relations") {}
