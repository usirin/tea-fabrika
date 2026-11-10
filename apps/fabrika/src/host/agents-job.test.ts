import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {LAST_MAX} from "@kampus/fabrika-old/mcp";
import {Client, type JSONRPCMessage} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Logger, Path, Schedule, Scope} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {Down} from "../link.ts";
import {appWire} from "../wire.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

// An agent reads the host: one tile job's state and its last lines, through the read-only `job`
// tool beside `runs`, as tmux's `capture-pane` and `list-panes` read a pane. And the host's log
// says what ran: one wide `key=value` line as each job begins and ends, and one when the host's
// thread is starved. Today's version, on a home of the test's own, its host in this process.
//
//   tile t1     tsh$ seq --to 5          prints 1 to 5; the line is job %1, and it ends done
//   agent       job {n: 1, last: 2}
//               {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"},
//                lines: ["4", "5"]}
//   host/log    timestamp=... level=INFO fiber=#.. message=job_began n=1 "text=seq --to 5" tile=t1 by=user:owner
//               timestamp=... level=INFO fiber=#.. message=job_ended n=1 ... tile=t1 how=done by=user:owner
//
// Each line says who started the job (`by`, tracker 185), and a stop says who asked it:
//
//   tile t1     tsh$ counter &   then   tsh$ stop %1
//   host/log    message=job_stopped n=1 by=user:owner        a person's own stop gives no why
//
// And each agent's own moves (tracker 185b, PR 1, record wide): one line as an agent comes, with
// the client its `initialize` named, and one line per tool call, done or refused, with the call's
// JSON-RPC id, so a line matches the agent's own transcript later. A refused call leaves no other
// trace.
//
//   host/log    message=agent_came agent=claude client=test version=0.0.0
//               message=tool_called agent=claude tool=runs call=2 took_ms=3 ok=true
//               message=tool_called agent=claude tool=job call=3 took_ms=0 "refused=there is no job 99 ..."
//
// Every log line the host writes is caught here through Effect's own `Logger`, in the format the
// host's file uses (`Logger.formatSimple`, host/main.ts). No real home and no real ledger.

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** Wait for `check` to answer something, ten seconds at most. */
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

/** One log line's `key=value` fields, as `Logger.formatSimple` writes them, quotes taken off. */
const fieldsOf = (line: string): Record<string, string> => {
	const out: Record<string, string> = {};

	for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		const [, key = "", raw = ""] = m;
		out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
	}

	return out;
};

/** The host's file, as host/main.ts writes it with `Logger.toFile`: each line, then a newline. */
const fileOf = (lines: readonly string[]) => lines.join("\n").split("\n");

/**
 * A line's own message: its first `message=` field. One inside a quoted value is the agent's
 * words, kept as words.
 */
const messageOf = (line: string): string | undefined => {
	for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		if (m[1] === "message") {
			return m[2];
		}
	}

	return undefined;
};

/** The lines whose message is `message`, read as fields. */
const said = (lines: readonly string[], message: string) =>
	lines.map(fieldsOf).filter((f) => f.message === message);

/** A host on `home`, its log caught in `lines`, and the app attached with its page loaded. */
const hostOn = (home: string, lines: string[]) =>
	Effect.gen(function* () {
		const paths = yield* pathsOf(home);
		// A child of the test's scope: the host stops before the test's temp home is removed. A
		// scope of its own outlived the test, and a job still writing in `storage/jobs` made the
		// home's removal fail with ENOTEMPTY.
		const host = yield* Scope.fork(yield* Effect.scope);
		const caught = Logger.make((o) => {
			lines.push(Logger.formatSimple.log(o));
		});
		yield* runHost({home, pid: process.pid}).pipe(
			Effect.scoped,
			Effect.provide(Logger.layer([caught])),
			Effect.forkIn(host),
		);
		yield* reach(paths.mcp).pipe(
			Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("5 millis")}),
			Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.die("no agents' socket")}),
		);
		const got: Down[] = [];
		const wire = yield* appWire(yield* NodeSocket.makeNet({path: paths.sock}), (m) => got.push(m));
		yield* wire.up;
		wire.send({type: "page"});
		yield* until("tile t1", () => got.find((m) => m.type === "port" && m.port === "tile:t1"));
		/** Keys typed in tile t1's terminal. */
		const type = (data: string) =>
			wire.send({type: "on", port: "tile:t1", m: {type: "keys", data}});
		return {paths, type, stop: Scope.close(host, Exit.void)};
	});

