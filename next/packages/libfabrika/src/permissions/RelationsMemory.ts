/**
 * The relations store in memory, for tests: the same fold as the ledger's, over its own changes.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Effect, Layer, Ref, Result, Schema } from "effect";
import { type Model, relations, seal } from "./internal/relationsTable.ts";
import { type Change, Row } from "./Relation.ts";
import { Relations, RelationsError } from "./Relations.ts";

/** What the store holds: each id's row, as the ledger keeps one row per id, and the fold. */
interface Held {
  readonly rows: ReadonlyMap<string, Row>;
  readonly model: Model;
}

const same = Schema.toEquivalence(Row);

/** The store after a batch, or `refused` when a change reuses an id with another row. */
const apply = (held: Held, changes: ReadonlyArray<Change>): Result.Result<Held, RelationsError> => {
  const rows = new Map(held.rows);
  let { model } = held;

  for (const { id, row } of changes) {
    const kept = rows.get(id);

    if (kept !== undefined) {
      if (!same(kept, row)) {
        return Result.fail(new RelationsError({ reason: "refused" }));
      }

      continue;
    }

    rows.set(id, row);
    model = applyCell(relations, model, { type: "recorded", row })[0];
  }

  return Result.succeed({ rows, model });
};

/**
 * Layer that provides `Relations` in memory, starting from `changes`.
 *
 * **Details**
 *
 * It handles ids as the ledger does: the same id with the same row again is a resend and changes
 * nothing, and an id reused with another row fails the whole batch with `refused`, writing none of
 * it. Every write counts as the brain's, so there is no other writer to skip.
 *
 * **Gotchas**
 *
 * `within` ignores the turn it is given and answers from the store's own changes. A row is
 * compared by its case and fields only, never by the writer's line fields. Starting changes that
 * reuse an id with another row are a defect.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (changes: ReadonlyArray<Change>): Layer.Layer<Relations> =>
  Layer.effect(
    Relations,
    Effect.gen(function* () {
      const first = yield* Effect.fromResult(
        apply({ rows: new Map(), model: relations.init(null, undefined)[0] }, changes),
      ).pipe(Effect.orDie);
      const held = yield* Ref.make(first);

      return {
        within: () => Result.succeed(seal(Ref.getUnsafe(held).model)),
        write: (batch) =>
          Ref.modify(held, (now) => {
            const next = apply(now, batch);
            return [next, Result.isSuccess(next) ? next.success : now];
          }).pipe(Effect.flatMap(Effect.fromResult), Effect.asVoid),
      };
    }),
  );
