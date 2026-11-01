// Experiment 176's bench: today's version of the fabrika app (apps/fabrika), built, driven by
// Playwright on Electron, on a home of its own in a temp folder. One script, one output shape: every
// number the write-up uses is a row of experiments/results/176-bench.jsonl, in the `Sample` shape
// below. The `perf` program (tracker #114) is meant to start from this file.
//
//   node experiments/176-bench.ts build <label>                  today's checkout into runs/exp-176/dist/<label>
//   node experiments/176-bench.ts build <label> --root <dir>     another checkout's app, as that copy
//   node experiments/176-bench.ts build <label> --compile        with React Compiler (needs its packages)
//   node experiments/176-bench.ts run <label> <moment> ...       measure, append rows
//   node experiments/176-bench.ts open <label>                   open that copy on a temp home, to look at it
//   node experiments/176-bench.ts list                           the moments
//
// A bench build is the real build (apps/fabrika/build.ts), plus two lines of probe in desk.js only: a
// banner that holds React's devtools hook (it reads fibers, so it counts real renders in a production
// build, with no code in the app), and one `performance.mark` where a host message lands. Nothing else
// differs, and the probe does no work between commits but a counter.
//
// The app starts quiet (a FABRIKA_HOME start, launch.ts): no Dock icon, never the active app. Keys come
// through Chromium's protocol. `gh` sees a config folder of its own, so the tracker's pull request read
// fails and says so, and no account is touched. No model, no key, $0.
//
// Headless numbers from one machine: read them against each other, not as absolutes.

import {execFile, execFileSync, spawn} from "node:child_process";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {arch, cpus, release, tmpdir, totalmem} from "node:os";
import {join, resolve} from "node:path";

const root = join(import.meta.dirname, "..");
const appDir = join(root, "apps/fabrika");
const require = createRequire(join(appDir, "package.json"));
const {_electron} = require("playwright");
const electronPath: string = require("electron");
const esbuild = require("esbuild");

const WORK = join(root, "runs/exp-176");
const DISTS = join(WORK, "dist");
const RESULTS = join(root, "experiments/results/176-bench.jsonl");
const SHOTS = join(root, "experiments/176-react-on-the-real-app");

/** The probe, in the page (PROBE, below), and the loop monitor, in main. */
declare const __probe: any;
declare const __loop: any;

// ---------------------------------------------------------------- the one output shape

export interface Sample {
	readonly bench: 1;
	/** What was measured: "cold-start", "keystroke-echo", "workspace-switch", "open-ticket", ... */
	readonly moment: string;
	/** The copy of the app: the label given to `build`. */
	readonly variant: string;
	readonly commit: string;
	/** Did the working tree differ from that commit when the copy was built? */
	readonly dirty: boolean;
	/** When it ran, ISO. */
	readonly at: string;
	/** Never a host name or a user name. */
	readonly machine: {
		readonly cpu: string;
		readonly cores: number;
		readonly memGb: number;
		readonly os: string;
		readonly arch: string;
		readonly electron: string;
		readonly chrome: string;
	};
	/** What was open: how many tiles, and which programs. `null` is a tile's bare terminal. */
	readonly desk: {
		readonly tiles: number;
		readonly workspaces: number;
		readonly programs: readonly (string | null)[];
	};
	/** The moment's own time, in ms, per event. */
	readonly ms: {
		readonly n: number;
		readonly p50: number;
		readonly p95: number;
		readonly max: number;
	} | null;
	/** Long animation frames in the page during the moment. */
	readonly loaf: {readonly count: number; readonly worstMs: number};
	/** Per process, from Electron's `app.getAppMetrics()`, and `ps` for the host, its own process. */
	readonly processes: readonly {
		readonly type: string;
		readonly cpuPct: number;
		readonly memMb: number;
	}[];
	/** The main process's event loop delay during the moment. */
	readonly mainLoop: {readonly p50Ms: number; readonly p99Ms: number};
	/** React's renders during the moment, from fibers. `events`: how many times the moment ran. */
	readonly renders: {
		readonly events: number;
		readonly commits: number;
		readonly total: number;
		readonly outside: number;
		readonly perTile: Readonly<Record<string, number>>;
		/** Times the tile's own component ran, per tile: a `memo` that skips leaves this at 0. */
		readonly tileShell: Readonly<Record<string, number>>;
	};
	/** What only this moment knows. */
	readonly facts: Readonly<Record<string, unknown>>;
}

const quantile = (sorted: readonly number[], q: number) =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const round = (n: number) => Math.round(n * 100) / 100;
export const summary = (values: readonly number[]) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		p50: round(quantile(sorted, 0.5)),
		p95: round(quantile(sorted, 0.95)),
		max: round(sorted.at(-1) ?? 0),
	};
};

// ---------------------------------------------------------------- the probe, in desk.js only