/**
 * An MCP client, on the bridge Claude Code would start: `node cli.ts mcp --as <agent>`. `named`:
 * the name and version its `initialize` gives.
 */
const agentOn = (home: string, agent: string, named = {name: "test", version: "0.0.0"}) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cli, "mcp", "--as", agent],
			env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
			stderr: "pipe",
		});
		/** Each JSON-RPC message the client sent, as it went: a tool call's id is the log line's `call`. */
		const sent: JSONRPCMessage[] = [];
		const send = transport.send.bind(transport);
		transport.send = (message) => {
			sent.push(message);
			return send(message);
		};
		const client = new Client(named);
		yield* Effect.acquireRelease(
			Effect.promise(() => client.connect(transport)),
			() => Effect.promise(() => client.close()).pipe(Effect.ignore),
		);
		/** Every text the agent was answered, kept for the secrets check. */
		const heard: string[] = [];
		const call = (name: string, args: Record<string, unknown>) =>
			Effect.promise(() => client.callTool({name, arguments: args})).pipe(
				Effect.map((result) => {
					const first = Array.isArray(result.content) ? result.content[0] : undefined;
					const text = String(Reflect.get(Object(first), "text"));
					heard.push(text);
					return {error: result.isError === true, text};
				}),
			);
		const tools = Effect.promise(() => client.listTools()).pipe(
			Effect.tap((t) => Effect.sync(() => heard.push(JSON.stringify(t)))),
		);
		/** The job tool's answer once `ok` holds of it: the job runs on its own time. */
		const jobWhen = (
			args: Record<string, unknown>,
			ok: (data: Record<string, unknown>) => boolean,
		) =>
			Effect.gen(function* () {
				const listed = (yield* tools).tools.some((t) => t.name === "job");

				if (!listed) {
					return yield* Effect.die("the agent has no job tool");
				}

				for (let i = 0; i < 400; i += 1) {
					const answer = yield* call("job", args);

					if (!answer.error) {
						const data = JSON.parse(answer.text) as Record<string, unknown>;

						if (ok(data)) {
							return data;
						}
					}

					yield* Effect.sleep("25 millis");
				}

				return yield* Effect.die(`job ${JSON.stringify(args)} never came to what was waited for`);
			});
		/** The ids of the tool calls the client sent, in order. */
		const callIds = () =>
			sent.flatMap((m) =>
				"method" in m && m.method === "tools/call" && "id" in m ? [String(m.id)] : [],
			);
		return {client, call, tools, jobWhen, heard, callIds};
	});

const tagOf = (data: Record<string, unknown>) => Reflect.get(Object(data.state), "_tag");

const freshHome = Effect.gen(function* () {
	return yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "aj-"});
});

