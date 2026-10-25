// Experiment 150: does fabrika's desk work in a plain browser tab, attached to the host, with
// no Electron? What does it cost in typing speed, and in safety?
//
// It builds copies of the app (apps/fabrika) at main's 2a7f305, the merge of pull request 90,
// under runs/exp-150/build/, which git ignores. Each copy gets the experiment's own files
// (experiments/150-browser-desk/web/) in src/web/, and its patches (COPIES) on top. The
// app itself is never changed. Each copy builds the app's own bundles, as build.ts does, and two
// more: dist/bridge.js, the page's `window.fabrika` over one WebSocket (web/bridge.ts), and
// dist/door.mjs, a tiny relay from that WebSocket to the host's socket file (web/door.ts).
// The page's own bundle, dist/desk.js, is the same file for the Electron window and the tab.
//
//   node experiments/150-browser-desk.ts build [copy...]   base, f2, f24 (default: all)
//   node experiments/150-browser-desk.ts check             the app's end-to-end flow, in a tab
//   node experiments/150-browser-desk.ts safety            the door's guards, tried from outside
//   node experiments/150-browser-desk.ts typing            key to screen: Electron and the tab
//   node experiments/150-browser-desk.ts report            the tables, and the results file
//
// The browser is Playwright's own Chromium 156, headless: no window, no focus taken. Electron 45
// is Chromium 156 too, opened quiet (the probes patch: no Dock icon, never the key window), as
// experiment 143 opened it. Every run is on a fresh FABRIKA_HOME in the temp folder, removed
// after; the host and the door it starts are stopped by the pids in that home, and checked to
// be gone. No model, no key, no network past 127.0.0.1, $0.
//
// Plain Node and Playwright, said here: like 143, this drives the app from outside, in
// Playwright's promises. The code under test (web/) is Effect.

import {execFileSync, spawn} from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {mkdtemp} from "node:fs/promises";
import {createServer as createHttpServer} from "node:http";
import {createRequire} from "node:module";
import {connect, createServer} from "node:net";
import {cpus, loadavg, tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
const appDir = join(root, "apps/fabrika");
const require = createRequire(join(appDir, "package.json"));
const {chromium, _electron} = require("playwright");
const electronPath = require("electron");
const esbuild = require("esbuild");

const HERE = join(root, "experiments/150-browser-desk");
const WORK = join(root, "runs/exp-150");
const BUILDS = join(WORK, "build");
const RAW = join(WORK, "raw");
const RESULTS = join(root, "experiments/results/150-browser-desk.json");
const COMMIT = "2a7f305e677b22459423f84e60c2fbd54b5f3e94";

/**
 * Each copy: its patches, in order, by their path under experiments/. 143's probes time the page
 * and open Electron quiet; its fix 2 redraws only the typed row. Fix 4, local echo, is 143's
 * with its context moved off 143's fix 3, which is not used here.
 */
const PROBES = "143-typing-latency/probes-pr90";
const ROW = "143-typing-latency/fix2-erase-row";
const ECHO = "150-browser-desk/fix4-local-echo";
const COPIES = {
	// No patch: what a person would build. The script never measures it.
	raw: [],
	base: [PROBES],
	f2: [PROBES, ROW],
	f24: [PROBES, ROW, ECHO],
};

const list = (name, fallback) => (process.env[name] ?? fallback).split(",").filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Never the Jev key: nothing here may spend money.
const {TYPESAFE_API_KEY: _never, ...cleanEnv} = process.env;

// ---------------------------------------------------------------------------------------------
// Build

// The door's bundle imports `createRequire` itself (through Node's http server), so the banner's
// name is its own.
const REQUIRE =
	'import {createRequire as __x150require} from "node:module"; const require = __x150require(import.meta.url);';

const bundle = async (app) => {
	const at = (...parts) => join(app, ...parts);
	const node = {platform: "node", format: "esm", target: "node24", banner: {js: REQUIRE}};
	const page = {
		platform: "browser",
		format: "iife",
		target: "chrome140",
		minify: true,
		define: {"process.env.NODE_ENV": '"production"'},
	};
	const jobs = [
		{
			...node,
			entryPoints: [at("src/main.ts")],
			outfile: at("dist/main.mjs"),
			external: ["electron"],
		},
		{...node, entryPoints: [at("src/host/main.ts")], outfile: at("dist/host.mjs")},
		{
			entryPoints: [at("src/preload.ts")],
			outfile: at("dist/preload.cjs"),
			platform: "node",
			format: "cjs",
			target: "node24",
			external: ["electron"],
		},
		{
			...page,
			entryPoints: [at("src/window/desk.tsx")],
			outfile: at("dist/desk.js"),
			jsx: "automatic",
			loader: {".wasm": "binary"},
		},
		// Experiment 150's two: the tab's bridge, and the door.
		{...page, entryPoints: [at("src/web/bridge.ts")], outfile: at("dist/bridge.js")},
		{...node, entryPoints: [at("src/web/door.ts")], outfile: at("dist/door.mjs")},
	];
	const built = await Promise.all(
		jobs.map((o) =>
			esbuild.build({
				bundle: true,
				logLevel: "warning",
				legalComments: "none",
				metafile: true,
				...o,
			}),
		),
	);
	copyFileSync(at("src/window/desk.html"), at("dist/desk.html"));
	copyFileSync(at("src/web/desk.html"), at("dist/web.html"));
	copyFileSync(at("src/window/window.css"), at("dist/window.css"));
	return built;
};

const build = async (copy) => {
	const patches = COPIES[copy];
	const dir = join(BUILDS, copy);
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir, {recursive: true});
	const tar = execFileSync(
		"git",
		[
			"-C",
			root,
			"archive",
			"--format=tar",
			COMMIT,
			"apps/fabrika/src",
			"apps/fabrika/tsconfig.json",
			"tsconfig.base.json",
		],
		{maxBuffer: 1 << 28},
	);
	execFileSync("tar", ["-x", "-C", dir], {input: tar});
	const app = join(dir, "apps/fabrika");
	cpSync(join(HERE, "web"), join(app, "src/web"), {recursive: true});
	for (const p of patches)
		execFileSync(
			"patch",
			["-p1", "--batch", "--forward", "-d", dir, "-i", join(root, "experiments", `${p}.patch`)],
			{
				stdio: "pipe",
			},
		);
	// The app's own packages, linked as installed (ghostty-web with the app's own pnpm patch).
	const modules = join(app, "node_modules");
	mkdirSync(modules);
	for (const name of readdirSync(join(appDir, "node_modules"))) {
		if (name.startsWith(".")) continue;
		symlinkSync(realpathSync(join(appDir, "node_modules", name)), join(modules, name));
	}
	writeFileSync(
		join(app, "package.json"),
		`${JSON.stringify({name: "exp-150-fabrika", private: true, type: "module", main: "dist/main.mjs"})}\n`,
	);
	const built = await bundle(app);
	const size = (file) => readFileSync(join(app, "dist", file)).length;
	console.log(
		`built ${copy}: ${patches.join(", ")}; desk.js ${size("desk.js")} B, bridge.js ${size("bridge.js")} B, door.mjs ${size("door.mjs")} B`,
	);
	return built;
};

