import { Context, Schema } from "effect";
import type { Effect } from "effect";
import * as Id from "../Id.ts";
import type { Line } from "../ledger/Log.ts";
import { Hash, ObjectId, Branch } from "../repositories/Repositories.ts";
import { Rev } from "../Rev.ts";
import { Snapshot } from "../settings/Snapshot.ts";

export const RepositoryId = Id.make("repository");
export const TrustDecision = Schema.TaggedUnion({ accepted: {}, denied: {} });
export type TrustDecision = typeof TrustDecision.Type;
const identity = { repository: RepositoryId, key: Hash };
const pinned = { commit: ObjectId, hash: Hash };

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
export type Event = typeof Event.Type;
export const Receipt = Schema.Struct({ rev: Rev, pos: Rev });
export type Receipt = typeof Receipt.Type;
export type Recorded = Omit<Line, "_tag" | "body">;
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

export class InvalidHistory extends Schema.TaggedError<InvalidHistory>()("InvalidHistory", {
  cause: Schema.Defect(),
}) {}

export class RepositoryTrustError extends Schema.TaggedError<RepositoryTrustError>()("RepositoryTrustError", {
  reason: Schema.Union([Storage, InvalidHistory]),
}) {}

export class RepositoryTrust extends Context.Service<
  RepositoryTrust,
  {
    readonly history: (key: string, person: string) => Effect.Effect<ReadonlyArray<Event>, RepositoryTrustError>;
    readonly write: (event: Event, recorded: Recorded) => Effect.Effect<Receipt, RepositoryTrustError>;
  }
>()("@kampus/libfabrika/packs/RepositoryTrust") {}
