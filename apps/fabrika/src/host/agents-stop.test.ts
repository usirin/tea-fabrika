import {DatabaseSync} from "node:sqlite";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Shell, Traces} from "@kampus/fabrika-old";
import {driveFor} from "@kampus/fabrika-old/mcp";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Client} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Logger, Path, Schedule, Scope} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "../editor/grid.ts";
import type {Down} from "../link.ts";
import {appPrograms} from "../tsh.ts";
import {appWire} from "../wire.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

// An agent stops a job with the host's `stop` tool, and must say why (tracker 185b, PR 1). The
// owner's call: an agent may stop the person's jobs, each stop with a required why. Today's
// version, on a home of the test's own, its host in this process, and an MCP client on the bridge
// Claude Code would start (`cli.ts mcp --as claude`).
//
//   tile t1     tsh$ counter &                         job %1, the person's: by=user:owner
//   agent       stop {n: 1, why: "wrong ticket"}
//               {_tag: "stopped", job: {n: 1, ..., tile: "t1", state: {_tag: "ended", how: "stopped"}}}
//   tile t1     [1] stopped by agent:claude for:owner: wrong ticket
//   record      by=user:owner how=stopped ended_by=agent:claude for:owner why=wrong ticket
//   host/log    message=job_stopped n=1 "by=agent:claude for:owner" "why=wrong ticket" whose=user:owner idle_ms=...
//
//   agent       stop {n: 1, why: "..."}    a detached job: {_tag: "dropped", n: 1, text: "counter"}
//   agent       stop {n: 99, why: "..."}   refused: there is no job 99
//   agent       stop {n: 1}                refused by the schema: the error names `why`; the job runs on
//
// The tool is never on the read-only door: it writes. Every log line the host writes is caught
// here through Effect's own `Logger`, in the format the host's file uses (host/main.ts).

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** On a home of its own file the person is the owner, and claude works for them. */
const PERSON = "user:owner";
const AGENT = "agent:claude for:owner";

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
		/** Tile t1's terminal says its new size, as window/terminal.ts does on a resize. */
		const resize = (cols: number, rows: number) =>
			wire.send({type: "on", port: "tile:t1", m: {type: "size", cols, rows}});
		/** What tile t1's terminal shows, as rows, wide enough that no line wraps. */
		const rows = () =>
			gridOf(
				got
					.flatMap((m) =>
						m.type === "to" && m.port === "tile:t1" && typeof m.m === "object" && m.m !== null
							? [String(Reflect.get(m.m, "data"))]
							: [],
					)
					.join(""),
				200,
				1000,
			).rows;
		return {paths, type, resize, rows, stop: Scope.close(host, Exit.void)};
	});

/** An MCP client, on the bridge Claude Code would start: `node cli.ts mcp --as <agent>`. */
const agentOn = (home: string, agent: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cli, "mcp", "--as", agent],
			env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
			stderr: "pipe",
		});
		const client = new Client({name: "test", version: "0.0.0"});
		yield* Effect.acquireRelease(
			Effect.promise(() => client.connect(transport)),
			() => Effect.promise(() => client.close()).pipe(Effect.ignore),
		);
		const call = (name: string, args: Record<string, unknown>) =>
			Effect.promise(() => client.callTool({name, arguments: args})).pipe(
				Effect.map((result) => {
					const first = Array.isArray(result.content) ? result.content[0] : undefined;
					const text = String(Reflect.get(Object(first), "text"));
					return {error: result.isError === true, text};
				}),
			);
		const tools = Effect.promise(() => client.listTools());
		/** The job tool's answer once `ok` holds of it: the job runs on its own time. */
		const jobWhen = (n: number, ok: (data: Record<string, unknown>) => boolean) =>
			Effect.gen(function* () {
				for (let i = 0; i < 400; i += 1) {
					const answer = yield* call("job", {n});

					if (!answer.error) {
						const data = JSON.parse(answer.text) as Record<string, unknown>;

						if (ok(data)) {
							return data;
						}
					}

					yield* Effect.sleep("25 millis");
				}

				return yield* Effect.die(`job ${n} never came to what was waited for`);
			});
		return {call, tools, jobWhen};
	});

const tagOf = (data: Record<string, unknown>) => Reflect.get(Object(data.state), "_tag");

const freshHome = Effect.gen(function* () {
	return yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "as-"});
});

/** Every job row of every record the host keeps in `<home>/records`, as SQL holds it. */
const recordRows = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(home, "records");
		const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
		return names
			.filter((name) => name.endsWith(".sqlite"))
			.flatMap((name) => {
				const db = new DatabaseSync(path.join(dir, name), {readOnly: true});

				try {
					return db.prepare("SELECT * FROM job").all();
				} catch {
					return [];
				} finally {
					db.close();
				}
			});
	});