/**
 * Prepended to desk.js, so it is there before React. React calls the hook on each commit; a walk that
 * stops where a subtree bailed out (its `child` is the same object as its alternate's, as React DevTools
 * reads it) counts each component that really ran. Tags: 0 function, 1 class, 11 forwardRef, 14 memo,
 * 15 simple memo. `flags & 1` is React's PerformedWork, set in production too.
 */
const PROBE = String.raw`(() => {
	const COMPONENT = new Set([0, 1, 11, 14, 15]);
	const fresh = () => ({commits: 0, total: 0, outside: 0, perTile: {}, tileShell: {}, commitTimes: []});
	let now = fresh();
	let lastRoot = null;
	const visit = (f, tile, owner) => {
		for (let c = f; c !== null; c = c.sibling) {
			let at = tile;
			let by = owner;
			const prev = c.alternate;
			const ran = COMPONENT.has(c.tag) && (prev === null || (c.flags & 1) === 1);
			if (COMPONENT.has(c.tag)) by = {ran};
			if (c.tag === 5 && c.memoizedProps && c.memoizedProps["data-tile"] !== undefined) {
				at = c.memoizedProps["data-tile"];
				if (owner && owner.ran) now.tileShell[at] = (now.tileShell[at] ?? 0) + 1;
			}
			if (ran) {
				now.total += 1;
				if (at === null) now.outside += 1;
				else now.perTile[at] = (now.perTile[at] ?? 0) + 1;
			}
			if (c.child !== null && !(prev !== null && prev.child === c.child)) visit(c.child, at, by);
		}
	};
	window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
		isDisabled: false,
		supportsFiber: true,
		renderers: new Map(),
		inject: () => 1,
		checkDCE: () => {},
		onScheduleFiberRoot: () => {},
		onCommitFiberUnmount: () => {},
		onPostCommitFiberRoot: () => {},
		onCommitFiberRoot: (_id, root) => {
			lastRoot = root;
			now.commits += 1;
			now.commitTimes.push(performance.now());
			visit(root.current, null, null);
		},
	};
	let loaf = {count: 0, worstMs: 0};
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) {
			loaf.count += 1;
			loaf.worstMs = Math.max(loaf.worstMs, e.duration);
		}
	}).observe({type: "long-animation-frame", buffered: true});
	let framesOn = false;
	let frames = [];
	const onFrame = (t) => {
		if (!framesOn) return;
		frames.push(t);
		requestAnimationFrame(onFrame);
	};
	const keys = [];
	window.addEventListener("keydown", (e) => { keys.push({key: e.key, t: performance.now()}); }, {capture: true});
	window.addEventListener("pointerdown", () => { keys.push({key: "pointer", t: performance.now()}); }, {capture: true});
	const hook = {
		/** A start that is no key or press: the next keyToDom counts from here. */
		stamp: () => keys.push({key: "stamp", t: performance.now()}),
		/** When this holds of the page: the DOM's time, and the next frame's. Checked on each change. */
		whenDom: (source, ms) =>
			new Promise((done) => {
				const holds = new Function("return (" + source + ")");
				let over = false;
				const end = (dom) => {
					if (over) return;
					over = true;
					seen.disconnect();
					clearTimeout(timer);
					if (dom === null) return done(null);
					requestAnimationFrame(() => done({dom, frame: performance.now()}));
				};
				const seen = new MutationObserver(() => { if (holds()) end(performance.now()); });
				seen.observe(document, {childList: true, subtree: true, characterData: true, attributes: true});
				const timer = setTimeout(() => end(null), ms);
				if (holds()) end(performance.now());
			}),
		/** The run a tile shows, read from what React was given: tiles' run ids are not in the DOM. */
		runIn: (tile) => {
			let found = null;
			const walk = (f, at) => {
				for (let c = f; c !== null && found === null; c = c.sibling) {
					const here = c.tag === 5 && c.memoizedProps && c.memoizedProps["data-tile"] !== undefined ? c.memoizedProps["data-tile"] : at;
					if (here === tile && c.memoizedProps && typeof c.memoizedProps.run === "string") found = c.memoizedProps.run;
					if (c.child !== null) walk(c.child, here);
				}
			};
			if (lastRoot !== null) walk(lastRoot.current, null);
			return found;
		},
		reset: () => {
			now = fresh();
			loaf = {count: 0, worstMs: 0};
			keys.length = 0;
			performance.clearMarks("fabrika:heard");
		},
		read: () => ({
			...now,
			loaf,
			keys: [...keys],
			heard: performance.getEntriesByName("fabrika:heard").map((m) => m.startTime),
		}),
		framesStart: () => {
			frames = [];
			framesOn = true;
			requestAnimationFrame(onFrame);
		},
		framesStop: () => {
			framesOn = false;
			return frames;
		},
		/** The time of the next change under this selector's element, or of the timeout. */
		changeOf: (selector, ms) =>
			new Promise((done) => {
				const el = document.querySelector(selector);
				if (el === null) return done(null);
				const seen = new MutationObserver(() => {
					seen.disconnect();
					done(performance.now());
				});
				seen.observe(el, {childList: true, subtree: true, characterData: true, attributes: true});
				setTimeout(() => {
					seen.disconnect();
					done(null);
				}, ms);
			}),
	};
	Object.defineProperty(window, "__probe", {value: hook});
})();`;

