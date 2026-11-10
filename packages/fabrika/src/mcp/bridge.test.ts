import { createServer, type Socket as NetSocket } from "node:net";
import type { DurationRetryPolicy } from "@demlik/tea/retry-backoff";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import { Client } from "@modelcontextprotocol/client";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Logger,
  Queue,
  Random,
  Scope,
  Sink,
  Stdio,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { programList } from "../shell/programs.ts";
import { SMALL } from "../shell/small.ts";
import { bridge } from "./bridge.ts";
import { AGENTS_PROTOCOL, MAX_LINE } from "./handshake.ts";
import { serveAgent } from "./serve.ts";

// The bridge outlives the host (tracker 185b, PR 4). Today's version. The window's restart and
// `fabrika connect` end the host; the bridge Claude Code started must not end with it. It sees
// the socket end, dials again on the wait it is handed, says its handshake, replays the client's
// `initialize` and `notifications/initialized`, drops the new host's answer to that `initialize`,
// and tells the client `notifications/tools/list_changed`. A call while no host answers gets a
// JSON-RPC error that says why, never silence. No host within the wait: the bridge ends, with why.
//
//   client  initialize (id 0), notifications/initialized, tools/call (id 1)     host 1 answers
//   host 1 ends
//   client  tools/call (id 2)        -> {"jsonrpc":"2.0","id":2,"error":{"code":...,"message":"the host is restarting..."}}
//   host 2 listens on the same path
//   bridge  handshake, then initialize (id 0) and notifications/initialized, as the client said them
//   client  <- notifications/tools/list_changed, and no second answer to id 0
//
// Why an error, and why the notice, by the spec the installed SDK speaks (@modelcontextprotocol
// 2.4.0, LATEST_PROTOCOL_VERSION 2025-11-25, the era of an `initialize` first, as Claude Code
// sends): "Tools", Error Handling, puts "server errors" under protocol errors, a standard
// JSON-RPC error; "Lifecycle", Timeouts, has a sender that hears nothing wait until its timeout
// (the SDK's DEFAULT_REQUEST_TIMEOUT_MSEC, 60 s); and "Tools", List Changed Notification, says a
// server that declared `listChanged` SHOULD send `notifications/tools/list_changed`.
//
// Each host is a real unix socket on a temp folder of the test's own, stopped and listened on
// again at the same path. The wait is short here and handed in, as the app hands its own
// (reconnect.ts POLICY) in cli.ts. No jitter, so a run is the same each time.

/** The wait the bridge is handed: 10 ms, doubling, at most 40 ms apart, for 600 ms in all. */
const WAIT: DurationRetryPolicy = {
  baseMs: 10,
  factor: 2,
  capMs: 40,
  maxElapsedMs: 600,
  jitter: "none",
};

/** A test's own limit: past `until`'s five seconds, so a wait that fails says what it waited for. */
const LONG = 15_000;

/** Wait for `check` to answer something, five seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1000; i += 1) {
      const got = check();

      if (got !== undefined) {
        return got;
      }

      yield* Effect.sleep("5 millis");
    }

    return yield* Effect.die(`waited for ${what}`);
  });

const field = (m: unknown, key: string): unknown => Reflect.get(Object(m), key);

/**
 * The client's end of the bridge: its stdin and stdout, as Claude Code holds them. `say` writes
 * one line to the bridge's stdin; `heard` is every line the bridge wrote to its stdout; `end`
 * ends its stdin, as a client that quits does.
 */
