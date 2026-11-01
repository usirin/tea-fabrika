// `@kampus/fabrika-old/mcp`: a host's programs, served to an agent as MCP tools (spec 2026-07-28), so
// an agent drives the programs a person watches. Each input of each program is a tool, made from
// its schema (`toolsOf`); a call goes to the agent's own run of that program (`driveFor`), which
// writes as the agent. On a subpath: it names the MCP SDK, whose stdio part reads Node's process.
//
//   // In a host, on its agents' socket:
//   yield* serveAgent(socket, {programsFor: (who) => programList([...]), person: "owner", tiles});
//   // In the command an MCP client starts:
//   yield* bridge(socket, "claude");
export {BridgeStopped, bridge} from "./mcp/bridge.ts";
export {type Answer, type Drive, driveFor, type InTile} from "./mcp/drive.ts";
export {AGENTS_PROTOCOL, AgentName, Handshake, HostAnswer} from "./mcp/handshake.ts";
export {type AgentOptions, serveAgent} from "./mcp/serve.ts";
export {type Call, callOf, RUNS, type Tool, toolNameOf, toolsOf} from "./mcp/tools.ts";
