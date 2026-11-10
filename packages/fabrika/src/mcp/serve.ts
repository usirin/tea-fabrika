import {
  type CallToolResult,
  type JSONRPCMessage,
  parseJSONRPCMessage,
  Server,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Cause, Clock, Deferred, Effect, Exit, Option, Queue, Schema, type Scope, Stream } from "effect";
import { Ndjson } from "effect/encoding";
import { Socket } from "effect/socket";
import type { Agent } from "../host/writer.ts";
import { oneLine } from "../shell/one-line.ts";
import type { ProgramList } from "../shell/programs.ts";
import { type Answer, driveFor, type InTile } from "./drive.ts";
import { AGENTS_PROTOCOL, Handshake, type HostAnswer, MAX_LINE } from "./handshake.ts";
import type { JobAnswer } from "./job.ts";
import type { LineAnswer, LineAsk, LineRefused } from "./line.ts";
import type { RestartAnswer, RestartAsk, RestartRefused } from "./restart.ts";
import type { StopAnswer, StopAsk, StopRefused } from "./stop.ts";

// One agent on the host's agents' socket: its handshake, then MCP, served with the official SDK's
// `Server` (`@modelcontextprotocol/server`, v2, spec 2026-07-28). `serveStdio` decides the
// protocol's era from the first message, so a client of the 2025 revisions (an `initialize`
// first, as Claude Code sends) and one of 2026-07-28 are both served. Its transport here is the
// socket, framed as stdio frames: one JSON-RPC message a line.
//
//   yield* serveAgent(socket, {programsFor, person: "owner", tiles})
//   // bridge  {"type":"handshake","version":1,"agent":"claude"}
//   // host    {"type":"handshake","version":1}
//   // client  tools/list                    toolsOf(programsFor({kind: "agent", id: "claude", for: "owner"}).list)
//   // client  tools/call tracker_file {value: {title: "Login fails", body: ""}}
//   //         the agent's own tracker files it, as agent:claude for:owner
//
// Who the agent is comes from the handshake alone, and the writer is made here, as an `Agent`:
// `programsFor` is handed nothing else, so no list it makes for an agent can hold the person's
// writer. The host gives each program the writer it is handed, on the agent's own ledger session
// where it has one (apps/fabrika, host/agents.ts). One whose writes could not be its own is served
// only the tools that write nothing, and `runs` says why.
//
// Each agent's moves are lines in the host's log (record wide, as Stripe's canonical log lines):
// one as its first message is heard, with the client its `initialize` named, and one per tool
// call, done, refused or crashed, with the call's JSON-RPC id, so a line matches the agent's own
// transcript later. A refused call leaves no other trace. What the agent chose (its client's name
// and version, a call's id when it is a string, a tool's name, a refusal that echoes it) is one
// line first (../shell/one-line.ts). Only the log's copy: the answer goes back under the real id.
//
//   level=INFO message=agent_came agent=claude client=claude-code version=...
//   level=INFO message=tool_called agent=claude tool=stop call=7 took_ms=41 ok=true
//   level=INFO message=tool_called agent=claude tool=stop call=8 took_ms=0 "refused=there is no job 99 ..."
//   level=ERROR message=tool_called agent=claude tool=stop call=9 took_ms=3 "failed=..."
//
// No platform is named but the SDK's own: `serveStdio` reads Node's `process` through the SDK's
// shims, which is why this is on the `/mcp` subpath.

/**
 * What one agent is served: the programs it drives, each packed with services that write as it,
 * and, when its writes could not be its own, why it is served only the tools that write nothing.
 */
export interface AgentPrograms {
  readonly list: ProgramList;
  readonly readOnly: { readonly why: string } | null;
}