const clientEnd = Effect.gen(function* () {
  const stdin = yield* Queue.make<Uint8Array, Cause.Done>();
  const heard: unknown[] = [];
  let rest = "";
  /** One chunk the bridge wrote: each whole line in it, read. */
  const wrote = (chunk: string | Uint8Array) =>
    Effect.sync(() => {
      rest += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";

      for (const part of parts) {
        if (part.trim() !== "") {
          heard.push(JSON.parse(part));
        }
      }
    });
  const stdio = Stdio.make({
    args: Effect.succeed([]),
    stdin: Stream.fromQueue(stdin),
    stdout: () => Sink.forEach(wrote),
    stderr: () => Sink.drain,
  });
  const say = (message: unknown) => Queue.offerUnsafe(stdin, new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const end = () => Queue.endUnsafe(stdin);
  return { stdio, say, heard, end };
});

/** The bridge on `path`, as agent claude, with the short wait: a fiber the test may await. */
const bridgeOn = (path: string, stdio: Stdio.Stdio, wait: DurationRetryPolicy = WAIT) =>
  bridge(NodeSocket.makeNet({ path }), "claude", wait).pipe(
    Effect.provideService(Stdio.Stdio, stdio),
    Effect.forkScoped,
  );

/** How a recording host differs from one that answers everything at once. */
interface HostOptions {
  /** What it says back to the bridge's handshake: the agents' own by default; `null` closes the socket. */
  readonly shake?: unknown;
  /** A line it hears and does not answer: the test answers for it later, with `says`. */
  readonly holds?: (m: unknown) => boolean;
}

/**
 * A host that keeps every line it hears, on its own unix socket at `path`: it says the agents'
 * handshake back, answers `initialize`, and answers each `tools/call` with its own name, so an
 * answer says which host gave it. `conns` holds each connection's lines, in order; `says` writes a
 * line of the test's own on that connection; `closed` says whether that connection's socket closed.
 */
const recordingHost = (path: string, name: string, options: HostOptions = {}) =>
  Effect.gen(function* () {
    const { shake = { type: "handshake", version: AGENTS_PROTOCOL }, holds = () => false } = options;
    const conns: unknown[][] = [];
    const says: ((m: unknown) => void)[] = [];
    const closed: boolean[] = [];
    const open = new Set<NetSocket>();
    const server = createServer((socket) => {
      open.add(socket);
      const lines: unknown[] = [];
      const at = conns.length;
      conns.push(lines);
      closed.push(false);
      const say = (m: unknown) => socket.write(`${JSON.stringify(m)}\n`);
      says.push(say);
      let rest = "";
      socket.on("error", () => {});
      socket.on("close", () => {
        open.delete(socket);
        closed[at] = true;
      });
      socket.on("data", (chunk) => {
        rest += chunk.toString("utf8");
        const parts = rest.split("\n");
        rest = parts.pop() ?? "";

        for (const part of parts) {
          if (part.trim() === "") {
            continue;
          }

          const m: unknown = JSON.parse(part);
          lines.push(m);

          if (holds(m)) {
            continue;
          }

          if (field(m, "type") === "handshake") {
            if (shake === null) {
              socket.end();
            } else {
              say(shake);
            }
          } else if (field(m, "method") === "initialize") {
            say({
              jsonrpc: "2.0",
              id: field(m, "id"),
              result: {
                protocolVersion: field(field(m, "params"), "protocolVersion"),
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name, version: "0.0.0" },
              },
            });
          } else if (field(m, "method") === "tools/call") {
            say({
              jsonrpc: "2.0",
              id: field(m, "id"),
              result: { content: [{ type: "text", text: name }] },
            });
          }
        }
      });
    });
    const stop = Effect.callback<void>((resume) => {
      for (const socket of open) {
        socket.destroy();
      }

      server.close(() => resume(Effect.void));
    });
    yield* Effect.callback<void>((resume) => {
      server.listen(path, () => resume(Effect.void));
    });
    yield* Effect.addFinalizer(() => (server.listening ? stop : Effect.void));
    return { conns, says, closed, stop };
  });

/** The client's own first two messages, as the SDK's `Client.connect` sends them (era 2025). */
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "claude-code", version: "2.1.0" },
  },
};

const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };

const call = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "runs", arguments: {} },
});

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
  Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)));

const socketPath = Effect.gen(function* () {
  const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "br-" });
  return `${dir}/mcp.sock`;
});

/** A notification the client sends, which waits for no answer. */
const ROOTS_CHANGED = { jsonrpc: "2.0", method: "notifications/roots/list_changed" };

const isNotice = (m: unknown) => field(m, "method") === "notifications/tools/list_changed";
const isError = (m: unknown) => field(m, "error") !== undefined;

/** The client's opening, as the SDK says it: initialize, then, once answered, initialized. */
const opened = (client: Effect.Success<typeof clientEnd>) =>
  Effect.gen(function* () {
    client.say(INITIALIZE);
    yield* until("the answer to initialize", () => client.heard.find((m) => field(m, "id") === 0));
    client.say(INITIALIZED);
  });

/** How the bridge ended, five seconds at most. */
const endOf = <A, E>(running: Fiber.Fiber<A, E>) =>
  Fiber.await(running).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.die("the bridge did not end"),
    }),
  );

/** The why a bridge that stopped gave, or `undefined` for one that did not fail. */
const whyOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? field(Cause.squash(exit.cause), "why") : undefined;

