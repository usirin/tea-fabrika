import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {_electron, type ElectronApplication, type Page} from "playwright";

// The app, driven end to end through Playwright's Electron support: the whole flow, one
// screenshot per step. Not part of `pnpm test` or CI: it opens a real window.
//
//   pnpm --filter @kampus/fabrika-app e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e     screenshots there, not in a temp folder
//
//   1 tsh          the window opens on tsh
//   2 answer       `seq --to 3 | double`: double 2, double 4, double 6
//   3 takeover     `counter`: its window takes over, at 0
//   4 click        +1: its view is 1
//   5 back         done: its window goes, tsh is back and printed 1
//
// Then, with no screenshot: Ctrl-C stops a program with a window; the window cannot reach Node,
// navigate away or open a window; a message the app does not know is refused; a second copy
// quits and leaves the first; and what Electron's own Node can do (node:sqlite, its execPath).
//
// Then the app quits with a job in it, and is started again on the same home:
//
//   6 left         `counter`, +1, and the app quits with counter's window up, as on Cmd+Q
//   7 found        started again: tsh says 1 job from an earlier tsh, not running
//   8 attached     `attach %n`: counter's window takes over again, at 1
//
// Playwright's API is promises, and this script stays in it, as Playwright's docs write it.
// Node is here for temp folders, to start the second copy, and to look in the home.

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

const line = async (page: Page, text: string) => {
	const input = page.getByLabel("tsh line");
	await input.fill(text);
	await input.press("Enter");
};

const outputOf = (page: Page) => page.getByLabel("tsh output");
const waitReady = (page: Page) =>
	page
		.getByLabel("tsh status")
		.filter({hasText: /^ready/})
		.waitFor();

const flow = async (app: ElectronApplication) => {
	const page = await app.firstWindow();
	await page.getByLabel("tsh line").waitFor();
	check(
		"the window starts on our own scheme",
		page.url() === "fabrika://app/index.html",
		page.url(),
	);
	await shot(page, "1-tsh");

	await line(page, "seq --to 3 | double");
	await outputOf(page).filter({hasText: "double 6"}).waitFor();
	await waitReady(page);
	const answer = await outputOf(page).innerText();
	check(
		"tsh answers seq --to 3 | double",
		["double 2", "double 4", "double 6"].every((l) => answer.includes(l)),
		answer,
	);
	await shot(page, "2-answer");

	await line(page, "counter");
	const count = page.getByLabel("count", {exact: true});
	await count.waitFor();
	check("counter's window takes over, at 0", (await count.innerText()) === "0");
	check("tsh is not shown under it", (await page.getByLabel("tsh line").count()) === 0);
	await shot(page, "3-takeover");

	await page.getByRole("button", {name: "+1"}).click();
	await count.filter({hasText: /^1$/}).waitFor();
	check("a click changes its view", (await count.innerText()) === "1");
	await shot(page, "4-click");

	await page.getByRole("button", {name: "done"}).click();
	await page.getByLabel("tsh line").waitFor();
	await waitReady(page);
	const back = await outputOf(page).innerText();
	check("done: tsh is back, and counter said 1", back.trimEnd().endsWith("tsh> counter\n1"), back);
	await shot(page, "5-back");

	// Ctrl-C from a program's window stops it, as from a terminal.
	await line(page, "counter");
	await count.waitFor();
	await page.keyboard.press("Control+c");
	await page.getByLabel("tsh status").filter({hasText: "ready, last status 130"}).waitFor();
	check("Ctrl-C stops a program with a window: tsh is back, status 130", true);

	// The window has the bridge's two names, and no Node, no Electron.
	const reach = await page.evaluate(() => ({
		require: typeof (globalThis as {require?: unknown}).require,
		process: typeof (globalThis as {process?: unknown}).process,
		bridge: Object.keys(window.fabrika).sort(),
		opened: window.open("https://example.com") === null,
	}));
	check(
		"the window has send and onView only, and no Node",
		reach.require === "undefined" &&
			reach.process === "undefined" &&
			reach.bridge.join() === "onView,send" &&
			reach.opened,
		reach,
	);
	// A message for a run the pane does not show, or not of the protocol, is refused: tsh is untouched.
	await page.evaluate(() => {
		window.fabrika.send({
			type: "msg",
			pane: "p1",
			to: "gone:1",
			msg: {type: "press", value: "plus"},
		});
		window.fabrika.send({
			type: "msg",
			pane: "p9",
			to: "tsh:p1",
			msg: {type: "line", value: "say --text no"},
		});
		window.fabrika.send("rm -rf");
	});
	await line(page, "say --text still-here");
	await outputOf(page).filter({hasText: "still-here"}).waitFor();
	const after = await outputOf(page).innerText();
	check("refused messages tell nothing", !after.includes("tsh> say --text no\n"), after);

	// Counter at 1, and left up: the app quits with it, once the flow is done.
	await line(page, "counter");
	await count.waitFor();
	await page.getByRole("button", {name: "+1"}).click();
	await count.filter({hasText: /^1$/}).waitFor();
	await shot(page, "6-left");

	// Last in the window: Playwright waits on the navigation main refused, so the page is not driven after it.
	await page.evaluate(() => {
		window.location.href = "https://example.com";
	});
	await page.waitForTimeout(500);
	const url = await app.evaluate(({BrowserWindow}) =>
		BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
	);
	check("the window cannot navigate away", url === "fabrika://app/index.html", url);

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

/** Started again on the same home: tsh finds the job, and attach shows counter where it was. */
const again = async (app: ElectronApplication) => {
	const page = await app.firstWindow();
	await page.getByLabel("tsh line").waitFor();
	const said = outputOf(page).filter({hasText: "from an earlier tsh"});
	await said.waitFor();
	const found = await said.innerText();
	const n = /1 job from an earlier tsh, not running: %(\d+)\./.exec(found)?.[1];
	check("started again, tsh says counter's job is there and not running", n !== undefined, found);
	await shot(page, "7-found");

	await line(page, `attach %${n}`);
	const count = page.getByLabel("count", {exact: true});
	await count.waitFor();
	check("attach: counter's window takes over again, at 1", (await count.innerText()) === "1");
	await shot(page, "8-attached");

	await page.getByRole("button", {name: "+1"}).click();
	await count.filter({hasText: /^2$/}).waitFor();
	await page.getByRole("button", {name: "done"}).click();
	await page.getByLabel("tsh line").waitFor();
	await waitReady(page);
	const back = await outputOf(page).innerText();
	check(
		"it counts on from 1: +1 and done, and tsh prints 2",
		back.includes(`tsh> attach %${n}\n2\n`),
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
const next = await launch();
try {
	await again(next);
} finally {
	await next.close();
}
console.log(`screenshots:\n${saved.map((s) => `  ${s}`).join("\n")}`);
