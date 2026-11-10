import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {_electron, type ElectronApplication, type Page} from "playwright";

// An agent summoned and talked to, in the real built app, on a temp home and a temp git
// repository, with the fake ACP agent: no model, no key, nothing real touched. Today's version.
// Separate from the default e2e run. The native window fits a 1440 by 674 CI screen;
// the 1024 by 700 page uses DevTools emulation, as e2e.ts's infoModeSmall does.
//
//   pnpm --filter @kampus/fabrika-app-old e2e:summon
//   SHOTS=docs/summon pnpm --filter @kampus/fabrika-app-old e2e:summon
//
// PR 1's seven states in one, side, stacked, 2x2 and small: <state>-<layout>-dark.png,
// plus summoned-<layout>-light.png. The fake harness supplies the model and effort lists,
// including the refusal of ultra. An MCP client called observer attaches without running a model.

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
	if (value !== undefined && !/API_KEY$/.test(name) && name !== "FABRIKA_FOREGROUND")
		env[name] = value;

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
	const text = tile(page, id).locator(".screen-text");
	return (await text.count()) === 0 ? "" : ((await text.textContent({timeout: 2000})) ?? "");
};

const lastRow = (text: string) => text.split("\n").at(-1) ?? "";

/** Terminal wraps can split a word or trim the space at the end of a row. */
const contains = (text: string, words: string) =>
	text.replaceAll(/\s/g, "").includes(words.replaceAll(/\s/g, ""));

const tiles = (page: Page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));

const focused = async (page: Page) =>
	(await page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile")) ?? "";

/** aria-current names the selected tile; keys go to document.activeElement. */
const focusIs = (page: Page, id: string) =>
	until(
		`keyboard focus on ${id}`,
		() =>
			page.evaluate(
				() => document.activeElement?.closest("[data-tile]")?.getAttribute("data-tile") ?? null,
			),
		(f) => f === id,
	);

const shows = (page: Page, id: string, what: string, ok: (text: string) => boolean) =>
	until(`${id}: ${what}`, () => screen(page, id), ok);

const prompted = (page: Page, id: string) =>
	shows(page, id, "the prompt", (t) => lastRow(t) === "tsh$");

/** Type at the focused prompt, with at most three attempts and an exact echo check. */
const typeLine = async (page: Page, id: string, line: string) => {
	const expected = `tsh$ ${line}`;
	const seen: string[] = [];
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await focusIs(page, id);
		if (attempt > 0) {
			await page.keyboard.press("Control+e");
			await page.keyboard.press("Control+u");
			await prompted(page, id);
		}
		await page.keyboard.type(line);
		let row = lastRow(await screen(page, id));
		for (let i = 0; i < 200 && row !== expected; i += 1) {
			await page.waitForTimeout(50);
			row = lastRow(await screen(page, id));
		}
		if (row === expected) return;
		seen.push(row);
		console.warn(
			`${id}: typing attempt ${attempt + 1} for ${JSON.stringify(line)}; saw ${JSON.stringify(row)}`,
		);
	}
	throw new Error(
		`${id}: could not type ${JSON.stringify(line)} after 3 attempts; saw ${JSON.stringify(seen)}`,
	);
};

const run = async (page: Page, id: string, line: string) => {
	await typeLine(page, id, line);
	await focusIs(page, id);
	await page.keyboard.press("Enter");
};

const prefixed = async (page: Page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};

const otherPromptsEmpty = async (page: Page, id: string, state: string) => {
	for (const other of await tiles(page)) {
		if (other === null || other === id) continue;
		const row = lastRow(await screen(page, other));
		check(`${state}: ${other}'s prompt is empty`, row === "tsh$", row);
	}
};

const shot = async (page: Page, id: string, name: string) => {
	await page.mouse.move(1, 1);
	await page.waitForTimeout(250);
	await otherPromptsEmpty(page, id, name);
	await page.screenshot({path: join(shots, `${name}.png`)});
	console.log(`shot ${name}`);
};

