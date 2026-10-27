import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Schedule, Scope} from "effect";
import {ChildProcess} from "effect/process";
import {describe, expect, it} from "vitest";
import {attach, NoHost} from "../attach.ts";
import type {Open} from "../desk/desk.ts";
import {tilesOf} from "../desk/desk.ts";
import {gridOf} from "../editor/grid.ts";
import type {Down, Up} from "../link.ts";
import {readToPage, type ToPage} from "../messages.ts";
import {appWire, Unattached} from "../wire.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

// The host on a home of each test's own, run in the test's process, with no Electron: what an
// app attached is sent, two apps at once, a socket left by a crash, another version, the modes
// of the socket and its folder. Each host stops with its test's scope, and a test checks it left
// no socket behind.

// The tracker's pull requests: none. No test reads GitHub.
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
			if (got !== undefined) return got;
			yield* Effect.sleep("5 millis");
		}
		return yield* Effect.die(`waited for ${what}`);
	});

/** A fresh home, with the host's paths in it. */
const freshHome = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "fh-"});
	return {home, paths: yield* pathsOf(home)};
});

/** Done once something answers on `sock`, a few seconds at most. */
const live = (sock: string) =>
	reach(sock).pipe(
		Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("5 millis")}),
		Effect.timeoutOrElse({
			duration: "5 seconds",
			orElse: () => Effect.die(`nothing answered on ${sock}`),
		}),
	);

/** A host on `home`, in its own scope: closed, it stops. Answers once it listens. */
const hostOn = (home: string, ours?: number, build?: string | null) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		// Its own scope, inside its fiber: stopping interrupts the server before its socket closes,
		// as SIGTERM does in host/main.ts, so no app attached holds the close.
		// The pid is this test's own, so `stopHost` on this home refuses it (host/stop.ts): a host
		// in a test's process is stopped with its scope, never by a signal.
		yield* runHost({home, pid: process.pid, ours, build}).pipe(Effect.scoped, Effect.forkIn(scope));
		const {sock} = yield* pathsOf(home);
		yield* live(sock);
		return {stop: Scope.close(scope, Exit.void)};
	});

/** An app's end of the link, on its own scope, with every line it was sent. */
const appOn = (sock: string, ours?: number) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const got: Down[] = [];
		const socket = yield* NodeSocket.makeNet({path: sock});
		const wire = yield* appWire(socket, (m) => got.push(m), ours).pipe(Scope.provide(scope));
		/** What the page was sent on the desk's port, read. */
		const page = (): ToPage[] =>
			got.flatMap((m) => {
				if (m.type !== "to" || m.port !== "desk") return [];
				const read = readToPage(m.m);
				return read.kind === "read" ? [read.msg] : [];
			});
		const desk = (): Open | undefined => {
			const last = page().findLast((m) => m.type === "desk");
			return last?.type === "desk" && last.desk.at === "open" ? last.desk : undefined;
		};
		/** The bytes a tile's terminal was sent, as rows. */
		const rows = (tile: string) =>
			gridOf(
				got
					.flatMap((m) =>
						m.type === "to" && m.port === `tile:${tile}` && typeof m.m === "object" && m.m !== null
							? [String(Reflect.get(m.m, "data"))]
							: [],
					)
					.join(""),
				80,
				1000,
			).rows;
		let id = 0;
		/** Press a key the desk takes, and wait for the host's answer. */
		const press = (key: string) =>
			Effect.gen(function* () {
				const n = id;
				id += 1;
				send({type: "on", port: "desk", m: {type: "press", id: n, key}});
				return yield* until(`the answer to ${key}`, () =>
					page().find((m) => m.type === "answer" && m.id === n),
				);
			});
		const send = (m: Up) => wire.send(m);
		const type = (tile: string, data: string) =>
			send({type: "on", port: `tile:${tile}`, m: {type: "keys", data}});
		return {wire, got, page, desk, rows, press, send, type, leave: Scope.close(scope, Exit.void)};
	});

const tileIds = (desk: Open | undefined) =>
	desk === undefined ? [] : desk.workspaces.flatMap((ws) => tilesOf(ws).map((t) => t.id));