// ---------------------------------------------------------------------------------------------
// Processes: the host, the door, and the delay proxy, each on a fresh home, each stopped after.

const appOf = (copy) => join(BUILDS, copy, "apps/fabrika");
const freshHome = () => mkdtemp(join(tmpdir(), "f150-"));
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const pidIn = (file) => {
	const n = existsSync(file) ? Number.parseInt(readFileSync(file, "utf8"), 10) : Number.NaN;
	return Number.isInteger(n) ? n : null;
};
const until = async (what, look, ok, tries = 400, every = 25) => {
	let seen = await look();
	for (let i = 0; i < tries && !ok(seen); i += 1) {
		await sleep(every);
		seen = await look();
	}
	if (!ok(seen)) throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
	return seen;
};

/** Start a bundle of a copy as plain Node, with Electron's own binary, as the app starts its host. */
const startNode = (copy, file, home, extra = {}) =>
	spawn(electronPath, [join(appOf(copy), "dist", file)], {
		env: {...cleanEnv, ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: home, ...extra},
		detached: false,
		stdio: ["ignore", "pipe", "pipe"],
	});

/** Stop a pid this run started, and wait until it is gone. */
const stopPid = async (pid) => {
	if (pid === null || !alive(pid)) return;
	process.kill(pid, "SIGTERM");
	for (let i = 0; i < 80 && alive(pid); i += 1) await sleep(50);
	if (alive(pid)) process.kill(pid, "SIGKILL");
};

/**
 * A host and a door on a fresh home: answers the door's url, and how to stop both. With
 * `host: false`, only the door, on a home whose socket something else answers.
 */
const startDesk = async (
	copy,
	{
		hosts = [],
		port = 0,
		home: given = null,
		host: withHost = true,
		guards = "host,origin,cookie",
	} = {},
) => {
	const home = given ?? (await freshHome());
	const host = withHost ? startNode(copy, "host.mjs", home) : {pid: null};
	await until("the host's socket", () => existsSync(join(home, "host/sock")), Boolean);
	const door = startNode(copy, "door.mjs", home, {
		X150_PORT: String(port),
		X150_HOSTS: hosts.join(","),
		X150_GUARDS: guards,
	});
	let doorLog = "";
	door.stdout.on("data", (b) => {
		doorLog += b;
	});
	door.stderr.on("data", (b) => {
		doorLog += b;
	});
	const url = await until(
		"the door's url",
		() =>
			existsSync(join(home, "web/url")) ? readFileSync(join(home, "web/url"), "utf8").trim() : "",
		(u) => u !== "",
	);
	const stop = async () => {
		await stopPid(door.pid);
		await stopPid(host.pid);
		const left = [host.pid, door.pid].filter((p) => p !== null && alive(p));
		if (left.length > 0) throw new Error(`left running: ${left.join(", ")}`);
		rmSync(home, {recursive: true, force: true});
	};
	return {home, url, port: Number(new URL(url).port), host, door, log: () => doorLog, stop};
};

/**
 * A delay proxy: TCP on 127.0.0.1, `rtt / 2` each way, in order, as a network of that round trip
 * would hold each chunk. Answers its port, how to name the port it relays to (`to`: the door
 * is started after the proxy, so the door knows the proxy's name), and how to close it.
 */
const delayProxy = (rtt) =>
	new Promise((resolve) => {
		const half = rtt / 2;
		const sockets = new Set();
		let to = 0;
		const server = createServer((client) => {
			const upstream = connect(to, "127.0.0.1");
			sockets.add(client);
			sockets.add(upstream);
			const lane = (from, into) => {
				let last = 0;
				from.on("data", (chunk) => {
					const at = Math.max(performance.now() + half, last);
					last = at;
					setTimeout(() => into.writable && into.write(chunk), at - performance.now());
				});
				from.on("close", () => setTimeout(() => into.destroy(), half));
				from.on("error", () => into.destroy());
			};
			lane(client, upstream);
			lane(upstream, client);
		});
		server.listen(0, "127.0.0.1", () =>
			resolve({
				port: server.address().port,
				to: (port) => {
					to = port;
				},
				close: () =>
					new Promise((done) => {
						for (const s of sockets) s.destroy();
						server.close(done);
					}),
			}),
		);
	});

/** Headless Chromium: no window, no focus. */
const browser = (args = []) => chromium.launch({headless: true, args});

// ---------------------------------------------------------------------------------------------
// check: the app's own end-to-end flow (apps/fabrika/e2e.ts), step by step, in a tab. Each step
// that fits is the e2e's own, with its own words; a step that is Electron's alone is listed in
// SKIPPED with why, and a step bent to fit a tab says how.

const checks = [];
const check = (what, ok, seen) => {
	checks.push({what, ok: Boolean(ok)});
	if (!ok)
		throw new Error(`${what}: no${seen === undefined ? "" : `, saw ${JSON.stringify(seen)}`}`);
	console.log(`ok  ${what}`);
};
const SKIPPED = [
	{
		step: "a second copy quits, and the first keeps its one window",
		why: "one copy is Electron's single-instance lock. A tab has none: a second tab is a second client of the same host, checked instead",
	},
	{
		step: "the page cannot navigate away",
		why: "main.ts refuses navigation for its window. A browser tab may always navigate; the bridge goes with the page, and nothing is left attached",
	},
	{
		step: "window.open is refused",
		why: "Electron's window-open handler. In a browser the page's own code could open a tab; only the page's CSP and the browser's popup rules hold it",
	},
	{
		step: "the dock icon (`activate`) and macOS's window rules",
		why: "there is no app and no dock: closing the tab and opening the url again stands in for them",
	},
];

