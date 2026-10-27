import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, Exit, FileSystem, Layer, Path, Schedule, Scope} from "effect";
import {ChildProcess} from "effect/process";
import type {ChildProcessHandle} from "effect/process/ChildProcessSpawner";
import {describe, expect, it} from "vitest";
import {attach} from "../attach.ts";
import {pathsOf, type Reached, reach} from "./socket.ts";

// One host per home, however many start at once. Each host here is a real process, started as
// the app starts one (host/main.ts, run as plain Node), on a fresh home of the test's own:
//
//   six hosts started at once on one home      one runs and listens; five exit; the pid file
//                                              names the one that runs
//   the same over a socket left by a crash     the same
//   six apps attaching at once                 all six come up, on the one host that runs
//   more hosts started while one serves        its socket answers, its app stays up
//
// A race does not show on every try, so a test runs a few rounds, each on a home of its own, and
// checks every round. Every process is killed with its round's scope, if it still runs. No real app home is ever used.

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

type Platform = Layer.Success<typeof platform>;

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Platform>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** How many hosts, or apps, start at once in a round. */
const N = 6;

/** How long a round waits for every host but one to exit. */
const SETTLE_MS = 6000;

/** A fresh home, with the host's paths in it. Short, as a socket path is 103 bytes at most. */
const freshHome = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "oh-"});
	return {home, paths: yield* pathsOf(home)};
});

/**
 * A host process on `home`, as the app starts one: host/main.ts on this Node, which is this
 * test's own binary, so the handle's pid is the host's. It runs at the test's own priority: run
 * the test at nice 15 on a laptop. Killed with the scope.
 */
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

const running = (host: ChildProcessHandle) =>
	host.isRunning.pipe(Effect.orElseSucceed(() => false));

/** The pid in the home's pid file, or "" when there is none. */
const pidIn = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return (yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))).trim();
	});

/** Done once a host answers on `sock`, within `ms`; false if none did. */
const answersWithin = (sock: string, ms: number) =>
	reach(sock).pipe(
		Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("20 millis")}),
		Effect.as(true),
		Effect.timeoutOrElse({duration: `${ms} millis`, orElse: () => Effect.succeed(false)}),
	);

/** What a round ends with, once every host but one exited, or the time to settle ran out. */
interface Settled {
	/** How many of the hosts started still run. */
	readonly running: number;
	/** What answers on the home's socket. */
	readonly sock: Reached;
	/** Whom the pid file names. */
	readonly pid: "the one running" | "another" | "none";
}

/** The round every test wants: one host runs, it answers, and the pid file names it. */
const ONE_HOST: Settled = {running: 1, sock: "live", pid: "the one running"};

const settle = (sock: string, pidFile: string, hosts: ReadonlyArray<ChildProcessHandle>) =>
	Effect.gen(function* () {
		const look = Effect.gen(function* () {
			const alive = yield* Effect.filter(hosts, running);
			const reached = yield* reach(sock);
			const pid = yield* pidIn(pidFile);
			const named: Settled["pid"] =
				pid === ""
					? "none"
					: alive.some((h) => String(h.pid) === pid)
						? "the one running"
						: "another";
			return {running: alive.length, sock: reached, pid: named} satisfies Settled;
		});
		const deadline = Date.now() + SETTLE_MS;
		let seen = yield* look;
		while (Date.now() < deadline && !(seen.running <= 1 && seen.sock === "live")) {
			yield* Effect.sleep("50 millis");
			seen = yield* look;
		}
		return seen;
	});

/**
 * A socket left by a host that crashed: a host process that listened, then SIGKILL. Its socket
 * file stays, and nothing listens on it.
 */
const staleSocket = (home: string, sock: string) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const host = yield* hostProcess(home).pipe(Scope.provide(scope));
		const up = yield* answersWithin(sock, 10_000);
		if (!up) return yield* Effect.die("the host to crash did not listen");
		yield* host.kill({killSignal: "SIGKILL"});
		yield* host.exitCode.pipe(Effect.ignore);
		yield* Scope.close(scope, Exit.void);
		return yield* reach(sock);
	});

/** One round: `N` host processes at once on a fresh home, then what is left. */
const hostsAtOnce = (stale: boolean) =>
	Effect.gen(function* () {
		const {home, paths} = yield* freshHome;
		if (stale) {
			const before = yield* staleSocket(home, paths.sock);
			if (before !== "stale") return yield* Effect.die(`the crashed host's socket was ${before}`);
		}
		const hosts = yield* Effect.all(
			Array.from({length: N}, () => hostProcess(home)),
			{concurrency: "unbounded"},
		);
		return yield* settle(paths.sock, paths.pid, hosts);
	}).pipe(Effect.scoped);

