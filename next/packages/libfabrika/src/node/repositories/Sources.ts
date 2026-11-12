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
  const within = (location: string) => {
    const relative = path.relative(options.root, location);
    return (
      relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  type Location = { readonly location: string; readonly committed: boolean };
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
    const pending = name.split(/[\\/]/).filter((part) => part !== "");

    while (pending.length > 0) {
      const part = pending.shift();

      if (part === undefined) {
        break;
      }

      if (part === ".") {
        continue;
      }

      if (part === "..") {
        location = path.dirname(location);
        continue;
      }

      const next = path.join(location, part);

      if (!committed || !within(next)) {
        const disk = path.join(next, ...pending);
        return {
          location: yield* fs
            .realPath(disk)
            .pipe(Effect.mapError((cause) => (cause.reason._tag === "NotFound" ? missing(cause) : failed(cause)))),
          committed: false,
        };
      }

      const relative = path.relative(options.root, next).split(path.sep).join("/");
      const entry = yield* options.entry(relative);

      if (entry === null) {
        return yield* missing("absent committed path");
      }

      if (entry.mode === "120000") {
        if (active.has(next)) {
          return yield* failed("symlink cycle");
        }

        const bytes = yield* options.read(relative);

        if (bytes === null) {
          return yield* failed("missing symlink blob");
        }

        const link = yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: failed,
        });

        if (link === "" || link.includes("\0")) {
          return yield* failed("invalid symlink");
        }

        const linked = yield* target(location, link, true, new Set([...active, next]));
        location = linked.location;

        if (!linked.committed) {
          return {
            location: yield* fs
              .realPath(path.join(location, ...pending))
              .pipe(Effect.mapError((cause) => (cause.reason._tag === "NotFound" ? missing(cause) : failed(cause)))),
            committed: false,
          };
        }
      } else {
        if (pending.length > 0 && entry.type !== "tree") {
          return yield* failed("source parent is not a folder");
        }

        location = next;
      }
    }

    return { location, committed: committed && within(location) };
  });
  const readAt = Effect.fnUntraced(function* (base: string, file: string, committed: boolean) {
    const located = yield* target(base, file, committed).pipe(
      Effect.catchReason("RepositoriesError", "MissingPath", () => Effect.succeed(null)),
    );

    if (located === null) {
      return null;
    }

    if (located.committed) {
      return yield* options.read(path.relative(options.root, located.location).split(path.sep).join("/"));
    }

    return yield* fs.readFile(located.location).pipe(Effect.mapError(failed));
  });
  return Effect.fnUntraced(function* (
    from: string,
    file: "repo" | "person",
  ): Effect.fn.Return<Source, RepositoriesError> {
    const located = yield* target(
      file === "repo" ? path.join(options.root, ".fabrika") : options.person,
      from,
      file === "repo",
    );

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

    const stat = yield* fs.stat(located.location).pipe(Effect.mapError(failed));

    if (stat.type !== "Directory") {
      return yield* failed("source is not a folder");
    }

    return { ...SourceMetadata.cases.disk.make({}), read: (name) => readAt(located.location, name, false) };
  });
});