const tileOf = (page, id) => page.locator(`[data-tile="${id}"]`);
const screenOf = async (page, id) =>
	(await tileOf(page, id).locator(".screen-text").textContent({timeout: 2000})) ?? "";
const lastRow = (text) => text.split("\n").at(-1) ?? "";
const tilesNow = (page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));
const focusedNow = (page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile", {timeout: 2000});
const shows = (page, id, what, ok) =>
	until(`${id}: ${what}`, () => screenOf(page, id), ok, 200, 50);
const prompted = (page, id) => shows(page, id, "the prompt", (t) => lastRow(t) === "tsh$");
const runLine = async (page, id, line) => {
	await page.keyboard.type(line);
	await shows(page, id, `the line ${line}`, (t) => lastRow(t) === `tsh$ ${line}`);
	await page.keyboard.press("Enter");
};
const prefixed = async (page, key) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
};
const focusIs = (page, id) =>
	until(
		`focus on ${id}`,
		() => focusedNow(page),
		(f) => f === id,
		200,
		50,
	);
const tilesAre = (page, ids) =>
	until(
		`the tiles ${ids.join(" ")}`,
		() => tilesNow(page),
		(t) => t.join() === ids.join(),
		200,
		50,
	);
const asked = (page) =>
	page
		.getByRole("alertdialog")
		.textContent({timeout: 2000})
		.then((t) => t ?? "");
const askedIs = (page, q) =>
	until(
		`the question ${q}`,
		() => asked(page),
		(s) => s === q,
		200,
		50,
	);
const noQuestion = (page) =>
	until(
		"no question",
		() => page.getByRole("alertdialog").count(),
		(n) => n === 0,
		200,
		50,
	);
const countIn = (page, id) => tileOf(page, id).getByLabel("count", {exact: true});
const shots = join(WORK, "shots");
const shot = (page, name) => page.screenshot({path: join(shots, `${name}.png`)});

/** A host of another version: a Node server on the home's socket that says hello with version 0. */
const oldHost = async (home) => {
	mkdirSync(join(home, "host"), {recursive: true, mode: 0o700});
	const sock = join(home, "host/sock");
	const child = spawn(
		process.execPath,
		[
			"-e",
			`require("node:net").createServer((c) => c.write('{"type":"hello","version":0}\\n')).listen(process.argv[1])`,
			sock,
		],
		{stdio: "ignore", env: cleanEnv},
	);
	await until("the old host's socket", () => existsSync(sock), Boolean);
	return child;
};

const flowInTab = async (page, desk) => {
	await prompted(page, "t1");
	check(
		"the desk starts on the door's page",
		page.url() === `http://127.0.0.1:${desk.port}/desk.html`,
		page.url(),
	);
	await runLine(page, "t1", "seq --to 3 | double");
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
		() => focusedNow(page),
		(f) => f !== "t1",
	);
	check("Ctrl-B h and Ctrl-B l move focus", right === "t2" || right === "t3", right);
	await tileOf(page, "t3").click();
	await focusIs(page, "t3");
	check("a click focuses a tile", true);

	await runLine(page, "t3", "counter");
	await countIn(page, "t3").waitFor();
	check("counter covers t3, at 0", (await countIn(page, "t3").innerText()) === "0");
	await tileOf(page, "t3").getByRole("button", {name: "+1"}).click();
	await countIn(page, "t3").filter({hasText: /^1$/}).waitFor();
	const t1 = await screenOf(page, "t1");
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
	await runLine(page, "t2", "tracker &");
	const job = await shows(page, "t2", "the job's number", (t) => /\[1\] tracker:/.test(t));
	await prompted(page, "t2");
	await page.waitForTimeout(300);
	await tilesAre(page, ["t1", "t2"]);
	check(
		"tracker & opens no tile: a job in the background, and t2's prompt is back",
		(await tileOf(page, "t2").getByLabel("tracker view").count()) === 0,
		job,
	);
	await runLine(page, "t2", "attach %1");
	await tileOf(page, "t2").getByLabel("tracker view").waitFor();
	await tilesAre(page, ["t1", "t2"]);
	check("attach %1 brings the tracker in, covering t2, as fg does", true);
	await shot(page, "5-attached");

	await prefixed(page, "z");
	await tilesAre(page, ["t2"]);
	check("Ctrl-B z zooms t2", true);
	await shot(page, "6-zoomed");
	await prefixed(page, "z");
	await tilesAre(page, ["t1", "t2"]);

	await prefixed(page, "h");
	await focusIs(page, "t1");
	await runLine(page, "t1", "sleep --ms 600000 &");
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
		() => tileOf(page, "t1").getByRole("status").count(),
		(n) => n === 1,
	);
	await page.waitForTimeout(300);
	await tilesAre(page, ["t1", "t2"]);
	check(
		"y on a busy tile: it shows closing, and waits, as sleep does not end on its inputs' end",
		(await tileOf(page, "t2").getByLabel("tracker view").count()) === 1,
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
		(await tileOf(page, "t2").getByLabel("tracker view").count()) === 1,
	);

	await prefixed(page, "|");
	const split = await until(
		"a new tile",
		() => tilesNow(page),
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

	const reach = await page.evaluate(() => ({
		require: typeof globalThis.require,
		process: typeof globalThis.process,
		bridge: Object.keys(window.fabrika).sort(),
		frozen: Object.isFrozen(window.fabrika),
	}));
	check(
		"the page has send, onMessage and forget only, and no Node",
		reach.require === "undefined" &&
			reach.process === "undefined" &&
			reach.bridge.join() === "forget,onMessage,send",
		reach,
	);
	await page.evaluate((next) => {
		window.fabrika.send(`tile:${next}`, {type: "line", value: "say --text no\r"});
		window.fabrika.send(`tile:${next}`, {type: "keys", data: "say --text no\r", to: "tsh:p1"});
		window.fabrika.send("tile:../t1", {type: "keys", data: "say --text no\r"});
		window.fabrika.send("desk", {type: "open", tile: "../../etc"});
		window.fabrika.send("desk", "rm -rf");
		// A tab's own: a value that is no plain JSON stays in the page, and the link stays up.
		window.fabrika.send(`tile:${next}`, {type: "keys", data: new Map()});
	}, next);
	await page.waitForTimeout(300);
	const refused = await screenOf(page, next);
	check("messages not of the protocol tell tsh nothing", !refused.includes("no"), refused);

	await runLine(page, next, "counter");
	await countIn(page, next).waitFor();
	await tileOf(page, next).getByRole("button", {name: "+1"}).click();
	await countIn(page, next).filter({hasText: /^1$/}).waitFor();
	check("the link is still up after the refused messages: counter runs in the new tile", true);
	return next;
};

