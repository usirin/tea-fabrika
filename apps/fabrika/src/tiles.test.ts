import {Ledger, memoryStorage, openJobs} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Context, Effect} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {memoryHistory, sharedHistory} from "./editor/history.ts";
import type {AgentSessions} from "./host/agent-session.ts";
import {ConnectFailed} from "./host/connection.ts";
import type {ToTerminal} from "./messages.ts";
import {startTiles, type TileNews} from "./tiles.ts";
import {RESET, type Screen} from "./tsh.ts";

// The tiles, with fake ports, the host's one job table in memory, and no Electron: what the desk
// is told, what each tile's terminal shows, and what is in the host's table.

/** The ledger's calls that write, by name: a watched ledger counts each. */
const WRITES = new Set([
	"register",
	"append",
	"send",
	"claim",
	"renew",
	"cancel",
	"exit",
	"monitor",
]);

/** A ledger in memory that keeps the name of every call made to it that writes. */
const watched = () => {
	const writes: string[] = [];
	const inner = memoryService();
	const ledger = new Proxy(inner, {
		get: (target, key, receiver) => {
			const value: unknown = Reflect.get(target, key, receiver);

			if (typeof key !== "string" || !WRITES.has(key) || typeof value !== "function") {
				return value;
			}

			return (...args: unknown[]) => {
				writes.push(key);
				return Reflect.apply(value, target, args);
			};
		},
	});
	return {ledger, writes};
};

/**
 * The tiles of one start of the host. `storage` outlives it, as the home's folder does.
 * `sessionFor` is an agent's session on a connected home; without it, an agent's tile writes on
 * the host's ledger, as a home's own file does.
 */
const desk = (storage = memoryStorage(), more: {readonly sessionFor?: AgentSessions} = {}) =>
	Effect.gen(function* () {
		const told: TileNews[] = [];
		const gone: string[] = [];
		const views: string[] = [];
		const said: string[] = [];
		const bytes = new Map<string, string>();
		/** Every message each tile's terminal was shown, in order. */
		const shown = new Map<string, ToTerminal[]>();
		const screens = new Map<string, Screen<ToTerminal>>();
		const host = watched();
		// One table for the host, as host/run.ts opens it, handed to every tile.
		const jobs = yield* openJobs(storage);
		/** The host's table now: each job's number and state. */
		const table = () => jobs.table.getState().jobs.map((job) => [job.n, job.state] as const);
		/** Whose each job in the host's table is: its number and its tile. */
		const owners = () => jobs.table.getState().jobs.map((job) => [job.n, job.owner] as const);
		/** Who wrote each job in the host's table: its number and its writer. */
		const writers = () => jobs.table.getState().jobs.map((job) => [job.n, job.by] as const);
		const tiles = yield* startTiles({
			history: yield* sharedHistory(memoryHistory()),
			jobs,
			// made up: the option that makes an agent's session for its tile (tracker 185b, PR 3).
			...(more.sessionFor === undefined ? {} : {sessionFor: more.sessionFor}),
			edge: {
				tell: (m) => told.push(m),
				terminal: (tile, screen) => {
					screens.set(tile, screen);
					bytes.set(tile, "");
					shown.set(tile, []);
					screen.show((m) => {
						// The plan's status and reply regions share the terminal's port: only `write` is bytes.
						if (m.type === "write") {
							bytes.set(tile, (bytes.get(tile) ?? "") + m.data);
						}

						shown.get(tile)?.push(m);
					});
				},
				view: (run) => views.push(run),
				gone: (name) => gone.push(name),
				said: (tile) => {
					said.push(tile);
					return null;
				},
			},
		}).pipe(
			Effect.provideService(Ledger, host.ledger),
			Effect.provideService(Author, {kind: "user", id: "owner"}),
			Effect.provideService(PullRequests, {open: Effect.succeed([])}),
			Effect.provide(memoryTraces([])),
		);
		const rows = (tile: string) => gridOf(bytes.get(tile) ?? "", 80, 1000).rows;
		const type = (tile: string, data: string) => screens.get(tile)?.heard({type: "keys", data});
		const until = <T>(what: string, check: () => T | undefined) =>
			Effect.gen(function* () {
				for (let i = 0; i < 3000; i += 1) {
					const got = check();

					if (got !== undefined) {
						return got;
					}

					yield* Effect.sleep("5 millis");
				}

				return yield* Effect.die(`waited for ${what}; told ${JSON.stringify(told)}`);
			});
		const prompts = (tile: string, n: number) =>
			until(`${tile}'s prompt ${n}`, () => {
				const all = rows(tile);
				return all.filter((r) => r.startsWith("tsh$")).length >= n && all.at(-1) === "tsh$"
					? all
					: undefined;
			});
		const heard = (check: (m: TileNews) => boolean) =>
			until("a message for the desk", () => told.find(check));
		return {
			tiles,
			told,
			gone,
			table,
			owners,
			writers,
			views,
			said,
			hostWrites: host.writes,
			shown: (tile: string) => [...(shown.get(tile) ?? [])],
			rows,
			type,
			until,
			prompts,
			heard,
		};
	});

