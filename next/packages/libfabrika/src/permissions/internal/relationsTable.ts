/**
 * The tea machine that folds relation rows into live tuples, one row at a time (0046).
 *
 * @stability unstable
 */
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Row } from "../Relation.ts";

const TuplesTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Tuples");

/**
 * The live tuples, sealed: each key is `subject#relation@object`.
 *
 * @internal
 */
export interface Tuples {
  readonly [TuplesTypeId]: ReadonlySet<string>;
}

/**
 * The one key a tuple is kept under.
 *
 * @internal
 */
export const tupleKey = (subject: string, relation: string, object: string): string =>
  `${subject}#${relation}@${object}`;

const Model = Schema.Struct({ tuples: Schema.ReadonlySet(Schema.String) });
/** @internal */
export type Model = typeof Model.Type;

const Msg = Schema.Struct({ type: Schema.Literal("recorded"), row: Row });

/**
 * The relations fold: `related` adds its tuple and `unrelated` removes it. Which rows reach it
 * (the brain's own, of a row case) is the reader's to decide.
 *
 * @internal
 */
export const relations = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: () => [{ tuples: new Set<string>() }, []],
  update: {
    recorded: (s, { row }) => {
      const key = tupleKey(row.subject, row.relation, row.object);
      const tuples = new Set(s.tuples);

      if (row._tag === "related") {
        tuples.add(key);
      } else {
        tuples.delete(key);
      }

      return [{ tuples }, []];
    },
  },
});

/**
 * Seals a Model's tuples for the check.
 *
 * @internal
 */
export const seal = (model: Model): Tuples => ({ [TuplesTypeId]: model.tuples });

/**
 * Whether the tuple is live.
 *
 * @internal
 */
export const live = (tuples: Tuples, subject: string, relation: string, object: string): boolean =>
  tuples[TuplesTypeId].has(tupleKey(subject, relation, object));