export interface AgentOptions {
  /**
   * What agent `who` is served, made as its handshake is read, in the agent's own scope: a
   * session made for it there lasts as long as the agent stays.
   */
  readonly programsFor: (who: typeof Agent.Type) => Effect.Effect<AgentPrograms, never, Scope.Scope>;
  /** The person the host works for: each agent works for them (`for`). */
  readonly person: string;
  /** The runs in the person's tiles now, for `runs` to list. */
  readonly tiles: () => readonly InTile[];
  /** Job n of the host's table now, with every line kept of it, for the `job` tool (./job.ts). */
  readonly job?: ((n: number) => JobAnswer | null) | undefined;
  /** Stop job n of the host's table for agent `who`, and why, for the `stop` tool (./stop.ts). */
  readonly stop?: ((who: typeof Agent.Type, ask: StopAsk) => Effect.Effect<StopAnswer, StopRefused>) | undefined;
  /**
   * Restart the host for agent `who`, and why, for the `restart` tool (./restart.ts). Who is the
   * agent its handshake named: the tool takes only `why`.
   */
  readonly restart?:
    | ((who: typeof Agent.Type, ask: RestartAsk) => Effect.Effect<RestartAnswer, RestartRefused>)
    | undefined;
  /** Run one line in agent `who`'s own tile, for the `line` tool (./line.ts). */
  readonly line?: ((who: typeof Agent.Type, ask: LineAsk) => Effect.Effect<LineAnswer, LineRefused>) | undefined;
  /** The server's name and version, as the client is told. */
  readonly server?: { readonly name: string; readonly version: string };
  /**
   * The handshake was read: this agent is attached. Run in the agent's own scope, so a finalizer
   * added there runs as it goes. A host counts the agents on its socket by it.
   */
  readonly attached?: (who: typeof Agent.Type) => Effect.Effect<void, never, Scope.Scope>;
}

const decodeHandshake = Schema.decodeUnknownOption(Handshake);

/** A tool's answer as MCP's tool result: the data as JSON text, or the why, marked as an error. */
const resultOf = (answer: Answer): CallToolResult =>
  answer.kind === "done"
    ? { content: [{ type: "text", text: JSON.stringify(answer.data, null, 2) }] }
    : { content: [{ type: "text", text: answer.why }], isError: true };

/** An `initialize` request, as far as the log reads it: the client's own name and version. */
const Initialize = Schema.Struct({
  method: Schema.Literal("initialize"),
  params: Schema.Struct({ clientInfo: Schema.Struct({ name: Schema.String, version: Schema.String }) }),
});

const decodeInitialize = Schema.decodeUnknownOption(Initialize);

/**
 * The agent's first message was heard: its line, with the client its `initialize` named. A client
 * of 2026-07-28 sends no `initialize`, and its line names none.
 */
const agentCame = (who: typeof Agent.Type, first: JSONRPCMessage) => {
  const client = Option.getOrNull(decodeInitialize(first))?.params.clientInfo ?? null;
  return Effect.logInfo("agent_came").pipe(
    Effect.annotateLogs({
      agent: who.id,
      ...(client === null ? {} : { client: oneLine(client.name), version: oneLine(client.version) }),
    }),
  );
};

/** What a call that did not answer came to, in a few words: its defect's message, or `interrupted`. */
const failureOf = (cause: Cause.Cause<unknown>): string => {
  if (Cause.hasInterruptsOnly(cause)) {
    return "interrupted";
  }

  const first = Cause.squash(cause);
  return oneLine(first instanceof Error ? first.message : String(first));
};

/**
 * One tool call's line, said as the call ends however it ends: the tool, the call's JSON-RPC id,
 * how long it took, and `ok`, the refusal, or `failed` for a call that crashed and answered
 * nothing of its own. The agent chose the tool's name and the call's id, which JSON-RPC lets be
 * any string: both are one line here.
 */
const toolCalled = (
  who: typeof Agent.Type,
  tool: string,
  call: string | number,
  took: number,
  exit: Exit.Exit<Answer>,
) => {
  const end = Exit.isSuccess(exit)
    ? exit.value.kind === "done"
      ? { ok: true }
      : { refused: exit.value.why }
    : { failed: failureOf(exit.cause) };
  const line = {
    agent: who.id,
    tool: oneLine(tool),
    call: typeof call === "string" ? oneLine(call) : call,
    took_ms: took,
    ...end,
  };
  return (Exit.isSuccess(exit) ? Effect.logInfo("tool_called") : Effect.logError("tool_called")).pipe(
    Effect.annotateLogs(line),
  );
};

/**
 * A refusal as one line, as the agent is told it and the log writes it: a schema's problem spans
 * lines, and a refusal may echo the tool name the agent chose.
 */
const oneLineWhy = (answer: Answer): Answer =>
  answer.kind === "done" ? answer : { kind: "refused", why: oneLine(answer.why) };

/** Drive one call, and say its line as it ends, a crash included. */
const calledBy = (who: typeof Agent.Type, tool: string, call: string | number, run: Effect.Effect<Answer>) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    return yield* run.pipe(
      Effect.map(oneLineWhy),
      Effect.onExit((exit) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => toolCalled(who, tool, call, Math.round(now - began), exit)),
      ),
    );
  });

