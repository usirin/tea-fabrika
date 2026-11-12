import { createHash } from "node:crypto";
import { Clock, Effect, FileSystem, Path, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { Saved } from "./desk/desk.ts";
import { type Project, Project as Projects } from "./project.ts";

// The old desk moves into its project (ticket 276, "Moving the old desk"). Before projects, one
// app home held one desk: `<appHome>/desk.json`, its history, its asks and its storage. Now each
// project keeps its own under `<appHome>/projects/<key>/`. The first project opened takes the old
// desk once, checked, and the old files stay where they were, for recovery.
//
//   yield* migrateProject({home, legacy: home, project: demlik, restart: "accepted", live, stop})
//   // {project: demlik, rule: "first_accepted", phase: "complete"}
//   // <appHome>/migration.json: {format: 1, project: "3f9a…", rule, files, digests, phase, at, result}
//
//   1. pick    the saved summons' folders all name one root: that project ("summons"); otherwise
//              the project being opened ("first_accepted"). Written down before any copy, so a
//              retry resumes the same move and never imports into another project
//   2. stop    a live old host is left alone until the person accepts its restart; then stopped
//   3. copy    the durable files, to `<key>.moving` beside the project, with their modes
//   4. check   every copy's bytes and digest against its original
//   5. publish one rename makes it the project's home; only then is the move marked complete
//
// An unknown saved shape, or a copy that does not match, stops the move with words a person can
// act on. It never becomes an empty desk: the honest exit for what an agent would have inspected.
// Sockets, pid files and locks are never copied: only the files below, and only regular files.

/** What a project keeps of the old desk, by name under the old home (host/run.ts's formats). */
const DURABLE = [
  "desk.json",
  "asks.json",
  "history",
  "storage",
  "records",
  "ledger.sqlite",
  "ledger.sqlite-wal",
  "ledger.sqlite-shm",
  "ledger.json",
  "host/log",
  "host/restart.json",
] as const;

/** The move as `migration.json` keeps it. */
const Marker = Schema.Struct({
  format: Schema.Literal(1),
  /** The target project's key, and its root then. */
  project: Schema.String,
  root: Schema.String,
  rule: Schema.Literals(["summons", "first_accepted"]),
  /** How many files moved, and each one's SHA-256, by its path under the old home. */
  files: Schema.Int,
  digests: Schema.Record(Schema.String, Schema.String),
  phase: Schema.Literals(["copying", "complete"]),
  /** When this phase was written, by the app's clock. */
  at: Schema.Number,
  result: Schema.Literals(["moving", "moved"]),
});
type Marker = typeof Marker.Type;
const decodeMarker = Schema.decodeUnknownEffect(Schema.fromJsonString(Marker));
const decodeSaved = Schema.decodeUnknownEffect(Schema.fromJsonString(Saved));

/** Why the old desk was not moved, in words for the window. None names a path or a saved value. */
export class MigrationRefused extends Schema.TaggedError<MigrationRefused>()("MigrationRefused", {
  kind: Schema.Literals(["unknown", "live", "failed", "taken"]),
  why: Schema.String,
}) {
  get message() {
    return this.why;
  }
}

export const MIGRATION_WORDS = {
  unknown:
    "The saved work could not be read: its desk is in a shape this version does not know. Nothing was moved, and the old files are kept.",
  live: "The old host still runs, with its jobs. Its saved work stays where it is until you restart it.",
  failed: "The saved work could not be moved. The old files are kept as they were, so you can try again.",
  taken: "The saved work could not be moved: this project already has saved work of its own. The old files are kept.",
} as const;

const refused = (kind: keyof typeof MIGRATION_WORDS) => new MigrationRefused({ kind, why: MIGRATION_WORDS[kind] });

export interface Migration {
  /** The app home: where `projects/` and `migration.json` are. */
  readonly home: string;
  /** The old desk's home: the app home itself, in the app. */
  readonly legacy: string;
  /** The project being opened. */
  readonly project: Project;
  /** Did the person accept restarting a live old host. */
  readonly restart: "accepted" | "refused";
  /** Does the old host run now. None: there is no old host to ask. */
  readonly live?: () => Effect.Effect<boolean>;
  /** Stop the old host, and wait for it to exit. */
  readonly stop?: () => Effect.Effect<void>;
}

export interface Moved {
  readonly project: Project;
  readonly rule: "summons" | "first_accepted";
  readonly phase: "complete";
}

const digestOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Does the old home hold a desk to move: any of the durable files. */
export const hasLegacy = (legacy: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    for (const name of ["desk.json", "history", "storage", "asks.json"]) {
      if (yield* fs.exists(path.join(legacy, name)).pipe(Effect.orElseSucceed(() => false))) {
        return true;
      }
    }

    return false;
  });

