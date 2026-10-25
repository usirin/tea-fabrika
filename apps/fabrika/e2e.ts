import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readdir, readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {_electron, type ElectronApplication, type Page} from "playwright";

// The app, driven end to end through Playwright's Electron support: the whole flow in the one
// tiled window, one screenshot per step. Not part of `pnpm test` or CI: it opens a real window.
//
//   pnpm --filter @kampus/fabrika-app e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e     screenshots there, not in a temp folder
//
//   1 desk         the window opens on one tile, t1, at tsh's prompt
//   2 split        Ctrl-B |, then Ctrl-B -: three tiles, each with its own tsh
//   3 counter      `counter` in t3: counter covers t3, at 1 after a click; t1 and t2 as they were
//   4 tracker      `tracker &` in t2: the tracker opens in a tile beside t2, and t2's prompt is back
//   5 zoomed       Ctrl-B z: t2 fills the window
//   6 asked        Ctrl-B x on t2, with the tracker running: y or n first
//
// Then, with no screenshot: focus moves with Ctrl-B h and l and with a click; Ctrl-C over counter
// is back to t3's tsh; Ctrl-B x closes a tile with nothing running at once; Ctrl-B twice sends one
// Ctrl-B on; a line typed in one tile is in another's Up; the page has the bridge's three names and
// no Node; a message on the wrong port is refused; the page cannot navigate away; a second copy
// quits and leaves the first; and what Electron's own Node can do.
//
// Then the app quits with counter up in a tile, and is started again on the same home:
//
//   7 restored     the same two tiles come back; the tile with counter says 1 job from an earlier tsh
//   8 attached     `attach %n`: counter covers the tile again, at 1
//
// and closing the last tile quits the app.
//
// The terminals draw on canvases; the page keeps each screen as text too, for a screen reader,
// and that is what this reads. Playwright's API is promises, and this script stays in it.

const here = import.meta.dirname;
const electronPath: string = createRequire(import.meta.url)("electron");

const shots = process.env.SHOTS ?? (await mkdtemp(join(tmpdir(), "fabrika-e2e-")));
await mkdir(shots, {recursive: true});
const home = await mkdtemp(join(tmpdir(), "fabrika-home-"));
const env = {...process.env, FABRIKA_HOME: home};

const saved: string[] = [];
const shot = async (page: Page, name: string) => {
	const file = join(shots, `${name}.png`);
	await page.screenshot({path: file});
	saved.push(file);
};

const check = (what: string, ok: boolean, seen?: unknown) => {
	if (!ok)
		throw new Error(`${what}: no${seen === undefined ? "" : `, saw ${JSON.stringify(seen)}`}`);
	console.log(`ok  ${what}`);
};

/** Wait until `ok` holds, and answer what it saw. */
const until = async <T>(what: string, look: () => Promise<T>, ok: (seen: T) => boolean) => {
	let seen = await look();
	for (let i = 0; i < 200 && !ok(seen); i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		seen = await look();
	}
	if (!ok(seen)) throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
	return seen;
};

const tile = (page: Page, id: string) => page.locator(`[data-tile="${id}"]`);
/** A tile's screen, as text: its rows, with no trailing spaces. */
const screen = async (page: Page, id: string) =>
	(await tile(page, id).locator(".screen-text").textContent({timeout: 2000})) ?? "";
