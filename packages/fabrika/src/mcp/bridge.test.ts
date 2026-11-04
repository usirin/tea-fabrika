import {createServer, type Socket as NetSocket} from "node:net";
import type {DurationRetryPolicy} from "@demlik/tea/retry-backoff";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {Client} from "@modelcontextprotocol/client";
import type {JSONRPCMessage, Transport} from "@modelcontextprotocol/client";
import {
	Cause,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Logger,
	Queue,
	Scope,
	Sink,
	Stdio,
	Stream,
} from "effect";
import {describe, expect, it} from "vitest";
import {programList} from "../shell/programs.ts";
import {SMALL} from "../shell/small.ts";
import {bridge} from "./bridge.ts";
import {AGENTS_PROTOCOL} from "./handshake.ts";
import {serveAgent} from "./serve.ts";

// The bridge outlives the host (tracker 185b, PR 4). Today's version. The window's restart and
// `fabrika connect` end the host; the bridge Claude Code started must not end with it. It sees
// the socket end, dials again on the wait it is handed, says its handshake, replays the client's
// `initialize` and `notifications/initialized`, drops the new host's answer to that `initialize`,
// and tells the client `notifications/tools/list_changed`. A call while no host answers gets a
// JSON-RPC error that says why, never silence. No host within the wait: the bridge ends, with why.
//
//   client  initialize (id 0), notifications/initialized, tools/call (id 1)     host 1 answers
//   host 1 ends
//   client  tools/call (id 2)        -> {"jsonrpc":"2.0","id":2,"error":{"code":...,"message":"the host is restarting..."}}
//   host 2 listens on the same path
//   bridge  handshake, then initialize (id 0) and notifications/initialized, as the client said them
//   client  <- notifications/tools/list_changed, and no second answer to id 0
//
// Why an error, and why the notice, by the spec the installed SDK speaks (@modelcontextprotocol
// 2.4.0, LATEST_PROTOCOL_VERSION 2025-11-25, the era of an `initialize` first, as Claude Code
// sends): "Tools", Error Handling, puts "server errors" under protocol errors, a standard
// JSON-RPC error; "Lifecycle", Timeouts, has a sender that hears nothing wait until its timeout
// (the SDK's DEFAULT_REQUEST_TIMEOUT_MSEC, 60 s); and "Tools", List Changed Notification, says a
// server that declared `listChanged` SHOULD send `notifications/tools/list_changed`.
//
// Each host is a real unix socket on a temp folder of the test's own, stopped and listened on
// again at the same path. The wait is short here and handed in, as the app hands its own
// (reconnect.ts POLICY) in cli.ts. No jitter, so a run is the same each time.

/** The wait the bridge is handed: 10 ms, doubling, at most 40 ms apart, for 600 ms in all. */
const WAIT: DurationRetryPolicy = {
	baseMs: 10,
	factor: 2,
	capMs: 40,
	maxElapsedMs: 600,
	jitter: "none",
};

/** A test's own limit: past `until`'s five seconds, so a wait that fails says what it waited for. */
const LONG = 15_000;

/** Wait for `check` to answer something, five seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 1000; i += 1) {
			const got = check();
			if (got !== undefined) return got;
			yield* Effect.sleep("5 millis");
		}
		return yield* Effect.die(`waited for ${what}`);
	});

const field = (m: unknown, key: string): unknown => Reflect.get(Object(m), key);

/**
 * The client's end of the bridge: its stdin and stdout, as Claude Code holds them. `say` writes
 * one line to the bridge's stdin; `heard` is every line the bridge wrote to its stdout.
 */
const clientEnd = Effect.gen(function* () {
	const stdin = yield* Queue.make<Uint8Array, never>();
	const heard: unknown[] = [];
	let rest = "";
	/** One chunk the bridge wrote: each whole line in it, read. */
	const wrote = (chunk: string | Uint8Array) =>
		Effect.sync(() => {
			rest += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			const parts = rest.split("\n");
			rest = parts.pop() ?? "";
			for (const part of parts) if (part.trim() !== "") heard.push(JSON.parse(part));
		});
	const stdio = Stdio.make({
		args: Effect.succeed([]),
		stdin: Stream.fromQueue(stdin),
		stdout: () => Sink.forEach(wrote),
		stderr: () => Sink.drain,
	});
	const say = (message: unknown) =>
		Queue.offerUnsafe(stdin, new TextEncoder().encode(`${JSON.stringify(message)}\n`));
	return {stdio, say, heard};
});

