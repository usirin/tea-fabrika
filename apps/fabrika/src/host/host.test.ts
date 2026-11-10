import {join} from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Ledger, streams, writerText} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {type Fact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Logger, Schedule, Scope} from "effect";
import {ChildProcess} from "effect/process";
import {describe, expect, it} from "vitest";
import type {AsksNow, Marks} from "../asks.ts";
import {attach, NoHost} from "../attach.ts";
import type {Open} from "../desk/desk.ts";
import {tilesOf} from "../desk/desk.ts";
import {defaults} from "../desk/keymap.ts";
import {gridOf} from "../editor/grid.ts";
import {type Down, PROTOCOL, type Up} from "../link.ts";
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

			if (got !== undefined) {
				return got;
			}

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
				if (m.type !== "to" || m.port !== "desk") {
					return [];
				}

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
				yield* until("the job", () =>
					app.desk()?.jobs.t1?.running.length === 1 ? true : undefined,
				);
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
		// The asks go to every app, a page or not, as the ledger is read: so leave them out of the order.
		expect(seen.first.filter((t) => t !== "asks").slice(0, 4)).toEqual([
			"keys",
			"programs",
			"host",
			"desk",
		]);
		expect(seen.first).toContain("asks");
		expect(seen.ports).toEqual(["tile:t1"]);
		expect(
			Object.entries(seen.after.jobs).map(([tile, jobs]) => [
				tile,
				jobs.running.map((j) => j.text),
			]),
		).toEqual([["t1", ["counter"]]]);
		expect(tileIds(seen.after)).toEqual(["t1"]);
	});

	it("takes a screen away from the pages shown it, while an app with no page looks on", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				// The app with no page attaches first, so the host meets it first when a screen goes.
				const bare = yield* appOn(paths.sock);
				yield* bare.wire.up;
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("t1's prompt", () => (app.rows("t1")[0] === "tsh$" ? true : undefined));
				app.type("t1", "counter\r");
				const port = yield* until("counter's port", () =>
					app.got.find((m) => m.type === "port" && !m.port.startsWith("tile:")),
				);
				app.type("t1", "\x03");
				const gone = yield* until("counter's port gone", () =>
					app.got.find((m) => m.type === "gone"),
				);
				const after = yield* app.press("<c-b>");
				yield* host.stop;
				return {port, gone, after};
			}),
		);
		expect(seen.gone).toEqual({
			type: "gone",
			port: seen.port.type === "port" ? seen.port.port : "",
		});
		expect(seen.after).toMatchObject({type: "answer", took: true});
	});

	it("closes every window when the last tile closes, and begins again on one fresh tile", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("t1's prompt", () => (app.rows("t1")[0] === "tsh$" ? true : undefined));
				const first = app.desk();
				yield* app.press("<c-b>");
				yield* app.press("x");
				yield* app.press("y");
				const closed = yield* until("the window told to close", () =>
					app.got.find((m) => m.type === "close"),
				);
				const fresh = yield* until("a fresh desk", () => {
					const d = app.desk();
					return d !== undefined && d !== first && tileIds(d).length === 1 ? d : undefined;
				});
				yield* host.stop;
				return {closed, fresh};
			}),
		);
		expect(seen.closed).toEqual({type: "close"});
		expect(tileIds(seen.fresh)).toEqual(["t1"]);
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
				// A list a key shows opens on the page whose key asked for it, as tmux's list-keys does.
				yield* a.press("<c-b>");
				yield* a.press("a");
				const shownOnA = yield* until("the asks list on a", () =>
					a.page().find((m) => m.type === "show" && m.what === "asks"),
				);
				// The prefix armed after it reaches b behind anything said to b before it.
				yield* a.press("<c-b>");
				yield* until("the prefix on b", () => (b.desk()?.prefix.armed === true ? true : undefined));
				const shownOnB = b.page().filter((m) => m.type === "show");
				yield* host.stop;
				return {prefix, split, onB, bPorts, bAnswers, shownOnA, shownOnB};
			}),
		);
		expect(seen.prefix).toEqual({type: "answer", id: 0, took: true});
		expect(seen.split).toEqual({type: "answer", id: 1, took: true});
		expect(tileIds(seen.onB)).toEqual(["t1", "t2"]);
		expect(seen.onB.workspaces[0].focused).toBe("t2");
		expect(seen.bPorts).toEqual(["tile:t1", "tile:t2"]);
		expect(seen.bAnswers).toEqual([]);
		expect(seen.shownOnA).toEqual({type: "show", what: "asks"});
		expect(seen.shownOnB).toEqual([]);
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

	it("moves the desk on every app from a word typed in a tile's tsh, and prints why it did not", async () => {
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
				yield* until("t1's prompt", () => (a.rows("t1")[0] === "tsh$" ? true : undefined));
				const said = a.page().find((m) => m.type === "host");
				a.type("t1", "split\r");
				const split = yield* until("the split on b", () =>
					tileIds(b.desk()).length === 2 ? b.desk() : undefined,
				);
				a.type("t1", "focus --to t9\r");
				const refused = yield* until("why", () =>
					a.rows("t1").find((r) => r.startsWith("tsh: focus failed")),
				);
				// `agents` is a tsh built-in now (the plan's grammar), so C-b S's desk word stands in.
				a.type("t1", "sync\r");
				const shown = yield* until("the sync lines on b", () =>
					b.page().find((m) => m.type === "show" && m.what === "sync"),
				);
				yield* host.stop;
				return {said, split, refused, shown};
			}),
		);
		// The home keeps its own ledger, so agents attach on its socket: none yet.
		expect(seen.said).toMatchObject({
			type: "host",
			now: {pid: process.pid, ledger: {kind: "own"}, agents: []},
		});
		expect(tileIds(seen.split)).toEqual(["t1", "t2"]);
		expect(seen.split.workspaces[0].focused).toBe("t2");
		expect(seen.refused).toBe("tsh: focus failed: no tile t9");
		expect(seen.shown).toEqual({type: "show", what: "sync"});
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
		expect(seen.refused.why).toEqual({kind: "version", theirs: PROTOCOL, ours: 0});
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