const lookIs = async (app: ElectronApplication, page: Page, look: "dark" | "light") => {
	await app.evaluate(({nativeTheme}, to) => {
		nativeTheme.themeSource = to;
	}, look);
	await page.emulateMedia({colorScheme: look});
	await until(
		`the ${look} look`,
		() => page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches),
		(light) => light === (look === "light"),
	);
};

/** T259: let rebuilt terminals' focus timers finish before checking focus and typing. */
const settleTerminals = (page: Page) =>
	page.evaluate(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	});

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
	await focusIs(page, id);
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
	await focusIs(page, id);
	return id;
};

/** Each state checks PR 1's screenshot contract before saving its picture. */
const states = async (app: ElectronApplication, page: Page, layout: string) => {
	const id = await focused(page);
	await prompted(page, id);
	await run(page, id, "summon fake high as scout");
	const summoned = () =>
		shows(
			page,
			id,
			"the resolved model, effort and place, then the prompt",
			(t) =>
				contains(t, "scout · fake fake-small · high · in this repo, on this Mac · ready") &&
				lastRow(t) === "tsh$",
		);
	await summoned();
	await shot(page, id, `summoned-${layout}-dark`);
	await lookIs(app, page, "light");
	await settleTerminals(page);
	await summoned();
	await shot(page, id, `summoned-${layout}-light`);
	await lookIs(app, page, "dark");
	await settleTerminals(page);

	await run(page, id, "@scout slowly read a.txt b.txt");
	await until(
		"the bottom line's job number, line and seconds",
		() => page.locator(".bottomline .job").textContent({timeout: 2000}),
		(t) => t !== null && /%\d+\s+@scout slowly read a\.txt b\.txt\s+\d+s/.test(t),
	);
	const running = await shows(page, id, "one status row in place, holding the prompt", (t) =>
		/^✦ scout {2}.+ · \d+s$/.test(lastRow(t)),
	);
	check(`${layout}: only the current status row`, running.match(/✦ scout {2}/g)?.length === 1);
	check(
		`${layout}: the bottom line's job is visible`,
		await page.locator(".bottomline .job").isVisible(),
	);
	await shot(page, id, `turn-running-${layout}-dark`);
	await shows(
		page,
		id,
		"the whole reply under scout's name, then the prompt",
		(t) =>
			/✦ scout {2}a\.txt: a\n {9}b\.txt: b/.test(t) &&
			/scout · turn \d+ · \d+s/.test(t) &&
			lastRow(t) === "tsh$",
	);
	await shot(page, id, `turn-replied-${layout}-dark`);

	await run(page, id, "@scout write");
	await shows(page, id, "scout's permission question holding the prompt", (t) =>
		contains(t, "scout asks: Write written.txt allow? [y/N]"),
	);
	check(
		`${layout}: the ask has not returned the prompt`,
		lastRow(await screen(page, id)) !== "tsh$",
	);
	await shot(page, id, `turn-asking-${layout}-dark`);
	await focusIs(page, id);
	await page.keyboard.press("y");
	await shows(page, id, "allowed", (t) => t.includes("y: allowed once"));
	await prompted(page, id);

	await run(page, id, "@scout slowly read a.txt b.txt");
	await shows(page, id, "the status line", (t) => /✦ scout {2}/.test(lastRow(t)));
	await focusIs(page, id);
	await page.keyboard.press("Control+c");
	await shows(page, id, "cancelled", (t) => t.includes("scout: turn cancelled"));
	await prompted(page, id);
	await run(page, id, "agents");
	await shows(
		page,
		id,
		"the cancellation, scout still idle in agents, and the prompt back",
		(t) =>
			t.includes("scout: turn cancelled") &&
			/\bscout\b[^\n]*\bidle\b/.test(t) &&
			lastRow(t) === "tsh$",
	);
	await shot(page, id, `turn-cancelled-${layout}-dark`);

	await prefixed(page, "A");
	const panel = page.getByRole("dialog", {name: "The agents"});
	await panel.waitFor();
	await panel.getByRole("heading", {name: "1 agent summoned here", exact: true}).waitFor();
	const attached = panel
		.getByRole("heading", {name: "1 agent is attached", exact: true})
		.locator("xpath=following-sibling::ul[1]");
	await attached.waitFor();
	check(
		`${layout}: scout and its dismiss are visible`,
		(await panel.getByText("scout", {exact: true}).isVisible()) &&
			(await panel.getByRole("button", {name: "Dismiss scout"}).isVisible()),
	);
	check(
		`${layout}: the MCP agent is listed separately`,
		(await attached.getByText("Observer", {exact: true}).isVisible()) &&
			(await attached.getByRole("button", {name: /^Dismiss\b/}).count()) === 0,
	);
	await until(
		"the top bar counts the summoned agent and the MCP agent",
		() => page.locator(".topbar .right").textContent(),
		(t) => t !== null && /\b2 agents\b/.test(t),
	);
	await shot(page, id, `agents-panel-${layout}-dark`);
	await page.keyboard.press("Escape");
	await until(
		"the panel closed",
		() => panel.count(),
		(n) => n === 0,
	);
	await prompted(page, id);

	await run(page, id, "summon fake ultra as x");
	await shows(
		page,
		id,
		"ultra refused with the offered models and efforts, then the prompt",
		(t) =>
			contains(
				t,
				"ultra is not a model or an effort fake offers. fake's models: fake-small, fake-large; efforts: low, medium, high",
			) && lastRow(t) === "tsh$",
	);
	await shot(page, id, `refused-setting-${layout}-dark`);
	await run(page, id, "dismiss scout");
	await shows(
		page,
		id,
		"scout dismissed",
		(t) => t.includes("scout dismissed") && lastRow(t) === "tsh$",
	);
};