const runCheck = async () => {
	mkdirSync(shots, {recursive: true});
	const copy = list("COPY", "raw")[0];
	const desk = await startDesk(copy);
	let b = await browser();
	let left = "";
	try {
		const context = await b.newContext({viewport: {width: 1200, height: 760}});
		const page = await context.newPage();
		await page.goto(desk.url);
		left = await flowInTab(page, desk);

		// Asked by the owner: a reload draws the same desk.
		await page.reload();
		await tilesAre(page, ["t2", left]);
		await countIn(page, left).filter({hasText: /^1$/}).waitFor();
		await tileOf(page, "t2").getByLabel("tracker view").waitFor();
		check("a reload draws the same desk: counter at 1 and the tracker, nothing restarted", true);

		// A second tab: a second client of the same host, as a second tmux client is.
		const second = await context.newPage();
		await second.goto(`http://127.0.0.1:${desk.port}/desk.html`);
		await tilesAre(second, ["t2", left]);
		await countIn(second, left).filter({hasText: /^1$/}).waitFor();
		await tileOf(second, left).getByRole("button", {name: "+1"}).click();
		await countIn(page, left).filter({hasText: /^2$/}).waitFor();
		check("a second tab shows the same desk, and a click in it shows in the first", true);
		await second.close();

		// The close button, then the url again: stands in for the window's close and the dock icon.
		await page.close();
		await sleep(500);
		const again = await context.newPage();
		await again.goto(`http://127.0.0.1:${desk.port}/desk.html`);
		await tilesAre(again, ["t2", left]);
		await countIn(again, left).filter({hasText: /^2$/}).waitFor();
		await tileOf(again, "t2").getByLabel("tracker view").waitFor();
		check(
			"the tab closed and opened again: the same desk, counter at 2 and the tracker run on",
			true,
		);
		await shot(again, "9-reopened");
		await tileOf(again, "t2").click();
		await focusIs(again, "t2");
		await prefixed(again, "x");
		await askedIs(again, "close t2? (y/n)");
		await again.keyboard.press("y");
		await tilesAre(again, [left]);
		check("y on t2: the tracker gets the end of its inputs, ends, and t2 goes", true);
		await context.close();

		// The browser quits with counter up: the host runs on, apart, as with the app.
		await b.close();
		b = null;
		await sleep(300);
		check("the browser quit, and the host runs on", desk.host.pid !== null && alive(desk.host.pid));
		const kept = readdirSync(join(desk.home, "storage", "tiles"));
		check(
			"the tile left with counter has its jobs in its own folder, and no closed tile has",
			kept.includes(left) && !["t1", "t2", "t3"].some((t) => kept.includes(t)),
			kept,
		);
		const deskFile = readFileSync(join(desk.home, "desk.json"), "utf8");
		check("the host kept the desk in the home", deskFile.includes(`"${left}"`), deskFile);
		const history = readFileSync(join(desk.home, "history"), "utf8");
		check("the host kept the history in the home", history.endsWith("counter\n"), history);

		b = await browser();
		const fresh = await (await b.newContext({viewport: {width: 1200, height: 760}})).newPage();
		// A new browser has no cookie: the url with its token, as a person opens it.
		await fresh.goto(desk.url);
		await tilesAre(fresh, [left]);
		await countIn(fresh, left).filter({hasText: /^2$/}).waitFor();
		const before = await screenOf(fresh, left);
		check(
			"a new browser: the same desk, with counter still up at 2",
			!before.includes("earlier tsh"),
			before,
		);
		await shot(fresh, "10-restored");
		await tileOf(fresh, left).getByRole("button", {name: "done"}).click();
		await shows(fresh, left, "counter's count", (t) => t.includes("tsh$ counter\n2\n"));
		check("done: counter ends, the tsh that ran it all along prints 2", true);
		await prompted(fresh, left);
		await prefixed(fresh, "|");
		const split = await until(
			"a new tile",
			() => tilesNow(fresh),
			(t) => t.length === 2,
		);
		await prompted(fresh, split[1] ?? "");
		check("Ctrl-B | splits, through the host", split[0] === left, split);
		await prefixed(fresh, "x");
		await askedIs(fresh, `close ${split[1]}? (y/n)`);
		await fresh.keyboard.press("y");
		await tilesAre(fresh, [left]);
		await focusIs(fresh, left);
		// The last tile: in the app the window closes. A tab cannot close itself, so it loads again.
		const reloaded = fresh.waitForEvent("load");
		await prefixed(fresh, "x");
		await askedIs(fresh, `close ${left}? (y/n)`);
		await fresh.keyboard.press("y");
		await reloaded;
		await tilesAre(fresh, ["t1"]);
		const first = await prompted(fresh, "t1");
		check(
			"closing the last tile: the tab loads again, on one fresh tile with a fresh tsh",
			!first.includes("earlier tsh"),
			first,
		);
	} finally {
		await b?.close();
		await desk.stop();
	}

	// A host of another version: the door pipes to it unread; the page's own link refuses it.
	const home = await freshHome();
	const old = await oldHost(home);
	const door = await startDesk(copy, {home, host: false});
	const ob = await browser();
	try {
		const page = await ob.newPage();
		await page.goto(door.url);
		const said = await until(
			"the page to say it did not attach",
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
			"a host of another version: the page does not attach, and says both versions",
			said.includes("version 0") &&
				said.includes("speaks 1") &&
				(await tilesNow(page)).length === 0,
			said,
		);
		await shot(page, "11-mismatch");
		check("the host of another version still runs: nothing stopped it", alive(old.pid));
	} finally {
		await ob.close();
		await stopPid(old.pid);
		await door.stop();
	}
	check("nothing of this run left: no host, no door", pgrep(BUILDS) === "", pgrep(BUILDS));
	mkdirSync(RAW, {recursive: true});
	writeFileSync(join(RAW, "check.json"), JSON.stringify({copy, checks, skipped: SKIPPED}, null, 1));
	console.log(
		`${checks.length} checks passed in a headless tab; ${SKIPPED.length} e2e steps do not fit a tab`,
	);
};

