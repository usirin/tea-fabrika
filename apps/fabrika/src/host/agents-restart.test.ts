import { createConnection } from "node:net";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import { Effect, Exit, Fiber, FileSystem, Layer, Logger, Path, Schedule, Scope } from "effect";
import { ChildProcess } from "effect/process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILD } from "../build-id.ts";
import { gridOf } from "../editor/grid.ts";
import type { Down } from "../link.ts";
import { readToPage, type ToPage } from "../messages.ts";
import { projectHome } from "../project.test-support.ts";
import { appWire } from "../wire.ts";
import { runHost } from "./run.ts";
import { pathsOf, reach } from "./socket.ts";

// An agent restarts the host with the host's `restart` tool, and must say why (tracker 185b, PR 5).
// Today's version, on a home of the test's own. Each host runs in this test's process, as
// host.test.ts runs one, so none is ever sent a signal: the restart ends `runHost` from inside
// (its `quit`), and a host that signalled itself would end this test. The test plays the app: it
// is attached to the old host, and when that host ends it starts the next one on the same home,
// as attach.ts starts one of its own build. The agent is an MCP client on the bridge Claude Code
// would start (`cli.ts mcp --as claude`), which outlives the host (PR 4).
//
//   tile t1   tsh$ seq --to 3          job %1, ended
//   tile t1   tsh$ counter             job %2, running in the foreground
//   agent     restart {why: "pick up the new build"}
//             {_tag: "restarting", detached: [2]}                    the answer goes out first
//   host/log  message=host_restart "by=agent:claude for:owner" "why=pick up the new build"
//             detached=2 foreground=t1:%2 idle_ms=... build=0ld0ld0ld0ld
//   <home>/host/restart.json   {by: "agent:claude for:owner", why: "pick up the new build", at, detached: [2]}
//   the host ends; the app starts the next one
//   host/log  message=host_began after=restart "by=agent:claude for:owner" "why=..." build=n3wn3wn3wn3w
//   top bar   HostNow.restarted {by: "agent:claude for:owner", why: "pick up the new build", at}
//   tile t1   tsh: 1 job from an earlier tsh, ... restarted by claude ... %2 ...
//   restart.json is gone: the host after this one says nothing of the restart
//
//   agent     restart {why: "..."}     no app attached: refused, "no app is attached to start a
//                                      new host"; the host runs on

const platform = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
  Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** On a home of its own file the person is the owner, and claude works for them. */
const AGENT = "agent:claude for:owner";
const WHY = "pick up the new build";
/** The old host's build and the new one's, as host.test.ts names two builds. */
const OLD = "0ld0ld0ld0ld";
const NEW = "n3wn3wn3wn3w";

/** Wait for `check` to answer something, ten seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
  Effect.gen(function* () {
    for (let i = 0; i < 2000; i += 1) {
      const got = check();

      if (got !== undefined) {
        return got;
      }

      yield* Effect.sleep("5 millis");
    }

    return yield* Effect.die(`waited for ${what}`);
  });

/** One log line's `key=value` fields, as `Logger.formatSimple` writes them, quotes taken off. */
const fieldsOf = (line: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const [, key = "", raw = ""] = m;
    out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
  }

  return out;
};

/** The lines whose message is `message`, read as fields. */
const said = (lines: readonly string[], message: string) => lines.map(fieldsOf).filter((f) => f.message === message);

/** Where the restart's note is: beside the host's socket and pid (made up: `restart.json`, the plan's). */
const noteIn = (home: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join((yield* pathsOf(home)).dir, "restart.json");
  });

/**
 * A host on `home` in this process, of build `build` (none given: `runHost`'s own), its log caught
 * in `lines`. `ended` is its fiber: done when the host ends of itself, as a restart ends it.
 */