describe("the asks' later and seen", () => {
	const owner = writerText({kind: "user", id: "owner"});
	const agent = writerText({kind: "agent", id: "plan", for: "owner"});

	/** Write facts to the home's own ledger, with no host on it. */
	const write = (home: string, facts: readonly (readonly [number, string, Fact])[]) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;

			for (const [n, id, fact] of facts) {
				if (fact.type === "filed") {
					yield* ledger.register(nameOf(n), owner);
				}

				const writer = fact.type === "asked" ? agent : owner;
				yield* ledger.send(streams(nameOf(n)).inbox, id, {kind: fact.type, writer, data: fact});
			}
		}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite"), tickMs: 1000})));
	const filed = (title: string): Fact => ({type: "filed", title, body: ""});
	const asked = (what: string, ask = "a-1"): Fact => ({
		type: "asked",
		ask,
		what,
		picks: ["yes", "no"],
	});

	/** Two tickets, each with an ask: 1/a-1 and 3/a-1. */
	const seeded = Effect.gen(function* () {
		const {home, paths} = yield* freshHome;
		yield* write(home, [
			[1, "f1", filed("Login fails")],
			[1, "a1", asked("approve plan")],
			[3, "f3", filed("Dark mode")],
			[3, "a3", asked("is it a duplicate?")],
		]);
		return {home, paths};
	});

	/** An app on the host, once the host has read the ledger: what it last said of the asks. */
	const asksOn = (sock: string) =>
		Effect.gen(function* () {
			const app = yield* appOn(sock);
			yield* app.wire.up;
			app.send({type: "page"});
			const asks = () => {
				const last = app.page().findLast((m) => m.type === "asks");
				return last?.type === "asks" && last.now.reach === "ok" ? last.now : undefined;
			};
			yield* until("the asks", asks);
			return {app, asks};
		});
	const said = (now: AsksNow | undefined) => ({
		asks: now?.asks.map((a) => [a.key, a.seen]),
		later: now?.later.map((a) => a.key),
	});

	const kept = (home: string) =>
		FileSystem.FileSystem.pipe(
			Effect.flatMap((fs) => fs.readFileString(join(home, "asks.json"))),
			Effect.map((text): unknown => JSON.parse(text)),
			Effect.orElseSucceed((): unknown => null),
		);
	/** Wait for asks.json to hold `marks`. */
	const keptAs = (home: string, marks: Marks) =>
		Effect.gen(function* () {
			for (let i = 0; i < 400; i += 1) {
				const now = yield* kept(home);

				if (JSON.stringify(now) === JSON.stringify(marks)) {
					return now;
				}

				yield* Effect.sleep("5 millis");
			}

			const last = JSON.stringify(yield* kept(home));
			return yield* Effect.die(`waited for asks.json to hold ${JSON.stringify(marks)}: ${last}`);
		});

	it("keeps later and seen across a host restart, and drops an answered ask's later", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* seeded;
				const first = yield* hostOn(home);
				const {app} = yield* asksOn(paths.sock);
				// The list opens, then both asks are set aside.
				app.send({type: "on", port: "desk", m: {type: "seen"}});
				app.send({type: "on", port: "desk", m: {type: "later", key: "1/a-1"}});
				app.send({type: "on", port: "desk", m: {type: "later", key: "3/a-1"}});
				yield* keptAs(home, {later: ["1/a-1", "3/a-1"], seen: ["1/a-1", "3/a-1"]});
				yield* app.leave;
				yield* first.stop;

				// The host is stopped: the ask on #3 is answered meanwhile.
				yield* write(home, [[3, "n3", {type: "answered", ask: "a-1", pick: "yes", note: ""}]]);
				const second = yield* hostOn(home);
				const again = yield* asksOn(paths.sock);
				const after = said(again.asks());
				const file = yield* keptAs(home, {later: ["1/a-1"], seen: ["1/a-1"]});

				// One more ask comes: it counts, and it is new.
				yield* write(home, [[1, "a1b", asked("merge?", "a-2")]]);
				const newer = yield* until("the new ask", () =>
					again.asks()?.asks.some((a) => a.key === "1/a-2") === true ? again.asks() : undefined,
				);
				yield* again.app.leave;
				yield* second.stop;
				return {after, file, newer: said(newer)};
			}),
		);
		expect(seen.after).toEqual({asks: [], later: ["1/a-1"]});
		expect(seen.file).toEqual({later: ["1/a-1"], seen: ["1/a-1"]});
		expect(seen.newer).toEqual({asks: [["1/a-2", false]], later: ["1/a-1"]});
	});

	it.each([
		["a broken file", "{"],
		["a file an older build wrote", '{"later":["1/a-1"]}'],
	])("starts on %s with every ask counted and new, and says so in the log", async (_, text) => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* seeded;
				yield* fs.writeFileString(join(home, "asks.json"), text);
				const logs: string[] = [];
				const scope = yield* Scope.make();
				yield* runHost({home, pid: process.pid}).pipe(
					Effect.scoped,
					Effect.provide(Logger.layer([Logger.make((l) => logs.push(String(l.message)))])),
					Effect.forkIn(scope),
				);
				yield* live(paths.sock);
				const {app, asks} = yield* asksOn(paths.sock);
				const now = said(asks());
				yield* app.leave;
				yield* Scope.close(scope, Exit.void);
				return {now, logs};
			}),
		);
		expect(seen.now).toEqual({
			asks: [
				["1/a-1", false],
				["3/a-1", false],
			],
			later: [],
		});
		expect(
			seen.logs.filter((l) => l.includes("the asks' later and seen did not read back")),
		).toHaveLength(1);
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
			ours: PROTOCOL,
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

