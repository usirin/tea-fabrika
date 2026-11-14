/**
 * Repository trust: a person's saved answer on whether to open one clone, and the events that
 * record an opening. This file is the contract only (0095).
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import * as Id from "../Id.ts";
import type { Line } from "../ledger/Log.ts";
import { Hash, ObjectId, Branch } from "../repositories/Repositories.ts";
import { Rev } from "../Rev.ts";
import { Snapshot } from "../settings/Snapshot.ts";

/**
 * Schema for a repository's id, `repository_<26 chars>`: made at a clone's first selection by one
 * person, and carried by every later event in that history.
 *
 * @stability unstable
 * @category schemas
 */
export const RepositoryId = Id.make("repository");
/**
 * Schema for a person's answer to the trust question: `accepted` or `denied`.
 *
 * @stability unstable
 * @category schemas
 */
export const TrustDecision = Schema.TaggedUnion({ accepted: {}, denied: {} });
/**
 * A person's answer to the trust question.
 *
 * @stability unstable
 * @category models
 */
export type TrustDecision = typeof TrustDecision.Type;
const identity = { repository: RepositoryId, key: Hash };
const pinned = { commit: ObjectId, hash: Hash };

/**
 * Schema for the three events of a repository opening, in the order they are written: `selected`,
 * what was picked and the settings it resolved to; `decision`, the person's answer; and `opened`,
 * how the opening ended, `ready` or `refused`.
 *
 * **Details**
 *
 * Every event carries the repository's id and key and the commit and document hash it pins. A
 * `decision` and an `opened` name their `selection`, which is the `selected` event's `request`.
 *
 * @stability unstable
 * @category schemas
 */
export const Event = Schema.TaggedUnion({
  selected: {
    ...identity,
    ...pinned,
    label: Schema.NonEmptyString,
    branch: Branch,
    present: Schema.Boolean,
    settings: Snapshot,
    request: Id.InputId,
  },
  decision: {
    ...identity,
    ...pinned,
    selection: Id.InputId,
    request: Id.InputId,
    decision: TrustDecision,
    actor: Id.Person,
    method: Schema.Literal("terminal"),
  },
  opened: {
    ...identity,
    ...pinned,
    selection: Id.InputId,
    request: Id.InputId,
    settings: Snapshot,
    result: Schema.Literals(["ready", "refused"]),
    reason: Schema.optionalKey(Schema.Literal("denied")),
  },
});
/**
 * One event of a repository opening.
 *
 * @stability unstable
 * @category models
 */
export type Event = typeof Event.Type;
/**
 * Schema for where a written event landed on the ledger: its `rev` and its `pos`.
 *
 * @stability unstable
 * @category schemas
 */
export const Receipt = Schema.Struct({ rev: Rev, pos: Rev });
/**
 * Where a written event landed on the ledger.
 *
 * @stability unstable
 * @category models
 */
export type Receipt = typeof Receipt.Type;
/**
 * The sender fields of the ledger line an event is written with: `by`, `for`, `sentAt`, `seen`,
 * `parent`, `traceId` and `build`. The caller gives these; the event gives the line's case and
 * body.
 *
 * @stability unstable
 * @category models
 */
export type Recorded = Omit<Line, "_tag" | "body">;
/**
 * Error for a ledger call that failed, or an append the ledger refused.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Error for a saved history, or an event about to be written, that cannot be trusted: an entry
 * that does not decode, a changed identity, a decision or opening with no matching selection,
 * another person's decision, or a history too long to read whole.
 *
 * @stability unstable
 * @category errors
 */
export class InvalidHistory extends Schema.TaggedError<InvalidHistory>()("InvalidHistory", {
  cause: Schema.Defect(),
}) {}

/**
 * Error for any `RepositoryTrust` failure. `reason` holds `Storage` or `InvalidHistory`, with its
 * cause kept redacted.
 *
 * @stability unstable
 * @category errors
 */
export class RepositoryTrustError extends Schema.TaggedError<RepositoryTrustError>()("RepositoryTrustError", {
  reason: Schema.Union([Storage, InvalidHistory]),
}) {}

/**
 * Service that keeps repository trust: a person's accepted or denied answer for one clone, saved
 * as events and read back checked.
 *
 * **Details**
 *
 * Trust belongs to one clone and one person. Another clone, another origin or another person has
 * its own history and inherits nothing.
 *
 * @stability unstable
 * @category services
 */
export class RepositoryTrust extends Context.Service<
  RepositoryTrust,
  {
    /**
     * Every event saved for this clone's key and this person, oldest first, each checked against
     * the ones before it. It fails rather than answer a history it cannot vouch for.
     */
    readonly history: (key: string, person: string) => Effect.Effect<ReadonlyArray<Event>, RepositoryTrustError>;
    /**
     * Appends one event. A `decision` or an `opened` must match its saved `selected` event, and is
     * written with that event's id as `parent` and with its `traceId`.
     */
    readonly write: (event: Event, recorded: Recorded) => Effect.Effect<Receipt, RepositoryTrustError>;
  }
>()("@kampus/libfabrika/packs/RepositoryTrust") {}