/** Where the page hears the host: the one line of probe inside the app's own code. */
const HEARD_FROM = "const heard = (raw: unknown) => {";
const HEARD_TO = `${HEARD_FROM} performance.mark("fabrika:heard");`;

const run = (cmd: string, args: readonly string[], cwd: string) =>
	execFileSync(cmd, [...args], {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();

/** Babel with React Compiler, over a window's file. Loaded only for --compile. */
const compilerPlugin = (
	appRoot: string,
	seen: {compiled: number; failed: number; files: number},
) => {
	const babel = require("@babel/core");
	const compiler = require.resolve("babel-plugin-react-compiler");
	return {
		name: "react-compiler",
		setup(build: any) {
			build.onLoad({filter: /\.tsx$/}, (args: any) => {
				if (args.path.includes("node_modules")) return undefined;
				const source = readFileSync(args.path, "utf8");
				seen.files += 1;
				const out = babel.transformSync(probed(args.path, source), {
					filename: args.path,
					babelrc: false,
					configFile: false,
					parserOpts: {plugins: ["jsx", "typescript"]},
					plugins: [
						[
							compiler,
							{
								target: "19",
								logger: {
									logEvent: (_file: string, event: any) => {
										if (event.kind === "CompileSuccess") seen.compiled += 1;
										else if (event.kind === "CompileError") {
											seen.failed += 1;
											console.log(
												`compile failed in ${args.path.replace(`${appRoot}/`, "")}: ${event.fnLoc?.start?.line}: ${String(event.detail?.reason ?? event.detail?.options?.reason ?? "").slice(0, 120)}`,
											);
										}
									},
								},
							},
						],
					],
				});
				return {contents: out.code, loader: "tsx"};
			});
		},
	};
};

const probed = (path: string, source: string) => {
	if (!path.endsWith("window/desk.tsx")) return source;
	if (!source.includes(HEARD_FROM)) throw new Error("desk.tsx has no `heard` to mark");
	return source.replace(HEARD_FROM, HEARD_TO);
};

const benchBuild = async (label: string, from: string, compile: boolean, dev = false) => {
	const app = join(from, "apps/fabrika");
	const started = performance.now();
	run(process.execPath, ["build.ts"], app);
	const plainMs = performance.now() - started;
	const out = join(DISTS, label);
	rmSync(out, {recursive: true, force: true});
	mkdirSync(DISTS, {recursive: true});
	cpSync(join(app, "dist"), out, {recursive: true});
	const {bundlesOf, common} = await import(join(app, "bundles.ts"));
	const desk = bundlesOf((...parts: string[]) => join(app, ...parts)).find((b: any) =>
		String(b.outfile).endsWith("desk.js"),
	);
	const seen = {compiled: 0, failed: 0, files: 0};
	const plugins = compile
		? [compilerPlugin(app, seen)]
		: [
				{
					name: "probe",
					setup(build: any) {
						build.onLoad({filter: /window\/desk\.tsx$/}, (args: any) => ({
							contents: probed(args.path, readFileSync(args.path, "utf8")),
							loader: "tsx",
						}));
					},
				},
			];
	const deskStarted = performance.now();
	await esbuild.build({
		...common(app),
		...desk,
		outfile: join(out, "desk.js"),
		define: {
			...desk.define,
			FABRIKA_BUILD: JSON.stringify(label),
			...(dev ? {"process.env.NODE_ENV": '"development"'} : {}),
		},
		...(dev ? {minify: false} : {}),
		banner: {js: PROBE},
		plugins,
	});
	const deskMs = performance.now() - deskStarted;
	// With --dev the app's own dist/ gets the same page, so its e2e runs on React's development build.
	if (dev) cpSync(join(out, "desk.js"), join(app, "dist/desk.js"));
	const commit = run("git", ["rev-parse", "HEAD"], from);
	const dirty =
		run("git", ["status", "--porcelain", "--", "apps", "programs", "packages"], from) !== "";
	writeFileSync(
		join(out, "bench.json"),
		JSON.stringify({
			label,
			commit,
			dirty,
			compile,
			deskMs: round(deskMs),
			plainMs: round(plainMs),
			seen,
		}),
	);
	console.log(
		`built ${label} at ${commit.slice(0, 7)}${dirty ? "+dirty" : ""}, desk.js in ${round(deskMs)} ms`,
		seen,
	);
};

// ---------------------------------------------------------------- the app, driven

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const waitFor = async <T>(
	what: string,
	look: () => Promise<T>,
	ok: (seen: T) => boolean,
	ms = 20000,
) => {
	const end = performance.now() + ms;
	let seen = await look();
	while (!ok(seen)) {
		if (performance.now() > end) throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
		await sleep(20);
		seen = await look();
	}
	return seen;
};

export interface Bench {
	readonly app: any;
	readonly page: any;
	readonly label: string;
	readonly home: string;
	/** ms from launch to the window's first prompt. */
	readonly coldMs: number;
}

/** What the page said at warning or error level in this run. */
const consoleLines: string[] = [];

const hostPidOf = (home: string) => {
	try {
		return Number.parseInt(readFileSync(join(home, "host", "pid"), "utf8"), 10);
	} catch {
		return null;
	}
};

/** Open a copy of the app on a fresh temp home, and leave no host behind. */
export const withApp = async <T>(
	label: string,
	use: (b: Bench) => Promise<T>,
	options: {readonly width?: number; readonly height?: number} = {},
): Promise<T> => {
	const dist = join(DISTS, label);
	if (!existsSync(join(dist, "main.mjs"))) throw new Error(`no copy ${label}: build it first`);
	const home = mkdtempSync(join(tmpdir(), "fabrika-176-"));
	mkdirSync(join(home, "gh"));
	const env: Record<string, string | undefined> = {
		...process.env,
		FABRIKA_HOME: home,
		GH_CONFIG_DIR: join(home, "gh"),
	};
	delete env.GH_TOKEN;
	delete env.GITHUB_TOKEN;
	const started = performance.now();
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [join(dist, "main.mjs")],
		env,
	});
	try {
		await app.evaluate(({shell}: any) => {
			shell.openExternal = async () => {};
		});
		const page = await app.firstWindow();
		page.on("console", (m: any) => {
			if (m.type() === "error" || m.type() === "warning")
				consoleLines.push(`${m.type()}: ${m.text()}`);
		});
		page.on("pageerror", (e: Error) => consoleLines.push(`pageerror: ${e.message}`));
		await page.waitForFunction(
			() => {
				const t = document.querySelector('[data-tile="t1"] .screen-text');
				return t?.textContent?.split("\n").at(-1) === "tsh$";
			},
			null,
			{timeout: 60000},
		);
		const coldMs = performance.now() - started;
		await app.evaluate(({BrowserWindow}: any, size: any) => {
			if (size.width !== undefined)
				BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
			const {monitorEventLoopDelay} = process.getBuiltinModule("node:perf_hooks");
			const loop = monitorEventLoopDelay({resolution: 1});
			loop.enable();
			Object.assign(globalThis, {__loop: loop});
		}, options);
		return await use({app, page, label, home, coldMs});
	} finally {
		const pid = hostPidOf(home);
		await app.close().catch(() => {});
		if (pid !== null && !Number.isNaN(pid)) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {}
		}
		await sleep(300);
		rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
	}
};

