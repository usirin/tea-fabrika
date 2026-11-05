import {mkdirSync, mkdtempSync, readFileSync, realpathSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, streams, writerText} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {Client} from "@modelcontextprotocol/client";
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {SEVEN} from "@tea-fabrika/tracker/seven";
import {Effect} from "effect";
import {_electron, type ElectronApplication, type Page} from "playwright";

// An agent's own tile, in the real built app, on a temp home of its own (tracker 185b, PR 3, the
// shots d25 asks for). Today's version. The host, the app and the MCP bridge are real; the agent
// is this script, an MCP client on `cli.ts mcp --as claude`, as Claude Code would start it. No
// model runs, no key is read, and the person's real home is never touched. Not part of `pnpm
// test`: it opens a window.
//
//   pnpm --filter @kampus/fabrika-app-old e2e:agents
//   SHOTS=docs/agents pnpm --filter @kampus/fabrika-app-old e2e:agents    the real ones
//
// Each picture is `<state>-<layout>-dark.png`, the dark look first, as the tile shots are:
//
//   strip-one         one tile at 1440x900; claude's line opens its tile folded beside it, focus
//                     stays on the person's
//   only-you-side     claude's tile open beside the person's: its ticket #7 has no pick button, and
//                     "Only you can answer this. Open #7 in your own tile." in their place
//   own-side          the link pressed: #7 in a tile of the person's, focused, with its buttons
//   refused-side      the person types in claude's tile: "lines here run as claude: split for your
//                     own tile (C-b |)", and nothing runs
//   strip-stacked     the person's tile over claude's strip
//   strip-2x2         four tiles, one of them claude's strip
//   agents-2x2        C-b A: the agents' lines, claude and its tile
//   strip-small       the 2x2 in a 1024x700 window: the strip squeezed, its words whole
//
// Seeded on the home's own ledger before the app starts: ticket 7, as a lane left it, with its
// ask "approve plan v1" open (@tea-fabrika/tracker/seven).

const here = import.meta.dirname;
const electronPath: string = createRequire(import.meta.url)("electron");
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), "agents-shots-"));
mkdirSync(shots, {recursive: true});

// A short home: the socket's path has a 103-byte limit.
const home = realpathSync(mkdtempSync(join(tmpdir(), "ag-")));

/** No key goes to the app or the bridge: nothing here may spend money. */
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env))
	if (
		value !== undefined &&
		!["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"].includes(name)
	)
		env[name] = value;
env["FABRIKA_HOME"] = home;
delete env["FABRIKA_FOREGROUND"];

/** Ticket 7's facts, written to the home's own ledger with no host on it. */
const seed = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const [first] = SEVEN;
	if (first !== undefined) yield* ledger.register(nameOf(7), writerText(first.by));
	for (const e of SEVEN)
		yield* ledger.send(streams(nameOf(7)).inbox, `w/${e.pos}`, {
			kind: e.fact.type,
			writer: writerText(e.by),
			data: e.fact,
		});
}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite"), tickMs: 1000})));

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
	ms = 20_000,
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
const screen = async (page: Page, id: string) => {
	const text = tile(page, id).locator(".screen-text");
	return (await text.count()) === 0 ? "" : ((await text.textContent({timeout: 2000})) ?? "");
};
const lastRow = (text: string) => text.split("\n").at(-1) ?? "";
/** The tiles drawn now, in reading order: a folded one is a strip, and not here. */
const tiles = (page: Page) =>
	page
		.locator("[data-tile]")
		.evaluateAll((all) => all.map((t) => t.getAttribute("data-tile") ?? ""));
const strips = (page: Page) =>
	page.locator("[data-strip]").evaluateAll((all) => all.map((s) => s.textContent ?? ""));
