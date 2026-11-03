import {type ChildProcess, spawn} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium, type Page} from "playwright";

// Experiment 195 part 2: the slice's window, built today's way (esbuild) and with Rolldown plus
// oxc's React Compiler, driven in headless Chromium. Per run: build and cold start, the first
// draw, keys, console errors, and renders per tile (experiment 176's devtools-hook probe) on a
// focus move, on a patch from another window, and on a press in this window.
//
// It runs inside a checkout of PR 223 (`next/` at 7c1d0730), not on main: apply
// `195-oxc-toolchain-window.patch`, add `rolldown` 1.2.13 and `oxc-transform-react` 0.156.0 to
// `next/package.json` (exact), copy this file to `next/bench-195.ts`, and run it from there.
// Shapes: `inline` is the slice's own desk, `stable` passes the dispatch instead of handlers,
// `hoisted` also puts the fold on its own line, `flat` passes the tile as plain values. Part 3 adds
// `own`, where each tile reads its own view through `useRuntime` on a narrow handle, and `narrow`,
// where `App` and `Status` read only their own parts too. Part 3 also times each commit, from the
// store's first notify to React's commit hook, and takes desks of 9, 30 and 60 tiles.
//
//   node next/bench-195.ts --out=<file.json> [--runs=3] [--tiles=9] [--mode=production]
//     [--patches=10] [--heavy=0]
//     [--variants=esbuild:inline:0,rolldown:inline:0,...]   build:shape:memo[:tiles[:heavy]]

const flag = (name: string): string | undefined =>
	process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const OUT = flag("out") ?? "bench-195.json";
const RUNS = Number(flag("runs") ?? "3");
const TILES = flag("tiles") ?? "9";
const MODE = flag("mode") ?? "production";
const SCRATCH = flag("scratch") ?? tmpdir();
const PATCHES = Number(flag("patches") ?? "10");
const HEAVY = flag("heavy") ?? "0";
const VARIANTS = (
	flag("variants") ??
	"esbuild:inline:0,esbuild:inline:1,esbuild:stable:0,esbuild:stable:1,rolldown:inline:0,rolldown:inline:1,rolldown:stable:0,rolldown:stable:1"
)
	.split(",")
	.map((v) => {
		const [build = "", shape = "", memo = "", tiles = TILES, heavy = HEAVY] = v.split(":");
		return {build, shape, memo, tiles, heavy};
	});
const MOVES = 10;

/** Experiment 176's probe, cut down: renders per tile, from React's devtools hook. */
const PROBE = String.raw`(() => {
	const COMPONENT = new Set([0, 1, 11, 14, 15]);
	const fresh = () => ({commits: 0, total: 0, outside: 0, perTile: {}, tileShell: {}, ms: []});
	let now = fresh();
	const visit = (f, tile, owner) => {
		for (let c = f; c !== null; c = c.sibling) {
			let at = tile;
			let by = owner;
			const prev = c.alternate;
			const ran = COMPONENT.has(c.tag) && (prev === null || (c.flags & 1) === 1);
			if (COMPONENT.has(c.tag)) by = {ran};
			if (c.tag === 5 && c.memoizedProps && c.memoizedProps["data-tile"] !== undefined) {
				at = c.memoizedProps["data-tile"];
				if (owner && owner.ran) now.tileShell[at] = (now.tileShell[at] ?? 0) + 1;
			}
			if (ran) {
				now.total += 1;
				if (at === null) now.outside += 1;
				else now.perTile[at] = (now.perTile[at] ?? 0) + 1;
			}
			if (c.child !== null && !(prev !== null && prev.child === c.child)) visit(c.child, at, by);
		}
	};
	window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
		isDisabled: false, supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE: () => {},
		onScheduleFiberRoot: () => {}, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {},
		onCommitFiberRoot: (_id, root) => {
			const at = window.__notifyAt;
			if (at !== undefined) { now.ms.push(performance.now() - at); window.__notifyAt = undefined; }
			now.commits += 1;
			visit(root.current, null, null);
		},
	};
	window.__probe = {reset: () => { now = fresh(); }, read: () => now};
})();`;

const freePort = (): Promise<number> =>
	new Promise((done, fail) => {
		const server = createServer();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const at = server.address();
			const port = typeof at === "object" && at !== null ? at.port : 0;
			server.close(() => done(port));
		});
	});

