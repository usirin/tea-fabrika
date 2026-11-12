import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Effect, FileSystem, PlatformError, Result } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { defaults } from "./desk/keymap.ts";
import { MAX_SOCKET_PATH } from "./host/socket.ts";
import { git, go, home, options, plant, repo, word } from "./project.test-support.ts";
import type { Project } from "./project.ts";
import type { Look } from "./projects.ts";
import { type HostStart, startHost } from "./start-host.ts";

const roots = fc.record({
  name: word,
  sub: word,
  failure: fc.constantFrom("non-git", "missing", "unreadable"),
});

const checked = (project: { root: string; key: string }, root: string) => {
  expect(project.root).toBe(root);
  expect(project.key).toBe(createHash("sha256").update(root).digest("hex"));
};

type ProjectApi = (typeof import("./project.ts"))["Project"];

/** P4's check: a root, a subfolder, a link and a worktree select their real root; invalid folders are refused. */
const selectsRoot = async (
  check: ProjectApi["check"],
  { name, sub, failure }: typeof roots extends fc.Arbitrary<infer A> ? A : never,
) => {
  const Project = { check };
  const app = home();
  const root = repo(app, name);
  const nested = join(root, sub);
  mkdirSync(nested);
  const linked = join(app, "alias");
  symlinkSync(root, linked);
  git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  );
  const worktree = join(app, "worktree");
  git(root, "worktree", "add", "-qb", "fixture-worktree", worktree);

  for (const folder of [root, nested, linked]) {
    checked(await go(Project.check(folder)), root);
  }

  checked(await go(Project.check(worktree)), worktree);
  const invalid = join(app, "invalid");

  if (failure !== "missing") {
    mkdirSync(invalid);
  }

  const answer = await go(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const denied = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "stat",
        description: "fixture denies folder",
      });
      const disk = FileSystem.FileSystem.of({
        ...fs,
        stat: (path) => (path === invalid && failure === "unreadable" ? Effect.fail(denied) : fs.stat(path)),
      });
      return yield* Project.check(invalid).pipe(Effect.provideService(FileSystem.FileSystem, disk), Effect.result);
    }),
  );
  expect(Result.isFailure(answer)).toBe(true);

  if (Result.isFailure(answer)) {
    expect(String(answer.failure)).toMatch(
      failure === "non-git"
        ? /Choose a folder in a git repository/
        : failure === "missing"
          ? /missing|not found|no longer/i
          : /read|permission/i,
    );
  }
};

it("P4: subfolders, links and worktrees select their real root; invalid folders start nothing", async () => {
  const { Project } = await import("./project.ts");
  await fc.assert(
    fc.asyncProperty(roots, (input) => selectsRoot(Project.check, input)),
    options,
  );
});

// The plant: a project needs a `.git` directory, so a worktree, whose `.git` is a file, is refused.
plant("P4 require a .git directory, rejecting a worktree", roots, async (input) => {
  const { Project } = await import("./project.ts");
  await selectsRoot(
    (folder) =>
      Effect.gen(function* () {
        const project = yield* Project.check(folder);
        const fs = yield* FileSystem.FileSystem;
        const git = yield* fs.stat(join(project.root, ".git")).pipe(Effect.orDie);

        if (git.type !== "Directory") {
          return yield* Effect.die(new Error("Choose a folder in a git repository"));
        }

        return project;
      }),
    input,
  );
});

const longPaths = fc.record({
  root: fc.array(fc.constantFrom("界", "é", "🫖"), { minLength: 110, maxLength: 180 }),
  home: word,
});

const socketCheck = (paths: { sock: string; mcp: string; log: string; dir: string }, durable: string) => {
  for (const socket of [paths.sock, paths.mcp]) {
    expect(Buffer.byteLength(socket, "utf8")).toBeLessThanOrEqual(MAX_SOCKET_PATH);
  }

  expect(paths.log).toBe(join(durable, "host", "log"));
  expect(paths.dir).not.toBe(join(durable, "host"));
};

/** P9's check: both sockets fit in bytes for long Unicode roots and homes, and two app homes stay apart. */
const shortSockets = async (
  pathsOf: ProjectApi["paths"],
  { root, home: name }: typeof longPaths extends fc.Arbitrary<infer A> ? A : never,
) => {
  const { Project } = await import("./project.ts");
  const app = home();
  const segments = Array.from({ length: Math.ceil(root.length / 20) }, (_, i) =>
    root.slice(i * 20, (i + 1) * 20).join(""),
  );
  const folder = repo(app, join("roots", ...segments, "repo"));
  const project = await go(Project.check(folder));
  const firstHome = join(app, name, ...segments);
  const secondHome = join(app, `${name}-other`, ...segments);
  mkdirSync(firstHome, { recursive: true });
  mkdirSync(secondHome, { recursive: true });
  const a = await go(pathsOf(firstHome, project));
  const b = await go(pathsOf(secondHome, project));
  socketCheck(a, join(firstHome, "projects", project.key));
  socketCheck(b, join(secondHome, "projects", project.key));
  expect(a.sock).not.toBe(b.sock);
  expect(a.mcp).not.toBe(b.mcp);
};