describe("the host", () => {
	it("makes its folder 0700 and its socket 0600 in the home, and writes its pid", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const dir = yield* fs.stat(paths.dir);
				const sock = yield* fs.stat(paths.sock);
				const pid = yield* fs.readFileString(paths.pid);
				yield* host.stop;
				const after = yield* fs.exists(paths.sock);
				return {dir: dir.mode & 0o777, sock: sock.mode & 0o777, type: sock.type, pid, after};
			}),
		);
		expect(seen.dir).toBe(0o700);
		expect(seen.sock).toBe(0o600);
		expect(seen.type).toBe("Socket");
		expect(seen.pid).toBe(`${process.pid}\n`);
		// Stopped, it leaves no socket behind: the next start finds no host.
		expect(seen.after).toBe(false);
	});

	it("shows an app the desk, its keys and t1's tsh; the app goes, and the host runs on", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				const desk = yield* until("the desk", app.desk);
				yield* until("t1's prompt", () => (app.rows("t1")[0] === "tsh$" ? true : undefined));
				const first = app.page().map((m) => m.type);
				const ports = app.got.flatMap((m) => (m.type === "port" ? [m.port] : []));
				app.type("t1", "counter &\r");
				yield* until("the job", () => (app.desk()?.running.t1 === 1 ? true : undefined));
				yield* app.leave;
				// The app went: the job runs on, and the next app is shown the same desk.
				const again = yield* appOn(paths.sock);
				yield* again.wire.up;
				again.send({type: "page"});
				const after = yield* until("the desk again", again.desk);
				yield* host.stop;
				return {desk, first, ports, after};
			}),
		);
		expect(tileIds(seen.desk)).toEqual(["t1"]);
		expect(seen.first.slice(0, 2)).toEqual(["keys", "desk"]);
		expect(seen.ports).toEqual(["tile:t1"]);
		expect(seen.after.running).toEqual({t1: 1});
		expect(tileIds(seen.after)).toEqual(["t1"]);
	});

	it("shows two apps at once the same desk: Ctrl-B | from one splits it on both", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const a = yield* appOn(paths.sock);
				const b = yield* appOn(paths.sock);
				yield* a.wire.up;
				yield* b.wire.up;
				a.send({type: "page"});
				b.send({type: "page"});
				yield* until("a's desk", a.desk);
				yield* until("b's desk", b.desk);
				const prefix = yield* a.press("<c-b>");
				const split = yield* a.press("|");
				const onB = yield* until("the split on b", () =>
					tileIds(b.desk()).length === 2 ? b.desk() : undefined,
				);
				// b was given a port for the new tile's terminal, and was sent no answer: the keys were a's.
				const bPorts = b.got.flatMap((m) => (m.type === "port" ? [m.port] : []));
				const bAnswers = b.page().filter((m) => m.type === "answer");
				yield* host.stop;
				return {prefix, split, onB, bPorts, bAnswers};
			}),
		);
		expect(seen.prefix).toEqual({type: "answer", id: 0, took: true});
		expect(seen.split).toEqual({type: "answer", id: 1, took: true});
		expect(tileIds(seen.onB)).toEqual(["t1", "t2"]);
		expect(seen.onB.workspaces[0].focused).toBe("t2");
		expect(seen.bPorts).toEqual(["tile:t1", "tile:t2"]);
		expect(seen.bAnswers).toEqual([]);
	});

	it("answers a key the desk does not take with took: false, for the page to pass it on", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("the desk", app.desk);
				const answer = yield* app.press("q");
				yield* host.stop;
				return answer;
			}),
		);
		expect(seen).toEqual({type: "answer", id: 0, took: false});
	});

	it("sends one Ctrl-B on to tsh on Ctrl-B Ctrl-B, as tmux's send-prefix", async () => {
		const row = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("t1's prompt", () => (app.rows("t1")[0] === "tsh$" ? true : undefined));
				app.type("t1", "ab");
				yield* until("ab", () => (app.rows("t1")[0] === "tsh$ ab" ? true : undefined));
				yield* app.press("<c-b>");
				yield* app.press("<c-b>");
				// The line editor's Ctrl-B moves back one: X goes in before b.
				app.type("t1", "X");
				const got = yield* until("aXb", () =>
					app.rows("t1")[0] === "tsh$ aXb" ? app.rows("t1")[0] : undefined,
				);
				yield* host.stop;
				return got;
			}),
		);
		expect(row).toBe("tsh$ aXb");
	});

	it("refuses an app of another version, says which, and runs on for the next app", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const old = yield* appOn(paths.sock, 0);
				const refused = yield* old.wire.up.pipe(Effect.flip);
				const said = old.got.filter((m) => m.type !== "hello");
				const next = yield* appOn(paths.sock);
				yield* next.wire.up;
				yield* host.stop;
				return {refused, said, state: old.wire.state().at};
			}),
		);
		expect(seen.refused).toBeInstanceOf(Unattached);
		expect(seen.refused.why).toEqual({kind: "version", theirs: 1, ours: 0});
		expect(seen.state).toBe("refused");
		// Nothing past the hello: no desk, no port.
		expect(seen.said).toEqual([]);
	});

	it("does not start where another host answers", async () => {
		const failed = await go(
			Effect.gen(function* () {
				const {home} = yield* freshHome;
				const host = yield* hostOn(home);
				const second = yield* runHost({home, pid: 1}).pipe(Effect.flip);
				yield* host.stop;
				return second;
			}),
		);
		expect(failed._tag).toBe("HostAnswers");
	});
});

