// The person's key file on Node, next/ (Tier 1, P14). A reusable reader any Node stage runs: it
// reads `keybindings.toml` once before it returns, then watches it for the life of its scope. A
// good read is published as checked rows, with `file` as the source; a bad file or a failed read
// publishes nothing and says why, so the window keeps the last good table and shows the line.
// Closing the scope stops the watcher, and nothing is read or published after it.
import { Effect, FileSystem, PlatformError, Result, type Scope, Stream } from "effect";
import { type KeyProblem, parseKeys, type Rows } from "../../runtime/Keybindings.ts";

type KeyStatus = { readonly error: KeyProblem | null };

type WatchKeys = {
  readonly file: string;
  readonly commands: ReadonlyArray<string>;
  readonly defaults: unknown;
  readonly publish: (value: { readonly rows: Rows; readonly source: "file" }) => Effect.Effect<void>;
  readonly status: (status: KeyStatus) => Effect.Effect<void>;
};

const missing = (error: unknown): boolean =>
  PlatformError.isPlatformError(error) && error.reason._tag !== "BadArgument" && error.reason._tag === "NotFound";

/** The last path segment, the way a directory watcher names the file that changed. */
const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const folder = (path: string): string => {
  const at = path.lastIndexOf("/");
  return at <= 0 ? (at === 0 ? "/" : ".") : path.slice(0, at);
};

/** Whether a watch event is about the key file. An event that names no path counts. */
const about = (file: string, event: unknown): boolean => {
  if (typeof event !== "object" || event === null || !("path" in event)) {
    return true;
  }

  return typeof event.path !== "string" || base(event.path) === base(file);
};

export const watchKeys = Effect.fn("keys.watch")(function* (
  options: WatchKeys,
): Effect.fn.Return<void, never, FileSystem.FileSystem | Scope.Scope> {
  const fs = yield* FileSystem.FileSystem;
  const read = Effect.fn("keys.read")(function* () {
    const text = yield* Effect.result(fs.readFileString(options.file));

    // No file is the empty table: every command keeps its defaults.
    if (Result.isFailure(text) && missing(text.failure)) {
      yield* options.publish({ rows: {}, source: "file" });
      return yield* options.status({ error: null });
    }

    if (Result.isFailure(text)) {
      return yield* options.status({ error: { line: 0, reason: "read" } });
    }

    const rows = parseKeys(text.success, options.commands);

    if (Result.isFailure(rows)) {
      return yield* options.status({ error: rows.failure });
    }

    yield* Effect.annotateCurrentSpan("fab.keys.commands", Object.keys(rows.success).length);
    yield* options.publish({ rows: rows.success, source: "file" });
    yield* options.status({ error: null });
  });
  yield* read();
  // A directory watch sees the file come and go; a watch on the file alone ends when it is replaced.
  yield* fs.watch(folder(options.file)).pipe(
    Stream.filter((event) => about(options.file, event)),
    Stream.runForEach(() => read()),
    Effect.catch(() => options.status({ error: { line: 0, reason: "watch" } })),
    Effect.forkScoped,
  );
});
