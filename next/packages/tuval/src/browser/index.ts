import { ErrorClass } from "@kampus/libfabrika/transport/ClientRows";
import { Predicate, Schema } from "effect";

/** The page's main runner, Effect's own (0250). */
export { runMain } from "@effect/platform-browser/BrowserRuntime";
export { browserKey } from "./key.ts";
export { browserSocket } from "./socket.ts";
export { browserRows } from "./rows.ts";

/** Keep only a fixed platform class, never an error's text or data. */
export function errorClass(error: unknown): ErrorClass {
  const name = Predicate.isObject(error) && Predicate.hasProperty(error, "name") ? error.name : null;
  return Schema.is(ErrorClass)(name) ? name : "other";
}
