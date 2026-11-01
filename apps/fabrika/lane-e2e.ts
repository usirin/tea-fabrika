import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fakeEnv, makeLaneHome} from "@kampus/pipeline/stages/pipeline/lane-fixture";
import {_electron, type ElectronApplication, type Page} from "playwright";

// One tracker ticket through the whole lane, in the real built app, on a temp home. Today's version.
// The machines, the Codex adapter, the box, git and Stryker are all real. The agents are a fake
// `codex` and the code host is a bare folder, so no live agent runs and nothing real is touched.
// Not part of `pnpm test`: it opens a window, kept unseen by the app's quiet start.
//
//   pnpm --filter @kampus/fabrika-app-old e2e:lane
//   SHOTS=<folder> ...e2e:lane     the screenshots there: programs/pipeline/docs for the real ones
//
//   tracker                         the ticket is filed in its own window
//   pipeline --ticket 1 | runs      the lane starts, and waits at the plan's question
//   ticket --ticket 1, map, runs | trace in the other tiles, as a person watches it
//   Ctrl-B x, y on the lane's tile  the runs window closes. The lane does not stop
//   Ctrl-B x, y again               "stop now": this time it does
//   pipeline --ticket 1             typed again: it goes on, and no step runs twice
//   the ticket window               the person's merge yes, then the merge on the bare remote

const here = import.meta.dirname;
const electronPath: string = createRequire(import.meta.url)("electron");
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), "lane-shots-"));
mkdirSync(shots, {recursive: true});

const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-e2e-")));
const {home, remote} = makeLaneHome({
	dir,
	nodeModules: join(here, "../../packages/pipeline/node_modules"),
	reads: [join(here, "../..")],
});

const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env))
	if (
		value !== undefined &&
		!["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"].includes(name)
	)
		env[name] = value;
Object.assign(env, fakeEnv(dir), {FABRIKA_HOME: home});