/** Is the move already done, or none is needed: `migration.json` says complete. */
export const migrated = (home: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const marker = yield* readMarker(path.join(home, "migration.json"));
    return marker?.phase === "complete";
  });

const readMarker = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
      return null;
    }

    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    return yield* decodeMarker(text).pipe(Effect.orElseSucceed(() => null));
  });

/** Every regular file of the durable list, by its path under the old home. */
const durableFiles = (legacy: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const found: string[] = [];
    const visit = (relative: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const info = yield* fs.stat(path.join(legacy, relative)).pipe(Effect.option);

        if (info._tag === "None") {
          return;
        }

        if (info.value.type === "File") {
          found.push(relative);
        } else if (info.value.type === "Directory") {
          const names = yield* fs
            .readDirectory(path.join(legacy, relative))
            .pipe(Effect.orElseSucceed((): string[] => []));

          for (const name of [...names].sort()) {
            yield* visit(path.join(relative, name));
          }
        }
      });

    for (const name of DURABLE) {
      yield* visit(name);
    }

    return found;
  });

/** The saved summons' folders: read from the storage slots as they are, never opened for writing. */
const summonedFolders = (legacy: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folders = new Set<string>();
    const visit = (dir: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));

        for (const name of names) {
          const file = path.join(dir, name);
          const info = yield* fs.stat(file).pipe(Effect.option);

          if (info._tag === "None") {
            continue;
          }

          if (info.value.type === "Directory") {
            yield* visit(file);
          } else if (info.value.type === "File" && name.includes("names")) {
            for (const folder of foldersIn(yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "")))) {
              folders.add(folder);
            }
          }
        }
      });
    yield* visit(path.join(legacy, "storage", "summon"));
    yield* visit(path.join(legacy, "storage"));
    return [...folders];
  });

