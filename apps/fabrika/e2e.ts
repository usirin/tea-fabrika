import {execFile, spawn} from "node:child_process";
import {mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {createServer, type Socket} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import type {Shell} from "@kampus/fabrika-old";
import {_electron, type ElectronApplication, type Page} from "playwright";

// The app, driven end to end through Playwright's Electron support: the whole flow in the one
// tiled window, one screenshot per step. Not part of `pnpm test`: it opens a real window. The
// window rules it checks are macOS's, so it runs on a Mac: CI runs it on a macOS runner, the
// check workflow's `e2e` job, on every pull request and every push to main.
//
//   pnpm --filter @kampus/fabrika-app-old e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app-old e2e     screenshots there, not in a temp folder
//
//   1 desk           the window opens on one tile, t1, at tsh's prompt
//   2 split          Ctrl-B |, then Ctrl-B -: three tiles, each with its own tsh
//   3 counter        `counter` in t3: counter covers t3, at 1 after a click; t1 and t2 as they were
//   4 close-asked    Ctrl-B x on t3, with nothing running: "close t3? (y/n)"; n keeps it, y closes it
//   5 attached       `tracker &` in t2 opens no tile; `attach %1` brings it in, covering t2
//   5b link          a ticket filed with URLs in its body; a click on one hands it to the browser,
//                    and the window stays on the desk
//   6 zoomed         Ctrl-B z: t2 fills the window
//   7 closing        `sleep --ms 600000 &` in t1, Ctrl-B x, y: t1 shows "closing", as sleep runs on
//   8 stop-asked     Ctrl-B x on the closing t1: "stop t1 now? (y/n)"; y and t1 goes
//
// Then, with no screenshot: focus moves with Ctrl-B h and l and with a click; what opens over the
// desk (the asks list, the palette) takes focus and every key it reads, so no arrow reaches the tile
// under it, and Escape or a press outside gives focus back, one open at a time; Ctrl-C over counter
// is back to t3's tsh; Ctrl-B twice sends one Ctrl-B on; a line typed in one tile is in another's
// Up; the page has the bridge's three names and no Node; a message on the wrong port is refused;
// window.open hands http and https to the browser and refuses file:, javascript: and the app's
// own; the page cannot navigate away; and a second copy quits and leaves the first.
//
// No run opens a real browser: every launch swaps main's `shell.openExternal` for a list first,
// and reads the swap back before anything is clicked.
//
// Then the window's own close button, as macOS has it:
//
//   9 reopened       the window closed, the app runs on with no window; the dock icon (`activate`)
//                    brings a new window on the same desk, with counter and the tracker still up
//
// Then y on t2, covered by the tracker: the tracker gets the end of its inputs, ends, and t2 goes.
// The app quits with counter up in a tile. The host it started runs on, apart from the app, as
// the tmux server outlives its client: its pid (in `<home>/host/pid`) is alive, and counter with
// it. The app is started again on the same home, and attaches to that host:
//
//   10 restored      the same desk, with counter still up in its tile, at 1: nothing restarted
//
// Ctrl-B | splits there, through the host. Done ends counter; closing the last tile closes the
// window, not the app; the dock icon then opens one fresh tile. Then the app quits.
//
// Then a host of another version, on a home of its own: a small Node server on that home's
// socket that says hello with version 0. The app does not attach, and says so:
//
//   11 mismatch      "Not attached to the host", with both versions; that host still runs
//
// Then a host that only talks about asks, on a home of its own: with the list open, one ask leaves
// as another arrives, and the page says the new one is seen, with the count the same.
//
// Then the link to the host drops while the app runs, on a home of its own, with seq's 60 lines
// in t1 and counter in t2. Main's dialogs, dock bounce and focus are swapped for a list first,
// and read back empty after each drop:
//
//   socket cut       main's socket to the host is cut, the host alive: the top bar says host
//                    down, then the desk is back on the same host, t1 drawn once
//   host killed      SIGKILL, as a crash: the app starts a new host, and the kept desk comes
//                    back with fresh screens
//   12 reconnecting  no host to be had (the home's host folder is a file): the desk stays,
//                    dimmed and out of reach; the top bar says host down, its lines reconnecting
//   13 stopped       main's clock moved five minutes on: it stops, and the top bar offers try
//                    again, which takes no focus. The folder back, a click on it starts a host,
//                    and the desk is back
//
// Last, as no person ever does (there is no stop command), the run stops the host it started by
// its pid, and the fake one too, and checks with pgrep that nothing of either home is left.
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

/** The question a tile asks now, or "" for none. */
const asked = (page: Page) =>
	page
		.getByRole("alertdialog")
		.textContent({timeout: 2000})
		.then((t) => t ?? "");
const askedIs = (page: Page, question: string) =>
	until(
		`the question ${question}`,
		() => asked(page),
		(q) => q === question,
	);
const noQuestion = (page: Page) =>
	until(
		"no question",
		() => page.getByRole("alertdialog").count(),
		(n) => n === 0,
	);
const closingIn = (page: Page, id: string) => tile(page, id).getByRole("status").count();

const countIn = (page: Page, id: string) => tile(page, id).getByLabel("count", {exact: true});
const windowCount = (app: ElectronApplication) =>
	app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);