const check = (what: string, ok: boolean, seen?: unknown) => {
	if (!ok)
		throw new Error(`${what}: no${seen === undefined ? "" : `, saw ${JSON.stringify(seen)}`}`);
	console.log(`ok  ${what}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async <T>(
	what: string,
	look: () => Promise<T>,
	ok: (seen: T) => boolean,
	ms = 180_000,
) => {
	const from = Date.now();
	let seen = await look();
	while (!ok(seen)) {
		if (Date.now() - from > ms) throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
		await sleep(100);
		seen = await look();
	}
	return seen;
};

const tile = (page: Page, id: string) => page.locator(`[data-tile="${id}"]`);
const screen = async (page: Page, id: string) =>
	(await tile(page, id)
		.locator(".screen-text")
		.textContent({timeout: 2000})
		.catch(() => "")) ?? "";
const lastRow = (text: string) => text.split("\n").at(-1) ?? "";
const tiles = (page: Page) =>
	page
		.locator("[data-tile]")
		.evaluateAll((all) => all.map((t) => t.getAttribute("data-tile") ?? ""));

const typed = async (page: Page, id: string, line: string) => {
	await until(
		`${id}: the prompt`,
		() => screen(page, id),
		(t) => lastRow(t) === "tsh$",
		20_000,
	);
	await page.keyboard.type(line);
	await until(
		`${id}: ${line}`,
		() => screen(page, id),
		(t) => lastRow(t) === `tsh$ ${line}`,
		20_000,
	);
	await page.keyboard.press("Enter");
};

const prefixed = async (page: Page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};

/** Split the focused tile, and answer the new tile's id. */
const split = async (page: Page, key: "|" | "-") => {
	const before = await tiles(page);
	await prefixed(page, key);
	const after = await until(
		"the new tile",
		() => tiles(page),
		(t) => t.length > before.length,
		10_000,
	);
	const made = after.find((t) => !before.includes(t));
	if (made === undefined) throw new Error("no new tile");
	return made;
};

const shot = async (page: Page, name: string) => {
	await sleep(400);
	await page.screenshot({path: join(shots, `${name}.png`)});
	console.log(`shot ${name}`);
};

const sized = async (app: ElectronApplication, page: Page, width: number, height: number) => {
	await app.evaluate(
		({BrowserWindow}, size) => {
			BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
		},
		{width, height},
	);
	await until(
		`the window to be ${width}x${height}`,
		() => page.evaluate(() => [window.innerWidth, window.innerHeight]),
		(seen) => seen[0] === width && seen[1] === height,
		10_000,
	);
};

const onMain = (path: string): string | null => {
	try {
		return execFileSync("git", ["--git-dir", remote, "show", `main:${path}`], {
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch {
		return null;
	}
};

const codexSteps = () => {
	try {
		return readFileSync(join(dir, "codex.log"), "utf8")
			.trim()
			.split("\n")
			.map((row) => (JSON.parse(row) as {readonly step: string}).step);
	} catch {
		return [];
	}
};

const hostPid = () => {
	try {
		return Number.parseInt(readFileSync(join(home, "host", "pid"), "utf8"), 10);
	} catch {
		return Number.NaN;
	}
};

const app = await _electron.launch({executablePath: electronPath, args: [here], env});
let failed = false;
try {
	const page = await app.firstWindow();

	// ---- file it, in the tracker's own window
	await until(
		"t1's prompt",
		() => screen(page, "t1"),
		(t) => lastRow(t) === "tsh$",
		30_000,
	);
	// Sized only now: a tiling window manager resizes a new window soon after it opens.
	await sized(app, page, 1600, 1000);
	const first = await split(page, "|");
	await prefixed(page, "h");
	await typed(page, "t1", "tracker");
	const tracker = tile(page, "t1").getByLabel("tracker view");
	await tracker.waitFor();
	await tracker.getByLabel("new ticket title").fill("Read names in one form [slow-build]");
	await tracker.getByLabel("new ticket body").fill("Lower case, no spaces around.");
	await tracker.getByRole("button", {name: "File ticket"}).click();
	await tracker.getByRole("button", {name: /Read names/}).waitFor();
	await shot(page, "filed-side-by-side");
	await tile(page, "t1")
		.click({position: {x: 5, y: 5}})
		.catch(() => {});
	await prefixed(page, "x");
	await page.keyboard.press("y");
	await until(
		"the tracker to go",
		() => tiles(page),
		(t) => t.length === 1,
		15_000,
	);
	check("the ticket is filed from the tracker's window", true);

	// ---- the lane and the ticket window, side by side
	await typed(page, first, "ticket --ticket 1");
	await page
		.getByLabel(/ticket/i)
		.first()
		.waitFor();
	const laneTile = await split(page, "|");
	await typed(page, laneTile, "pipeline --ticket 1 | runs");
	const approve = page.getByRole("button", {name: /^Approve plan/});
	await approve.waitFor({timeout: 180_000});
	check("the lane ran triage and the plan, then asked in the ticket window", true);
	check(
		"no agent has built anything before the person's yes",
		!codexSteps().includes("build"),
		codexSteps(),
	);
	await page
		.getByLabel(/^runs of/)
		.first()
		.waitFor();
	await shot(page, "plan-asked-side-by-side");

	// ---- the other two windows
	const mapTile = await split(page, "-");
	await typed(page, mapTile, "map --ticket 1");
	await page.getByLabel("program map").waitFor();
	await page
		.locator(`[data-tile="${laneTile}"]`)
		.click({position: {x: 5, y: 5}})
		.catch(() => {});
	await shot(page, "plan-asked-three-tiles");

	// ---- closing the runs window does not stop the lane
	await tile(page, laneTile)
		.getByLabel(/^runs of/)
		.click({position: {x: 3, y: 3}})
		.catch(() => {});
	await prefixed(page, "x");
	await page.keyboard.press("y");
	await until(
		"the runs window to close",
		() =>
			tile(page, laneTile)
				.getByLabel(/^runs of/)
				.count(),
		(n) => n === 0,
		15_000,
	);
	check("Ctrl-B x, y closes the runs window", true);
	const closing = await tile(page, laneTile).getByRole("status").count();
	check("its tile says closing, since the lane still runs", closing > 0, closing);
	await approve.click();
	await until(
		"the lane to go on past the plan with its window gone",
		async () => codexSteps(),
		(steps) => steps.includes("tests"),
	);
	check("the lane went on: the test writer ran after the window closed", true, codexSteps());

	// ---- stop now: the lane stops, and typing the line again resumes it
	await until(
		"the builder's run to start",
		async () => codexSteps(),
		(s) => s.includes("build"),
	);
	await tile(page, laneTile)
		.click({position: {x: 3, y: 3}})
		.catch(() => {});
	await prefixed(page, "x");
	await page.keyboard.press("y");
	await until(
		"the tile to go",
		() => tiles(page),
		(t) => !t.includes(laneTile),
		20_000,
	);
	check("stop now ends the lane's process, in the middle of the builder's run", true);
	const atStop = codexSteps();

	await prefixed(page, "h");
	const again = await split(page, "-");
	await typed(page, again, "pipeline --ticket 1");
	await until(
		"the line typed again to go on",
		() => screen(page, again),
		(t) => /push: done/.test(t),
	);
	const merge = page.getByRole("button", {name: /^Merge/});
	await merge.waitFor({timeout: 60_000});
	const steps = codexSteps();
	check(
		"typed again, it went on: plan ran once",
		steps.filter((s) => s === "plan").length === 1,
		steps,
	);
	check(
		"typed again: the test writer ran once",
		steps.filter((s) => s === "tests").length === 1,
		steps,
	);
	console.log(
		`    builder runs: ${steps.filter((s) => s === "build").length}, at the stop: ${atStop.join(" ")}`,
	);
	check("nothing is on main before the person's yes", onMain("src/lower.ts") === null);
	await shot(page, "merge-asked-three-tiles");

	// ---- the windows, all four
	await prefixed(page, "l");
	const runsTile = await split(page, "-");
	await typed(page, runsTile, "runs --ticket 1 | trace");
	const clips = page.locator(".runs-view button[aria-pressed]");
	await until(
		"the runs window's clips",
		() => clips.count(),
		(n) => n >= 8,
		20_000,
	);
	const labels = await clips.evaluateAll((all) =>
		all.map((b) => b.getAttribute("aria-label") ?? ""),
	);
	console.log(`    clips:\n      ${labels.join("\n      ")}`);
	await clips.nth(1).click();
	// The line's second window opens folded where a quarter of the desk is too small for two.
	const strip = page.locator("[data-strip]", {hasText: "trace"});
	if ((await strip.count()) > 0) await strip.first().click();
	await until(
		"the trace window to fill",
		() =>
			page
				.locator(".trace-view")
				.first()
				.textContent({timeout: 2000})
				.catch(() => ""),
		(t) => (t ?? "").length > 40,
		20_000,
	);
	const traced = (await page.locator(".trace-view").first().textContent()) ?? "";
	console.log(`    trace says: ${traced.slice(0, 200).replaceAll("\n", " ")}`);
	const lit = await page
		.locator(".map-view [data-step]")
		.evaluateAll((all) => all.map((s) => `${s.getAttribute("data-step")}:${s.className}`));
	console.log(`    map:\n      ${lit.join("\n      ")}`);
	await shot(page, "merge-asked-2x2");

	// ---- the merge, on the person's yes
	await merge.click();
	const lines = await until(
		"the lane to end",
		() => screen(page, again),
		(t) => /#1 ended:/.test(t),
	);
	console.log(lines);
	check("the lane ends on done", /#1 ended: done/.test(lines));
	check(
		"the change is on main of the bare remote",
		(onMain("src/lower.ts") ?? "").includes("toLowerCase"),
	);
	const closedView = await until(
		"the ticket window to say done",
		() => tile(page, first).innerText(),
		(t) => /done: PR #1 merged/.test(t),
		20_000,
	);
	check("the ticket window says the pull request merged", /merged/.test(closedView));
	await shot(page, "merged-2x2");
	await sized(app, page, 1024, 700);
	await shot(page, "merged-2x2-small-window");
	await sized(app, page, 1600, 1000);
	await prefixed(page, "z");
	await shot(page, "merged-one-tile");
	await prefixed(page, "z");
	await until(
		"the zoom to end",
		() => tiles(page),
		(t) => t.includes(runsTile) && t.includes(mapTile),
		10_000,
	);
	// ---- the same lane, its windows closing one by one down to two stacked
	for (const id of [runsTile, mapTile]) {
		await tile(page, id).click({position: {x: 3, y: 3}});
		await prefixed(page, "x");
		await page.keyboard.press("y");
		await until(
			`${id} to go`,
			() => tiles(page),
			(t) => !t.includes(id),
			15_000,
		);
	}
	await shot(page, "merged-stacked");
} catch (cause) {
	failed = true;
	console.error(cause);
	const [page] = app.windows();
	if (page !== undefined) {
		await page.screenshot({path: join(shots, "failed.png")}).catch(() => {});
		const ids = await tiles(page).catch(() => [] as readonly string[]);
		for (const id of ids) console.error(`--- ${id}\n${await screen(page, id)}`);
	}
} finally {
	const pid = hostPid();
	await app.close().catch(() => {});
	// This run started that host, on its own temp home, and only this run stops it.
	if (!Number.isNaN(pid)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	}
	console.log(`shots: ${shots}\nhome: ${home}`);
}
if (failed) process.exit(1);