describe("attaching", () => {
	/** A host that answers on `home`: in this process, as a test does not start Electron's binary. */
	const startIn = (home: string, started: string[]) =>
		Effect.gen(function* () {
			started.push(home);
			const host = yield* hostOn(home);
			yield* Effect.addFinalizer(() => host.stop);
			return Effect.never;
		});

	it("starts a host when none answers, waits for its socket, and attaches", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home} = yield* freshHome;
				const started: string[] = [];
				const first = yield* attach({home, deliver: () => {}, start: startIn(home, started)});
				// A second app attaches to the same host, and starts none.
				const second = yield* attach({home, deliver: () => {}, start: startIn(home, started)});
				return {
					state: first.wire.state().at,
					found: first.found,
					second: second.wire.state().at,
					started: started.length,
				};
			}),
		);
		// The host runs this build: both are this test's code, run from src/.
		expect(seen).toEqual({state: "up", found: {kind: "up"}, second: "up", started: 1});
	});

	it("starts a new host over a socket left by a host that crashed", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				yield* fs.makeDirectory(paths.dir, {recursive: true, mode: 0o700});
				// A host that is killed leaves its socket file: a Node process listening, then SIGKILL.
				const crashed = yield* ChildProcess.make(
					process.execPath,
					["-e", "require('node:net').createServer().listen(process.argv[1])", paths.sock],
					{stdin: "ignore", stdout: "ignore", stderr: "ignore"},
				);
				yield* live(paths.sock);
				yield* crashed.kill({killSignal: "SIGKILL"});
				const before = yield* reach(paths.sock);
				const started: string[] = [];
				const {wire} = yield* attach({home, deliver: () => {}, start: startIn(home, started)});
				return {before, state: wire.state().at, started: started.length};
			}),
		);
		expect(seen).toEqual({before: "stale", state: "up", started: 1});
	});

	it("does not attach to a host of another version, and leaves it running", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const old = yield* hostOn(home, 0);
				const started: string[] = [];
				const refused = yield* attach({
					home,
					deliver: () => {},
					start: startIn(home, started),
				}).pipe(Effect.flip);
				const after = yield* reach(paths.sock);
				yield* old.stop;
				return {refused, after, started: started.length};
			}),
		);
		expect(seen.refused).toBeInstanceOf(Unattached);
		expect(seen.refused instanceof Unattached ? seen.refused.why : null).toEqual({
			kind: "version",
			theirs: 0,
			ours: 1,
		});
		expect(seen.after).toBe("live");
		expect(seen.started).toBe(0);
	});

	it("attaches to a host of another build, and names both builds", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const old = yield* hostOn(home, undefined, "0ld0ld0ld0ld");
				const hello = yield* appOn(paths.sock);
				const said = yield* hello.wire.up;
				const started: string[] = [];
				const {wire, found} = yield* attach({
					home,
					deliver: () => {},
					start: startIn(home, started),
					build: "n3wn3wn3wn3w",
				});
				const state = wire.state().at;
				yield* old.stop;
				return {said, state, found, started: started.length};
			}),
		);
		expect(seen.said).toBe("0ld0ld0ld0ld");
		expect(seen.state).toBe("up");
		expect(seen.found).toEqual({kind: "build", theirs: "0ld0ld0ld0ld", ours: "n3wn3wn3wn3w"});
		expect(seen.started).toBe(0);
	});

	it("reads a host whose hello names no build, as one built before builds, as build unknown", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const old = yield* hostOn(home, undefined, null);
				const hello = yield* appOn(paths.sock);
				const said = yield* hello.wire.up;
				const {wire, found} = yield* attach({
					home,
					deliver: () => {},
					start: Effect.die("a host answers, so none is started"),
					build: "n3wn3wn3wn3w",
				});
				const state = wire.state().at;
				yield* old.stop;
				return {said, state, found};
			}),
		);
		expect(seen.said).toBeNull();
		expect(seen.state).toBe("up");
		expect(seen.found).toEqual({kind: "build", theirs: null, ours: "n3wn3wn3wn3w"});
	});

	it("says so when the host it started stops at once", async () => {
		const failed = await go(
			Effect.gen(function* () {
				const {home} = yield* freshHome;
				return yield* attach({home, deliver: () => {}, start: Effect.succeed(Effect.void)}).pipe(
					Effect.flip,
				);
			}),
		);
		expect(failed).toBeInstanceOf(NoHost);
	});
});
