/**
 * Who sent an input, as the permission check sees it, and the port that answers it. This file is
 * the contract only (0095): the gateway fills the port.
 *
 * @stability unstable
 */
import { Context, Schema, type Effect, type Option } from "effect";

/**
 * Schema for the member a check is made for: a person's own window, or an agent working for a
 * person, each with the key that sent the input and the person it works for (0261).
 *
 * **Details**
 *
 * Both cases are checked as `person:<for>`. An agent is capped by its person (0526): the relation
 * half of its check is its person's, and its own standing is its key's admission at the door.
 *
 * @stability unstable
 * @category models
 */
export const Sender = Schema.TaggedUnion({
  /** A person's window: checked as `person:<for>`. */
  person: { key: Schema.NonEmptyString, for: Schema.NonEmptyString },
  /** An agent for a person: capped by `person:<for>`. */
  agent: { key: Schema.NonEmptyString, for: Schema.NonEmptyString },
});
/**
 * The decoded type of `Sender`.
 *
 * @stability unstable
 * @category models
 */
export type Sender = typeof Sender.Type;

/**
 * The error `Senders.sender` fails with when it cannot answer who sent an input.
 *
 * **Details**
 *
 * `removed`: the sender's key no longer belongs. `ended`: the input's session has ended.
 * `storage`: the store behind the answer failed, with its cause kept.
 *
 * @stability unstable
 * @category errors
 */
export class SendersError extends Schema.TaggedError<SendersError>()("SendersError", {
  reason: Schema.Literals(["removed", "ended", "storage"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that answers who sent the input behind a write: the port the gateway fills, since one
 * signing service answers who sent an input (0262).
 *
 * **Details**
 *
 * `sender(parent, process)` answers the sender of `parent`, an input delivered to `process`, and
 * none when `parent` is null or no member's input delivered there is behind it.
 *
 * @stability unstable
 * @category services
 */
export class Senders extends Context.Service<
  Senders,
  {
    readonly sender: (parent: string | null, process: string) => Effect.Effect<Option.Option<Sender>, SendersError>;
  }
>()("@kampus/libfabrika/permissions/Senders") {}
