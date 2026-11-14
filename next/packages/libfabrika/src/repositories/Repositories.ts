/**
 * One selected repository, read at one commit: its snapshot, its files and the source folders its
 * settings name. This file is the contract only (0095).
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/**
 * Schema for a branch name under git's ref name rules (`git check-ref-format`): components
 * separated by single slashes, none of git's banned characters or sequences, and no component that
 * starts or ends with a dot or ends in `.lock`. A leading dash and a lone `@` are refused too.
 *
 * @stability unstable
 * @category schemas
 */
export const Branch = Schema.String.check(
  Schema.isPattern(/^(?!-)(?!.*(?:\.\.|@\{|\/\/))(?!.*[~^:?*[\\])[^/]+(?:\/[^/]+)*$/),
  Schema.makeFilter(
    (s) =>
      s !== "@" &&
      [...s].every((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127) &&
      s.split("/").every((p) => !p.startsWith(".") && !p.endsWith(".") && !p.endsWith(".lock")),
  ),
);

/**
 * Schema for a full git object id in lowercase hex: 40 characters for SHA-1, 64 for SHA-256.
 *
 * @stability unstable
 * @category schemas
 */
export const ObjectId = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/));
/**
 * Schema for a SHA-256 digest in lowercase hex. It holds a snapshot's `key` and the hash of its
 * settings document.
 *
 * @stability unstable
 * @category schemas
 */
export const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

/**
 * Schema for a repository snapshot: the default branch the origin advertised for one selection,
 * the commit checked for it, and the exact text of `.fabrika/fabrika.toml` at that commit, or null
 * when the commit has none.
 *
 * **Details**
 *
 * `key` names the clone, whatever the commit: a hash of its canonical Git directory and its
 * origin's destination, so the snapshot holds no location. `hash` is the digest of the document's
 * text, or of the word `absent` when there is none.
 *
 * @stability unstable
 * @category schemas
 */
export const Snapshot = Schema.Struct({
  key: Hash,
  branch: Branch,
  commit: ObjectId,
  file: Schema.Literal(".fabrika/fabrika.toml"),
  text: Schema.NullOr(Schema.String),
  hash: Hash,
});
/**
 * A repository snapshot, as `Repositories.open` answers it.
 *
 * @stability unstable
 * @category models
 */
export type Snapshot = typeof Snapshot.Type;

/**
 * Error for a selection that could not be pinned: the clone's location, its origin, the origin's
 * default branch or that branch's commit could not be established.
 *
 * @stability unstable
 * @category errors
 */
export class DefaultUnknown extends Schema.TaggedError<DefaultUnknown>()("DefaultUnknown", {
  cause: Schema.Defect(),
}) {}

/**
 * Error for a read that failed: git or the file system failed, or what was found has the wrong
 * form, such as a settings path that is not a regular file.
 *
 * @stability unstable
 * @category errors
 */
export class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", { cause: Schema.Defect() }) {}
/**
 * Error for a source folder's path that does not exist, in the commit or on disk.
 *
 * @stability unstable
 * @category errors
 */
export class MissingPath extends Schema.TaggedError<MissingPath>()("MissingPath", { cause: Schema.Defect() }) {}

/**
 * Error for any `Repositories` failure. `reason` holds which of the three it was, with the lower
 * cause kept redacted. `message`, when present, is a sentence for the person, with no private
 * location in it.
 *
 * @stability unstable
 * @category errors
 */
export class RepositoriesError extends Schema.TaggedError<RepositoriesError>()("RepositoriesError", {
  reason: Schema.Union([DefaultUnknown, ReadFailed, MissingPath]),
  message: Schema.optionalKey(Schema.String),
}) {}

/**
 * Schema for where a source's bytes come from: `committed`, with the commit they were read at, or
 * `disk`. It is the part of a source that may be saved or sent: a local handle keeps its private
 * location in a closure, never in data.
 *
 * @stability unstable
 * @category schemas
 */
export const SourceMetadata = Schema.TaggedUnion({ committed: { commit: ObjectId }, disk: {} });

/**
 * A source folder's local handle: where it comes from, and `read`, which answers one file under
 * the folder, or null when the file is absent.
 *
 * **Details**
 *
 * Each read says for itself whether its bytes are `committed` or from `disk`, since a link inside
 * a committed folder may lead out of the repository.
 *
 * @stability unstable
 * @category models
 */
export type Source = typeof SourceMetadata.Type & {
  readonly read: (
    path: string,
  ) => Effect.Effect<(typeof SourceMetadata.Type & { readonly bytes: Uint8Array }) | null, RepositoriesError>;
};

/**
 * One opened repository: its snapshot, and reads that keep the snapshot's commit whatever the
 * checkout or the branch does afterwards.
 *
 * @stability unstable
 * @category models
 */
export interface Repository {
  readonly snapshot: Snapshot;
  /** A file's bytes at the snapshot's commit, or null when the commit has no such path. */
  readonly read: (path: string) => Effect.Effect<Uint8Array | null, RepositoriesError>;
  /**
   * Resolves a folder path written in a settings file to a source. `file` says which file wrote
   * it: a repo path starts at the repository's `.fabrika` folder and is read from the commit while
   * it stays inside the repository; a person path starts at the person's own folder, on disk.
   */
  readonly resolve: (from: string, file: "repo" | "person") => Effect.Effect<Source, RepositoriesError>;
}

/**
 * Service that opens a local clone as a repository pinned to one commit: the one its origin
 * advertises for its default branch when `open` is called.
 *
 * **Details**
 *
 * The selection is explicit and checked. `open` fails when it cannot prove which commit that is,
 * and it never falls back to whatever the checkout holds.
 *
 * @stability unstable
 * @category services
 */
export class Repositories extends Context.Service<
  Repositories,
  {
    readonly open: (path: string) => Effect.Effect<Repository, RepositoriesError>;
  }
>()("@kampus/libfabrika/repositories/Repositories") {}
