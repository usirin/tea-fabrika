/**
 * The rewrite walk: whether a subject holds a relation or a permission on an object, over live
 * tuples, by Zanzibar's `_this` and `computed_userset` with union.
 *
 * @stability unstable
 */
import { live, type Tuples } from "./relationsTable.ts";

/**
 * One declared type at run time: its relation names, and each permission's union of names.
 *
 * @internal
 */
export interface Declared {
  readonly relations: ReadonlySet<string>;
  readonly permissions: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * Whether `subject` holds `name` on `object`, a relation by its live tuple and a permission by any
 * name of its union.
 *
 * **Details**
 *
 * The walk keeps the permissions it has entered. A permission met again holds only by a relation
 * of the same name, as in `write = write + drive`, so a loop of permissions ends, and a loop alone
 * never holds (L2). With union alone a name's answer does not depend on the path, so one set for
 * the whole walk is exact. A name the type declares neither way holds nothing.
 *
 * @internal
 */
export const holds = (
  declared: Declared,
  tuples: Tuples,
  subject: string,
  name: string,
  object: string,
  visited = new Set<string>(),
): boolean => {
  const union = declared.permissions.get(name);

  if (union !== undefined && !visited.has(name)) {
    visited.add(name);
    return union.some((each) => holds(declared, tuples, subject, each, object, visited));
  }

  return declared.relations.has(name) && live(tuples, subject, name, object);
};
