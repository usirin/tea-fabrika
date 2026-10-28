import {Schema} from "effect";
import {isAgentName} from "../host/door.ts";

// The first line on the host's agents' socket, before any MCP message: who the agent is. The
// rest of the socket is MCP, framed as its stdio binding frames it (spec 2026-07-28, "Transports":
// a custom transport on a byte stream reuses the stdio framing), one JSON-RPC message a line.
//
//   bridge  {"type":"hello","version":1,"agent":"claude"}
//   host    {"type":"hello","version":1}                       then MCP, both ways
//   host    {"type":"refused","why":"..."}                     then the socket closes
//
// The hello names an agent, and nothing else: there is no field that could name a person. The
// host makes the writer from it, `{kind: "agent", id: "claude", for: <the host's person>}`.

/** The version of this first line. Raise it when the hello or what follows it changes. */
export const AGENTS_PROTOCOL = 1;

/** An agent's name, as the door takes one: small letters, digits, dots, dashes, underscores. */
export const AgentName = Schema.String.check(
	Schema.makeFilter(
		(s) => isAgentName(s) || "an agent's name: small letters, digits, dots, dashes, underscores",
	),
);

/** What the bridge says first. */
export const AgentHello = Schema.Struct({
	type: Schema.Literal("hello"),
	version: Schema.Int,
	agent: AgentName,
});
export type AgentHello = typeof AgentHello.Type;

/** What the host answers. */
export const HostAnswer = Schema.Union([
	Schema.Struct({type: Schema.Literal("hello"), version: Schema.Int}),
	Schema.Struct({type: Schema.Literal("refused"), why: Schema.String}),
]);
export type HostAnswer = typeof HostAnswer.Type;

/** The longest line either side reads, in bytes: a ticket body is text, so a few MiB is room. */
export const MAX_LINE = 4 * 1024 * 1024;
