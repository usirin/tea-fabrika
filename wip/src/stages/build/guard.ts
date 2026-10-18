import {Socket} from "node:net";
import {runMain} from "@effect/platform-node/NodeRuntime";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Exit, Schedule} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";
import {runChild} from "../../child";

// The guard: the builder's own parent. It is a process of its own, started by
// `guarded` (./guarded.ts) where the Agent SDK would start `claude`, and it
// starts `claude` itself:
//
//   node guard.ts <lock> <wait> -- <claude> <args...>
//
// It does two jobs.
//
// 1. The builder stops with its run. The run's process holds the other end of
//    a pipe on the guard's fd 3 and never writes to it. However that process
//    ends, a `kill -9` too, the kernel closes its end, and the guard reads the
//    end of the pipe. Then, and on SIGTERM or SIGINT (the SDK's own stop),
//    the guard stops every process under `claude`, by process and by process
//    group: `claude` starts each Bash command in a session of its own, so its
//    group alone does not reach them. When `claude` ends by itself, what is
//    left of its group is stopped too.
//
// 2. One builder per working copy. Before `claude` starts, `perl` takes an
//    exclusive `flock` on the copy's lock file and then becomes `claude`
//    (exec), keeping the file open. The lock belongs to that open file, which
//    the kernel drops when the last process holding it ends: it cannot be
//    left behind by a crash, it holds no process id, and an empty file or a
//    file moved from another machine holds nothing. A second builder for the
//    same copy waits at most `wait` seconds for it (an old builder that is
//    still stopping), then is refused: `perl` exits 75 and says why on
//    stderr, in a line that starts with `held:`.
//
// Node has no flock, which is why `perl` takes it. SQLite's lock (node:sqlite)
// was tried and dropped: after a `kill -9` it left a journal beside the file,
// and the next open answered "database is locked" for good.
//
// Node at the edge here: `node:net`'s Socket reads fd 3, and `process.kill`
// sends the signals. The rest is Effect: the child process, its scope, the
// waits.

/** The exit code of a refused start: the copy is held by another live builder. */
export const HELD = 75;

/** perl: open the lock file, take the flock (waiting up to `wait` seconds), then become the command, the file still open. */
export const HOLD = [
	"use Fcntl qw(:flock);",
	"my ($file, $wait, @command) = @ARGV;",
	// fds above $^F are closed on exec; this one must stay open in the command.
	"$^F = 1023;",
	'open(my $lock, ">>", $file) or die "held: cannot open $file: $!\\n";',
	"my $tries = 0;",
	"until (flock($lock, LOCK_EX | LOCK_NB)) {",
	`  if ($tries++ >= $wait * 5) { print STDERR "held: the working copy is held by another live builder ($file); waited $wait seconds\\n"; exit ${HELD} }`,
	"  select(undef, undef, undef, 0.2);",
	"}",
	'exec { $command[0] } @command or die "cannot start $command[0]: $!\\n";',
].join(" ");

/** How long a stopped builder gets to end on SIGTERM before SIGKILL. */
const GRACE_MS = 2_000;

/** How often the guard reads the tree under `claude`, so a process left behind when `claude` itself ends is still known. */
const WATCH_EVERY = "2 seconds";

export interface Row {
	readonly pid: number;
	readonly ppid: number;
	readonly group: number;
	/** When it started, as `ps` prints it: with the pid, it tells one process from a later one given the same pid. */
	readonly started: string;
}

/** One line of `ps -A -o pid=,ppid=,pgid=,lstart=`. */
export const rowOf = (line: string): Row | null => {
	const [pid, ppid, group, ...started] = line.trim().split(/\s+/);
	const numbers = [pid, ppid, group].map(Number);
	const [p, pp, g] = numbers;
	if (p === undefined || pp === undefined || g === undefined || numbers.some(Number.isNaN))
		return null;
	return {pid: p, ppid: pp, group: g, started: started.join(" ")};
};

/** Every process on the machine, with its parent, its group and when it started. */
const table = runChild("ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart="], {
	env: {PATH: "/bin:/usr/bin", LC_ALL: "C"},
}).pipe(Effect.map((exited) => exited.out.split("\n").flatMap((line) => rowOf(line) ?? [])));

const same = (a: Row, b: Row) => a.pid === b.pid && a.started === b.started;

/** `root` and every process under it. */
export const under = (root: number, rows: readonly Row[]): Row[] => {
	const found = rows.filter((r) => r.pid === root);
	for (let i = 0; i < found.length; i++) {
		const parent = found[i]?.pid;
		for (const r of rows) if (r.ppid === parent && r.pid !== root) found.push(r);
	}
	return found;
};

