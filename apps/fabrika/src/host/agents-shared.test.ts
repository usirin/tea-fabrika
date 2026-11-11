import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { keyFileText, keyLineOf, Ledger } from "@kampus/fabrika-old";
import { startTwin } from "@kampus/ledger-server/twin";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import { Context, Effect, Exit, FileSystem, Layer, Logger, Path, Schedule, Scope } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Down } from "../link.ts";
import { readToPage } from "../messages.ts";
import { appWire } from "../wire.ts";
import { connect, hostLedger } from "./connection.ts";
import { runHost } from "./run.ts";
import { pathsOf, reach } from "./socket.ts";

// The agents' socket on a home connected to a ledger server: the daily home. Each agent is served
// on its own session (host/agent-session.ts, tracker 185): a grant for its name, signed with
// alice's key, so the server's door stamps what it writes as the agent, for alice. So an agent
// gets the write tools here too. Today's version.
//
//   alice connects her home to the twin, her host starts on it
//   agent        tools/list                     runs, job, tracker_file, tracker_query, ...
//   agent        tracker_file {value: {...}}    the ticket lands as agent:claude for:github:7
//   host/log     message=agent_session agent=claude expires=...
//
// When the agent's login fails (here, its key file does not read as a key), that agent is served
// the read-only door instead: every tool readOnlyHint, a write refused before it reaches the
// server, and `runs` says why. Fail closed: no write is ever served on alice's own session.
//
//   host/log     message=agent_refused agent=claude why="the key .../agent_ed25519: ..."
//
// The server is its twin in Miniflare (packages/ledger-server), as shared.test.ts runs it; GitHub
// is a fake that lists alice's key. No call leaves the laptop.

const users = new Map<string, { id: number; keys: string[] }>();

const fakeGitHub = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.host !== "api.github.com") {
    return new Response("not here", { status: 502 });
  }

  const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);

  if (byId !== null) {
    const found = [...users].find(([, u]) => u.id === Number(byId[1]));
    return found === undefined
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json({ id: found[1].id, login: found[0] });
  }

  const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
  const u = m?.[1] === undefined ? undefined : users.get(decodeURIComponent(m[1]));

  if (u === undefined) {
    return Response.json({ message: "Not Found" }, { status: 404 });
  }

  return m?.[2] === undefined
    ? Response.json({ id: u.id, login: m?.[1] })
    : Response.json(u.keys.map((key, i) => ({ id: i + 1, key })));
};

const platform = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

let root = "";
let address = "";
const twinScope = Effect.runSync(Scope.make());

beforeAll(async () => {
  // Short, so the host's socket path stays under its 103 bytes.
  root = mkdtempSync(join(tmpdir(), "as-"));
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  writeFileSync(join(root, "key"), await keyFileText(pair, "alice@laptop"), { mode: 0o600 });
  const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  users.set("alice", { id: 7, keys: [line] });
  const twin = await Effect.runPromise(
    startTwin({
      config: { name: "acme-ledger", founder: "github:7" },
      persist: false,
      github: fakeGitHub,
      cacheMs: 0,
    }).pipe(Scope.provide(twinScope)),
  );
  address = `${twin.url}/acme`;
});

afterAll(async () => {
  await Effect.runPromise(Scope.close(twinScope, Exit.void));
  rmSync(root, { recursive: true, force: true });
});

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

/** Every row on the home's ledger, read through the person's own session on the server. */
const rowsOn = (home: string) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(hostLedger(home));
    return yield* Context.get(services, Ledger).read(0, 1000);
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

const said = (lines: readonly string[], message: string) => lines.map(fieldsOf).filter((f) => f.message === message);

/** The text of a tool call's first answer. */
const textOf = (result: { content?: unknown }) => {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  return String(Reflect.get(Object(first), "text"));
};