/** What the page can reach: the bridge's three names, and no Node. */
const reachOf = (page: Page) =>
	page.evaluate(() => ({
		require: typeof (globalThis as {require?: unknown}).require,
		process: typeof (globalThis as {process?: unknown}).process,
		bridge: Object.keys(window.fabrika).sort(),
		opened: window.open("https://example.com") === null,
	}));

/**
 * Main's `shell.openExternal`, swapped for a list, so the run never opens a real browser. Read
 * back: a swap that did not take stops the run before anything is clicked.
 */
const noBrowser = async (app: ElectronApplication) => {
	const swapped = await app.evaluate(({shell}) => {
		const opened: string[] = [];
		Object.assign(globalThis, {opened});
		const list = async (url: string) => {
			opened.push(url);
		};
		shell.openExternal = list;
		return shell.openExternal === list;
	});
	if (!swapped)
		throw new Error("shell.openExternal was not swapped: this run would open a real browser");
};
/** What main has asked the browser to open, in order. */
const openedOutside = (app: ElectronApplication) =>
	app.evaluate(() => (globalThis as {opened?: string[]}).opened ?? []);

/** The dock icon, clicked: Electron's `activate`, and the window it brings. */
const activate = async (app: ElectronApplication) => {
	const next = app.waitForEvent("window");
	await app.evaluate(({app}) => {
		app.emit("activate");
	});
	return await next;
};

/** The popover that holds the page's focus: its id, or `null`. */
const overHolds = (page: Page) =>
	page.evaluate(() => document.activeElement?.closest("[data-over]")?.id ?? null);
const gone = (page: Page, id: string) =>
	until(
		`#${id} to close`,
		() => page.locator(`#${id}`).count(),
		(n) => n === 0,
	);

/**
 * What opens over the desk (docs/direction/popovers.md), from t3 at an empty prompt, with t1's
 * line in the shared history: focus moves in; no key it takes reaches t3 under it, even with
 * focus knocked out of it; Escape and a press outside close it, focus back in t3; one at a time.
 */
const popovers = async (page: Page) => {
	await prefixed(page, "a");
	await page.locator("#pop-asks").waitFor();
	check("Ctrl-B a opens the asks list, focus in it", (await overHolds(page)) === "pop-asks");
	const empty = (await page.locator("#pop-asks").textContent()) ?? "";
	check(
		"with nothing waiting, it says so in one calm line",
		empty.includes("Nothing waits on you"),
	);
	for (const key of ["ArrowUp", "ArrowDown", "Enter", "j", "x"]) await page.keyboard.press(key);
	// Focus knocked out of the list, onto the page itself: the next key still never reaches t3.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.keyboard.press("ArrowUp");
	check("a key with focus outside it moves focus back in", (await overHolds(page)) === "pop-asks");
	await page.waitForTimeout(200);
	const under = await screen(page, "t3");
	check("no arrow, Enter or letter reached t3 under the list", lastRow(under) === "tsh$", under);
	await page.keyboard.press("Escape");
	await gone(page, "pop-asks");
	check("Escape closes it, and focus is back in t3", (await focusedIn(page)) === "t3");

	await page.keyboard.press("Meta+k");
	const palette = page.getByRole("dialog", {name: "Commands"});
	await palette.waitFor();
	check(
		"Cmd-K opens the palette, focus in its text box",
		(await overHolds(page)) === "pop-palette",
	);
	await page.keyboard.type("zo");
	await page.keyboard.press("ArrowDown");
	const typed = await palette.getByRole("combobox").inputValue();
	check("what is typed goes to its text box, not to t3", typed === "zo", typed);
	await page.keyboard.press("Escape");
	await gone(page, "pop-palette");
	check("Escape closes the palette, and focus is back in t3", (await focusedIn(page)) === "t3");

	await prefixed(page, "a");
	await page.locator("#pop-asks").waitFor();
	await page.keyboard.press("Meta+k");
	await palette.waitFor();
	check(
		"one at a time: the palette takes the asks list's place",
		(await page.locator("#pop-asks").count()) === 0,
	);
	await page.keyboard.press("Escape");
	await gone(page, "pop-palette");

	await prefixed(page, "a");
	await page.locator("#pop-asks").waitFor();
	await tile(page, "t3").click();
	await gone(page, "pop-asks");
	check("a press outside closes the list, and focus is in t3", (await focusedIn(page)) === "t3");
	const still = await screen(page, "t3");
	check("t3's prompt is still empty", lastRow(still) === "tsh$", still);

	// And with nothing open, Up does reach t3: the keys above were held back, not lost on the way.
	await page.keyboard.press("ArrowUp");
	await shows(
		page,
		"t3",
		"t1's line, from the history",
		(t) => lastRow(t) === "tsh$ seq --to 3 | double",
	);
	await page.keyboard.press("Control+c");
	await prompted(page, "t3");
};

