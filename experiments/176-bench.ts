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
		/** The window's content, in CSS pixels. */
		readonly window: readonly [number, number];
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
	// Off the branch's lockfile: `npm i --prefix runs/exp-176/compiler --save-exact
	// babel-plugin-react-compiler@1.0.0 @babel/core@7.29.7`. A pick that lands adds them for real.
	const fromCompiler = createRequire(join(WORK, "compiler/package.json"));
	const babel = fromCompiler("@babel/core");
	const compiler = fromCompiler.resolve("babel-plugin-react-compiler");
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
	const marked = source
		.replace(HEARD_FROM, HEARD_TO)
		.replace(
			"const read = readToWindow(raw);",
			'performance.mark("fabrika:heard"); const read = readToWindow(raw);',
		);
	// Pick 6: is the tile `memo` still needed under the Compiler? BENCH_NO_MEMO makes `memo` do nothing.
	return process.env.BENCH_NO_MEMO === undefined
		? marked
		: marked
				.replace(/\tmemo,\n/, "\n")
				.replace(
					"const terminals = new Map",
					"const memo = <T,>(f: T): T => f;\nconst terminals = new Map",
				);
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
						// Pick 7: what a Manti menu does inside a top layer when it still portals to the body.
						if (process.env.BENCH_NO_TOPLAYER !== undefined)
							build.onLoad({filter: /@manti-ui\/react\/dist\/index\.js$/}, (args: any) => ({
								contents: readFileSync(args.path, "utf8").replace(
									"container: t ?? void 0, ...e",
									"...e",
								),
								loader: "js",
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
	// BENCH_COMMIT: this copy was built with an older commit's files restored, and says which.
	const named = process.env.BENCH_COMMIT;
	const commit = named ?? run("git", ["rev-parse", "HEAD"], from);
	const dirty =
		named === undefined &&
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
	options: {
		readonly width?: number;
		readonly height?: number;
		readonly home?: string;
		/** How long to wait for the first prompt, in ms. */
		readonly wait?: number;
	} = {},
): Promise<T> => {
	const dist = join(DISTS, label);
	if (!existsSync(join(dist, "main.mjs"))) throw new Error(`no copy ${label}: build it first`);
	const home = options.home ?? mkdtempSync(join(tmpdir(), "fabrika-176-"));
	mkdirSync(join(home, "gh"), {recursive: true});
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
			{timeout: options.wait ?? 60000},
		);
		const coldMs = performance.now() - started;
		await app.evaluate(({BrowserWindow}: any, size: any) => {
			// One size, every run: the window a quiet start opens at was seen to differ from run to run.
			BrowserWindow.getAllWindows()[0]?.setContentSize(size.width ?? 1280, size.height ?? 800);
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
		if (options.home === undefined)
			rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
	}
};

/**
 * Pick 4b: a real restart, three times on one home. What was kept comes back; a kept file that
 * breaks the law is refused for a fresh desk; a file from before the store still reads.
 */
const restartCheck = async (label: string) => {
	const home = mkdtempSync(join(tmpdir(), "fabrika-176-"));
	const file = join(home, "desk.json");
	const read = () => JSON.parse(readFileSync(file, "utf8"));
	const again = () => withApp(label, (b) => tilesNow(b), {home});
	const made = await withApp(
		label,
		async (b) => {
			await split(b, "|");
			await split(b, "-");
			await sleep(500);
			return tilesNow(b);
		},
		{home},
	);
	const kept = read();
	const back = await again();
	const out: Record<string, unknown> = {
		made,
		fileHasRecords: "tiles" in kept,
		back,
	};
	if ("tiles" in kept) {
		const twice = structuredClone(kept);
		const children = twice.workspaces[0].layout.root.children;
		children.push(children[0]);
		writeFileSync(file, JSON.stringify(twice));
		out.brokenFileGives = await again();
		const toTree = (node: any): any =>
			node.tag === "tile" ? kept.tiles[node.id] : {...node, children: node.children.map(toTree)};
		const old = {
			...kept,
			tiles: undefined,
			workspaces: kept.workspaces.map((ws: any) => ({
				...ws,
				layout: {...ws.layout, root: toTree(ws.layout.root)},
			})),
		};
		writeFileSync(file, JSON.stringify(old));
		out.oldTreeFileGives = await again();
	}
	rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
	console.log(label, JSON.stringify(out));
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
		return {
			tiles: tiles.length,
			programs,
			workspaces,
			window: [window.innerWidth, window.innerHeight],
		};
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

/**
 * Pick 5: what comes back when a tile is shown again, each way a tile hides: another workspace, a
 * zoom, a fold. What it asks of each: is the ticket's draft there, is the long text's scroll there,
 * is the terminal's size the same, did what it was sent while hidden draw, and does the keyboard's
 * focus sit on the tile the desk says is focused.
 */
const reveal: Moment = async (b) => {
	const [tracker, ticket, text, term] = await Promise.all([
		tileShowing(b, "tracker"),
		tileShowing(b, "ticket"),
		tileShowing(b, "markdown"),
		b.page.evaluate(
			() =>
				[...document.querySelectorAll<HTMLElement>("[data-tile]")]
					.filter((t) => t.querySelector("[data-view]") === null)
					.at(-1)?.dataset.tile,
		),
	]);
	await focusTile(b, ticket);
	await b.page.locator(`[data-tile="${ticket}"] #ticket-composer`).fill("a draft");
	await focusTile(b, text);
	const textRun: string = await b.page.evaluate((t: string) => __probe.runIn(t), text);
	const look = (): Promise<any> =>
		b.page.evaluate(
			([ticketId, textId, termId]: string[]) => {
				const tile = (id: string) => document.querySelector<HTMLElement>(`[data-tile="${id}"]`);
				const focused = [
					...document.querySelectorAll<HTMLElement>('[data-tile][aria-current="true"]'),
				].find((t) => t.checkVisibility())?.dataset.tile;
				const at = document.activeElement;
				const scroller = [...(tile(textId)?.querySelectorAll<HTMLElement>("*") ?? [])].find(
					(e) => e.scrollHeight > e.clientHeight + 50,
				);
				return {
					draft:
						tile(ticketId)?.querySelector<HTMLTextAreaElement>("#ticket-composer")?.value ?? null,
					scrollTop: scroller === undefined ? null : Math.round(scroller.scrollTop),
					canvas: (() => {
						const c = tile(termId)?.querySelector("canvas");
						return c === undefined || c === null ? null : `${c.width}x${c.height}`;
					})(),
					screenHasLine:
						tile(termId)?.querySelector(".screen-text")?.textContent?.includes("heard176") ?? null,
					focused,
					focusIn: at?.closest<HTMLElement>("[data-tile]")?.dataset.tile ?? at?.tagName ?? null,
					focusWhat: at?.id || at?.getAttribute("aria-label") || at?.tagName || null,
				};
			},
			[ticket, text, term ?? ""],
		);
	const settle = async (nodes = 400) => {
		await sleep(nodes);
	};
	const scroller = (top: number) =>
		b.page.evaluate(
			([id, to]: [string, number]) => {
				const found = [...document.querySelectorAll<HTMLElement>(`[data-tile="${id}"] *`)].find(
					(e) => e.scrollHeight > e.clientHeight + 50,
				);
				if (found !== undefined) found.scrollTop = to;
			},
			[text, top],
		);
	await scroller(700);
	const before = await look();
	const out: Record<string, unknown> = {tracker, ticket, text, term, before};
	const times: number[] = [];

	// Another workspace.
	const one = await visibleTiles(b);
	await prefixed(b, "N");
	const two = await waitFor(
		"a second workspace",
		() => visibleTiles(b),
		(t) => t.join() !== one.join(),
	);
	await prompted(b, two[0] ?? "");
	await settle();
	out.awayFocus = await look();
	// Sent while hidden: bytes to the terminal, and 30 whole texts to the long window.
	if (term !== undefined) await lineTo(b, term, "heard176");
	await resetCounters(b);
	const patches = Number(process.env.REVEAL_PATCHES ?? 30);
	for (let i = 0; i < patches; i += 1) {
		// To its run, not through the tile: with the tile unmounted, its run cannot be read off it.
		await b.page.evaluate(
			([run, value]: string[]) =>
				window.fabrika.send(`run:${run}`, {type: "msg", msg: {type: "text", value}}),
			[textRun, LONG_MARKDOWN(200, `hidden ${i}`)],
		);
		await sleep(25);
	}
	await sleep(Number(process.env.REVEAL_WAIT ?? 3000));
	const hidden = await b.page.evaluate(() => __probe.read());
	out.hiddenPatches = {
		patches,
		total: hidden.total,
		perTile: hidden.perTile,
		loaf: hidden.loaf.count,
		heard: hidden.heard.length,
	};
	await resetCounters(b);
	await b.page.keyboard.press("Control+b");
	await sleep(30);
	const backTo = await keyToDom(
		b,
		`[...document.querySelectorAll('[data-tile]')].filter((t) => t.checkVisibility()).map((t) => t.dataset.tile).join() === '${one.join()}'`,
		() => b.page.keyboard.press("1"),
	);
	times.push(backTo.dom);
	await settle();
	const shownBack = await b.page.evaluate(() => __probe.read());
	out.revealCost = {
		dom: round(backTo.dom),
		frame: round(backTo.frame),
		total: shownBack.total,
		perTile: shownBack.perTile,
		commits: shownBack.commits,
		loaf: shownBack.loaf,
	};
	out.afterWorkspace = await look();

	// Behind a zoom: the tracker sits there, and its window takes focus when it mounts or shows.
	await scroller(700);
	await prefixed(b, "z");
	await waitFor(
		"zoomed",
		() => visibleTiles(b),
		(t) => t.length === 1,
	);
	await settle();
	out.zoomed = await look();
	await prefixed(b, "z");
	await waitFor(
		"back from zoom",
		() => visibleTiles(b),
		(t) => t.length === one.length,
	);
	await settle();
	out.afterZoom = await look();

	// Folded: the long text's own tile, then its strip pressed.
	await scroller(700);
	await prefixed(b, "f");
	await waitFor(
		"folded",
		() => visibleTiles(b),
		(t) => t.length === one.length - 1,
	);
	await settle();
	out.foldedFocus = await look();
	await b.page.locator(`[data-strip="${text}"]`).click();
	await waitFor(
		"unfolded",
		() => visibleTiles(b),
		(t) => t.length === one.length,
	);
	await settle();
	out.afterFold = await look();
	keep(await readSample(b, "reveal", times, 1, out));
};

/**
 * Pick 7: the palette and a panel, however they are drawn. Is it in the top layer, does focus move in
 * and come back, does the page's key capture still decide, what does a press outside do, and on a
 * patched Manti, do Zag's menu keys work inside.
 */
declare const __clicks: {clicks: string[]};

const overlays: Moment = async (b) => {
	await focusTile(b, await tileShowing(b, "tracker"));
	const facts = (): Promise<any> =>
		b.page.evaluate(() => {
			const over = document.querySelector<HTMLElement>("[data-over]");
			const at = document.activeElement;
			const rect = over?.getBoundingClientRect();
			const onTop =
				rect === undefined
					? null
					: document
							.elementFromPoint(rect.left + rect.width / 2, rect.top + 12)
							?.closest("[data-over]") === over;
			return {
				open: over?.id ?? null,
				modal: document.querySelector("dialog:modal") !== null,
				popoverOpen: document.querySelector(":popover-open") !== null,
				onTop,
				focusIn:
					at?.closest<HTMLElement>("[data-over]")?.id ??
					at?.closest<HTMLElement>("[data-tile]")?.dataset.tile ??
					at?.tagName ??
					null,
				tileDim: document.querySelector("[data-tile]")?.closest("[inert]") !== null,
			};
		});
	const out: Record<string, unknown> = {};
	await b.page.evaluate(() => {
		const seen = {clicks: [] as string[]};
		Object.assign(window, {__clicks: seen});
		document.addEventListener(
			"click",
			(e) => {
				const t = e.target as HTMLElement;
				seen.clicks.push(t.closest("[data-tile]")?.getAttribute("data-tile") ?? t.tagName);
			},
			true,
		);
	});
	const lastClick = () => b.page.evaluate(() => __clicks.clicks.at(-1) ?? null);
	const gone = (id: string) =>
		waitFor(
			`${id} closed`,
			() => b.page.locator(`#${id}`).count(),
			(n) => n === 0,
			3000,
		);
	const opens = async (id: string, open: () => Promise<void>, label: string, close: "Escape") => {
		await resetCounters(b);
		const times: number[] = [];
		for (let i = 0; i < 8; i += 1) {
			const got = await keyToDom(b, `document.getElementById('${id}') !== null`, open);
			times.push(got.dom);
			await sleep(60);
			await b.page.keyboard.press(close);
			await gone(id);
			await sleep(60);
		}
		keep(await readSample(b, label, times, 8));
	};

	// The palette.
	const palette = () => b.page.keyboard.press("Meta+k");
	await opens("pop-palette", palette, "open-palette", "Escape");
	await palette();
	await sleep(150);
	const shot = (name: string) =>
		b.page.screenshot({
			path: join(root, `experiments/176-react-on-the-real-app/${b.label}-${name}.png`),
		});
	if (b.label.startsWith("p7")) await shot("palette");
	out.paletteOpen = await facts();
	for (let i = 0; i < 6; i += 1) await b.page.keyboard.press("Tab");
	out.paletteAfterTabs = await facts();
	await b.page.keyboard.type("fold");
	out.paletteTyped = await b.page.locator("#pop-palette input").inputValue();
	await b.page.keyboard.press("Escape");
	await gone("pop-palette");
	await sleep(100);
	out.paletteAfterEsc = await facts();
	await palette();
	await sleep(150);
	await b.page.mouse.click(4, 400);
	await sleep(200);
	out.paletteAfterPressOutside = {...(await facts()), click: await lastClick()};
	await b.page.keyboard.press("Escape");

	// A panel, on the top bar's item for the host.
	const openerOf = '[aria-controls="pop-lines"]';
	const panel = () => prefixed(b, "H");
	await sleep(100);
	await panel();
	await b.page.locator("#pop-lines").waitFor({timeout: 3000});
	await sleep(150);
	if (b.label.startsWith("p7")) await shot("panel");
	out.panelOpen = await facts();
	await b.page.keyboard.press("Escape");
	await gone("pop-lines");
	await sleep(100);
	out.panelAfterEsc = await facts();
	await panel();
	await b.page.locator("#pop-lines").waitFor({timeout: 3000});
	await sleep(150);
	await b.page.mouse.click(300, 400);
	await sleep(200);
	out.panelAfterPressOutside = {...(await facts()), click: await lastClick()};
	await b.page.keyboard.press("Escape");
	await sleep(100);
	await panel();
	await b.page.locator("#pop-lines").waitFor({timeout: 3000});
	await sleep(150);
	if ((await b.page.locator(openerOf).count()) > 0) {
		await b.page.locator(openerOf).first().click();
		await sleep(200);
		out.panelAfterOpener = await facts();
		if ((await b.page.locator("#pop-lines").count()) === 0) {
			await panel();
			await b.page.locator("#pop-lines").waitFor({timeout: 3000});
			await sleep(150);
		}
	}
	await resetCounters(b);

	// Zag's menu inside, on the patched copies only.
	const trigger = b.page.locator("#pop-lines").getByRole("button", {name: "Zag menu"});
	if ((await trigger.count()) > 0) {
		await trigger.click();
		await sleep(200);
		const menu = (): Promise<any> =>
			b.page.evaluate(() => {
				const content = document.querySelector<HTMLElement>(
					'[data-scope="menu"][data-part="content"]:not([hidden])',
				);
				if (content === null) return {shown: false};
				const r = content.getBoundingClientRect();
				const atPoint = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				return {
					shown: true,
					onTop: content.contains(atPoint),
					inTopLayerParent: content.closest("[popover],dialog") !== null,
					highlighted: content.querySelector("[data-highlighted]")?.textContent ?? null,
					focusInMenu: content.contains(document.activeElement),
					focus:
						document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
				};
			});
		if (b.label.startsWith("p7")) await shot("menu");
		out.menuOpen = await menu();
		await b.page.keyboard.press("ArrowDown");
		await sleep(80);
		out.menuAfterDown = await menu();
		await b.page.keyboard.press("g");
		await sleep(150);
		out.menuAfterTypeahead = await menu();
		await b.page.keyboard.press("Enter");
		await sleep(150);
		out.menuPicked = await b.page.evaluate(() => document.body.dataset.zagPicked ?? null);
		out.afterMenuPick = await facts();
		if ((await trigger.count()) > 0) {
			await trigger.click();
			await sleep(200);
			await b.page.keyboard.press("Escape");
			await sleep(150);
			out.afterMenuEsc = {menu: await menu(), ...(await facts())};
		}
	}
	keep(await readSample(b, "overlays", [], 1, out));
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
declare const __feed: {told: number; shown: Set<string>; ended: number; lastAt: number};

/**
 * Pick 9: a heavy window fed fast, and a person typing in another tile. Every block of a long page
 * changes with each text. `FEED_MS` sets the gap, `FEED_TEXTS` how many.
 */
const feed: Moment = async (b) => {
	const every = Number(process.env.FEED_MS ?? 50);
	const count = Number(process.env.FEED_TEXTS ?? 100);
	const markdown = await tileShowing(b, "markdown");
	const terminal: string | null = await b.page.evaluate(
		() =>
			[...document.querySelectorAll("[data-tile]")]
				.find(
					(t) =>
						t.checkVisibility() &&
						t.querySelector(".screen-text") !== null &&
						t.querySelector("[data-view]") === null,
				)
				?.getAttribute("data-tile") ?? null,
	);
	if (terminal === null) throw new Error("no bare terminal");
	await focusTile(b, terminal);
	await prompted(b, terminal);
	const texts = Array.from(
		{length: count},
		(_, n) =>
			`# text${n}x\n\n${LONG_MARKDOWN(Number(process.env.FEED_BLOCKS ?? 200)).replaceAll("words", `words${n}`)}`,
	);
	await resetCounters(b);
	await b.page.evaluate(
		([tile, run, gap, all]: [string, string, number, string[]]) => {
			const seen = {told: 0, shown: new Set<string>(), ended: 0, lastAt: 0};
			Object.assign(window, {__feed: seen});
			const page = document.querySelector(`[data-tile="${tile}"] .markdown-page`);
			if (page === null) throw new Error("no page");
			const read = () => {
				const h = page.querySelector("h1")?.textContent ?? "";
				if (!seen.shown.has(h)) {
					seen.shown.add(h);
					seen.lastAt = performance.now();
				}
			};
			new MutationObserver(read).observe(page, {
				childList: true,
				subtree: true,
				characterData: true,
			});
			const timer = setInterval(() => {
				window.fabrika.send(`run:${run}`, {
					type: "msg",
					msg: {type: "text", value: all[seen.told]},
				});
				seen.told += 1;
				if (seen.told === all.length) {
					clearInterval(timer);
					seen.ended = performance.now();
				}
			}, gap);
		},
		[markdown, await b.page.evaluate((t: string) => __probe.runIn(t), markdown), every, texts],
	);
	const times: number[] = [];
	const screenOf = `document.querySelector('[data-tile="${terminal}"] .screen-text').textContent`;
	const until = Date.now() + every * count;
	let i = 0;
	let late = 0;
	while (Date.now() < until && i < 200) {
		const typed = i % 2 === 0;
		try {
			const got = await keyToDom(b, `${screenOf}.endsWith('tsh$${typed ? " x" : ""}')`, () =>
				b.page.keyboard.press(typed ? "x" : "Backspace"),
			);
			times.push(got.dom);
		} catch {
			late += 1;
		}
		i += 1;
		await sleep(60);
	}
	const last = `text${count - 1}x`;
	const caught = await waitFor(
		"the last text",
		() => b.page.evaluate((h: string) => __feed.shown.has(h), last),
		(y) => y,
		60000,
	).catch(() => false);
	const got = await b.page.evaluate(() => ({
		told: __feed.told,
		shown: __feed.shown.size,
		behind: __feed.lastAt - __feed.ended,
	}));
	keep(
		await readSample(b, "feed", times, 1, {
			every,
			count,
			caught,
			shown: got.shown,
			lastShownAfterFeedEnd: got.behind,
			keysLate: late,
			bytes: texts[0]?.length ?? 0,
		}),
	);
};

declare const __vt: {
	runs: number;
	active: number;
	presses: {active: number; target: string}[];
	frames: number[];
	groups: number[];
};

/**
 * Pick 8: a tile move with a view transition. What it costs at each moment one can fall into it:
 * what starts one and what must not, frames, a key and a press during it, text changing during it.
 */
const moves: Moment = async (b) => {
	const facts: Record<string, unknown> = {};
	await b.page.evaluate(() => {
		const seen: typeof __vt = {runs: 0, active: 0, presses: [], frames: [], groups: []};
		Object.assign(window, {__vt: seen});
		const start = document.startViewTransition.bind(document);
		document.startViewTransition = (update: any) => {
			const t = start(update);
			seen.runs += 1;
			seen.active += 1;
			// How many tiles really travel in it: a group with a moving box has an animation.
			t.ready
				.then(() => {
					seen.groups.push(
						document
							.getAnimations()
							.filter((a) =>
								((a.effect as KeyframeEffect | null)?.pseudoElement ?? "").startsWith(
									"::view-transition-group",
								),
							).length,
					);
				})
				.catch(() => seen.groups.push(-1));
			const tick = (() => {
				let last = performance.now();
				const on = () => {
					if (seen.active === 0) return;
					const at = performance.now();
					seen.frames.push(at - last);
					last = at;
					requestAnimationFrame(on);
				};
				return on;
			})();
			requestAnimationFrame(tick);
			t.finished.finally(() => {
				seen.active -= 1;
			});
			return t;
		};
		document.addEventListener(
			"pointerdown",
			(e) => {
				const t = e.target as HTMLElement;
				seen.presses.push({
					active: seen.active,
					target: t.closest("[data-tile]")?.getAttribute("data-tile") ?? t.tagName,
				});
			},
			true,
		);
	});
	const runs = (): Promise<number> => b.page.evaluate(() => __vt.runs);
	const settled = () =>
		waitFor(
			"no move running",
			() => b.page.evaluate(() => __vt.active),
			(n) => n === 0,
			4000,
		);
	const running = () =>
		waitFor(
			"a move running",
			() => b.page.evaluate(() => __vt.active),
			(n) => n > 0,
			1500,
		).catch(() => 0);

	const tracker = await tileShowing(b, "tracker");
	const markdown = await tileShowing(b, "markdown");
	const terminal: string | null = await b.page.evaluate(
		() =>
			[...document.querySelectorAll("[data-tile]")]
				.find(
					(t) =>
						t.checkVisibility() &&
						t.querySelector(".screen-text") !== null &&
						t.querySelector("[data-view]") === null,
				)
				?.getAttribute("data-tile") ?? null,
	);
	const other = markdown;
	await focusTile(b, tracker);

	// What starts one, and what must not. Keys: turn, fold, zoom. Drag, window resize, workspace.
	const counted = async (name: string, act: () => Promise<void>) => {
		await settled();
		const was = await runs();
		await act();
		await sleep(400);
		await settled();
		facts[name] = (await runs()) - was;
		facts[`${name}_groups`] = await b.page.evaluate(() => __vt.groups.splice(0));
	};
	for (const [name, key] of [
		["turn", " "],
		["turnBack", " "],
		["zoom", "z"],
		["zoomOut", "z"],
		["fold", "f"],
	] as const)
		await counted(`runs_${name}`, () => prefixed(b, key));
	await counted("runs_unfold", () => b.page.locator("button:has(.strip-name)").first().click());
	await counted("runs_splitAndClose", async () => {
		const fresh = await split(b, "|");
		await prefixed(b, "x");
		await sleep(80);
		await b.page.keyboard.press("y").catch(() => undefined);
		await waitFor(
			"it closed",
			() => tilesNow(b),
			(t) => !t.includes(fresh),
		);
	});
	await counted("runs_drag", async () => {
		const box = await b.page.locator("hr.border").first().boundingBox();
		if (box === null) throw new Error("no border");
		const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
		await b.page.mouse.move(x, y);
		await b.page.mouse.down();
		for (let i = 1; i <= 20; i += 1) await b.page.mouse.move(x + i * 3, y, {steps: 1});
		await b.page.mouse.up();
	});
	await counted("runs_programOpens", async () => {
		const fresh = await split(b, "|");
		await settled();
		await sleep(50);
		await b.page.evaluate(() => {
			__vt.runs = 0;
			__vt.groups = [];
		});
		await lineTo(b, fresh, "counter");
		await programIn(b, fresh, "counter");
		await sleep(300);
		facts.runsOnlyProgramOpen = await b.page.evaluate(() => __vt.runs);
		facts.groupsOnlyProgramOpen = await b.page.evaluate(() => __vt.groups);
		await b.page.keyboard.press("Control+c");
		await prompted(b, fresh);
		await prefixed(b, "x");
		await sleep(80);
		await b.page.keyboard.press("y").catch(() => undefined);
		await waitFor(
			"it closed",
			() => tilesNow(b),
			(t) => !t.includes(fresh),
		);
	});
	await counted("runs_windowResize", async () => {
		await b.app.evaluate(({BrowserWindow}: any) =>
			BrowserWindow.getAllWindows()[0].setContentSize(1100, 760),
		);
		await sleep(200);
		await b.app.evaluate(({BrowserWindow}: any) =>
			BrowserWindow.getAllWindows()[0].setContentSize(1280, 800),
		);
	});
	await focusTile(b, tracker);

	// A key held through a split lands on the new tile, as it does without a move.
	await settled();
	const before = await tilesNow(b);
	await prefixed(b, "|");
	await b.page.keyboard.type("zzz");
	const fresh = await waitFor(
		"the new tile",
		() => tilesNow(b),
		(t) => t.length === before.length + 1,
	);
	const made = fresh.find((t) => !before.includes(t)) ?? "";
	await prompted(b, made).catch(() => undefined);
	await waitFor(
		"the typed keys",
		() => screen(b, made),
		(t) => t.includes("zzz"),
		3000,
	).catch(() => undefined);
	facts.typedRightAfterSplit = {landed: (await screen(b, made)).includes("zzz")};
	await b.page.keyboard.press("Backspace");
	await b.page.keyboard.press("Backspace");
	await b.page.keyboard.press("Backspace");
	await prefixed(b, "x");
	await sleep(80);
	await b.page.keyboard.press("y").catch(() => undefined);
	await waitFor(
		"it closed",
		() => tilesNow(b),
		(t) => !t.includes(made),
	);
	await settled();

	// Timing, and frames while it runs, ten turns. The move's own clock, from the key.
	await focusTile(b, tracker);
	await resetCounters(b);
	await b.page.evaluate(() => {
		__vt.frames = [];
	});
	const times: number[] = [];
	const rect = `(() => { const r = document.querySelector('[data-tile="${tracker}"]').getBoundingClientRect(); return r.width + 'x' + r.height; })()`;
	for (let i = 0; i < 10; i += 1) {
		const was: string = await b.page.evaluate(rect);
		await b.page.keyboard.press("Control+b");
		await sleep(30);
		const got = await keyToDom(b, `${rect} !== '${was}'`, () => b.page.keyboard.press(" "));
		times.push(got.dom);
		await settled();
		await sleep(100);
	}
	const frames: number[] = await b.page.evaluate(() => __vt.frames);
	keep(
		await readSample(b, "moves-turn", times, 10, {
			frameGap: summary(frames),
			framesSeen: frames.length,
		}),
	);

	// A key and a press while it runs: the press aims at a tile that is not focused.
	const keyDuring = [];
	const pressDuring = [];
	const titleOf = async (id: string) => {
		const box = await b.page.locator(`[data-tile="${id}"] .titlebar`).boundingBox();
		if (box === null) throw new Error(`no title on ${id}`);
		return {x: box.x + box.width / 2, y: box.y + box.height / 2};
	};
	for (let i = 0; i < 10; i += 1) {
		await focusTile(b, tracker);
		await settled();
		const aim = await titleOf(other);
		await b.page.evaluate(() => {
			__vt.presses = [];
		});
		await prefixed(b, " ");
		const during = await running();
		const landed = await b.page.evaluate(() => __vt.active);
		await b.page.mouse.click(aim.x, aim.y);
		await settled();
		await sleep(120);
		const presses = await b.page.evaluate(() => __vt.presses);
		pressDuring.push({
			moveSeen: during > 0,
			activeWhenSent: landed,
			press: presses.at(-1) ?? null,
			focused: await focusedNow(b),
			active: await b.page.evaluate(() => document.activeElement?.tagName ?? null),
		});
		await prefixed(b, " ");
		await sleep(50);
		await settled();
	}
	facts.pressDuring = {
		// The move has its boxes elsewhere by then: any tile under the pointer counts.
		pressSeenByTile: pressDuring.filter((p) => /^t\d+$/.test(p.press?.target ?? "")).length,
		tileFocused: pressDuring.filter((p) => p.focused !== tracker).length,
		bodyFocus: pressDuring.filter((p) => p.active === "BODY").length,
		duringMove: pressDuring.filter((p) => (p.press?.active ?? 0) > 0).length,
		of: pressDuring.length,
		rows: pressDuring.slice(0, 3),
	};
	if (terminal !== null) {
		// The control: the same key with no move.
		await focusTile(b, terminal);
		await settled();
		await b.page.keyboard.type("c0");
		await waitFor(
			"the key",
			() => screen(b, terminal),
			(t) => t.includes("c0"),
			2000,
		).catch(() => undefined);
		facts.keyNoMove = (await screen(b, terminal)).slice(-60);
		await b.page.keyboard.press("Backspace");
		await b.page.keyboard.press("Backspace");
		for (let i = 0; i < 5; i += 1) {
			await focusTile(b, terminal);
			await settled();
			await prefixed(b, " ");
			await running();
			const mark = `k${i}`;
			await b.page.keyboard.type(mark);
			await settled();
			await waitFor(
				"the key",
				() => screen(b, terminal),
				(t) => t.includes(mark),
				2000,
			).catch(() => undefined);
			const text = await screen(b, terminal);
			keyDuring.push(text.includes(mark));
			facts.keyDuringLast = {
				screen: text.slice(-60),
				focused: await focusedNow(b),
				active: await b.page.evaluate(() => document.activeElement?.tagName ?? null),
			};
			await b.page.keyboard.press("Backspace");
			await b.page.keyboard.press("Backspace");
			await prefixed(b, " ");
			await sleep(50);
			await settled();
		}
		facts.keyDuring = {landed: keyDuring.filter(Boolean).length, of: keyDuring.length};
	}

	// Slowed to two seconds, so a picture can be taken: text told during the move, then a key
	// during it to the terminal. What is drawn, the old text or the new?
	await focusTile(b, tracker);
	await settled();
	await b.page.evaluate(() => {
		const slow = new CSSStyleSheet();
		slow.replaceSync("::view-transition-group(*) { animation-duration: 2s !important; }");
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, slow];
	});
	await prefixed(b, " ");
	await running();
	await tellMarkdown(b, markdown, "# NEW TEXT DURING THE MOVE\n\nThe old text is gone.");
	await b.page
		.locator(`[data-tile="${markdown}"]`)
		.getByText("NEW TEXT DURING")
		.first()
		.waitFor({timeout: 1500})
		.catch(() => undefined);
	facts.newTextInDom = await b.page
		.locator(`[data-tile="${markdown}"]`)
		.getByText("NEW TEXT DURING")
		.count();
	facts.activeAtShot = await b.page.evaluate(() => __vt.active);
	await b.page.screenshot({path: join(SHOTS, `${b.label}-text-during.png`)}).catch(() => undefined);
	await settled();
	const shown = await visibleTiles(b);
	await counted("runs_workspaceNew", async () => {
		await prefixed(b, "N");
		await waitFor(
			"a second workspace",
			() => visibleTiles(b),
			(t) => t.join() !== shown.join(),
		);
	});
	await counted("runs_workspaceBack", () => prefixed(b, "1"));
	keep(await readSample(b, "moves", [], 1, facts));
};

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

/**
 * What a layout change leaves alone: the same element, its scroll, its focus, a draft, the screen.
 * Pick 4's question. Facts only: how long it took is `split`'s.
 */
const keeps: Moment = async (b) => {
	const mark = (id: string) =>
		b.page.evaluate((t: string) => {
			const el: any = document.querySelector(`[data-tile="${t}"]`);
			el.__kept = true;
		}, id);
	const same = (id: string): Promise<boolean> =>
		b.page.evaluate((t: string) => {
			const el: any = document.querySelector(`[data-tile="${t}"]`);
			return el?.__kept === true;
		}, id);
	const scrollIn = (id: string, to: number | null): Promise<number> =>
		b.page.evaluate(
			([t, y]: [string, number | null]) => {
				const tile = document.querySelector(`[data-tile="${t}"]`);
				const box = [...(tile?.querySelectorAll("*") ?? [])].find(
					(el) =>
						el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== "visible",
				);
				if (box === undefined) return -1;
				if (y !== null) box.scrollTop = y;
				return box.scrollTop;
			},
			[id, to],
		);
	const facts: Record<string, unknown> = {};
	const markdown = await tileShowing(b, "markdown");
	const ticket = await tileShowing(b, "ticket");
	const terminal = (await focusedNow(b)) ?? "";

	// The markdown window is scrolled, and its tile splits the way that wraps it in a new container.
	await focusTile(b, markdown);
	await mark(markdown);
	await scrollIn(markdown, 900);
	const fresh = await split(b, "|");
	await sleep(200);
	facts.splitWrap = {sameNode: await same(markdown), scrollTop: await scrollIn(markdown, null)};

	// The new tile closes: the container goes, and the tile moves up a level.
	await mark(markdown);
	await scrollIn(markdown, 900);
	await prefixed(b, "x");
	await sleep(100);
	await b.page.keyboard.press("y");
	await waitFor(
		"the tile gone",
		() => tilesNow(b),
		(t) => !t.includes(fresh),
	);
	await sleep(200);
	facts.closeUnwrap = {sameNode: await same(markdown), scrollTop: await scrollIn(markdown, null)};

	// A draft in the ticket's comment box, focus in it, and a zoom in and out.
	await focusTile(b, ticket);
	await mark(ticket);
	const box = b.page.locator(`[data-tile="${ticket}"] #ticket-composer`);
	await box.click();
	await b.page.keyboard.type("a draft");
	await prefixed(b, "z");
	await sleep(200);
	const draft = () =>
		b.page.evaluate((t: string) => {
			const area = document.querySelector<HTMLTextAreaElement>(
				`[data-tile="${t}"] #ticket-composer`,
			);
			return {
				value: area?.value ?? null,
				focusIn: area !== null && document.activeElement === area,
			};
		}, ticket);
	facts.zoomIn = {sameNode: await same(ticket), ...(await draft())};
	await prefixed(b, "z");
	await sleep(200);
	facts.zoomOut = {sameNode: await same(ticket), ...(await draft())};
	await box.fill("");

	// A bare terminal holds what it printed, and its tile splits the wrapping way.
	await focusTile(b, terminal);
	await mark(terminal);
	await lineTo(b, terminal, "echo kept-by-the-terminal");
	await waitFor(
		"the words",
		() => screen(b, terminal),
		(t) => t.includes("kept-by-the-terminal"),
	);
	await split(b, "-");
	await sleep(200);
	facts.terminalSplit = {
		sameNode: await same(terminal),
		screenKept: (await screen(b, terminal)).includes("kept-by-the-terminal"),
	};

	// A turn: every tile stays, in a new shape.
	const all = await tilesNow(b);
	for (const id of all) await mark(id);
	await prefixed(b, " ");
	await sleep(250);
	const left = await Promise.all(all.map((id) => same(id)));
	facts.turn = {sameNodes: left.filter(Boolean).length, of: all.length};
	keep(await readSample(b, "keeps", [], 0, facts));
};

/** The boxes tiles are drawn in, for the same layout across two copies. */
const rects: Moment = async (b) => {
	const got = await b.page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>("[data-tile]")]
			.map((t) => {
				const r = t.getBoundingClientRect();
				return [t.dataset.tile, r.left, r.top, r.width, r.height];
			})
			.sort(),
	);
	keep(await readSample(b, "rects", [], 0, {rects: got}));
};

const windowSize = (b: Bench, width: number, height: number) =>
	b.app.evaluate(
		({BrowserWindow}: any, [w, h]: number[]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
		[width, height],
	);

/** The layouts a change that shows must be seen in, saved beside the write-up. */
const shots = async (b: Bench, prefix: string) => {
	mkdirSync(SHOTS, {recursive: true});
	const shot = async (name: string) => {
		await sleep(400);
		await b.page.screenshot({path: join(SHOTS, `${prefix}-${name}.png`)});
	};
	await lineTo(b, "t1", "tracker");
	await programIn(b, "t1", "tracker");
	await fileTicket(b, "t1", "Bench ticket one");
	await shot("one-tile");
	const side = await split(b, "|");
	await shot("side-by-side");
	await prefixed(b, "x");
	await sleep(100);
	await b.page.keyboard.press("y");
	await waitFor(
		"one again",
		() => tilesNow(b),
		(t) => !t.includes(side),
	);
	await focusIs(b, "t1");
	const below = await split(b, "-");
	await lineTo(b, below, `markdown --text "# Bench"`);
	await programIn(b, below, "markdown");
	await tellMarkdown(b, below, LONG_MARKDOWN(40));
	await shot("stacked");
	await focusTile(b, "t1");
	const right = await split(b, "|");
	await lineTo(b, right, "ticket --ticket 1");
	await programIn(b, right, "ticket");
	await focusTile(b, below);
	await split(b, "|");
	await shot("two-by-two");
	await prefixed(b, "f");
	await shot("two-by-two-one-folded");
	await b.page.locator("[data-strip]").first().click();
	await sleep(200);
	await windowSize(b, 1024, 700);
	await shot("small-window");
};

/**
 * Pick 5's doubt: memory with many long-lived hidden tiles. Sixteen real terminals on four workspaces,
 * one folded, three of them under a program; a line to every terminal and a tour of every workspace
 * once a minute; garbage collected, then one sample a minute.
 */
const soak = async (b: Bench, minutes: number) => {
	const fill = async () => {
		await split(b, "|");
		await split(b, "-");
		await split(b, "|");
	};
	await fill();
	await prefixed(b, "f");
	await sleep(200);
	const opened: [string, string][] = [
		["markdown", `markdown --text "# Soak"`],
		["tracker", "tracker"],
		["map", "map --ticket 1"],
	];
	for (const [program, line] of opened) {
		await prefixed(b, "N");
		await sleep(500);
		const [first] = await visibleTiles(b);
		if (first === undefined) throw new Error("no tile on the new workspace");
		await prompted(b, first);
		await fill();
		await lineTo(b, first, line);
		await programIn(b, first, program);
		if (program === "markdown") await tellMarkdown(b, first, LONG_MARKDOWN(200));
		if (program === "tracker") await fileTicket(b, first, "Soak ticket");
		await sleep(300);
	}
	const session = await b.page.context().newCDPSession(b.page);
	await session.send("Performance.enable");
	const ids = Array.from({length: 16}, (_, i) => `t${i + 1}`);
	const started = performance.now();
	for (let minute = 0; minute <= minutes; minute += 1) {
		await resetCounters(b);
		for (const id of ids) await lineTo(b, id, `soak${minute}`);
		const tour: number[] = [];
		for (const key of ["2", "3", "4", "1"]) {
			const at = performance.now();
			await prefixed(b, key);
			await sleep(1500);
			tour.push(performance.now() - at - 1500);
		}
		await session.send("HeapProfiler.collectGarbage");
		const got = await session.send("Performance.getMetrics");
		const named = Object.fromEntries(got.metrics.map((m: any) => [m.name, m.value]));
		keep(
			await readSample(b, "soak", [tour.reduce((a, c) => a + c, 0) / tour.length], ids.length, {
				minute,
				elapsedMin: round((performance.now() - started) / 60000),
				heapMb: round(named.JSHeapUsedSize / 2 ** 20),
				heapTotalMb: round(named.JSHeapTotalSize / 2 ** 20),
				nodes: named.Nodes,
				listeners: named.JSEventListeners,
				canvases: await b.page.evaluate(() => document.querySelectorAll("canvas").length),
			}),
		);
		const left = started + (minute + 1) * 60000 - performance.now();
		if (minute < minutes && left > 0) await sleep(left);
	}
};

export const MOMENTS: Record<string, Moment> = {
	walk,
	keeps,
	rects,
	"keystroke-echo": keystrokeEcho,
	"focus-move": focusMove,
	"one-patch": onePatch,
	split: splitAndClose,
	turn: turnLayout,
	"workspace-switch": workspaceSwitch,
	"open-ticket": openTicket,
	reveal,
	overlays,
	moves,
	feed,
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
} else if (command === "shots" && label !== undefined) {
	await withApp(label, (b) => shots(b, rest[0] ?? label));
} else if (command === "start" && label !== undefined) {
	// Pick 6: does this copy start at all? The trap freezes the desk on its first value.
	const started = await withApp(label, async (b) => b.coldMs, {wait: 15000}).catch(
		(e: Error) => `no prompt: ${e.message.split("\n")[0]}`,
	);
	console.log(label, "first prompt:", started);
} else if (command === "soak" && label !== undefined) {
	await withApp(label, (b) => soak(b, Number(rest[0] ?? 60)));
} else if (command === "restart" && label !== undefined) {
	await restartCheck(label);
} else if (command === "list") {
	console.log(["cold-start", ...Object.keys(MOMENTS)].join("\n"));
} else if (command === "refs") {
	// Pick 3's question, off the app: does the host's update keep what did not change, what is left
	// of that after the wire, and what does taking it back cost on the page?
	const {applyCell} = await import(join(appDir, "node_modules/@demlik/tea/dist/index.js"));
	const {deskMachine} = await import(join(appDir, "src/desk/desk.ts"));
	const {tiles} = await import(join(appDir, "src/desk/layout/index.ts"));
	const {share} = await import(join(appDir, "src/window/share.ts"));
	let at = 0;
	const key = (d: any, k: string) => {
		at += 10;
		return applyCell(deskMachine, d, {type: "key", key: k, at})[0];
	};
	let desk = deskMachine.init(null)[0];
	const both = (d: any, ks: readonly string[]) => ks.reduce((acc, k) => key(acc, k), d);
	for (let i = 0; i < 15; i++) desk = both(desk, ["<c-b>", i % 2 === 0 ? "|" : "-"]);
	const tilesIn = (d: any) => d.workspaces.flatMap((ws: any) => [...tiles(ws.layout.root)]);
	const kept = (a: any, b: any) => {
		const old = new Set(tilesIn(a));
		return `${tilesIn(b).filter((t: any) => old.has(t)).length}/${tilesIn(b).length}`;
	};
	const focused = both(desk, ["<c-b>", "h"]);
	const splitted = both(desk, ["<c-b>", "|"]);
	const wire = (v: any) => JSON.parse(JSON.stringify(v));
	const data = wire(focused);
	const timed = (n: number, f: () => void) => {
		const t = performance.now();
		for (let i = 0; i < n; i++) f();
		return (performance.now() - t) / n;
	};
	// Pick 4b: the store against the tree, on the host's side, on this same desk.
	const {setShows} = await import(join(appDir, "src/desk/layout/index.ts"));
	const {toStore, fromKept} = await import(join(appDir, "src/desk/store.ts")).catch(() => ({
		toStore: null,
		fromKept: null,
	}));
	if (toStore !== null) {
		const saved = {workspaces: desk.workspaces, active: desk.active, next: desk.next};
		const store = wire(toStore(saved));
		const asTree = wire(saved);
		const ws = desk.workspaces[0];
		const run = {kind: "tsh", run: {id: "r", program: "map"}};
		console.log({
			savedBytesTree: JSON.stringify(saved).length,
			savedBytesStore: JSON.stringify(store).length,
			toStoreMs: timed(2000, () => toStore(saved)),
			fromKeptMs: timed(2000, () => fromKept(store)),
			treePassThroughMs: timed(2000, () => fromKept(asTree)),
			setShowsTreeMs: timed(200000, () => setShows(ws.layout, "t9", run)),
			setShowsStoreMs: timed(200000, () => ({
				...store.tiles,
				t9: {...store.tiles.t9, shows: run},
			})),
		});
	}
	const LONG = {
		program: "markdown",
		data: {text: LONG_MARKDOWN(200), blocks: new Array(200).fill({a: 1})},
	};
	console.log({
		tiles: tilesIn(desk).length,
		bytes: JSON.stringify(desk).length,
		keptAfterFocus: kept(desk, focused),
		keptAfterSplit: kept(desk, splitted),
		keptAfterWire: kept(focused, wire(focused)),
		keptAfterShare: kept(focused, share(focused, wire(focused))),
		sameDeskAfterShare: share(data, wire(data)) === data,
		shareMs: timed(2000, () => share(desk, wire(focused))),
		wireOnlyMs: timed(2000, () => wire(focused)),
		shareLongViewMs: timed(2000, () => share(LONG, wire(LONG))),
	});
} else {
	console.error("176-bench: build <label> | run <label> <moment> ... | open <label> | list");
	process.exitCode = 2;
}
void spawn;