// ---------------------------------------------------------------- the keys file (ticket 174, PR 1)

/** Every line the host logs while `test` runs, as host/log would hold it. */
const goLogged = <A, E>(
	test: (
		lines: readonly string[],
	) => Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>,
) => {
	const lines: string[] = [];
	const caught = Logger.make((o) => {
		lines.push(Logger.formatSimple.log(o));
	});
	return Effect.runPromise(
		test(lines).pipe(
			Effect.scoped,
			Effect.provide(Logger.layer([caught])),
			Effect.provide(platform),
		),
	);
};

/** A log line's `key=value` fields, a quoted value unquoted. */
const fieldsOf = (line: string): Record<string, string> => {
	const out: Record<string, string> = {};

	for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		const [, key = "", raw = ""] = m;
		out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
	}

	return out;
};

/** The person's keys file, in a home of its own: `$FABRIKA_HOME/keybindings.toml` (p11). */
const saveKeys = (home: string, ...lines: readonly string[]) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.writeFileString(join(home, "keybindings.toml"), lines.join("\n"));
	});

type App = Effect.Success<ReturnType<typeof appOn>>;
const keysSent = (app: App) => app.page().flatMap((m) => (m.type === "keys" ? [m] : []));
const lastKeys = (app: App) => keysSent(app).at(-1);
const lastTakes = (app: App) => app.page().findLast((m) => m.type === "desk");

