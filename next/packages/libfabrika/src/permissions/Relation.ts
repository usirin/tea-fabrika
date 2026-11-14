/**
 * Relation rows: the one shape every permission fact is kept in on the ledger (0526), the stream
 * they live on, one write of a row, and the live tuples a fold of them gives.
 *
 * @stability unstable
 */
import { Schema } from "effect";
import type * as relationsTable from "./internal/relationsTable.ts";

/**
 * The ledger stream that holds every relation row. Only the brain's own rows count: the fold skips
 * a row whose `by` is any other key.
 *
 * @stability unstable
 * @category constants
 */
export const STREAM = "permissions/relations";

const Fields = {
  /** Who holds the relation, as a `type:id` ref, such as `person:person_01jc…`. */
  subject: Schema.NonEmptyString,
  /** The relation's name, one the model declares on the object's type. */
  relation: Schema.NonEmptyString,
  /** What the relation is on, as a `type:id` ref, such as `fabrika:demo`. */
  object: Schema.NonEmptyString,
};

/**
 * Schema for one relation row, Zanzibar's tuple `object#relation@subject`: `related` adds the
 * tuple and `unrelated` removes it.
 *
 * **Example** (The founding person owns this fabrika)
 *
 * ```ts
 * import { Row } from "@kampus/libfabrika/permissions/Relation"
 *
 * Row.cases.related.make({ subject: "person:person_a", relation: "owner", object: "fabrika:demo" })
 * ```
 *
 * @stability unstable
 * @category models
 */
export const Row = Schema.TaggedUnion({
  related: Fields,
  unrelated: Fields,
});
/**
 * The decoded type of `Row`.
 *
 * @stability unstable
 * @category models
 */
export type Row = typeof Row.Type;

/**
 * One write of a row: the entry id its writer chose, so a resend is one line, and the row.
 *
 * **Gotchas**
 *
 * An id is kept forever. The same id with the same row again is a resend and changes nothing; the
 * same id with another row fails its whole batch.
 *
 * @stability unstable
 * @category models
 */
export interface Change {
  readonly id: string;
  readonly row: Row;
}

/**
 * The live tuples, folded from relation rows in the referee's order. Opaque outside the module:
 * only a right's check and `recheck` read them.
 *
 * @stability unstable
 * @category models
 */
export type Tuples = relationsTable.Tuples;