// ---------------------------------------------------------------------------------------------
// safety: the door's guards, tried from outside. The person's tab opens the door's url first,
// so the browser holds the door's cookie, as a person's would. Then each attacker tries to reach
// the desk, with every guard on, and again with one guard taken away at a time, to show which
// guard holds which attack. "In" means the attacker read a tile's screen off the link, and typed
// a line into tsh that the person's own tab then shows.

/** The attacker's page: open the door's link, say hello and `page`, read a screen, type a line. */
const attackPage = (link, files, mark) => `<!doctype html><meta charset="utf-8"><script>
const r = {open: false, read: false, typed: false, fetch: null, closed: null};
window.__r = r;
fetch(${JSON.stringify(files)}, {credentials: "include"}).then((x) => (r.fetch = x.status), () => (r.fetch = "blocked"));
let ws;
try { ws = new WebSocket(${JSON.stringify(link)}); } catch (e) { r.closed = "threw: " + e.message; }
if (ws) {
	ws.binaryType = "arraybuffer";
	ws.onopen = () => { r.open = true; ws.send('{"type":"hello","version":1}\\n{"type":"page"}\\n'); };
	ws.onmessage = (e) => {
		const t = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
		if (t.includes('"type":"to"') && t.includes('"tile:t1"')) r.read = true;
		if (r.read && !r.typed) {
			r.typed = true;
			ws.send('{"type":"on","port":"tile:t1","m":{"type":"keys","data":"say --text ${mark}\\\\r"}}\\n');
		}
	};
	ws.onclose = (e) => { r.closed = e.code; };
}
</script>`;

/** Who attacks, from where, aiming at what. `{port}` is the door's port. */
const ATTACKERS = [
	{
		name: "same-site page",
		what: "a page another local program serves on 127.0.0.1, another port: same site, so the browser sends the door's cookie",
		page: "http://127.0.0.1:{other}/a.html",
		served: true,
		link: "ws://127.0.0.1:{port}/link",
		files: "http://127.0.0.1:{port}/desk.html",
	},
	{
		name: "cross-site page",
		what: "a page on localhost, another port: another site to the browser (cross-site WebSocket hijacking)",
		page: "http://localhost:{other}/a.html",
		served: true,
		link: "ws://127.0.0.1:{port}/link",
		files: "http://127.0.0.1:{port}/desk.html",
	},
	{
		name: "public page",
		what: "a page from the internet (attacker.example), aiming at 127.0.0.1",
		page: "http://attacker.example/a.html",
		link: "ws://127.0.0.1:{port}/link",
		files: "http://127.0.0.1:{port}/desk.html",
	},
	{
		name: "DNS rebinding",
		what: "a page on rebind.test whose name now points at 127.0.0.1, on the door's own port: the door is same-origin to it",
		page: "http://rebind.test:{port}/a.html",
		link: "ws://rebind.test:{port}/link",
		files: "http://rebind.test:{port}/desk.html",
	},
];

/** A raw HTTP request to the door, as any program on the laptop can make: the status line. */
const raw = (port, lines) =>
	new Promise((resolve) => {
		const s = connect(port, "127.0.0.1");
		let got = "";
		s.on("data", (b) => {
			got += b;
			if (got.includes("\r\n")) {
				resolve(got.split("\r\n")[0]);
				s.destroy();
			}
		});
		s.on("error", (e) => resolve(`error ${e.code}`));
		s.write(`${lines.join("\r\n")}\r\n\r\n`);
	});
const upgrade = (port, {host, origin, cookie}) =>
	raw(port, [
		"GET /link HTTP/1.1",
		`Host: ${host}`,
		...(origin === null ? [] : [`Origin: ${origin}`]),
		...(cookie === null ? [] : [`Cookie: ${cookie}`]),
		"Upgrade: websocket",
		"Connection: Upgrade",
		"Sec-WebSocket-Version: 13",
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
	]);

/** Every guard; each one taken away; each one alone; none, which shows an attack can get in. */
const GUARD_SETS = [
	"host,origin,cookie",
	"origin,cookie",
	"host,cookie",
	"host,origin",
	"cookie",
	"origin",
	"host",
	"none",
];

/**
 * The browser as it ships, and with Chromium's Local Network Access checks off. Chromium 156
 * holds a public page's requests to 127.0.0.1 for a permission, which headless never gives; other
 * browsers, older Chromes, or a person who clicks Allow, do not hold them. With the checks off,
 * the door's own guards are what is tested.
 */
const BROWSERS = [
	{name: "as shipped", args: [], sets: ["host,origin,cookie", "none"]},
	{
		name: "LNA off",
		args: ["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"],
		sets: GUARD_SETS,
	},
];

/** Another local program's web server, on 127.0.0.1: it serves the attacker's page. */
const attackServer = () =>
	new Promise((resolve) => {
		const server = createHttpServer((req, res) => {
			const q = new URL(req.url, "http://x").searchParams;
			res.writeHead(200, {"content-type": "text/html"});
			res.end(attackPage(q.get("link"), q.get("files"), q.get("mark")));
		});
		server.listen(0, "127.0.0.1", () =>
			resolve({
				port: server.address().port,
				close: () => new Promise((done) => server.close(done)),
			}),
		);
	});

