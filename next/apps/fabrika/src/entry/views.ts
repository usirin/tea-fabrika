// The app's window choices, next/ (Tier 1, P14): which program window draws which fixed process,
// and the fixed layout a tab folds. No decoder, key rule or access rule lives here; the packages
// hold those. `?layout=` picks a fixed test arrangement of the same real counters.
import {counterWindow} from "@kampus/counter/window";
import {split, type TileWindow, tile, type Tree} from "@kampus/tuval";
import {Schema} from "effect";

/** The registered window of each program the brain starts. */
const windows: Readonly<Record<string, TileWindow>> = {counter: counterWindow};

/** The fixed processes the brain bootstraps (src/runtime.ts), by registered name. */
const processes: Readonly<Record<string, string>> = {
	"counter:1": "counter",
	"counter:2": "counter",
};

export const windowFor = (pid: string): TileWindow | null => {
	const program = processes[pid];
	return program === undefined ? null : (windows[program] ?? null);
};

/** The two counters side by side: the window's layout. The others are test arrangements. */
const row = split("row", 50, tile("left", "counter:1"), tile("right", "counter:2"));

const layouts: Readonly<Record<string, Tree>> = {
	row,
	one: tile("one", "counter:1"),
	col: split("col", 50, tile("top", "counter:1"), tile("bottom", "counter:2")),
	grid: split(
		"col",
		50,
		split("row", 50, tile("a", "counter:1"), tile("b", "counter:2")),
		split("row", 50, tile("c", "counter:1"), tile("d", "counter:2")),
	),
};

export const layoutFor = (query: string | null): Tree =>
	(query === null ? undefined : layouts[query]) ?? row;

/** Each tile's view check: its program window's own data schema. A pid with no window shows
 *  nothing, so any view it is sent is refused. */
export const checks = {
	decode: (pid: string): ((view: unknown) => unknown) => {
		const window = windowFor(pid);
		return window === null
			? () => {
					throw new Error(`no window for ${pid}`);
				}
			: Schema.decodeUnknownSync(window.data);
	},
};

/** A window's default key rows, one per bound command. */
const rows = (window: TileWindow): ReadonlyArray<{command: string; keys: ReadonlyArray<string>}> =>
	Object.entries(window.keys).flatMap(([command, keys]) =>
		keys === undefined ? [] : [{command, keys}],
	);

/** The default key rows of every registered window, and the commands each pid's window takes. */
export const ctx = {
	keys: {
		defaults: Object.fromEntries(
			Object.values(windows)
				.flatMap(rows)
				.map((row) => [row.command, row.keys]),
		),
		commands: (pid: string) => {
			const window = windowFor(pid);
			return window === null ? [] : rows(window).map((row) => row.command);
		},
	},
};