const lastRow = (text: string) => text.split("\n").at(-1) ?? "";
/** The tiles drawn now, in reading order. */
const tiles = (page: Page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));
const focused = (page: Page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile", {timeout: 2000});

const shows = (page: Page, id: string, what: string, ok: (text: string) => boolean) =>
	until(`${id}: ${what}`, () => screen(page, id), ok);
const prompted = (page: Page, id: string) =>
	shows(page, id, "the prompt", (t) => lastRow(t) === "tsh$");

/** Type a line at the focused tile's prompt, wait to see it echoed, and press Enter. */
const run = async (page: Page, id: string, line: string) => {
	await page.keyboard.type(line);
	await shows(page, id, `the line ${line}`, (t) => lastRow(t) === `tsh$ ${line}`);
	await page.keyboard.press("Enter");
};

/** Ctrl-B, then `key`, as tmux's prefix. */
const prefixed = async (page: Page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};

const focusIs = (page: Page, id: string) =>
	until(
		`focus on ${id}`,
		() => focused(page),
		(f) => f === id,
	);
const tilesAre = (page: Page, ids: readonly string[]) =>
	until(
		`the tiles ${ids.join(" ")}`,
		() => tiles(page),
		(t) => t.join() === ids.join(),
	);

const countIn = (page: Page, id: string) => tile(page, id).getByLabel("count", {exact: true});

/** What the page can reach: the bridge's three names, and no Node. */
const reachOf = (page: Page) =>
	page.evaluate(() => ({
		require: typeof (globalThis as {require?: unknown}).require,
		process: typeof (globalThis as {process?: unknown}).process,
		bridge: Object.keys(window.fabrika).sort(),
		opened: window.open("https://example.com") === null,
	}));

const flow = async (app: ElectronApplication) => {
	const page = await app.firstWindow();
	await prompted(page, "t1");
	check("the desk starts on our own scheme", page.url() === "fabrika://app/desk.html", page.url());
	await run(page, "t1", "seq --to 3 | double");
	const answer = await prompted(page, "t1");
	check("t1's tsh answers", answer.includes("double 2\ndouble 4\ndouble 6\ntsh$"), answer);
	await shot(page, "1-desk");

	await prefixed(page, "|");
	await tilesAre(page, ["t1", "t2"]);
	await focusIs(page, "t2");
	await prompted(page, "t2");
	await prefixed(page, "-");
	await tilesAre(page, ["t1", "t2", "t3"]);
	await focusIs(page, "t3");
	await prompted(page, "t3");
	check("Ctrl-B | then Ctrl-B -: three tiles, each at its own prompt", true);
	await shot(page, "2-split");

	await prefixed(page, "h");
	await focusIs(page, "t1");
	await prefixed(page, "l");
	const right = await until(
		"focus off t1",
		() => focused(page),
		(f) => f !== "t1",
	);
	check("Ctrl-B h and Ctrl-B l move focus", right === "t2" || right === "t3", right);
	await tile(page, "t3").click();
	await focusIs(page, "t3");
	check("a click focuses a tile", true);

	await run(page, "t3", "counter");
	await countIn(page, "t3").waitFor();
	check("counter covers t3, at 0", (await countIn(page, "t3").innerText()) === "0");
	await tile(page, "t3").getByRole("button", {name: "+1"}).click();
	await countIn(page, "t3").filter({hasText: /^1$/}).waitFor();
	const t1 = await screen(page, "t1");
	check("t1 is as it was", t1.endsWith("double 6\ntsh$"), t1);
	await shot(page, "3-counter");
	await page.keyboard.press("Control+c");
	await until(
		"counter's view to go",
		() => countIn(page, "t3").count(),
		(n) => n === 0,
	);
	const stopped = await prompted(page, "t3");
	check(
		"Ctrl-C over counter goes to t3's tsh: counter stops, the prompt is back",
		stopped.includes("^C"),
		stopped,
	);

	await prefixed(page, "x");
	await tilesAre(page, ["t1", "t2"]);
	check("Ctrl-B x closes a tile with nothing running at once", true);

	await focusIs(page, "t2");
	await run(page, "t2", "tracker &");
	const three = await until(
		"the tracker's tile",
		() => tiles(page),
		(t) => t.length === 3,
	);
	const trackerTile = three.find((t) => t !== "t1" && t !== "t2") ?? "";
	await tile(page, trackerTile).getByLabel("tracker view").waitFor();
	await prompted(page, "t2");
	await focusIs(page, "t2");
	check("tracker & opens the tracker in a tile beside t2, and t2's prompt is back", true);
	await shot(page, "4-tracker");

	await prefixed(page, "z");
	await tilesAre(page, ["t2"]);
	check("Ctrl-B z zooms t2", true);
	await shot(page, "5-zoomed");
	await prefixed(page, "z");
	await tilesAre(page, ["t1", "t2", trackerTile]);

	await prefixed(page, "x");
	await page.getByRole("alertdialog").waitFor();
	await shot(page, "6-asked");
	await page.keyboard.press("n");
	await until(
		"no question",
		() => page.getByRole("alertdialog").count(),
		(n) => n === 0,
	);
	await tilesAre(page, ["t1", "t2", trackerTile]);
	check("Ctrl-B x on a tile with a run asks first, and n keeps it", true);
	await prefixed(page, "x");
	await page.getByRole("alertdialog").waitFor();
	await page.keyboard.press("y");
	await tilesAre(page, ["t1"]);
	await focusIs(page, "t1");
	check("y closes the tile and the tracker's tile with it", true);

	await page.keyboard.type("ab");
	await page.keyboard.press("Control+b");
	await page.keyboard.press("Control+b");
	await page.keyboard.type("X");
	await shows(page, "t1", "aXb", (t) => lastRow(t) === "tsh$ aXb");
	check("Ctrl-B twice sends one Ctrl-B on: the cursor went back one", true);
	await page.keyboard.press("Control+u");

	await prefixed(page, "|");
	const fresh = await until(
		"a new tile",
		() => tiles(page),
		(t) => t.length === 2,
	);
	const next = fresh[1] ?? "";
	await prompted(page, next);
	await page.keyboard.press("ArrowUp");
	await shows(page, next, "the other tile's line", (t) => lastRow(t) === "tsh$ tracker &");
	check("a line typed in one tile is in another's Up", true);
	await page.keyboard.press("Control+u");

	const reach = await reachOf(page);
	check(
		"the page has send, onMessage and forget only, and no Node",
		reach.require === "undefined" &&
			reach.process === "undefined" &&
			reach.bridge.join() === "forget,onMessage,send" &&
			reach.opened,
		reach,
	);
	await page.evaluate((next) => {
		window.fabrika.send(`tile:${next}`, {type: "line", value: "say --text no\r"});
		window.fabrika.send(`tile:${next}`, {type: "keys", data: "say --text no\r", to: "tsh:p1"});
		window.fabrika.send("tile:../t1", {type: "keys", data: "say --text no\r"});
		window.fabrika.send("desk", {type: "open", tile: "../../etc"});
		window.fabrika.send("desk", "rm -rf");
	}, next);
	await page.waitForTimeout(300);
	const refused = await screen(page, next);
	check("messages not of the protocol tell tsh nothing", !refused.includes("no"), refused);

	await run(page, next, "counter");
	await countIn(page, next).waitFor();
	await tile(page, next).getByRole("button", {name: "+1"}).click();
	await countIn(page, next).filter({hasText: /^1$/}).waitFor();

	// A second copy, on the same home, brings the first forward and quits.
	const second = await promisify(execFile)(electronPath, [here], {env, timeout: 20_000}).then(
		() => "quit",
		(e: unknown) => `failed: ${String(e)}`,
	);
	const windows = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);
	check(
		"a second copy quits, and the first keeps its one window",
		second === "quit" && windows === 1,
		{
			second,
			windows,
		},
	);

	const node = await app.evaluate(() => {
		const sqlite = process.getBuiltinModule("node:sqlite");
		const db = new sqlite.DatabaseSync(":memory:");
		const row = db.prepare("select sqlite_version() as v").get();
		db.close();
		return {node: process.versions.node, electron: process.versions.electron, sqlite: row?.v};
	});
	console.log(`    ${JSON.stringify(node)}`);
	check("node:sqlite runs in Electron's main process", typeof node.sqlite === "string", node);

	// Last: Playwright waits on the navigation main refused, so the page is not driven after it.
	await page.evaluate(() => {
		window.location.href = "https://example.com";
	});
	await page.waitForTimeout(500);
	const url = await app.evaluate(({BrowserWindow}) =>
		BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
	);
	check("the page cannot navigate away", url === "fabrika://app/desk.html", url);
	return next;
};

