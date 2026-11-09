// P25, next/. Disposable SDK/Claude discovery driver. Never reads a real key or Claude config.
// `node experiments/238-mcp-discovery.ts selftest` runs both SDK eras, no model, $0.
// `... claude` opens an isolated interactive Claude session. Inspect /mcp before approving.
// In another terminal: `... approve <throwaway-home>`. Exit Claude when finished.
// The server records every wire frame, names, protocol and elapsed times in that home.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	appendFileSync,
} from "node:fs";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {Server} from "@modelcontextprotocol/server";
import {serveStdio, StdioServerTransport} from "@modelcontextprotocol/server/stdio";

const names = ["ps", "notes_save", "notes_read", "notes_list"];
const tools = names.map((name) => ({
	name,
	description: name,
	inputSchema: {type: "object" as const, properties: {}},
}));
const [mode = "help", homeArg] = process.argv.slice(2);
if (mode === "server") {
	assert(homeArg);
	const home = homeArg,
		start = performance.now();
	const record = (value: unknown) =>
		appendFileSync(
			join(home, "wire.jsonl"),
			`${JSON.stringify({ms: performance.now() - start, admitted: existsSync(join(home, "approved")), value})}\n`,
		);
	const transport = new StdioServerTransport();
	const send = transport.send.bind(transport);
	transport.send = async (message) => {
		record({direction: "out", message});
		return send(message);
	};
	serveStdio(
		() => {
			const server = new Server(
				{name: "p25-discovery-spike", version: "2.4.0"},
				{capabilities: {tools: {}}},
			);
			server.setRequestHandler("tools/list", () => ({tools}));
			server.setRequestHandler("tools/call", () =>
				existsSync(join(home, "approved"))
					? {content: [{type: "text", text: "admitted"}]}
					: {
							isError: true,
							content: [
								{
									type: "text",
									text: "Waiting for the owner. Look for code 482 109 in the fabrika menu bar.",
								},
							],
						},
			);
			return server;
		},
		{transport},
	);
	const onmessage = transport.onmessage;
	transport.onmessage = (message) => {
		record({direction: "in", message});
		onmessage?.(message);
	};
} else if (mode === "approve") {
	assert(homeArg?.startsWith("/tmp/fh."), "approve only a disposable spike home");
	writeFileSync(join(homeArg, "approved"), "");
} else if (mode === "sdk" || mode === "selftest" || mode === "claude") {
	const home = mkdtempSync("/tmp/fh.");
	const negotiated: string[] = [];
	let teardown = false;
	try {
		if (mode === "claude") {
			const config = join(home, "mcp.json");
			writeFileSync(
				config,
				JSON.stringify({
					mcpServers: {
						fabrika: {command: process.execPath, args: [import.meta.filename, "server", home]},
					},
				}),
			);
			const version = spawnSync("claude", ["--version"], {encoding: "utf8"}).stdout.trim();
			console.error(
				JSON.stringify({
					home,
					version,
					SDK: {server: "2.4.0", client: "2.4.0"},
					instructions:
						"Inspect /mcp before Approve; approve from a second terminal; inspect again in the same session. No model call is needed. Do not send a model prompt without a separate cost estimate.",
				}),
			);
			const run = spawnSync("claude", ["--strict-mcp-config", "--mcp-config", config], {
				cwd: home,
				env: {
					...process.env,
					CLAUDE_CONFIG_DIR: home,
					MCP_TIMEOUT: "10000",
					FABRIKA_HOME: home,
					TYPESAFE_API_KEY: undefined,
				},
				stdio: "inherit",
			});
			assert.equal(run.status, 0, "Claude session exited cleanly");
		} else
			for (const modern of [false, true]) {
				rmSync(join(home, "approved"), {force: true});
				const start = performance.now();
				const transport = new StdioClientTransport({
					command: process.execPath,
					args: [import.meta.filename, "server", home],
					env: {PATH: process.env.PATH ?? "", FABRIKA_HOME: home, MCP_TIMEOUT: "10000"},
					stderr: "pipe",
				});
				const client = new Client(
					{name: "p25-spike", version: "1"},
					{versionNegotiation: {mode: modern ? {pin: "2026-07-28"} : "legacy"}},
				);
				try {
					await client.connect(transport);
					const listed = await client.listTools();
					const elapsed = performance.now() - start;
					assert.deepEqual(
						listed.tools.map((t) => t.name),
						names,
					);
					assert(elapsed < 10000, "configured startup timeout");
					const before = await client.callTool({name: "notes_read", arguments: {}});
					assert.equal(before.isError, true);
					assert.match(JSON.stringify(before), /482 109/);
					writeFileSync(join(home, "approved"), "");
					const after = await client.callTool({name: "notes_read", arguments: {}});
					assert.notEqual(after.isError, true);
					const protocol = client.getNegotiatedProtocolVersion();
					if (protocol) negotiated.push(protocol);
					console.log(
						JSON.stringify({
							SDK: {server: "2.4.0", client: "2.4.0"},
							era: client.getProtocolEra(),
							protocol: client.getNegotiatedProtocolVersion(),
							elapsed,
							names,
							before,
							after,
							modelCalls: 0,
							dollars: 0,
						}),
					);
				} finally {
					await client.close();
				}
			}
		// Every stdout frame the server emitted must have parsed as one JSON message.
		const frames = readFileSync(join(home, "wire.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert(frames.length > 0);
		console.log(
			JSON.stringify({
				frames: frames.length,
				actualProtocols: [
					...new Set([
						...negotiated,
						...frames.flatMap((f) =>
							[
								f.value.message?.params?.protocolVersion,
								f.value.message?.result?.protocolVersion,
							].filter(Boolean),
						),
					]),
				],
				elapsed: frames.at(-1).ms,
			}),
		);
	} finally {
		rmSync(home, {recursive: true, force: true});
		teardown = !existsSync(home);
		console.log(JSON.stringify({teardown}));
	}
} else
	console.log(
		"Usage: selftest | sdk | claude | approve <throwaway-home>. SDK runs are free. Actual Claude discovery remains unmeasured until the lead runs claude.",
	);
