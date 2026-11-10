import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Shell, Traces} from "@kampus/fabrika-old";
import {callOf, toolsOf} from "@kampus/fabrika-old/mcp";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Client, type ClientOptions} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Path, Schedule, Scope} from "effect";
import {describe, expect, it} from "vitest";
import type {Down} from "../link.ts";
import {readToPage} from "../messages.ts";
import {appPrograms} from "../tsh.ts";
import {appWire} from "../wire.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

// An agent drives the tracker the person watches, through MCP, end to end: a host on a home of
// the test's own, an app attached with `tracker` running in its tile, and an MCP client that
// starts the bridge (`cli.ts mcp`) as Claude Code would. The ticket the agent files shows in the
// person's tile, written as the agent; the agent cannot answer an ask, and cannot name a person.
// No real home and no real ledger: each test makes its own home, and its host stops with it.

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** Wait for `check` to answer something, a few seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 2000; i += 1) {
			const got = check();

			if (got !== undefined) {
				return got;
			}

			yield* Effect.sleep("5 millis");
		}

		return yield* Effect.die(`waited for ${what}`);
	});

/** A host on a fresh home, with the app attached and `tracker` run in its first tile. */
const trackerInTile = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "ag-"});
	const paths = yield* pathsOf(home);
	const host = yield* Scope.make();
	yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(host));
	yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
	yield* reach(paths.mcp).pipe(
		Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("5 millis")}),
		Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.die("no agents' socket")}),
	);

	const got: Down[] = [];
	const wire = yield* appWire(yield* NodeSocket.makeNet({path: paths.sock}), (m) => got.push(m));
	yield* wire.up;
	wire.send({type: "page"});
	yield* until("tile t1", () => got.find((m) => m.type === "port" && m.port === "tile:t1"));
	wire.send({type: "on", port: "tile:t1", m: {type: "keys", data: "tracker\r"}});
	const port = yield* until("the tracker's window", () => {
		const m = got.find((m) => m.type === "port" && m.port.startsWith("run:tracker:"));
		return m?.type === "port" ? m.port : undefined;
	});
	/** What the person's tracker window shows now. */
	const shown = (): Record<string, unknown> | undefined => {
		const last = got.findLast((m) => m.type === "to" && m.port === port);

		if (last?.type !== "to") {
			return undefined;
		}

		return Reflect.get(Object(last.m), "data") as Record<string, unknown>;
	};
	/** A click in the person's window: one input's value, as the window sends it. */
	const click = (type: string, value: unknown) =>
		wire.send({type: "on", port, m: {type: "msg", msg: {type, value}}});
	/** The agents the top bar was told of last, by name. */
	const agentsNow = () => {
		const last = got
			.flatMap((m) => {
				if (m.type !== "to" || m.port !== "desk") {
					return [];
				}

				const read = readToPage(m.m);
				return read.kind === "read" && read.msg.type === "host" ? [read.msg.now] : [];
			})
			.at(-1);
		return last?.agents?.map((a) => a.name);
	};
	return {home, paths, shown, click, agentsNow};
});

/**
 * An MCP client, on the bridge Claude Code would start: `node cli.ts mcp --as <agent>`, with the
 * SDK client's own `options`, such as what it does when the tools change.
 */
const agentOn = (home: string, agent: string, options?: ClientOptions) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cli, "mcp", "--as", agent],
			env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
			stderr: "pipe",
		});
		let stderr = "";
		transport.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const client = new Client({name: "test", version: "0.0.0"}, options);
		// A bridge that ends before MCP is up fails with what it said on stderr.
		yield* Effect.acquireRelease(
			Effect.tryPromise({try: () => client.connect(transport), catch: () => ({stderr})}),
			() => Effect.promise(() => client.close()).pipe(Effect.ignore),
		);
		const call = (name: string, args: Record<string, unknown>) =>
			Effect.promise(() => client.callTool({name, arguments: args}));
		return {client, call};
	});

const textOf = (result: {readonly content?: unknown}): string => {
	const first = Array.isArray(result.content) ? result.content[0] : undefined;
	return String(Reflect.get(Object(first), "text"));
};

const pageOf = (shown: Record<string, unknown> | undefined) =>
	Reflect.get(Object(shown), "page") as Record<string, unknown> | undefined;

/** The tools of the app's programs, as an agent's list holds them. Nothing runs. */
const agentsList = () =>
	Shell.programList(
		appPrograms(
			memoryService(),
			{kind: "agent", id: "claude", for: "owner"},
			{open: Effect.succeed([])},
			Effect.runSync(
				Effect.gen(function* () {
					return yield* Traces;
				}).pipe(Effect.provide(memoryTraces([]))),
			),
		),
	);

