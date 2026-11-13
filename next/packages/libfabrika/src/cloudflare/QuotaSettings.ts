/**
 * The quota settings as a Worker reads them from a settings snapshot.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";

/**
 * Reads the quota limits from a settings snapshot: the program's writes and storage, and the
 * recovery allowances. The whole snapshot is checked against the declared settings and its hash
 * first.
 *
 * @stability unstable
 * @category constructors
 */
export const read = Effect.fn("quota_settings.read")(function* (input: unknown) {
  const checked = yield* Snapshot.read(Declarations.all, input);
  const { writes, storage, recovery } = checked.values;
  return { writes, storage, recovery };
});
