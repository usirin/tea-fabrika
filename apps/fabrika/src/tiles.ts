import {type JobsOnHost, Ledger, Traces} from "@kampus/fabrika-old";
import {type LineAnswer, LineRefused} from "@kampus/fabrika-old/mcp";
import {Author, PullRequests, RepoTree} from "@tea-fabrika/tracker";
import {Context, Effect, Exit, Scope} from "effect";
import type {AgentName, DeskMsg} from "./desk/desk.ts";
import type {Does} from "./desk/keys.ts";
import type {TileId} from "./desk/layout/index.ts";
import {deskWords} from "./desk/words.ts";
import type {SharedHistory} from "./editor/history.ts";
import type {AgentSessions} from "./host/agent-session.ts";
import type {JobLines} from "./job-lines.ts";
import type {ToTerminal} from "./messages.ts";
import {type Placed, RESET, type Screen, startTsh, type Tsh, type WindowScreen} from "./tsh.ts";

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
//   // t1 runs `zoom`:            a desk word (desk/words.ts): edge.said("t1", {kind: "zoom"}),
//   //                            and what it answers, if not null, is why the word failed
//   yield* tiles.close("t1")      t1's tsh and its programs get the end of their inputs; nothing stops
//   // they end, then tsh does:   the desk is told {type: "ended", tile: "t1"}
//   yield* tiles.stop("t1")       what still runs in t1 stops, its port goes, and the jobs t1
//                                 started leave the host's table
//   yield* tiles.end("ticket:9c1d")   one window of a line closed: that process gets the end of its
//                                 inputs. Its neighbours follow the pipes: the tracker's next send
//                                 fails and it ends; the runs' input ends, and it shows the last
//   yield* tiles.kill("ticket:9c1d")  the same window, "stop now": that process stops
//   yield* tiles.stopJob("t1", 3) t1's tsh is told to stop %3, as `stop %3` there does: true. A
//                                 tile not open answers false
//
// An agent's tile (tracker 185b): opened with the agent's name, its tsh runs as that agent. On a
// connected home its services are the agent's own session (`sessionFor`), held as long as the
// tile; on a home's own file, the host's ledger with `agent:<name> for:<person>` as its Author. It
// fails closed: when the session cannot be made, no tsh starts, the tile says why, and a line is
// refused with that why. An agent's line never runs on the person's session.
//
//   yield* tiles.open("t2", "claude")        t2's tsh starts as agent:claude for:owner
//   yield* tiles.line("t2", "tally &")       "$ tally &" on t2; {_tag: "job", job: {n: 1, tile: "t2", ...}}
//   yield* tiles.line("t1", "tally &")       refused: t1 is the person's
//   // sessionFor fails "no room":           t2 shows why; tiles.line("t2", ...) refused with it
//
// Closing is tmux's kill-pane, made soft: a tile owns its tsh as a pane owns its shell, and the
// programs are given the end of their inputs before anything is stopped. The desk says when to
// stop: after the tile's tsh ended, or when the person asks to stop now. Nothing here waits on a
// clock.
//
// The host's table is kept in the home, and each job in it names its tile, so the next start of
// the host finds every job "from an earlier tsh, not running": each tile's tsh says so of its own,
// and `attach` in any tile starts one again, which makes it that tile's. Stopping a tile drops the
// jobs it owns, and no other tile's. Stopping the host keeps them all: the scope every tile is in
// closes, which stops each tsh. Quitting the app stops nothing here: the app is only a client of
// the host.

/** What the tiles tell the desk: the desk's own Msgs, as each tile's tsh sees its runs. */
export type TileNews = Extract<DeskMsg, {readonly type: "covered" | "over" | "jobs" | "ended"}>;

/** What the tiles need of the edge: a way to tell the desk, and ports for the pages. */
interface Edge {
	/** Tell the desk, beside the tiles in the host. */
	readonly tell: (m: TileNews) => void;
	/**
	 * A desk word typed in this tile's tsh (desk/words.ts): the desk does it from this tile, or
	 * answers why it cannot.
	 */
	readonly said: (tile: TileId, does: Does) => string | null;
	/** A tile's terminal: give the page a port for it, named `tile:<id>`. A second call is a fresh port. */
	readonly terminal: (tile: TileId, screen: Screen<ToTerminal>) => void;
	/** A run's view: give the page a port for it, named `run:<id>`. */
	readonly view: (run: string, screen: WindowScreen) => void;
	/** The port of that name goes: its tile closed, or its run ended. */
	readonly gone: (name: string) => void;
	/** The person typed a line in this agent's tile, and was told it runs nothing there. */
	readonly typed?: ((tile: TileId) => void) | undefined;
}