describe("the job tool: one tile job's state and its last lines", () => {
	it("is listed beside runs, read-only, and takes a job's number and how many lines", async () => {
		const tool = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				return (yield* agent.tools).tools.find((t) => t.name === "job");
			}),
		);
		expect(tool?.annotations?.readOnlyHint).toBe(true);
		expect(tool?.inputSchema).toMatchObject({
			type: "object",
			required: ["n"],
			properties: {n: {type: "integer"}, last: {type: "integer", maximum: LAST_MAX}},
		});
	});

	it("gives an ended job's how and its last n lines, a running job's tile, and refuses what is not there", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				host.type("seq --to 5\r");
				const ended = yield* agent.jobWhen({n: 1, last: 2}, (d) => tagOf(d) === "ended");
				const all = yield* agent.jobWhen({n: 1}, (d) => tagOf(d) === "ended");
				host.type("counter &\r");
				const running = yield* agent.jobWhen({n: 2}, (d) => tagOf(d) === "running");
				const unknown = yield* agent.call("job", {n: 99});
				const tooMany = yield* agent.call("job", {n: 1, last: LAST_MAX + 1});
				const none = yield* agent.call("job", {n: 1, last: 0});
				return {ended, all, running, unknown, tooMany, none};
			}),
		);
		expect(seen.ended).toEqual({
			n: 1,
			text: "seq --to 5",
			tile: "t1",
			state: {_tag: "ended", how: "done"},
			lines: ["4", "5"],
		});
		expect(seen.all.lines).toEqual(["1", "2", "3", "4", "5"]);
		expect(seen.running).toMatchObject({
			n: 2,
			text: expect.stringMatching(/^counter/),
			tile: "t1",
			state: {_tag: "running"},
		});
		// A plain error, in words, for a job the host does not know.
		expect(seen.unknown.error).toBe(true);
		expect(seen.unknown.text).toMatch(/\b99\b/);
		// The count of lines is bounded, and asked past it is refused by the tool's own schema.
		expect(seen.tooMany.error).toBe(true);
		expect(seen.tooMany.text).toMatch(/last/);
		expect(seen.none.error).toBe(true);
	});

	it("says a job from before the host restarted is detached", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const first = yield* hostOn(home, []);
				const before = yield* Effect.gen(function* () {
					const agent = yield* agentOn(home, "claude");
					first.type("counter &\r");
					return yield* agent.jobWhen({n: 1}, (d) => tagOf(d) === "running");
				}).pipe(Effect.scoped);
				yield* first.stop;
				yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				const after = yield* agent.jobWhen({n: 1}, (d) => tagOf(d) !== "running");
				return {before, after};
			}),
		);
		expect(seen.before).toMatchObject({n: 1, state: {_tag: "running"}});
		expect(seen.after).toMatchObject({
			n: 1,
			text: expect.stringMatching(/^counter/),
			state: {_tag: "detached"},
		});
	});
});