describe("the bridge, when the host ends and another listens (d20)", () => {
  it(
    "says one handshake to the new host, replays initialize and initialized, drops the second answer, and says the tools changed",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio);
          client.say(INITIALIZE);
          yield* until("the answer to initialize", () => client.heard.find((m) => field(m, "id") === 0));
          client.say(INITIALIZED);
          client.say(call(1));
          yield* until("host 1's answer to 1", () => client.heard.find((m) => field(m, "id") === 1));

          yield* first.stop;
          const second = yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () =>
            client.heard.find((m) => field(m, "method") === "notifications/tools/list_changed"),
          );
          client.say(call(3));
          const answer = yield* until("the answer to 3", () => client.heard.find((m) => field(m, "id") === 3));
          // A moment more, so a second answer to initialize said late is caught too.
          yield* Effect.sleep("100 millis");
          const ended = running.pollUnsafe() !== undefined;
          return {
            first: first.conns,
            second: second.conns,
            heard: [...client.heard],
            answer,
            ended,
          };
        }),
      );
      // One connection to each host, each opened by one handshake that names the agent.
      expect(seen.first).toHaveLength(1);
      expect(seen.second).toHaveLength(1);
      const [again = []] = seen.second;
      expect(again.filter((m) => field(m, "type") === "handshake")).toEqual([
        { type: "handshake", version: AGENTS_PROTOCOL, agent: "claude" },
      ]);
      // Then the client's initialize, as it said it, and its initialized, before anything else.
      expect(again[0]).toMatchObject({ type: "handshake" });
      expect(again[1]).toMatchObject({ method: "initialize", params: INITIALIZE.params });
      expect(again[2]).toEqual(INITIALIZED);
      expect(again.filter((m) => field(m, "method") === "initialize")).toHaveLength(1);
      // The client heard one answer to its initialize, host 1's, and no answer to an id it never
      // sent: the new host's answer to the replay was dropped.
      const answers = seen.heard.filter((m) => field(m, "id") !== undefined);
      expect(answers.filter((m) => field(m, "id") === 0)).toHaveLength(1);
      expect(answers.find((m) => field(m, "id") === 0)).toMatchObject({
        result: { serverInfo: { name: "host 1" } },
      });
      expect(answers.map((m) => field(m, "id"))).toEqual([0, 1, 3]);
      // The notice came before the answer to the call made after it, and the new host answered.
      const notice = seen.heard.findIndex((m) => field(m, "method") === "notifications/tools/list_changed");
      expect(notice).toBeLessThan(seen.heard.indexOf(seen.answer));
      expect(seen.answer).toMatchObject({ result: { content: [{ type: "text", text: "host 2" }] } });
      // And the bridge is still running: the client never lost it.
      expect(seen.ended).toBe(false);
    },
    LONG,
  );
});

describe("a call while no host answers (d21)", () => {
  it(
    "is answered at once with a JSON-RPC error that says why, and never reaches the next host",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          client.say(INITIALIZE);
          yield* until("the answer to initialize", () => client.heard.find((m) => field(m, "id") === 0));
          client.say(INITIALIZED);

          yield* first.stop;
          // A moment for the bridge to see the socket end: a local socket's end is heard in well
          // under a millisecond.
          yield* Effect.sleep("50 millis");
          client.say(call(2));
          // No host listens yet: the answer cannot wait for one.
          const answer = yield* until("the answer to 2", () => client.heard.find((m) => field(m, "id") === 2));
          const second = yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () =>
            client.heard.find((m) => field(m, "method") === "notifications/tools/list_changed"),
          );
          client.say(call(3));
          yield* until("the answer to 3", () => client.heard.find((m) => field(m, "id") === 3));
          return { answer, second: second.conns.flat() };
        }),
      );
      expect(seen.answer).toMatchObject({ jsonrpc: "2.0", id: 2 });
      expect(field(seen.answer, "result")).toBeUndefined();
      const error = field(seen.answer, "error");
      // -32000, the first of JSON-RPC 2.0's range for a server's own errors.
      expect(field(error, "code")).toBe(-32000);
      expect(String(field(error, "message"))).toContain("the host is restarting");
      // The call was answered, so it is not sent again later: the next host hears only the one
      // after it.
      const calls = seen.second.filter((m) => field(m, "method") === "tools/call");
      expect(calls.map((m) => field(m, "id"))).toEqual([3]);
    },
    LONG,
  );
});

describe("no host within the wait (d21)", () => {
  it(
    "ends the bridge with why, once the wait is over",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio);
          client.say(INITIALIZE);
          yield* until("the answer to initialize", () => client.heard.find((m) => field(m, "id") === 0));
          client.say(INITIALIZED);
          const stopped = Date.now();
          yield* first.stop;
          const exit = yield* Fiber.await(running).pipe(
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => Effect.die("the bridge waited past its wait"),
            }),
          );
          return { exit, took: Date.now() - stopped };
        }),
      );
      // It tried for about the wait it was handed: a bridge that ends as the socket ends, today's,
      // fails here. Less two of its longest gaps, as a last try may be skipped that would land past it.
      expect(seen.took).toBeGreaterThanOrEqual(WAIT.maxElapsedMs - 2 * WAIT.capMs);
      expect(Exit.isFailure(seen.exit)).toBe(true);
      const error = Exit.isFailure(seen.exit) ? Cause.squash(seen.exit.cause) : null;
      expect(error).toMatchObject({ _tag: "BridgeStopped" });
      // The why is what cli.ts writes to stderr: it says the host did not come back.
      expect(String(field(error, "why"))).toMatch(/host/);
    },
    LONG,
  );
});

