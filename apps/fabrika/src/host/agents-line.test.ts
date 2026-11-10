import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import { Effect, Exit, FileSystem, Layer, Logger, Path, Schedule, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Open } from "../desk/desk.ts";
import { tilesOf } from "../desk/desk.ts";
import { isContainerNode, type LayoutNode } from "../desk/layout/index.ts";
import { gridOf } from "../editor/grid.ts";
import type { Down } from "../link.ts";
import { type HostNow, readToPage, type ToPage } from "../messages.ts";
import { appWire } from "../wire.ts";
import { runHost } from "./run.ts";
import { pathsOf, reach } from "./socket.ts";

// An agent runs a line in its own tile with the host's `line` tool (tracker 185b, PR 3). Today's
// version, on a home of the test's own, its host in this process, the app attached with its page
// loaded, and an MCP client on the bridge Claude Code would start (`cli.ts mcp --as claude`).
//
//   t1 focused, the person's. claude attached.
//   line {line: "counter"}
//       desk launch {agent: "claude"}: t2 beside t1, folded; agents {claude: "t2"}; focus stays on t1
//       t2's screen: "$ counter"; job %1 by=agent:claude for:owner
//       -> {_tag: "job", job: {n: 1, text: "counter", tile: "t2", state: {_tag: "running"}, lines: []}}
//       host/log: agent_tile agent=claude tile=t2; job_began n=1 tile=t2 by=agent:claude for:owner
//   line {line: "tally"}         refused: claude's tile runs %1 in the foreground: stop it, or end the line with &
//   line {line: "tally &"}       {_tag: "job", job: {n: 2, ...}}: a job of the background answers at once
//   line {line: "jobs"}          {_tag: "said", lines: [...], status: 0}
//   the person clicks t2:        host/log agent_tile_opened agent=claude tile=t2 after_ms=...
//   the person types "ls" Enter  "lines here run as claude: split for your own tile (C-b |)";
//                                host/log agent_tile_typed agent=claude tile=t2, without the line
//   the host starts again        t2 is claude's again (call D); %1 detached until claude's `attach %1 &`
//
// Every log line the host writes is caught here through Effect's own `Logger`, in the format the
// host's file uses (host/main.ts). The made-up names this file pins are listed in the PR body.

const platform = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
  Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** On a home of its own file the person is the owner, and claude works for them. */
const AGENT = "agent:claude for:owner";
const FOREGROUND = "claude's tile runs %1 in the foreground: stop it, or end the line with &";
const NOTE = "lines here run as claude: split for your own tile (C-b |)";

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