const hostOn = (home: string, lines: string[], build?: string) =>
  Effect.gen(function* () {
    const paths = yield* pathsOf(home);
    const host = yield* Scope.make();
    const caught = Logger.make((o) => {
      lines.push(Logger.formatSimple.log(o));
    });
    const fiber = yield* runHost({ home, pid: process.pid, build }).pipe(
      Effect.scoped,
      Effect.provide(Logger.layer([caught])),
      Effect.forkIn(host),
    );
    yield* reach(paths.mcp).pipe(
      Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("5 millis") }),
      Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die("no agents' socket") }),
    );
    /** Done once the host ended of itself, ten seconds at most. */
    const ended = Fiber.await(fiber).pipe(
      Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die("the host ran on") }),
    );
    return { paths, ended, stop: Scope.close(host, Exit.void) };
  });

/** An app attached to the host on `sock`, its page loaded: tile t1's terminal, and the host's own state. */
const appOn = (sock: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const got: Down[] = [];
    const wire = yield* appWire(yield* NodeSocket.makeNet({ path: sock }), (m) => got.push(m)).pipe(
      Scope.provide(scope),
    );
    yield* wire.up;
    wire.send({ type: "page" });
    yield* until("tile t1", () => got.find((m) => m.type === "port" && m.port === "tile:t1"));
    /** Keys typed in tile t1's terminal. */
    const type = (data: string) => wire.send({ type: "on", port: "tile:t1", m: { type: "keys", data } });
    /** What tile t1's terminal shows, as rows, wide enough that no line wraps. */
    const rows = () =>
      gridOf(
        got
          .flatMap((m) =>
            m.type === "to" && m.port === "tile:t1" && typeof m.m === "object" && m.m !== null
              ? [String(Reflect.get(m.m, "data"))]
              : [],
          )
          .join(""),
        400,
        1000,
      ).rows;
    /** The host as it last said of itself, for the top bar. */
    const hostNow = () =>
      got
        .flatMap((m): ToPage[] => {
          if (m.type !== "to" || m.port !== "desk") {
            return [];
          }

          const read = readToPage(m.m);
          return read.kind === "read" ? [read.msg] : [];
        })
        .findLast((m) => m.type === "host");
    return { type, rows, hostNow, ended: wire.ended, leave: Scope.close(scope, Exit.void) };
  });

/** An MCP client, on the bridge Claude Code would start: `node cli.ts mcp --as <agent>`. */
const agentOn = (home: string, agent: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--as", agent],
      env: { ...getDefaultEnvironment(), FABRIKA_HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    yield* Effect.acquireRelease(
      Effect.promise(() => client.connect(transport)),
      () => Effect.promise(() => client.close()).pipe(Effect.ignore),
    );
    /** Every text the agent was answered, kept for the secrets check. */
    const heard: string[] = [];
    /**
     * One tool call: its text, and whether it is an error. A call while no host answers is a
     * JSON-RPC error from the bridge (PR 4), which the SDK throws: it is an error here too.
     */
    const call = (name: string, args: Record<string, unknown>) =>
      Effect.tryPromise(() => client.callTool({ name, arguments: args })).pipe(
        Effect.map((result) => {
          const first = Array.isArray(result.content) ? result.content[0] : undefined;
          const text = String(Reflect.get(Object(first), "text"));
          heard.push(text);
          return { error: result.isError === true, text };
        }),
        Effect.catch((e) =>
          Effect.sync(() => {
            const text = String(e.cause instanceof Error ? e.cause.message : e.cause);
            heard.push(text);
            return { error: true, text };
          }),
        ),
      );
    const tools = Effect.promise(() => client.listTools()).pipe(
      Effect.tap((t) => Effect.sync(() => heard.push(JSON.stringify(t)))),
    );
    /**
     * The job tool's answer once `ok` holds of it: the job runs on its own time, and while no host
     * answers the bridge says the host is restarting, so the call is made again.
     */
    const jobWhen = (n: number, ok: (data: Record<string, unknown>) => boolean) =>
      Effect.gen(function* () {
        for (let i = 0; i < 400; i += 1) {
          const answer = yield* call("job", { n });

          if (!answer.error) {
            const data = JSON.parse(answer.text) as Record<string, unknown>;

            if (ok(data)) {
              return data;
            }
          }

          yield* Effect.sleep("25 millis");
        }

        return yield* Effect.die(`job ${n} never came to what was waited for`);
      });
    return { call, tools, jobWhen, heard };
  });

