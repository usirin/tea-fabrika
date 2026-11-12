import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** Git ref components follow git-check-ref-format, without a branch override. */
export const Branch = Schema.String.check(
  Schema.isPattern(/^(?!-)(?!.*(?:\.\.|@\{|\/\/))(?!.*[~^:?*[\\])[^/]+(?:\/[^/]+)*$/),
  Schema.makeFilter(
    (s) =>
      s !== "@" &&
      [...s].every((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127) &&
      s.split("/").every((p) => !p.startsWith(".") && !p.endsWith(".") && !p.endsWith(".lock")),
  ),
);

export const ObjectId = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/));
export const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const Snapshot = Schema.Struct({
  key: Hash,
  branch: Branch,
  commit: ObjectId,
  file: Schema.Literal(".fabrika/fabrika.toml"),
  text: Schema.NullOr(Schema.String),
  hash: Hash,
});
export type Snapshot = typeof Snapshot.Type;

export class DefaultUnknown extends Schema.TaggedError<DefaultUnknown>()("DefaultUnknown", {
  cause: Schema.Defect(),
}) {}

export class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", { cause: Schema.Defect() }) {}
export class MissingPath extends Schema.TaggedError<MissingPath>()("MissingPath", { cause: Schema.Defect() }) {}

export class RepositoriesError extends Schema.TaggedError<RepositoriesError>()("RepositoriesError", {
  reason: Schema.Union([DefaultUnknown, ReadFailed, MissingPath]),
  message: Schema.optionalKey(Schema.String),
}) {}

/** Local handles retain private locations in closures, never in serializable data. */
export const SourceMetadata = Schema.TaggedUnion({ committed: { commit: ObjectId }, disk: {} });

export type Source = typeof SourceMetadata.Type & {
  readonly read: (
    path: string,
  ) => Effect.Effect<(typeof SourceMetadata.Type & { readonly bytes: Uint8Array }) | null, RepositoriesError>;
};

export interface Repository {
  readonly snapshot: Snapshot;
  readonly read: (path: string) => Effect.Effect<Uint8Array | null, RepositoriesError>;
  readonly resolve: (from: string, file: "repo" | "person") => Effect.Effect<Source, RepositoriesError>;
}

export class Repositories extends Context.Service<
  Repositories,
  {
    readonly open: (path: string) => Effect.Effect<Repository, RepositoriesError>;
  }
>()("@kampus/libfabrika/repositories/Repositories") {}