describe("the host and the keys file", () => {
	it("reads the keys file in its own home, and the desk arms on its prefix (p2, p11)", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				yield* saveKeys(home, 'prefix = "ctrl+a"');
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("the desk", app.desk);
				const keys = lastKeys(app);
				const takes = lastTakes(app);
				const b = yield* app.press("<c-b>");
				const a = yield* app.press("<c-a>");
				const split = yield* app.press("|");
				const two = yield* until("the split", () =>
					tileIds(app.desk()).length === 2 ? true : undefined,
				);
				yield* host.stop;
				return {keys, takes, b, a, split, two};
			}),
		);
		expect(seen.keys).toMatchObject({type: "keys", prefix: "<c-a>", file: {_tag: "read"}});
		expect(seen.takes).toMatchObject({
			takes: {all: false, keys: expect.arrayContaining(["<c-a>"])},
		});
		expect(seen.b).toMatchObject({took: false});
		expect(seen.a).toMatchObject({took: true});
		expect(seen.split).toMatchObject({took: true});
	});

	it("starts on the defaults with a bad file, and keeps the last good table after a bad save (p8)", async () => {
		const seen = await goLogged((lines) =>
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				yield* saveKeys(home, 'tezgah.zom = "<prefix>m"');
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("the desk", app.desk);
				const atStart = lastKeys(app);
				yield* saveKeys(home, 'prefix = "ctrl+a"');
				const good = yield* until("the good table", () =>
					lastKeys(app)?.file._tag === "read" ? lastKeys(app) : undefined,
				);
				yield* saveKeys(home, 'prefix = "ctrl+a"', 'tezgah.zom = "<prefix>m"');
				const bad = yield* until("the refusal", () =>
					lastKeys(app)?.file._tag === "refused" ? lastKeys(app) : undefined,
				);
				// The desk kept the good table: C-a still arms, C-b is the tile's.
				const a = yield* app.press("<c-a>");
				const files = lines
					.map(fieldsOf)
					.filter((f) => f.message === "keys")
					.map((f) => f.file);
				yield* host.stop;
				return {atStart, good, bad, a, files};
			}),
		);
		expect(seen.atStart).toEqual({
			type: "keys",
			...defaults,
			version: expect.any(String),
			changes: [],
			file: {_tag: "refused", line: 1, why: "tezgah.zom is not a command"},
		});
		expect(seen.good).toMatchObject({prefix: "<c-a>", rows: defaults.rows, file: {_tag: "read"}});
		expect(seen.bad).toMatchObject({
			prefix: "<c-a>",
			rows: defaults.rows,
			file: {_tag: "refused", line: 2, why: "tezgah.zom is not a command"},
		});
		expect(seen.a).toMatchObject({took: true});
		// Each read is logged: what the file came to.
		expect(seen.files).toEqual(["refused", "read", "refused"]);
	});

	it("swaps the table on both pages on a save, and disarms a prefix armed on one (p9)", async () => {
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
				const armed = yield* a.press("<c-b>");
				yield* saveKeys(home, 'prefix = "ctrl+a"');
				const onA = yield* until("a's new table", () =>
					lastKeys(a)?.prefix === "<c-a>" ? lastKeys(a) : undefined,
				);
				const onB = yield* until("b's new table", () =>
					lastKeys(b)?.prefix === "<c-a>" ? lastKeys(b) : undefined,
				);
				const disarmed = yield* until("the prefix disarmed", () =>
					a.desk()?.prefix.armed === false ? lastTakes(a) : undefined,
				);
				// The next key uses the new table.
				const bar = yield* a.press("|");
				const prefix = yield* a.press("<c-a>");
				const split = yield* a.press("|");
				const two = yield* until("the split on b", () =>
					tileIds(b.desk()).length === 2 ? tileIds(b.desk()) : undefined,
				);
				yield* host.stop;
				return {armed, onA, onB, disarmed, bar, prefix, split, two};
			}),
		);
		expect(seen.armed).toMatchObject({took: true});
		expect(seen.onA).toEqual(seen.onB);
		expect(seen.disarmed).toMatchObject({
			takes: {all: false, keys: expect.arrayContaining(["<c-a>"])},
		});
		expect(seen.bar).toMatchObject({took: false});
		expect(seen.prefix).toMatchObject({took: true});
		expect(seen.split).toMatchObject({took: true});
		expect(seen.two).toEqual(["t1", "t2"]);
	});

	it("logs each desk command it runs, with its word and how it was reached (p13)", async () => {
		const did = await goLogged((lines) =>
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				yield* until("the desk", app.desk);
				yield* until("t1's prompt", () => (app.rows("t1")[0] === "tsh$" ? true : undefined));
				const done = (n: number) =>
					until(`${n} did lines`, () =>
						lines.filter((l) => fieldsOf(l).message === "did").length >= n ? true : undefined,
					);
				// The palette, by the command's word.
				app.send({type: "on", port: "desk", m: {type: "run", does: "tezgah.split"}});
				yield* done(1);
				// A key: C-b, then z.
				yield* app.press("<c-b>");
				yield* app.press("z");
				yield* done(2);
				// A tsh word, typed in t1's tsh.
				app.type("t1", "zoom\r");
				yield* done(3);
				// A click: a double-click on t2's title bar folds it.
				app.send({type: "on", port: "desk", m: {type: "fold", tile: "t2"}});
				yield* done(4);
				yield* host.stop;
				return lines
					.map(fieldsOf)
					.filter((f) => f.message === "did")
					.map((f) => [f.does, JSON.parse(f.via ?? "null")]);
			}),
		);
		expect(did).toEqual([
			["tezgah.split", {_tag: "palette"}],
			["tezgah.zoom", {_tag: "key", keys: "ctrl+b z"}],
			["tezgah.zoom", {_tag: "word"}],
			["tezgah.fold", {_tag: "click"}],
		]);
	});

	it("K19: logs a workspace click and palette opening by name and via, never ordinary typing", async () => {
		const did = await goLogged((lines) =>
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const host = yield* hostOn(home);
				const app = yield* appOn(paths.sock);
				yield* app.wire.up;
				app.send({type: "page"});
				const desk = yield* until("the desk", app.desk);
				const done = (n: number) =>
					until(`${n} did lines`, () =>
						lines.filter((l) => fieldsOf(l).message === "did").length >= n ? true : undefined,
					);
				// A click on the first workspace in the top bar.
				app.send({type: "on", port: "desk", m: {type: "pick", workspace: desk.workspaces[0].id}});
				yield* done(1);
				app.send({type: "on", port: "desk", m: {type: "run", does: "palette.open"}});
				app.send({type: "on", port: "desk", m: {type: "run", does: "tezgah.split"}});
				yield* done(3);
				app.type("t1", "ordinary typing");
				yield* Effect.sleep("100 millis");
				// A second workspace, then a click on it: the word names the workspace clicked.
				app.send({type: "on", port: "desk", m: {type: "run", does: 'tezgah."workspace --to new"'}});
				const second = yield* until("a second workspace, in front", () => {
					const [, w2] = app.desk()?.workspaces ?? [];
					return w2 !== undefined && app.desk()?.active === w2.id ? w2 : undefined;
				});
				app.send({type: "on", port: "desk", m: {type: "pick", workspace: second.id}});
				yield* done(5);
				// An ask picked in the asks list goes to its tile: its workspace comes forward.
				app.send({type: "on", port: "desk", m: {type: "go", tile: "t1"}});
				yield* until("t1's workspace forward", () =>
					app.desk()?.active === desk.workspaces[0].id ? true : undefined,
				);
				yield* host.stop;
				return lines
					.map(fieldsOf)
					.filter((f) => f.message === "did")
					.map((f) => [f.does, JSON.parse(f.via ?? "null")]);
			}),
		);
		expect(did).toEqual([
			['tezgah."workspace --to 1"', {_tag: "click"}],
			["palette.open", {_tag: "palette"}],
			["tezgah.split", {_tag: "palette"}],
			['tezgah."workspace --to new"', {_tag: "palette"}],
			['tezgah."workspace --to 2"', {_tag: "click"}],
		]);
	});
});