const runSafety = async () => {
	const copy = list("COPY", "raw")[0];
	const rows = [];
	const other = await attackServer();
	for (const mode of BROWSERS)
		for (const guards of mode.sets) {
			const desk = await startDesk(copy, {guards});
			const b = await browser([
				"--host-resolver-rules=MAP rebind.test 127.0.0.1, MAP attacker.example 127.0.0.1",
				...mode.args,
			]);
			try {
				const context = await b.newContext();
				const person = await context.newPage();
				await person.goto(desk.url);
				await prompted(person, "t1");
				const cookies = await context.cookies(`http://127.0.0.1:${desk.port}`);
				const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
				const fill = (s) =>
					s.replaceAll("{port}", String(desk.port)).replaceAll("{other}", String(other.port));
				let logAt = desk.log().length;
				for (const a of ATTACKERS) {
					const page = await context.newPage();
					const mark = `x150-in-${rows.length}`;
					const query = new URLSearchParams({link: fill(a.link), files: fill(a.files), mark});
					// A local page comes from a real server on 127.0.0.1, so Chromium knows it is local.
					// A page from the internet is made up here: Playwright answers its url itself.
					const url = a.served ? `${fill(a.page)}?${query}` : fill(a.page);
					if (!a.served)
						await page.route(url, (route) =>
							route.fulfill({
								contentType: "text/html",
								body: attackPage(fill(a.link), fill(a.files), mark),
							}),
						);
					const heard = [];
					page.on("console", (m) =>
						heard.push(
							m
								.text()
								.replace(/\d{4,5}/g, "<port>")
								.slice(0, 200),
						),
					);
					await page.goto(url);
					const r = await until(
						`${a.name} to finish`,
						() => page.evaluate(() => window.__r),
						(x) => x.fetch !== null && (x.closed !== null || x.typed),
						120,
						50,
					);
					await page.waitForTimeout(400);
					const typed = (await screenOf(person, "t1")).includes(`${mark}\n`);
					// What the door said, if it refused: the newest line of its log, read after the try.
					const said = (
						desk
							.log()
							.slice(logAt)
							.match(/refused: [^\n]*/g) ?? []
					).map((s) => s.replace(/\d{4,5}/g, "<port>"));
					logAt = desk.log().length;
					rows.push({
						browser: mode.name,
						guards,
						attacker: a.name,
						heard: heard.filter((h) => !h.startsWith("Failed to load")).slice(0, 2),
						open: r.open,
						read: r.read,
						typed,
						fetch: r.fetch,
						closed: r.closed,
						said,
					});
					console.log(
						`${mode.name.padEnd(10)} ${guards.padEnd(18)} ${a.name.padEnd(16)} ${typed ? "IN: typed into tsh" : r.read ? "IN: read a screen" : r.open ? "opened, read nothing" : `refused (${r.closed})`}; files ${r.fetch}; door: ${said.join(" | ") || "-"}; page: ${heard.find((h) => !h.startsWith("Failed to load")) ?? "-"}`,
					);
					await page.close();
				}
				// Any program on the laptop: raw requests, setting whatever headers it likes.
				const good = {host: `127.0.0.1:${desk.port}`, origin: `http://127.0.0.1:${desk.port}`};
				const programs = [
					{name: "program, no cookie", status: await upgrade(desk.port, {...good, cookie: null})},
					{name: "program, the cookie", status: await upgrade(desk.port, {...good, cookie})},
					{
						name: "program, foreign Host",
						status: await upgrade(desk.port, {...good, host: `evil.example:${desk.port}`, cookie}),
					},
					{
						name: "program, no Origin",
						status: await upgrade(desk.port, {...good, origin: null, cookie}),
					},
					{
						name: "files, foreign Host",
						status: await raw(desk.port, [
							"GET /desk.html HTTP/1.1",
							`Host: evil.example:${desk.port}`,
							`Cookie: ${cookie}`,
						]),
					},
					{
						name: "a wrong token",
						status: await raw(desk.port, [
							`GET /?token=${"0".repeat(64)} HTTP/1.1`,
							`Host: 127.0.0.1:${desk.port}`,
						]),
					},
				];
				for (const p of programs) {
					rows.push({browser: mode.name, guards, attacker: p.name, status: p.status});
					console.log(
						`${mode.name.padEnd(10)} ${guards.padEnd(18)} ${p.name.padEnd(22)} ${p.status}`,
					);
				}
				await context.close();
			} finally {
				await b.close();
				rows.push({
					browser: mode.name,
					guards,
					refusals: (desk.log().match(/refused: [^\n(]*/g) ?? []).length,
				});
				await desk.stop();
			}
		}
	await other.close();
	mkdirSync(RAW, {recursive: true});
	writeFileSync(join(RAW, "safety.json"), JSON.stringify(rows, null, 1));
	check("nothing of this run left: no host, no door", pgrep(BUILDS) === "", pgrep(BUILDS));
};

// ---------------------------------------------------------------------------------------------
// typing: key to screen, by experiment 143's method, in Electron and in the tab. The page's own
// probes (the probes patch, 143's) time each key on the page's one clock: the key event's
// timeStamp, the keys sent, the echo heard, its draw, and the frame after the draw. Headless
// Chromium has no screen, so "on screen" here is the frame after the draw, in both; 143 measured
// the rest, the frame to the glass, with a trace (about 26 ms at 60 Hz), and it is the same
// Chromium in both.

const KEYS = Number(process.env.KEYS ?? 250);
const SEED = 150;
/** Chromium switches a window that is not the active one needs to keep drawing (143). */
const KEEP_DRAWING = [
	"disable-backgrounding-occluded-windows",
	"disable-renderer-backgrounding",
	"disable-background-timer-throttling",
];

const quantile = (xs, q) => {
	const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	return s.length === 0 ? null : s[Math.max(0, Math.ceil(q * s.length) - 1)];
};
const round = (x, d = 1) =>
	x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d;
const summary = (xs) => {
	const ok = xs.filter((x) => Number.isFinite(x));
	return {n: ok.length, p50: round(quantile(ok, 0.5)), p95: round(quantile(ok, 0.95))};
};
/** A small seeded random, so every run waits the same gaps (143's). */
const seeded = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The keys of one run: letters, and Ctrl-U every 25 so the line stays on one row (143's). */
const planKeys = (timed) => {
	const plan = [];
	let inLine = 0;
	let letters = 0;
	while (letters < timed) {
		if (inLine === 25) {
			plan.push({key: "Control+u", timed: false});
			inLine = 0;
			continue;
		}
		plan.push({key: "abcdefghijklmnopqrstuvwxyz"[letters % 26], timed: true});
		letters += 1;
		inLine += 1;
	}
	plan.push({key: "Control+u", timed: false});
	return plan;
};

/** Animation frame gaps over `ms`, in the page. */
const frameGaps = (page, ms) =>
	page.evaluate(
		(ms) =>
			new Promise((resolve) => {
				const gaps = [];
				let last = performance.now();
				const end = last + ms;
				const tick = (now) => {
					gaps.push(now - last);
					last = now;
					if (now < end) requestAnimationFrame(tick);
					else resolve(gaps);
				};
				requestAnimationFrame(tick);
			}),
		ms,
	);

/**
 * In the page: a promise per key, kept at the frame after the host's echo is drawn (143's). A
 * local echo draws first, before the host's answer is heard; the key is done at the host's.
 */
const armPage = (page) =>
	page.evaluate(() => {
		const probes = window.__x143;
		let keep = null;
		let heard = false;
		let timer = 0;
		window.__x143arm = () => {
			heard = false;
			window.__x143wait = new Promise((resolve) => {
				keep = resolve;
				timer = setTimeout(() => {
					keep = null;
					resolve("timeout");
				}, 3000);
			});
		};
		probes.after = (name) => {
			if (name === "recv") heard = true;
			if (name !== "frame" || !heard || keep === null) return;
			clearTimeout(timer);
			const k = keep;
			keep = null;
			k("ok");
		};
	});

const typeKeys = async (page, plan, seed) => {
	const gap = seeded(seed);
	let timeouts = 0;
	for (const {key} of plan) {
		await page.evaluate(() => window.__x143arm());
		await page.keyboard.press(key);
		if ((await page.evaluate(() => window.__x143wait)) === "timeout") timeouts += 1;
		await page.waitForTimeout(30 + Math.floor(gap() * 61));
	}
	return timeouts;
};

/** One run's keys, typed into t1 of a page on the desk, with every probe row the page kept. */
const measure = async (page) => {
	// Over the proxy, the page's 2 MB bundle comes in chunks each held half a round trip, and the
	// machine is shared: the first tile may take more than the 2 s a check waits.
	await tileOf(page, "t1").locator(".screen-text").waitFor({timeout: 30_000});
	await prompted(page, "t1");
	const gaps = await frameGaps(page, 1000);
	await armPage(page);
	// Warm up, then start the list from nothing.
	await typeKeys(page, planKeys(10), SEED + 1);
	await page.evaluate(() => {
		window.__x143.rows.length = 0;
	});
	const plan = planKeys(KEYS);
	const load = [round(loadavg()[0], 2)];
	const started = Date.now();
	const timeouts = await typeKeys(page, plan, SEED);
	const took = Date.now() - started;
	load.push(round(loadavg()[0], 2), cpus().length);
	const rows = await page.evaluate(() => window.__x143.rows);
	const dpr = await page.evaluate(() => window.devicePixelRatio);
	// Every key's echo landed, and the last Ctrl-U left an empty line: a local echo that guessed
	// wrong would show here.
	const last = lastRow(await screenOf(page, "t1"));
	return {
		frameMs: round(quantile(gaps, 0.5), 2),
		timeouts,
		took,
		load,
		dpr,
		last,
		plan,
		page: rows,
	};
};

/** The host this home's app started, if it runs one of this run's copies: stopped. */
const stopHostOf = async (home) => {
	const pid = pidIn(join(home, "host/pid"));
	if (pid === null || !alive(pid)) return;
	const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {encoding: "utf8"});
	if (!command.includes(BUILDS)) throw new Error(`pid ${pid} is not this run's host: left alone`);
	await stopPid(pid);
};

/** The desk in Electron, quiet as 143 opened it: never the active app, never the key window. */
const inElectron = async (copy) => {
	const home = await freshHome();
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [appOf(copy), ...KEEP_DRAWING.map((s) => `--${s}`)],
		env: {...cleanEnv, FABRIKA_HOME: home, X143_TILE: "t1", X143_QUIET: "1"},
	});
	const pid = app.process().pid;
	try {
		const page = await app.firstWindow();
		await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setFocusable(false));
		// The page believes it has focus, so the focused tile's keys work (143).
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Emulation.setFocusEmulationEnabled", {enabled: true});
		const run = await measure(page);
		const focused = await app.evaluate(
			({BrowserWindow}) => BrowserWindow.getFocusedWindow() !== null,
		);
		return {...run, focused};
	} finally {
		await Promise.race([app.close().catch(() => {}), sleep(5000)]);
		if (alive(pid)) process.kill(pid, "SIGKILL");
		await stopHostOf(home);
		rmSync(home, {recursive: true, force: true});
	}
};

