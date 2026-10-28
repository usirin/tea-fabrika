import {type Cause, Effect, Queue, Schema, Stdio, Stream} from "effect";
import {Ndjson} from "effect/encoding";
import {Socket} from "effect/socket";
import {AGENTS_PROTOCOL, HostAnswer, MAX_LINE} from "./handshake.ts";

// The stdio bridge: what an MCP client starts (`claude mcp add ... -- fabrika mcp --as claude`).
// It says the agent's handshake on the host's agents' socket, then passes each line of stdin to
// the socket and each line of the socket to stdout, as they are. It holds no MCP of its own: the
// host serves it (./serve.ts). Its own words go to stderr, never to stdout, which is the client's.
//
//   yield* bridge(socket, "claude")     on the Stdio service, until stdin or the socket ends
//   // socket  {"type":"handshake","version":1,"agent":"claude"}
//   // host    {"type":"handshake","version":1}
//   // stdin   {"jsonrpc":"2.0","id":1,"method":"initialize",...}   on to the host, line by line
//
// No platform is named: the socket and Stdio are Effect's, which the app's command makes on Node.

/** The host refused the bridge, or went before its handshake. */
export class BridgeStopped extends Schema.TaggedError<BridgeStopped>()("BridgeStopped", {
	why: Schema.String,
}) {}

const decodeAnswer = Schema.decodeUnknownOption(HostAnswer);

/** Bridge stdin and stdout to the host on `socket`, as agent `agent`. */
export const bridge = (socket: Socket.Socket, agent: string) =>
	Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		const toHost = yield* Queue.make<unknown, Cause.Done>();
		Queue.offerUnsafe(toHost, {type: "handshake", version: AGENTS_PROTOCOL, agent});

		// stdin, line by line, after the handshake. Its end is the socket's end too.
		yield* stdio.stdin.pipe(
			Stream.pipeThroughChannel(Ndjson.decode({ignoreEmptyLines: true, maxLineBytes: MAX_LINE})),
			Stream.runForEach((line) => Queue.offer(toHost, line)),
			Effect.ignore,
			Effect.ensuring(Queue.end(toHost)),
			Effect.forkScoped,
		);

		let up = false;
		const channel = Ndjson.duplex({maxLineBytes: MAX_LINE})(Socket.toChannel(socket));
		yield* Stream.fromQueue(toHost).pipe(
			Stream.pipeThroughChannel(channel),
			Stream.mapEffect((line) => {
				if (up) return Effect.succeed([`${JSON.stringify(line)}\n`]);
				const answer = decodeAnswer(line);
				if (answer._tag === "None")
					return Effect.fail(new BridgeStopped({why: "the host sent no handshake"}));
				if (answer.value.type === "refused")
					return Effect.fail(new BridgeStopped({why: answer.value.why}));
				up = true;
				return Effect.succeed([]);
			}),
			Stream.flattenIterable,
			Stream.run(stdio.stdout({endOnDone: false})),
			Effect.catchTag("SocketError", (e) =>
				Effect.fail(new BridgeStopped({why: `the socket ended: ${e.message}`})),
			),
			Effect.catchTag("NdjsonError", (e) =>
				Effect.fail(new BridgeStopped({why: `a line that does not read: ${e.message}`})),
			),
		);
		if (!up)
			return yield* new BridgeStopped({why: "the host closed the socket before its handshake"});
	}).pipe(Effect.scoped);