const tagOf = (data: Record<string, unknown>) => Reflect.get(Object(data.state), "_tag");

const freshHome = Effect.gen(function* () {
  return yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "ar-" });
});

/** The host's `restarted`, as the top bar has it; `undefined` while it says none. */
const restartedOf = (now: ToPage | undefined): unknown => {
  if (now?.type !== "host") {
    return undefined;
  }

  const restarted: unknown = Reflect.get(now.now, "restarted");
  return restarted === null ? undefined : restarted;
};

describe("the restart tool", () => {
  it("is listed on the open door with the spec's four hints, and takes only a why", async () => {
    const tool = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        yield* hostOn(home, [], OLD);
        const agent = yield* agentOn(home, "claude");
        return (yield* agent.tools).tools.find((t) => t.name === "restart");
      }),
    );
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: { why: { type: "string", minLength: 1, maxLength: 500 } },
    });
    expect([...(tool?.inputSchema.required ?? [])]).toEqual(["why"]);
  });

  it("answers first, then the host ends of itself; its jobs wait detached, and the next host says who restarted it and why (d22)", async () => {
    const before: string[] = [];
    const after: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const note = yield* noteIn(home);
        const old = yield* hostOn(home, before, OLD);
        const app = yield* appOn(old.paths.sock);
        const agent = yield* agentOn(home, "claude");
        app.type("seq --to 3\r");
        yield* agent.jobWhen(1, (d) => tagOf(d) === "ended");
        app.type("counter\r");
        yield* agent.jobWhen(2, (d) => tagOf(d) === "running");

        const answer = yield* agent.call("restart", { why: WHY });

        if (answer.error) {
          return yield* Effect.die(`the restart was refused: ${answer.text}`);
        }

        const exit = yield* old.ended;
        const sock = yield* reach(old.paths.sock);
        const lost = yield* app.ended.pipe(Effect.timeout("5 seconds"));
        // What the old host left, read before the next host starts and takes it.
        const left = yield* fs.readFileString(note);

        // The app attached starts a host of its own build on the same home.
        const next = yield* hostOn(home, after, NEW);
        const again = yield* appOn(next.paths.sock);
        const job = yield* agent.jobWhen(2, (d) => tagOf(d) === "detached");
        const restarted = yield* until("the host's restart, for the top bar", () => restartedOf(again.hostNow()));
        const line = yield* until("t1's jobs from an earlier tsh", () =>
          again.rows().find((row) => row.includes("from an earlier tsh")),
        );
        const kept = yield* fs.exists(note);
        return { answer, exit, sock, lost, left, job, restarted, line, kept };
      }),
    );
    // The answer went out before the host ended: the bridge says no "it ended before it answered".
    expect(seen.answer.error).toBe(false);
    expect(JSON.parse(seen.answer.text)).toEqual({ _tag: "restarting", detached: [2] });
    // The host ended of itself, as SIGTERM ends it, with no signal sent: its socket is gone, and
    // the app attached saw its link end.
    expect(Exit.isSuccess(seen.exit)).toBe(true);
    expect(seen.sock).not.toBe("live");
    expect(seen.lost).toBeTypeOf("string");

    // The old host's log: who, why, what it left detached, what ran in front, and its build.
    const restart = said(before, "host_restart");
    expect(restart).toHaveLength(1);
    expect(restart[0]).toMatchObject({ level: "INFO", by: AGENT, why: WHY, build: OLD });
    expect(restart[0]?.detached).toMatch(/\b2\b/);
    expect(restart[0]?.detached).not.toMatch(/\b1\b/);
    // Only the job in front: %1 ended, so none other runs.
    expect(restart[0]?.foreground).toBe("t1:%2");
    // A key was typed in t1 before the restart: how long the person has been away is said.
    expect(restart[0]?.idle_ms).toMatch(/^\d+$/);
    // Every host's start line says its build; only one after a restart says after=restart.
    expect(said(before, "host_began")).toHaveLength(1);
    expect(said(before, "host_began")[0]).toMatchObject({ build: OLD });
    expect(said(before, "host_began")[0]?.after).not.toBe("restart");

    // The note the old host left, for the next one.
    const left: unknown = JSON.parse(seen.left);
    expect(left).toMatchObject({ by: AGENT, why: WHY, detached: [2] });
    expect(Reflect.get(Object(left), "at")).toBeTypeOf("number");

    // The next host read it, said it in its log and to the top bar, and took it away.
    expect(said(after, "host_began")).toHaveLength(1);
    expect(said(after, "host_began")[0]).toMatchObject({
      after: "restart",
      by: AGENT,
      why: WHY,
      build: NEW,
    });
    expect(seen.restarted).toMatchObject({ by: AGENT, why: WHY });
    expect(seen.kept).toBe(false);
    // The job that ran waits, detached, in the next host's table, and t1 names who restarted.
    expect(seen.job).toMatchObject({ n: 2, tile: "t1", state: { _tag: "detached" } });
    expect(seen.line).toMatch(/%2\b/);
    expect(seen.line).toMatch(/restarted by (agent:)?claude\b/);
  });

  it("is said once: the host after the next one says nothing of the restart", async () => {
    const first: string[] = [];
    const third: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const old = yield* hostOn(home, first, OLD);
        const app = yield* appOn(old.paths.sock);
        const agent = yield* agentOn(home, "claude");
        app.type("counter &\r");
        yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
        const answer = yield* agent.call("restart", { why: WHY });

        if (answer.error) {
          return yield* Effect.die(`the restart was refused: ${answer.text}`);
        }

        yield* old.ended;
        const next = yield* hostOn(home, [], NEW);
        const shown = yield* appOn(next.paths.sock);
        yield* until("the host's restart, for the top bar", () => restartedOf(shown.hostNow()));
        // The next host is stopped as a signal stops it, and one more starts: no restart now.
        yield* shown.leave;
        yield* next.stop;
        const last = yield* hostOn(home, third, NEW);
        const app3 = yield* appOn(last.paths.sock);
        const now = yield* until("the host's own state", () => app3.hostNow());
        const line = yield* until("t1's jobs from an earlier tsh", () =>
          app3.rows().find((row) => row.includes("from an earlier tsh")),
        );
        return { now, line, kept: yield* fs.exists(yield* noteIn(home)) };
      }),
    );
    // The job ran in the background: none ran in front.
    expect(said(first, "host_restart")[0]?.foreground).toBe("");
    // None, as null or left out.
    expect(seen.now.type === "host" ? (Reflect.get(seen.now.now, "restarted") ?? null) : "no host").toBeNull();
    expect(seen.line).toMatch(/%1\b/);
    expect(seen.line).not.toMatch(/restarted/);
    expect(seen.kept).toBe(false);
    expect(said(third, "host_began")).toHaveLength(1);
    expect(said(third, "host_began")[0]?.after).not.toBe("restart");
  });

  it("is refused with no app attached to start a new host, and the host runs on (d23)", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines, OLD);
        const agent = yield* agentOn(home, "claude");
        // No app at all.
        const alone = yield* agent.call("restart", { why: WHY });
        // An app that came, and went: none is attached now.
        const app = yield* appOn(host.paths.sock);
        yield* app.leave;
        yield* Effect.sleep("200 millis");
        const gone = yield* agent.call("restart", { why: WHY });
        // The host still answers its agents, and its app socket.
        const runs = yield* agent.call("runs", {});
        const sock = yield* reach(host.paths.sock);
        return { alone, gone, runs, sock, note: yield* fs.exists(yield* noteIn(home)) };
      }),
    );

    for (const refused of [seen.alone, seen.gone]) {
      expect(refused.error).toBe(true);
      expect(refused.text).toMatch(/\bapp\b/);
    }

    expect(seen.runs.error).toBe(false);
    expect(seen.sock).toBe("live");
    expect(seen.note).toBe(false);
    expect(said(lines, "host_restart")).toEqual([]);
    // A refused call leaves no other trace than its line.
    const called = said(lines, "tool_called").filter((f) => f.tool === "restart");
    expect(called).toHaveLength(2);

    for (const line of called) {
      expect(line.refused).toMatch(/\bapp\b/);
    }
  });

  it("is refused with no why, an empty why, one past 500 characters, or one of two lines, and the host runs on", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines, OLD);
        yield* appOn(host.paths.sock);
        const agent = yield* agentOn(home, "claude");
        const refusals = [
          yield* agent.call("restart", {}),
          yield* agent.call("restart", { why: "" }),
          yield* agent.call("restart", { why: "x".repeat(501) }),
          yield* agent.call("restart", { why: `${WHY}\nlevel=INFO message=host_began` }),
        ];
        const sock = yield* reach(host.paths.sock);
        return { refusals, sock, note: yield* fs.exists(yield* noteIn(home)) };
      }),
    );

    for (const refused of seen.refusals) {
      expect(refused.error).toBe(true);
      expect(refused.text).toMatch(/\bwhy\b/);
    }

    expect(seen.sock).toBe("live");
    expect(seen.note).toBe(false);
    expect(said(lines, "host_restart")).toEqual([]);
  });
});