const screen = (b: Bench, id: string): Promise<string> =>
	b.page
		.locator(`[data-tile="${id}"] .screen-text`)
		.textContent({timeout: 4000})
		.then((t: string | null) => t ?? "");
const lastRow = (t: string) => t.split("\n").at(-1) ?? "";

/** Ctrl-B, then a key: the desk's prefix. */
export const prefixed = async (b: Bench, key: string) => {
	await b.page.keyboard.press("Control+b");
	await b.page.keyboard.press(key);
};

export const tilesNow = (b: Bench): Promise<string[]> =>
	b.page
		.locator("[data-tile]")
		.evaluateAll((all: any[]) => all.map((t) => t.getAttribute("data-tile")));
/** The tiles a person can see now: a hidden one may stay in the DOM. */
export const visibleTiles = (b: Bench): Promise<string[]> =>
	b.page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>("[data-tile]")]
			.filter((t) => t.checkVisibility())
			.flatMap((t) => (t.dataset.tile === undefined ? [] : [t.dataset.tile])),
	);
const focusedNow = (b: Bench): Promise<string | null> =>
	b.page.evaluate(
		() =>
			[...document.querySelectorAll<HTMLElement>('[data-tile][aria-current="true"]')]
				.find((t) => t.checkVisibility())
				?.getAttribute("data-tile") ?? null,
	);
/** The tile whose window is this program. */
export const tileShowing = async (b: Bench, program: string): Promise<string> => {
	const found: string | null = await b.page.evaluate((p: string) => {
		const view = [...document.querySelectorAll(`[aria-label="${p} view"]`)].find((v) =>
			v.checkVisibility(),
		);
		return view?.closest("[data-tile]")?.getAttribute("data-tile") ?? null;
	}, program);
	if (found === null) throw new Error(`no tile shows ${program}`);
	return found;
};
export const focusIs = (b: Bench, id: string) =>
	waitFor(
		`focus on ${id}`,
		() => focusedNow(b),
		(f) => f === id,
	);
export const prompted = (b: Bench, id: string) =>
	waitFor(
		`${id} at its prompt`,
		() => screen(b, id),
		(t) => lastRow(t) === "tsh$",
	);

/** Split the focused tile: answers the new tile, focused, at its prompt. */
export const split = async (b: Bench, key: "|" | "-") => {
	const before = await tilesNow(b);
	await prefixed(b, key);
	const after = await waitFor(
		"the new tile",
		() => tilesNow(b),
		(t) => t.length === before.length + 1,
	);
	const fresh = after.find((t) => !before.includes(t));
	if (fresh === undefined) throw new Error("no new tile");
	await focusIs(b, fresh);
	await prompted(b, fresh);
	return fresh;
};

