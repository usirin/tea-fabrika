import {Ledger, type Storage} from "@kampus/fabrika";
import {Effect, Exit, Scope} from "effect";
import type {DeskMsg} from "./desk/desk.ts";
import type {TileId} from "./desk/layout/index.ts";
import type {SharedHistory} from "./editor/history.ts";
import type {ToTerminal} from "./messages.ts";
import {type Placed, type Screen, startTsh, type Tsh, type WindowScreen} from "./tsh.ts";

// The tiles in the host process: one tsh (tsh.ts), with its own jobs, per tile the desk opened,
// as tmux runs one shell per pane. History is shared: a line typed in one tile is in every tile's
// Ctrl-R. It names no platform, so a test drives it with no Electron (tiles.test.ts); the host
// (host/serve.ts) hands it the screens' edge, and host/main.ts the folders.
//
//   const tiles = yield* startTiles({history, place, edge});
//   yield* tiles.open("t1")       t1's tsh starts on its own folder: edge.terminal("t1", screen)
//   // t1 runs `counter`:         edge.view("counter:1a2b", screen), and the desk is told
//   //                            {type: "covered", tile: "t1", run: {id: "counter:1a2b", program: "counter"}}
//   // t1 runs `tally &`:         nothing is shown: a job in the background, as in bash
//   yield* tiles.close("t1")      t1's tsh and its programs get the end of their inputs; nothing stops
//   // they end, then tsh does:   the desk is told {type: "ended", tile: "t1"}
//   yield* tiles.stop("t1")       what still runs in t1 stops, its port goes, and its folder goes
//
// Closing is tmux's kill-pane, made soft: a tile owns its tsh as a pane owns its shell, and the
// programs are given the end of their inputs before anything is stopped. The desk says when to
// stop: after the tile's tsh ended, or when the person asks to stop now. Nothing here waits on a
// clock.
//
// What a tile's tsh keeps is in its own folder, so the next start of the host finds the tile's
// jobs "from an earlier tsh, not running", for `attach`. Stopping a tile drops them. Stopping the
// host keeps them: the scope every tile is in closes, which stops each tsh. Quitting the app
// stops nothing here: the app is only a client of the host.

/** Where one tile keeps its jobs, and how they go when the tile closes. */
export interface Place {
	readonly jobs: Storage;
	readonly drop: Effect.Effect<void>;
}

/** What the tiles tell the desk: the desk's own Msgs, as each tile's tsh sees its runs. */
export type TileNews = Extract<DeskMsg, {readonly type: "covered" | "over" | "jobs" | "ended"}>;

/** What the tiles need of the edge: a way to tell the desk, and ports for the pages. */
export interface Edge {
	/** Tell the desk, beside the tiles in the host. */
	readonly tell: (m: TileNews) => void;
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
	/**
	 * Give the tile's tsh and every program it started the end of their inputs, with `close`, not
	 * `stop`. The desk is told `ended` once tsh has ended. A tile not open changes nothing.
	 */
	readonly close: (tile: TileId) => Effect.Effect<void>;
	/** Stop what still runs in the tile, and drop its jobs: the tile is gone. A tile not open changes nothing. */
	readonly stop: (tile: TileId) => Effect.Effect<void>;
}

/** A run with a view, as the tiles hold it while it runs. */
interface Live {
	readonly tile: TileId;
	readonly program: string;
	placed: Placed;
	readonly screen: WindowScreen;
}

/** One tile's tsh, the scope it runs in, and how far it closed. */
interface Running {
	readonly host: Tsh;
	readonly scope: Scope.Closeable;
	readonly drop: Effect.Effect<void>;
	/** `open` until `close`; `closing` while its programs end; `ended` once its tsh has. */
	state: "open" | "closing" | "ended";
}

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

		/** A run in the foreground covers its tile: its view gets a port, and the desk is told. */
		const cover = (run: string, one: Live) => {
			edge.view(run, one.screen);
			edge.tell({type: "covered", tile: one.tile, run: {id: run, program: one.program}});
		};

		/** A run is over: its port goes and the desk is told, once, whoever saw it end first. */
		const over = (run: string) => {
			const one = live.get(run);
			if (one === undefined) return;
			live.delete(run);
			// A run of the background was never shown: there is no port and nothing covered.
			if (one.placed === "background") return;
			edge.gone(`run:${run}`);
			edge.tell({type: "over", run});
		};

		const startOne = (tile: TileId) =>
			Effect.gen(function* () {
				const scope = yield* Scope.fork(parent);
				const {jobs, drop} = place(tile);
				const host = yield* startTsh({
					jobs,
					history,
					runs: {
						began: (run, program, placed, screen) => {
							const one: Live = {tile, program, placed, screen};
							live.set(run, one);
							if (placed === "foreground") cover(run, one);
						},
						forward: (run) => {
							const one = live.get(run);
							if (one === undefined || one.placed === "foreground") return;
							one.placed = "foreground";
							cover(run, one);
						},
						ended: over,
						running: (count) => edge.tell({type: "jobs", tile, running: count}),
					},
				}).pipe(Scope.provide(scope), Effect.provideService(Ledger, ledger));
				open.set(tile, {host, scope, drop, state: "open"});
				// tsh ended: `exit`, Ctrl-D, or after `close`. The desk takes the tile away, and asks to stop it here.
				yield* host.ended.pipe(
					Effect.andThen(
						Effect.sync(() => {
							const now = open.get(tile);
							if (now !== undefined) now.state = "ended";
							edge.tell({type: "ended", tile});
						}),
					),
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
				Effect.suspend(() => {
					const one = open.get(tile);
					if (one === undefined || one.state !== "open") return Effect.void;
					one.state = "closing";
					return one.host.close;
				}),
			stop: (tile) =>
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
		};
		return tiles;
	});
