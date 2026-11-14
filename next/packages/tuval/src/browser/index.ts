import { ErrorClass } from "@kampus/libfabrika/transport/ClientRows";
import { Predicate, Schema } from "effect";

export { browserKey } from "./key.ts";
export { browserRows } from "./rows.ts";

/** Keep only a fixed platform class, never an error's text or data. */
export function errorClass(error: unknown): ErrorClass {
  const name = Predicate.isObject(error) && Predicate.hasProperty(error, "name") ? error.name : null;
  return Schema.is(ErrorClass)(name) ? name : "other";
}