export const focusTile = async (b: Bench, id: string) => {
	await b.page.locator(`[data-tile="${id}"] .titlebar`).click();
	await focusIs(b, id);
};

/** Send a whole line to a tile's tsh on its own port: the real path, without typing each key. */
export const lineTo = (b: Bench, tile: string, line: string) =>
	b.page.evaluate(
		([t, l]: string[]) => window.fabrika.send(`tile:${t}`, {type: "keys", data: `${l}\r`}),
		[tile, line],
	);

export const programIn = (b: Bench, tile: string, program: string) =>
	b.page.locator(`[data-tile="${tile}"] [aria-label="${program} view"]`).waitFor({timeout: 20000});

// ---------------------------------------------------------------- what is open

export const LONG_MARKDOWN = (blocks: number, salt = "") =>
	Array.from({length: blocks}, (_, i) =>
		i % 10 === 0
			? `## Part ${i} ${salt}`
			: i % 7 === 0
				? `- one **thing** ${i}\n- another \`thing\` ${i}`
				: `Paragraph ${i} with *some* words, a [link](https://example.com/${i}), and more plain words after that.`,
	).join("\n\n");

/** Tell a markdown window a whole text, on its run's port: the program's own `text` input. */
export const tellMarkdown = (b: Bench, tile: string, text: string) =>
	b.page.evaluate(
		([t, value]: string[]) => {
			const run = __probe.runIn(t);
			window.fabrika.send(`run:${run}`, {type: "msg", msg: {type: "text", value}});
		},
		[tile, text],
	);

/** File a ticket in a tracker's window, with `comments` comments. */
const fileTicket = async (b: Bench, tile: string, title: string) => {
	const tracker = b.page.locator(`[data-tile="${tile}"]`).getByLabel("tracker view");
	await tracker.getByLabel("new ticket title").fill(title);
	await tracker.getByLabel("new ticket body").fill(`The body of ${title}.`);
	await tracker.getByRole("button", {name: "File ticket"}).click();
	await tracker.getByRole("button", {name: new RegExp(title)}).waitFor({timeout: 10000});
};

/** The five windows the picks ask for: tracker, ticket, markdown, map, and a bare terminal. */
export const fiveWindows = async (b: Bench, markdownBlocks = 200) => {
	const t1 = "t1";
	const t2 = await split(b, "|");
	const t3 = await split(b, "-");
	await focusTile(b, t1);
	const t4 = await split(b, "-");
	await focusTile(b, t2);
	const t5 = await split(b, "|");
	await focusTile(b, t1);
	await lineTo(b, t1, "tracker");
	await programIn(b, t1, "tracker");
	await fileTicket(b, t1, "Bench ticket one");
	await fileTicket(b, t1, "Bench ticket two");
	await lineTo(b, t2, "ticket --ticket 1");
	await programIn(b, t2, "ticket");
	await lineTo(b, t3, `markdown --text "# Bench"`);
	await programIn(b, t3, "markdown");
	await tellMarkdown(b, t3, LONG_MARKDOWN(markdownBlocks));
	await b.page
		.locator(`[data-tile="${t3}"]`)
		.getByText("Paragraph 101 with")
		.first()
		.waitFor({timeout: 20000});
	await lineTo(b, t4, "map --ticket 1");
	await programIn(b, t4, "map");
	await focusTile(b, t5);
	await prompted(b, t5);
	return {tracker: t1, ticket: t2, markdown: t3, map: t4, terminal: t5};
};

// ---------------------------------------------------------------- one sample

const machineOf = async (app: any) => {
	const versions = await app.evaluate(() => ({
		electron: process.versions.electron,
		chrome: process.versions.chrome,
	}));
	return {
		cpu: cpus()[0]?.model ?? "unknown",
		cores: cpus().length,
		memGb: Math.round(totalmem() / 2 ** 30),
		os: `${process.platform} ${release()}`,
		arch: arch(),
		...versions,
	};
};

const deskNow = (b: Bench) =>
	b.page.evaluate(() => {
		const tiles = [...document.querySelectorAll("[data-tile]")];
		const programs = tiles.map(
			(t) =>
				t.querySelector("[data-view]")?.getAttribute("aria-label")?.replace(" view", "") ?? null,
		);
		const workspaces = document.querySelector('nav[aria-label="workspaces"]')?.children.length ?? 1;
		return {tiles: tiles.length, programs, workspaces};
	});

const hostProcess = (home: string) =>
	new Promise<{type: string; cpuPct: number; memMb: number} | null>((done) => {
		const pid = hostPidOf(home);
		if (pid === null) return done(null);
		execFile("ps", ["-o", "%cpu=,rss=", "-p", String(pid)], (err, out) => {
			if (err !== null) return done(null);
			const [cpu, rss] = out.trim().split(/\s+/).map(Number);
			done({type: "host", cpuPct: round(cpu ?? 0), memMb: round((rss ?? 0) / 1024)});
		});
	});