describe("a call the host held when it ended (d21)", () => {
  it(
    "is told it may have run, and is never sent to the next host",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1", {
            holds: (m) => field(m, "method") === "tools/call",
          });
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          client.say(call(1));
          yield* until("host 1 to hear 1", () => first.conns[0]?.find((m) => field(m, "id") === 1));
          yield* first.stop;
          const answer = yield* until("the answer to 1", () => client.heard.find((m) => field(m, "id") === 1));
          const second = yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () => client.heard.find(isNotice));
          client.say(call(2));
          yield* until("the answer to 2", () => client.heard.find((m) => field(m, "id") === 2));
          return { answer, second: second.conns.flat() };
        }),
      );
      expect(seen.answer).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "the host is restarting: it ended before it answered, so this call may have run.",
        },
      });
      const calls = seen.second.filter((m) => field(m, "method") === "tools/call");
      expect(calls.map((m) => field(m, "id"))).toEqual([2]);
    },
    LONG,
  );
});

describe("a call before the new host answered the replayed initialize (d20)", () => {
  /** Host 1 answers and ends; host 2 hears the replayed initialize and holds its answer. */
  const replaying = Effect.gen(function* () {
    const path = yield* socketPath;
    const first = yield* recordingHost(path, "host 1");
    const client = yield* clientEnd;
    const running = yield* bridgeOn(path, client.stdio);
    yield* opened(client);
    yield* first.stop;
    const second = yield* recordingHost(path, "host 2", {
      holds: (m) => field(m, "method") === "initialize",
    });
    yield* until("host 2 to hear the replayed initialize", () =>
      second.conns[0]?.find((m) => field(m, "method") === "initialize"),
    );
    return { client, second, running };
  });

  it(
    "waits, and reaches the new host after initialized, in the order the client said it",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const { client, second } = yield* replaying;
          client.say(call(5));
          client.say(ROOTS_CHANGED);
          yield* Effect.sleep("50 millis");
          const early = [...(second.conns[0] ?? [])];
          const answeredEarly = client.heard.some((m) => field(m, "id") === 5);
          second.says[0]?.({ jsonrpc: "2.0", id: 0, result: { capabilities: {} } });
          const answer = yield* until("the answer to 5", () => client.heard.find((m) => field(m, "id") === 5));
          return { early, answeredEarly, answer, lines: second.conns[0] ?? [] };
        }),
      );
      // Before host 2 answered, it heard only the handshake and the replay, and 5 was not answered.
      expect(seen.early).toEqual([{ type: "handshake", version: AGENTS_PROTOCOL, agent: "claude" }, INITIALIZE]);
      expect(seen.answeredEarly).toBe(false);
      // Then initialized, then the client's lines, as it said them.
      expect(seen.lines.slice(2)).toEqual([INITIALIZED, call(5), ROOTS_CHANGED]);
      expect(seen.answer).toMatchObject({ result: { content: [{ type: "text", text: "host 2" }] } });
    },
    LONG,
  );

  it(
    "is told it did not reach the host, if that host ends first, and a notification is not answered",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const { client, second } = yield* replaying;
          client.say(call(5));
          client.say(ROOTS_CHANGED);
          yield* Effect.sleep("50 millis");
          yield* second.stop;
          yield* until("the answer to 5", () => client.heard.find((m) => field(m, "id") === 5));
          // A moment more, so an answer to the notification said late is caught too.
          yield* Effect.sleep("50 millis");
          return client.heard.filter(isError);
        }),
      );
      expect(seen).toEqual([
        {
          jsonrpc: "2.0",
          id: 5,
          error: {
            code: -32000,
            message: "the host is restarting: this call did not reach it. Call again in a moment.",
          },
        },
      ]);
    },
    LONG,
  );

  it(
    "ends the bridge, with the host's message, when the new host refuses the replayed initialize",
    async () => {
      const exit = await go(
        Effect.gen(function* () {
          const { second, running } = yield* replaying;
          second.says[0]?.({
            jsonrpc: "2.0",
            id: 0,
            error: { code: -32602, message: "Unsupported protocol version" },
          });
          return yield* endOf(running);
        }),
      );
      expect(whyOf(exit)).toBe("the new host refused the client's initialize: Unsupported protocol version");
    },
    LONG,
  );
});