/** A host on `home`, its log caught in `lines`, and the app attached with its page loaded. */
const hostOn = (home: string, lines: string[]) =>
  Effect.gen(function* () {
    const paths = yield* pathsOf(home);
    // Scopes of the test's own: closed when it ends, or earlier by `stop`.
    const host = yield* Scope.fork(yield* Scope.Scope);
    const caught = Logger.make((o) => {
      lines.push(Logger.formatSimple.log(o));
    });
    yield* runHost({ home, pid: process.pid }).pipe(
      Effect.scoped,
      Effect.provide(Logger.layer([caught])),
      Effect.forkIn(host),
    );
    yield* reach(paths.mcp).pipe(
      Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("5 millis") }),
      Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die("no agents' socket") }),
    );
    const got: Down[] = [];
    const app = yield* Scope.fork(yield* Scope.Scope);
    const wire = yield* appWire(yield* NodeSocket.makeNet({ path: paths.sock }), (m) => got.push(m)).pipe(
      Scope.provide(app),
    );
    yield* wire.up;
    wire.send({ type: "page" });
    yield* until("tile t1", () => got.find((m) => m.type === "port" && m.port === "tile:t1"));
    /** What the page was sent on the desk's port, read. */
    const page = (): ToPage[] =>
      got.flatMap((m) => {
        if (m.type !== "to" || m.port !== "desk") {
          return [];
        }

        const read = readToPage(m.m);
        return read.kind === "read" ? [read.msg] : [];
      });
    /** The desk as the page was last sent it. */
    const desk = (): Open | undefined => {
      const last = page().findLast((m) => m.type === "desk");
      return last?.type === "desk" && last.desk.at === "open" ? last.desk : undefined;
    };
    /** The host as it last said of itself. */
    const now = (): HostNow | undefined => {
      const last = page().findLast((m) => m.type === "host");
      return last?.type === "host" ? last.now : undefined;
    };
    /** Keys typed in a tile's terminal. */
    const type = (tile: string, data: string) =>
      wire.send({ type: "on", port: `tile:${tile}`, m: { type: "keys", data } });
    /** A click on a tile, as the page sends it: it focuses the tile, and opens it if folded. */
    const click = (tile: string) => wire.send({ type: "on", port: "desk", m: { type: "click", tile } });
    /** A folded tile's strip opened, or a container's, as the page sends it. */
    const unfold = (node: string) => wire.send({ type: "on", port: "desk", m: { type: "unfold", node } });
    /** What a tile's terminal shows, as rows, wide enough that no line wraps. */
    const rows = (tile: string) =>
      gridOf(
        got
          .flatMap((m) =>
            m.type === "to" && m.port === `tile:${tile}` && typeof m.m === "object" && m.m !== null
              ? [String(Reflect.get(m.m, "data"))]
              : [],
          )
          .join(""),
        200,
        1000,
      ).rows;
    /** Every port the app was told of, in order. */
    const ports = () => got.flatMap((m) => (m.type === "port" ? [m.port] : []));
    return {
      paths,
      page,
      desk,
      now,
      type,
      click,
      unfold,
      rows,
      ports,
      stop: Scope.close(app, Exit.void).pipe(Effect.andThen(Scope.close(host, Exit.void))),
    };
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
    const scope = yield* Scope.fork(yield* Scope.Scope);
    yield* Effect.acquireRelease(
      Effect.promise(() => client.connect(transport)),
      () => Effect.promise(() => client.close()).pipe(Effect.ignore),
    ).pipe(Scope.provide(scope));
    /** Every text the agent was answered, kept for the secrets check. */
    const heard: string[] = [];
    const call = (name: string, args: Record<string, unknown>) =>
      Effect.promise(() => client.callTool({ name, arguments: args })).pipe(
        Effect.map((result) => {
          const first = Array.isArray(result.content) ? result.content[0] : undefined;
          const text = String(Reflect.get(Object(first), "text"));
          heard.push(text);
          return { error: result.isError === true, text };
        }),
      );
    /** A line, its answer read: the tool's data, or its refusal in words. */
    const line = (text: string) =>
      call("line", { line: text }).pipe(
        Effect.map((a) =>
          a.error ? ({ refused: a.text } as const) : ({ data: JSON.parse(a.text) as Record<string, unknown> } as const),
        ),
      );
    const tools = Effect.promise(() => client.listTools());
    /** The job tool's answer once `ok` holds of it: the job runs on its own time. */
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
    return { call, line, tools, jobWhen, heard, leave: Scope.close(scope, Exit.void) };
  });

const stateOf = (data: unknown) =>
  Reflect.get(Object(Reflect.get(Object(Reflect.get(Object(data), "job")), "state")), "_tag");

const freshHome = Effect.gen(function* () {
  return yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "al-" });
});

/** Each tile of the desk, by id: its workspace, whether it is folded. */
const nodesOf = (desk: Open | undefined) =>
  desk === undefined ? [] : desk.workspaces.flatMap((ws) => tilesOf(ws).map((t) => [t.id, ws.id, t.folded] as const));