/** The summons' folders one storage slot holds: its body is the `names` state, as JSON text. */
const foldersIn = (text: string): readonly string[] => {
  const parsed = parseJson(text);
  const body = isObject(parsed) && typeof parsed.body === "string" ? parseJson(parsed.body) : null;

  if (!isObject(body) || !Array.isArray(body.names)) {
    return [];
  }

  return body.names.flatMap((n: unknown) => (isObject(n) && typeof n.folder === "string" ? [n.folder] : []));
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Which project takes the old desk, and by which rule. */
const pick = (legacy: string, opening: Project) =>
  Effect.gen(function* () {
    const folders = yield* summonedFolders(legacy);
    const [only, ...rest] = folders;

    if (only !== undefined && rest.length === 0) {
      const found = yield* Projects.check(only).pipe(Effect.option);

      if (found._tag === "Some") {
        return { project: found.value, rule: "summons" as const };
      }
    }

    return { project: opening, rule: "first_accepted" as const };
  });

/** Write `migration.json` beside, then move it over. */
const writeMarker = (file: string, marker: Marker) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${file}.new`, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    yield* fs.rename(`${file}.new`, file);
  });

/** Each file's digest and size under `root`, or none when one is missing. */
const factsUnder = (root: string, files: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const facts: Record<string, { digest: string; bytes: number }> = {};

    for (const file of files) {
      const bytes = yield* fs.readFile(path.join(root, file)).pipe(Effect.option);

      if (bytes._tag === "None") {
        return null;
      }

      facts[file] = { digest: digestOf(bytes.value), bytes: bytes.value.length };
    }

    return facts;
  });

const same = (
  a: Readonly<Record<string, { digest: string; bytes: number }>> | null,
  b: Readonly<Record<string, { digest: string; bytes: number }>>,
) => a !== null && Object.entries(b).every(([file, f]) => a[file]?.digest === f.digest && a[file]?.bytes === f.bytes);

/** Move the old desk into its project, or resume the move a failure left, or say it is done. */
export const migrateProject = (
  m: Migration,
): Effect.Effect<
  Moved,
  MigrationRefused,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(m.home, "migration.json");
    const kept = yield* readMarker(file);

    if (kept?.phase === "complete") {
      return { project: { root: kept.root, key: kept.project }, rule: kept.rule, phase: "complete" };
    }

    // The saved desk must read before anything moves: an unknown shape is never an empty desk.
    const desk = path.join(m.legacy, "desk.json");

    if (yield* fs.exists(desk).pipe(Effect.orElseSucceed(() => false))) {
      const text = yield* fs.readFileString(desk).pipe(Effect.mapError(() => refused("unknown")));
      yield* decodeSaved(text).pipe(Effect.mapError(() => refused("unknown")));
    }

    // A move under way keeps its project: a retry never imports into another one.
    const target =
      kept === null
        ? yield* pick(m.legacy, m.project)
        : { project: { root: kept.root, key: kept.project }, rule: kept.rule };

    if (m.live !== undefined && (yield* m.live())) {
      if (m.restart === "refused") {
        return yield* refused("live");
      }

      yield* m.stop?.() ?? Effect.void;
    }

    const files = yield* durableFiles(m.legacy);
    const originals = yield* factsUnder(m.legacy, files);

    if (originals === null) {
      return yield* refused("failed");
    }

    const digests = Object.fromEntries(Object.entries(originals).map(([f, x]) => [f, x.digest]));
    const marker = (phase: Marker["phase"], at: number): Marker => ({
      format: 1,
      project: target.project.key,
      root: target.project.root,
      rule: target.rule,
      files: files.length,
      digests,
      phase,
      at,
      result: phase === "complete" ? "moved" : "moving",
    });
    const failed = () => refused("failed");
    yield* fs.makeDirectory(m.home, { recursive: true, mode: 0o700 }).pipe(Effect.mapError(failed));
    yield* writeMarker(file, marker("copying", yield* Clock.currentTimeMillis)).pipe(Effect.mapError(failed));

    const projects = path.join(m.home, "projects");
    const home = path.join(projects, target.project.key);
    const published = yield* fs.exists(home).pipe(Effect.orElseSucceed(() => false));

    if (published) {
      // A rename that went through before its marker did: done, once it checks.
      if (!same(yield* factsUnder(home, files), originals)) {
        return yield* refused(kept === null ? "taken" : "failed");
      }
    } else {
      const staging = `${home}.moving`;
      yield* fs.remove(staging, { recursive: true }).pipe(Effect.ignore);

      for (const name of files) {
        const to = path.join(staging, name);
        const mode = yield* fs.stat(path.join(m.legacy, name)).pipe(
          Effect.map((info) => info.mode & 0o777),
          Effect.mapError(failed),
        );
        yield* fs.makeDirectory(path.dirname(to), { recursive: true, mode: 0o700 }).pipe(Effect.mapError(failed));
        yield* fs.copyFile(path.join(m.legacy, name), to).pipe(Effect.mapError(failed));
        yield* fs.chmod(to, mode).pipe(Effect.mapError(failed));
      }

      if (!same(yield* factsUnder(staging, files), originals)) {
        return yield* refused("failed");
      }

      yield* fs.rename(staging, home).pipe(Effect.mapError(failed));
    }

    yield* writeMarker(file, marker("complete", yield* Clock.currentTimeMillis)).pipe(Effect.mapError(failed));
    return { project: target.project, rule: target.rule, phase: "complete" };
  });
