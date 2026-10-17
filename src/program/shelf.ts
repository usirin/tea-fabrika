import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {Store} from "@demlik/tea";
import {fileStore} from "@demlik/tea/node";

// Where a program's runs keep what must outlive the process: each machine
// run's state, by run id, machine name and key, and which inputs the starter
// closed. The starter hands one to `start` with the run's id, the way a Unix
// daemon is handed its spool directory: start it again with the same id and
// the same shelf, and it finds its unfinished work where it left it.
//
// A shelf only keeps. What a program does with what it finds (resume an
// unfinished machine, answer an ask again from a finished one) is the
// program's, in `main`.

export interface Shelf {
	/** Where one machine run keeps its state. The same names answer the same place, in this process and the next. */
	store<S>(run: string, machine: string, key: string): Store<S>;
	/** The keys kept for one machine of a run. In no promised order. */
	keys(run: string, machine: string): readonly string[];
	/** The inputs of a run its starter closed. */
	closed(run: string): readonly string[];
	/** Mark an input closed. Kept before it returns, so a close is never lost to a crash right after it. */
	close(run: string, input: string): void;
}

/**
 * A shelf in memory: it outlives a run in this process, not the process. Each
 * state is kept as JSON and read back as a copy, so a test that kills a run
 * and starts it again sees only what was saved, never a live object.
 */
export function memoryShelf(): Shelf {
	const states = new Map<string, Map<string, string>>();
	const closed = new Map<string, Set<string>>();
	const at = (run: string, machine: string) => {
		const name = JSON.stringify([run, machine]);
		const found = states.get(name) ?? new Map<string, string>();
		states.set(name, found);
		return found;
	};
	return {
		store: <S>(run: string, machine: string, key: string): Store<S> => ({
			load: async () => {
				const saved = at(run, machine).get(key);
				return saved === undefined ? null : JSON.parse(saved);
			},
			save: async (state) => {
				at(run, machine).set(key, JSON.stringify(state));
			},
			migrate: (raw) => raw as S | null,
		}),
		keys: (run, machine) => [...at(run, machine).keys()],
		closed: (run) => [...(closed.get(run) ?? [])],
		close: (run, input) => {
			closed.set(run, new Set([...(closed.get(run) ?? []), input]));
		},
	};
}

const SUFFIX = ".json";
const named = (part: string) => encodeURIComponent(part);

/**
 * A shelf in a folder: one JSON file per machine run, under
 * `<dir>/<run>/<machine>/<key>.json`, and the closed inputs in
 * `<dir>/<run>/closed.json`. Each name is URI-encoded, so a key with a `/`
 * in it is one file.
 */
export function fileShelf(dir: string): Shelf {
	const machineDir = (run: string, machine: string) => join(dir, named(run), named(machine));
	const closedFile = (run: string) => join(dir, named(run), "closed.json");
	const closedOf = (run: string): readonly string[] =>
		existsSync(closedFile(run)) ? JSON.parse(readFileSync(closedFile(run), "utf8")) : [];
	return {
		store: <S>(run: string, machine: string, key: string) =>
			fileStore<S>(
				join(machineDir(run, machine), `${named(key)}${SUFFIX}`),
				(raw) => raw as S | null,
			),
		keys: (run, machine) =>
			existsSync(machineDir(run, machine))
				? readdirSync(machineDir(run, machine))
						.filter((file) => file.endsWith(SUFFIX))
						.map((file) => decodeURIComponent(file.slice(0, -SUFFIX.length)))
				: [],
		closed: closedOf,
		close: (run, input) => {
			const now = closedOf(run);
			if (now.includes(input)) return;
			mkdirSync(join(dir, named(run)), {recursive: true});
			writeFileSync(closedFile(run), JSON.stringify([...now, input]));
		},
	};
}