const until = async <A>(what: string, read: () => Promise<A | undefined>, ms = 30_000) => {
	const end = Date.now() + ms;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((done) => setTimeout(done, 10));
	}
};
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

const count = async (page: Page, tile: string) =>
	Number(await page.locator(`[data-tile="${tile}"] [data-count]`).innerText({timeout: 1000}));
const countIs = (page: Page, tile: string, n: number) =>
	until(`${tile} shows ${n}`, async () => ((await count(page, tile)) === n ? true : undefined));
const focusIs = (page: Page, tile: string) =>
	until(`focus ${tile}`, async () =>
		(await page.locator('[data-focused="true"]').getAttribute("data-tile")) === tile
			? true
			: undefined,
	);
const online = (page: Page) =>
	until("online", async () =>
		(await page.locator("[data-link]").getAttribute("data-link")) === "online" ? true : undefined,
	);

type Probe = {
	commits: number;
	total: number;
	outside: number;
	perTile: Record<string, number>;
	tileShell: Record<string, number>;
	ms: number[];
};
const reset = (page: Page) => page.evaluate(() => Reflect.get(window, "__probe").reset());
const read = (page: Page) => page.evaluate(() => Reflect.get(window, "__probe").read() as Probe);

type Variant = {build: string; shape: string; memo: string; tiles: string; heavy: string};
const name = (v: Variant) => `${v.build}:${v.shape}:${v.memo}:${v.tiles}:${v.heavy}`;
/** Each tile at least 240 by 140 (fold.ts's MIN_W and MIN_H), so none folds. */
const VIEWPORT: Record<string, {width: number; height: number}> = {
	"9": {width: 1280, height: 800},
	"30": {width: 1600, height: 900},
	"60": {width: 2560, height: 1000},
};