describe("a request from the host (d20)", () => {
  it(
    "reaches the client, whose answer goes back to that host; an answer after it ended is dropped",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          first.says[0]?.({ jsonrpc: "2.0", id: "h1", method: "ping" });
          yield* until("host 1's ping", () => client.heard.find((m) => field(m, "id") === "h1"));
          client.say({ jsonrpc: "2.0", id: "h1", result: {} });
          const back = yield* until("host 1 to hear the answer to its ping", () =>
            first.conns[0]?.find((m) => field(m, "id") === "h1"),
          );
          // A second ping, which the client answers only once host 1 is gone.
          first.says[0]?.({ jsonrpc: "2.0", id: "h2", method: "ping" });
          yield* until("host 1's second ping", () => client.heard.find((m) => field(m, "id") === "h2"));
          yield* first.stop;
          const second = yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () => client.heard.find(isNotice));
          client.say({ jsonrpc: "2.0", id: "h2", result: {} });
          client.say(call(3));
          yield* until("the answer to 3", () => client.heard.find((m) => field(m, "id") === 3));
          return { back, second: second.conns.flat() };
        }),
      );
      expect(seen.back).toEqual({ jsonrpc: "2.0", id: "h1", result: {} });
      // Host 2 never asked h2: it hears the replayed initialize and the call, and no answer.
      const ids = seen.second.map((m) => field(m, "id")).filter((id) => id !== undefined);
      expect(ids).toEqual([0, 3]);
    },
    LONG,
  );
});

describe("a client that sent no initialize, across a restart (d20)", () => {
  it(
    "is told the tools changed, and the new host hears the handshake, then only what came after",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          client.say(call(1));
          yield* until("the answer to 1", () => client.heard.find((m) => field(m, "id") === 1));
          yield* first.stop;
          const second = yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () => client.heard.find(isNotice));
          client.say(call(2));
          const answer = yield* until("the answer to 2", () => client.heard.find((m) => field(m, "id") === 2));
          return { answer, lines: second.conns[0] ?? [] };
        }),
      );
      expect(seen.lines).toEqual([{ type: "handshake", version: AGENTS_PROTOCOL, agent: "claude" }, call(2)]);
      expect(seen.answer).toMatchObject({ result: { content: [{ type: "text", text: "host 2" }] } });
    },
    LONG,
  );
});

describe("a notification while no host answers (d21)", () => {
  it(
    "gets no answer: only the call after it is told the host is restarting",
    async () => {
      const errors = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          yield* first.stop;
          yield* Effect.sleep("50 millis");
          client.say(ROOTS_CHANGED);
          client.say(call(2));
          // The bridge answers in the order it heard: an answer to the notice would be first.
          yield* until("the answer to 2", () => client.heard.find((m) => field(m, "id") === 2));
          return client.heard.filter(isError);
        }),
      );
      expect(errors.map((m) => field(m, "id"))).toEqual([2]);
    },
    LONG,
  );
});

describe("a stdin line that is not an object", () => {
  it(
    "passes on as it is, and the bridge stays up",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          client.say(42);
          client.say([]);
          client.say(call(1));
          yield* until("the answer to 1", () => client.heard.find((m) => field(m, "id") === 1));
          return { lines: first.conns[0] ?? [], ended: running.pollUnsafe() !== undefined };
        }),
      );
      expect(seen.lines.slice(3)).toEqual([42, [], call(1)]);
      expect(seen.ended).toBe(false);
    },
    LONG,
  );
});

describe("stdin's end", () => {
  it(
    "ends the bridge with success, and the host sees its socket close",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          client.end();
          const exit = yield* endOf(running);
          const closed = yield* until("host 1 to see the socket close", () =>
            first.closed[0] === true ? true : undefined,
          );
          return { exit, closed };
        }),
      );
      expect(Exit.isSuccess(seen.exit)).toBe(true);
      expect(seen.closed).toBe(true);
    },
    LONG,
  );

  it(
    "while the bridge waits to dial again ends it at once, with no next connection",
    async () => {
      // A wait far past the test's own, so a bridge that waited it out, or dialed again, shows.
      const slow: DurationRetryPolicy = {
        ...WAIT,
        baseMs: 10_000,
        capMs: 10_000,
        maxElapsedMs: 60_000,
      };
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio, slow);
          yield* opened(client);
          yield* first.stop;
          yield* Effect.sleep("50 millis");
          // A host listens again while the bridge waits; the client quits before it dials.
          const second = yield* recordingHost(path, "host 2");
          client.end();
          const exit = yield* endOf(running);
          yield* Effect.sleep("50 millis");
          return { exit, conns: second.conns.length };
        }),
      );
      expect(Exit.isSuccess(seen.exit)).toBe(true);
      expect(seen.conns).toBe(0);
    },
    LONG,
  );

  it(
    "before the first host's handshake ends the bridge, saying the host closed before it",
    async () => {
      const exit = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1", {
            holds: (m) => field(m, "type") === "handshake",
          });
          const client = yield* clientEnd;
          const running = yield* bridgeOn(path, client.stdio);
          yield* until("host 1 to hear the handshake", () => first.conns[0]?.[0]);
          client.end();
          return yield* endOf(running);
        }),
      );
      expect(whyOf(exit)).toBe("the host closed the socket before its handshake");
    },
    LONG,
  );
});