it("P9: both runtime sockets fit 103 UTF-8 bytes and include the app home's identity", async () => {
  const { Project } = await import("./project.ts");
  await fc.assert(
    fc.asyncProperty(longPaths, (input) => shortSockets(Project.paths, input)),
    options,
  );
});

// The plant: the sockets' name hashes only the project's root, so two app homes share them.
plant("P9 hash only the root", longPaths, async (input) => {
  const { Project } = await import("./project.ts");
  const shared = home();
  await shortSockets(
    (appHome, project) =>
      Effect.zipWith(Project.paths(appHome, project), Project.paths(shared, project), (own, rootOnly) => ({
        ...own,
        sock: rootOnly.sock,
        mcp: rootOnly.mcp,
      })),
    input,
  );
});

const names = fc.record({ name: word, parent: word, width: fc.integer({ min: 120, max: 1024 }) });

const titlesCheck = (titles: readonly string[], name: string) => {
  expect(new Set(titles).size).toBe(2);

  for (const title of titles) {
    expect(title).toContain(name);
  }
};

type Titles = (typeof import("./project.ts"))["Project"]["titles"];

/** P15's check: two real projects with one folder name get distinct full titles, said in full. */
const distinctTitles = async (
  titlesOf: Titles,
  { name, parent, width }: { name: string; parent: string; width: number },
) => {
  const { Project } = await import("./project.ts");
  const app = home();
  const a = await go(Project.check(repo(app, `${parent}/left/${name}`)));
  const b = await go(Project.check(repo(app, `${parent}/right/${name}`)));
  const titles = titlesOf([a, b], width);
  titlesCheck(
    titles.map((title) => title.full),
    name,
  );

  for (const title of titles) {
    expect(title.accessible).toBe(title.full);
  }
};

it("P15: equal folder names have distinct full titles at every display width", async () => {
  const { Project } = await import("./project.ts");
  await fc.assert(
    fc.asyncProperty(names, (input) => distinctTitles(Project.titles, input)),
    options,
  );
});

// The plant: each title is the folder's own name, the basename taken as identity.
plant("P15 use basename as identity", names, async (input) => {
  const { Project } = await import("./project.ts");
  await distinctTitles(
    (projects, width) =>
      Project.titles(projects, width).map((title, i) => {
        const base = projects[i]!.root.split("/").at(-1)!;
        return { ...title, full: base, accessible: base };
      }),
    input,
  );
});

// P19 is compiled by the app's normal type check. Each refused value carries only the fields its
// type has, plus the one wrong part its directive names, so the directive goes unused, and the type
// check fails, when its plant lands: a host link allowed on welcome, project made optional on a
// project window or on HostStart, or a raw root taken for a checked Project.
const invalidWindows = (project: Project, start: Omit<HostStart, "project">) => {
  // @ts-expect-error P19 welcome cannot hold a host link
  const welcome: Look = { _tag: "welcome", selected: "folder", link: { kind: "up" } };
  // @ts-expect-error P19 a project window requires its checked Project
  const absent: Look = { _tag: "project", name: "fixture" };
  const unchecked: Look = {
    _tag: "project",
    // @ts-expect-error P19 a raw root is not a checked Project
    project: { root: project.root },
    name: "fixture",
  };
  // @ts-expect-error P19 a host start names its project
  const unnamed: HostStart = { ...start };
  // @ts-expect-error P19 welcome is not a checked Project for starting a host
  const host: HostStart = { ...start, project: welcome };
  // @ts-expect-error P19 a welcome page cannot start a host
  const started = startHost({ ...start, project: welcome });
  return [welcome, absent, unchecked, unnamed, host, started];
};

void invalidWindows;

/** P26's check: the decided File menu, as the menu function gives it for the default Mac keys. */
const decidedMenu = async (menuOf: (typeof import("./projects.ts"))["projectMenu"]) => {
  const { rows } = await import("./projects.ts");
  const menu = menuOf(defaults, true);
  expect(menu).toContainEqual(
    expect.objectContaining({ label: "Open Project…", accelerator: "Command+O", action: "projects" }),
  );
  expect(menu).toContainEqual(
    expect.objectContaining({ label: "Open Folder…", accelerator: undefined, action: "folder" }),
  );
  expect(rows([]).at(-1)).toMatchObject({ _tag: "folder", caps: [] });
};

it("vector: P26 the decided File menu assigns Cmd-O only to Open Project…", async () => {
  // A fixed vector because these exact labels and the default Mac accelerator are decided.
  const { projectMenu } = await import("./projects.ts");
  await decidedMenu(projectMenu);
});

// The plant: Open Folder… takes Cmd-O too.
plant("P26 put Cmd-O on Open Folder", fc.constant("Command+O"), async (accelerator) => {
  const { projectMenu } = await import("./projects.ts");
  await decidedMenu((keys, mac) =>
    projectMenu(keys, mac).map((item) => (item.label === "Open Folder…" ? { ...item, accelerator } : item)),
  );
});