const metrics = async (b: Bench) => {
	const app: {type: string; cpuPct: number; memMb: number}[] = await b.app.evaluate(({app}: any) =>
		app.getAppMetrics().map((m: any) => ({
			type: m.type === "Tab" ? "renderer" : String(m.type).toLowerCase(),
			cpuPct: Math.round(m.cpu.percentCPUUsage * 100) / 100,
			memMb: Math.round((m.memory.workingSetSize / 1024) * 100) / 100,
		})),
	);
	const host = await hostProcess(b.home);
	return host === null ? app : [...app, host];
};

/** Clear the page's and main's counters, so what is read next is this moment's alone. */
export const resetCounters = async (b: Bench) => {
	await b.page.evaluate(() => __probe.reset());
	await b.app.evaluate(() => __loop.reset());
	await b.app.evaluate(({app}: any) => app.getAppMetrics());
};

export const readSample = async (
	b: Bench,
	moment: string,
	values: readonly number[],
	events: number,
	facts: Readonly<Record<string, unknown>> = {},
): Promise<Sample> => {
	const probe = await b.page.evaluate(() => __probe.read());
	/** Each host message that landed, to the next commit: the page's own share of any of these. */
	const dispatch = probe.heard.flatMap((h: number) => {
		const c = probe.commitTimes.find((t: number) => t >= h);
		return c === undefined || c - h > 100 ? [] : [c - h];
	});
	const mainLoop = await b.app.evaluate(() => {
		const loop = __loop;
		return {p50Ms: loop.percentile(50) / 1e6, p99Ms: loop.percentile(99) / 1e6};
	});
	const stamp = JSON.parse(readFileSync(join(DISTS, b.label, "bench.json"), "utf8"));
	return {
		bench: 1,
		moment,
		variant: b.label,
		commit: stamp.commit,
		dirty: stamp.dirty,
		at: new Date().toISOString(),
		machine: await machineOf(b.app),
		desk: await deskNow(b),
		ms: summary(values),
		loaf: {count: probe.loaf.count, worstMs: round(probe.loaf.worstMs)},
		processes: await metrics(b),
		mainLoop: {p50Ms: round(mainLoop.p50Ms), p99Ms: round(mainLoop.p99Ms)},
		renders: {
			events,
			commits: probe.commits,
			total: probe.total,
			outside: probe.outside,
			perTile: probe.perTile,
			tileShell: probe.tileShell,
		},
		facts: {dispatchToCommit: summary(dispatch), ...facts},
	};
};

export const keep = (sample: Sample) => {
	mkdirSync(join(root, "experiments/results"), {recursive: true});
	appendFileSync(RESULTS, `${JSON.stringify(sample)}\n`);
	const m = sample.ms;
	const r = sample.renders;
	console.log(
		`${sample.variant} ${sample.moment}: ${m === null ? "" : `p50 ${m.p50} p95 ${m.p95} max ${m.max} ms (n ${m.n}); `}renders ${r.total}/${r.events} loaf ${sample.loaf.count}/${sample.loaf.worstMs} loop p99 ${sample.mainLoop.p99Ms}`,
		JSON.stringify(sample.facts),
	);
	return sample;
};

// ---------------------------------------------------------------- the moments

type Moment = (b: Bench) => Promise<void>;

/**
 * Do `act`, and answer ms from the last key or press it made to the moment `holds` is true of the page,
 * in the DOM and at the next frame. Measured inside the page, on the page's own clock.
 */
const keyToDom = async (b: Bench, holds: string, act: () => Promise<void>) => {
	const pending = b.page.evaluate(([source]: string[]) => __probe.whenDom(source, 8000), [holds]);
	await sleep(4);
	await act();
	const at = await pending;
	if (at === null) throw new Error(`never saw ${holds}`);
	const keys: {key: string; t: number}[] = await b.page.evaluate(() => __probe.read().keys);
	const from = keys.filter((k) => k.t <= at.dom).at(-1)?.t ?? at.dom;
	return {dom: at.dom - from, frame: at.frame - from};
};

const tileIs = (id: string, css: string) =>
	`document.querySelector('[data-tile="${id}"] ${css}') !== null`;

/** A key at an idle prompt to the same character in the tile's screen text. */
const keystrokeEcho: Moment = async (b) => {
	const tile = await focusedNow(b);
	if (tile === null) throw new Error("no focused tile");
	await prompted(b, tile);
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	const screenOf = `document.querySelector('[data-tile="${tile}"] .screen-text').textContent`;
	// A character, then its erase: the line stays short, so a narrow tile never wraps it.
	for (let i = 0; i < 40; i += 1) {
		const typed = i % 2 === 0;
		const got = await keyToDom(b, `${screenOf}.endsWith('tsh$${typed ? " x" : ""}')`, () =>
			b.page.keyboard.press(typed ? "x" : "Backspace"),
		);
		times.push(got.dom);
		frames.push(got.frame);
		await sleep(30);
	}
	keep(await readSample(b, "keystroke-echo", times, 40, {frame: summary(frames)}));
};

