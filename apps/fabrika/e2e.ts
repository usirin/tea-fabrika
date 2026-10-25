import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readdir, readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {_electron, type ElectronApplication, type Page} from "playwright";

// The app, driven end to end through Playwright's Electron support: the whole flow, one
// screenshot per step. Not part of `pnpm test` or CI: it opens real windows.
//
//   pnpm --filter @kampus/fabrika-app e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e     screenshots there, not in a temp folder
//
//   1 terminal     the terminal window opens on tsh's prompt
//   2 answer       `seq --to 3 | double`: double 2, double 4, double 6
//   3 tab          `cou` and Tab: the line is `counter `
//   4 window       Enter: counter's own window opens, at 0, and the prompt waits
//   5 click        +1 in counter's window: its view is 1
//   6 closed       counter's window closed: tsh prints 1, and the prompt is back
//   7 history      Up: `counter` is on the line again
//
// Then, with no screenshot: Ctrl-C in the terminal stops a foreground counter and its window
// closes; `counter &` gives the prompt back with its window open; neither page can reach Node,
// navigate away or open a window; a message the app does not know is refused; a second copy
// quits and leaves the first; and what Electron's own Node can do (node:sqlite, its execPath).
//
// Then the app quits with a job in it, and is started again on the same home:
//
//   8 left         `counter`, +1, and the app quits with counter's window up, as on Cmd+Q
//   9 found        started again: tsh says 1 job from an earlier tsh, not running; Up shows the
//                  last line typed before the quit
//  10 attached     `attach %n`: counter's window opens again, at 1
//
// The terminal draws on a canvas; the page keeps the screen as text too, for a screen reader,
// and that is what this reads. Playwright's API is promises, and this script stays in it, as
// Playwright's docs write it. Node is here for temp folders, to start the second copy, and to
// look in the home.

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

/** The terminal's screen, as text: its rows, with no trailing spaces. */
const screen = async (page: Page) => (await page.locator("#screen-text").textContent()) ?? "";

/** Wait until the screen passes `ok`, and answer it. */
const until = async (page: Page, what: string, ok: (text: string) => boolean) => {
	for (let i = 0; i < 200; i += 1) {
		const text = await screen(page);
		if (ok(text)) return text;
		await page.waitForTimeout(50);
	}
	throw new Error(`waited for ${what}; the screen shows:\n${await screen(page)}`);
};

const lastRow = (text: string) => text.split("\n").at(-1) ?? "";
/** Wait until the prompt is up again, with nothing typed on it. */
const prompted = (page: Page, what: string) => until(page, what, (t) => lastRow(t) === "tsh$");

/** Type a line at the prompt, wait to see it echoed, and press Enter. */
const run = async (page: Page, line: string) => {
	await page.keyboard.type(line);
	await until(page, `the line ${line}`, (t) => lastRow(t) === `tsh$ ${line}`);
	await page.keyboard.press("Enter");
};

/** The next program window to open, once `start` is done. */
const opens = async (app: ElectronApplication, start: () => Promise<void>) => {
	const [window] = await Promise.all([app.waitForEvent("window"), start()]);
	await window.getByLabel("count", {exact: true}).waitFor();
	return window;
};

const countIn = (window: Page) => window.getByLabel("count", {exact: true});

/** Close the program window on `url`, as the person does with its close button. */
const closeWindow = (app: ElectronApplication, url: string) =>
	app.evaluate(({BrowserWindow}, url) => {
		BrowserWindow.getAllWindows()
			.find((w) => w.webContents.getURL() === url)
			?.close();
	}, url);

/** What a page can reach: the bridge's two names, and no Node. */
const reachOf = (page: Page) =>
	page.evaluate(() => ({
		require: typeof (globalThis as {require?: unknown}).require,
		process: typeof (globalThis as {process?: unknown}).process,
		bridge: Object.keys(window.fabrika).sort(),
		opened: window.open("https://example.com") === null,
	}));