/**
 * alice's host on `home`, connected to the twin, its log caught in `lines`, the app attached, and
 * an MCP client on the bridge Claude Code would start: `node cli.ts mcp --as claude`.
 */
const hostAndAgent = (home: string, lines: string[]) =>
  Effect.gen(function* () {
    const paths = yield* pathsOf(home);
    const host = yield* Scope.make();
    const caught = Logger.make((o) => {
      lines.push(Logger.formatSimple.log(o));
    });
    yield* runHost({ home, pid: process.pid }).pipe(
      Effect.scoped,
      Effect.provide(Logger.layer([caught])),
      Effect.forkIn(host),
    );
    yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
    // The host's socket for apps comes up as today: it logged in at the server first.
    yield* reach(paths.sock).pipe(
      Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("10 millis") }),
      Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.die("no host") }),
    );
    const got: Down[] = [];
    const wire = yield* appWire(yield* NodeSocket.makeNet({ path: paths.sock }), (m) => got.push(m));
    yield* wire.up;
    wire.send({ type: "page" });
    yield* reach(paths.mcp).pipe(
      Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("10 millis") }),
      Effect.timeoutOrElse({
        duration: "3 seconds",
        orElse: () => Effect.die("no agents' socket on a connected home"),
      }),
    );
    const mode = (yield* (yield* FileSystem.FileSystem).stat(paths.mcp)).mode & 0o777;

    const path = yield* Path.Path;
    const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
    const client = new Client({ name: "test", version: "0.0.0" });
    yield* Effect.acquireRelease(
      Effect.promise(() =>
        client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [cli, "mcp", "--as", "claude"],
            env: { ...getDefaultEnvironment(), FABRIKA_HOME: home },
            stderr: "pipe",
          }),
        ),
      ),
      () => Effect.promise(() => client.close()).pipe(Effect.ignore),
    );
    /** The top bar's agents and ledger, once it counts claude. */
    const topBar = until("the agent in the top bar", () => {
      const last = got
        .flatMap((m) => {
          if (m.type !== "to" || m.port !== "desk") {
            return [];
          }

          const read = readToPage(m.m);
          return read.kind === "read" && read.msg.type === "host" ? [read.msg.now] : [];
        })
        .at(-1);
      const names = last?.agents?.map((a) => a.name);
      return names?.includes("claude") === true ? { names, ledger: last?.ledger } : undefined;
    });
    return { client, mode, topBar };
  });

/** A fresh home, connected to the twin as alice. Short, so the host's socket path stays under its 103 bytes. */
const aliceHome = (name: string) =>
  Effect.gen(function* () {
    const home = join(root, name);
    mkdirSync(home, { recursive: true });
    yield* connect(home, { address, login: "alice", key: join(root, "key") });
    return home;
  });

