/** The strict settings handoff to a Worker.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";

/** Read a complete, hash-checked snapshot through the declarations' codecs.
 * @stability unstable
 * @category constructors
 */
export const read = Effect.fn("quota_settings.read")(function* (input: unknown) {
  const checked = yield* Snapshot.read(Declarations.all, input);
  const { writes, storage, recovery } = checked.values;
  return { writes, storage, recovery };
});