/**
 * The desk in a headless tab, through the delay proxy when `rtt` > 0: the page, its files and its
 * WebSocket all come through it, as over a network of that round trip. The tab's size and pixel
 * ratio are the Electron window's.
 */
const inTab = async (copy, rtt, dpr) => {
	const proxy = rtt > 0 ? await delayProxy(rtt) : null;
	const desk = await startDesk(copy, {hosts: proxy === null ? [] : [`127.0.0.1:${proxy.port}`]});
	proxy?.to(desk.port);
	const b = await browser();
	try {
		const page = await b.newPage({viewport: {width: 1200, height: 760}, deviceScaleFactor: dpr});
		const said = [];
		page.on("console", (m) => said.push(`${m.type()}: ${m.text()}`));
		page.on("pageerror", (e) => said.push(`error: ${e.message}`));
		const url = new URL(desk.url);
		if (proxy !== null) url.port = String(proxy.port);
		await page.goto(url.href);
		try {
			return {...(await measure(page)), focused: false};
		} catch (cause) {
			mkdirSync(shots, {recursive: true});
			await shot(page, `typing-${rtt}-${copy}-failed`).catch(() => {});
			console.log(`failed: the page said ${JSON.stringify(said)}; the door said ${desk.log()}`);
			throw cause;
		}
	} finally {
		await b.close();
		await proxy?.close();
		await desk.stop();
	}
};

/** Rows cut into one group per key: each group starts at a row named `start` (143's). */
const groups = (rows, start, accept = () => true) => {
	const out = [];
	for (const row of rows ?? []) {
		if (row[0] === start && accept(row)) out.push([]);
		if (out.length > 0) out.at(-1).push(row);
	}
	return out;
};
/** The time of the first row named `name` in a group, after the time `after`. */
const at = (group, name, after = Number.NEGATIVE_INFINITY, note) =>
	group?.find((r) => r[0] === name && r[1] >= after && (note === undefined || r[2] === note))?.[1];
