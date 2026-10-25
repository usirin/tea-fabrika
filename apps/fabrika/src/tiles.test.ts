import {Ledger, memoryStorage} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {memoryHistory, sharedHistory} from "./editor/history.ts";
import type {Screen} from "./host.ts";
import type {ToDesk, ToTerminal} from "./messages.ts";
import {type Place, startTiles} from "./tiles.ts";

// The tiles, with fake ports and memory folders and no Electron: what the desk is told, what each
// tile's terminal shows, and which folders go.

/** The tiles of one start of the app. `folders` outlive it, as the home's folders do. */
const desk = (folders = new Map<string, Place>()) =>
	Effect.gen(function* () {
		const told: ToDesk[] = [];
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
		const heard = (check: (m: ToDesk) => boolean) =>
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
				const beside = yield* d.heard((m) => m.type === "beside");
				yield* d.heard((m) => m.type === "jobs" && m.tile === "t1" && m.running === 1);
				d.type("t2", "jobs\r");
				const two = yield* d.prompts("t2", 2);
				return {beside, two, views: d.views};
			}).pipe(Effect.scoped),
		);
		expect(seen.beside).toMatchObject({type: "beside", tile: "t1", run: {program: "counter"}});
		expect(seen.views).toHaveLength(1);
		expect(seen.two).toEqual(["tsh$ jobs", "tsh$"]);
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

	it("stop a run by its id, whichever tile started it", async () => {
		const over = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t2", "counter &\r");
				const beside = yield* d.heard((m) => m.type === "beside");
				const run = beside.type === "beside" ? beside.run.id : "";
				yield* d.tiles.stop(run);
				return yield* d.heard((m) => m.type === "over" && m.run === run);
			}).pipe(Effect.scoped),
		);
		expect(over.type).toBe("over");
	});

	it("close a tile: its runs end, its port goes, and its folder is dropped", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				yield* d.tiles.open("t2");
				d.type("t2", "counter &\r");
				yield* d.heard((m) => m.type === "beside");
				yield* d.tiles.close("t2");
				// A tile closed already: nothing happens.
				yield* d.tiles.close("t2");
				return {gone: [...d.gone], dropped: [...d.dropped], told: [...d.told]};
			}).pipe(Effect.scoped),
		);
		expect(seen.dropped).toEqual(["t2"]);
		expect(seen.gone.at(-1)).toBe("tile:t2");
		expect(seen.gone.filter((n) => n.startsWith("run:"))).toHaveLength(1);
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

	it("show a tile that runs on a fresh port, and tell a page loaded again what runs", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const d = yield* desk();
				yield* d.tiles.open("t1");
				d.type("t1", "counter &\r");
				yield* d.heard((m) => m.type === "jobs" && m.running === 1);
				yield* d.prompts("t1", 2);
				d.told.length = 0;
				d.views.length = 0;
				// The page was loaded again: it opens t1 again, and is told what runs.
				yield* d.tiles.open("t1");
				yield* d.tiles.replay;
				return {told: [...d.told], views: [...d.views], rows: d.rows("t1")};
			}).pipe(Effect.scoped),
		);
		expect(seen.told.map((m) => m.type)).toEqual(["beside", "jobs"]);
		expect(seen.views).toHaveLength(1);
		// The same tsh, its screen shown again from the start.
		expect(seen.rows[0]).toBe("tsh$ counter &");
	});

	it("keep a tile's jobs when the app quits, for the next start's `attach`", async () => {
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
