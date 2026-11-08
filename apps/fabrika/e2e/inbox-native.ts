import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";

// An unsummoned fake agent on the production CLI bridge. No harness and no paid turn.
// These two planned tool names need agreement with the summon build; they are not mocks.
export const nativeAgent = async (home: string, name: string) => {
	const client = new Client({name: "inbox-law", version: "1"});
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "mcp", "--as", name],
		env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
		stderr: "pipe",
	});
	try {
		await client.connect(transport);
	} catch (error) {
		await transport.close();
		throw error;
	}
	return {
		tools: async () => (await client.listTools()).tools.map((t) => t.name),
		call: async (name: string, value: unknown) => {
			try {
				const result = await client.callTool({name, arguments: {value}});
				const text = Array.isArray(result.content)
					? result.content
							.filter((c) => c.type === "text")
							.map((c) => c.text)
							.join("\n")
					: "";
				return {error: result.isError === true, text};
			} catch (error) {
				return {error: true, text: error instanceof Error ? error.message : String(error)};
			}
		},
		close: () => client.close(),
	};
};
