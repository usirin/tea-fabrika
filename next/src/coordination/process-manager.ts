import type {Ledger} from "../data/project.ts";

// The process tree, as thin as this slice allows: only `start`, which records what ran under a
// name. Which code a process ran is a fact that exists only at write time. Links, monitors, exits
// and supervisors (C4, C5) come when something needs them.
//
//   start("counter:1", {program: "counter", hash: "9f3a..."})
//   {stream: "counter:1", kind: "started", body: {program: "counter", hash: "9f3a..."}}

export type ProcessManager = {
	start(pid: string, code: {readonly program: string; readonly hash: string}): Promise<void>;
};

export const createProcessManager = (ledger: Ledger): ProcessManager => ({
	start: async (pid, code) => {
		await ledger.append(pid, `started:${code.hash}`, {
			by: "brain",
			said: new Date().toISOString(),
			kind: "started",
			body: code,
		});
	},
});