const go = <A, E>(test: Effect.Effect<A, E>) => Effect.runPromise(test);

// Two tsh each in most tests: a busy machine running the whole suite needs more than vitest's 5 s.
describe("the tiles", {timeout: 20_000}, () => {
	it("give each tile a tsh of its own on the host's one table: a job is the same %n in every tile", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t1", "counter &\r");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t1" && m.jobs.running.length === 1);
				d.type("t2", "jobs\r");
				const two = yield* d.prompts("t2", 2);
				d.type("t2", "tally &\r");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t2" && m.jobs.running.length === 1);
				return {two, told: [...d.told], views: [...d.views], table: d.table()};
			}).pipe(Effect.scoped),
		);
		// t2 sees t1's job, under t1's number.
		expect(seen.two).toEqual(["tsh$ jobs", "[1] running   counter", "tsh$"]);
		// t2's job is the host's next number, not a number of t2's own.
		expect(seen.table).toEqual([
			[1, "running"],
			[2, "running"],
		]);
		// Each tile is told only of the jobs it started: t1's one, t2's one.
		expect(
			seen.told.flatMap((m) =>
				m.type === "jobs" && m.tile === "t1" ? m.jobs.running.map((j) => j.n) : [],
			),
		).not.toContain(2);
		// `&` is a job in the background, as in bash: no tile opens, and nothing covers one.
		expect(seen.told.map((m) => m.type).filter((t) => t !== "jobs")).toEqual([]);
		expect(seen.views).toEqual([]);
	});

	it("bring a job of the background in with `attach %n`, as bash's fg: it covers its tile", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "counter &\r");
				yield* d.prompts("t1", 2);
				d.type("t1", "attach %1\r");
				const covered = yield* d.heard((m) => m.type === "covered");
				return {covered, views: [...d.views]};
			}).pipe(Effect.scoped),
		);
		expect(seen.covered).toMatchObject({type: "covered", tile: "t1", runs: [{program: "counter"}]});
		expect(seen.views).toHaveLength(1);
	});

	it("tell the desk a run in the foreground covers its tile, and when it is over", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "counter\r");
				const covered = yield* d.heard((m) => m.type === "covered");
				d.type("t1", "\x03");
				const over = yield* d.heard((m) => m.type === "over");
				yield* d.prompts("t1", 2);
				return {covered, over, gone: d.gone};
			}).pipe(Effect.scoped),
		);
		expect(seen.covered).toMatchObject({type: "covered", tile: "t1", runs: [{program: "counter"}]});
		const run = seen.covered.type === "covered" ? seen.covered.runs[0].id : "";
		expect(seen.over).toEqual({type: "over", run});
		expect(seen.gone).toEqual([`run:${run}`]);
	});

	it("close a tile with `close`, not `stop`: its programs end on their own, then its tsh", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t2");
				d.type("t2", "tally &\r");
				yield* d.prompts("t2", 2);
				d.type("t2", "counter\r");
				yield* d.heard((m) => m.type === "covered");
				yield* d.tiles.close("t2");
				// Said again: nothing more happens.
				yield* d.tiles.close("t2");
				const ended = yield* d.heard((m) => m.type === "ended");
				// The terminal draws what tsh said last a moment after tsh ended.
				const rows = yield* d.until("tally's end", () =>
					d.rows("t2").includes("[1] ended  tally") ? d.rows("t2") : undefined,
				);
				// Both ended on their own: they left the host's table before the desk says stop.
				const before = d.table();
				yield* d.tiles.stop("t2");
				return {ended, before, rows, after: d.table(), gone: [...d.gone]};
			}).pipe(Effect.scoped),
		);
		expect(seen.ended).toEqual({type: "ended", tile: "t2"});
		// The foreground counter ended on its inputs' end: it printed its count, and was not stopped.
		expect(seen.rows.some((r) => r.includes("stopped") || r === "^C")).toBe(false);
		expect(seen.before).toEqual([]);
		expect(seen.after).toEqual([]);
		expect(seen.gone.at(-1)).toBe("tile:t2");
		expect(seen.gone.filter((n) => n.startsWith("run:"))).toHaveLength(1);
	});

	it("stop a closing tile whose program does not end on its inputs' end", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t2");
				d.type("t2", "sleep --ms 600000 &\r");
				yield* d.heard((m) => m.type === "jobs" && m.jobs.running.length === 1);
				yield* d.tiles.close("t2");
				d.told.length = 0;
				const before = d.table();
				yield* d.tiles.stop("t2");
				// A tile stopped already: nothing happens.
				yield* d.tiles.stop("t2");
				return {before, after: d.table(), gone: [...d.gone], told: [...d.told]};
			}).pipe(Effect.scoped),
		);
		// The sleep ran on after `close`; `stop` stopped it, and its job left the host's table.
		expect(seen.before).toEqual([[1, "running"]]);
		expect(seen.after).toEqual([]);
		expect(seen.gone).toEqual(["tile:t2"]);
		expect(seen.told.some((m) => m.type === "ended")).toBe(false);
	});

	it("leave the other tiles' runs alone when one closes", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t1", "counter\r");
				const covered = yield* d.heard((m) => m.type === "covered");
				d.type("t2", "tally &\r");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t2" && m.jobs.running.length === 1);
				yield* d.tiles.close("t2");
				yield* d.heard((m) => m.type === "ended" && m.tile === "t2");
				yield* d.tiles.stop("t2");
				return {covered, told: [...d.told], gone: [...d.gone], table: d.table()};
			}).pipe(Effect.scoped),
		);
		// t1's counter is still in the host's table, running: t2's stop dropped only t2's jobs.
		expect(seen.table).toEqual([[1, "running"]]);
		const run = seen.covered.type === "covered" ? seen.covered.runs[0].id : "";
		// t1's counter still covers t1: it is not over, and its port is still there.
		expect(seen.told).not.toContainEqual({type: "over", run});
		const t1 = seen.told.filter((m) => m.type === "jobs" && m.tile === "t1").at(-1);
		expect(t1?.type === "jobs" ? t1.jobs.running.map((j) => [j.n, j.text]) : []).toEqual([
			[1, "counter"],
		]);
		expect(seen.gone).not.toContain(`run:${run}`);
	});

	it("end one process of a line with `end`, and stop another with `kill`: the tile's tsh goes on", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "tracker | ticket | trace\r");
				const covered = yield* d.heard((m) => m.type === "covered");
				const runs = covered.type === "covered" ? covered.runs : [];
				const id = (program: string) => runs.find((r) => r.program === program)?.id ?? "";
				// The ticket gets the end of its inputs, and ends on its own.
				yield* d.tiles.end(id("ticket"));
				yield* d.heard((m) => m.type === "over" && m.run === id("ticket"));
				// The trace keeps its inputs from the person open: it ends only when stopped.
				yield* d.tiles.kill(id("trace"));
				yield* d.heard((m) => m.type === "over" && m.run === id("trace"));
				// A process not running changes nothing.
				yield* d.tiles.end(id("ticket"));
				yield* d.tiles.kill("trace:none");
				return {
					programs: runs.map((r) => r.program),
					ids: runs.map((r) => r.id),
					told: [...d.told],
				};
			}).pipe(Effect.scoped),
		);
		const [tracker] = seen.ids;
		expect(seen.programs).toEqual(["tracker", "ticket", "trace"]);
		// The tracker still runs, and the tile's tsh with it: nothing told it is over, or ended.
		expect(seen.told).not.toContainEqual({type: "over", run: tracker});
		expect(seen.told.some((m) => m.type === "ended")).toBe(false);
	});

	it("share the history: a line typed in t1 is t2's Up", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t1", "say --text one\r");
				yield* d.prompts("t1", 2);
				d.type("t2", "\x1b[A");
				return yield* d.until("t1's line in t2", () =>
					d.rows("t2")[0] === "tsh$ say --text one" ? d.rows("t2") : undefined,
				);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ say --text one"]);
	});

	it("tell the desk a tile's tsh ended, on Ctrl-D", async () => {
		const ended = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "\x04");
				return yield* d.heard((m) => m.type === "ended");
			}).pipe(Effect.scoped),
		);
		expect(ended).toEqual({type: "ended", tile: "t1"});
	});

	it("show a tile that runs again, on the same tsh: nothing starts twice", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "counter\r");
				yield* d.heard((m) => m.type === "jobs" && m.jobs.running.length === 1);
				yield* d.heard((m) => m.type === "covered");
				d.told.length = 0;
				yield* d.tiles.open("t1");
				return {told: [...d.told], rows: d.rows("t1")};
			}).pipe(Effect.scoped),
		);
		expect(seen.told).toEqual([]);
		// The same tsh, its screen shown again from the start.
		expect(seen.rows[0]).toBe("tsh$ counter");
	});

	it("keep the host's jobs when the host stops: the next start says each to the tile that ran it, and `attach` takes it in any tile", async () => {
		const storage = memoryStorage();
		const found = await go(
			Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const d = yield* desk(storage);
					yield* d.tiles.open("t1");
					d.type("t1", "counter &\r");
					yield* d.heard((m) => m.type === "jobs" && m.jobs.running.length === 1);
				}).pipe(Effect.scoped);
				// The next start, on the same storage: the tile that ran it, and another.
				const d = yield* desk(storage);
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				const row = yield* d.until("the earlier job", () =>
					d.rows("t1").find((r) => r.startsWith("tsh: 1 job")),
				);
				const fresh = yield* d.prompts("t2", 1);
				const before = {table: d.table(), owners: d.owners()};
				d.type("t2", "jobs\r");
				const listed = yield* d.prompts("t2", 2);
				d.type("t2", "attach %1 &\r");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t2" && m.jobs.running.length === 1);
				return {row, fresh, before, listed, table: d.table(), owners: d.owners()};
			}).pipe(Effect.scoped),
		);
		expect(found.row).toMatch(/^tsh: 1 job from an earlier tsh, not running: %1\./);
		expect(found.before).toEqual({table: [[1, "detached"]], owners: [[1, "t1"]]});
		// t2 never ran it: its tsh starts on a bare prompt, and `jobs` still lists every job.
		expect(found.fresh).toEqual(["tsh$"]);
		expect(found.listed).toEqual(["tsh$ jobs", "[1] detached  counter", "tsh$"]);
		// Attached in t2, it is t2's now.
		expect(found.table).toEqual([[1, "running"]]);
		expect(found.owners).toEqual([[1, "t2"]]);
	});

	it("drop a tile's jobs from an earlier host when it goes, though its tsh never ran them", async () => {
		const storage = memoryStorage();
		const table = await go(
			Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const d = yield* desk(storage);
					yield* d.tiles.open("t1");
					yield* d.tiles.open("t2");
					d.type("t1", "counter &\r");
					yield* d.heard(
						(m) => m.type === "jobs" && m.tile === "t1" && m.jobs.running.length === 1,
					);
					d.type("t2", "tally &\r");
					yield* d.heard(
						(m) => m.type === "jobs" && m.tile === "t2" && m.jobs.running.length === 1,
					);
				}).pipe(Effect.scoped);
				const d = yield* desk(storage);
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				yield* d.prompts("t1", 1);
				yield* d.tiles.close("t1");
				yield* d.heard((m) => m.type === "ended" && m.tile === "t1");
				yield* d.tiles.stop("t1");
				return d.owners();
			}).pipe(Effect.scoped),
		);
		// t1's counter left the table with t1; t2's tally waits there still.
		expect(table).toEqual([[2, "t2"]]);
	});
});