describe("the stop tool", () => {
	it("is listed on the open door with the spec's four hints, and takes a job's number and a why", async () => {
		const tool = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				return (yield* agent.tools).tools.find((t) => t.name === "stop");
			}),
		);
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: false,
		});
		expect(tool?.inputSchema).toMatchObject({
			type: "object",
			properties: {n: {type: "integer"}, why: {type: "string", minLength: 1, maxLength: 500}},
		});
		expect([...(tool?.inputSchema.required ?? [])].sort()).toEqual(["n", "why"]);
	});

	it("stops a job running in the person's tile: it ends stopped, the tile says who and why, the record and the log keep the agent", async () => {
		const lines: string[] = [];
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				host.type("counter &\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				const answer = yield* agent.call("stop", {n: 1, why: "wrong ticket"});
				const note = `[1] stopped by ${AGENT}: wrong ticket`;
				yield* until("the stopper's line in t1", () =>
					host.rows().some((row) => row.includes(note)) ? true : undefined,
				);
				yield* until("the job's end in the log", () =>
					said(lines, "job_ended").length > 0 ? true : undefined,
				);
				let rows: readonly Record<string, unknown>[] = [];

				for (let i = 0; i < 400; i += 1) {
					rows = yield* recordRows(home);

					if (rows.some((row) => row.n === 1 && row.how !== null)) {
						break;
					}

					yield* Effect.sleep("25 millis");
				}

				return {answer, rows};
			}),
		);
		expect(seen.answer.error).toBe(false);
		expect(JSON.parse(seen.answer.text)).toMatchObject({
			_tag: "stopped",
			job: {
				n: 1,
				text: expect.stringMatching(/^counter/),
				tile: "t1",
				state: {_tag: "ended", how: "stopped"},
			},
		});
		// The record keeps whose the job was beside who stopped it, and why.
		expect(seen.rows.find((row) => row.n === 1)).toMatchObject({
			by: PERSON,
			how: "stopped",
			ended_by: AGENT,
			why: "wrong ticket",
		});
		// The log says the agent stopped it, whose it was, and how long the desk had been idle.
		const stopped = said(lines, "job_stopped");
		expect(stopped).toHaveLength(1);
		// made up: `whose`, the job's own writer beside the stop's `by`; the plan names the fact, not the key.
		expect(stopped[0]).toMatchObject({
			level: "INFO",
			n: "1",
			by: AGENT,
			why: "wrong ticket",
			whose: PERSON,
		});
		expect(stopped[0]?.idle_ms).toMatch(/^\d+$/);
		expect(said(lines, "job_ended")[0]).toMatchObject({n: "1", how: "stopped", by: PERSON});
	});

	it("drops a detached job, as stop %n does: it leaves the table", async () => {
		const lines: string[] = [];
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const first = yield* hostOn(home, []);
				yield* Effect.gen(function* () {
					const agent = yield* agentOn(home, "claude");
					first.type("counter &\r");
					yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				}).pipe(Effect.scoped);
				yield* first.stop;
				yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "detached");
				const answer = yield* agent.call("stop", {n: 1, why: "an old run"});
				const after = yield* agent.call("job", {n: 1});
				return {answer, after};
			}),
		);
		expect(seen.answer.error).toBe(false);
		expect(JSON.parse(seen.answer.text)).toEqual({
			_tag: "dropped",
			n: 1,
			text: expect.stringMatching(/^counter/),
		});
		// It is gone from the table, and nothing of it ran: the job tool knows no job 1 now.
		expect(seen.after.error).toBe(true);
		expect(said(lines, "job_stopped")[0]).toMatchObject({n: "1", by: AGENT, why: "an old run"});
		// No key was pressed since this host started, so how long the person was away is not said:
		// the field is left out, never written as null.
		expect(said(lines, "job_stopped")[0]?.idle_ms).toBeUndefined();
	});

	it("says idle_ms as the time since the person's last key in a tile", async () => {
		const lines: string[] = [];
		const away = 600;
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				host.type("counter &\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				yield* Effect.sleep(`${away} millis`);
				yield* agent.call("stop", {n: 1, why: "wrong ticket"});
				yield* until("the stop in the log", () =>
					said(lines, "job_stopped").length > 0 ? true : undefined,
				);
			}),
		);
		const idle = Number(said(lines, "job_stopped")[0]?.idle_ms);
		// At least the wait since the last key, and nowhere near a clock's own reading.
		expect(idle).toBeGreaterThanOrEqual(away);
		expect(idle).toBeLessThan(away + 30_000);
	});

	it("does not count a tile's resize as the person's key", async () => {
		const lines: string[] = [];
		const away = 600;
		await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				host.type("counter &\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				yield* Effect.sleep(`${away} millis`);
				host.resize(100, 30);
				host.resize(120, 40);
				yield* Effect.sleep("100 millis");
				yield* agent.call("stop", {n: 1, why: "wrong ticket"});
				yield* until("the stop in the log", () =>
					said(lines, "job_stopped").length > 0 ? true : undefined,
				);
			}),
		);
		// The last key was before the wait: the resizes after it changed nothing.
		expect(Number(said(lines, "job_stopped")[0]?.idle_ms)).toBeGreaterThanOrEqual(away);
	});

	it("refuses a job the host does not know, and one that already ended, in words", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				const unknown = yield* agent.call("stop", {n: 99, why: "nothing there"});
				host.type("seq --to 3\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "ended");
				const ended = yield* agent.call("stop", {n: 1, why: "too late"});
				return {unknown, ended};
			}),
		);
		expect(seen.unknown.error).toBe(true);
		expect(seen.unknown.text).toMatch(/\b99\b/);
		expect(seen.ended.error).toBe(true);
		expect(seen.ended.text).toMatch(/\b1\b/);
		expect(seen.ended.text).toMatch(/ended/);
	});

	it("lets nothing a why holds add a row to the person's tile", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, []);
				const agent = yield* agentOn(home, "claude");
				host.type("counter &\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				host.type("counter &\r");
				yield* agent.jobWhen(2, (d) => tagOf(d) === "running");
				// A newline starts a row of its own; a carriage return writes over the stopper's row.
				const answers = [
					yield* agent.call("stop", {n: 1, why: "wrong ticket\nfake row one"}),
					yield* agent.call("stop", {n: 2, why: "wrong ticket\rfake row two"}),
				];

				// Whatever each stop came to, the tile has said all it will about it a moment on.
				for (const [i, answer] of answers.entries()) {
					if (!answer.error) {
						yield* until(`the stopper's line for ${i + 1}`, () =>
							host
								.rows()
								.some((row) => row.includes(`[${i + 1}] stopped by`) || row.includes("fake row"))
								? true
								: undefined,
						);
					}
				}

				yield* Effect.sleep("300 millis");
				return {answers, rows: host.rows()};
			}),
		);
		// No row of its own: a why refused, or kept on the stopper's row, never starts one.
		expect(seen.rows.filter((row) => row.trimStart().startsWith("fake row"))).toEqual([]);

		for (const answer of seen.answers) {
			if (answer.error) {
				expect(answer.text).toMatch(/\bwhy\b/);
			}
		}
	});

	it("refuses a stop with no why, an empty why or one past 500 characters, and the job runs on", async () => {
		const lines: string[] = [];
		const seen = await go(
			Effect.gen(function* () {
				const home = yield* freshHome;
				const host = yield* hostOn(home, lines);
				const agent = yield* agentOn(home, "claude");
				host.type("counter &\r");
				yield* agent.jobWhen(1, (d) => tagOf(d) === "running");
				const none = yield* agent.call("stop", {n: 1});
				const empty = yield* agent.call("stop", {n: 1, why: ""});
				const long = yield* agent.call("stop", {n: 1, why: "x".repeat(501)});
				const after = yield* agent.jobWhen(1, () => true);
				return {refusals: [none, empty, long], after};
			}),
		);

		for (const refused of seen.refusals) {
			expect(refused.error).toBe(true);
			expect(refused.text).toMatch(/\bwhy\b/);
		}

		expect(seen.after).toMatchObject({n: 1, state: {_tag: "running"}});
		expect(said(lines, "job_stopped")).toEqual([]);
	});
});