const focused = (page: Page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile", {timeout: 2000});
const focusIs = (page: Page, id: string) =>
	until(
		`focus on ${id}`,
		() => focused(page),
		(f) => f === id,
	);
const prompted = (page: Page, id: string) =>
	until(
		`${id}: the prompt`,
		() => screen(page, id),
		(t) => lastRow(t) === "tsh$",
	);

const prefixed = async (page: Page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};

/** Type a line at the focused tile's prompt, wait to see it echoed, and press Enter. */
const run = async (page: Page, id: string, line: string) => {
	await page.keyboard.type(line);
	await until(
		`${id}: the line ${line}`,
		() => screen(page, id),
		(t) => lastRow(t) === `tsh$ ${line}`,
	);
	await page.keyboard.press("Enter");
};

/** Split the focused tile, and answer the new tile's id. */
const split = async (page: Page, key: "|" | "-") => {
	const before = await tiles(page);
	await prefixed(page, key);
	const after = await until(
		"the new tile",
		() => tiles(page),
		(t) => t.length > before.length,
	);
	const made = after.find((t) => !before.includes(t));
	if (made === undefined) throw new Error("no new tile");
	await prompted(page, made);
	return made;
};

/** Close the focused tile, answering its question yes, and wait for it to go. */
const closed = async (page: Page, id: string) => {
	await prefixed(page, "x");
	await page.keyboard.press("y");
	await until(
		`${id} gone`,
		() => tiles(page),
		(t) => !t.includes(id),
	);
};

const focusOn = async (page: Page, id: string) => {
	await tile(page, id).locator(".titlebar").click();
	await focusIs(page, id);
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
	);
};

const lookIs = async (app: ElectronApplication, page: Page, look: "dark" | "light") => {
	await app.evaluate(({nativeTheme}, to) => {
		nativeTheme.themeSource = to;
	}, look);
	await page.emulateMedia({colorScheme: look});
};

const shot = async (page: Page, name: string) => {
	await page.mouse.move(1, 1);
	await sleep(400);
	await page.screenshot({path: join(shots, `${name}-dark.png`)});
	console.log(`shot ${name}-dark`);
};

/** The agent: an MCP client on the bridge Claude Code would start, for claude. */
const claudeOn = async () => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [join(here, "src", "cli.ts"), "mcp", "--as", "claude"],
		env: {...getDefaultEnvironment(), FABRIKA_HOME: home},
		stderr: "pipe",
	});
	const client = new Client({name: "agents-e2e", version: "0.0.0"});
	await client.connect(transport);
	/** One line in claude's tile; its refusal, if any, fails the run. */
	const line = async (text: string) => {
		const answer = await client.callTool({name: "line", arguments: {line: text}});
		check(`claude's line ${text} runs`, answer.isError !== true, answer.content);
	};
	return {line, leave: () => client.close()};
};

/** Every tile on the desk, open or a strip, by id. */
const nodes = (page: Page) =>
	page
		.locator("[data-tile], [data-strip]")
		.evaluateAll((all) =>
			all.map((n) => n.getAttribute("data-tile") ?? n.getAttribute("data-strip") ?? ""),
		);

/** The tile claude's line opened: the one on the desk that is not in `known`. */
const claudeTile = async (page: Page, known: readonly string[]) => {
	const ids = await until(
		"claude's tile",
		() => nodes(page),
		(n) => n.some((id) => !known.includes(id)),
	);
	const made = ids.find((id) => !known.includes(id));
	if (made === undefined) throw new Error("claude's tile is not on the desk");
	return made;
};

const hostPid = () => {
	try {
		return Number.parseInt(readFileSync(join(home, "host", "pid"), "utf8"), 10);
	} catch {
		return Number.NaN;
	}
};