const flow = async (app: ElectronApplication) => {
	const page = await app.firstWindow();
	await prompted(page, "t1");
	check("the desk starts on our own scheme", page.url() === "fabrika://app/desk.html", page.url());
	await run(page, "t1", "seq --to 3 | double");
	const answer = await prompted(page, "t1");
	check("t1's tsh answers", answer.includes("double 2\ndouble 4\ndouble 6\ntsh$"), answer);
	await quietAtRest(page);
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
	await popovers(page);

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
	await askedIs(page, "close t3? (y/n)");
	await shot(page, "4-close-asked");
	await page.keyboard.press("n");
	await noQuestion(page);
	await tilesAre(page, ["t1", "t2", "t3"]);
	check("Ctrl-B x asks on a tile with nothing running too, and n keeps it", true);
	await prefixed(page, "x");
	await askedIs(page, "close t3? (y/n)");
	await page.keyboard.press("y");
	await tilesAre(page, ["t1", "t2"]);
	check("y closes a tile with nothing running at once", true);

	await focusIs(page, "t2");
	await run(page, "t2", "tracker &");
	// The host keeps one job table, numbers never reused: the tracker's is whatever comes next.
	const job = await shows(page, "t2", "the job's number", (t) => /\[\d+\] tracker:/.test(t));
	const n = /\[(\d+)\] tracker:/.exec(job)?.[1] ?? "1";
	await prompted(page, "t2");
	await page.waitForTimeout(300);
	await tilesAre(page, ["t1", "t2"]);
	check(
		"tracker & opens no tile: a job in the background, and t2's prompt is back",
		(await tile(page, "t2").getByLabel("tracker view").count()) === 0,
		job,
	);
	await run(page, "t2", `attach %${n}`);
	await tile(page, "t2").getByLabel("tracker view").waitFor();
	await tilesAre(page, ["t1", "t2"]);
	check(`attach %${n} brings the tracker in, covering t2, as fg does`, true);
	await shot(page, "5-attached");

	const tracker = tile(page, "t2").getByLabel("tracker view");
	await tracker.getByLabel("new ticket title").fill("Links");
	await tracker
		.getByLabel("new ticket body")
		.fill("See https://example.com/a_(b). Or (https://example.org/x), not javascript:alert(1).");
	await tracker.getByRole("button", {name: "File ticket"}).click();
	await tracker.getByRole("button", {name: /Links/}).click();
	const link = tracker.getByRole("link", {name: "https://example.com/a_(b)", exact: true});
	await link.waitFor();
	const shown = await tracker
		.getByRole("link")
		.evaluateAll((all) =>
			all.map((a) => [a.textContent, a.getAttribute("target"), a.getAttribute("rel")].join(" ")),
		);
	check(
		"a ticket's body links its http and https URLs, GitHub's way: no trailing . ) or ,",
		shown.join() ===
			[
				"https://example.com/a_(b) _blank noreferrer",
				"https://example.org/x _blank noreferrer",
			].join(),
		shown,
	);
	await link.click();
	const clicked = await until(
		"the link to go to the browser",
		() => openedOutside(app),
		(o) => o.length > 0,
	);
	check(
		"a click on a link hands its URL to the browser",
		clicked.join() === "https://example.com/a_(b)",
		clicked,
	);
	check(
		"and the window stays on the desk, with no window of its own",
		page.url() === "fabrika://app/desk.html" && (await windowCount(app)) === 1,
		page.url(),
	);
	await shot(page, "5b-link");

	await prefixed(page, "z");
	await tilesAre(page, ["t2"]);
	check("Ctrl-B z zooms t2", true);
	await shot(page, "6-zoomed");
	await prefixed(page, "z");
	await tilesAre(page, ["t1", "t2"]);

	await prefixed(page, "h");
	await focusIs(page, "t1");
	await run(page, "t1", "sleep --ms 600000 &");
	await prompted(page, "t1");
	await until(
		"t1's job on the bottom line",
		() => page.locator(".bottomline .job").innerText(),
		(t) => /^%\d+ sleep --ms 600000 \d+s$/.test(t),
	);
	await prefixed(page, "x");
	await askedIs(page, "close t1? (y/n)");
	await page.keyboard.press("y");
	await until(
		"t1 closing",
		() => closingIn(page, "t1"),
		(n) => n === 1,
	);
	await page.waitForTimeout(300);
	await tilesAre(page, ["t1", "t2"]);
	check(
		"y on a busy tile: it shows closing, and waits, as sleep does not end on its inputs' end",
		(await tile(page, "t2").getByLabel("tracker view").count()) === 1,
	);
	await shot(page, "7-closing");
	await prefixed(page, "x");
	await askedIs(page, "stop t1 now? (y/n)");
	await shot(page, "8-stop-asked");
	await page.keyboard.press("n");
	await noQuestion(page);
	check("Ctrl-B x on a closing tile asks to stop now, and n keeps it closing", true);
	await prefixed(page, "x");
	await askedIs(page, "stop t1 now? (y/n)");
	await page.keyboard.press("y");
	await tilesAre(page, ["t2"]);
	check(
		"y stops t1, and the tracker in t2 runs on",
		(await tile(page, "t2").getByLabel("tracker view").count()) === 1,
	);

	await prefixed(page, "|");
	const split = await until(
		"a new tile",
		() => tiles(page),
		(t) => t.length === 2,
	);
	const next = split[1] ?? "";
	await prompted(page, next);
	await page.keyboard.type("ab");
	await page.keyboard.press("Control+b");
	await page.keyboard.press("Control+b");
	await page.keyboard.type("X");
	await shows(page, next, "aXb", (t) => lastRow(t) === "tsh$ aXb");
	check("Ctrl-B twice sends one Ctrl-B on: the cursor went back one", true);
	await page.keyboard.press("Control+u");
	await page.keyboard.press("ArrowUp");
	await shows(
		page,
		next,
		"the other tile's line",
		(t) => lastRow(t) === "tsh$ sleep --ms 600000 &",
	);
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
	await page.evaluate(() => {
		window.open("javascript:alert(1)");
		window.open("file:///etc/hosts");
		window.open("fabrika://app/desk.html");
		window.open("x-custom://open");
	});
	await page.waitForTimeout(300);
	const outside = await openedOutside(app);
	check(
		"window.open hands only http and https to the browser: file:, javascript:, the app's own and a custom scheme are refused",
		outside.join() === ["https://example.com/a_(b)", "https://example.com/"].join() &&
			(await windowCount(app)) === 1,
		outside,
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
	const windows = await windowCount(app);
	check(
		"a second copy quits, and the first keeps its one window",
		second === "quit" && windows === 1,
		{
			second,
			windows,
		},
	);

	// Last on this page: Playwright waits on the navigation main refused, so it is not driven after.
	await page.evaluate(() => {
		window.location.href = "https://example.com";
	});
	await page.waitForTimeout(500);
	const url = await app.evaluate(({BrowserWindow}) =>
		BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
	);
	check("the page cannot navigate away", url === "fabrika://app/desk.html", url);
	const after = await openedOutside(app);
	check("and a navigation opens nothing in the browser either", after.length === 2, after);
	return next;
};

/** The red close button, then the dock icon: the app runs on with no window, and the desk comes back. */
const reopen = async (app: ElectronApplication, left: string) => {
	await app.evaluate(({BrowserWindow}) => {
		BrowserWindow.getAllWindows()[0]?.close();
	});
	await until(
		"no window",
		() => windowCount(app),
		(n) => n === 0,
	);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const alive = await app.evaluate(({app}) => app.isReady());
	check("the close button closes the window only: the app runs on, with no window", alive);

	const page = await activate(app);
	await tilesAre(page, ["t2", left]);
	await countIn(page, left).filter({hasText: /^1$/}).waitFor();
	await tile(page, "t2").getByLabel("tracker view").waitFor();
	check(
		"the dock icon brings a window on the same desk: counter at 1 and the tracker run on",
		true,
	);
	await shot(page, "9-reopened");

	await tile(page, "t2").click();
	await focusIs(page, "t2");
	await prefixed(page, "x");
	await askedIs(page, "close t2? (y/n)");
	await page.keyboard.press("y");
	await tilesAre(page, [left]);
	check("y on t2: the tracker gets the end of its inputs, ends, and t2 goes", true);
};

/** Started again on the same home: it attaches to the host that ran on, and the desk is as it was. */
const again = async (app: ElectronApplication, left: string) => {
	const page = await app.firstWindow();
	await tilesAre(page, [left]);
	await countIn(page, left).filter({hasText: /^1$/}).waitFor();
	const before = await screen(page, left);
	check(
		"started again: the same desk, with counter still up at 1, and no earlier job to attach",
		!before.includes("earlier tsh"),
		before,
	);
	await focusIs(page, left);
	await shot(page, "10-restored");

	await tile(page, left).getByRole("button", {name: "done"}).click();
	const back = await shows(page, left, "counter's count", (t) => t.includes("tsh$ counter\n1\n"));
	check("done: counter ends, the tsh that ran it all along prints 1", true, back);
	await prompted(page, left);

	await prefixed(page, "|");
	const split = await until(
		"a new tile",
		() => tiles(page),
		(t) => t.length === 2,
	);
	await prompted(page, split[1] ?? "");
	check("Ctrl-B | splits, through the host", split[0] === left, split);
	await prefixed(page, "x");
	await askedIs(page, `close ${split[1]}? (y/n)`);
	await page.keyboard.press("y");
	await tilesAre(page, [left]);
	await focusIs(page, left);

	const gone = page.waitForEvent("close");
	await prefixed(page, "x");
	await askedIs(page, `close ${left}? (y/n)`);
	// The window goes on this key, and may go before Playwright hears the key was taken.
	await page.keyboard.press("y").catch(() => {});
	await gone;
	await until(
		"no window",
		() => windowCount(app),
		(n) => n === 0,
	);
	await new Promise((resolve) => setTimeout(resolve, 500));
	check(
		"closing the last tile closes the window, and the app runs on",
		await app.evaluate(({app}) => app.isReady()),
	);
	const fresh = await activate(app);
	await tilesAre(fresh, ["t1"]);
	const first = await prompted(fresh, "t1");
	check(
		"the next window opens on one fresh tile with a fresh tsh",
		!first.includes("earlier tsh"),
		first,
	);
};

if (process.platform !== "darwin")
	throw new Error("this run checks macOS's window rules: run it on a Mac");

const launch = async (on: string) => {
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [here],
		env: {...process.env, FABRIKA_HOME: on},
	});
	await noBrowser(app).catch(async (e: unknown) => {
		await app.close().catch(() => {});
		throw e;
	});
	return app;
};

