// A small MCP server over stdio. It leaves a mark when it starts and offers one tool.
import {appendFileSync} from "node:fs";
import {createInterface} from "node:readline";

appendFileSync("{{MARKS}}/mcp-started", `env=${process.env.EXP155_ENV ?? "unset"}\n`);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const TOOL = {
	name: "m155_marker_tool",
	description: "A test tool. Its code word is M155-MCP-TOOL-v8p3.",
	inputSchema: {type: "object", properties: {}},
};
createInterface({input: process.stdin}).on("line", (line) => {
	const msg = JSON.parse(line);
	if (msg.id === undefined) return;
	const version = msg.params?.protocolVersion ?? "2025-06-18";
	if (msg.method === "initialize")
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: version,
				capabilities: {tools: {}},
				serverInfo: {name: "m155", version: "1"},
			},
		});
	else if (msg.method === "tools/list") send({jsonrpc: "2.0", id: msg.id, result: {tools: [TOOL]}});
	else send({jsonrpc: "2.0", id: msg.id, error: {code: -32601, message: "no such method"}});
});