await Effect.runPromise(seed);
const app = await _electron.launch({executablePath: electronPath, args: [here], env});
let claude: Awaited<ReturnType<typeof claudeOn>> | undefined;
try {
	const page = await app.firstWindow();
	await lookIs(app, page, "dark");
	await sized(app, page, 1440, 900);
	await prompted(page, "t1");
	claude = await claudeOn();

	// One tile: claude's first line opens its tile folded beside the person's, and focus stays.
	await claude.line("ticket --ticket 7");
	const theirs = await claudeTile(page, ["t1"]);
	await until(
		"claude's strip",
		() => strips(page),
		(s) => s.some((w) => w.includes("claude")),
	);
	await focusIs(page, "t1");
	await shot(page, "strip-one");

	// Side by side: the person opens claude's tile. Its ticket draws no pick, and the line.
	await page.locator(`[data-strip="${theirs}"]`).click();
	await until(
		"claude's tile open",
		() => tiles(page),
		(t) => t.includes(theirs),
	);
	await focusOn(page, theirs);
	const view = tile(page, theirs).getByLabel("ticket view");
	await view.getByText("Only you can answer this. Open #7 in your own tile.").waitFor();
	check(
		"claude's ticket has no Approve plan v1 button",
		(await view.getByRole("button", {name: "Approve plan v1"}).count()) === 0,
	);
	await shot(page, "only-you-side");

	// The link: no tile of the person's shows #7, so a tile of theirs opens on it, focused.
	const before = await tiles(page);
	await view.getByRole("button", {name: /Open #7 in your own tile/}).click();
	const mine = (
		await until(
			"the person's own tile",
			() => tiles(page),
			(t) => t.length > before.length,
		)
	).find((t) => !before.includes(t));
	if (mine === undefined) throw new Error("no tile of the person's opened");
	await focusIs(page, mine);
	await tile(page, mine)
		.getByLabel("ticket view")
		.getByRole("button", {name: "Approve plan v1"})
		.waitFor();
	await shot(page, "own-side");
	await closed(page, mine);

	// The person types in claude's tile, once their Ctrl-C has stopped its ticket (Ctrl-C there is
	// still the person's): refused, and nothing runs.
	await focusOn(page, theirs);
	await page.keyboard.press("Control+c");
	await prompted(page, theirs);
	await run(page, theirs, "ls");
	await until(
		"the refusal in claude's tile",
		() => screen(page, theirs),
		(t) => t.includes("lines here run as claude: split for your own tile (C-b |)"),
	);
	await shot(page, "refused-side");

	// Stacked: claude's tile goes, and its next line opens a fresh one, folded beside the person's;
	// C-b Space turns the two, so the strip lies under the person's tile.
	await closed(page, theirs);
	await focusIs(page, "t1");
	await claude.line("tally &");
	const fresh = await claudeTile(page, ["t1"]);
	await prefixed(page, " ");
	await shot(page, "strip-stacked");
	await prefixed(page, " ");

	// A 2x2: under claude's tile a tile of the person's (a split from an agent's tile is theirs),
	// claude's folded again above it, and the person's t1 split under too.
	await page.locator(`[data-strip="${fresh}"]`).click();
	await focusOn(page, fresh);
	await split(page, "-");
	await focusOn(page, fresh);
	await prefixed(page, "f");
	await until(
		"claude's strip again",
		() => strips(page),
		(s) => s.some((w) => w.includes("claude")),
	);
	await focusOn(page, "t1");
	await split(page, "-");
	check("the 2x2 has three open tiles and claude's strip", (await tiles(page)).length === 3);
	await shot(page, "strip-2x2");
	await prefixed(page, "A");
	await page.locator(".pop-title").first().waitFor();
	await shot(page, "agents-2x2");
	await page.keyboard.press("Escape");

	// The 2x2 in a small window: the strip squeezed, its words whole.
	await sized(app, page, 1024, 700);
	const cut = await page
		.locator("[data-strip] .strip-name")
		.evaluateAll((all) => all.some((n) => n.scrollWidth > n.clientWidth + 1));
	check("every strip's words are whole at 1024x700", !cut);
	await shot(page, "strip-small");
	console.log(`the shots are in ${shots}`);
} finally {
	await claude?.leave().catch(() => {});
	const pid = hostPid();
	await app.close().catch(() => {});
	// The host outlives the app, as tmux's server does: this run stops its own, by its pid.
	if (!Number.isNaN(pid)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// gone already
		}
	}
}
