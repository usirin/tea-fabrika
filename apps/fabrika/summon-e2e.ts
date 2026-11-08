import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {_electron, type Page} from "playwright";

// An agent summoned and talked to, in the real built app, on a temp home and a temp git
// repository, with the fake ACP agent: no model, no key, nothing real touched. Today's version.
// Not part of `pnpm test`: it opens a window.
//
//   pnpm --filter @kampus/fabrika-app-old e2e:summon
//   SHOTS=<folder> ...e2e:summon     the screenshots there: docs/summon for the real ones
//
// In each layout (one tile, two side by side, two stacked, a 2x2, and one tile at 1024 by 700):
//
//   summon fake as scout              ready, once, in the first layout; the name is the host's
//   @scout slowly read a.txt b.txt    the status line in place while it works   <layout>-status
//                                     then the reply, printed whole              <layout>-reply
//   @scout write                      scout asks: ... allow? [y/N]               <layout>-ask
//                                     y: allowed once, and the turn goes on
//   @scout slowly read a.txt b.txt    then Ctrl-C: scout: turn cancelled         <layout>-ctrl-c
//   Ctrl-B A                          the top bar's agents, scout under its own heading, with
//                                     a Dismiss                                   <layout>-panel

const here = import.meta.dirname;
const electronPath: string = createRequire(import.meta.url)("electron");
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), "summon-shots-"));
mkdirSync(shots, {recursive: true});

const home = realpathSync(mkdtempSync(join(tmpdir(), "sm-")));
const repo = realpathSync(mkdtempSync(join(tmpdir(), "summon-repo-")));
execFileSync("git", ["init", "-q"], {cwd: repo});
writeFileSync(join(repo, "a.txt"), "a\n");
writeFileSync(join(repo, "b.txt"), "b\n");

const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env))
	if (value !== undefined && !/API_KEY$/.test(name)) env[name] = value;
Object.assign(env, {FABRIKA_HOME: home, FABRIKA_REPO: repo});