/** Started again on the same home: the tiles come back, and attach brings counter back where it was. */
const again = async (app: ElectronApplication, left: string) => {
	const page = await app.firstWindow();
	await tilesAre(page, ["t1", left]);
	const found = await shows(page, left, "the earlier job", (t) =>
		t.includes("from an earlier tsh"),
	);
	const n = /1 job from an earlier tsh, not running: %(\d+)\./.exec(
		found.replaceAll("\n", ""),
	)?.[1];
	check(
		"started again, the two tiles are back, and counter's job is there",
		n !== undefined,
		found,
	);
	await prompted(page, left);
	await focusIs(page, left);
	await shot(page, "7-restored");

	await run(page, left, `attach %${n}`);
	await countIn(page, left).waitFor();
	check(
		"attach: counter covers the tile again, at 1",
		(await countIn(page, left).innerText()) === "1",
	);
	await shot(page, "8-attached");
	await tile(page, left).getByRole("button", {name: "done"}).click();
	const back = await shows(page, left, "counter's count", (t) =>
		t.includes(`tsh$ attach %${n}\n1\n`),
	);
	check("done: counter ends, tsh prints 1", true, back);

	await prompted(page, left);
	await prefixed(page, "x");
	await tilesAre(page, ["t1"]);
	const closed = app.waitForEvent("close");
	await prefixed(page, "x");
	await closed;
	check("closing the last tile quits the app", true);
};

const launch = () => _electron.launch({executablePath: electronPath, args: [here], env});

const first = await launch();
let left = "";
try {
	left = await flow(first);
} finally {
	// With counter up, at 1: `close` asks Electron's `app.quit()`, as Cmd+Q does.
	await first.close();
}
const kept = await readdir(join(home, "storage", "tiles")).catch((): string[] => []);
check(
	"the tile left with counter kept its jobs in its own folder, and no closed tile did",
	kept.includes(left) && !kept.includes("t2") && !kept.includes("t3"),
	kept,
);
const desk = await readFile(join(home, "desk.json"), "utf8").catch(() => "");
check("the desk was kept in the home", desk.includes(`"${left}"`), desk);
const history = await readFile(join(home, "history"), "utf8").catch(() => "");
check("the history was kept in the home", history.endsWith("counter\n"), history);
const next = await launch();
try {
	await again(next, left);
} finally {
	await next.close().catch(() => {});
}
console.log(`screenshots:\n${saved.map((s) => `  ${s}`).join("\n")}`);
