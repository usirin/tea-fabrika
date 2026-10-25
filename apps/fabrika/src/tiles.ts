import {Ledger, type Storage} from "@kampus/fabrika";
import {Effect, Exit, Scope} from "effect";
import type {TileId} from "./desk/layout/index.ts";
import type {SharedHistory} from "./editor/history.ts";
import {type Host, type Screen, startHost, type WindowScreen} from "./host.ts";
import type {ToDesk, ToTerminal} from "./messages.ts";

// The tiles in the main process: one host (host.ts), so one tsh with its own jobs, per tile the
// desk opened, as tmux runs one shell per pane. History is shared: a line typed in one tile is in
// every tile's Ctrl-R. It names no platform, so a test drives it with no Electron (tiles.test.ts);
// main.ts hands it the ports and the folders.
//
//   const tiles = yield* startTiles({history, place, edge});
//   yield* tiles.open("t1")       t1's tsh starts on its own folder: edge.terminal("t1", screen)
//   // t1 runs `counter &`:       edge.view("counter:1a2b", screen), and the desk is told
//   //                            {type: "beside", tile: "t1", run: {id: "counter:1a2b", program: "counter"}}
//   yield* tiles.stop("counter:1a2b")
//   // the run ends:              edge.gone("run:counter:1a2b"), the desk is told {type: "over", ...}
//   yield* tiles.close("t1")      t1's tsh ends with its runs, and its folder goes
//
// What a tile's tsh keeps is in its own folder, so the next start of the app finds the tile's jobs
// "from an earlier tsh, not running", for `attach`. Closing a tile drops them, as tmux's
// kill-pane ends what ran in the pane. Quitting the app keeps them: the scope every tile is in
// closes, which stops each tsh the way the app's quit always has.

/** Where one tile keeps its jobs, and how they go when the tile closes. */
export interface Place {
	readonly jobs: Storage;
	readonly drop: Effect.Effect<void>;
}

/** What the tiles need of the edge: a way to tell the desk, and ports for the page. */
export interface Edge {
	/** Tell the desk, on its port. */
	readonly tell: (m: ToDesk) => void;
	/** A tile's terminal: give the page a port for it, named `tile:<id>`. A second call is a fresh port. */
	readonly terminal: (tile: TileId, screen: Screen<ToTerminal>) => void;
	/** A run's view: give the page a port for it, named `run:<id>`. */
	readonly view: (run: string, screen: WindowScreen) => void;
	/** The port of that name goes: its tile closed, or its run ended. */
	readonly gone: (name: string) => void;
}

export interface Tiles {
	/** Start the tile's tsh, or show the one that runs on a fresh port. */
	readonly open: (tile: TileId) => Effect.Effect<void>;
	/** End the tile's tsh and its runs, and drop its jobs. A tile not open changes nothing. */
	readonly close: (tile: TileId) => Effect.Effect<void>;
	/** Stop one run, whichever tile's tsh started it. */
	readonly stop: (run: string) => Effect.Effect<void>;
	/** Tell the desk again what runs now: its page was loaded again, and knows only what was kept. */
	readonly replay: Effect.Effect<void>;
}

/** A run with a view, as the tiles hold it while it runs. */
interface Live {
	readonly tile: TileId;
	readonly program: string;
	readonly placed: "foreground" | "background";
	readonly screen: WindowScreen;
}

/** One tile's tsh: its host, the scope it runs in, and how many jobs run now. */
interface Running {
	readonly host: Host;
	readonly scope: Scope.Closeable;
	readonly drop: Effect.Effect<void>;
	running: number;
}

const told = (tile: TileId, run: string, live: Live): ToDesk => ({
	type: live.placed === "foreground" ? "covered" : "beside",
	tile,
	run: {id: run, program: live.program},
});

export const startTiles = (options: {
	readonly history: SharedHistory;
	readonly place: (tile: TileId) => Place;
	readonly edge: Edge;
}) =>
	Effect.gen(function* () {
		const {history, place, edge} = options;
		const parent = yield* Effect.scope;
		const ledger = yield* Ledger;
		const open = new Map<TileId, Running>();
		const live = new Map<string, Live>();

		/** A run is over: its port goes and the desk is told, once, whoever saw it end first. */
		const over = (run: string) => {
			if (!live.delete(run)) return;
			edge.gone(`run:${run}`);
			edge.tell({type: "over", run});
		};

		const startOne = (tile: TileId) =>
			Effect.gen(function* () {
				const scope = yield* Scope.fork(parent);
				const {jobs, drop} = place(tile);
				const host = yield* startHost({
					jobs,
					history,
					runs: {
						began: (run, program, placed, screen) => {
							const one: Live = {tile, program, placed, screen};
							live.set(run, one);
							edge.view(run, screen);
							edge.tell(told(tile, run, one));
						},
						ended: over,
						running: (count) => {
							const now = open.get(tile);
							if (now !== undefined) now.running = count;
							edge.tell({type: "jobs", tile, running: count});
						},
					},
				}).pipe(Scope.provide(scope), Effect.provideService(Ledger, ledger));
				open.set(tile, {host, scope, drop, running: 0});
				// tsh ended on its own: `exit`, or Ctrl-D. The desk closes the tile, and asks to close it here.
				yield* host.ended.pipe(
					Effect.andThen(Effect.sync(() => edge.tell({type: "ended", tile}))),
					Effect.forkIn(scope),
				);
				return host;
			});

		const tiles: Tiles = {
			// A tsh whose jobs cannot be read does not start: the tile stays blank, and the folder is
			// left as it is, to be looked at. It is not dropped: that would lose the jobs for good.
			open: (tile) =>
				Effect.gen(function* () {
					const host = open.get(tile)?.host ?? (yield* startOne(tile));
					edge.terminal(tile, host.terminal);
				}).pipe(Effect.catch((e) => Effect.logError(`fabrika: ${tile}'s tsh could not start`, e))),
			close: (tile) =>
				Effect.gen(function* () {
					const one = open.get(tile);
					if (one === undefined) return;
					open.delete(tile);
					yield* Scope.close(one.scope, Exit.void);
					// The scope closing interrupts the runs, and a run interrupted may end before its host
					// says so. Every run of the tile is over now, said or not.
					for (const [run, it] of [...live]) if (it.tile === tile) over(run);
					edge.gone(`tile:${tile}`);
					yield* one.drop;
				}),
			stop: (run) =>
				Effect.suspend(() => {
					const one = live.get(run);
					const host = one === undefined ? undefined : open.get(one.tile)?.host;
					return host === undefined ? Effect.void : host.stop(run);
				}),
			replay: Effect.sync(() => {
				for (const [run, one] of live) {
					edge.view(run, one.screen);
					edge.tell(told(one.tile, run, one));
				}
				for (const [tile, one] of open) edge.tell({type: "jobs", tile, running: one.running});
			}),
		};
		return tiles;
	});