// An agent's tile (tracker 185b, PR 3). Today's version. The host opens it as the agent's first
// `line` comes, and its tsh runs as that agent: on a connected home, on the agent's own session;
// on a home's own file, as `agent:<name> for:<person>` on the host's ledger. It lists no desk word,
// and takes `forAgent`'s list. If the agent's session cannot be made, the tsh does not start, and
// the tile and the line both say why: an agent's line never runs on the person's session.
//
//   tiles.open("t2", "claude")              t2's tsh starts as agent:claude for:owner
//   tiles.line("t2", "tally &")             "$ tally &" on t2's screen; {_tag: "job", job: {n: 1, tile: "t2", ...}}
//   tiles.line("t2", "jobs")                {_tag: "said", lines: ["[1] running   tally"], status: 0}
//   sessionFor fails "no room"              t2 says why; tiles.line("t2", ...) refused "... no room"

const AGENT_BY = "agent:claude for:owner";
const MARK = `tracker file='{"title":"mark","body":""}' &`;

describe("an agent's tile", {timeout: 20_000}, () => {
	it("runs the agent's lines as the agent, shows each as typed, and answers with the job", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				// made up: `tiles.open`'s second argument, the tile's agent, and `tiles.line`.
				yield* d.tiles.open("t2", "claude");
				const answer = yield* d.tiles.line("t2", "tally &");
				yield* d.until("the line on t2's screen", () =>
					d.rows("t2").some((r) => r.includes("$ tally &")) ? true : undefined,
				);
				const listed = yield* d.tiles.line("t2", "jobs");
				// A desk word is no word in an agent's tile: the desk is the person's.
				const zoom = yield* d.tiles.line("t2", "zoom");
				return {answer, listed, zoom, writers: d.writers(), said: [...d.said]};
			}).pipe(Effect.scoped),
		);
		expect(seen.answer).toMatchObject({
			_tag: "job",
			job: {n: 1, text: "tally &", tile: "t2", state: {_tag: "running"}},
		});
		expect(seen.writers).toEqual([[1, AGENT_BY]]);
		expect(seen.listed).toEqual({_tag: "said", lines: ["[1] running   tally"], status: 0});
		expect(seen.zoom).toMatchObject({_tag: "said"});
		expect(seen.zoom._tag === "said" ? seen.zoom.status : 0).not.toBe(0);
		expect(seen.said).toEqual([]);
	});

	it("writes on the agent's own session on a connected home, and never on the host's", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const session = watched();
				const asked: string[] = [];
				const sessionFor: AgentSessions = (name) =>
					Effect.sync(() => {
						asked.push(name);
						return Context.make(Ledger, session.ledger).pipe(
							Context.add(Author, {kind: "agent", id: name, for: "github:7"}),
						);
					});
				const d = yield* desk(memoryStorage(), {sessionFor});
				yield* d.tiles.open("t2", "claude");
				yield* d.tiles.line("t2", MARK);
				yield* d.until("the agent's row", () => (session.writes.length > 0 ? true : undefined));
				return {asked, writers: d.writers(), host: [...d.hostWrites]};
			}).pipe(Effect.scoped),
		);
		expect(seen.asked).toEqual(["claude"]);
		expect(seen.writers).toEqual([[1, "agent:claude for:github:7"]]);
		expect(seen.host).toEqual([]);
	});

	it("does not start when the agent's session cannot be made: the tile says why, the line is refused with it, and nothing runs or is written (d14)", async () => {
		const why = "the agent's key could not be kept: no room";
		const seen = await go(
			Effect.gen(function* () {
				const sessionFor: AgentSessions = () => Effect.fail(new ConnectFailed({why}));
				const d = yield* desk(memoryStorage(), {sessionFor});
				yield* d.tiles.open("t2", "claude");
				const shown = yield* d.until("the why on t2", () =>
					d.rows("t2").find((r) => r.includes("no room")),
				);
				const refused = yield* d.tiles.line("t2", "tally &").pipe(Effect.flip);
				// The person's own tile is the person's, as before.
				yield* d.tiles.open("t1");
				yield* d.prompts("t1", 1);
				return {shown, refused, table: d.table(), host: [...d.hostWrites]};
			}).pipe(Effect.scoped),
		);
		expect(seen.shown).toContain(why);
		expect(seen.refused).toMatchObject({_tag: "LineRefused"});
		expect(seen.refused.why).toContain(why);
		expect(seen.table).toEqual([]);
		expect(seen.host).toEqual([]);
	});

	it("refuses a line in a tile that is not open, or is the person's", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				const none = yield* d.tiles.line("t9", "tally &").pipe(Effect.flip);
				yield* d.tiles.open("t1");
				yield* d.prompts("t1", 1);
				const person = yield* d.tiles.line("t1", "tally &").pipe(Effect.flip);
				return {none, person, table: d.table()};
			}).pipe(Effect.scoped),
		);
		expect(seen.none).toMatchObject({_tag: "LineRefused"});
		expect(seen.person).toMatchObject({_tag: "LineRefused"});
		expect(seen.table).toEqual([]);
	});
});