describe("an agent on a home connected to a ledger server", () => {
  it("is served the write tools on its own session, and its ticket lands as the agent for alice", async () => {
    const lines: string[] = [];
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const home = yield* aliceHome("h");
        const { client, mode, topBar } = yield* hostAndAgent(home, lines);
        const tools = (yield* Effect.promise(() => client.listTools())).tools;
        const before = yield* rowsOn(home);
        const filed = yield* Effect.promise(() =>
          client.callTool({
            name: "tracker_file",
            arguments: { value: { title: "Filed by claude", body: "" } },
          }),
        );
        // The tool answers once the write is queued: the row comes a moment later.
        let after = before;

        for (let i = 0; i < 200; i += 1) {
          after = yield* rowsOn(home);

          if (after.some((r) => r.data.includes("Filed by claude"))) {
            break;
          }

          yield* Effect.sleep("25 millis");
        }

        const query = yield* Effect.promise(() =>
          client.callTool({ name: "tracker_query", arguments: { value: { status: "open" } } }),
        );
        return { mode, tools, before, after, filed, query, agents: yield* topBar };
      }).pipe(Effect.scoped, Effect.provide(platform)),
    );
    expect(seen.mode).toBe(0o600);
    const names = seen.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["runs", "job", "tracker_query", "tracker_file", "tracker_comment"]));
    // The agent's own session is made, so its tile can run lines on it (tracker 185b, PR 3).
    expect(names).toContain("line");
    // The tracker's person-only input is still no tool: no agent answers what was asked of alice.
    expect(names).not.toContain("tracker_answer");
    expect(seen.tools.find((t) => t.name === "tracker_file")?.annotations?.readOnlyHint).not.toBe(true);
    expect(seen.filed.isError).not.toBe(true);
    const written = seen.after.slice(seen.before.length);
    const ticket = written.filter((r) => r.data.includes("Filed by claude"));
    expect(ticket.length).toBeGreaterThan(0);

    // Every row the agent's call wrote is the agent's, for alice: none is alice's own.
    for (const row of ticket) {
      expect(row.writer).toBe("agent:claude for:github:7");
    }

    expect(seen.query.isError).not.toBe(true);
    expect(JSON.stringify(seen.query.content)).toContain("Filed by claude");
    expect(seen.agents.names).toEqual(["claude"]);
    expect(seen.agents.ledger).toMatchObject({ kind: "server", login: "alice" });
    const session = said(lines, "agent_session");
    expect(session.length).toBeGreaterThan(0);
    expect(session[0]).toMatchObject({ level: "INFO", agent: "claude" });
    expect(Number(session[0]?.expires)).toBeGreaterThan(Date.now());
    expect(said(lines, "agent_refused")).toEqual([]);
  });

  it("falls back to the read-only door when the agent's login fails, and runs says why", async () => {
    const lines: string[] = [];
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const home = yield* aliceHome("r");
        // The agent's key file is there, and does not read as a key: its login cannot be made.
        writeFileSync(join(home, "agent_ed25519"), "not a key\n", { mode: 0o600 });
        const { client, topBar } = yield* hostAndAgent(home, lines);
        const tools = (yield* Effect.promise(() => client.listTools())).tools;
        const before = yield* rowsOn(home);
        const filed = yield* Effect.promise(() =>
          client.callTool({
            name: "tracker_file",
            arguments: { value: { title: "Not on this door", body: "" } },
          }),
        );
        const runs = yield* Effect.promise(() => client.callTool({ name: "runs", arguments: {} }));
        const query = yield* Effect.promise(() =>
          client.callTool({ name: "tracker_query", arguments: { value: { status: "open" } } }),
        );
        // d14: no session, so no tile of the agent's, and no line on the person's session.
        const line = yield* Effect.promise(() =>
          client.callTool({
            name: "line",
            arguments: { line: `tracker file='{"title":"Not on this door","body":""}' &` },
          }),
        );
        const after = yield* rowsOn(home);
        return { tools, before, after, filed, runs, query, line, agents: yield* topBar };
      }).pipe(Effect.scoped, Effect.provide(platform)),
    );
    const names = seen.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["runs", "job", "tracker_query"]));
    expect(names).not.toContain("tracker_file");
    expect(names).not.toContain("line");
    expect(seen.line.isError).toBe(true);
    expect(JSON.stringify(seen.line.content)).toMatch(/line/);

    for (const tool of seen.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    expect(seen.filed.isError).toBe(true);
    expect(JSON.stringify(seen.filed.content)).toMatch(/tracker_file/);
    expect(seen.after).toEqual(seen.before);
    // `runs` says why this agent is read-only: its key file, in words.
    expect(seen.runs.isError).not.toBe(true);
    expect(textOf(seen.runs)).toContain("agent_ed25519");
    expect(seen.query.isError).not.toBe(true);
    expect(seen.agents.names).toEqual(["claude"]);
    const refused = said(lines, "agent_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.agent).toBe("claude");
    expect(refused[0]?.why).toContain("agent_ed25519");
    expect(said(lines, "agent_session")).toEqual([]);
  });
});