/** The bridge on `path`, as agent claude, with the short wait: a fiber the test may await. */
const bridgeOn = (path: string, stdio: Stdio.Stdio) =>
	bridge(NodeSocket.makeNet({path}), "claude", WAIT).pipe(
		Effect.provideService(Stdio.Stdio, stdio),
		Effect.forkScoped,
	);

/**
 * A host that keeps every line it hears, on its own unix socket at `path`: it says the agents'
 * handshake back, answers `initialize`, and answers each `tools/call` with its own name, so an
 * answer says which host gave it. `conns` holds each connection's lines, in order.
 */
const recordingHost = (path: string, name: string) =>
	Effect.gen(function* () {
		const conns: unknown[][] = [];
		const open = new Set<NetSocket>();
		const server = createServer((socket) => {
			open.add(socket);
			const lines: unknown[] = [];
			conns.push(lines);
			const say = (m: unknown) => socket.write(`${JSON.stringify(m)}\n`);
			let rest = "";
			socket.on("error", () => {});
			socket.on("close", () => open.delete(socket));
			socket.on("data", (chunk) => {
				rest += chunk.toString("utf8");
				const parts = rest.split("\n");
				rest = parts.pop() ?? "";
				for (const part of parts) {
					if (part.trim() === "") continue;
					const m: unknown = JSON.parse(part);
					lines.push(m);
					if (field(m, "type") === "handshake") say({type: "handshake", version: AGENTS_PROTOCOL});
					else if (field(m, "method") === "initialize")
						say({
							jsonrpc: "2.0",
							id: field(m, "id"),
							result: {
								protocolVersion: field(field(m, "params"), "protocolVersion"),
								capabilities: {tools: {listChanged: true}},
								serverInfo: {name, version: "0.0.0"},
							},
						});
					else if (field(m, "method") === "tools/call")
						say({
							jsonrpc: "2.0",
							id: field(m, "id"),
							result: {content: [{type: "text", text: name}]},
						});
				}
			});
		});
		const stop = Effect.callback<void>((resume) => {
			for (const socket of open) socket.destroy();
			server.close(() => resume(Effect.void));
		});
		yield* Effect.callback<void>((resume) => {
			server.listen(path, () => resume(Effect.void));
		});
		yield* Effect.addFinalizer(() => (server.listening ? stop : Effect.void));
		return {conns, stop};
	});

/** The client's own first two messages, as the SDK's `Client.connect` sends them (era 2025). */
const INITIALIZE = {
	jsonrpc: "2.0",
	id: 0,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: {name: "claude-code", version: "2.1.0"},
	},
};
const INITIALIZED = {jsonrpc: "2.0", method: "notifications/initialized"};
const call = (id: number) => ({
	jsonrpc: "2.0",
	id,
	method: "tools/call",
	params: {name: "runs", arguments: {}},
});

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)));

const socketPath = Effect.gen(function* () {
	const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "br-"});
	return `${dir}/mcp.sock`;
});