describe("the line tool", { timeout: 30_000 }, () => {
  it("is listed on the open door with the spec's four hints, and takes only a line", async () => {
    const tool = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        return (yield* agent.tools).tools.find((t) => t.name === "line");
      }),
    );
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["line"]);
  });

  it("opens the agent's tile folded beside the person's at its first line, and the person keeps their focus and their half-typed line", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines);
        const agent = yield* agentOn(home, "claude");
        host.type("t1", "git log --oneline -3");
        const before = nodesOf(host.desk());
        const answer = yield* agent.line("counter");
        const desk = yield* until("claude's tile on the desk", () =>
          host.desk()?.agents?.claude === "t2" ? host.desk() : undefined,
        );
        const shown = yield* until("the line on t2", () => host.rows("t2").find((r) => r.includes("$ counter")));
        // The person's own line, still there and still theirs.
        host.type("t1", "\r");
        const theirs = yield* until("the person's line ran", () =>
          host.rows("t1").find((r) => r.startsWith("tsh$ git log --oneline -3")),
        );
        return { before, answer, desk, shown, theirs, ports: host.ports() };
      }),
    );
    expect(seen.before).toEqual([["t1", "w1", false]]);
    expect(nodesOf(seen.desk)).toEqual([
      ["t1", "w1", false],
      ["t2", "w1", true],
    ]);
    expect(seen.desk.workspaces[0]?.focused).toBe("t1");
    expect(seen.desk.agents).toEqual({ claude: "t2" });
    expect(seen.ports).toContain("tile:t2");
    expect(seen.shown).toContain("$ counter");
    expect(seen.theirs).toBe("tsh$ git log --oneline -3");
    // The job answer comes as the job begins: a line in the foreground does not wait for its end.
    expect(seen.answer).toMatchObject({
      data: { _tag: "job", job: { n: 1, text: "counter", tile: "t2", state: { _tag: "running" } } },
    });
    expect(said(lines, "job_began")).toEqual([expect.objectContaining({ n: "1", tile: "t2", by: AGENT })]);
    expect(said(lines, "agent_tile")).toEqual([expect.objectContaining({ agent: "claude", tile: "t2" })]);
  });

  it("keeps one tile per agent's name: the next line runs in the same tile", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        const first = yield* agent.line("tally &");
        const second = yield* agent.line("seq --to 3 &");
        yield* until("two jobs in t2", () =>
          host.rows("t2").filter((r) => r.startsWith("$ ")).length >= 2 ? true : undefined,
        );
        return { first, second, nodes: nodesOf(host.desk()), agents: host.desk()?.agents };
      }),
    );
    expect(seen.first).toMatchObject({ data: { _tag: "job", job: { n: 1, tile: "t2" } } });
    expect(seen.second).toMatchObject({ data: { _tag: "job", job: { n: 2, tile: "t2" } } });
    expect(seen.nodes.map(([t]) => t)).toEqual(["t1", "t2"]);
    expect(seen.agents).toEqual({ claude: "t2" });
  });

  it("refuses a second line while one runs in the foreground, and answers a line of the background at once (d15)", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        yield* agent.line("counter");
        const second = yield* agent.line("tally");
        const behind = yield* agent.line("tally &");
        return { second, behind };
      }),
    );
    expect(seen.second).toEqual({ refused: FOREGROUND });
    expect(seen.behind).toMatchObject({
      data: { _tag: "job", job: { n: 2, text: "tally &", state: { _tag: "running" } } },
    });
  });

  it("answers a built-in with what it said and its status", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        yield* agent.line("tally &");
        yield* agent.line("tell %1 add 2");
        // `jobs` shows the copy row only once the copy is live; tally's total says it is.
        yield* agent.jobWhen(1, (d) => Array.isArray(d.lines) && d.lines.includes("[1] total 2"));
        const jobs = yield* agent.line("jobs");
        const wrong = yield* agent.line("attach %99");
        return { jobs, wrong };
      }),
    );
    expect(seen.jobs).toEqual({
      data: { _tag: "said", lines: ["[1] running   tally", "      total 2"], status: 0 },
    });
    expect(seen.wrong).toMatchObject({ data: { _tag: "said" } });
    expect(Reflect.get(Object(seen.wrong.data), "status")).not.toBe(0);
  });

  it("reaches no input only a person tells: tracker's answer, tell %n answer, a pipe into answer, and no desk word (d16)", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        const typed = yield* agent.line("tracker answer=1");
        yield* agent.line("tracker &");
        const told = yield* agent.line("tell %1 answer 1");
        // A pipe into a named input is `<name`, as shell/agent.test.ts writes it.
        const piped = yield* agent.line("seq --to 1 | tracker <answer &");
        const zoom = yield* agent.line("zoom");
        return { typed, told, piped, zoom, desk: host.desk() };
      }),
    );

    for (const answer of [seen.typed, seen.told, seen.piped]) {
      expect(answer).toMatchObject({ data: { _tag: "said" } });
      expect(Reflect.get(Object(answer.data), "status")).not.toBe(0);
      expect(JSON.stringify(answer.data)).toContain("tracker has no input named answer");
    }

    // `zoom` is a desk word: the desk is the person's, so it is no word here.
    expect(Reflect.get(Object(seen.zoom.data), "status")).not.toBe(0);
    expect(seen.desk?.workspaces[0]?.layout.zoomed ?? null).toBeNull();
  });

  it("refuses a line the person types in the agent's tile, logs that it came without the line, and the person's Ctrl-C there stops the job (d17)", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines);
        const agent = yield* agentOn(home, "claude");
        yield* agent.line("counter");
        yield* until("claude's tile", () => (host.desk()?.agents?.claude === "t2" ? true : undefined));
        host.click("t2");
        const opened = yield* until("the tile opened in the log", () => said(lines, "agent_tile_opened").at(0));
        host.type("t2", "seq --to 3\r");
        const note = yield* until("the note on t2", () => host.rows("t2").find((r) => r.includes("lines here run as")));
        const typed = yield* until("the refusal in the log", () => said(lines, "agent_tile_typed").at(0));
        host.type("t2", "\x03");
        const stopped = yield* agent.jobWhen(1, (d) => stateOf({ job: d }) === "ended");
        // Clicked again: it was opened once.
        host.click("t1");
        host.click("t2");
        yield* Effect.sleep("100 millis");
        return { opened, note, typed, stopped, all: said(lines, "agent_tile_opened"), lines };
      }),
    );
    expect(seen.opened).toMatchObject({ agent: "claude", tile: "t2" });
    expect(Number(seen.opened.after_ms)).toBeGreaterThanOrEqual(0);
    expect(seen.all).toHaveLength(1);
    expect(seen.note).toBe(NOTE);
    expect(seen.typed).toMatchObject({ agent: "claude", tile: "t2" });
    // The person's line is theirs: the log says one came, never what it said.
    expect(seen.lines.filter((l) => l.includes("agent_tile_typed")).join("\n")).not.toContain("seq --to 3");
    expect(seen.stopped).toMatchObject({ n: 1 });
  });

  it("names the agent's tile on the host's agents, as the C-b A lines show it", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        const before = yield* until("claude in the top bar", () =>
          host.now()?.agents?.some((a) => a.name === "claude") === true ? host.now() : undefined,
        );
        yield* agent.line("tally &");
        const after = yield* until("claude's tile in the top bar", () =>
          host.now()?.agents?.find((a) => a.name === "claude" && a.tile === "t2"),
        );
        // A desk change that leaves the agents' tiles as they were says nothing new of the host.
        const said = host.page().filter((m) => m.type === "host").length;
        host.click("t2");
        yield* until("t2 focused", () => (host.desk()?.workspaces[0]?.focused === "t2" ? true : undefined));
        const saidAfter = host.page().filter((m) => m.type === "host").length;
        return { before: before.agents, after, said, saidAfter };
      }),
    );
    // made up: AgentOn's `tile`, `null` until the agent's first line opens one.
    expect(seen.before).toEqual([expect.objectContaining({ name: "claude", tile: null })]);
    expect(seen.after).toMatchObject({ name: "claude", tile: "t2" });
    expect(seen.saidAfter).toBe(seen.said);
  });

  it("opens a fresh tile at the next line once the agent's tile has gone (d12)", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, []);
        const agent = yield* agentOn(home, "claude");
        yield* agent.line("tally &");
        yield* until("claude's tile", () => (host.desk()?.agents?.claude === "t2" ? true : undefined));
        // The agent ends its own tsh: the tile goes, and its name with it.
        yield* agent.line("exit");
        yield* until("t2 gone", () =>
          host.desk() !== undefined && host.desk()?.agents?.claude === undefined ? true : undefined,
        );
        const next = yield* agent.line("tally &");
        const desk = yield* until("claude's next tile", () =>
          host.desk()?.agents?.claude === undefined ? undefined : host.desk(),
        );
        return { next, desk };
      }),
    );
    expect(seen.desk.agents.claude).not.toBe("t2");
    expect(seen.next).toMatchObject({ data: { _tag: "job", job: { tile: seen.desk.agents.claude } } });
  });

  it("keeps the agent's tile across a host start: its tsh starts as the agent, and its job waits detached until the agent attaches it (call D)", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const first = yield* hostOn(home, []);
        const was = yield* agentOn(home, "claude");
        yield* was.line("counter");
        yield* until("claude's tile", () => (first.desk()?.agents?.claude === "t2" ? true : undefined));
        yield* was.leave;
        yield* first.stop;
        const host = yield* hostOn(home, lines);
        const agent = yield* agentOn(home, "claude");
        const desk = yield* until("the kept desk", () =>
          host.desk()?.agents?.claude === "t2" ? host.desk() : undefined,
        );
        const waiting = yield* agent.call("job", { n: 1 });
        const attached = yield* agent.line("attach %1 &");
        const running = yield* agent.jobWhen(1, (d) => stateOf({ job: d }) === "running");
        return { desk, waiting, attached, running };
      }),
    );
    expect(seen.desk.agents).toEqual({ claude: "t2" });
    expect(stateOf({ job: JSON.parse(seen.waiting.text) })).toBe("detached");
    expect(seen.attached).toMatchObject({ data: { _tag: "said", status: 0 } });
    expect(seen.running).toMatchObject({ n: 1, tile: "t2" });
    // It goes on as the agent: the job keeps the writer that began it.
    expect(said(lines, "job_began").filter((f) => f.by !== AGENT)).toEqual([]);
  });
});

