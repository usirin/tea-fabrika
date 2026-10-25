import {Ledger, memoryStorage} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {memoryHistory, sharedHistory} from "./editor/history.ts";
import type {ToTerminal} from "./messages.ts";
import {type Place, startTiles, type TileNews} from "./tiles.ts";
import type {Screen} from "./tsh.ts";

// The tiles, with fake ports and memory folders and no Electron: what the desk is told, what each
// tile's terminal shows, and which folders go.

/** The tiles of one start of the host. `folders` outlive it, as the home's folders do. */
const desk = (folders = new Map<string, Place>()) =>
	Effect.gen(function* () {
		const told: TileNews[] = [];
		const gone: string[] = [];
		const dropped: string[] = [];
		const views: string[] = [];
		const bytes = new Map<string, string>();
		const screens = new Map<string, Screen<ToTerminal>>();
		const tiles = yield* startTiles({
			history: yield* sharedHistory(memoryHistory()),
			place: (tile) => {
				const kept = folders.get(tile) ?? {
					jobs: memoryStorage(),
					drop: Effect.sync(() => {
						dropped.push(tile);
						folders.delete(tile);
					}),
				};
				folders.set(tile, kept);
				return kept;
			},
			edge: {
				tell: (m) => told.push(m),
				terminal: (tile, screen) => {
					screens.set(tile, screen);
					bytes.set(tile, "");
					screen.show((m) => bytes.set(tile, (bytes.get(tile) ?? "") + m.data));
				},
				view: (run) => views.push(run),
				gone: (name) => gone.push(name),
			},
		}).pipe(Effect.provideService(Ledger, memoryService()));
		const rows = (tile: string) => gridOf(bytes.get(tile) ?? "", 80, 1000).rows;
		const type = (tile: string, data: string) => screens.get(tile)?.heard({type: "keys", data});
		const until = <T>(what: string, check: () => T | undefined) =>
			Effect.gen(function* () {
				for (let i = 0; i < 3000; i += 1) {
					const got = check();
					if (got !== undefined) return got;
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
		return {tiles, told, gone, dropped, views, rows, type, until, prompts, heard};
	});

const go = <A, E>(test: Effect.Effect<A, E>) => Effect.runPromise(test);

// Two tsh each in most tests: a busy machine running the whole suite needs more than vitest's 5 s.
describe("the tiles", {timeout: 20_000}, () => {
	it("give each tile a tsh of its own: a job in one is not in the other's table", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t1", "counter &\r");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t1" && m.running === 1);
				d.type("t2", "jobs\r");
				const two = yield* d.prompts("t2", 2);
				return {two, told: [...d.told], views: [...d.views]};
			}).pipe(Effect.scoped),
		);
		expect(seen.two).toEqual(["tsh$ jobs", "tsh$"]);
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
		expect(seen.covered).toMatchObject({type: "covered", tile: "t1", run: {program: "counter"}});
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
		expect(seen.covered).toMatchObject({type: "covered", tile: "t1", run: {program: "counter"}});
		const run = seen.covered.type === "covered" ? seen.covered.run.id : "";
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
				// Nothing is dropped until the desk says stop.
				const before = [...d.dropped];
				yield* d.tiles.stop("t2");
				return {ended, before, rows, dropped: [...d.dropped], gone: [...d.gone]};
			}).pipe(Effect.scoped),
		);
		expect(seen.ended).toEqual({type: "ended", tile: "t2"});
		// The foreground counter ended on its inputs' end: it printed its count, and was not stopped.
		expect(seen.rows.some((r) => r.includes("stopped") || r === "^C")).toBe(false);
		expect(seen.before).toEqual([]);
		expect(seen.dropped).toEqual(["t2"]);
		expect(seen.gone.at(-1)).toBe("tile:t2");
		expect(seen.gone.filter((n) => n.startsWith("run:"))).toHaveLength(1);
	});

	it("stop a closing tile whose program does not end on its inputs' end", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t2");
				d.type("t2", "sleep --ms 600000 &\r");
				yield* d.heard((m) => m.type === "jobs" && m.running === 1);
				yield* d.tiles.close("t2");
				d.told.length = 0;
				yield* d.tiles.stop("t2");
				// A tile stopped already: nothing happens.
				yield* d.tiles.stop("t2");
				return {dropped: [...d.dropped], gone: [...d.gone], told: [...d.told]};
			}).pipe(Effect.scoped),
		);
		expect(seen.dropped).toEqual(["t2"]);
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
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t2" && m.running === 1);
				yield* d.tiles.close("t2");
				yield* d.heard((m) => m.type === "ended" && m.tile === "t2");
				yield* d.tiles.stop("t2");
				return {covered, told: [...d.told], gone: [...d.gone]};
			}).pipe(Effect.scoped),
		);
		const run = seen.covered.type === "covered" ? seen.covered.run.id : "";
		// t1's counter still covers t1: it is not over, and its port is still there.
		expect(seen.told).not.toContainEqual({type: "over", run});
		expect(seen.told.filter((m) => m.type === "jobs" && m.tile === "t1").at(-1)).toEqual({
			type: "jobs",
			tile: "t1",
			running: 1,
		});
		expect(seen.gone).not.toContain(`run:${run}`);
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
				yield* d.heard((m) => m.type === "jobs" && m.running === 1);
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

	it("keep a tile's jobs when the host stops, for the next start's `attach`", async () => {
		const folders = new Map<string, Place>();
		const found = await go(
			Effect.gen(function* () {
				const dropped = yield* Effect.gen(function* () {
					const d = yield* desk(folders);
					yield* d.tiles.open("t1");
					d.type("t1", "counter &\r");
					yield* d.heard((m) => m.type === "jobs" && m.running === 1);
					return d.dropped;
				}).pipe(Effect.scoped);
				// The next start, on the same folders.
				const d = yield* desk(folders);
				yield* d.tiles.open("t1");
				const row = yield* d.until("the earlier job", () =>
					d.rows("t1").find((r) => r.startsWith("tsh: 1 job")),
				);
				return {dropped, row};
			}).pipe(Effect.scoped),
		);
		expect(found.dropped).toEqual([]);
		expect(found.row).toMatch(/^tsh: 1 job from an earlier tsh, not running: %1\./);
	});
});
