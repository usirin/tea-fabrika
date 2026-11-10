import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Path, Schedule, Scope} from "effect";
import {ChildProcess} from "effect/process";
import {describe, expect, it} from "vitest";
import {attach, restart} from "../attach.ts";
import type {Down} from "../link.ts";
import {readToPage, type ToPage} from "../messages.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";
import {NotStopped, stopHost} from "./stop.ts";

// "Stop the old host and start this one", on a fresh home of each test's own. The host stopped is
// a real process this test started, as the app starts one (host/main.ts, run as plain Node), so
// its pid is a pid of this test's own. No other process is ever sent a signal: a pid file beside
// a socket nobody answers on is left alone, and a pid file that names this process is refused.

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** A fresh home, with the host's paths in it. Short, as a socket path is 103 bytes at most. */
const freshHome = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "hs-"});
	return {home, paths: yield* pathsOf(home)};
});

/** A host process on `home`, as the app starts one. Killed with the scope, if it still runs. */
const hostProcess = (home: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const main = yield* path.fromFileUrl(new URL("./main.ts", import.meta.url));
		return yield* ChildProcess.make(process.execPath, [main], {
			env: {FABRIKA_HOME: home},
			extendEnv: true,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			forceKillAfter: "3 seconds",
		});
	});

/** The pid in the home's pid file, or "" when there is none. */
const pidIn = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return (yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))).trim();
	});

/** Done once a host answers on `sock`, a few seconds at most. */
const live = (sock: string) =>
	reach(sock).pipe(
		Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("20 millis")}),
		Effect.timeoutOrElse({
			duration: "10 seconds",
			orElse: () => Effect.die(`nothing answered on ${sock}`),
		}),
	);