it("K12: an editor save publishes one version to two windows and watcher echo adds no change", async () => {
	await go(
		Effect.gen(function* () {
			const {home, paths} = yield* freshHome;
			const host = yield* hostOn(home);
			const a = yield* appOn(paths.sock);
			const b = yield* appOn(paths.sock);
			yield* a.wire.up;
			yield* b.wire.up;
			a.send({type: "page"});
			b.send({type: "page"});
			yield* until("a desk", a.desk);
			yield* until("b desk", b.desk);
			yield* a.press("<c-b>");
			a.send({
				type: "on",
				port: "desk",
				m: {
					type: "keys.edit",
					request: "edit-1",
					edit: {_tag: "bind", does: "tezgah.zoom", keys: ["<prefix>m"]},
					said: 100,
				},
			});
			const onA = yield* until("editor save on a", () =>
				lastKeys(a)?.rows.find((row) => row.does === "tezgah.zoom")?.keys[0]?.key === "m"
					? lastKeys(a)
					: undefined,
			);
			const onB = yield* until("editor save on b", () =>
				lastKeys(b)?.rows.find((row) => row.does === "tezgah.zoom")?.keys[0]?.key === "m"
					? lastKeys(b)
					: undefined,
			);
			expect(onA).toEqual(onB);
			expect(onA).toHaveProperty("version", expect.any(String));
			expect(onA).toHaveProperty("changes", [expect.objectContaining({how: "pressed"})]);
			expect(a.desk()?.prefix.armed).toBe(false);
			const countA = keysSent(a).length;
			const countB = keysSent(b).length;
			yield* Effect.sleep("200 millis");
			expect(keysSent(a)).toHaveLength(countA);
			expect(keysSent(b)).toHaveLength(countB);
			const fs = yield* FileSystem.FileSystem;
			const text = yield* fs.readFileString(join(home, "keybindings.toml"));
			expect(text).toContain("tezgah.zoom");
			yield* host.stop;
		}),
	);
});