const check = (what: string, ok: boolean, seen?: unknown) => {
	if (!ok)
		throw new Error(`${what}: no${seen === undefined ? "" : `, saw ${JSON.stringify(seen)}`}`);
	console.log(`ok  ${what}`);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async <T>(what: string, look: () => Promise<T>, ok: (seen: T) => boolean) => {
	const from = Date.now();
	let seen = await look();
	while (!ok(seen)) {
		if (Date.now() - from > 30_000)
			throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
		await sleep(100);
		seen = await look();
	}
	return seen;
};

const tile = (page: Page, id: string) => page.locator(`[data-tile="${id}"]`);
const screen = async (page: Page, id: string) => {
	const text = tile(page, id).locator(".screen-text").first();
	return (await text.count()) === 0 ? "" : ((await text.textContent({timeout: 2000})) ?? "");
};
const lastRow = (text: string) => text.split("\n").at(-1) ?? "";
const tiles = (page: Page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));
const focused = async (page: Page) =>
	(await page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile")) ?? "";
const shows = (page: Page, id: string, what: string, ok: (text: string) => boolean) =>
	until(`${id}: ${what}`, () => screen(page, id), ok);
const prompted = (page: Page, id: string) =>
	shows(page, id, "the prompt", (t) => lastRow(t) === "tsh$");
const run = async (page: Page, id: string, line: string) => {
	await page.keyboard.type(line);
	await shows(page, id, `the line ${line}`, (t) => lastRow(t) === `tsh$ ${line}`);
	await page.keyboard.press("Enter");
};
const prefixed = async (page: Page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};
const shot = async (page: Page, name: string) => {
	await page.screenshot({path: join(shots, `${name}.png`)});
	console.log(`shot ${name}`);
};
/** A new tile: focus moves to it, and its tsh is up. */
const split = async (page: Page, key: "|" | "-") => {
	const before = await tiles(page);
	await prefixed(page, key);
	const after = await until(
		"a new tile",
		() => tiles(page),
		(t) => t.length === before.length + 1,
	);
	const id = after.find((t) => t !== null && !before.includes(t)) ?? "";
	await until(
		`focus on ${id}`,
		() => focused(page),
		(f) => f === id,
	);
	await prompted(page, id);
	return id;
};

/** A new workspace, with one tile: focus moves to it, and its tsh is up. */
const workspace = async (page: Page) => {
	const before = await tiles(page);
	await prefixed(page, "N");
	const id = await until(
		"a new workspace's tile",
		() => focused(page),
		(f) => f !== "" && !before.includes(f),
	);
	await prompted(page, id);
	return id;
};

/** The five states, typed in the focused tile, each shot under `layout`. */
const states = async (page: Page, layout: string) => {
	const id = await focused(page);
	await prompted(page, id);
	await run(page, id, "@scout slowly read a.txt b.txt");
	await shows(page, id, "the status line", (t) => /✦ scout {2}.*·/.test(lastRow(t)));
	await shot(page, `${layout}-status`);
	await prompted(page, id);
	const replied = await screen(page, id);
	check(`${layout}: the reply, then the turn's line`, /scout · turn \d+ · /.test(replied), replied);
	await shot(page, `${layout}-reply`);

	await run(page, id, "@scout write");
	await shows(page, id, "the ask", (t) => t.includes("allow? [y/N]"));
	await shot(page, `${layout}-ask`);
	await page.keyboard.press("y");
	await shows(page, id, "allowed", (t) => t.includes("y: allowed once"));
	await prompted(page, id);

	await run(page, id, "@scout slowly read a.txt b.txt");
	await shows(page, id, "the status line", (t) => /✦ scout {2}/.test(lastRow(t)));
	await page.keyboard.press("Control+c");
	await shows(page, id, "cancelled", (t) => t.includes("scout: turn cancelled"));
	await prompted(page, id);
	await shot(page, `${layout}-ctrl-c`);

	await prefixed(page, "A");
	const panel = page.getByRole("button", {name: "Dismiss scout"});
	await until(
		"the agents' panel",
		() => panel.count(),
		(n) => n === 1,
	);
	await shot(page, `${layout}-panel`);
	await page.keyboard.press("Escape");
	await until(
		"the panel closed",
		() => panel.count(),
		(n) => n === 0,
	);
};

const app = await _electron.launch({executablePath: electronPath, args: [here], env});
let failed = false;
try {
	const page = await app.firstWindow();
	await prompted(page, "t1");

	// ---- one tile: summon, then each state
	await run(page, "t1", "summon fake as scout");
	await shows(page, "t1", "ready", (t) => t.includes("scout · ") && t.includes("ready"));
	await prompted(page, "t1");
	await shot(page, "one-tile-summon");
	await states(page, "one-tile");

	// ---- a small window, 1024 by 700, through the DevTools protocol as e2e.ts does it
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1024,
		height: 700,
		deviceScaleFactor: 0,
		mobile: false,
	});
	await until(
		"the window at 1024 by 700",
		() => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
		(size) => size === "1024x700",
	);
	await states(page, "small-window");
	await cdp.send("Emulation.clearDeviceMetricsOverride");

	// ---- two side by side, in a new workspace
	await workspace(page);
	await split(page, "|");
	await states(page, "side-by-side");

	// ---- two stacked
	await workspace(page);
	await split(page, "-");
	await states(page, "stacked");

	// ---- a 2x2: split right, then each column down
	const first = await workspace(page);
	await split(page, "|");
	await split(page, "-");
	await prefixed(page, "h");
	await until(
		`focus on ${first}`,
		() => focused(page),
		(f) => f === first,
	);
	await split(page, "-");
	await states(page, "grid");

	const log = readFileSync(join(home, "host", "log"), "utf8");
	for (const message of ["summoned", "turn_began", "turn_ended", "ask_answered"])
		check(`the host log has ${message}`, log.includes(message));
} catch (cause) {
	failed = true;
	console.error(cause);
	const [page] = app.windows();
	if (page !== undefined) {
		await page.screenshot({path: join(shots, "failed.png")}).catch(() => {});
		const ids = await tiles(page).catch(() => [] as readonly (string | null)[]);
		for (const id of ids) if (id !== null) console.error(`--- ${id}\n${await screen(page, id)}`);
	}
} finally {
	const pid = Number.parseInt(
		(() => {
			try {
				return readFileSync(join(home, "host", "pid"), "utf8");
			} catch {
				return "";
			}
		})(),
		10,
	);
	await app.close().catch(() => {});
	// This run started that host, on its own temp home, and only this run stops it.
	if (!Number.isNaN(pid))
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	console.log(`shots: ${shots}\nhome: ${home}\nrepo: ${repo}`);
}
if (failed) process.exit(1);
