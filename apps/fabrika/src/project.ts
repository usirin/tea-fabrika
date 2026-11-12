import { createHash } from "node:crypto";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { alive } from "./host/lock.ts";
import { type HostPaths, MAX_SOCKET_PATH, pathsOf, reach } from "./host/socket.ts";
import { ProjectSchema } from "./projects.ts";

// A project: one git working tree, checked. Today's app, ticket 276 (a window is one project,
// docs/direction/project-window.md). The root is the real top folder git names for the folder a
// person picked, after every link is resolved; the key is the full SHA-256 of that root.
//
//   yield* Project.check("~/code/demlik/src")       {root: "~/code/demlik", key: "3f9a…"}
//   yield* Project.check("~/code/demlik-link")      the same project: links resolve
//   yield* Project.check("~/notes")                 ProjectRefused "Choose a folder in a git repository"
//   yield* Project.paths(appHome, project)
//   // {dir: "/tmp/fabrika-<uid>/9c1e…", sock, mcp, pid, lock}     short, private, outside the home
//   // {log: "<appHome>/projects/<key>/host/log"}                durable, inside the home
//
// A subfolder picks its repository's root. A worktree and a second clone are projects of their
// own, even when their remotes match: each has its own working files. git is asked, never
// guessed: a `.git` file (a worktree) is as good as a `.git` folder. Nothing here runs `git init`
// or falls back to the app's own folder.
//
// The durable state of a project lives under `<appHome>/projects/<key>/`, in today's formats
// (host/run.ts). Its sockets, pid and start lock live in a short private folder of the system's
// temp folder, named by the app home and the key together, so two app homes never share a host
// and a socket path stays under macOS's 104 bytes however deep the home is (`MAX_SOCKET_PATH`).
//
// Node at its edge, said here: `node:crypto` for the digest and `process.getuid` for the private
// folder's owner. git runs through Effect's ChildProcessSpawner.

// The schema is projects.ts's, so the window's code can read a project with no Node in it.
export { ProjectSchema } from "./projects.ts";
export type Project = typeof ProjectSchema.Type;

/** A folder that is not a project, said in words a person can act on. */
export class ProjectRefused extends Schema.TaggedError<ProjectRefused>()("ProjectRefused", {
  why: Schema.String,
  /** What was wrong: the folder was not there, could not be read, or is no git working tree. */
  kind: Schema.Literals(["missing", "unreadable", "not_git"]),
}) {
  get message() {
    return this.why;
  }
}

/** The words each refusal says. None names the folder: a path is private, and may hold anything. */
export const REFUSED = {
  missing: "That folder is missing. It may have moved or been deleted.",
  unreadable: "That folder can't be read: permission denied.",
  not_git: "Choose a folder in a git repository",
} as const;

const refused = (kind: keyof typeof REFUSED) => new ProjectRefused({ kind, why: REFUSED[kind] });

const keyOf = (root: string) => createHash("sha256").update(root).digest("hex");

/** git's own answer for the folder's top, or `null`: it is no working tree, or git is not there. */
const topOf = (folder: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make("git", ["-C", folder, "rev-parse", "--show-toplevel"], {
        // Only what git needs: an inherited GIT_DIR or GIT_WORK_TREE would answer for another tree.
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" },
        extendEnv: false,
      }),
    );
    const [out, code] = yield* Effect.all([handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode], {
      concurrency: "unbounded",
    });
    const top = out.trim();
    return Number(code) === 0 && top !== "" ? top : null;
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => null),
    // git is the system's own program: a check needs no spawner from its caller, only files.
    Effect.provide(NodeChildProcessSpawner.layer),
  );

/**
 * Check a folder a person picked: it is there, it can be read, and git names a working tree for
 * it. Answers its project, by the real top folder.
 */
const check = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .stat(folder)
      .pipe(
        Effect.mapError((e) =>
          e.reason._tag === "NotFound"
            ? refused("missing")
            : e.reason._tag === "PermissionDenied"
              ? refused("unreadable")
              : refused("unreadable"),
        ),
      );
    const real = yield* fs.realPath(folder).pipe(Effect.mapError(() => refused("unreadable")));
    const top = yield* topOf(real);

    if (top === null) {
      return yield* refused("not_git");
    }

    const root = yield* fs.realPath(top).pipe(Effect.mapError(() => refused("unreadable")));
    const project: Project = { root, key: keyOf(root) };
    return project;
  });