// Owed by PR 3's mutation step (tracker 185b). Today's version: an agent's tile that is closing,
// one whose session could not be made, and the whole answer a line gets.

describe("an agent's tile: what the mutation step found untested", {timeout: 20_000}, () => {
	it("answers a line with the whole job: its number, the line, the tile, running, and no lines yet", async () => {
		const answer = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t2", "claude");
				return yield* d.tiles.line("t2", "tally &");
			}).pipe(Effect.scoped),
		);
		expect(answer).toEqual({
			_tag: "job",
			job: {n: 1, text: "tally &", tile: "t2", state: {_tag: "running"}, lines: []},
		});
	});

	it("refuses a line in an agent's tile that is closing", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t2", "claude");
				yield* d.tiles.line("t2", "tally &");
				yield* d.tiles.close("t2");
				const refused = yield* d.tiles.line("t2", "seq --to 3 &").pipe(Effect.flip);
				return {refused, table: d.table()};
			}).pipe(Effect.scoped),
		);
		expect(seen.refused).toMatchObject({
			_tag: "LineRefused",
			why: "t2 is closing: its tsh takes no line",
		});
		expect(seen.table.map(([n]) => n)).toEqual([1]);
	});

	it("says why on the tile when the agent's session cannot be made, refuses typing with it, and asks for the session once (d14)", async () => {
		const why = "the agent's key could not be kept: no room";
		const seen = await go(
			Effect.gen(function* () {
				let asked = 0;
				const sessionFor: AgentSessions = () =>
					Effect.suspend(() => {
						asked += 1;
						return Effect.fail(new ConnectFailed({why}));
					});
				const d = yield* desk(memoryStorage(), {sessionFor});
				yield* d.tiles.open("t2", "claude");
				// Opened again, as on the next page's port: the tile says why again, and no session is made.
				yield* d.tiles.open("t2", "claude");
				const typed = d.type("t2", "x");
				return {shown: d.shown("t2"), typed, asked};
			}).pipe(Effect.scoped),
		);
		expect(seen.shown).toEqual([
			{type: "write", data: `${RESET}claude's tile could not start:\r\n${why}\r\n`},
		]);
		expect(seen.typed).toEqual({kind: "refused", why: `claude's tile could not start: ${why}`});
		expect(seen.asked).toBe(1);
	});
});