const app = await _electron.launch({executablePath: electronPath, args: [here], env});
const observer = new Client({name: "summon-shots", version: "0.0.0"});
let failed = false;

try {
	const page = await app.firstWindow();
	const bounds = await app.evaluate(({BrowserWindow}) => {
		const [window] = BrowserWindow.getAllWindows();
		if (window === undefined) throw new Error("no app window");
		window.setBounds({x: 0, y: 0, width: 1200, height: 640});
		return window.getBounds();
	});
	check(
		"the native window fits the CI screen",
		bounds.width <= 1440 && bounds.height <= 674,
		bounds,
	);
	await prompted(page, "t1");
	await lookIs(app, page, "dark");
	await settleTerminals(page);
	await observer.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [join(here, "src", "cli.ts"), "mcp", "--as", "observer"],
			env,
			stderr: "inherit",
		}),
	);

	for (const layout of ["one", "side", "stacked", "2x2", "small"]) {
		const first = layout === "one" ? "t1" : await workspace(page);
		if (layout === "side" || layout === "2x2") await split(page, "|");
		if (layout === "stacked" || layout === "2x2") await split(page, "-");
		if (layout === "2x2") {
			await prefixed(page, "h");
			await until(
				`focus on ${first}`,
				() => focused(page),
				(f) => f === first,
			);
			await focusIs(page, first);
			await split(page, "-");
		}
		if (layout === "small") {
			const cdp = await page.context().newCDPSession(page);
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: 1024,
				height: 700,
				deviceScaleFactor: 0,
				mobile: false,
			});
			await until(
				"the page at 1024 by 700",
				() => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
				(size) => size === "1024x700",
			);
		}
		await states(app, page, layout);
	}

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
	await observer.close().catch(() => {});
	await app.close().catch(() => {});
	// This run started that host, on its own temp home, and only this run stops it.
	if (!Number.isNaN(pid))
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	console.log(`shots: ${shots}\nhome: ${home}\nrepo: ${repo}`);
}

if (failed) process.exit(1);