describe("an agent's tools", () => {
	it("are the tracker's inputs, one tool each: each write, a read-only query, quit, and no answer", () => {
		const tools = toolsOf(agentsList());
		expect(tools.map((t) => t.name).filter((n) => n.startsWith("tracker_"))).toEqual([
			"tracker_file",
			"tracker_comment",
			"tracker_close",
			"tracker_reopen",
			"tracker_query",
			"tracker_quit",
		]);
		const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
		expect(hints).toMatchObject({
			runs: true,
			tracker_query: true,
			tracker_file: undefined,
			tracker_close: undefined,
		});

		// An input only a person tells has no tool, so a call to it is refused as any unknown tool is.
		for (const name of ["tracker_answer", "tracker_rate_duplicate", "ticket_answer"]) {
			expect(callOf(agentsList(), name, {value: {}})).toEqual({
				kind: "refused",
				why: `there is no tool ${name}`,
			});
		}

		// A call tells the input of the same name its value, as it is.
		expect(callOf(agentsList(), "tracker_query", {value: {ticket: 43}})).toEqual({
			kind: "input",
			program: "tracker",
			input: "query",
			value: {ticket: 43},
		});
		expect(callOf(agentsList(), "tracker_quit", {value: null})).toEqual({
			kind: "input",
			program: "tracker",
			input: "quit",
			value: null,
		});
		// The input already names the command: a value that names one too does not fit.
		expect(
			callOf(agentsList(), "tracker_close", {value: {kind: "close", ticket: 1}}),
		).toMatchObject({kind: "refused"});
	});
});

describe("an agent drives the app's programs through MCP", () => {
	it("lists the tools from the programs' inputs, and files a ticket the person's tile shows, as the agent", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const app = yield* trackerInTile;
				const mode = (yield* fs.stat(app.paths.mcp)).mode & 0o777;
				const agent = yield* agentOn(app.home, "claude");
				const tools = yield* Effect.promise(() => agent.client.listTools());
				const fileTool = tools.tools.find((t) => t.name === "tracker_file");
				const queryTool = tools.tools.find((t) => t.name === "tracker_query");

				const filed = yield* agent.call("tracker_file", {
					value: {title: "Filed by an agent", body: "Under #44."},
				});
				// The person's window, which nobody typed in, lists it within the tracker's poll.
				const listed = yield* until("the ticket in the tile", () => {
					const page = pageOf(app.shown());
					const tickets = page?.kind === "list" ? (page.tickets as {title: string}[]) : [];
					return tickets.find((t) => t.title === "Filed by an agent");
				});
				app.click("query", {ticket: 1});
				const rows = yield* until("ticket 1's page", () => {
					const page = pageOf(app.shown());
					const opened =
						page?.kind === "ticket" ? Reflect.get(Object(page.opened), "rows") : undefined;
					return Array.isArray(opened) && opened.length > 0 ? opened : undefined;
				});
				const runs = JSON.parse(textOf(yield* agent.call("runs", {})));
				return {mode, tools, fileTool, queryTool, filed, listed, rows, runs};
			}),
		);
		expect(seen.mode).toBe(0o600);
		// The programs' inputs and no more: no desk word (split, zoom, agents) moves the person's desk.
		expect(seen.tools.tools.map((t) => t.name)).toEqual([
			"runs",
			"job",
			"stop",
			"restart",
			"line",
			"counter_press",
			"tracker_file",
			"tracker_comment",
			"tracker_close",
			"tracker_reopen",
			"tracker_query",
			"tracker_quit",
			// The ticket's own commands, one input each, and no `ticket_answer`.
			"ticket_comment",
			"ticket_close",
			"ticket_reopen",
			"ticket_quit",
			// A ticket to show: what a pipe from the tracker sends, an agent can send too.
			"ticket_ticket",
			"map_quit",
			// The trace: a job's rows, a ticket's replay, and a job or a ticket to show.
			"trace_toggle",
			"trace_choose",
			"trace_seek",
			"trace_step",
			"trace_quit",
			"trace_id",
			"trace_ticket",
			// The experiments programs take no input; markdown takes a text and a quit.
			"markdown_text",
			"markdown_quit",
		]);
		// The tool is the input: its description and its fields are the tracker's own `file`.
		expect(seen.fileTool?.description).toMatch(/^File a new ticket/);
		expect(seen.fileTool?.inputSchema).toMatchObject({
			type: "object",
			required: ["value"],
			properties: {value: {type: "object", required: ["title", "body"]}},
		});
		expect(seen.fileTool?.annotations?.readOnlyHint).toBeUndefined();
		// The query only reads, and says so in MCP's own hint, through the SDK as a client sees it.
		expect(seen.queryTool?.annotations).toEqual({readOnlyHint: true});
		expect(seen.filed.isError).not.toBe(true);
		expect(seen.listed).toMatchObject({number: 1, title: "Filed by an agent", state: "open"});
		expect(seen.rows[0]).toMatchObject({
			type: "filed",
			by: {kind: "agent", id: "claude", for: "owner"},
		});
		expect(seen.runs.tiles).toEqual([
			{run: expect.stringMatching(/^tracker:/), program: "tracker"},
		]);
		expect(seen.runs.yours).toMatchObject([{program: "tracker"}]);
		expect(seen.runs.programs).toContainEqual(
			expect.objectContaining({
				name: "tracker",
				tools: expect.not.arrayContaining(["tracker_answer"]),
			}),
		);
	});

	it("never writes as the person: an agent has no answer tool, and a handshake cannot name a user", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const app = yield* trackerInTile;
				const agent = yield* agentOn(app.home, "claude");
				yield* agent.call("tracker_file", {value: {title: "Needs a yes", body: ""}});
				// `answer` is a case only a person sends: the agent has no tool for it at all.
				const answer = yield* agent.call("tracker_answer", {
					value: {
						ticket: 1,
						ask: "a1",
						pick: "yes",
						note: "",
						saw: {title: "Needs a yes", body: ""},
					},
				});
				// A value that does not fit the input's schema never reaches the program.
				const bad = yield* agent.call("tracker_file", {value: {title: 3}});
				app.click("query", {ticket: 1});
				const rows = yield* until("ticket 1's page", () => {
					const page = pageOf(app.shown());
					const opened =
						page?.kind === "ticket" ? Reflect.get(Object(page.opened), "rows") : undefined;
					return Array.isArray(opened) && opened.length > 0 ? opened : undefined;
				});
				// A bridge whose name is a person's: the host refuses its handshake, and the bridge says why and ends.
				const asUser = yield* agentOn(app.home, "user:owner").pipe(
					Effect.scoped,
					Effect.as("connected"),
					Effect.catch((e) => Effect.succeed(e.stderr)),
				);
				return {answer, bad, rows, asUser};
			}),
		);
		expect(seen.answer.isError).toBe(true);
		expect(textOf(seen.answer)).toMatch(/there is no tool tracker_answer/);
		expect(seen.bad.isError).toBe(true);
		expect(textOf(seen.bad)).toMatch(/does not fit/);
		expect(seen.rows.map((r: {type: string}) => r.type)).toEqual(["filed"]);
		expect(seen.asUser).toMatch(/fabrika mcp: .*never a person's/);
	});

	it("is counted in the top bar while attached, and the count goes down as it goes", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const app = yield* trackerInTile;
				const before = app.agentsNow();
				const two = yield* Effect.gen(function* () {
					yield* agentOn(app.home, "claude");
					yield* agentOn(app.home, "codex");
					return yield* until("two agents", () => {
						const now = app.agentsNow();
						return now?.length === 2 ? now : undefined;
					});
				}).pipe(Effect.scoped);
				const after = yield* until("none", () => {
					const now = app.agentsNow();
					return now?.length === 0 ? now : undefined;
				});
				return {before, two, after};
			}),
		);
		expect(seen.before).toEqual([]);
		expect(seen.two).toEqual(["claude", "codex"]);
		expect(seen.after).toEqual([]);
	});
});