/** Is there a process with this pid? Signal 0 asks, and sends nothing. */
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
/** The pid the host wrote in its home, or none. */
const hostPid = async (on: string) => {
	const text = await readFile(join(on, "host", "pid"), "utf8").catch(() => "");
	const pid = Number.parseInt(text, 10);
	return Number.isInteger(pid) ? pid : null;
};
/**
 * The jobs in the host's one table, as kept in `<home>/storage/jobs` (host/run.ts), read from the
 * files and never opened: an open takes the table over from the host that runs on it
 * (@kampus/fabrika-old's host-jobs.ts), so its next write would fail. The table is the run `tsh`'s
 * machine `jobs`, under `table`, in two slots, the newer one whole (program/storage.ts). A file
 * that does not read fails the run, so a change to that layout is seen here.
 */
const keptJobs = async (on: string): Promise<readonly Shell.Job[]> => {
	const slots = await Promise.all(
		["a", "b"].map((slot) =>
			readFile(
				join(on, "storage", "jobs", encodeURIComponent(`run/tsh/machine/jobs/table/${slot}`)),
				"utf8",
			).then(
				(text): {opened: number; count: number; body: string} => JSON.parse(text),
				() => null,
			),
		),
	);
	const newest = slots
		.flatMap((slot) => (slot === null ? [] : [slot]))
		.sort((x, y) => y.opened - x.opened || y.count - x.count)[0];
	if (newest === undefined) throw new Error(`no job table kept in ${on}`);
	const table: Shell.Jobs = JSON.parse(newest.body);
	return table.jobs;
};
/** The pids whose command line names `what`, as pgrep finds them. */
const pgrep = (what: string) =>
	promisify(execFile)("pgrep", ["-f", what]).then(
		(r) => r.stdout.split("\n").filter((l) => l !== ""),
		(): string[] => [],
	);
