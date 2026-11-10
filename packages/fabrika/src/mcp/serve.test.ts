import {createConnection} from "node:net";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {Effect, FileSystem, Logger} from "effect";
import {describe, expect, it} from "vitest";
import {programList} from "../shell/programs.ts";
import {SMALL} from "../shell/small.ts";
import {AGENTS_PROTOCOL} from "./handshake.ts";
import {serveAgent} from "./serve.ts";

// One agent on the host's agents' socket, and the host's line per tool call (tracker 185b, PR 1):
// every call writes one `tool_called` line, a call whose handler crashed included. Today's version,
// on a socket of the test's own, with no host: a fake `stop` that dies stands in for a host whose
// stop crashed. The agent's side is plain lines on the socket, as the bridge writes them.
//
//   agent  {"type":"handshake","version":1,"agent":"claude"}
//   agent  {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stop",...}}
//   host   an error answer for 2, and in its log: message=tool_called agent=claude tool=stop call=2 failed=...

/** One log line's `key=value` fields, as `Logger.formatSimple` writes them, quotes taken off. */
const fieldsOf = (line: string): Record<string, string> => {
	const out: Record<string, string> = {};

	for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		const [, key = "", raw = ""] = m;
		out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
	}

	return out;
};

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

describe("a tool call whose handler crashed", () => {
	it("still writes one tool_called line, marked failed", async () => {
		const lines: string[] = [];
		const caught = Logger.make((o) => {
			lines.push(Logger.formatSimple.log(o));
		});
		const heard = await Effect.runPromise(
			Effect.gen(function* () {
				const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "sv-"});
				const path = `${dir}/mcp.sock`;
				const server = yield* NodeSocketServer.make({path});
				yield* server
					.run((socket) =>
						serveAgent(socket, {
							person: "owner",
							programsFor: () => Effect.succeed({list: programList(SMALL), readOnly: null}),
							tiles: () => [],
							job: () => null,
							stop: () => Effect.die("the host's stop crashed"),
						}).pipe(Effect.ignore),
					)
					.pipe(Effect.forkScoped);
				const got: unknown[] = [];
				const client = createConnection(path);
				let rest = "";
				client.on("data", (chunk) => {
					rest += chunk.toString("utf8");
					const parts = rest.split("\n");
					rest = parts.pop() ?? "";

					for (const part of parts) {
						if (part.trim() !== "") {
							got.push(JSON.parse(part));
						}
					}
				});
				yield* Effect.addFinalizer(() => Effect.sync(() => client.destroy()));
				const say = (message: unknown) => client.write(`${JSON.stringify(message)}\n`);
				say({type: "handshake", version: AGENTS_PROTOCOL, agent: "claude"});
				yield* until("the host's handshake", () =>
					got.some((m) => Reflect.get(Object(m), "type") === "handshake") ? true : undefined,
				);
				// First a call that goes, so the log is known to be caught here.
				say({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: "runs", arguments: {}}});
				yield* until("the answer to 1", () => got.find((m) => Reflect.get(Object(m), "id") === 1));
				say({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {name: "stop", arguments: {n: 1, why: "wrong ticket"}},
				});
				const answer = yield* until("the answer to 2", () =>
					got.find((m) => Reflect.get(Object(m), "id") === 2),
				);
				// A moment more, so a line said late is caught too.
				yield* Effect.sleep("200 millis");
				return answer;
			}).pipe(
				Effect.scoped,
				Effect.provide(Logger.layer([caught])),
				Effect.provide(NodeFileSystem.layer),
			),
		);
		// The agent was answered, with an error: the call did not go.
		expect(heard).toMatchObject({jsonrpc: "2.0", id: 2});
		const called = lines.map(fieldsOf).filter((f) => f.message === "tool_called");
		expect(called.find((f) => f.call === "1")).toMatchObject({tool: "runs", ok: "true"});
		const crashed = called.filter((f) => f.call === "2");
		expect(crashed).toHaveLength(1);
		expect(crashed[0]).toMatchObject({agent: "claude", tool: "stop"});
		// made up: `failed`, the key the review names for a crashed call; the builder may pick another.
		expect(crashed[0]?.failed).toBeDefined();
		expect(crashed[0]?.ok).toBeUndefined();
	});
});

// The bridge outlives the host (tracker 185b, PR 4): after a new host, the bridge tells the client
// `notifications/tools/list_changed`, as a new host may serve other tools (the read-only door, or
// the other way). A client takes that notice only from a server that declared it may send it
// (spec 2025-11-25, "Tools", Capabilities: `listChanged`), as the SDK's own `Client` does: its
// `listChanged` handlers are set only when the server's `initialize` answer says so.
describe("an agent's initialize", () => {
	it("is answered with tools that may change, so the bridge's notice after a new host is heard", async () => {
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "sv-"});
				const path = `${dir}/mcp.sock`;
				const server = yield* NodeSocketServer.make({path});
				yield* server
					.run((socket) =>
						serveAgent(socket, {
							person: "owner",
							programsFor: () => Effect.succeed({list: programList(SMALL), readOnly: null}),
							tiles: () => [],
						}).pipe(Effect.ignore),
					)
					.pipe(Effect.forkScoped);
				const got: unknown[] = [];
				const client = createConnection(path);
				let rest = "";
				client.on("data", (chunk) => {
					rest += chunk.toString("utf8");
					const parts = rest.split("\n");
					rest = parts.pop() ?? "";

					for (const part of parts) {
						if (part.trim() !== "") {
							got.push(JSON.parse(part));
						}
					}
				});
				yield* Effect.addFinalizer(() => Effect.sync(() => client.destroy()));
				const say = (message: unknown) => client.write(`${JSON.stringify(message)}\n`);
				say({type: "handshake", version: AGENTS_PROTOCOL, agent: "claude"});
				say({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-11-25",
						capabilities: {},
						clientInfo: {name: "claude-code", version: "2.1.0"},
					},
				});
				return yield* until("the answer to initialize", () =>
					got.find((m) => Reflect.get(Object(m), "id") === 1),
				);
			}).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
		);
		expect(answer).toMatchObject({result: {capabilities: {tools: {listChanged: true}}}});
	});
});
