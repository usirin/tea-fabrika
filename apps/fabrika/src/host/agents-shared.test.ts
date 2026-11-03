import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {keyFileText, keyLineOf, Ledger} from "@kampus/fabrika-old";
import {startTwin} from "@kampus/ledger-server/twin";
import {Client} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Context, Effect, Exit, FileSystem, Layer, Path, Schedule, Scope} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import type {Down} from "../link.ts";
import {readToPage} from "../messages.ts";
import {appWire} from "../wire.ts";
import {connect, hostLedger} from "./connection.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

// The agents' socket on a home connected to a ledger server: the daily home. There the server's
// door stamps what the host writes as the person, so an agent gets only the tools that write
// nothing, and a write tool is refused before anything reaches the server. Today's version.
//
//   alice connects her home to the twin, her host starts on it
//   agent        tools/list                     every tool readOnlyHint: runs, job, tracker_query
//   agent        tracker_file {value: {...}}    refused; the ledger holds what it held
//   agent        tracker_query {value: {status: "open"}}   read through alice's session
//
// The server is its twin in Miniflare (packages/ledger-server), as shared.test.ts runs it; GitHub
// is a fake that lists alice's key. No call leaves the laptop.

const users = new Map<string, {id: number; keys: string[]}>();
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
	if (url.host !== "api.github.com") return new Response("not here", {status: 502});
	const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);
	if (byId !== null) {
		const found = [...users].find(([, u]) => u.id === Number(byId[1]));
		return found === undefined
			? Response.json({message: "Not Found"}, {status: 404})
			: Response.json({id: found[1].id, login: found[0]});
	}
	const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
	const u = m?.[1] === undefined ? undefined : users.get(decodeURIComponent(m[1]));
	if (u === undefined) return Response.json({message: "Not Found"}, {status: 404});
	return m?.[2] === undefined
		? Response.json({id: u.id, login: m?.[1]})
		: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
};

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

let root = "";
let address = "";
const twinScope = Effect.runSync(Scope.make());

beforeAll(async () => {
	// Short, so the host's socket path stays under its 103 bytes.
	root = mkdtempSync(join(tmpdir(), "as-"));
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	writeFileSync(join(root, "key"), await keyFileText(pair, "alice@laptop"), {mode: 0o600});
	const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
	users.set("alice", {id: 7, keys: [line]});
	const twin = await Effect.runPromise(
		startTwin({
			config: {name: "acme-ledger", founder: "github:7"},
			persist: false,
			github: fakeGitHub,
			cacheMs: 0,
		}).pipe(Scope.provide(twinScope)),
	);
	address = `${twin.url}/acme`;
});

afterAll(async () => {
	await Effect.runPromise(Scope.close(twinScope, Exit.void));
	rmSync(root, {recursive: true, force: true});
});

/** Wait for `check` to answer something, ten seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 2000; i += 1) {
			const got = check();
			if (got !== undefined) return got;
			yield* Effect.sleep("5 millis");
		}
		return yield* Effect.die(`waited for ${what}`);
	});

/** Every row on the home's ledger, read through the person's own session on the server. */
const rowsOn = (home: string) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(hostLedger(home));
		return yield* Context.get(services, Ledger).read(0, 1000);
	});

describe("an agent on a home connected to a ledger server", () => {
	it("is served the read-only tools only, and a write is refused with nothing written", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const home = join(root, "h");
				mkdirSync(home, {recursive: true});
				yield* connect(home, {address, login: "alice", key: join(root, "key")});
				const paths = yield* pathsOf(home);
				const host = yield* Scope.make();
				yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(host));
				yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
				// The host's socket for apps comes up as today: it logged in at the server first.
				yield* reach(paths.sock).pipe(
					Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("10 millis")}),
					Effect.timeoutOrElse({duration: "15 seconds", orElse: () => Effect.die("no host")}),
				);
				const got: Down[] = [];
				const wire = yield* appWire(yield* NodeSocket.makeNet({path: paths.sock}), (m) =>
					got.push(m),
				);
				yield* wire.up;
				wire.send({type: "page"});
				// The agents' socket: today there is none on this home.
				yield* reach(paths.mcp).pipe(
					Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("10 millis")}),
					Effect.timeoutOrElse({
						duration: "3 seconds",
						orElse: () => Effect.die("no agents' socket on a connected home"),
					}),
				);
				const mode = (yield* (yield* FileSystem.FileSystem).stat(paths.mcp)).mode & 0o777;

				const path = yield* Path.Path;
				const cli = yield* path
					.fromFileUrl(new URL("../cli.ts", import.meta.url))
					.pipe(Effect.orDie);
				const client = new Client({name: "test", version: "0.0.0"});
				yield* Effect.acquireRelease(
					Effect.promise(() =>
						client.connect(
							new StdioClientTransport({
								command: process.execPath,
								args: [cli, "mcp", "--as", "claude"],
								env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
								stderr: "pipe",
							}),
						),
					),
					() => Effect.promise(() => client.close()).pipe(Effect.ignore),
				);
				const tools = (yield* Effect.promise(() => client.listTools())).tools;
				const before = yield* rowsOn(home);
				const filed = yield* Effect.promise(() =>
					client.callTool({
						name: "tracker_file",
						arguments: {value: {title: "Not on this door", body: ""}},
					}),
				);
				const query = yield* Effect.promise(() =>
					client.callTool({name: "tracker_query", arguments: {value: {status: "open"}}}),
				);
				const after = yield* rowsOn(home);
				// The top bar counts the agent on this home too.
				const agents = yield* until("the agent in the top bar", () => {
					const last = got
						.flatMap((m) => {
							if (m.type !== "to" || m.port !== "desk") return [];
							const read = readToPage(m.m);
							return read.kind === "read" && read.msg.type === "host" ? [read.msg.now] : [];
						})
						.at(-1);
					const names = last?.agents?.map((a) => a.name);
					return names?.includes("claude") === true ? {names, ledger: last?.ledger} : undefined;
				});
				return {mode, tools, before, after, filed, query, agents};
			}).pipe(Effect.scoped, Effect.provide(platform)),
		);
		expect(seen.mode).toBe(0o600);
		const names = seen.tools.map((t) => t.name);
		expect(names).toEqual(expect.arrayContaining(["runs", "job", "tracker_query"]));
		expect(names).not.toContain("tracker_file");
		for (const tool of seen.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
		expect(seen.filed.isError).toBe(true);
		expect(JSON.stringify(seen.filed.content)).toMatch(/tracker_file/);
		expect(seen.after).toEqual(seen.before);
		expect(seen.query.isError).not.toBe(true);
		expect(seen.agents.names).toEqual(["claude"]);
		expect(seen.agents.ledger).toMatchObject({kind: "server", login: "alice"});
	});
});