const minus = (a, b) => (a === undefined || b === undefined ? undefined : a - b);

/**
 * Each timed key of a run: from the key event to the frame after the first draw that shows it
 * (`first`: the local echo's when there is one), and to the frame after the host's echo is drawn
 * (`host`). `trip` is the keys sent to the echo heard: the link's round trip, host included.
 */
const keysOf = (raw) => {
	// Ctrl-U is two keydowns, Control's and u's: the key is u's.
	const pages = groups(raw.page, "down", (r) => r[2]?.[1] !== "Control");
	const out = [];
	raw.plan.forEach((p, i) => {
		const g = pages[i];
		if (!p.timed || g === undefined) return;
		const stamp = g[0][2]?.[0];
		const down = at(g, "down");
		const data = at(g, "data", down);
		const recv = at(g, "recv", data);
		const parsed = at(g, "parsed", recv);
		const hostDraw = at(g, "draw1", at(g, "draw0", parsed, true), true);
		const firstDraw = at(g, "draw1", down, true);
		out.push({
			first: minus(at(g, "frame", firstDraw), stamp),
			host: minus(at(g, "frame", hostDraw), stamp),
			trip: minus(recv, data),
			draw: minus(hostDraw, at(g, "draw0", parsed, true)),
			local: at(g, "local") === undefined ? 0 : 1,
		});
	});
	return {aligned: pages.length === raw.plan.length, keys: out};
};

const WHERES = list("WHERES", "electron,tab0,tab30,tab80");
const TYPED = list("COPIES", "base,f2,f24");
const typingFile = (where, copy, tag) => join(RAW, `typing.${where}.${copy}${tag}.json`);

const runTyping = async () => {
	mkdirSync(RAW, {recursive: true});
	const tag = process.env.TAG ? `.${process.env.TAG}` : "";
	// The tab is given the Electron window's pixel ratio, read once from a quiet Electron run.
	let dpr = Number(process.env.DPR ?? 0);
	// The copies take turns inside each place, so a machine that gets busier over the run moves
	// each copy alike.
	for (const where of WHERES)
		for (const copy of TYPED) {
			const rtt = where === "electron" ? null : Number(where.slice(3));
			if (rtt !== null && dpr === 0) dpr = 2;
			const raw = {
				where,
				copy,
				rtt,
				...(rtt === null ? await inElectron(copy) : await inTab(copy, rtt, dpr)),
			};
			if (rtt === null) dpr = raw.dpr;
			writeFileSync(typingFile(where, copy, tag), JSON.stringify(raw));
			const {aligned, keys} = keysOf(raw);
			const first = summary(keys.map((k) => k.first));
			const host = summary(keys.map((k) => k.host));
			const trip = summary(keys.map((k) => k.trip));
			console.log(
				`${where.padEnd(8)} ${copy.padEnd(4)} first ${first.p50}/${first.p95}, host ${host.p50}/${host.p95}, trip ${trip.p50}/${trip.p95} ms (p50/p95); frame ${raw.frameMs} ms, dpr ${raw.dpr}, timeouts ${raw.timeouts}, aligned ${aligned}, last row ${JSON.stringify(raw.last)}, focused ${raw.focused}, load ${raw.load.join("/")}, ${Math.round(raw.took / 1000)} s`,
			);
		}
	check("nothing of this run left: no host, no door, no app", pgrep(BUILDS) === "", pgrep(BUILDS));
};

// ---------------------------------------------------------------------------------------------
// report: the results file, from the raw files of the runs above.

const runReport = () => {
	const read = (file) => JSON.parse(readFileSync(join(RAW, file), "utf8"));
	const typing = [];
	for (const file of readdirSync(RAW).sort()) {
		if (!file.startsWith("typing.")) continue;
		const raw = read(file);
		const {aligned, keys} = keysOf(raw);
		const row = {
			run: file.slice("typing.".length, -".json".length),
			where: raw.where,
			copy: raw.copy,
			rtt: raw.rtt,
			first: summary(keys.map((k) => k.first)),
			host: summary(keys.map((k) => k.host)),
			trip: summary(keys.map((k) => k.trip)),
			draw: summary(keys.map((k) => k.draw)),
			localShare: round(keys.reduce((n, k) => n + k.local, 0) / Math.max(1, keys.length), 3),
			frameMs: raw.frameMs,
			dpr: raw.dpr,
			timeouts: raw.timeouts,
			aligned,
			last: raw.last,
			focused: raw.focused,
			load: raw.load,
		};
		typing.push(row);
		console.log(
			`${row.run.padEnd(18)} first ${row.first.p50}/${row.first.p95}  host ${row.host.p50}/${row.host.p95}  trip ${row.trip.p50}/${row.trip.p95}  draw ${row.draw.p50}  local ${row.localShare}  frame ${row.frameMs}`,
		);
	}
	const results = {
		experiment: 150,
		commit: COMMIT,
		keys: KEYS,
		check: existsSync(join(RAW, "check.json")) ? read("check.json") : null,
		safety: existsSync(join(RAW, "safety.json")) ? read("safety.json") : null,
		typing,
	};
	writeFileSync(RESULTS, `${JSON.stringify(results, null, 1)}\n`);
	console.log(`wrote ${RESULTS.slice(root.length + 1)}`);
};

/** The pids whose command line names `what`, as pgrep finds them, or "". */
const pgrep = (what) => {
	try {
		return execFileSync("pgrep", ["-f", what], {encoding: "utf8"}).trim();
	} catch {
		return "";
	}
};

// ---------------------------------------------------------------------------------------------
// Commands

const [command = "", ...rest] = process.argv.slice(2);
if (command === "build") {
	for (const copy of rest.length > 0 ? rest : Object.keys(COPIES)) await build(copy);
} else if (command === "serve") {
	// For a person, by hand: a host and a door on a fresh home, until Enter.
	const desk = await startDesk(rest[0] ?? "base");
	console.log(desk.url);
	process.stdin.once("data", () => desk.stop().then(() => process.exit(0)));
} else if (command === "check") {
	await runCheck();
} else if (command === "safety") {
	await runSafety();
} else if (command === "typing") {
	await runTyping();
} else if (command === "report") {
	runReport();
} else {
	throw new Error(`no command ${command}: build, check, safety, typing, report`);
}