/** C-b 2 and C-b 1, key to the other workspace's tiles in the DOM. Makes a second workspace first. */
const workspaceSwitch: Moment = async (b) => {
	const one = await visibleTiles(b);
	await prefixed(b, "N");
	const two = await waitFor(
		"a second workspace",
		() => visibleTiles(b),
		(t) => t.join() !== one.join(),
	);
	await prompted(b, two[0] ?? "");
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	const land = async (ids: readonly string[], key: string) => {
		await b.page.keyboard.press("Control+b");
		await sleep(30);
		const got = await keyToDom(
			b,
			`[...document.querySelectorAll('[data-tile]')].filter((t) => t.checkVisibility()).map((t) => t.dataset.tile).join() === '${ids.join()}'`,
			() => b.page.keyboard.press(key),
		);
		times.push(got.dom);
		frames.push(got.frame);
	};
	for (let i = 0; i < 10; i += 1) {
		await land(one, "1");
		await sleep(150);
		await land(two, "2");
		await sleep(150);
	}
	keep(await readSample(b, "workspace-switch", times, 20, {frame: summary(frames)}));
	await prefixed(b, "1");
	await waitFor(
		"back on one",
		() => visibleTiles(b),
		(t) => t.join() === one.join(),
	);
};

/** A click on a ticket's row in the tracker's list, to that ticket's page drawn: its comment box. */
const openTicket: Moment = async (b) => {
	const tile = await tileShowing(b, "tracker");
	const tracker = b.page.locator(`[data-tile="${tile}"]`).getByLabel("tracker view");
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	for (let i = 0; i < 10; i += 1) {
		const got = await keyToDom(b, tileIs(tile, "textarea"), () =>
			tracker.getByRole("button", {name: /Bench ticket one/}).click(),
		);
		times.push(got.dom);
		frames.push(got.frame);
		await sleep(100);
		await b.page.keyboard.press("Escape");
		await tracker.getByRole("button", {name: /Bench ticket one/}).waitFor({timeout: 5000});
		await sleep(100);
	}
	keep(await readSample(b, "open-ticket", times, 10, {frame: summary(frames)}));
};

/** Focus moves: C-b l and C-b h, the commonest desk message that changes no layout. */
const focusMove: Moment = async (b) => {
	await focusTile(b, await tileShowing(b, "tracker"));
	await resetCounters(b);
	const times: number[] = [];
	const go = async (key: string) => {
		const from = await focusedNow(b);
		await b.page.keyboard.press("Control+b");
		await sleep(30);
		const got = await keyToDom(
			b,
			`[...document.querySelectorAll('[data-tile][aria-current="true"]')].find((t) => t.checkVisibility())?.dataset.tile !== '${from}'`,
			() => b.page.keyboard.press(key),
		);
		times.push(got.dom);
		await sleep(60);
	};
	for (let i = 0; i < 10; i += 1) {
		await go("l");
		await go("h");
	}
	keep(await readSample(b, "focus-move", times, 20));
};

/** A patch to one window: one comment on the ticket, seen by the ticket's window on its port. */
const onePatch: Moment = async (b) => {
	const tile = await tileShowing(b, "ticket");
	const run: string = await b.page.evaluate((t: string) => __probe.runIn(t), tile);
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	for (let i = 0; i < 10; i += 1) {
		const body = `Bench note ${i} at ${Date.now()}`;
		const got = await keyToDom(
			b,
			`document.querySelector('[data-tile="${tile}"]').textContent.includes('${body}')`,
			async () => {
				await b.page.evaluate(
					([r, text]: string[]) => {
						__probe.stamp();
						window.fabrika.send(`run:${r}`, {
							type: "msg",
							msg: {type: "comment", value: {ticket: 1, body: text}},
						});
					},
					[run, body],
				);
			},
		);
		times.push(got.dom);
		frames.push(got.frame);
		await sleep(200);
	}
	keep(await readSample(b, "one-patch", times, 10));
};

/** Split the focused tile with the five windows open, then close the new one. */
const splitAndClose: Moment = async (b) => {
	const tile = await tileShowing(b, "tracker");
	await focusTile(b, tile);
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	for (let i = 0; i < 6; i += 1) {
		const count = (await tilesNow(b)).length;
		await b.page.keyboard.press("Control+b");
		await sleep(30);
		const got = await keyToDom(
			b,
			`document.querySelectorAll('[data-tile]').length === ${count + 1}`,
			() => b.page.keyboard.press("-"),
		);
		times.push(got.dom);
		frames.push(got.frame);
		const fresh = await waitFor(
			"focus on the new tile",
			() => focusedNow(b),
			(f) => f !== tile,
		);
		await prompted(b, fresh ?? "");
		await prefixed(b, "x");
		await sleep(50);
		await b.page.keyboard.press("y");
		await waitFor(
			"the new tile gone",
			() => tilesNow(b),
			(t) => t.length === count,
		);
		await focusTile(b, tile);
		await sleep(100);
	}
	keep(await readSample(b, "split", times, 6, {frame: summary(frames)}));
};