/** The folder under the system's temp folder that holds every runtime folder of this user's hosts. */
const runtimeRoot = () =>
  // Node at its edge: the user's id names the folder, so two users never share one.
  `/tmp/fabrika-${typeof process.getuid === "function" ? process.getuid() : 0}`;

/** A project's durable folder in an app home: `<appHome>/projects/<key>`. */
const homeOf = (appHome: string, project: Project) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(appHome, "projects", project.key);
  });

/**
 * Where a project's host keeps its files: its sockets, pid and start lock in a short private
 * runtime folder named by the app home and the key, and its log in the project's durable home.
 */
const paths = (appHome: string, project: Project) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonical = yield* fs.realPath(appHome).pipe(Effect.orElseSucceed(() => path.resolve(appHome)));
    const id = createHash("sha256").update(`${canonical}\0${project.key}`).digest("hex");
    const dir = path.join(runtimeRoot(), id.slice(0, 24));
    const durable = yield* homeOf(appHome, project);
    const found: HostPaths = {
      dir,
      sock: path.join(dir, "sock"),
      mcp: path.join(dir, "mcp"),
      pid: path.join(dir, "pid"),
      lock: path.join(dir, "lock"),
      log: path.join(durable, "host", "log"),
    };

    for (const socket of [found.sock, found.mcp]) {
      if (Buffer.byteLength(socket, "utf8") > MAX_SOCKET_PATH) {
        return yield* Effect.die(`the host's socket path is longer than ${MAX_SOCKET_PATH} bytes`);
      }
    }

    return found;
  });

/** A runtime folder that someone else made, or opened to others, is refused: never used. */
export class RuntimeRefused extends Schema.TaggedError<RuntimeRefused>()("RuntimeRefused", {
  why: Schema.String,
}) {
  get message() {
    return this.why;
  }
}

/**
 * Make the runtime folders, mode 0700, and check them before anything is put there: each is a
 * folder, this user's, and open to no one else. A name taken by another user is a refusal, never
 * a way to reach their host.
 */
const prepare = (found: HostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const uid = typeof process.getuid === "function" ? process.getuid() : null;

    for (const folder of [path.dirname(found.dir), found.dir]) {
      yield* fs.makeDirectory(folder, { recursive: true, mode: 0o700 });
      const info = yield* fs.stat(folder);
      // A link in its place could point anywhere: only a real folder is used.
      const linked = yield* fs.readLink(folder).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      const owner = info.uid._tag === "Some" ? info.uid.value : uid;

      if (info.type !== "Directory" || linked || (uid !== null && owner !== uid)) {
        return yield* new RuntimeRefused({
          why: "the host's private folder belongs to someone else: fabrika will not use it",
        });
      }

      if ((info.mode & 0o077) !== 0) {
        yield* fs.chmod(folder, 0o700);
      }
    }
  });

/**
 * Clean up after a host that is gone, for this project only: its sockets, its pid and a start
 * lock whose process is gone. A host that answers is left alone. No other project's file is
 * named, so none is touched.
 */
const recover = (appHome: string, project: Project, _why: "crash" | "stale" | "restart") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const found = yield* paths(appHome, project);

    if ((yield* reach(found.sock)) === "live") {
      return "live" as const;
    }

    const gone = (file: string) =>
      fs.remove(file).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.void,
        ),
      );

    for (const file of [found.sock, found.mcp, found.pid]) {
      yield* gone(file);
    }

    const held = yield* fs.readFileString(found.lock).pipe(Effect.orElseSucceed(() => ""));
    const pid = Number.parseInt(held, 10);

    if (!Number.isInteger(pid) || !(yield* alive(pid))) {
      yield* gone(found.lock);
    }

    return "cleaned" as const;
  });

/** A project's name as a window and a row say it: full, and shortened to fit a width in px. */
export interface Title {
  readonly project: Project;
  readonly full: string;
  readonly accessible: string;
  readonly short: string;
}

/** About how wide one character of the top bar's text is, in px. */
const CHAR_PX = 8;

/**
 * Each project's title: its folder's name, and for two of the same name the shortest run of
 * parent folders that tells them apart, as editors title equal file names. `width` shortens what
 * is drawn; the full title is kept for the window's title and a screen reader.
 *
 *   titles([~/a/left/repo, ~/a/right/repo], 400)   ["repo · left", "repo · right"]
 */