/** A host on a fresh home's path, with no app, in its own scope: closed, it stops. */
const hostOn = (home: string) =>
	Effect.gen(function* () {
		const paths = yield* pathsOf(home);
		const host = yield* Scope.make();
		yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(host));
		yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
		yield* reach(paths.mcp).pipe(
			Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("5 millis")}),
			Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.die("no agents' socket")}),
		);
		return {stop: Scope.close(host, Exit.void)};
	});

// The bridge outlives the host (tracker 185b, PR 4). The window's "Stop the old host and start this
// one" and `fabrika connect` each end the host; the bridge Claude Code started (`cli.ts mcp`) stays,
// dials `<home>/host/mcp` again on the app's own wait (reconnect.ts POLICY), and tells the client
// its tools changed. A call while no host answers is a JSON-RPC error that says why: the spec's
// protocol error for a server error (2025-11-25, "Tools", Error Handling), so the client does not
// wait out its timeout. Here the host stops and starts again in this process, on the same home.
describe("the bridge Claude Code started, across a host restart", () => {
	it("keeps the agent's tools: a call in the gap says why, the tools are listed again, and calls go on", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "ag-"});
				const first = yield* hostOn(home);
				const changed: unknown[][] = [];
				const agent = yield* agentOn(home, "claude", {
					listChanged: {tools: {debounceMs: 0, onChanged: (_, tools) => changed.push(tools ?? [])}},
				});
				const before = yield* agent.call("runs", {});

				yield* first.stop;
				// A moment for the bridge to see the socket end.
				yield* Effect.sleep("100 millis");
				const gap = yield* Effect.tryPromise({
					try: () => agent.client.callTool({name: "runs", arguments: {}}),
					catch: (e) => String(Reflect.get(Object(e), "message")),
				}).pipe(
					Effect.flip,
					Effect.timeoutOrElse({
						duration: "5 seconds",
						orElse: () => Effect.die("the call in the gap was not answered"),
					}),
				);
				yield* hostOn(home);
				const tools = yield* until("the client's new list of tools", () => changed[0]);
				const after = yield* agent.call("runs", {});
				return {before, gap, tools, after};
			}),
		);
		expect(seen.before.isError).toBeFalsy();
		expect(seen.gap).toContain("the host is restarting");
		expect(seen.tools.map((t) => Reflect.get(Object(t), "name"))).toContain("runs");
		expect(seen.after.isError).toBeFalsy();
	}, 30_000);
});