// Tests owed by the mutation step on PR 382: each one pins a line no test above reached.
describe("the restart tool, at its edges", () => {
  it("is refused while the only app on the socket has not said hello, and the host runs on", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines, OLD);
        // Connected, but it never says hello: on the host's list of apps, and not up.
        const raw = yield* Effect.acquireRelease(
          Effect.sync(() => createConnection(host.paths.sock)),
          (socket) => Effect.sync(() => socket.destroy()),
        );
        yield* Effect.callback<void>((resume) => {
          raw.once("connect", () => resume(Effect.void));
        });
        yield* Effect.sleep("200 millis");
        const agent = yield* agentOn(home, "claude");
        const refused = yield* agent.call("restart", { why: WHY });
        yield* Effect.sleep("400 millis");
        const sock = yield* reach(host.paths.sock);
        const runs = yield* agent.call("runs", {});
        return { refused, sock, runs, note: yield* fs.exists(yield* noteIn(home)) };
      }),
    );
    expect(seen.refused.error).toBe(true);
    expect(seen.refused.text).toMatch(/\bapp\b/);
    expect(seen.sock).toBe("live");
    expect(seen.runs.error).toBe(false);
    expect(seen.note).toBe(false);
    expect(said(lines, "host_restart")).toEqual([]);
  });

  it("refuses a second restart while the first is under way: one note, one line, the first why", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const old = yield* hostOn(home, lines, OLD);
        yield* appOn(old.paths.sock);
        const agent = yield* agentOn(home, "claude");
        const first = yield* agent.call("restart", { why: WHY });
        const second = yield* agent.call("restart", { why: "a second why" });
        yield* old.ended;
        return { first, second, left: yield* fs.readFileString(yield* noteIn(home)) };
      }),
    );
    expect(seen.first.error).toBe(false);
    expect(seen.second.error).toBe(true);
    expect(seen.second.text).toMatch(/restarting already/);
    expect(JSON.parse(seen.left)).toMatchObject({ by: AGENT, why: WHY });
    expect(said(lines, "host_restart")).toHaveLength(1);
    expect(said(lines, "host_restart")[0]).toMatchObject({ why: WHY });
  });

  // Red at 2d1bfa64: `restarting` is set only once the note is written, so both calls get past
  // it. Both write restart.json.new; the second's rename finds it gone, and that agent is told
  // "could not leave its note" instead of "restarting already".
  it("restarts once for two agents that ask at the same moment", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const old = yield* hostOn(home, lines, OLD);
        yield* appOn(old.paths.sock);
        // Two agents: each one's calls go one at a time, but not the two agents' together.
        const claude = yield* agentOn(home, "claude");
        const lead = yield* agentOn(home, "lead");
        const answers = yield* Effect.all(
          [claude.call("restart", { why: "one" }), lead.call("restart", { why: "two" })],
          { concurrency: "unbounded" },
        );
        yield* old.ended;
        return answers;
      }),
    );
    expect(seen.filter((a) => !a.error)).toHaveLength(1);
    const refused = seen.filter((a) => a.error);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.text).toMatch(/restarting already/);
    expect(said(lines, "host_restart")).toHaveLength(1);
  });

  it("is refused when its note cannot be written, and changes nothing", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines, OLD);
        yield* appOn(host.paths.sock);
        // The note is written beside, then moved over: a folder where it is written beside.
        const note = yield* noteIn(home);
        yield* fs.makeDirectory(`${note}.new`);
        const agent = yield* agentOn(home, "claude");
        const refused = yield* agent.call("restart", { why: WHY });
        yield* Effect.sleep("400 millis");
        const sock = yield* reach(host.paths.sock);
        const runs = yield* agent.call("runs", {});
        return { refused, sock, runs, note: yield* fs.exists(note) };
      }),
    );
    expect(seen.refused.error).toBe(true);
    expect(seen.refused.text).toMatch(/could not leave its note/);
    expect(seen.sock).toBe("live");
    expect(seen.runs.error).toBe(false);
    expect(seen.note).toBe(false);
    expect(said(lines, "host_restart")).toEqual([]);
  });

  it("refuses a call that says its own `by`: who restarts is only the agent its handshake named", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines, OLD);
        yield* appOn(host.paths.sock);
        const agent = yield* agentOn(home, "claude");
        const refused = yield* agent.call("restart", { why: WHY, by: "user:owner" });
        yield* Effect.sleep("400 millis");
        const sock = yield* reach(host.paths.sock);
        return { refused, sock, note: yield* fs.exists(yield* noteIn(home)) };
      }),
    );
    // Today the call is refused for the field it should not have, before the host is asked.
    expect(seen.refused.error).toBe(true);
    expect(seen.refused.text).toMatch(/\bby\b/);
    expect(seen.sock).toBe("live");
    expect(seen.note).toBe(false);
    expect(said(lines, "host_restart")).toEqual([]);
    // The person's name the call said reaches no line the host wrote.
    const refusal = said(lines, "tool_called").filter((f) => f.tool === "restart");
    expect(refusal).toHaveLength(1);

    for (const line of lines) {
      expect(line).not.toContain("user:owner");
    }
  });

  it("logs this build's own id at the start of a host given none", async () => {
    const lines: string[] = [];
    await go(
      Effect.gen(function* () {
        const host = yield* hostOn(yield* freshHome, lines);
        yield* until("the start line", () => said(lines, "host_began")[0]);
        yield* host.stop;
      }),
    );
    expect(said(lines, "host_began")).toHaveLength(1);
    expect(said(lines, "host_began")[0]).toMatchObject({ build: BUILD });
  });
});

