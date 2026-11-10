// `@kampus/fabrika-old/mcp`: a host's programs, served to an agent as MCP tools (spec 2026-07-28), so
// an agent drives the programs a person watches. Each input of each program is a tool, made from
// its schema (`toolsOf`); a call goes to the agent's own run of that program (`driveFor`), which
// writes as the agent. On a subpath: it names the MCP SDK, whose stdio part reads Node's process.
//
//   // In a host, on its agents' socket:
//   const programsFor = (who) => Effect.succeed({list: programList([...]), readOnly: null});
//   yield* serveAgent(socket, {programsFor, person: "owner", tiles});
//   // In the command an MCP client starts:
//   yield* bridge(NodeSocket.makeNet({path}), "claude", POLICY);   dials again when the host ends
export { BridgeStopped, bridge } from "./mcp/bridge.ts";
export { type Answer, type Drive, driveFor, type InTile } from "./mcp/drive.ts";
export { AGENTS_PROTOCOL, AgentName, Handshake, HostAnswer } from "./mcp/handshake.ts";
export { JOB, JobAnswer, KeptLines, LAST_MAX } from "./mcp/job.ts";
export { LineAnswer, LineAsk, LineRefused } from "./mcp/line.ts";
export { RestartAnswer, RestartRefused } from "./mcp/restart.ts";
export { type AgentOptions, serveAgent } from "./mcp/serve.ts";
export { EXIT_WITHIN, StopAnswer, StopRefused, Why } from "./mcp/stop.ts";
export { type Call, callOf, RUNS, type Tool, toolNameOf, toolsOf } from "./mcp/tools.ts";