/** The nearest thing today's desk has to a move: C-b space turns a container, row to column. */
const turnLayout: Moment = async (b) => {
	const tile = await tileShowing(b, "tracker");
	await focusTile(b, tile);
	await resetCounters(b);
	const times: number[] = [];
	const frames: number[] = [];
	const rect = `(() => { const r = document.querySelector('[data-tile="${tile}"]').getBoundingClientRect(); return r.width + 'x' + r.height + '@' + r.left + ',' + r.top; })()`;
	for (let i = 0; i < 10; i += 1) {
		const before: string = await b.page.evaluate(rect);
		await b.page.keyboard.press("Control+b");
		await sleep(30);
		const got = await keyToDom(b, `${rect} !== '${before}'`, () => b.page.keyboard.press(" "));
		times.push(got.dom);
		frames.push(got.frame);
		await sleep(150);
	}
	keep(await readSample(b, "turn", times, 10, {frame: summary(frames)}));
};

/** Every kind of thing the desk does, once, for what React and the page say about it: not timed. */
const walk: Moment = async (b) => {
	const tile = await tileShowing(b, "terminal").catch(() => null);
	const pressOver = async (open: () => Promise<void>, css: string) => {
		await open();
		await b.page.locator(css).first().waitFor({timeout: 5000});
		await b.page.keyboard.press("ArrowDown");
		await b.page.keyboard.press("Escape");
		await b.page.locator(css).first().waitFor({state: "detached", timeout: 5000});
	};
	await pressOver(() => b.page.keyboard.press("Meta+k"), "[data-over]");
	await pressOver(() => prefixed(b, "a"), "#pop-asks");
	await pressOver(() => prefixed(b, "?"), "[data-over]");
	await pressOver(() => prefixed(b, "J"), "[data-over]");
	await pressOver(() => prefixed(b, "H"), "[data-over]");
	await prefixed(b, "i");
	await sleep(100);
	await prefixed(b, "i");
	await prefixed(b, "B");
	await sleep(100);
	await prefixed(b, "B");
	await prefixed(b, "z");
	await sleep(200);
	await prefixed(b, "z");
	await sleep(200);
	await prefixed(b, "f");
	await sleep(200);
	const strip = b.page.locator("[data-strip]").first();
	await strip.click();
	await sleep(200);
	await prefixed(b, " ");
	await sleep(200);
	await prefixed(b, " ");
	await b.page.mouse.move(600, 300);
	const borderBox = await b.page.locator("hr.border").first().boundingBox();
	if (borderBox !== null) {
		await b.page.mouse.move(borderBox.x + 1, borderBox.y + 40);
		await b.page.mouse.down();
		await b.page.mouse.move(borderBox.x + 60, borderBox.y + 40, {steps: 5});
		await b.page.mouse.up();
	}
	await prefixed(b, "N");
	await sleep(300);
	await prefixed(b, "1");
	await sleep(300);
	console.log(`walk: ${tile ?? "no bare terminal"}; the page said ${consoleLines.length} lines`);
	for (const line of new Set(consoleLines)) console.log(`  ${line.slice(0, 400)}`);
};

export const MOMENTS: Record<string, Moment> = {
	walk,
	"keystroke-echo": keystrokeEcho,
	"focus-move": focusMove,
	"one-patch": onePatch,
	split: splitAndClose,
	turn: turnLayout,
	"workspace-switch": workspaceSwitch,
	"open-ticket": openTicket,
};

// ---------------------------------------------------------------- the command line

const [command, label, ...rest] = process.argv.slice(2);

if (command === "build" && label !== undefined) {
	const at = rest.indexOf("--root");
	await benchBuild(
		label,
		at === -1 ? root : resolve(rest[at + 1] ?? root),
		rest.includes("--compile"),
		rest.includes("--dev"),
	);
} else if (command === "run" && label !== undefined) {
	await withApp(label, async (b) => {
		keep(await readSample(b, "cold-start", [b.coldMs], 1));
		const windows = await fiveWindows(b);
		console.log("open", windows);
		for (const name of rest) {
			const moment = MOMENTS[name];
			if (moment === undefined) throw new Error(`no moment ${name}`);
			await moment(b);
		}
	});
} else if (command === "open" && label !== undefined) {
	await withApp(label, async (b) => {
		await fiveWindows(b);
		mkdirSync(WORK, {recursive: true});
		await b.page.screenshot({path: join(WORK, `${label}-open.png`)});
		console.log(join(WORK, `${label}-open.png`));
	});
} else if (command === "list") {
	console.log(["cold-start", ...Object.keys(MOMENTS)].join("\n"));
} else {
	console.error("176-bench: build <label> | run <label> <moment> ... | open <label> | list");
	process.exitCode = 2;
}
void spawn;
void SHOTS;