const titles = (projects: readonly Project[], width: number): readonly Title[] => {
  const parts = projects.map((p) => p.root.split("/").filter((s) => s !== ""));
  const room = Math.max(8, Math.floor(width / CHAR_PX));
  return projects.map((project, i) => {
    const mine = parts[i] ?? [];
    const base = mine.at(-1) ?? project.root;
    const twins = parts.filter((other, j) => j !== i && other.at(-1) === base);
    let depth = 0;
    const parentsOf = (segments: readonly string[], d: number) =>
      segments.slice(Math.max(0, segments.length - 1 - d), segments.length - 1).join("/");

    while (depth < mine.length - 1 && twins.some((other) => parentsOf(other, depth) === parentsOf(mine, depth))) {
      depth += 1;
    }

    const full = depth === 0 ? base : `${base} · ${parentsOf(mine, depth)}`;
    const short = full.length > room ? `${full.slice(0, room - 1)}…` : full;
    return { project, full, accessible: full, short };
  });
};

/** A project record a host was handed in its home, read and checked again, or why not. */
export class ProjectRecordRefused extends Schema.TaggedError<ProjectRecordRefused>()("ProjectRecordRefused", {
  why: Schema.String,
}) {
  get message() {
    return this.why;
  }
}

const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectSchema));

/**
 * The project a host's home names in its `project.json`, checked again now: the folder is still
 * a working tree, its real root is the one recorded, and its key is that root's.
 */
const read = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs
      .readFileString(path.join(home, "project.json"))
      .pipe(Effect.mapError(() => new ProjectRecordRefused({ why: "the home names no project.json" })));
    const record = yield* decodeRecord(text).pipe(
      Effect.mapError(() => new ProjectRecordRefused({ why: "project.json does not read" })),
    );
    const project = yield* check(record.root).pipe(
      Effect.mapError((e) => new ProjectRecordRefused({ why: `the project's folder: ${e.why}` })),
    );

    if (project.root !== record.root || project.key !== record.key) {
      return yield* new ProjectRecordRefused({
        why: "project.json names a root or key that is not its own",
      });
    }

    return project;
  });

/** Write a project's record into its home, beside the file and then over it. */
const write = (home: string, project: Project) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(home, { recursive: true, mode: 0o700 });
    const file = path.join(home, "project.json");
    yield* fs.writeFileString(`${file}.new`, JSON.stringify(project), { mode: 0o600 });
    yield* fs.rename(`${file}.new`, file);
  });

/**
 * The host's paths for a home a command or a host was handed: a project's home (it holds
 * `project.json`) has them under its app home's runtime folder; any other home keeps them in
 * `<home>/host/`, as before projects.
 */
const hostPaths = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(path.join(home, "project.json")).pipe(Effect.orElseSucceed(() => null));

    if (text === null) {
      return yield* pathsOf(home);
    }

    const record = yield* decodeRecord(text).pipe(Effect.orElseSucceed(() => null));

    if (record === null || path.basename(home) !== record.key) {
      return yield* pathsOf(home);
    }

    return yield* paths(path.dirname(path.dirname(home)), record);
  });

/**
 * The home a command means: a project's home as it is; an app home with one project, that
 * project's; an app home with several, none: the command asks for one rather than guess the
 * window in front. A home from before projects is its own.
 */
const select = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (yield* fs.exists(path.join(home, "project.json"))) {
      return home;
    }

    const folder = path.join(home, "projects");
    const keys = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []));
    const homes: string[] = [];

    for (const key of keys) {
      if (yield* fs.exists(path.join(folder, key, "project.json"))) {
        homes.push(path.join(folder, key));
      }
    }

    const [only, ...more] = homes;

    if (only === undefined) {
      return home;
    }

    if (more.length > 0) {
      return yield* new ProjectRecordRefused({
        why: `this app home holds ${homes.length} projects: name one with FABRIKA_HOME=<app home>/projects/<key>`,
      });
    }

    return only;
  });

export const Project = {
  schema: ProjectSchema,
  check,
  paths,
  prepare,
  recover,
  titles,
  read,
  write,
  home: homeOf,
  hostPaths,
  select,
} as const;