/** Serve one agent on `socket` until either side closes it. */
export const serveAgent = (socket: Socket.Socket, options: AgentOptions) =>
  Effect.gen(function* () {
    const { programsFor, person, tiles } = options;
    const info = options.server ?? { name: "fabrika", version: "0.0.0" };
    const services = yield* Effect.context<never>();
    const out = yield* Queue.make<HostAnswer | JSONRPCMessage, Cause.Done>();
    const ended = yield* Deferred.make<void>();
    /** The transport the SDK is handed, once the handshake was read. */
    let transport: (Transport & { readonly heard: (raw: unknown) => void }) | null = null;
    let refused = false;

    const refuse = (why: string) => {
      refused = true;
      Queue.offerUnsafe(out, { type: "refused", why });
      Queue.endUnsafe(out);
    };

    const begin = (handshake: Handshake) =>
      Effect.gen(function* () {
        const who = { kind: "agent", id: handshake.agent, for: person } as const;
        const served = yield* programsFor(who);
        const { stop, restart, line } = options;
        const { drive, tools } = yield* driveFor({
          list: served.list,
          tiles,
          job: options.job,
          stop: stop === undefined ? undefined : (ask) => stop(who, ask),
          restart: restart === undefined ? undefined : (ask) => restart(who, ask),
          line: line === undefined ? undefined : (ask) => line(who, ask),
          readOnly: served.readOnly ?? false,
        });

        if (options.attached !== undefined) {
          yield* options.attached(who);
        }

        // Its tools may change (spec 2025-11-25, "Tools", Capabilities: `listChanged`): a new host
        // may serve the read-only door, or the other way. The bridge says so to the client after
        // a new host (./bridge.ts); a client heeds the notice only from a server that declared it.
        const server = new Server(info, { capabilities: { tools: { listChanged: true } } });
        server.setRequestHandler("tools/list", () => ({ tools: [...tools] }));
        server.setRequestHandler("tools/call", (request, ctx) => {
          const { name, arguments: args } = request.params;
          return Effect.runPromiseWith(services)(
            calledBy(who, name, ctx.mcpReq.id, drive.call(name, args)).pipe(Effect.map(resultOf)),
          );
        });
        /** The first message was heard: the agent's `agent_came` line is said. */
        let came = false;
        const t: Transport & { readonly heard: (raw: unknown) => void } = {
          start: async () => {},
          send: async (message) => {
            Queue.offerUnsafe(out, message);
          },
          close: async () => {
            Queue.endUnsafe(out);
          },
          heard: (raw) => {
            let message: JSONRPCMessage;

            try {
              message = parseJSONRPCMessage(raw);
            } catch (cause) {
              t.onerror?.(new Error(`a line that is not JSON-RPC: ${String(cause)}`));
              return;
            }

            if (!came) {
              came = true;
              Effect.runForkWith(services)(agentCame(who, message));
            }

            t.onmessage?.(message);
          },
        };
        transport = t;
        Queue.offerUnsafe(out, { type: "handshake", version: AGENTS_PROTOCOL });
        const handle = serveStdio(() => server, { transport: t });
        yield* Effect.addFinalizer(() => Effect.promise(() => handle.close()).pipe(Effect.ignore));
      });

    const heard = (raw: unknown) =>
      Effect.gen(function* () {
        if (refused) {
          return;
        }

        if (transport !== null) {
          return transport.heard(raw);
        }

        const handshake = decodeHandshake(raw);

        if (handshake._tag === "None") {
          return refuse(
            "the first line is a handshake that names an agent: a name of a-z, 0-9, '.', '_' and '-', never a person's (user:...)",
          );
        }

        if (handshake.value.version !== AGENTS_PROTOCOL) {
          return refuse(
            `this host speaks version ${AGENTS_PROTOCOL} on its agents' socket, the bridge ${handshake.value.version}`,
          );
        }

        yield* begin(handshake.value);
      });

    const channel = Ndjson.duplex({ maxLineBytes: MAX_LINE })(Socket.toChannel(socket));
    yield* Stream.fromQueue(out).pipe(
      Stream.pipeThroughChannel(channel),
      Stream.runForEach(heard),
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => {
          transport?.onclose?.();
        }),
      ),
      Effect.ensuring(Deferred.succeed(ended, undefined)),
      Effect.forkScoped,
    );
    yield* Deferred.await(ended);
  }).pipe(Effect.scoped);