/**
 * A host process on `home`, as the app starts one (host/main.ts, run as plain Node), with a timer
 * that never ends loaded before it: something left open, which would keep a host that only lets
 * its loop run dry alive. Killed with the scope, if it still runs.
 */
const hostProcess = (home: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const main = yield* path.fromFileUrl(new URL("./main.ts", import.meta.url));
    const open = "data:text/javascript,setInterval(() => {}, 1e9)";
    return yield* ChildProcess.make(process.execPath, ["--import", open, main], {
      env: { FABRIKA_HOME: home },
      extendEnv: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      forceKillAfter: "3 seconds",
    });
  });

describe("a real host process, restarted by an agent", () => {
  it("exits with 0 of itself, though something is left open, and its pid file goes", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        // A host starts only on a project's home (host/main.ts): a working tree and its record.
        const { home, paths, project } = yield* projectHome(yield* freshHome, "work");
        // This test's own child: the only process it ever stops, by its scope.
        const host = yield* hostProcess(home);
        yield* reach(paths.mcp).pipe(
          Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("20 millis") }),
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () => Effect.die("the host process did not listen"),
          }),
        );
        const app = yield* appWire(yield* NodeSocket.makeNet({ path: paths.sock }), () => {}, undefined, project.key);
        yield* app.up;
        const agent = yield* agentOn(home, "claude");
        const answer = yield* agent.call("restart", { why: WHY });

        if (answer.error) {
          return yield* Effect.die(`the restart was refused: ${answer.text}`);
        }

        const code = yield* host.exitCode.pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () => Effect.succeed("still running"),
          }),
        );
        const pid = yield* fs.readFileString(paths.pid).pipe(Effect.orElseSucceed(() => ""));
        return { code, pid: pid.trim() };
      }),
    );
    expect(seen.code).toBe(0);
    expect(seen.pid).toBe("");
  });
});

