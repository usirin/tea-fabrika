import {
	type CallToolResult,
	type JSONRPCMessage,
	parseJSONRPCMessage,
	Server,
	type Transport,
} from "@modelcontextprotocol/server";
import {serveStdio} from "@modelcontextprotocol/server/stdio";
import {type Cause, Deferred, Effect, Queue, Schema, Stream} from "effect";
import {Ndjson} from "effect/encoding";
import {Socket} from "effect/socket";
import type {Agent} from "../host/writer.ts";
import type {ProgramList} from "../shell/programs.ts";
import {type Answer, driveFor, type InTile} from "./drive.ts";
import {AGENTS_PROTOCOL, Handshake, type HostAnswer, MAX_LINE} from "./handshake.ts";

// One agent on the host's agents' socket: its handshake, then MCP, served with the official SDK's
// `Server` (`@modelcontextprotocol/server`, v2, spec 2026-07-28). `serveStdio` decides the
// protocol's era from the first message, so a client of the 2025 revisions (an `initialize`
// first, as Claude Code sends) and one of 2026-07-28 are both served. Its transport here is the
// socket, framed as stdio frames: one JSON-RPC message a line.
//
//   yield* serveAgent(socket, {programsFor, person: "owner", tiles})
//   // bridge  {"type":"handshake","version":1,"agent":"claude"}
//   // host    {"type":"handshake","version":1}
//   // client  tools/list                    toolsOf(programsFor({kind: "agent", id: "claude", for: "owner"}))
//   // client  tools/call tracker_do {value: {kind: "file", title: "Login fails", body: ""}}
//   //         the agent's own tracker files it, as agent:claude for:owner
//
// Who the agent is comes from the handshake alone, and the writer is made here, as an `Agent`:
// `programsFor` is handed nothing else, so no list it makes for an agent can hold the person's
// writer. The host gives each program the writer it is handed (apps/fabrika, host/serve.ts).
//
// No platform is named but the SDK's own: `serveStdio` reads Node's `process` through the SDK's
// shims, which is why this is on the `/mcp` subpath.

export interface AgentOptions {
	/** The programs an agent drives, each packed with services that write as `who`. */
	readonly programsFor: (who: typeof Agent.Type) => ProgramList;
	/** The person the host works for: each agent works for them (`for`). */
	readonly person: string;
	/** The runs in the person's tiles now, for `runs` to list. */
	readonly tiles: () => readonly InTile[];
	/** The server's name and version, as the client is told. */
	readonly server?: {readonly name: string; readonly version: string};
}

const decodeHandshake = Schema.decodeUnknownOption(Handshake);

/** A tool's answer as MCP's tool result: the data as JSON text, or the why, marked as an error. */
const resultOf = (answer: Answer): CallToolResult =>
	answer.kind === "done"
		? {content: [{type: "text", text: JSON.stringify(answer.data, null, 2)}]}
		: {content: [{type: "text", text: answer.why}], isError: true};

/** Serve one agent on `socket` until either side closes it. */
export const serveAgent = (socket: Socket.Socket, options: AgentOptions) =>
	Effect.gen(function* () {
		const {programsFor, person, tiles} = options;
		const info = options.server ?? {name: "fabrika", version: "0.0.0"};
		const services = yield* Effect.context<never>();
		const out = yield* Queue.make<HostAnswer | JSONRPCMessage, Cause.Done>();
		const ended = yield* Deferred.make<void>();
		/** The transport the SDK is handed, once the handshake was read. */
		let transport: (Transport & {readonly heard: (raw: unknown) => void}) | null = null;
		let refused = false;

		const refuse = (why: string) => {
			refused = true;
			Queue.offerUnsafe(out, {type: "refused", why});
			Queue.endUnsafe(out);
		};

		const begin = (handshake: Handshake) =>
			Effect.gen(function* () {
				const who = {kind: "agent", id: handshake.agent, for: person} as const;
				const {drive, tools} = yield* driveFor({list: programsFor(who), tiles});
				const server = new Server(info, {capabilities: {tools: {}}});
				server.setRequestHandler("tools/list", () => ({tools: [...tools]}));
				server.setRequestHandler("tools/call", (request) => {
					const {name, arguments: args} = request.params;
					return Effect.runPromiseWith(services)(drive.call(name, args).pipe(Effect.map(resultOf)));
				});
				const t: Transport & {readonly heard: (raw: unknown) => void} = {
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
						t.onmessage?.(message);
					},
				};
				transport = t;
				Queue.offerUnsafe(out, {type: "handshake", version: AGENTS_PROTOCOL});
				const handle = serveStdio(() => server, {transport: t});
				yield* Effect.addFinalizer(() => Effect.promise(() => handle.close()).pipe(Effect.ignore));
			});

		const heard = (raw: unknown) =>
			Effect.gen(function* () {
				if (refused) return;
				if (transport !== null) return transport.heard(raw);
				const handshake = decodeHandshake(raw);
				if (handshake._tag === "None")
					return refuse(
						"the first line is a handshake that names an agent: a name of a-z, 0-9, '.', '_' and '-', never a person's (user:...)",
					);
				if (handshake.value.version !== AGENTS_PROTOCOL)
					return refuse(
						`this host speaks version ${AGENTS_PROTOCOL} on its agents' socket, the bridge ${handshake.value.version}`,
					);
				yield* begin(handshake.value);
			});

		const channel = Ndjson.duplex({maxLineBytes: MAX_LINE})(Socket.toChannel(socket));
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