describe("the host's wide log", () => {
	it("writes one line as a job begins and one as it ends, with how and who started it", async () => {
		const lines: string[] = [];
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				host.type("seq --to 3\r");
				yield* until("the job's end in the log", () =>
					said(lines, "job_ended").length > 0 ? true : undefined,
				);
			}),
		);
		const began = said(lines, "job_began");
		const ended = said(lines, "job_ended");
		expect(began).toHaveLength(1);
		expect(ended).toHaveLength(1);
		// A home with its own file: its one person is the owner, and the line in tile t1 is theirs.
		expect(began[0]).toMatchObject({
			level: "INFO",
			n: "1",
			text: "seq --to 3",
			tile: "t1",
			by: "user:owner",
		});
		expect(ended[0]).toMatchObject({
			level: "INFO",
			n: "1",
			text: "seq --to 3",
			tile: "t1",
			how: "done",
			by: "user:owner",
		});
		expect(began[0]?.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
		// It ended on its own: nobody asked it to stop.
		expect(said(lines, "job_stopped")).toEqual([]);
	});

	it("writes one line as a person stops a job: its number and who asked", async () => {
		const lines: string[] = [];
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				host.type("counter &\r");
				yield* until("the job's start in the log", () =>
					said(lines, "job_began").length > 0 ? true : undefined,
				);
				host.type("stop %1\r");
				yield* until("the job's end in the log", () =>
					said(lines, "job_ended").length > 0 ? true : undefined,
				);
			}),
		);
		const stopped = said(lines, "job_stopped");
		expect(stopped).toHaveLength(1);
		expect(stopped[0]).toMatchObject({level: "INFO", n: "1", by: "user:owner"});
		// A person's own stop gives no reason: `why` is not known, so it says none.
		expect(stopped[0]?.why === undefined || stopped[0]?.why === "null").toBe(true);
		expect(said(lines, "job_ended")[0]).toMatchObject({n: "1", how: "stopped", by: "user:owner"});
		// The stop is said before the end it asked for.
		const at = (message: string) => lines.findIndex((l) => fieldsOf(l).message === message);
		expect(at("job_stopped")).toBeLessThan(at("job_ended"));
	});

	it("writes one agent_came line as an agent comes, with the client its initialize named", async () => {
		const lines: string[] = [];
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				yield* agent.tools;
				yield* until("agent_came in the log", () =>
					said(lines, "agent_came").length > 0 ? true : undefined,
				);
			}),
		);
		const came = said(lines, "agent_came");
		expect(came).toHaveLength(1);
		// The test's client names itself {name: "test", version: "0.0.0"}, as Claude Code names itself.
		expect(came[0]).toMatchObject({
			level: "INFO",
			agent: "claude",
			client: "test",
			version: "0.0.0",
		});
	});

	it("writes agent_came with no client when the agent's first message is not initialize, and still answers it", async () => {
		const lines: string[] = [];
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				const path = yield* Path.Path;
				const cli = yield* path
					.fromFileUrl(new URL("../cli.ts", import.meta.url))
					.pipe(Effect.orDie);
				// The bridge with no MCP client on it: the test says each JSON-RPC message itself, as a
				// client of spec 2026-07-28 does, with no `initialize` first.
				const transport = new StdioClientTransport({
					command: process.execPath,
					args: [cli, "mcp", "--as", "claude"],
					env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
					stderr: "pipe",
				});
				const heard: JSONRPCMessage[] = [];
				transport.onmessage = (message) => {
					heard.push(message);
				};
				yield* Effect.acquireRelease(
					Effect.promise(() => transport.start()),
					() => Effect.promise(() => transport.close()).pipe(Effect.ignore),
				);
				const answerTo = (id: number) =>
					until(`the answer to ${id}`, () => heard.find((m) => "id" in m && m.id === id));
				// JSON-RPC lets a request leave `params` out, and this one does.
				yield* Effect.promise(() => transport.send({jsonrpc: "2.0", id: 1, method: "tools/list"}));
				const listed = yield* answerTo(1);
				yield* Effect.promise(() =>
					transport.send({
						jsonrpc: "2.0",
						id: 2,
						method: "tools/call",
						params: {name: "runs", arguments: {}},
					}),
				);
				const called = yield* answerTo(2);
				yield* until("agent_came in the log", () =>
					said(lines, "agent_came").length > 0 ? true : undefined,
				);
				yield* until("the call's line", () =>
					said(lines, "tool_called").length > 0 ? true : undefined,
				);
				return {listed, called};
			}),
		);
		// Both were answered: a list of tools, and the call's result.
		expect(Reflect.get(Object(Reflect.get(Object(seen.listed), "result")), "tools")).toEqual(
			expect.arrayContaining([expect.objectContaining({name: "runs"})]),
		);
		expect(Reflect.get(Object(seen.called), "result")).toMatchObject({content: [{type: "text"}]});
		const came = said(lines, "agent_came");
		expect(came).toHaveLength(1);
		expect(came[0]).toMatchObject({level: "INFO", agent: "claude"});
		// No initialize, so no client named itself: neither key is said.
		expect(came[0]?.client).toBeUndefined();
		expect(came[0]?.version).toBeUndefined();
		expect(said(lines, "tool_called")[0]).toMatchObject({tool: "runs", call: "2", ok: "true"});
	});

	it("keeps an agent's lines one line each in the host's log, whatever its tool name or its client's name holds", async () => {
		const lines: string[] = [];
		// Text the agent chooses, each with a newline and a forged line after it.
		const named = {
			name: "test\nlevel=INFO message=agent_came agent=root",
			version: "0.0.0\nlevel=INFO message=tool_called agent=root tool=stop call=1 ok=true",
		};
		const tool = "runs\nlevel=INFO message=tool_called agent=claude tool=stop call=99 ok=true";
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude", named);
				yield* agent.call(tool, {});
				yield* until("agent_came in the log", () =>
					said(lines, "agent_came").length > 0 ? true : undefined,
				);
				yield* until("the call's line", () =>
					said(lines, "tool_called").length > 0 ? true : undefined,
				);
			}),
		);
		const file = fileOf(lines);
		expect(file.filter((line) => messageOf(line) === "agent_came")).toHaveLength(1);
		expect(file.filter((line) => messageOf(line) === "tool_called")).toHaveLength(1);
		// Every line of the file is one the host began, whatever key a forged one starts with.
		expect(file.filter((line) => !line.startsWith("timestamp="))).toEqual([]);
	});

	it("keeps a tool call's line one line in the host's log, whatever its JSON-RPC id holds", async () => {
		const lines: string[] = [];
		// JSON-RPC lets an id be any string: this one holds a newline and a forged line after it.
		const id = "7\nlevel=INFO message=job_stopped n=1 by=user:owner";
		const answer = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				const path = yield* Path.Path;
				const cli = yield* path
					.fromFileUrl(new URL("../cli.ts", import.meta.url))
					.pipe(Effect.orDie);
				// The bridge with no MCP client on it: the test says the JSON-RPC message itself.
				const transport = new StdioClientTransport({
					command: process.execPath,
					args: [cli, "mcp", "--as", "claude"],
					env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
					stderr: "pipe",
				});
				const heard: JSONRPCMessage[] = [];
				transport.onmessage = (message) => {
					heard.push(message);
				};
				yield* Effect.acquireRelease(
					Effect.promise(() => transport.start()),
					() => Effect.promise(() => transport.close()).pipe(Effect.ignore),
				);
				yield* Effect.promise(() =>
					transport.send({
						jsonrpc: "2.0",
						id,
						method: "tools/call",
						params: {name: "runs", arguments: {}},
					}),
				);
				const got = yield* until("the answer to the call", () =>
					heard.find((m) => "id" in m && m.id === id),
				);
				yield* until("the call's line", () =>
					said(lines, "tool_called").length > 0 ? true : undefined,
				);
				// A moment more, so a second line for the call would be caught too.
				yield* Effect.sleep("200 millis");
				return got;
			}),
		);
		// The call went, and was answered under its own id.
		expect(Reflect.get(Object(answer), "result")).toMatchObject({content: [{type: "text"}]});
		const file = fileOf(lines);
		expect(file.filter((line) => messageOf(line) === "tool_called")).toHaveLength(1);
		expect(file.filter((line) => messageOf(line) === "job_stopped")).toEqual([]);
		// Every line of the file is one the host began, whatever key a forged one starts with.
		expect(file.filter((line) => !line.startsWith("timestamp="))).toEqual([]);
	});

	it("writes exactly one tool_called line per tool call, done or refused, with the call's JSON-RPC id", async () => {
		const lines: string[] = [];
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				const calls: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
					["runs", {}],
					["job", {n: 99}],
					["job", {n: 1, last: 0}],
					["stop", {n: 99, why: "nothing there"}],
					["nope", {}],
				];
				const answers: Array<{
					readonly tool: string;
					readonly error: boolean;
					readonly text: string;
				}> = [];

				for (const [tool, args] of calls) {
					answers.push({tool, ...(yield* agent.call(tool, args))});
				}

				yield* until("a line for each call", () =>
					said(lines, "tool_called").length >= calls.length ? true : undefined,
				);
				// A moment more, so a second line for any call would be caught too.
				yield* Effect.sleep("200 millis");
				return {answers, ids: agent.callIds()};
			}),
		);
		const called = said(lines, "tool_called");
		expect(seen.ids).toHaveLength(seen.answers.length);
		expect(called).toHaveLength(seen.answers.length);
		expect(new Set(called.map((f) => f.call)).size).toBe(called.length);
		seen.answers.forEach((answer, i) => {
			const line = called.find((f) => f.call === seen.ids[i]);
			expect(line).toMatchObject({level: "INFO", agent: "claude", tool: answer.tool});
			expect(line?.took_ms).toMatch(/^\d+$/);

			if (answer.error) {
				// Refused: the why as the agent was told it, and no `ok`.
				expect(line?.refused).toBe(answer.text);
				expect(line?.ok).toBeUndefined();
			} else {
				expect(line?.ok).toBe("true");
				expect(line?.refused).toBeUndefined();
			}
		});
		// Only runs went; every other call was refused.
		expect(seen.answers.map((a) => a.error)).toEqual([false, true, true, true, true]);
	});

	it("writes a lag line while the host's thread is starved", async () => {
		const lines: string[] = [];
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, lines);
				// The thread is held 200 ms at a time for about three seconds, as the trace window's
				// `childrenOf` held it: the lag sampler, about once a second, sees p99 far past its line.
				const until3s = Date.now() + 3000;

				while (Date.now() < until3s && said(lines, "lag").length === 0) {
					const end = Date.now() + 200;

					while (Date.now() < end) {
						// busy: nothing else runs on this thread
					}

					yield* Effect.sleep("1 millis");
				}

				yield* until("a lag line", () => (said(lines, "lag").length > 0 ? true : undefined));
			}),
		);
		const lag = said(lines, "lag")[0];
		// OpenTelemetry's Node.js runtime names, in seconds (marked Development there).
		const p99 = Number(lag?.["nodejs.eventloop.delay.p99"]);
		const max = Number(lag?.["nodejs.eventloop.delay.max"]);
		expect(lag?.level).toBe("WARN");
		expect(p99).toBeGreaterThan(0.05);
		expect(max).toBeGreaterThanOrEqual(p99);
	});
});