/** Stop a process by its pid, as the test's own clean-up, and wait for it to be gone. */
const stop = async (pid: number) => {
	if (alive(pid)) process.kill(pid, "SIGTERM");
	await until(
		`pid ${pid} to stop`,
		async () => alive(pid),
		(up) => !up,
	);
};

/**
 * A host of another version: a Node server on the home's socket, in a 0700 folder as the host
 * keeps it, that says hello with version 0 to whoever connects.
 */
const oldHost = async (on: string) => {
	const dir = join(on, "host");
	await mkdir(dir, {recursive: true, mode: 0o700});
	const sock = join(dir, "sock");
	const child = spawn(
		process.execPath,
		[
			"-e",
			`require("node:net").createServer((c) => c.write('{"type":"hello","version":0}\\n')).listen(process.argv[1])`,
			sock,
		],
		{stdio: "ignore"},
	);
	await until(
		"the old host's socket",
		() =>
			stat(sock).then(
				(s) => s.isSocket(),
				() => false,
			),
		(up) => up,
	);
	return child;
};

/** The app on a home whose host speaks version 0: it does not attach, says so, and stops nothing. */
const mismatch = async () => {
	const other = await mkdtemp(join(tmpdir(), "fabrika-old-"));
	const old = await oldHost(other);
	try {
		const app = await launch(other);
		try {
			const page = await app.firstWindow();
			const said = await until(
				"the app to say it did not attach",
				() =>
					page
						.getByRole("alert")
						.textContent({timeout: 2000})
						.then(
							(t) => t ?? "",
							() => "",
						),
				(t) => t.includes("Not attached"),
			);
			check(
				"a host of another version: the app does not attach, and says both versions",
				said.includes("version 0") && said.includes("speaks 1") && (await tiles(page)).length === 0,
				said,
			);
			await shot(page, "11-mismatch");
		} finally {
			await app.close().catch(() => {});
		}
		check(
			"the host of another version still runs: the app did not stop it",
			old.pid !== undefined && alive(old.pid),
		);
	} finally {
		if (old.pid !== undefined) await stop(old.pid);
	}
	check(
		"the old host stopped by its pid: pgrep finds nothing on its home",
		(await pgrep(other)).length === 0,
	);
};

/**
 * A host that only talks about asks: a Node server on the home's socket, in this script, so a run
 * can hand the page one ask leaving as another arrives, in one line. A real host's read of the
 * ledger can do that, but nothing can make it do so on cue.
 */
