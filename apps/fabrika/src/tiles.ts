import {type JobsOnHost, Ledger} from "@kampus/fabrika";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Effect, Exit, Scope} from "effect";
import type {DeskMsg} from "./desk/desk.ts";
import type {TileId} from "./desk/layout/index.ts";
import type {SharedHistory} from "./editor/history.ts";
import type {ToTerminal} from "./messages.ts";
import {type Placed, type Screen, startTsh, type Tsh, type WindowScreen} from "./tsh.ts";

// The tiles in the host process: one tsh (tsh.ts) per tile the desk opened, as tmux runs one
// shell per pane. The jobs are the host's: one table for the host process (host/run.ts opens it),
// handed to every tile's tsh, so a job is the same `%n` in each tile, as WezTerm's mux keeps the
// panes for every window. History is shared too: a line typed in one tile is in every tile's
// Ctrl-R. It names no platform, so a test drives it with no Electron (tiles.test.ts); the host
// (host/serve.ts) hands it the screens' edge, and host/run.ts the table.
//
//   const tiles = yield* startTiles({history, jobs, edge});
//   yield* tiles.open("t1")       t1's tsh starts on the host's table: edge.terminal("t1", screen)
//   // t1 runs `counter`:         edge.view("counter:1a2b", screen), and the desk is told
//   //                            {type: "covered", tile: "t1", runs: [{id: "counter:1a2b", program: "counter"}]}
//   // t1 runs `tracker | ticket`: each view gets its port as it begins, and once both have, the
//   //                            desk is told the line: {type: "covered", tile: "t1", runs: [tracker, ticket]}
//   // t1 runs `tally &`:         nothing is shown: a job in the background, as in bash
//   yield* tiles.close("t1")      t1's tsh and its programs get the end of their inputs; nothing stops
//   // they end, then tsh does:   the desk is told {type: "ended", tile: "t1"}
//   yield* tiles.stop("t1")       what still runs in t1 stops, its port goes, and the jobs t1
//                                 started leave the host's table
//   yield* tiles.end("ticket:9c1d")   one window of a line closed: that process gets the end of its
//                                 inputs. Its neighbours follow the pipes: the tracker's next send
//                                 fails and it ends; the trace's input ends, and it shows the last
//   yield* tiles.kill("ticket:9c1d")  the same window, "stop now": that process stops
//
// Closing is tmux's kill-pane, made soft: a tile owns its tsh as a pane owns its shell, and the
// programs are given the end of their inputs before anything is stopped. The desk says when to
// stop: after the tile's tsh ended, or when the person asks to stop now. Nothing here waits on a
// clock.
//
// The host's table is kept in the home, so the next start of the host finds every job "from an
// earlier tsh, not running", for `attach` in any tile. Stopping a tile drops the jobs its tsh
// started, and no other tile's. Stopping the host keeps them all: the scope every tile is in
// closes, which stops each tsh. Quitting the app stops nothing here: the app is only a client of
// the host.

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
	/** Stop what still runs in the tile, and drop the jobs it started: the tile is gone. A tile not open changes nothing. */
	readonly stop: (tile: TileId) => Effect.Effect<void>;
	/**
	 * Give one process with a view the end of its inputs, as closing its window does: a window of
	 * a line, closed on its own. Its neighbours in the line follow the pipes' rules. A process not
	 * running changes nothing.
	 */
	readonly end: (process: string) => Effect.Effect<void>;
	/** Stop one process with a view now, and wait for its end. A process not running changes nothing. */
	readonly kill: (process: string) => Effect.Effect<void>;
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
	/** `open` until `close`; `closing` while its programs end; `ended` once its tsh has. */
	state: "open" | "closing" | "ended";
}

export const startTiles = (options: {
	readonly history: SharedHistory;
	/** The host's one job table, handed to every tile's tsh. */
	readonly jobs: JobsOnHost;
	readonly edge: Edge;
}) =>
	Effect.gen(function* () {
		const {history, jobs, edge} = options;
		const parent = yield* Effect.scope;
		const ledger = yield* Ledger;
		const author = yield* Author;
		const pullRequests = yield* PullRequests;
		const open = new Map<TileId, Running>();
		const live = new Map<string, Live>();

		/**
		 * A line in the foreground covers its tile: the desk is told its runs with a view, still
		 * running, at once, so it can open them in place. Each got its port as it came forward.
		 */
		const cover = (tile: TileId, runs: readonly string[]) => {
			const [first, ...rest] = runs.flatMap((run) => {
				const one = live.get(run);
				return one === undefined ? [] : [{id: run, program: one.program}];
			});
			if (first !== undefined) edge.tell({type: "covered", tile, runs: [first, ...rest]});
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
				const host = yield* startTsh({
					jobs,
					history,
					runs: {
						began: (run, program, placed, screen) => {
							const one: Live = {tile, program, placed, screen};
							live.set(run, one);
							if (placed === "foreground") edge.view(run, screen);
						},
						forward: (run) => {
							const one = live.get(run);
							if (one === undefined || one.placed === "foreground") return;
							one.placed = "foreground";
							edge.view(run, one.screen);
						},
						line: (runs) => cover(tile, runs),
						ended: over,
						running: (count) => edge.tell({type: "jobs", tile, running: count}),
					},
				}).pipe(
					Scope.provide(scope),
					Effect.provideService(Ledger, ledger),
					Effect.provideService(Author, author),
					Effect.provideService(PullRequests, pullRequests),
				);
				open.set(tile, {host, scope, state: "open"});
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
			// A tsh that cannot start leaves the tile blank, and says why in the host's log.
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
					// Its scope closed, so the jobs its tsh started are detached in the host's table now.
					yield* one.host.drop;
				}),
			end: (process) => Effect.sync(() => live.get(process)?.screen.closed()),
			kill: (process) => Effect.suspend(() => live.get(process)?.screen.kill ?? Effect.void),
		};
		return tiles;
	});