// Owed by PR 3's mutation step (tracker 185b). Today's version: how long the person took to open
// the agent's tile, logged once, and the agents in the top bar in the order they came.
//
//   line {line: "tally &"}        t2 folded: no agent_tile_opened yet, whatever else changes
//   the person opens t2's strip   host/log agent_tile_opened agent=claude tile=t2 after_ms=<since the launch>
//   the person clicks t2, t1      nothing more is logged

/** The container `tile` sits in, in the first workspace: unfolding it opens its tiles and focuses the first. */
const parentOf = (desk: Open | undefined, tile: string): string | undefined => {
  const walk = (node: LayoutNode): string | undefined => {
    if (!isContainerNode(node)) {
      return undefined;
    }

    if (node.children.some((child) => child.id === tile)) {
      return node.id;
    }

    return node.children.map(walk).find((id) => id !== undefined);
  };
  const root = desk?.workspaces[0]?.layout.root;
  return root === undefined ? undefined : walk(root);
};

describe("the line tool: what the mutation step found untested", { timeout: 30_000 }, () => {
  it("logs agent_tile_opened once, when the person opens the folded tile, even with focus elsewhere, with the time since it opened", async () => {
    const lines: string[] = [];
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines);
        const agent = yield* agentOn(home, "claude");
        const from = Date.now();
        yield* agent.line("tally &");
        yield* until("claude's tile", () => (host.desk()?.agents?.claude === "t2" ? true : undefined));
        // A change to the desk while t2 is folded: the person's own tile, clicked.
        host.click("t1");
        yield* Effect.sleep("200 millis");
        const folded = said(lines, "agent_tile_opened").length;
        // The column holding t2 opened: t2 is open, and focus goes to its first tile, t1.
        const column = parentOf(host.desk(), "t2");

        if (column === undefined) {
          return yield* Effect.die("no container holds t2");
        }

        host.unfold(column);
        const opened = yield* until("the tile opened in the log", () => said(lines, "agent_tile_opened").at(0));
        const within = Date.now() - from;
        const focused = host.desk()?.workspaces[0]?.focused;
        host.click("t2");
        host.click("t1");
        yield* Effect.sleep("200 millis");
        return { folded, opened, within, focused, all: said(lines, "agent_tile_opened").length };
      }),
    );
    expect(seen.folded).toBe(0);
    expect(seen.focused).toBe("t1");
    expect(seen.opened).toMatchObject({ agent: "claude", tile: "t2" });
    expect(Number(seen.opened.after_ms)).toBeGreaterThanOrEqual(200);
    expect(Number(seen.opened.after_ms)).toBeLessThanOrEqual(seen.within);
    expect(seen.all).toBe(1);
  });

  it("lists the agents attached in the order they came, each with its own tile", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, []);
        const claude = yield* agentOn(home, "claude");
        yield* until("claude in the top bar", () => (host.now()?.agents?.length === 1 ? true : undefined));
        const lead = yield* agentOn(home, "lead");
        yield* lead.line("tally &");
        yield* claude.line("tally &");
        return yield* until("both tiles in the top bar", () => {
          const agents = host.now()?.agents ?? [];
          return agents.every((a) => a.tile !== null) && agents.length === 2 ? agents : undefined;
        });
      }),
    );
    expect(seen.map((a) => [a.name, a.tile])).toEqual([
      ["claude", "t3"],
      ["lead", "t2"],
    ]);
    expect(seen[0]?.since ?? 0).toBeLessThanOrEqual(seen[1]?.since ?? 0);
  });
});