describe("a restart.json that does not read", () => {
  it("starts the host all the same, and it says no restart", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const { dir } = yield* pathsOf(home);
        yield* fs.makeDirectory(dir, { recursive: true, mode: 0o700 });
        const answers = [];

        for (const text of [
          "{not json",
          JSON.stringify({ by: 3, why: ["a"] }),
          // Every field the right type, but `by` names no writer.
          JSON.stringify({ by: "nobody", why: null, at: 1 }),
        ]) {
          yield* fs.writeFileString(yield* noteIn(home), text);
          const lines: string[] = [];
          const host = yield* hostOn(home, lines, NEW);
          const app = yield* appOn(host.paths.sock);
          const now = yield* until("the host's own state", () => app.hostNow());
          const kept = yield* fs.exists(yield* noteIn(home));
          answers.push({ now, began: said(lines, "host_began")[0], kept });
          yield* app.leave;
          yield* host.stop;
        }

        return answers;
      }),
    );
    expect(seen).toHaveLength(3);

    for (const { now, began, kept } of seen) {
      // The file is taken all the same, so no later host reads it either.
      expect(kept).toBe(false);
      // None, as null or left out.
      expect(now.type === "host" ? (Reflect.get(now.now, "restarted") ?? null) : "no host").toBeNull();
      // It started as any host starts: its start line says its build, and no restart.
      expect(began).toMatchObject({ build: NEW });
      expect(began?.after).not.toBe("restart");
    }
  });
});

