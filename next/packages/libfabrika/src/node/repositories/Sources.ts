import { Effect, FileSystem, Path, Redacted } from "effect";
import type { ObjectId } from "../../repositories/Repositories.ts";
import {
  MissingPath,
  ReadFailed,
  RepositoriesError,
  SourceMetadata,
  type Source,
} from "../../repositories/Repositories.ts";

type Entry = { readonly mode: string; readonly type: string; readonly id: string };

const failed = (cause: unknown) =>
  new RepositoriesError({
    reason: new ReadFailed({ cause: Redacted.make(cause) }),
    message: "Selected repository: source read failed.",
  });

const missing = (cause: unknown) =>
  new RepositoriesError({
    reason: new MissingPath({ cause: Redacted.make(cause) }),
    message: "Selected repository: source folder is missing.",
  });

/** Resolves paths from the original document. Committed symlinks are read as blobs, never from disk. */
export const resolver = Effect.fn("repositorySources.resolver")(function* (options: {
  readonly root: string;
  readonly person: string;
  readonly commit: typeof ObjectId.Type;
  readonly entry: (file: string) => Effect.Effect<Entry | null, RepositoriesError>;
  readonly read: (file: string) => Effect.Effect<Uint8Array | null, RepositoriesError>;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const contains = (base: string, location: string) => {
    const relative = path.relative(base, location);
    return (
      relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  type Location = { readonly location: string; readonly committed: boolean; readonly directory: boolean };
  const target: (
    base: string,
    name: string,
    committed: boolean,
    active?: ReadonlySet<string>,
  ) => Effect.Effect<Location, RepositoriesError> = Effect.fnUntraced(function* (
    base: string,
    name: string,
    committed: boolean,
    active: ReadonlySet<string> = new Set(),
  ) {
    let location = path.isAbsolute(name) ? path.parse(name).root : base;
    let directory = true;
    const pending = name.split(path.sep).filter((part) => part !== "");

    // A trailing separator requires a directory, just like a following dot segment.
    if (name.endsWith(path.sep)) {
      pending.push(".");
    }

    while (pending.length > 0) {
      const part = pending.shift();

      if (part === undefined) {
        break;
      }

      if (!directory) {
        return yield* failed("source parent is not a folder");
      }

      if (part === ".") {
        continue;
      }

      if (part === "..") {
        location = path.dirname(location);
        continue;
      }

      const next = path.join(location, part);

      // Absolute committed links cross the canonical root's ancestors before tree lookup starts.
      if (committed && contains(next, options.root)) {
        location = next;
        continue;
      }

      let link: string;

      if (!committed || !contains(options.root, next)) {
        const stat = yield* fs
          .lstat(next)
          .pipe(Effect.mapError((cause) => (cause.reason._tag === "NotFound" ? missing(cause) : failed(cause))));

        if (stat.type !== "SymbolicLink") {
          directory = stat.type === "Directory";
          location = next;
          continue;
        }

        link = yield* fs.readLink(next).pipe(Effect.mapError(failed));
      } else {
        const relative = path.relative(options.root, next).split(path.sep).join("/");
        const entry = yield* options.entry(relative);

        if (entry === null) {
          return yield* missing("absent committed path");
        }

        if (entry.mode !== "120000") {
          directory = entry.type === "tree";
          location = next;
          continue;
        }

        const bytes = yield* options.read(relative);

        if (bytes === null) {
          return yield* failed("missing symlink blob");
        }

        link = yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: failed,
        });
      }

      if (active.has(next)) {
        return yield* failed("symlink cycle");
      }

      if (link === "" || link.includes("\0")) {
        return yield* failed("invalid symlink");
      }

      const linked = yield* target(location, link, committed, new Set([...active, next]));
      location = linked.location;
      directory = linked.directory;
    }

    return { location, committed: committed && contains(options.root, location), directory };
  });
  const readAt = Effect.fnUntraced(function* (base: string, file: string, committed: boolean) {
    const located = yield* target(base, file, committed).pipe(
      Effect.catchReason("RepositoriesError", "MissingPath", () => Effect.succeed(null)),
    );

    if (located === null) {
      return null;
    }

    if (located.committed) {
      const bytes = yield* options.read(path.relative(options.root, located.location).split(path.sep).join("/"));
      return bytes === null ? null : { ...SourceMetadata.cases.committed.make({ commit: options.commit }), bytes };
    }

    const bytes = yield* fs.readFile(located.location).pipe(Effect.mapError(failed));
    return { ...SourceMetadata.cases.disk.make({}), bytes };
  });
  return Effect.fnUntraced(function* (
    from: string,
    file: "repo" | "person",
  ): Effect.fn.Return<Source, RepositoriesError> {
    const base =
      file === "repo"
        ? path.join(options.root, ".fabrika")
        : yield* fs
            .realPath(options.person)
            .pipe(Effect.mapError((cause) => (cause.reason._tag === "NotFound" ? missing(cause) : failed(cause))));
    const located = yield* target(base, from, file === "repo");

    if (located.committed) {
      const relative = path.relative(options.root, located.location).split(path.sep).join("/");
      const entry = relative === "" ? null : yield* options.entry(relative);

      if (relative !== "" && entry === null) {
        return yield* missing("absent committed folder");
      }

      if (relative !== "" && entry?.type !== "tree") {
        return yield* failed("source is not a folder");
      }

      return {
        ...SourceMetadata.cases.committed.make({ commit: options.commit }),
        read: (name) => readAt(located.location, name, true),
      };
    }

    const stat = yield* fs
      .stat(located.location)
      .pipe(Effect.mapError((cause) => (cause.reason._tag === "NotFound" ? missing(cause) : failed(cause))));

    if (stat.type !== "Directory") {
      return yield* failed("source is not a folder");
    }

    return { ...SourceMetadata.cases.disk.make({}), read: (name) => readAt(located.location, name, false) };
  });
});