/** Send `signal` to a process (a pid) or a group (a negative pid). Gone already is fine. */
const send = (target: number, signal: NodeJS.Signals | 0): boolean => {
	// biome-ignore lint/plugin: process.kill throws for a process that is gone; that is the answer, not a failure
	try {
		process.kill(target, signal);
		return true;
	} catch {
		return false;
	}
};

/**
 * What to stop: `root` and every process under it now, and every process
 * `seen` under it before that still runs (the same pid, started at the same
 * time), with its group. A process whose parent ended is no longer under
 * `root`, so only `seen` still knows it.
 */
export const toStop = (root: number, rows: readonly Row[], seen: readonly Row[]): Row[] => {
	const now = under(root, rows);
	const still = rows.filter((r) => seen.some((s) => same(s, r)) && !now.some((n) => same(n, r)));
	return [...now, ...still];
};

/**
 * Stop `root` and everything under it, now or before (`toStop`): SIGTERM to
 * each process and each of their groups, up to `GRACE_MS` to end, then
 * SIGKILL to what is left. The groups are read while the tree still stands,
 * so a process whose parent ends first is still reached through its group.
 * The guard's own group is never signalled.
 */
export const stopTree = (root: number, seen: () => readonly Row[] = () => []) =>
	Effect.gen(function* () {
		const rows = yield* table;
		const own = rows.find((r) => r.pid === process.pid)?.group;
		const tree = toStop(root, rows, seen());
		const targets = [
			...tree.map((r) => r.pid),
			...[...new Set(tree.map((r) => r.group))].filter((g) => g > 1 && g !== own).map((g) => -g),
		];
		if (targets.length === 0) return;
		for (const t of targets) send(t, "SIGTERM");
		yield* Effect.sync(() => targets.some((t) => send(t, 0))).pipe(
			Effect.repeat({
				schedule: Schedule.spaced("100 millis"),
				while: (alive) => alive,
				times: GRACE_MS / 100,
			}),
		);
		for (const t of targets) send(t, "SIGKILL");
	});

/** Ends when the run's end of fd 3 closes: the run's process is gone, however it ended. */
const lifeline = Effect.callback<void>((resume) => {
	const pipe = new Socket({fd: 3, readable: true, writable: false});
	const cut = () => resume(Effect.void);
	pipe.once("end", cut);
	pipe.once("close", cut);
	pipe.once("error", cut);
	pipe.resume();
	return Effect.sync(() => pipe.destroy());
});

/** The exit code when the run's process went away. Nobody reads it. */
const CUT = 1;

export const guard = (lock: string, wait: number, command: string, args: readonly string[]) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const agent = yield* spawner.spawn(
			ChildProcess.make("perl", ["-e", HOLD, lock, String(wait), command, ...args], {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
				forceKillAfter: GRACE_MS,
			}),
		);
		// Every process seen under `claude`, read every few seconds while it runs.
		const seen = new Map<string, Row>();
		yield* table.pipe(
			Effect.tap((rows) =>
				Effect.sync(() => {
					for (const r of under(agent.pid, rows)) seen.set(`${r.pid} ${r.started}`, r);
				}),
			),
			Effect.repeat(Schedule.spaced(WATCH_EVERY)),
			Effect.forkScoped,
		);
		// Runs before the spawn's own release (finalizers run last first): the
		// tree is read while `claude` still stands over it.
		yield* Effect.addFinalizer(() => stopTree(agent.pid, () => [...seen.values()]));
		return yield* Effect.raceFirst(
			agent.exitCode.pipe(
				Effect.map(Number),
				Effect.orElseSucceed(() => CUT),
			),
			lifeline.pipe(Effect.as(CUT)),
		);
	}).pipe(Effect.scoped);

/** `<lock> <wait> -- <command> <args...>` */
export const parseArgs = (argv: readonly string[]) => {
	const [lock, wait, dashes, command, ...args] = argv;
	if (lock === undefined || dashes !== "--" || command === undefined || !(Number(wait) >= 0))
		return null;
	return {lock, wait: Number(wait), command, args};
};

if (import.meta.main) {
	const asked = parseArgs(process.argv.slice(2));
	if (asked === null) {
		process.stderr.write("usage: guard.ts <lock> <wait seconds> -- <command> [args...]\n");
		process.exit(2);
	}
	runMain(
		guard(asked.lock, asked.wait, asked.command, asked.args).pipe(Effect.provide(nodeServices)),
		{
			disableErrorReporting: true,
			// The agent's own exit code, so the SDK reads how it ended as before.
			teardown: (exit, onExit) =>
				onExit(Exit.isSuccess(exit) && typeof exit.value === "number" ? exit.value : CUT),
		},
	);
}