interface Tiles {
	/**
	 * Start the tile's tsh, or show the one that runs on a fresh port. With an agent's name, its tsh
	 * runs as that agent, or, when its session cannot be made, the tile says why.
	 */
	readonly open: (tile: TileId, agent?: AgentName) => Effect.Effect<void>;
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
	/**
	 * Tell the tile's tsh to stop job n, as `stop %n` does (`Tsh.stop`): only the tsh that started
	 * a job holds its runs. `false`: the tile is not open, so no tsh here runs it.
	 */
	readonly stopJob: (tile: TileId, n: number) => Effect.Effect<boolean>;
	/**
	 * Run one line in an agent's tile, as its agent (`Tsh.line`). Refused in a tile not open, in a
	 * person's tile, and in one whose agent's session could not be made, with why.
	 */
	readonly line: (tile: TileId, text: string) => Effect.Effect<LineAnswer, LineRefused>;
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
	/** The agent whose tile it is, or `null`: the person's. */
	readonly agent: AgentName | null;
	/** `open` until `close`; `closing` while its programs end; `ended` once its tsh has. */
	state: "open" | "closing" | "ended";
}

export const startTiles = (options: {
	readonly history: SharedHistory;
	/** The host's one job table, handed to every tile's tsh. */
	readonly jobs: JobsOnHost;
	readonly edge: Edge;
	/** The host's job lines (job-lines.ts), handed to every tile's tsh with the table. */
	readonly lines?: JobLines | undefined;
	/**
	 * An agent's own session on a connected home, for its tile. None: the home's own file, where an
	 * agent's tile writes on the host's ledger, as its agents' socket does.
	 */
	readonly sessionFor?: AgentSessions | undefined;
}) =>
	Effect.gen(function* () {
		const {history, jobs, edge, lines, sessionFor} = options;
		const parent = yield* Effect.scope;
		const ledger = yield* Ledger;
		const author = yield* Author;
		const pullRequests = yield* PullRequests;
		const repoTree = yield* RepoTree;
		const traces = yield* Traces;
		const open = new Map<TileId, Running>();
		const live = new Map<string, Live>();
		/** The agents' tiles whose tsh could not start, and why: no line runs there. */
		const failed = new Map<TileId, string>();
		/** Who an agent works for: the person the host's own Author is. */
		const person = author.kind === "user" ? author.id : "for" in author ? author.for : author.id;

		/**
		 * An agent's services for its tile: its own session, held in the tile's scope, or the host's
		 * ledger with the agent as its Author.
		 */
		const servicesOf = (agent: AgentName, scope: Scope.Scope) =>
			sessionFor === undefined
				? Effect.succeed(
						Context.make(Ledger, ledger).pipe(
							Context.add(Author, {kind: "agent", id: agent, for: person}),
						),
					)
				: sessionFor(agent).pipe(Scope.provide(scope));

		/** A tile whose tsh could not start: it says why, and takes no key. */
		const blank = (agent: AgentName, why: string): Screen<ToTerminal> => ({
			show: (page) => {
				page({type: "write", data: `${RESET}${agent}'s tile could not start:\r\n${why}\r\n`});
				return () => {};
			},
			heard: () => ({kind: "refused", why: `${agent}'s tile could not start: ${why}`}),
		});

		/**
		 * A line in the foreground covers its tile: the desk is told its runs with a view, still
		 * running, at once, so it can open them in place. Each got its port as it came forward.
		 */
		const cover = (tile: TileId, runs: readonly string[]) => {
			const [first, ...rest] = runs.flatMap((run) => {
				const one = live.get(run);
				return one === undefined ? [] : [{id: run, program: one.program}];
			});

			if (first !== undefined) {
				edge.tell({type: "covered", tile, runs: [first, ...rest]});
			}
		};

		/** A run is over: its port goes and the desk is told, once, whoever saw it end first. */
		const over = (run: string) => {
			const one = live.get(run);

			if (one === undefined) {
				return;
			}

			live.delete(run);

			// A run of the background was never shown: there is no port and nothing covered.
			if (one.placed === "background") {
				return;
			}

			edge.gone(`run:${run}`);
			edge.tell({type: "over", run});
		};

		const startOne = (tile: TileId, agent: AgentName | null) =>
			Effect.gen(function* () {
				const scope = yield* Scope.fork(parent);
				const services =
					agent === null
						? Context.make(Ledger, ledger).pipe(Context.add(Author, author))
						: yield* servicesOf(agent, scope).pipe(
								Effect.tapError(() => Scope.close(scope, Exit.void)),
							);
				const host = yield* startTsh({
					tile,
					jobs,
					lines,
					history,
					words: deskWords((does) => edge.said(tile, does)),
					typed: () => edge.typed?.(tile),
					runs: {
						began: (run, program, placed, screen) => {
							const one: Live = {tile, program, placed, screen};
							live.set(run, one);

							if (placed === "foreground") {
								edge.view(run, screen);
							}
						},
						forward: (run) => {
							const one = live.get(run);

							if (one === undefined || one.placed === "foreground") {
								return;
							}

							one.placed = "foreground";
							edge.view(run, one.screen);
						},
						line: (runs) => cover(tile, runs),
						ended: over,
						jobs: (jobs) => edge.tell({type: "jobs", tile, jobs}),
					},
				}).pipe(
					Scope.provide(scope),
					Effect.provideService(Ledger, Context.get(services, Ledger)),
					Effect.provideService(Author, Context.get(services, Author)),
					Effect.provideService(PullRequests, pullRequests),
					Effect.provideService(RepoTree, repoTree),
					Effect.provideService(Traces, traces),
				);
				open.set(tile, {host, scope, agent, state: "open"});
				// tsh ended: `exit`, Ctrl-D, or after `close`. The desk takes the tile away, and asks to stop it here.
				yield* host.ended.pipe(
					Effect.andThen(
						Effect.sync(() => {
							const now = open.get(tile);

							if (now !== undefined) {
								now.state = "ended";
							}

							edge.tell({type: "ended", tile});
						}),
					),
					Effect.forkIn(scope),
				);
				return host;
			});

		const tiles: Tiles = {
			// A tsh that cannot start leaves the tile blank, and says why in the host's log. An agent's
			// tile says why on its screen too, and refuses its lines with it.
			open: (tile, agent) =>
				Effect.gen(function* () {
					const why = failed.get(tile);

					if (agent !== undefined && why !== undefined) {
						return edge.terminal(tile, blank(agent, why));
					}

					const host = open.get(tile)?.host ?? (yield* startOne(tile, agent ?? null));
					edge.terminal(tile, host.terminal);
				}).pipe(
					Effect.catchTag("ConnectFailed", ({why}) =>
						Effect.gen(function* () {
							const name = agent ?? tile;
							failed.set(tile, why);
							edge.terminal(tile, blank(name, why));
							yield* Effect.logError(`fabrika: ${name}'s tile could not start: ${why}`);
						}),
					),
					Effect.catch((e) => Effect.logError(`fabrika: ${tile}'s tsh could not start`, e)),
				),
			close: (tile) =>
				Effect.suspend(() => {
					const one = open.get(tile);

					if (one === undefined || one.state !== "open") {
						return Effect.void;
					}

					one.state = "closing";
					return one.host.close;
				}),
			stop: (tile) =>
				Effect.gen(function* () {
					// An agent's tile that never started goes with its port, and nothing else.
					if (failed.delete(tile)) {
						edge.gone(`tile:${tile}`);
					}

					const one = open.get(tile);

					if (one === undefined) {
						return;
					}

					open.delete(tile);
					yield* Scope.close(one.scope, Exit.void);

					// The scope closing interrupts the runs, and a run interrupted may end before its host
					// says so. Every run of the tile is over now, said or not.
					for (const [run, it] of [...live]) {
						if (it.tile === tile) {
							over(run);
						}
					}

					edge.gone(`tile:${tile}`);
					// Its scope closed, so the jobs its tsh started are detached in the host's table now.
					yield* one.host.drop;
				}),
			end: (process) => Effect.sync(() => live.get(process)?.screen.closed()),
			kill: (process) => Effect.suspend(() => live.get(process)?.screen.kill ?? Effect.void),
			stopJob: (tile, n) =>
				Effect.suspend(() => {
					const one = open.get(tile);
					return one === undefined ? Effect.succeed(false) : one.host.stop(n).pipe(Effect.as(true));
				}),
			line: (tile, text) =>
				Effect.suspend(() => {
					const why = failed.get(tile);

					if (why !== undefined) {
						return Effect.fail(new LineRefused({why: `${tile} could not start: ${why}`}));
					}

					const one = open.get(tile);

					if (one === undefined) {
						return Effect.fail(new LineRefused({why: `${tile} is not open: no tsh runs there`}));
					}

					if (one.agent === null) {
						return Effect.fail(
							new LineRefused({
								why: `${tile} is the person's tile: an agent's line runs only in its own`,
							}),
						);
					}

					if (one.state !== "open") {
						return Effect.fail(new LineRefused({why: `${tile} is closing: its tsh takes no line`}));
					}

					return one.host.line(text);
				}),
		};
		return tiles;
	});
