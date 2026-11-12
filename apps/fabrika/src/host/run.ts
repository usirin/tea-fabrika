import { monitorEventLoopDelay } from "node:perf_hooks";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import { keepJobs, layerRecordTraces, openJobs, stepsInto, writerText } from "@kampus/fabrika-old";
import { type SummonRecord, summonManager } from "@kampus/fabrika-old/agents/summon";
import { RestartRefused } from "@kampus/fabrika-old/mcp";
import { recordTracing } from "@kampus/fabrika-old/otel";
import { sqliteRecords } from "@kampus/fabrika-old/records";
import { fileStorage } from "@kampus/fabrika-old/storage/node";
import { Author } from "@tea-fabrika/tracker";
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Schema, Scope } from "effect";
import { SocketServer } from "effect/socket";
import { BUILD } from "../build-id.ts";
import { fileHistory, sharedHistory } from "../editor/history.ts";
import { Project } from "../project.ts";
import { agentSessions } from "./agent-session.ts";
import { connectionOf, hostLedger } from "./connection.ts";
import { KeybindingManager } from "./keybindings.ts";
import { holdLock } from "./lock.ts";
import { logSteps, sampleLag } from "./log.ts";
import { appendRecord } from "./records.ts";
import { leaveNote, takeNote } from "./restart.ts";
import { serve } from "./serve.ts";
import { type HostPaths, pathsOf, reach } from "./socket.ts";

// The host on a home: its socket, its files and its services, around the server (serve.ts).
// host/main.ts runs it as a process of its own; a test runs it in its own process, on a home of
// its own (host.test.ts). Node is named only through Effect's platform: `NodeSocketServer`, and
// the ledger's node:sqlite and the storage's files from @kampus/fabrika-old; and `node:perf_hooks`,
// for the event loop's delay (log.ts).
//
//   yield* runHost({home, pid: process.pid})
//   // <home>/host made, mode 0700; the start lock taken (host/lock.ts); a socket left by a crash
//   // removed; <home>/host/sock listened on, mode 0600; <home>/host/mcp too, the agents' socket
//   // (host/agents.ts), mode 0600, each agent on its own session on a home connected to a
//   // ledger server (host/agent-session.ts); the pid
//   // written; the lock let go of; the desk read back from desk.json, the asks' marks from
//   // asks.json; the thread's lag read once a second, and each lane step's begin and end said
//   // (log.ts); until the scope closes, or an agent's `restart` is answered (host/serve.ts):
//   // then it ends of itself, with a success, as a SIGTERM ends it
//
// Each start takes the note a restart left (host/restart.ts) and logs its `host_began` line:
//
//   level=INFO message=host_began build=3f9a0c21
//   level=INFO message=host_began build=3f9a0c21 after=restart "by=agent:claude for:owner" "why=pick up the new build"
//
// In the home, beside the host's own folder (host/socket.ts):
//
//   desk.json            the desk's tiles, kept on each change, for the next start
//   asks.json            the person's later and seen on the asks, kept on each change (asks.ts)
//   storage/jobs/        the host's one job table and its jobs' runs, for every tile's tsh, as
//                        the terminal tsh's host keeps them. A storage/tiles/<t>/ folder left
//                        by an older build (one table per tile) is not read, and not removed
//   records/<trace>.sqlite  one job's record each (`sqliteRecords`): its start and end, its
//                        spans and its steps, what `trace` shows
//   history              the line editor's history, one for every tile
//   ledger.sqlite        the ledger, when the home is connected to no server
//   ledger.json          the ledger server it is connected to, if any (connection.ts)
//   host/restart.json    who restarted the host before, why and when, read once (restart.ts)
//
// In the settings folder, `~/.fabrika` for the owner's start and the home for any other
// (host/settings.ts): keybindings.toml, the keys the person changed (desk/keymap.ts), heard on
// each save.
//
// One host per home: a host that finds another answering on the socket does not start, and
// hosts started at the same moment take turns under the start lock, so exactly one listens. The
// ledger and who the host writes as are `hostLedger`'s: with no `ledger.json`, one node:sqlite
// connection in this thread (`layerSqliteSync`: the bundle has no worker file beside it), its
// alarm looking for due jobs once a second, and the owner; connected, the server over HTTP and
// the person its door let in.

/** Another host answers on this home's socket already. */
export class HostAnswers extends Schema.TaggedError<HostAnswers>()("HostAnswers", {
  sock: Schema.String,
}) {}