/** One round: `N` apps attach at once on a fresh home, each able to start a host process. */
const appsAtOnce = Effect.gen(function* () {
	const {home, paths} = yield* freshHome;
	const started: ChildProcessHandle[] = [];
	const start = Effect.gen(function* () {
		const host = yield* hostProcess(home);
		started.push(host);
		return host.exitCode;
	});
	const tries = yield* Effect.all(
		Array.from({length: N}, () => attach({home, deliver: () => {}, start}).pipe(Effect.exit)),
		{concurrency: "unbounded"},
	);
	const up = tries.filter((t) => Exit.isSuccess(t) && t.value.wire.state().at === "up").length;
	const settled = yield* settle(paths.sock, paths.pid, started);
	return {up, started: started.length, ...settled};
}).pipe(Effect.scoped);

/** Run `round` a few times, one after another, and answer what each ended with. */
const rounds = <A, E>(times: number, round: Effect.Effect<A, E, Platform>) =>
	Effect.forEach(Array.from({length: times}), () => round, {concurrency: 1});

describe("one host per home", () => {
	// Two tests of the same race, so each stays well under the time limit.
	it.each([1, 2])("six hosts started at once on a fresh home: one serves (part %i)", async () => {
		const seen = await go(rounds(4, hostsAtOnce(false)));
		expect(seen).toEqual(seen.map(() => ONE_HOST));
	});

	it("six hosts started at once over a socket left by a crash: one serves", async () => {
		const seen = await go(rounds(4, hostsAtOnce(true)));
		expect(seen).toEqual(seen.map(() => ONE_HOST));
	});

	it.each([1, 2])("six apps attaching at once all come up, on one host (part %i)", async () => {
		const seen = await go(rounds(3, appsAtOnce));
		// Each app may start a host; every host started but one exits.
		expect(seen.map(({started: _, ...rest}) => rest)).toEqual(
			seen.map(() => ({up: N, ...ONE_HOST})),
		);
		for (const round of seen) expect(round.started).toBeGreaterThanOrEqual(1);
	});

	it("more hosts started while one serves leave its socket, its app and its pid alone", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const first = yield* hostProcess(home);
				if (!(yield* answersWithin(paths.sock, 10_000)))
					return yield* Effect.die("the first host did not listen");
				const pid = String(first.pid);
				const starts: ChildProcessHandle[] = [];
				const start = Effect.gen(function* () {
					const host = yield* hostProcess(home);
					starts.push(host);
					return host.exitCode;
				});
				const app = yield* attach({home, deliver: () => {}, start});
				const after = [];
				for (let i = 0; i < 4; i += 1) {
					// Three more at once, each round, and each must exit on its own.
					const more = yield* Effect.all(
						Array.from({length: 3}, () => hostProcess(home)),
						{concurrency: "unbounded"},
					);
					const exited = yield* Effect.forEach(
						more,
						(h) =>
							h.exitCode.pipe(
								Effect.as(true),
								Effect.timeoutOrElse({duration: "5 seconds", orElse: () => Effect.succeed(false)}),
								Effect.orElseSucceed(() => false),
							),
						{concurrency: "unbounded"},
					);
					const next = yield* attach({home, deliver: () => {}, start}).pipe(Effect.exit);
					after.push({
						exited: exited.every((e) => e),
						firstRuns: yield* running(first),
						sock: yield* reach(paths.sock),
						app: app.wire.state().at,
						next: Exit.isSuccess(next) ? next.value.wire.state().at : "failed",
						pid: (yield* pidIn(paths.pid)) === pid,
					});
				}
				return {after, starts: starts.length};
			}),
		);
		expect(seen.after).toEqual(
			seen.after.map(() => ({
				exited: true,
				firstRuns: true,
				sock: "live",
				app: "up",
				next: "up",
				pid: true,
			})),
		);
		// Every app reached the first host: none had to start one.
		expect(seen.starts).toBe(0);
	});

	it("a socket left by a host that was killed is taken over by the next host started", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const {home, paths} = yield* freshHome;
				const before = yield* staleSocket(home, paths.sock);
				const started: ChildProcessHandle[] = [];
				const {wire} = yield* attach({
					home,
					deliver: () => {},
					start: Effect.gen(function* () {
						const host = yield* hostProcess(home);
						started.push(host);
						return host.exitCode;
					}),
				});
				const pid = yield* pidIn(paths.pid);
				return {
					before,
					state: wire.state().at,
					started: started.length,
					named: started.some((h) => String(h.pid) === pid),
				};
			}),
		);
		expect(seen).toEqual({before: "stale", state: "up", started: 1, named: true});
	});
});
