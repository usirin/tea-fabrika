import {execFileSync} from "node:child_process";
import {Effect} from "effect";
import type {Reaper} from "./turn.ts";

// The processes under an agent, found with `ps` and ended with a signal: the
// part of the interface's stop (./core.ts) that needs the machine. A maker's
// own stop does not always end the commands its agent started (experiment
// 152: Codex on SIGTERM; 153: ACP's cancel), so the stop finds them first and
// kills what outlives the maker's stop.
//
// Node at the edge, said out loud: `ps` by `execFileSync` and `process.kill`,
// on macOS and Linux. Nothing else here touches the machine.

/** Every process's parent, from one `ps`. */
const parents = (): ReadonlyMap<number, number> => {
	const out = String(execFileSync("ps", ["-axo", "pid=,ppid="], {timeout: 5_000}));
	const map = new Map<number, number>();
	for (const line of out.split("\n")) {
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (pid !== undefined && ppid !== undefined && Number.isFinite(pid)) map.set(pid, ppid);
	}
	return map;
};

/** The pids under `root`, at any depth, not `root` itself. */
export const under = (root: number, map: ReadonlyMap<number, number>): number[] => {
	const found: number[] = [];
	const queue = [root];
	while (queue.length > 0) {
		const at = queue.shift() as number;
		for (const [pid, ppid] of map)
			if (ppid === at && pid !== root && !found.includes(pid)) {
				found.push(pid);
				queue.push(pid);
			}
	}
	return found;
};

const isAlive = (pid: number) => {
	// biome-ignore lint/plugin: signal 0 asks only whether the process is there; a throw is the answer "no"
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const killOne = (pid: number) => {
	// biome-ignore lint/plugin: a process that ended between the check and the kill throws; that is the goal reached
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone.
	}
};

export const psReaper: Reaper = {
	tree: (pid) => Effect.sync(() => under(pid, parents())).pipe(Effect.orElseSucceed(() => [])),
	alive: (pids) => Effect.sync(() => pids.filter(isAlive)),
	kill: (pids) =>
		Effect.sync(() => {
			for (const pid of pids) killOne(pid);
		}),
};