const flow = async (app: ElectronApplication) => {
	const terminal = await app.firstWindow();
	await prompted(terminal, "the first prompt");
	check(
		"the terminal starts on our own scheme",
		terminal.url() === "fabrika://app/terminal.html",
		terminal.url(),
	);
	await shot(terminal, "1-terminal");

	await run(terminal, "seq --to 3 | double");
	const answer = await prompted(terminal, "seq's answer");
	check(
		"tsh answers seq --to 3 | double",
		answer.includes("tsh$ seq --to 3 | double\ndouble 2\ndouble 4\ndouble 6\ntsh$"),
		answer,
	);
	await shot(terminal, "2-answer");

	await terminal.keyboard.type("cou");
	await terminal.keyboard.press("Tab");
	await until(terminal, "Tab's answer", (t) => lastRow(t) === "tsh$ counter");
	check("Tab completes cou to counter", true);
	await shot(terminal, "3-tab");

	const counter = await opens(app, () => terminal.keyboard.press("Enter"));
	check("counter opens its own window, at 0", (await countIn(counter).innerText()) === "0");
	check("the window is counter's", (await counter.title()) === "counter", await counter.title());
	const waiting = await screen(terminal);
	check("the prompt waits while counter runs", lastRow(waiting) === "", waiting);
	await shot(counter, "4-window");

	await counter.getByRole("button", {name: "+1"}).click();
	await countIn(counter).filter({hasText: /^1$/}).waitFor();
	check("a click in counter's window changes its view", true);
	await shot(counter, "5-click");

	await Promise.all([counter.waitForEvent("close"), closeWindow(app, counter.url())]);
	const closed = await prompted(terminal, "counter's count");
	check(
		"closing counter's window ends it: tsh prints 1, and the prompt is back",
		closed.endsWith("tsh$ counter\n1\ntsh$"),
		closed,
	);
	await shot(terminal, "6-closed");

	await terminal.keyboard.press("ArrowUp");
	await until(terminal, "the line before", (t) => lastRow(t) === "tsh$ counter");
	check("Up brings back the line run before", true);
	await shot(terminal, "7-history");

	// Ctrl-C in the terminal stops the program in the foreground, and its window closes.
	const stopped = await opens(app, () => terminal.keyboard.press("Enter"));
	await Promise.all([stopped.waitForEvent("close"), terminal.keyboard.press("Control+c")]);
	const afterStop = await prompted(terminal, "the prompt after Ctrl-C");
	check(
		"Ctrl-C in the terminal stops counter, and its window closes",
		afterStop.includes("^C"),
		afterStop,
	);

	// `&`: the window opens and the prompt comes back at once.
	const behind = await opens(app, () => run(terminal, "counter &"));
	const back = await prompted(terminal, "the prompt after &");
	check(
		"counter & opens its window and gives the prompt back",
		/tsh\$ counter &\n\[\d+\] /.test(back),
		back,
	);
	await run(terminal, "say --text meanwhile");
	await until(terminal, "say's answer", (t) => t.includes("\nmeanwhile\n"));
	await Promise.all([
		behind.waitForEvent("close"),
		behind.getByRole("button", {name: "done"}).click(),
	]);
	check("a background counter's done closes its window", true);

	// Neither kind of window has more than the bridge's two names, and none has Node.
	const left = await opens(app, () => run(terminal, "counter"));
	for (const [name, page] of [
		["terminal", terminal],
		["counter", left],
	] as const) {
		const reach = await reachOf(page);
		check(
			`the ${name} window has send and onMessage only, and no Node`,
			reach.require === "undefined" &&
				reach.process === "undefined" &&
				reach.bridge.join() === "onMessage,send" &&
				reach.opened,
			reach,
		);
	}
	// A message not of the protocol is refused, from either window: tsh is told nothing.
	await terminal.evaluate(() => {
		window.fabrika.send({type: "line", value: "say --text no\r"});
		window.fabrika.send({type: "keys", data: "say --text no\r", to: "tsh:p1"});
		window.fabrika.send("rm -rf");
	});
	await left.evaluate(() => {
		window.fabrika.send({type: "msg", to: "tsh:p1", msg: {type: "line", value: "say --text no"}});
		window.fabrika.send({type: "keys", data: "say --text no\r"});
	});
	// Counter at 1, and left up: the app quits with it, once the flow is done.
	await left.getByRole("button", {name: "+1"}).click();
	await countIn(left).filter({hasText: /^1$/}).waitFor();
	const refused = await screen(terminal);
	check("refused messages tell tsh nothing", !refused.includes("\nno\n"), refused);
	await shot(left, "8-left");

	// Last in each window: Playwright waits on the navigation main refused, so the page is not driven after it.
	for (const page of [left, terminal]) {
		const url = page.url();
		await page.evaluate(() => {
			window.location.href = "https://example.com";
		});
		await page.waitForTimeout(500);
		const now = await app.evaluate(
			({BrowserWindow}, url) =>
				BrowserWindow.getAllWindows()
					.map((w) => w.webContents.getURL())
					.includes(url),
			url,
		);
		check(`the window on ${url} cannot navigate away`, now);
	}

	// A second copy, on the same home, brings the first forward and quits.
	const second = await promisify(execFile)(electronPath, [here], {env, timeout: 20_000}).then(
		() => "quit",
		(e: unknown) => `failed: ${String(e)}`,
	);
	const windows = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);
	check(
		"a second copy quits, and the first keeps its two windows",
		second === "quit" && windows === 2,
		{
			second,
			windows,
		},
	);

	// What Electron's own Node can do, in the main process itself.
	const node = await app.evaluate(() => {
		const sqlite = process.getBuiltinModule("node:sqlite");
		const db = new sqlite.DatabaseSync(":memory:");
		const row = db.prepare("select sqlite_version() as v").get();
		db.close();
		return {
			node: process.versions.node,
			electron: process.versions.electron,
			chrome: process.versions.chrome,
			sqlite: row?.v,
			execPathIsElectron: /electron/i.test(process.execPath),
		};
	});
	console.log(`    ${JSON.stringify(node)}`);
	check("node:sqlite runs in Electron's main process", typeof node.sqlite === "string", node);
};