describe("no secret in a restart's answer, its note or a log line (d24)", () => {
  const NAME = "FABRIKA_TEST_SECRET";
  // Secret-shaped, made at run time, so no key-like text is written in this file.
  const secret = ["sk", "ant", "api03", crypto.randomUUID().replaceAll("-", "")].join("-");
  beforeEach(() => {
    process.env[NAME] = secret;
  });
  afterEach(() => {
    delete process.env[NAME];
  });

  it("never says an env value: the tools, the answer, restart.json, either host's log", async () => {
    const before: string[] = [];
    const after: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* freshHome;
        const old = yield* hostOn(home, before, OLD);
        const app = yield* appOn(old.paths.sock);
        const agent = yield* agentOn(home, "claude");
        yield* agent.tools;
        app.type("counter &\r");
        yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
        const answer = yield* agent.call("restart", { why: "the secrets check" });

        if (answer.error) {
          return yield* Effect.die(`the restart was refused: ${answer.text}`);
        }

        yield* old.ended;
        const note = yield* fs.readFileString(yield* noteIn(home));
        const next = yield* hostOn(home, after, NEW);
        yield* appOn(next.paths.sock);
        yield* agent.jobWhen(1, (d) => tagOf(d) === "detached");
        return { heard: agent.heard, note };
      }),
    );
    // What is checked was said: the answer, the note and both new log lines.
    expect(seen.heard.some((t) => t.includes('"restarting"'))).toBe(true);
    expect(seen.note).toContain("the secrets check");
    expect(said(before, "host_restart")).toHaveLength(1);
    expect(said(after, "host_began")).toHaveLength(1);

    for (const text of [...seen.heard, seen.note, ...before, ...after]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(NAME);
    }
  });
});
