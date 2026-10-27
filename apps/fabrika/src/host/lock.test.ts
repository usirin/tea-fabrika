import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, Exit, Fiber, FileSystem, Layer, Scope} from "effect";
import {ChildProcess} from "effect/process";
import {describe, expect, it} from "vitest";
import {holdLock, Locked} from "./lock.ts";
import {pathsOf} from "./socket.ts";

// The host's start lock, on real files in a fresh home of each test's own. One holder at a time:
//
//   yield* holdLock(paths.lock, paths.dir)   <home>/host/lock holds our pid, until the scope closes
//   a second holdLock                         waits while the holder's pid lives, then takes it
//   a lock left by a pid that is gone         taken at once
//   a lock a live pid holds past 10 s         Locked {lock, pid}
//
// The only processes are short ones of the test's own: one that has exited, for a pid that is
// gone, and one that sleeps, for a live pid that is not ours. Both go with the test's scope.

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** A fresh home, with the host's folder made, as the host makes it. */
const freshHome = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "lk-"});
	const paths = yield* pathsOf(home);
	yield* fs.makeDirectory(paths.dir, {recursive: true, mode: 0o700});
	return paths;
});

/** What a lock file says, or null when there is none. */
const lockText = (lock: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		if (!(yield* fs.exists(lock))) return null;
		return yield* fs.readFileString(lock);
	});

const ours = `${process.pid}\n`;

describe("the start lock", () => {
	it("lets one holder in at a time: eight at once never overlap", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const paths = yield* freshHome;
				let inside = 0;
				let most = 0;
				const overlaps: number[] = [];
				const one = Effect.gen(function* () {
					yield* holdLock(paths.lock, paths.dir);
					inside += 1;
					most = Math.max(most, inside);
					yield* Effect.sleep("30 millis");
					if (inside !== 1) overlaps.push(inside);
					inside -= 1;
				}).pipe(Effect.scoped);
				yield* Effect.all(
					Array.from({length: 8}, () => one),
					{concurrency: "unbounded"},
				);
				return {most, overlaps, after: yield* lockText(paths.lock)};
			}),
		);
		expect(seen).toEqual({most: 1, overlaps: [], after: null});
	});

	it("holds our pid and a newline while held, and is gone once the scope closes", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const paths = yield* freshHome;
				const scope = yield* Scope.make();
				yield* holdLock(paths.lock, paths.dir).pipe(Scope.provide(scope));
				const held = yield* lockText(paths.lock);
				yield* Scope.close(scope, Exit.void);
				return {held, after: yield* lockText(paths.lock)};
			}),
		);
		expect(seen).toEqual({held: ours, after: null});
	});

	it("makes a second holder wait, and lets it in once the first lets go", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const paths = yield* freshHome;
				const first = yield* Scope.make();
				yield* holdLock(paths.lock, paths.dir).pipe(Scope.provide(first));
				const second = yield* Scope.make();
				const waiting = yield* holdLock(paths.lock, paths.dir).pipe(
					Scope.provide(second),
					Effect.forkScoped,
				);
				yield* Effect.sleep("200 millis");
				const early = waiting.pollUnsafe();
				const letGo = Date.now();
				yield* Scope.close(first, Exit.void);
				yield* Fiber.join(waiting);
				const took = Date.now() - letGo;
				const held = yield* lockText(paths.lock);
				yield* Scope.close(second, Exit.void);
				return {early, took, held, after: yield* lockText(paths.lock)};
			}),
		);
		expect(seen.early).toBeUndefined();
		expect(seen.took).toBeLessThan(1000);
		expect(seen.held).toBe(ours);
		expect(seen.after).toBeNull();
	});

	it("takes a lock left by a process that is gone at once", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const paths = yield* freshHome;
				// A pid that is gone: a Node process that ran nothing, and exited.
				const gone = yield* ChildProcess.make(process.execPath, ["-e", ""], {
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
				});
				yield* gone.exitCode;
				yield* fs.writeFileString(paths.lock, `${gone.pid}\n`);
				const before = yield* lockText(paths.lock);
				const from = Date.now();
				yield* holdLock(paths.lock, paths.dir);
				return {
					before,
					dead: `${gone.pid}\n`,
					took: Date.now() - from,
					held: yield* lockText(paths.lock),
				};
			}),
		);
		expect(seen.before).toBe(seen.dead);
		expect(seen.took).toBeLessThan(500);
		expect(seen.held).toBe(ours);
	});

	it("fails with Locked after 10 s while a live process not ours holds it", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const paths = yield* freshHome;
				// A live pid that is not ours: a Node process that sleeps, killed with the test's scope.
				const other = yield* ChildProcess.make(
					process.execPath,
					["-e", "setInterval(() => {}, 1000)"],
					{stdin: "ignore", stdout: "ignore", stderr: "ignore", forceKillAfter: "2 seconds"},
				);
				const text = `${other.pid}\n`;
				yield* fs.writeFileString(paths.lock, text);
				const from = Date.now();
				const failed = yield* holdLock(paths.lock, paths.dir).pipe(Effect.flip);
				const took = Date.now() - from;
				const still = yield* lockText(paths.lock);
				const runs = yield* other.isRunning;
				return {failed, took, pid: other.pid, lock: paths.lock, text, still, runs};
			}),
		);
		expect(seen.failed).toBeInstanceOf(Locked);
		expect(seen.failed).toMatchObject({lock: seen.lock, pid: seen.pid});
		expect(seen.took).toBeGreaterThanOrEqual(9900);
		expect(seen.took).toBeLessThan(15_000);
		// The other's lock is left as it was, and the other runs on.
		expect(seen.still).toBe(seen.text);
		expect(seen.runs).toBe(true);
	});
});
