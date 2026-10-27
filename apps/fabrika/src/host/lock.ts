import {Clock, Effect, FileSystem, Predicate, Schema} from "effect";

// The lock a host holds while it starts: from the moment it looks at the socket until it
// listens on it (host/run.ts). Two hosts started at once on one home take turns, so the second
// finds the first one listening and steps aside, and no host ever removes a socket another host
// listens on. tmux does the same: its client takes `<socket>.lock` before it looks at a dead
// socket, and the server it starts lets go only once it listens (`client_get_lock` in tmux's
// client.c, and `server_start` in server.c).
//
//   yield* holdLock(paths.lock, paths.dir)
//   // <home>/host/lock made, holding this process's pid, until the scope closes
//   // held by a live process: tried again every 20 ms, for 10 s at most, then Locked
//   // held by a process that is gone (it crashed while it started): removed, then taken
//
// tmux's lock is flock(2), which the kernel lets go of when its process dies. Node has no flock,
// so the lock is a file made by a hard link, which either makes the name or fails if the name is
// there (link(2)). The file is written in full under a name of its own first, so a lock is never
// seen half written. A lock whose pid is gone is taken over, as Chromium's single-instance lock
// does with the pid in its `SingletonLock` (process_singleton_posix.cc).
//
// The gap left, as in Chromium's and in proper-lockfile's own (a lock left by a dead process is
// removed, then made again): two hosts that find the same dead lock at the same moment can both
// remove it, and the second can remove the lock the first just made. It needs a host to die in
// the few ms it holds the lock, and two more to start in that same moment.
//
// Node at its thinnest edge, said here: `process.pid`, and `process.kill(pid, 0)`, which sends
// no signal and only asks whether that pid is alive. Effect's platform has neither.

/** Another process held the lock for longer than a host takes to start. */
export class Locked extends Schema.TaggedError<Locked>()("Locked", {
	lock: Schema.String,
	pid: Schema.Number,
}) {}

/** How long a host waits for another host to finish starting. Starting takes a few ms. */
const LOCK_WITHIN_MS = 10_000;

/** Is a process with this pid alive? `EPERM` means it is, and belongs to someone else. */
const alive = (pid: number) =>
	Effect.try({
		try: () => process.kill(pid, 0),
		catch: (e) => (Predicate.hasProperty(e, "code") ? String(e.code) : "unknown"),
	}).pipe(
		Effect.as(true),
		Effect.catch((code) => Effect.succeed(code === "EPERM")),
	);

/** What one try to take the lock came to: taken, held by a live pid, or worth a new try now. */
type Try =
	| {readonly at: "taken"}
	| {readonly at: "held"; readonly pid: number}
	| {readonly at: "again"};

const tryLock = (lock: string, dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const mine = yield* fs.makeTempFileScoped({directory: dir, prefix: "lock-"});
		yield* fs.writeFileString(mine, `${process.pid}\n`);
		const linked = yield* fs.link(mine, lock).pipe(
			Effect.as(true),
			Effect.catchIf(
				(e) => e.reason._tag === "AlreadyExists",
				() => Effect.succeed(false),
			),
		);
		if (linked) return {at: "taken"} satisfies Try;
		const text = yield* fs.readFileString(lock).pipe(
			Effect.catchIf(
				(e) => e.reason._tag === "NotFound",
				() => Effect.succeed(null),
			),
		);
		// Let go of between the link and the read.
		if (text === null) return {at: "again"} satisfies Try;
		const pid = Number.parseInt(text, 10);
		if (Number.isInteger(pid) && (yield* alive(pid))) return {at: "held", pid} satisfies Try;
		// Its process is gone, or it is no lock this code wrote: no one will let go of it.
		yield* fs.remove(lock).pipe(
			Effect.catchIf(
				(e) => e.reason._tag === "NotFound",
				() => Effect.void,
			),
		);
		return {at: "again"} satisfies Try;
	}).pipe(Effect.scoped);

/** Wait for the lock, and take it. */
const takeLock = (lock: string, dir: string) =>
	Effect.gen(function* () {
		const until = (yield* Clock.currentTimeMillis) + LOCK_WITHIN_MS;
		for (;;) {
			const tried: Try = yield* tryLock(lock, dir);
			if (tried.at === "taken") return;
			if (tried.at === "held") {
				if ((yield* Clock.currentTimeMillis) > until)
					return yield* new Locked({lock, pid: tried.pid});
				yield* Effect.sleep("20 millis");
			}
		}
	});

/** Take the host's start lock at `lock`, in its folder `dir`, and hold it until the scope closes. */
export const holdLock = (lock: string, dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* Effect.acquireRelease(takeLock(lock, dir), () => fs.remove(lock).pipe(Effect.ignore));
	});
