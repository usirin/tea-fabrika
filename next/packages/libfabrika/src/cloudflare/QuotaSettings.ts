/**
 * The quota settings as a Worker reads them from a settings snapshot.
 *
 * @stability unstable
 */
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { Allowance, Limits } from "../processes/Quotas.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";

const Declared = Schema.Struct({
  writes: Declarations.writes.schema,
  storage: Declarations.storage.schema,
  recovery: Declarations.recovery.schema,
});

/**
 * The quota settings as the `INSTANCE` handoff carries them: each declared value as its own
 * schema encodes it.
 *
 * @stability unstable
 * @category models
 */
export type Handoff = typeof Declared.Encoded;

const Instance = Schema.fromJsonString(Schema.Struct({ limits: Schema.optionalKey(Schema.Unknown) }));

const allowance = (declared: (typeof Declared.Type)["recovery"]["project"]): Allowance => ({
  writes: declared.writes,
  bytes: ByteSize.toNumberUnsafe(declared.bytes),
  letter: { writes: declared.letter.writes, bytes: ByteSize.toNumberUnsafe(declared.letter.bytes) },
});

const refused = (cause: unknown) =>
  new Snapshot.SnapshotError({ message: "The quota settings are invalid.", cause: Redacted.make(cause) });

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

/**
 * Checks handed-off quota settings with their declared schemas and returns them as the limits
 * accounting counts in: plain writes and bytes. Nothing is filled in: a missing or invalid value
 * fails with `SnapshotError`.
 *
 * @stability unstable
 * @category constructors
 */
export const limits = Effect.fn("quota_settings.limits")(function* (handoff: unknown) {
  const declared = yield* Schema.decodeUnknownEffect(Declared)(handoff).pipe(Effect.mapError(refused));
  const checked: Limits = {
    writes: declared.writes,
    storage: ByteSize.toNumberUnsafe(declared.storage),
    recovery: { project: allowance(declared.recovery.project), process: allowance(declared.recovery.process) },
  };
  return checked;
});

/**
 * Reads the limits from a Worker's `INSTANCE` text, for an object that is handed no settings of
 * its own. None when the host handed off no limits.
 *
 * @stability unstable
 * @category constructors
 */
export const instance = Effect.fn("quota_settings.instance")(function* (text: unknown) {
  const config = yield* Schema.decodeUnknownEffect(Instance)(text).pipe(Effect.mapError(refused));
  return config.limits === undefined ? Option.none<Limits>() : Option.some(yield* limits(config.limits));
});
