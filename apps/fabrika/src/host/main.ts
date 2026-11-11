import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { gitHubCodeHost, gitHubCodeTree } from "@kampus/pipeline/code-host-github";
import { GITHUB, gitHubPullRequests, gitHubRepoTree } from "@tea-fabrika/tracker/github";
import { Effect, FileSystem, Layer, Logger, Path, Runtime } from "effect";
import { Project, ProjectRecordRefused } from "../project.ts";
import { hostJev } from "./jev.ts";
import { runHost } from "./run.ts";

// The host process: the entry of dist/host.mjs. It holds every tile's tsh, every program, the
// line editor's history, one job table for every tile, the ledger and the desk, and it outlives the app, as
// tmux's server outlives its clients. The app is a client of it (attach.ts): it starts the host
// when none answers, and Cmd-Q quits the app only.
//
//   ELECTRON_RUN_AS_NODE=1 FABRIKA_HOME=<home> <Electron's own binary> dist/host.mjs
//
// It is the app's own Electron binary, run as plain Node (`ELECTRON_RUN_AS_NODE`): the app
// already ships it, so the host runs the same Node, with the same node:sqlite, as the build was
// tested on, and nothing else has to be found on the user's machine. The app starts it detached,
// with no stdin or stdout: it logs to <home>/host/log, and its stderr is appended there too, so a
// host that dies before its logger is up still says why (start-host.ts).
//
// FABRIKA_HOME is always given: the host never guesses a home, so a host started by a test can
// never be the owner's, and the owner's never a test's. With none, it does not start. It is a
// project's home, `<appHome>/projects/<key>` (ticket 276): its `project.json` names the project,
// and is checked again here (project.ts, `Project.read`), so a record that is missing, forged or
// names a folder that moved starts no host. The project's root is where the agents the person
// summons work; an inherited FABRIKA_REPO is never read. The sockets, pid and start lock are in
// the project's short private runtime folder (`Project.paths`); the log stays in the home.
// FABRIKA_SETTINGS names the folder that holds keybindings.toml: `~/.fabrika` for the owner's
// start, as the app passes it (start-host.ts), shared by every project's host. With none, the
// home holds it.
//
// It stops on SIGTERM or SIGINT (`NodeRuntime.runMain`): the scope closes, every tile's tsh stops
// with it, the jobs stay in the host's table for `attach` at the next start, and the socket and
// the pid file go. An agent's `restart` ends it the same way from inside, with no signal sent
// (host/serve.ts), after it leaves its note for the next host (host/restart.ts).
// A person stops it only through the window's restart, or `fabrika connect`, which stops it so the
// app starts one on the new ledger (host/connection.ts). A test stops its own by the pid in its home.
//
// Node at its thinnest edge, said here: `process.env`, `process.pid`, `process.platform`, and
// `process.umask`, set to 0o077 before anything is made, so every file the host makes is the
// user's alone even before its mode is set.

const home = process.env.FABRIKA_HOME;

/**
 * The tracker's pull requests: its GitHub integration, on the pipeline's `CodeHost`, so on the
 * person's own `gh` login. The connected repositories are the integration's own list (`GITHUB`).
 * The host holds the login; no page sees it.
 */
const pullRequests = Layer.provide(gitHubPullRequests(GITHUB), gitHubCodeHost({ own: [], reviewers: [] }));

/**
 * The connected repositories' top folders, for the tracker's first-areas suggestions: one GitHub
 * call per repository on the same `gh` login, kept for the session once one comes back.
 */
const repoTree = Layer.provide(gitHubRepoTree(GITHUB), gitHubCodeTree({}));

const main = Effect.gen(function* () {
  if (home === undefined || home === "") {
    return yield* Effect.die("fabrika host: FABRIKA_HOME is not set; the host starts on no home");
  }

  process.umask(0o077);
  // The project this home is for, read from its record and checked again: a missing, forged or
  // moved record starts no host. An inherited FABRIKA_REPO is never read.
  const project = yield* Project.read(home);
  const path = yield* Path.Path;

  if (path.basename(home) !== project.key) {
    return yield* new ProjectRecordRefused({ why: "the home is not the project's own folder" });
  }

  const paths = yield* Project.paths(path.dirname(path.dirname(home)), project);
  // The log is in the project's durable host folder, so the folder is there before the log opens.
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(path.dirname(paths.log), { recursive: true, mode: 0o700 });
  const toFile = yield* Logger.toFile(Logger.formatSimple, paths.log, { flag: "a" });
  // The keys file's folder, as the app said; `mod` in it is Cmd on a Mac (host/settings.ts).
  const settings = process.env.FABRIKA_SETTINGS;
  return yield* runHost({
    home,
    pid: process.pid,
    settings: settings === undefined || settings === "" ? undefined : settings,
    mac: process.platform === "darwin",
    project,
    repo: project.root,
    paths,
  }).pipe(
    // Jev, for the tracker's duplicate hint, only when the home holds a key (jev.ts).
    Effect.provide(Layer.merge(Logger.layer([toFile]), hostJev(home))),
  );
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
      pullRequests,
      repoTree,
    ),
  ),
);

// An agent's restart ends the host with a success (host/serve.ts): it exits then, as on SIGTERM,
// and nothing left open can keep the process alive with no socket.
NodeRuntime.runMain(main, {
  teardown: (exit) => Runtime.defaultTeardown(exit, (code) => process.exit(code)),
});