describe("no secret in a tool's answer or a log line", () => {
	const NAME = "FABRIKA_TEST_SECRET";
	// Secret-shaped, made at run time, so no key-like text is written in this file.
	const secret = ["sk", "ant", "api03", crypto.randomUUID().replaceAll("-", "")].join("-");
	beforeEach(() => {
		process.env[NAME] = secret;
	});
	afterEach(() => {
		delete process.env[NAME];
	});

	it("never says an env value: tools, runs, a job's lines, a stop, the log", async () => {
		const lines: string[] = [];
		const heard = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				host.type("seq --to 3\r");
				yield* agent.jobWhen({n: 1}, (d) => tagOf(d) === "ended");
				host.type("counter &\r");
				yield* agent.jobWhen({n: 2}, (d) => tagOf(d) === "running");
				yield* agent.call("runs", {});
				yield* agent.call("job", {n: 99});
				yield* agent.call("stop", {n: 2, why: "the secrets check"});
				yield* agent.call("stop", {n: 99, why: "the secrets check"});
				yield* until("the stop in the log", () =>
					said(lines, "job_stopped").length > 0 ? true : undefined,
				);
				return agent.heard;
			}),
		);
		// What is checked was said: the job and stop tools answered, and the log has the jobs, the
		// agent's coming and its tool calls in it.
		expect(heard.some((t) => t.includes('"lines"'))).toBe(true);
		expect(heard.some((t) => t.includes('"stopped"'))).toBe(true);
		expect(said(lines, "job_began").length).toBeGreaterThan(0);
		expect(said(lines, "agent_came").length).toBeGreaterThan(0);
		expect(said(lines, "tool_called").length).toBeGreaterThan(0);

		for (const text of [...heard, ...lines]) {
			expect(text).not.toContain(secret);
			expect(text).not.toContain(NAME);
		}
	});
});
