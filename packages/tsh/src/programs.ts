import {Context} from "effect";
import type {Entry} from "../../tea-program/src/listed.ts";
import type {Ended} from "../../tea-program/src/program.ts";
import type {Storage} from "../../tea-program/src/storage.ts";
import {BUILTINS} from "./grammar.ts";

// The program list: what tsh can start by name, like the directories on a
// shell's PATH. Each entry is a program packed with the services it asks for
// (../program/listed.ts), so a program cannot be listed without what it
// needs. tsh starts every program through its entry and never sees a service.
//
//   const list = programList([
//     listed(shipProgram, Layer.mergeAll(gitHubCodeHost(accounts), noWrites)),
//     listed(seq, Layer.empty),
//   ]);

/** The programs tsh can start, by name. */
export type ProgramList = ReadonlyMap<string, Entry>;

/**
 * Make a program list. Two programs with one name, or a program named like a
 * built-in (`jobs`, `tell`, ...), is refused here, when the list is made:
 * a name on a line must mean one thing.
 */
export function programList(entries: readonly Entry[]): ProgramList {
	const list = new Map<string, Entry>();
	for (const entry of entries) {
		const {name} = entry.program;
		if ((BUILTINS as readonly string[]).includes(name))
			throw new Error(`a program cannot be named ${name}: that is a tsh built-in`);
		if (list.has(name)) throw new Error(`two programs are named ${name}`);
		if (!/^[a-z][a-z0-9-]*$/.test(name))
			throw new Error(`a program on a tsh line is named in small letters, digits and -: ${name}`);
		list.set(name, entry);
	}
	return list;
}

/** The program list tsh starts programs from. Whoever starts tsh provides it. */
export class Programs extends Context.Service<Programs, ProgramList>()("tsh/Programs") {}

/**
 * Where tsh's jobs keep what must outlive tsh: each job's run id names its
 * run in this storage, so a job started again under the same id finds what
 * it left, like a daemon handed its spool directory.
 */
export class JobStorage extends Context.Service<JobStorage, Storage>()("tsh/JobStorage") {}

/** How a run ended, as a shell's exit status: 0 ended, 1 failed, 130 stopped (as by Ctrl-C). */
export const statusOf = (ended: Ended<unknown>): number =>
	ended.kind === "ended" ? 0 : ended.kind === "stopped" ? 130 : 1;

/**
 * How a job of several programs ended: the status of the last one that did
 * not end well, or 0. bash's `pipefail`, on always: in a typed pipe, a stage
 * that failed (one that sent a value the next refused) is the line's failure,
 * even when the last stage ended well on what it got.
 */
export const statusOfJob = (ends: readonly Ended<unknown>[]): number =>
	ends.reduce((status, ended) => (statusOf(ended) === 0 ? status : statusOf(ended)), 0);