const askingHost = async (on: string) => {
	const dir = join(on, "host");
	await mkdir(dir, {recursive: true, mode: 0o700});
	const heard: {readonly type: string; readonly m?: {readonly type: string}}[] = [];
	const links: Socket[] = [];
	const server = createServer((link) => {
		links.push(link);
		let held = "";
		link.on("error", () => {});
		link.on("data", (chunk) => {
			const lines = `${held}${chunk}`.split("\n");
			held = lines.pop() ?? "";
			for (const line of lines) {
				const m = JSON.parse(line);
				if (m.type === "hello") link.write('{"type":"hello","version":1}\n');
				else heard.push(m);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(join(dir, "sock"), resolve));
	return {
		heard,
		toPage: (m: unknown) => {
			for (const link of links) link.write(`${JSON.stringify({type: "to", port: "desk", m})}\n`);
		},
		stop: () => {
			for (const link of links) link.destroy();
			return new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
};

/**
 * The asks list stays open while one ask leaves as another arrives. The count holds, but the new
 * ask is seen, so the page says so, or the dot in the top bar stays on with the ask in plain view.
 */
const asksSwap = async () => {
	const other = await mkdtemp(join(tmpdir(), "fabrika-asks-"));
	const host = await askingHost(other);
	const asks = (key: string, what: string, seen: boolean) => ({
		type: "asks",
		now: {
			asks: [{key, ticket: 7, title: "Swap", what, kind: "ask", at: 1, seen}],
			later: [],
			reach: "ok",
			why: null,
		},
	});
	const seen = async () => host.heard.filter((m) => m.type === "on" && m.m?.type === "seen").length;
	const app = await launch(other);
	try {
		const page = await app.firstWindow();
		await until(
			"the page to load",
			async () => host.heard.some((m) => m.type === "page"),
			(up) => up,
		);
		host.toPage(asks("7/a-1", "first ask", false));
		host.toPage({type: "show", what: "asks"});
		const list = page.locator("#pop-asks");
		await list.getByText("First ask").waitFor();
		await until("the first seen", seen, (n) => n === 1);
		check("opening the asks list says its asks are seen", true);

		host.toPage(asks("7/a-2", "second ask", false));
		await list.getByText("Second ask").waitFor();
		await until("a seen for the ask that took its place", seen, (n) => n === 2);
		check("one ask leaving as another arrives, the count the same, says seen again", true);

		// The host's answer to a seen: the same keys, now marked. Saying seen again would never end.
		host.toPage(asks("7/a-2", "second ask", true));
		await page.waitForTimeout(300);
		check("the same asks marked seen say nothing more", (await seen()) === 2, await seen());
	} finally {
		await app.close().catch(() => {});
		await host.stop();
	}
};

/** Is `pid` a host of this build: its command line names this folder. Asked before any signal. */
const ours = (pid: number) =>
	promisify(execFile)("ps", ["-o", "command=", "-p", String(pid)]).then(
		(r) => r.stdout.includes(here),
		() => false,
	);
/** Kill a host this run started, as a crash does: SIGKILL, so it cleans nothing up. */
const crash = async (pid: number) => {
	check(`pid ${pid} is a host of this build, started by this run`, await ours(pid), pid);
	process.kill(pid, "SIGKILL");
	await until(
		`pid ${pid} to be gone`,
		async () => alive(pid),
		(up) => !up,
	);
};

/**
 * Cut main's socket to the host, as a link that breaks: the host runs on. It is main's one Unix
 * socket that is no stdio. Answers how many were cut.
 */
const cutLink = (app: ElectronApplication) =>
	app.evaluate(() => {
		interface Handle {
			readonly constructor: {readonly name: string};
			readonly _handle?: {readonly constructor: {readonly name: string}; readonly fd?: number};
			readonly destroy?: () => void;
		}
		const all = Reflect.get(process, "_getActiveHandles") as () => Handle[];
		const links = all
			.call(process)
			.filter(
				(h) =>
					h.constructor.name === "Socket" &&
					h._handle?.constructor.name === "Pipe" &&
					(h._handle.fd ?? -1) > 2,
			);
		for (const link of links) link.destroy?.();
		return links.length;
	});

/**
 * Main's ways to interrupt a person, swapped for a list: a dialog, a bounce of the dock icon, the
 * app or its window brought forward. Read back, as the browser's swap is.
 */
const noInterrupts = (app: ElectronApplication) =>
	app.evaluate(({app, dialog, BrowserWindow}) => {
		const asked: string[] = [];
		Object.assign(globalThis, {asked});
		const noted = (what: string) => () => {
			asked.push(what);
		};
		const box = noted("dialog");
		Object.assign(dialog, {showMessageBox: box, showMessageBoxSync: box, showErrorBox: box});
		if (app.dock !== undefined) Object.assign(app.dock, {bounce: noted("bounce")});
		Object.assign(app, {focus: noted("app focus")});
		for (const w of BrowserWindow.getAllWindows())
			Object.assign(w, {
				focus: noted("focus"),
				show: noted("show"),
				moveTop: noted("moveTop"),
				flashFrame: noted("flashFrame"),
			});
		const now: unknown = dialog.showMessageBox;
		return now === box;
	});
/** What main was asked that would interrupt a person, in order. */
const interruptions = (app: ElectronApplication) =>
	app.evaluate(() => (globalThis as {asked?: string[]}).asked ?? []);

/** Where the window says the link: the host's word in the top bar, a status. */
const LINK = '[role="status"][aria-label="the link to the host"]';
/**
 * What the host's item is named while the host is up. It shows an icon and no word, so the run
 * reads the item's name (its `aria-label`), which is its word when it has one.
 */
const UP = "host up";
/** The host's item: the first button of the link, before any Try again. */
const HOST = `${LINK} button`;
/**
 * From now on, note each change in what the window says of the link: a word may be up for a
 * moment only.
 */
const watchNotes = (page: Page) =>
	page.evaluate(
		({host, up}) => {
			const said: string[] = [up];
			Object.assign(globalThis, {said});
			new MutationObserver(() => {
				const name = document.querySelector(host)?.getAttribute("aria-label") ?? "";
				if (said.at(-1) !== name) said.push(name);
			}).observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-label"],
			});
		},
		{host: HOST, up: UP},
	);
/** The words the window said of the link since `watchNotes`, in order, with no host up. */
const notesSaid = (page: Page) =>
	page.evaluate((up) => ((globalThis as {said?: string[]}).said ?? []).filter((t) => t !== up), UP);
/** What the window says of the link now, by the host item's name, or "" for none drawn. */
const noteNow = (page: Page) =>
	page
		.locator(HOST)
		.first()
		.getAttribute("aria-label", {timeout: 500})
		.then(
			(t) => t ?? "",
			() => "",
		);
/**
 * A part that works says nothing: on a fresh home with nothing asking and no agent attached, the
 * top bar's right end is the host's quiet icon alone, with no word and no `·`. C-b A and C-b S
 * still open their lines, which say no agent is attached and that the ledger is this home's own.
 */
const quietAtRest = async (page: Page) => {
	const said = await until(
		"the top bar's right end quiet, the host up",
		async () =>
			[
				(await page.locator(".topbar .right").textContent()) ?? "",
				await noteNow(page),
				await page.locator(".topbar .right svg").count(),
			] as const,
		([text, name, icons]) => text.trim() === "" && name === UP && icons === 1,
	);
	check("at rest the top bar says nothing but the host's icon", true, said);
	const lines = async (key: string, label: string) => {
		await prefixed(page, key);
		const text = (await page.getByRole("dialog", {name: label}).textContent({timeout: 2000})) ?? "";
		await prefixed(page, key);
		await until(
			`${label} closed`,
			() => page.getByRole("dialog").count(),
			(n) => n === 0,
		);
		return text;
	};
	const agents = await lines("A", "The agents");
	check(
		"C-b A at zero opens lines: none attached, and how",
		agents.includes("No agent is attached") && agents.includes("fabrika mcp"),
		agents,
	);
	const sync = await lines("S", "The sync");
	check(
		"C-b S on an own ledger opens lines: nothing to sync",
		sync.includes("Nothing to sync"),
		sync,
	);
};
/** The host's few lines, opened from its word in the top bar, then closed again. */
const hostLines = async (page: Page) => {
	const host = page.locator(LINK).getByRole("button", {name: /^host /});
	await host.click();
	const lines =
		(await page.getByRole("dialog", {name: "The host"}).textContent({timeout: 2000})) ?? "";
	await host.click();
	return lines;
};
/** The tile that holds the page's focus, or none. */
const focusedIn = (page: Page) =>
	page.evaluate(
		() => document.activeElement?.closest("[data-tile]")?.getAttribute("data-tile") ?? null,
	);
/** The desk is back: the host's item is its quiet up icon with no word, and nothing is dimmed. */
const deskBack = (page: Page) =>
	until(
		"the desk back, the host up",
		async () =>
			[
				await noteNow(page),
				await page.locator(`${HOST} svg`).count(),
				(await page.locator(HOST).first().textContent()) ?? "",
				await page.locator(".desk.lost").count(),
			] as const,
		([name, icons, word, lost]) => name === UP && icons === 1 && word === "" && lost === 0,
	);

/**
 * The link to the host drops while the app runs, on a home of its own: the socket cut with the
 * host alive, the host killed, and no host to be had at all until a person presses Try again.
 */
const reconnect = async () => {
	const own = await mkdtemp(join(tmpdir(), "fabrika-link-"));
	const started = new Set<number>();
	const app = await launch(own);
	try {
		const page = await app.firstWindow();
		await prompted(page, "t1");
		// Longer than the tile, so the screen has scrollback a second copy would show in.
		await run(page, "t1", "seq --to 60");
		const long = await shows(page, "t1", "seq's last line", (t) => t.endsWith("\n60\ntsh$"));
		await prefixed(page, "|");
		await tilesAre(page, ["t1", "t2"]);
		await prompted(page, "t2");
		await run(page, "t2", "counter");
		await countIn(page, "t2").waitFor();
		await tile(page, "t2").getByRole("button", {name: "+1"}).click();
		await countIn(page, "t2").filter({hasText: /^1$/}).waitFor();
		const host = await hostPid(own);
		check("a host started on this stage's own home", host !== null && (await ours(host)), host);
		if (host === null) return;
		started.add(host);
		await watchNotes(page);
		check("main's dialogs, dock bounce and focus are swapped for a list", await noInterrupts(app));

		check("main has one socket to the host, and it is cut", (await cutLink(app)) === 1);
		const said = await until(
			"the window to say it reconnects",
			() => notesSaid(page),
			(n) => n.length > 0,
		);
		await deskBack(page);
		check(
			"the socket cut: the top bar says calmly the host is down, and the desk comes back",
			said[0] === "host down",
			said,
		);
		check("on the same host: it was alive all along", (await hostPid(own)) === host);
		await countIn(page, "t2").filter({hasText: /^1$/}).waitFor();
		check(
			"counter in t2 is still at 1, and focus is back on it",
			(await focusedIn(page)) === "t2",
			await focusedIn(page),
		);
		await tile(page, "t2").getByRole("button", {name: "+1"}).click();
		await countIn(page, "t2").filter({hasText: /^2$/}).waitFor();
		// Counter answered on its new port, sent after t1's: t1's screen came again before it.
		const again = await screen(page, "t1");
		check("t1's screen is drawn once, scrollback and all, as it was", again === long, again);
		await tile(page, "t1").click();
		await focusIs(page, "t1");
		await run(page, "t1", "seq --to 2");
		await shows(page, "t1", "seq's 2", (t) => t.endsWith("\n1\n2\ntsh$"));
		check("the view and the terminal reach the host again", true);

		await crash(host);
		const next = await until(
			"a new host",
			() => hostPid(own),
			(p) => p !== null && p !== host,
		);
		if (next === null) return;
		started.add(next);
		await deskBack(page);
		await tilesAre(page, ["t1", "t2"]);
		// The old host's screen is still on the page until the new one's comes, in its place.
		await shows(page, "t1", "only a fresh prompt", (t) => t === "tsh$");
		check(
			"the host killed: the app starts one, and the kept desk comes back with fresh screens",
			await ours(next),
			next,
		);
		const kept = await shows(page, "t2", "the earlier job", (t) => t.includes("tsh: 1 job from"));
		check("t2's counter is a job of the earlier tsh, not running", true, kept);
		check("no dialog, no dock bounce, no focus taken", (await interruptions(app)).length === 0);

		// No host to be had: the home's host folder is a file, so no socket can be reached there.
		const folder = join(own, "host");
		await rename(folder, join(own, "host-killed"));
		await writeFile(folder, "");
		await crash(next);
		await until(
			"the window to say it reconnects",
			() => noteNow(page),
			(t) => t === "host down",
		);
		await page.waitForTimeout(1500);
		const dimmed = {
			lost: await page.locator(".desk.lost").count(),
			inert: await page.locator(".workspace[inert]").count(),
			status: await page.getByRole("status", {name: "the link to the host"}).count(),
			focused: await page.evaluate(() => document.activeElement?.closest("[data-tile]") !== null),
		};
		check(
			"no host: the desk stays, dimmed and out of reach, the top bar says host down, and focus is nowhere in it",
			dimmed.lost === 1 && dimmed.inert === 1 && dimmed.status === 1 && !dimmed.focused,
			dimmed,
		);
		const reaching = await hostLines(page);
		check(
			"the host's lines say it is reconnecting",
			reaching.startsWith("Reconnecting to the host"),
			reaching,
		);
		await shot(page, "12-reconnecting");

		// Five minutes on, by main's clock: the next try that fails is the last.
		await app.evaluate(() => {
			const real = Date.now;
			Object.assign(globalThis, {realNow: real});
			Date.now = () => real() + 6 * 60_000;
		});
		const button = page.locator(".topbar").getByRole("button", {name: "try again", exact: true});
		await until(
			"the app to stop trying",
			() => button.count(),
			(n) => n === 1,
		);
		const stopped = await hostLines(page);
		check(
			"five minutes on, it stops and offers try again in the top bar, which takes no focus",
			(await button.count()) === 1 &&
				!(await button.evaluate((b) => b === document.activeElement)) &&
				stopped.startsWith("Could not reconnect to the host") &&
				stopped.includes("five minutes"),
			stopped,
		);
		check("no dialog, no dock bounce, no focus taken", (await interruptions(app)).length === 0);
		await shot(page, "13-stopped");

		await app.evaluate(() => {
			Date.now = (globalThis as {realNow?: () => number}).realNow ?? Date.now;
		});
		await rm(folder);
		await button.click();
		const last = await until(
			"a host started by Try again",
			() => hostPid(own),
			(p) => p !== null && p !== next,
		);
		if (last !== null) started.add(last);
		await deskBack(page);
		await tilesAre(page, ["t1", "t2"]);
		await shows(page, "t1", "only a fresh prompt", (t) => t === "tsh$");
		check(
			"the folder back, Try again starts a host, and the desk is back",
			last !== null && (await ours(last)),
			last,
		);
		const still = await shows(page, "t2", "the earlier job", (t) => t.includes("tsh: 1 job from"));
		check("on the restored desk, only t2 is told of its counter: t1 never ran it", true, still);
	} finally {
		await app.close().catch(() => {});
		for (const pid of started) if (alive(pid) && (await ours(pid))) await stop(pid);
	}
};

const first = await launch(home);
let left = "";
try {
	try {
		left = await flow(first);
		await reopen(first, left);
	} finally {
		// With counter up, at 1: `close` asks Electron's `app.quit()`, as Cmd-Q does.
		await first.close();
	}
	const pid = await hostPid(home);
	check("the app quit, and the host it started runs on", pid !== null && alive(pid), pid);
	const kept = (await keptJobs(home)).map((job) => [job.n, job.text, job.owner]);
	check(
		"the host's one job table keeps one job, the counter of the tile left, and no closed tile's",
		kept.length === 1 && kept[0]?.[1] === "counter" && kept[0]?.[2] === left,
		kept,
	);
	const desk = await readFile(join(home, "desk.json"), "utf8").catch(() => "");
	check("the host kept the desk in the home", desk.includes(`"${left}"`), desk);
	const history = await readFile(join(home, "history"), "utf8").catch(() => "");
	check("the host kept the history in the home", history.endsWith("counter\n"), history);

	const next = await launch(home);
	try {
		await again(next, left);
	} finally {
		await next.close().catch(() => {});
	}
	check(
		"then the app quits, and the same host runs on",
		(await hostPid(home)) === pid && pid !== null && alive(pid),
	);

	await mismatch();
	await asksSwap();
	await reconnect();
} finally {
	// No person stops the host: there is no command for it. The run stops its own, by its pid.
	const pid = await hostPid(home);
	if (pid !== null) await stop(pid);
}
const after = await pgrep(here);
check(
	"the host stopped by its pid: pgrep finds nothing of this app left",
	after.length === 0,
	after,
);
const sock = await stat(join(home, "host", "sock")).then(
	() => true,
	() => false,
);
check("the host took its socket away as it stopped", !sock);
console.log(`screenshots:\n${saved.map((s) => `  ${s}`).join("\n")}`);