describe("the bridge, when the host ends and another listens (d20)", () => {
	it(
		"says one handshake to the new host, replays initialize and initialized, drops the second answer, and says the tools changed",
		async () => {
			const seen = await go(
				Effect.gen(function* () {
					const path = yield* socketPath;
					const first = yield* recordingHost(path, "host 1");
					const client = yield* clientEnd;
					const running = yield* bridgeOn(path, client.stdio);
					client.say(INITIALIZE);
					yield* until("the answer to initialize", () =>
						client.heard.find((m) => field(m, "id") === 0),
					);
					client.say(INITIALIZED);
					client.say(call(1));
					yield* until("host 1's answer to 1", () =>
						client.heard.find((m) => field(m, "id") === 1),
					);

					yield* first.stop;
					const second = yield* recordingHost(path, "host 2");
					yield* until("the notice that the tools changed", () =>
						client.heard.find((m) => field(m, "method") === "notifications/tools/list_changed"),
					);
					client.say(call(3));
					const answer = yield* until("the answer to 3", () =>
						client.heard.find((m) => field(m, "id") === 3),
					);
					// A moment more, so a second answer to initialize said late is caught too.
					yield* Effect.sleep("100 millis");
					const ended = running.pollUnsafe() !== undefined;
					return {
						first: first.conns,
						second: second.conns,
						heard: [...client.heard],
						answer,
						ended,
					};
				}),
			);
			// One connection to each host, each opened by one handshake that names the agent.
			expect(seen.first).toHaveLength(1);
			expect(seen.second).toHaveLength(1);
			const [again = []] = seen.second;
			expect(again.filter((m) => field(m, "type") === "handshake")).toEqual([
				{type: "handshake", version: AGENTS_PROTOCOL, agent: "claude"},
			]);
			// Then the client's initialize, as it said it, and its initialized, before anything else.
			expect(again[0]).toMatchObject({type: "handshake"});
			expect(again[1]).toMatchObject({method: "initialize", params: INITIALIZE.params});
			expect(again[2]).toEqual(INITIALIZED);
			expect(again.filter((m) => field(m, "method") === "initialize")).toHaveLength(1);
			// The client heard one answer to its initialize, host 1's, and no answer to an id it never
			// sent: the new host's answer to the replay was dropped.
			const answers = seen.heard.filter((m) => field(m, "id") !== undefined);
			expect(answers.filter((m) => field(m, "id") === 0)).toHaveLength(1);
			expect(answers.find((m) => field(m, "id") === 0)).toMatchObject({
				result: {serverInfo: {name: "host 1"}},
			});
			expect(answers.map((m) => field(m, "id"))).toEqual([0, 1, 3]);
			// The notice came before the answer to the call made after it, and the new host answered.
			const notice = seen.heard.findIndex(
				(m) => field(m, "method") === "notifications/tools/list_changed",
			);
			expect(notice).toBeLessThan(seen.heard.indexOf(seen.answer));
			expect(seen.answer).toMatchObject({result: {content: [{type: "text", text: "host 2"}]}});
			// And the bridge is still running: the client never lost it.
			expect(seen.ended).toBe(false);
		},
		LONG,
	);
});

describe("a call while no host answers (d21)", () => {
	it(
		"is answered at once with a JSON-RPC error that says why, and never reaches the next host",
		async () => {
			const seen = await go(
				Effect.gen(function* () {
					const path = yield* socketPath;
					const first = yield* recordingHost(path, "host 1");
					const client = yield* clientEnd;
					yield* bridgeOn(path, client.stdio);
					client.say(INITIALIZE);
					yield* until("the answer to initialize", () =>
						client.heard.find((m) => field(m, "id") === 0),
					);
					client.say(INITIALIZED);

					yield* first.stop;
					// A moment for the bridge to see the socket end: a local socket's end is heard in well
					// under a millisecond.
					yield* Effect.sleep("50 millis");
					client.say(call(2));
					// No host listens yet: the answer cannot wait for one.
					const answer = yield* until("the answer to 2", () =>
						client.heard.find((m) => field(m, "id") === 2),
					);
					const second = yield* recordingHost(path, "host 2");
					yield* until("the notice that the tools changed", () =>
						client.heard.find((m) => field(m, "method") === "notifications/tools/list_changed"),
					);
					client.say(call(3));
					yield* until("the answer to 3", () => client.heard.find((m) => field(m, "id") === 3));
					return {answer, second: second.conns.flat()};
				}),
			);
			expect(seen.answer).toMatchObject({jsonrpc: "2.0", id: 2});
			expect(field(seen.answer, "result")).toBeUndefined();
			const error = field(seen.answer, "error");
			expect(typeof field(error, "code")).toBe("number");
			expect(String(field(error, "message"))).toContain("the host is restarting");
			// The call was answered, so it is not sent again later: the next host hears only the one
			// after it.
			const calls = seen.second.filter((m) => field(m, "method") === "tools/call");
			expect(calls.map((m) => field(m, "id"))).toEqual([3]);
		},
		LONG,
	);
});

describe("no host within the wait (d21)", () => {
	it(
		"ends the bridge with why, once the wait is over",
		async () => {
			const seen = await go(
				Effect.gen(function* () {
					const path = yield* socketPath;
					const first = yield* recordingHost(path, "host 1");
					const client = yield* clientEnd;
					const running = yield* bridgeOn(path, client.stdio);
					client.say(INITIALIZE);
					yield* until("the answer to initialize", () =>
						client.heard.find((m) => field(m, "id") === 0),
					);
					client.say(INITIALIZED);
					const stopped = Date.now();
					yield* first.stop;
					const exit = yield* Fiber.await(running).pipe(
						Effect.timeoutOrElse({
							duration: "5 seconds",
							orElse: () => Effect.die("the bridge waited past its wait"),
						}),
					);
					return {exit, took: Date.now() - stopped};
				}),
			);
			// It tried for about the wait it was handed: a bridge that ends as the socket ends, today's,
			// fails here. Less two of its longest gaps, as a last try may be skipped that would land past it.
			expect(seen.took).toBeGreaterThanOrEqual(WAIT.maxElapsedMs - 2 * WAIT.capMs);
			expect(Exit.isFailure(seen.exit)).toBe(true);
			const error = Exit.isFailure(seen.exit) ? Cause.squash(seen.exit.cause) : null;
			expect(error).toMatchObject({_tag: "BridgeStopped"});
			// The why is what cli.ts writes to stderr: it says the host did not come back.
			expect(String(field(error, "why"))).toMatch(/host/);
		},
		LONG,
	);
});