/** Started again on the same home: tsh finds the job, Up finds the last line, and attach opens counter where it was. */
const again = async (app: ElectronApplication) => {
	const terminal = await app.firstWindow();
	const found = await until(terminal, "the earlier job", (t) => t.includes("from an earlier tsh"));
	const n = /1 job from an earlier tsh, not running: %(\d+)\./.exec(
		found.replaceAll("\n", ""),
	)?.[1];
	check("started again, tsh says counter's job is there and not running", n !== undefined, found);
	await prompted(terminal, "the first prompt");
	await terminal.keyboard.press("ArrowUp");
	await until(terminal, "the last line", (t) => lastRow(t) === "tsh$ counter");
	check("Up at the next start shows the last line typed before the quit", true);
	await shot(terminal, "9-found");

	await terminal.keyboard.press("Control+u");
	const counter = await opens(app, () => run(terminal, `attach %${n}`));
	check("attach: counter's window opens again, at 1", (await countIn(counter).innerText()) === "1");
	await shot(counter, "10-attached");

	await counter.getByRole("button", {name: "+1"}).click();
	await countIn(counter).filter({hasText: /^2$/}).waitFor();
	await Promise.all([
		counter.waitForEvent("close"),
		counter.getByRole("button", {name: "done"}).click(),
	]);
	const back = await prompted(terminal, "counter's count");
	check(
		"it counts on from 1: +1 and done, and tsh prints 2",
		back.includes(`tsh$ attach %${n}\n2\n`),
		back,
	);
};

const launch = () => _electron.launch({executablePath: electronPath, args: [here], env});

const first = await launch();
try {
	await flow(first);
} finally {
	// With counter's window up, at 1: `close` asks Electron's `app.quit()`, as Cmd+Q does.
	await first.close();
}
const kept = await readdir(join(home, "storage")).catch(() => []);
check("the app kept its jobs in its home, in storage/", kept.length > 0, kept);
const history = await readFile(join(home, "history"), "utf8").catch(() => "");
check("the app kept its history in its home", history.endsWith("counter\n"), history);
const next = await launch();
try {
	await again(next);
} finally {
	await next.close();
}
console.log(`screenshots:\n${saved.map((s) => `  ${s}`).join("\n")}`);
