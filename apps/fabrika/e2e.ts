import {execFile, spawn} from "node:child_process";
import {mkdir, mkdtemp, readdir, readFile, stat} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {_electron, type ElectronApplication, type Page} from "playwright";

// The app, driven end to end through Playwright's Electron support: the whole flow in the one
// tiled window, one screenshot per step. Not part of `pnpm test` or CI: it opens a real window.
// The window rules it checks are macOS's: run it on a Mac.
//
//   pnpm --filter @kampus/fabrika-app e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e     screenshots there, not in a temp folder
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
// Then, with no screenshot: focus moves with Ctrl-B h and l and with a click; Ctrl-C over counter
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
	const job = await shows(page, "t2", "the job's number", (t) => /\[1\] tracker:/.test(t));
	await prompted(page, "t2");
	await page.waitForTimeout(300);
	await tilesAre(page, ["t1", "t2"]);
	check(
		"tracker & opens no tile: a job in the background, and t2's prompt is back",
		(await tile(page, "t2").getByLabel("tracker view").count()) === 0,
		job,
	);
	await run(page, "t2", "attach %1");
	await tile(page, "t2").getByLabel("tracker view").waitFor();
	await tilesAre(page, ["t1", "t2"]);
	check("attach %1 brings the tracker in, covering t2, as fg does", true);
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
		"t1's job on the status line",
		() => page.locator(".status .focus").innerText(),
		(t) => t === "t1 · 1 running",
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
	await page.keyboard.press("y");
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
	const kept = await readdir(join(home, "storage", "tiles")).catch((): string[] => []);
	check(
		"the tile left with counter has its jobs in its own folder, and no closed tile has",
		kept.includes(left) && !["t1", "t2", "t3"].some((t) => kept.includes(t)),
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