/**
 * The MCP SDK's own client on the bridge's stdin and stdout, as Claude Code would hold them: a
 * transport that writes each message as a line, and hands it each line the bridge writes.
 */
const sdkClientOn = (client: Effect.Success<typeof clientEnd>, changed: unknown[][]) =>
	Effect.gen(function* () {
		const errors: Error[] = [];
		let seen = 0;
		const transport: Transport = {
			start: async () => {},
			send: async (message: JSONRPCMessage) => {
				client.say(message);
			},
			close: async () => {},
		};
		const sdk = new Client(
			{name: "claude-code", version: "2.1.0"},
			{
				listChanged: {
					tools: {debounceMs: 0, onChanged: (_, tools) => changed.push(tools ?? [])},
				},
			},
		);
		// Pass each line the bridge wrote on to the SDK, in order, as they come.
		yield* Effect.gen(function* () {
			while (true) {
				while (seen < client.heard.length) {
					const message = client.heard[seen] as JSONRPCMessage;
					seen += 1;
					transport.onmessage?.(message);
				}
				yield* Effect.sleep("2 millis");
			}
		}).pipe(Effect.forkScoped);
		yield* Effect.acquireRelease(
			Effect.promise(async () => {
				await sdk.connect(transport);
				sdk.onerror = (e) => errors.push(e);
			}).pipe(
				Effect.timeoutOrElse({
					duration: "5 seconds",
					orElse: () => Effect.die("the client's initialize was not answered"),
				}),
			),
			() => Effect.promise(() => sdk.close()).pipe(Effect.ignore),
		);
		return {sdk, errors};
	});

/** The agents' host, `serveAgent`, on `path`, in its own scope: closed, it stops. */
const agentsHost = (path: string) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const server = yield* NodeSocketServer.make({path}).pipe(Scope.provide(scope));
		yield* server
			.run((socket) =>
				serveAgent(socket, {
					person: "owner",
					programsFor: () => Effect.succeed({list: programList(SMALL), readOnly: null}),
					tiles: () => [],
				}).pipe(Effect.ignore),
			)
			.pipe(Effect.forkIn(scope));
		yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
		return {stop: Scope.close(scope, Exit.void)};
	});

describe("an MCP client on the bridge, across a host restart (d20)", () => {
	it(
		"keeps its tools: it is told they changed, its calls go on, and the new host hears who it is",
		async () => {
			const lines: string[] = [];
			const caught = Logger.make((o) => {
				lines.push(Logger.formatSimple.log(o));
			});
			const seen = await go(
				Effect.gen(function* () {
					const path = yield* socketPath;
					const first = yield* agentsHost(path);
					const client = yield* clientEnd;
					yield* bridgeOn(path, client.stdio);
					const changed: unknown[][] = [];
					const {sdk, errors} = yield* sdkClientOn(client, changed);
					const before = yield* Effect.promise(() => sdk.callTool({name: "runs", arguments: {}}));

					yield* first.stop;
					yield* agentsHost(path);
					const tools = yield* until("the client's new list of tools", () => changed[0]);
					const after = yield* Effect.promise(() => sdk.callTool({name: "runs", arguments: {}}));
					return {before, after, tools, errors: [...errors]};
				}).pipe(Effect.provide(Logger.layer([caught]))),
			);
			expect(seen.before.isError).toBeFalsy();
			expect(seen.after.isError).toBeFalsy();
			// The SDK refreshed the list on the notice, from the new host.
			expect(seen.tools.map((t) => field(t, "name"))).toContain("runs");
			// The SDK saw nothing it could not place, such as an answer to an id it never sent.
			expect(seen.errors).toEqual([]);
			// Each host heard the client's initialize first, so each names the client in its line.
			const came = lines.filter((l) => l.includes("message=agent_came"));
			expect(came).toHaveLength(2);
			for (const line of came) expect(line).toContain("client=claude-code");
		},
		LONG,
	);
});