describe("the first host, before or at its handshake", () => {
  /** The bridge on a first host with `options`, until it ends: why it stopped. */
  const stoppedBy = (options: HostOptions, after?: (host: { says: ((m: unknown) => void)[] }) => void) =>
    go(
      Effect.gen(function* () {
        const path = yield* socketPath;
        const first = yield* recordingHost(path, "host 1", options);
        const client = yield* clientEnd;
        const running = yield* bridgeOn(path, client.stdio);

        if (after !== undefined) {
          yield* opened(client);
          after(first);
        }

        return whyOf(yield* endOf(running));
      }),
    );

  it(
    "that closes the socket before its handshake ends the bridge, saying so",
    async () => {
      // Red on bbc185a7 (main's code reads the same way): effect 4.1.1's socket fails a clean
      // close with SocketCloseError 1000, so `run` gives "the socket ended: 1000", never CLOSED.
      expect(await stoppedBy({ shake: null })).toBe("the host closed the socket before its handshake");
    },
    LONG,
  );

  it(
    "that says something else first ends the bridge: no handshake",
    async () => {
      expect(await stoppedBy({ shake: { jsonrpc: "2.0", method: "hello" } })).toBe("the host sent no handshake");
    },
    LONG,
  );

  it(
    "that sends a line past MAX_LINE ends the bridge: a line that does not read",
    async () => {
      const why = await stoppedBy({}, (host) => host.says[0]?.("x".repeat(MAX_LINE)));
      expect(String(why)).toMatch(/^a line that does not read: /);
    },
    LONG,
  );
});

describe("the log, across a restart", () => {
  it(
    "says host_lost with the agent and why, and host_back with the agent, how long and how many tries",
    async () => {
      const lines: string[] = [];
      const caught = Logger.make((o) => {
        lines.push(Logger.formatSimple.log(o));
      });
      await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          yield* opened(client);
          yield* first.stop;
          yield* recordingHost(path, "host 2");
          yield* until("the notice that the tools changed", () => client.heard.find(isNotice));
        }).pipe(Effect.provide(Logger.layer([caught]))),
      );
      const lost = lines.filter((l) => l.includes("message=host_lost"));
      expect(lost).toHaveLength(1);
      expect(lost[0]).toContain("agent=claude");
      expect(lost[0]).toMatch(/why=.*socket/);
      const back = lines.filter((l) => l.includes("message=host_back"));
      expect(back).toHaveLength(1);
      expect(back[0]).toContain("agent=claude");
      expect(back[0]).toMatch(/after_ms=\d+/);
      expect(back[0]).toMatch(/tries=[1-9]/);
    },
    LONG,
  );
});