it("K20: an editor a page opens shows its view on its own run's port, and closing takes it away", async () => {
	const seen = await goLogged((lines) =>
		Effect.gen(function* () {
			const {home, paths} = yield* freshHome;
			const host = yield* hostOn(home);
			const app = yield* appOn(paths.sock);
			yield* app.wire.up;
			app.send({type: "page"});
			yield* until("a desk", app.desk);
			app.send({type: "on", port: "desk", m: {type: "keys.open"}});
			const opened = yield* until("the editor opened", () =>
				app.page().find((m) => m.type === "keys.opened"),
			);
			const run = opened.type === "keys.opened" ? opened.run : "";
			const view = yield* until("the editor's view", () =>
				app.got.find((m) => m.type === "to" && m.port === `run:${run}`),
			);
			// An edit comes only by the checked inputs on the desk's port, never on the view's own.
			app.send({type: "on", port: `run:${run}`, m: {type: "edit"}});
			const refused = yield* until("the view's port refuses", () =>
				lines.find((l) => l.includes(`refused a message on run:${run}`)),
			);
			app.send({type: "on", port: "desk", m: {type: "keys.close"}});
			const closed = yield* until("the editor closed", () =>
				app.page().find((m) => m.type === "keys.closed"),
			);
			const gone = app.got.find((m) => m.type === "gone" && m.port === `run:${run}`);
			yield* host.stop;
			return {run, view, refused, closed, gone};
		}),
	);
	expect(seen.run).toMatch(/^keys:/);
	expect(seen.view).toEqual({
		type: "to",
		port: `run:${seen.run}`,
		m: {type: "view", program: "keys", data: {open: true}},
	});
	expect(seen.refused).toContain("Use the checked keys inputs on the desk port.");
	expect(seen.closed).toEqual({type: "keys.closed", run: seen.run});
	expect(seen.gone).toEqual({type: "gone", port: `run:${seen.run}`});
});

it("K20: one window closing its editor leaves tsh's keys waiting on another window's editor", async () => {
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
			yield* until("t1's prompt", () => (a.rows("t1")[0] === "tsh$" ? true : undefined));
			const prompts = () => a.rows("t1").filter((row) => row.trim() === "tsh$").length;
			a.type("t1", "keys\r");

			for (const app of [a, b]) {
				yield* until("the editor asked for", () =>
					app.page().find((m) => m.type === "show" && m.what === "keys"),
				);
				app.send({type: "on", port: "desk", m: {type: "keys.open"}});
				yield* until("the editor opened", () => app.page().find((m) => m.type === "keys.opened"));
			}

			a.send({type: "on", port: "desk", m: {type: "keys.close"}});
			yield* until("a's editor closed", () => a.page().find((m) => m.type === "keys.closed"));
			yield* Effect.sleep("300 millis");
			const waiting = prompts();
			b.send({type: "on", port: "desk", m: {type: "keys.close"}});
			yield* until("tsh's prompt back", () => (prompts() > waiting ? true : undefined));
			yield* host.stop;
			return {waiting};
		}),
	);
	expect(seen.waiting).toBe(0);
});