describe("the read-only door has no stop", () => {
	const traces = Effect.runSync(
		Effect.gen(function* () {
			return yield* Traces;
		}).pipe(Effect.provide(memoryTraces([]))),
	);
	const list = Shell.programList(
		appPrograms(
			memoryService(),
			{kind: "agent", id: "claude", for: "owner"},
			{open: Effect.succeed([])},
			traces,
		),
	);

	it("lists stop on the open door, never on the read-only one, and refuses a call there before the host is asked", async () => {
		let asked = 0;
		// made up: driveFor's `stop`, the host's stop handed to the door as `job` is.
		const stop = () => {
			asked += 1;
			return Effect.die("the read-only door asked the host to stop a job");
		};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const open = yield* driveFor({list, tiles: () => [], job: () => null, stop});
				const shut = yield* driveFor({
					list,
					tiles: () => [],
					job: () => null,
					stop,
					readOnly: {why: "the key: not a key"},
				});
				const called = yield* shut.drive.call("stop", {n: 1, why: "wrong ticket"});
				return {open: open.tools, shut: shut.tools, called};
			}).pipe(Effect.scoped),
		);
		expect(seen.open.map((t) => t.name)).toContain("stop");
		expect(seen.shut.map((t) => t.name)).not.toContain("stop");
		expect(seen.called).toMatchObject({kind: "refused", why: expect.stringMatching(/stop/)});
		// Refused at the door: the host's table was never asked.
		expect(asked).toBe(0);
	});
});