describe("the wait between dials, on the app's own shape (full jitter)", () => {
  // reconnect.ts POLICY's numbers, written out: this package may not import the app.
  const FULL: DurationRetryPolicy = {
    baseMs: 250,
    factor: 2,
    capMs: 30_000,
    maxElapsedMs: 5 * 60_000,
    jitter: "full",
  };
  /** A Random that always picks a half. */
  const HALF: Random.Random = { nextIntUnsafe: () => 0, nextDoubleUnsafe: () => 0.5 };

  it(
    "is the part its Random picked: half of 500 ms after the first failure, then it dials again",
    async () => {
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* recordingHost(path, "host 1");
          const client = yield* clientEnd;
          // The bridge alone runs on a clock the test moves; the test's own waits stay real.
          const clock = yield* TestClock.make();
          let dials = 0;
          const dial = Effect.sync(() => {
            dials += 1;
          }).pipe(Effect.andThen(NodeSocket.makeNet({ path })));
          yield* bridge(dial, "claude", FULL).pipe(
            Effect.provideService(Stdio.Stdio, client.stdio),
            Effect.provideService(Clock.Clock, clock),
            Effect.provideService(Random.Random, HALF),
            Effect.forkScoped,
          );
          yield* opened(client);
          yield* first.stop;
          // A short real window: the bridge waits on its own clock, which has not moved.
          yield* Effect.sleep("100 millis");
          const stopped = dials;
          // One failure so far: the full wait is 250 ms doubled once, and the pick is half of it.
          yield* clock.adjust(249);
          yield* Effect.sleep("50 millis");
          const before = dials;
          yield* clock.adjust(1);
          yield* until("a second dial", () => (dials >= 2 ? dials : undefined));
          // The second dial finds no host; the next wait is half of 1000 ms, so no third yet.
          yield* Effect.sleep("50 millis");
          return { stopped, before, after: dials };
        }),
      );
      expect(seen).toEqual({ stopped: 1, before: 1, after: 2 });
    },
    LONG,
  );

  /**
   * A host whose first connection answers as `recordingHost`'s does, and whose every connection
   * after it says the handshake, then closes its socket as the replayed `initialize` comes: a
   * build that starts, then crashes before it answers. `drop` closes the first connection;
   * `shaken` counts the handshakes it answered, one per dial that reached it.
   */
  const crashingHost = (path: string) =>
    Effect.gen(function* () {
      let shaken = 0;
      let first: NetSocket | null = null;
      const open = new Set<NetSocket>();
      const server = createServer((socket) => {
        const at = first === null ? 0 : 1;

        if (at === 0) {
          first = socket;
        }

        open.add(socket);
        socket.on("error", () => {});
        socket.on("close", () => open.delete(socket));
        const say = (m: unknown) => socket.write(`${JSON.stringify(m)}\n`);
        let rest = "";
        socket.on("data", (chunk) => {
          rest += chunk.toString("utf8");
          const parts = rest.split("\n");
          rest = parts.pop() ?? "";

          for (const part of parts) {
            if (part.trim() === "") {
              continue;
            }

            const m: unknown = JSON.parse(part);

            if (field(m, "type") === "handshake") {
              shaken += 1;
              say({ type: "handshake", version: AGENTS_PROTOCOL });
            } else if (field(m, "method") === "initialize") {
              if (at !== 0) {
                socket.destroy();
                return;
              }

              say({
                jsonrpc: "2.0",
                id: field(m, "id"),
                result: {
                  protocolVersion: field(field(m, "params"), "protocolVersion"),
                  capabilities: { tools: { listChanged: true } },
                  serverInfo: { name: "crashing", version: "0.0.0" },
                },
              });
            }
          }
        });
      });
      yield* Effect.callback<void>((resume) => {
        server.listen(path, () => resume(Effect.void));
      });
      yield* Effect.addFinalizer(() =>
        Effect.callback<void>((resume) => {
          for (const socket of open) {
            socket.destroy();
          }

          if (server.listening) {
            server.close(() => resume(Effect.void));
          } else {
            resume(Effect.void);
          }
        }),
      );
      return { shaken: () => shaken, drop: () => first?.destroy() };
    });

  // Tracker 220, from PR 4's review: the streak of failed tries began again whenever a host
  // passed the handshake, so a build that handshakes and then crashes was dialed for ever, about
  // 4 times a second, and the five minutes never ran out. A host that dies before it answers the
  // replayed initialize is a failed try: the streak goes on until that answer comes.
  it(
    "ends within the five minutes when every new host says its handshake, then closes before it answers the replayed initialize",
    async () => {
      const lines: string[] = [];
      const caught = Logger.make((o) => {
        lines.push(Logger.formatSimple.log(o));
      });
      /** How far the bridge's clock moves at a time, and the furthest it is moved in all. */
      const STEP = 2_500;
      const PAST = FULL.maxElapsedMs + 2 * FULL.capMs;
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const host = yield* crashingHost(path);
          const client = yield* clientEnd;
          // The bridge alone runs on a clock the test moves; the test's own waits stay real.
          const clock = yield* TestClock.make();
          const running = yield* bridge(NodeSocket.makeNet({ path }), "claude", FULL).pipe(
            Effect.provideService(Stdio.Stdio, client.stdio),
            Effect.provideService(Clock.Clock, clock),
            Effect.provideService(Random.Random, HALF),
            Effect.provide(Logger.layer([caught])),
            Effect.forkScoped,
          );
          yield* opened(client);
          host.drop();
          let moved = 0;

          while (moved < PAST && running.pollUnsafe() === undefined) {
            yield* clock.adjust(STEP);
            moved += STEP;
            // A short real window for the dial, the handshake and the close.
            yield* Effect.sleep("20 millis");
          }

          return { exit: running.pollUnsafe(), moved, shaken: host.shaken() };
        }),
      );
      // It dialed again and again, and each new host crashed in the replay.
      expect(seen.shaken).toBeGreaterThan(3);
      // Then it stopped, within the five minutes and one longest wait, with why.
      expect(seen.exit, "the bridge still ran past its five minutes").toBeDefined();
      expect(seen.moved).toBeLessThanOrEqual(FULL.maxElapsedMs + FULL.capMs + STEP);
      const exit = seen.exit;
      expect(exit !== undefined && Exit.isFailure(exit)).toBe(true);
      const error = exit !== undefined && Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      expect(error).toMatchObject({ _tag: "BridgeStopped" });
      expect(String(field(error, "why"))).toMatch(/host/);
      // One streak: each host_back counts one try more than the last, never one from nothing.
      const tries = lines.filter((l) => l.includes("message=host_back")).map((l) => Number(/tries=(\d+)/.exec(l)?.[1]));
      expect(tries.length).toBeGreaterThan(3);

      for (const [i, n] of tries.entries()) {
        if (i > 0) {
          expect(n).toBeGreaterThan(tries[i - 1] ?? 0);
        }
      }
    },
    LONG,
  );
});