describe("stopping the old host", () => {
	it("stops the host by its pid, waits for it to exit, and the restart attaches to a new one", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const started: number[] = [];
				const start = Effect.gen(function* () {
					const host = yield* hostProcess(home);
					started.push(host.pid);
					return host.exitCode;
				});
				// The old host, and an app on it.
				const before = yield* attach({home, deliver: () => {}, start});
				const old = yield* pidIn(paths.pid);
				const again = yield* restart({home, deliver: () => {}, start});
				const now = yield* pidIn(paths.pid);
				const ended = yield* before.wire.ended.pipe(Effect.timeout("5 seconds"));
				return {
					started: started.map(String),
					old,
					now,
					state: again.wire.state().at,
					found: again.found,
					ended,
				};
			}),
		);
		expect(seen.started).toHaveLength(2);
		expect(seen.old).toBe(seen.started[0]);
		// The pid file names the new host, so the old one wrote nothing over it as it went.
		expect(seen.now).toBe(seen.started[1]);
		expect(seen.state).toBe("up");
		expect(seen.found).toEqual({kind: "up"});
		// The app on the old host saw its link end, as the host went.
		expect(seen.ended).toBeTypeOf("string");
	});

	// Tracker 185b, PR 5: every restart reads the same. The person's, from the window, leaves the
	// note an agent's restart leaves (host/restart.json), with the person as who and no why; the
	// next host shows it once in the top bar's host lines.
	it("leaves the person's restart for the next host to say, with who and no why, once", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				const start = Effect.gen(function* () {
					const host = yield* hostProcess(home);
					return host.exitCode;
				});
				yield* attach({home, deliver: () => {}, start});
				const got: Down[] = [];
				const again = yield* restart({home, deliver: (m) => got.push(m), start});
				again.wire.send({type: "page"});
				/** The host as it last said of itself, for the top bar. */
				const hostNow = () =>
					got
						.flatMap((m): ToPage[] => {
							if (m.type !== "to" || m.port !== "desk") {
								return [];
							}

							const read = readToPage(m.m);
							return read.kind === "read" ? [read.msg] : [];
						})
						.findLast((m) => m.type === "host");
				let now: ToPage | undefined;

				for (let i = 0; i < 400 && now === undefined; i += 1) {
					now = hostNow();

					if (now === undefined) {
						yield* Effect.sleep("25 millis");
					}
				}

				const kept = yield* fs.exists(`${paths.dir}/restart.json`);
				return {now, kept};
			}),
		);
		// made up: `HostNow.restarted`'s fields, restart.json's `{by, why, at}`.
		const restarted = seen.now?.type === "host" ? Reflect.get(seen.now.now, "restarted") : null;
		expect(restarted).toMatchObject({by: "user:owner", why: null});
		expect(seen.kept).toBe(false);
	});

	// Owed by the mutation step on PR 382.
	it("takes the person's note back when the stop fails: no restart happened", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				// A host in this test's process: its pid file names this process, so the stop is refused.
				const scope = yield* Scope.make();
				yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(scope));
				yield* live(paths.sock);
				const failed = yield* restart({
					home,
					deliver: () => {},
					start: Effect.die("no host is started when the stop fails"),
				}).pipe(Effect.flip);
				const kept = yield* fs.exists(`${paths.dir}/restart.json`);
				const after = yield* reach(paths.sock);
				yield* Scope.close(scope, Exit.void);
				return {failed, kept, after};
			}),
		);
		expect(seen.failed).toBeInstanceOf(NotStopped);
		expect(seen.kept).toBe(false);
		expect(seen.after).toBe("live");
	});

	it("restarts all the same when the person's note cannot be written, and the next host names no restart", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				const started: number[] = [];
				const start = Effect.gen(function* () {
					const host = yield* hostProcess(home);
					started.push(host.pid);
					return host.exitCode;
				});
				yield* attach({home, deliver: () => {}, start});
				// The note is written beside, then moved over: a folder where it is written beside.
				yield* fs.makeDirectory(`${paths.dir}/restart.json.new`);
				const got: Down[] = [];
				const again = yield* restart({home, deliver: (m) => got.push(m), start});
				again.wire.send({type: "page"});
				let now: ToPage | undefined;

				for (let i = 0; i < 400 && now === undefined; i += 1) {
					now = got
						.flatMap((m): ToPage[] => {
							if (m.type !== "to" || m.port !== "desk") {
								return [];
							}

							const read = readToPage(m.m);
							return read.kind === "read" ? [read.msg] : [];
						})
						.findLast((m) => m.type === "host");

					if (now === undefined) {
						yield* Effect.sleep("25 millis");
					}
				}

				return {started: started.length, state: again.wire.state().at, now};
			}),
		);
		expect(seen.started).toBe(2);
		expect(seen.state).toBe("up");
		expect(seen.now?.type).toBe("host");
		// None, as null or left out.
		const restarted = seen.now?.type === "host" ? Reflect.get(seen.now.now, "restarted") : "none";
		expect(restarted ?? null).toBeNull();
	});

	it("sends nothing when no host answers, though a pid file names a live process", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const {home, paths} = yield* freshHome;
				yield* fs.makeDirectory(paths.dir, {recursive: true, mode: 0o700});
				// A live process of this test's own, named by a pid file left behind: no host is there.
				const sleeper = yield* ChildProcess.make(
					process.execPath,
					["-e", "setTimeout(() => {}, 60000)"],
					{stdin: "ignore", stdout: "ignore", stderr: "ignore"},
				);
				yield* fs.writeFileString(paths.pid, `${sleeper.pid}\n`);
				const answer = yield* stopHost(home);
				const running = yield* sleeper.isRunning;
				return {answer, running};
			}),
		);
		expect(seen).toEqual({answer: "none", running: true});
	});

	it("refuses a pid file that names this very process", async () => {
		const failed = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				// A host in this test's process writes this process's pid, as host.test.ts's hosts do.
				const scope = yield* Scope.make();
				yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(scope));
				yield* live(paths.sock);
				const answer = yield* stopHost(home).pipe(Effect.flip);
				const after = yield* reach(paths.sock);
				yield* Scope.close(scope, Exit.void);
				return {answer, after};
			}),
		);
		expect(failed.answer).toBeInstanceOf(NotStopped);
		expect(failed.after).toBe("live");
	});
});