const oneRun = async (variant: Variant, run: number) => {
	const port = await freePort();
	const data = mkdtempSync(join(SCRATCH, "b195-"));
	const report = join(data, "build.json");
	const env = {
		...process.env,
		BUILD: variant.build,
		TILE_SHAPE: variant.shape,
		TILE_MEMO: variant.memo,
		TILE_HEAVY: variant.heavy,
		DESK_TILES: variant.tiles,
		MODE,
		BUILD_REPORT: report,
	};
	const spawned = Date.now();
	const dev: ChildProcess = spawn(
		process.execPath,
		[
			"--no-warnings",
			fileURLToPath(new URL("dev.ts", import.meta.url)),
			`--port=${port}`,
			`--data=${data}`,
		],
		{env, stdio: ["ignore", "pipe", "inherit"]},
	);
	let up: {node: number; workerd: number; ms: number} | undefined;
	let upAt = 0;
	dev.stdout?.on("data", (chunk: Buffer) => {
		for (const line of chunk.toString("utf8").split("\n")) {
			if (line.startsWith("brain up: ") && up === undefined) {
				up = JSON.parse(line.slice("brain up: ".length));
				upAt = Date.now();
			}
		}
	});
	const browser = await chromium.launch({headless: true});
	const logged: string[] = [];
	try {
		await until("brain up", async () => up);
		const built = JSON.parse(readFileSync(report, "utf8"));
		const context = await browser.newContext({
			viewport: VIEWPORT[variant.tiles] ?? {width: 1280, height: 800},
		});
		const a = await context.newPage();
		a.on("console", (m) => {
			if (m.type() === "error" || m.type() === "warning") logged.push(`${m.type()}: ${m.text()}`);
		});
		a.on("pageerror", (e) => logged.push(`pageerror: ${e.message}`));
		await a.addInitScript(PROBE);
		const tiles =
			VIEWPORT[variant.tiles] !== undefined
				? Array.from({length: Number(variant.tiles)}, (_, i) => `t${i + 1}`)
				: ["t1", "t2"];
		const loadAt = Date.now();
		await a.goto(`http://127.0.0.1:${port}/?ping=60s`);
		await online(a);
		await until("all counts drawn", async () => {
			for (const t of tiles)
				if ((await count(a, t).catch(() => Number.NaN)) !== 0) return undefined;
			return true;
		});
		const firstDrawMs = Date.now() - loadAt;
		const isolated = await a.evaluate(() => crossOriginIsolated);
		const b = await context.newPage();
		b.on("console", (m) => {
			if (m.type() === "error" || m.type() === "warning") logged.push(`b ${m.type()}: ${m.text()}`);
		});
		await b.goto(`http://127.0.0.1:${port}/?ping=60s`);
		await online(b);
		await countIs(b, "t1", 0);
		await pause(300);

		const other = tiles[tiles.length > 2 ? 4 : 1] ?? "t2";
		const head = (page: Page, tile: string) =>
			page.locator(`[data-tile="${tile}"] .tile-head`).click({position: {x: 10, y: 8}});

		// A focus move, clicked in this window.
		await reset(a);
		for (let i = 0; i < MOVES; i++) {
			const to = i % 2 === 0 ? other : "t1";
			await head(a, to);
			await focusIs(a, to);
			await focusIs(b, to);
			await pause(120);
		}
		const focusMove = await read(a);

		// A patch: the other window presses t1, this one only hears it.
		await reset(a);
		for (let i = 1; i <= PATCHES; i++) {
			await b.locator('[data-tile="t1"] .plus').click();
			await countIs(a, "t1", i);
			await pause(120);
		}
		const patch = await read(a);
		const folded = await a.locator('[data-folded="true"]').count();

		// A press in this window: outbox, answer and patch.
		await reset(a);
		for (let i = PATCHES + 1; i <= PATCHES + MOVES; i++) {
			await a.locator('[data-tile="t1"] .plus').click();
			await countIs(a, "t1", i);
			await countIs(b, "t1", i);
			await pause(120);
		}
		const press = await read(a);

		// Keys: the +1 button takes Enter and Space, and Tab moves on from it.
		const t2 = tiles[1] ?? "t2";
		await a.locator(`[data-tile="${t2}"] .plus`).focus();
		await a.keyboard.press("Enter");
		await countIs(b, t2, 1);
		await a.keyboard.press("Space");
		await countIs(b, t2, 2);
		await countIs(a, t2, 2);
		const focusedClass = await a.evaluate(() => document.activeElement?.className ?? "");
		await a.keyboard.press("Tab");
		const afterTab = await a.evaluate(
			() => document.activeElement?.closest("[data-tile]")?.getAttribute("data-tile") ?? "",
		);
		const keys = {enterAndSpace: true, focusedBefore: focusedClass, tabLandsIn: afterTab};

		await context.close();
		const per = (p: Probe, moves = MOVES) => ({
			commits: p.commits / moves,
			total: p.total / moves,
			outside: p.outside / moves,
			perTile: Object.fromEntries(tiles.map((t) => [t, (p.perTile[t] ?? 0) / moves])),
			tileShell: Object.fromEntries(tiles.map((t) => [t, (p.tileShell[t] ?? 0) / moves])),
			ms: p.ms,
		});
		return {
			...variant,
			run,
			mode: MODE,
			tiles: tiles.length,
			buildMs: built.ms,
			bytes: built.bytes,
			compiler: built.compiler,
			brainUpMs: upAt - spawned,
			workerdReadyMs: up?.ms,
			firstDrawMs,
			isolated,
			folded,
			focusMove: per(focusMove),
			patch: per(patch, PATCHES),
			press: per(press),
			keys,
			console: logged,
		};
	} finally {
		await browser.close();
		const gone = new Promise((done) => dev.on("exit", done));
		dev.kill("SIGTERM");
		await gone;
		if (up !== undefined) {
			for (const pid of [up.workerd, up.node]) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Gone already.
				}
			}
		}
		rmSync(data, {recursive: true, force: true});
	}
};

const median = (xs: readonly number[]): number => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

const results: unknown[] = [];
for (let run = 1; run <= RUNS; run++) {
	for (const variant of VARIANTS) {
		try {
			const r = await oneRun(variant, run);
			results.push(r);
			process.stdout.write(
				`${name(variant)} run ${run}: build ${r.buildMs} ms, draw ${r.firstDrawMs} ms, isolated ${r.isolated}, folded ${r.folded}, focus ${r.focusMove.total}, patch ${r.patch.total}, press ${r.press.total}, patch ms ${median(r.patch.ms).toFixed(2)}, console ${r.console.length}\n`,
			);
		} catch (error) {
			results.push({...variant, run, failed: String(error)});
			process.stdout.write(`${name(variant)} run ${run}: FAIL ${String(error)}\n`);
		}
		writeFileSync(OUT, JSON.stringify(results, null, "\t"));
	}
}