/**
 * The MCP SDK's own client on the bridge's stdin and stdout, as Claude Code would hold them: a
 * transport that writes each message as a line, and hands it each line the bridge writes.
 */
const sdkClientOn = (client: Effect.Success<typeof clientEnd>, changed: unknown[][]) =>
  Effect.gen(function* () {
    const errors: Error[] = [];
    let seen = 0;
    const transport: Transport = {
      start: async () => {},
      send: async (message: JSONRPCMessage) => {
        client.say(message);
      },
      close: async () => {},
    };
    const sdk = new Client(
      { name: "claude-code", version: "2.1.0" },
      {
        listChanged: {
          tools: { debounceMs: 0, onChanged: (_, tools) => changed.push(tools ?? []) },
        },
      },
    );
    // Pass each line the bridge wrote on to the SDK, in order, as they come.
    yield* Effect.gen(function* () {
      while (true) {
        while (seen < client.heard.length) {
          const message = client.heard[seen] as JSONRPCMessage;
          seen += 1;
          transport.onmessage?.(message);
        }

        yield* Effect.sleep("2 millis");
      }
    }).pipe(Effect.forkScoped);
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        await sdk.connect(transport);
        sdk.onerror = (e) => errors.push(e);
      }).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.die("the client's initialize was not answered"),
        }),
      ),
      () => Effect.promise(() => sdk.close()).pipe(Effect.ignore),
    );
    return { sdk, errors };
  });

/** The agents' host, `serveAgent`, on `path`, in its own scope: closed, it stops. */
const agentsHost = (path: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const server = yield* NodeSocketServer.make({ path }).pipe(Scope.provide(scope));
    yield* server
      .run((socket) =>
        serveAgent(socket, {
          person: "owner",
          programsFor: () => Effect.succeed({ list: programList(SMALL), readOnly: null }),
          tiles: () => [],
        }).pipe(Effect.ignore),
      )
      .pipe(Effect.forkIn(scope));
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    return { stop: Scope.close(scope, Exit.void) };
  });

describe("an MCP client on the bridge, across a host restart (d20)", () => {
  it(
    "keeps its tools: it is told they changed, its calls go on, and the new host hears who it is",
    async () => {
      const lines: string[] = [];
      const caught = Logger.make((o) => {
        lines.push(Logger.formatSimple.log(o));
      });
      const seen = await go(
        Effect.gen(function* () {
          const path = yield* socketPath;
          const first = yield* agentsHost(path);
          const client = yield* clientEnd;
          yield* bridgeOn(path, client.stdio);
          const changed: unknown[][] = [];
          const { sdk, errors } = yield* sdkClientOn(client, changed);
          const before = yield* Effect.promise(() => sdk.callTool({ name: "runs", arguments: {} }));

          yield* first.stop;
          yield* agentsHost(path);
          const tools = yield* until("the client's new list of tools", () => changed[0]);
          const after = yield* Effect.promise(() => sdk.callTool({ name: "runs", arguments: {} }));
          return { before, after, tools, errors: [...errors] };
        }).pipe(Effect.provide(Logger.layer([caught]))),
      );
      expect(seen.before.isError).toBeFalsy();
      expect(seen.after.isError).toBeFalsy();
      // The SDK refreshed the list on the notice, from the new host.
      expect(seen.tools.map((t) => field(t, "name"))).toContain("runs");
      // The SDK saw nothing it could not place, such as an answer to an id it never sent.
      expect(seen.errors).toEqual([]);
      // Each host heard the client's initialize first, so each names the client in its line.
      const came = lines.filter((l) => l.includes("message=agent_came"));
      expect(came).toHaveLength(2);

      for (const line of came) {
        expect(line).toContain("client=claude-code");
      }
    },
    LONG,
  );
});