export const runHost = (options: {
  readonly home: string;
  /** The host's pid, written for a test to stop its own host by. */
  readonly pid: number;
  /** The link's version this host speaks, for a test of an old host. */
  readonly ours?: number | undefined;
  /** The build this host's hello names, for a test of an older host; `null` names none. */
  readonly build?: string | null | undefined;
  /**
   * The person's settings folder, which holds keybindings.toml (host/settings.ts,
   * `settingsFolder`): `~/.fabrika` for the owner's start. The home itself when not said, as for
   * a test's or an agent's start, so none reads the person's real file.
   */
  readonly settings?: string | undefined;
  /** The host runs on a Mac: `mod` in the keys file is Cmd there, and Ctrl elsewhere. */
  readonly mac?: boolean | undefined;
  /**
   * The person's git repository, where the agents they summon work (`FABRIKA_REPO`). Not said:
   * the host keeps no summoned agents, and tsh's `summon` says how to give it one.
   */
  readonly repo?: string | undefined;
  /**
   * The checked project this host serves (project.ts): its hello names it, its summoned agents
   * work in its root, and its records say which repository it served. Not said: a test's host,
   * or a home from before projects.
   */
  readonly project?: Project | undefined;
  /**
   * Where its sockets, pid, lock and log are: `Project.paths` for a project's host, whose
   * runtime files are in a short private folder outside the home. Not said: `<home>/host/`.
   */
  readonly paths?: HostPaths | undefined;
  /** Why this host started, for its record: the app started it, or it was restarted. */
  readonly reason?: string | undefined;
}) =>
  Effect.gen(function* () {
    const { home, pid, ours, build, settings = home, mac = false, project } = options;
    // A project's agents work in its root, whatever else was said.
    const repo = project?.root ?? options.repo;
    /** The build this host names: `BUILD`, but in a test of an older host. */
    const named = build === undefined ? BUILD : build;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const paths = options.paths ?? (yield* pathsOf(home));
    const outer = yield* Effect.scope;

    if (options.paths === undefined) {
      yield* fs.makeDirectory(paths.dir, { recursive: true, mode: 0o700 });
      // A folder made before, by hand or by an older build, gets the narrow mode too.
      yield* fs.chmod(paths.dir, 0o700);
    } else {
      yield* Project.prepare(paths);
    }

    yield* fs.makeDirectory(path.dirname(paths.log), { recursive: true, mode: 0o700 });
    // Under the start lock (host/lock.ts), from the look at the socket until this host listens
    // on it: a host started at the same moment waits, then finds this one answering.
    const connection = yield* connectionOf(home);
    const { server, agents } = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* holdLock(paths.lock, paths.dir);
        const found = yield* reach(paths.sock);

        if (found === "live") {
          return yield* new HostAnswers({ sock: paths.sock });
        }

        if (found === "stale") {
          yield* fs.remove(paths.sock);
        }

        // No host answers, and this one holds the lock: an agents' socket here was left by one that is gone.
        if (yield* fs.exists(paths.mcp)) {
          yield* fs.remove(paths.mcp);
        }

        const made = yield* NodeSocketServer.make({ path: paths.sock }).pipe(Scope.provide(outer));
        yield* fs.chmod(paths.sock, 0o600);
        // Every home's agents' socket (host/agents.ts).
        const forAgents = yield* NodeSocketServer.make({ path: paths.mcp }).pipe(Scope.provide(outer));
        yield* fs.chmod(paths.mcp, 0o600);
        yield* fs.writeFileString(paths.pid, `${pid}\n`);
        return { server: made, agents: forAgents };
      }),
    );
    // The pid goes while this host still listens, so it never removes the pid of a host
    // started after it. The socket's own file goes as the server closes: Node removes it
    // before it lets go of the socket (libuv's `uv__pipe_close`), so this host never removes
    // a socket another host listens on.
    yield* Effect.addFinalizer(() => fs.remove(paths.pid).pipe(Effect.ignore));

    const at = (...names: string[]) => path.join(home, ...names);
    const ledger = yield* Layer.build(hostLedger(home));
    const history = yield* sharedHistory(yield* fileHistory(at("history")));
    const kept = yield* fs.readFileString(at("desk.json")).pipe(
      Effect.flatMap((text) => Effect.try(() => JSON.parse(text))),
      Effect.orElseSucceed((): unknown => null),
    );
    // The asks' marks, as written; serve.ts reads them, and says so when they do not read.
    const marks = yield* fs.readFileString(at("asks.json")).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.catch((e) =>
        Effect.as(Effect.logWarning(`fabrika host: could not read the asks' later and seen: ${e.message}`), null),
      ),
    );
    // Each job's record, kept as the person who runs the host: the table writes its start and
    // end, the runs' storage its steps, the tracer its spans. `trace` reads them.
    const records = yield* sqliteRecords({
      dir: at("records"),
      by: writerText(Context.get(ledger, Author)),
    });
    // The note a restart left (host/restart.ts), taken now that this host is the one that
    // listens: a host that stepped aside above never reads it.
    const before = yield* takeNote(paths);
    // One job table for the host process, for every tile's tsh, open until the host stops. After
    // a restart, each tile's tsh names who restarted it beside its jobs from an earlier tsh.
    // The agents the person summons, in their repository, kept in the home for the next start.
    // Each summon and turn is kept as a record of its own, with the project it was for: what a
    // reused agent name meant at that time.
    const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const agentRecord = (kind: "summon" | "turn", row: SummonRecord) =>
      appendRecord(at("records", "agents.jsonl"), {
        kind,
        project: project?.key ?? null,
        ...row,
      }).pipe(Effect.provideContext(files));
    const summons =
      repo === undefined
        ? Context.empty()
        : yield* Layer.build(
            summonManager({
              storage: fileStorage(at("storage", "summon")),
              folder: repo,
              record: agentRecord,
            }),
          );
    const jobs = {
      ...keepJobs(yield* openJobs(fileStorage(at("storage", "jobs"), stepsInto(records))), records, "laptop"),
      ...(before === null ? {} : { restarted: { by: before.by } }),
    };
    // The keys file, read now and again on each save, by the one reader of the settings folder.
    const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const keybindings = yield* KeybindingManager.make({
      folder: settings,
      mac,
      by: writerText(Context.get(ledger, Author)),
    });
    yield* Effect.logInfo(`fabrika host: listening, pid ${pid}`);
    // Which repository this host served, from which build, for which settings, and why it
    // started: a host that outlives its window is still named by it.
    yield* appendRecord(at("records", "host.jsonl"), {
      kind: "host",
      project: project?.key ?? null,
      root: repo ?? null,
      build: named,
      pid,
      settings: settings === home ? "home" : "shared",
      reason: before === null ? (options.reason ?? "started") : "restart",
      at: yield* Clock.currentTimeMillis,
    });
    // Every start's line: its build, and after a restart who restarted the host before it, and why.
    yield* Effect.logInfo("host_began").pipe(
      Effect.annotateLogs({
        build: named ?? "none",
        ...(before === null
          ? {}
          : {
              after: "restart",
              by: before.by,
              ...(before.why === null ? {} : { why: before.why }),
            }),
      }),
    );
    // The thread's lag, one second at a time: a lag line in the log when it is starved (log.ts).
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    yield* Effect.addFinalizer(() => Effect.sync(() => delay.disable()));
    yield* Effect.sleep("1 second").pipe(Effect.andThen(sampleLag(delay)), Effect.forever, Effect.forkScoped);
    return yield* serve({
      history,
      keybindings,
      ours,
      build: named,
      agents: { server: agents },
      restarts: {
        before,
        leave: (note) =>
          leaveNote(paths, note).pipe(
            Effect.provideContext(platform),
            Effect.mapError(
              (e) =>
                new RestartRefused({
                  why: `the host could not leave its note for the next host: ${e.message}`,
                }),
            ),
          ),
      },
      jobs,
      pid,
      project: project?.key,
      ledger: Option.isNone(connection)
        ? ({ kind: "own" } as const)
        : ({
            kind: "server",
            address: `${connection.value.url}/${connection.value.ledger}`,
            login: connection.value.login,
            sessionFor: yield* agentSessions(home),
          } as const),
      desk: {
        kept,
        save: (saved) =>
          fs
            .writeFileString(at("desk.json"), JSON.stringify(saved))
            .pipe(Effect.catch((e) => Effect.logError(`fabrika host: could not keep the desk: ${e.message}`))),
        forget: fs.remove(at("desk.json")).pipe(Effect.ignore),
      },
      asks: {
        kept: marks,
        // Written beside, then moved over: a host stopped mid-write leaves the last whole file.
        save: (saved) =>
          fs.writeFileString(at("asks.json.new"), JSON.stringify(saved)).pipe(
            Effect.andThen(fs.rename(at("asks.json.new"), at("asks.json"))),
            Effect.catch((e) => Effect.logError(`fabrika host: could not keep the asks' later and seen: ${e.message}`)),
          ),
      },
    }).pipe(
      Effect.provideService(SocketServer.SocketServer, server),
      Effect.provideContext(ledger),
      Effect.provideContext(summons),
      // Each lane step's begin and end in the log, read off the spans the records keep.
      Effect.provide(logSteps),
      Effect.provide(Layer.merge(layerRecordTraces(records), recordTracing(records))),
    );
  });