describe("no secret in a line's answer or a log line (d24)", () => {
  const NAME = "FABRIKA_TEST_SECRET";
  // Secret-shaped, made at run time, so no key-like text is written in this file.
  const secret = ["sk", "ant", "api03", crypto.randomUUID().replaceAll("-", "")].join("-");
  beforeEach(() => {
    process.env[NAME] = secret;
  });
  afterEach(() => {
    delete process.env[NAME];
  });

  it("never says an env value: a job, a built-in, a refusal, the agent's tile, the log", async () => {
    const lines: string[] = [];
    const heard = await go(
      Effect.gen(function* () {
        const home = yield* freshHome;
        const host = yield* hostOn(home, lines);
        const agent = yield* agentOn(home, "claude");
        yield* agent.line("counter");
        yield* agent.line("tally");
        yield* agent.line("jobs");
        yield* agent.line(`tracker answer=${NAME}`);
        host.type("t2", "seq --to 3\r");
        yield* until("the refusal in the log", () => said(lines, "agent_tile_typed").at(0));
        return { heard: agent.heard, screen: host.rows("t2") };
      }),
    );
    expect(said(lines, "agent_tile").length).toBeGreaterThan(0);
    expect(said(lines, "tool_called").length).toBeGreaterThan(0);

    for (const text of [...heard.heard, ...heard.screen, ...lines]) {
      expect(text).not.toContain(secret);
    }
  });
});
