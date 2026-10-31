import {type ChildProcess, spawn} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {request} from "node:http";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {type Browser, chromium, type Page} from "playwright";

// The slice, driven the way a person would, in real headless Chromium, with a real `kill -9`.
// Each run starts its own dev command on a free port with a data folder of its own, and removes
// both after. It asserts counts, mirroring, the fold in one window only, and recovery.
//
//   node next/e2e.ts [--runs=5] [--shots=<folder>]

const flag = (name: string): string | undefined =>
	process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const RUNS = Number(flag("runs") ?? "1");
const SHOTS = flag("shots");
const CLICKS = 10;
const WAIT_MS = 30_000;

const check = (ok: boolean, what: string): void => {
	if (!ok) throw new Error(`failed: ${what}`);
};

const until = async <A>(what: string, read: () => Promise<A | undefined>): Promise<A> => {
	const end = Date.now() + WAIT_MS;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((done) => setTimeout(done, 15));
	}
};

const freePort = (): Promise<number> =>
	new Promise((done, fail) => {
		const server = createServer();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const at = server.address();
			const port = typeof at === "object" && at !== null ? at.port : 0;
			server.close(() => done(port));
		});
	});

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const median = (list: readonly number[]): number => {
	const sorted = [...list].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

type Up = {readonly node: number; readonly workerd: number; readonly ms: number};

/** The dev command, with every brain it has started so far. */
const startDev = (port: number, data: string) => {
	const script = fileURLToPath(new URL("dev.ts", import.meta.url));
	const dev: ChildProcess = spawn(process.execPath, [script, `--port=${port}`, `--data=${data}`], {
		stdio: ["ignore", "pipe", "inherit"],
	});
	const ups: Up[] = [];
	let rest = "";
	dev.stdout?.on("data", (chunk: Buffer) => {
		rest += chunk.toString("utf8");
		const lines = rest.split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) {
			if (line.startsWith("brain up: ")) ups.push(JSON.parse(line.slice("brain up: ".length)));
		}
	});
	return {dev, ups};
};

/** SIGTERM, and wait for it to be gone. It kills its brain's group on the way out. */
const stopDev = async (dev: ChildProcess): Promise<void> => {
	if (dev.exitCode !== null || dev.signalCode !== null) return;
	const gone = new Promise((done) => dev.on("exit", done));
	dev.kill("SIGCONT");
	dev.kill("SIGTERM");
	await gone;
};

const countIn = (page: Page, tile: string): Promise<string> =>
	page.locator(`[data-tile="${tile}"] [data-count]`).innerText();

const number = async (page: Page, tile: string): Promise<number | undefined> => {
	const text = await page.locator(`[data-tile="${tile}"] [data-count]`).innerText({timeout: 1000});
	const n = Number(text);
	return text === "" || Number.isNaN(n) ? undefined : n;
};

const linkIn = (page: Page): Promise<string | null> =>
	page.locator("[data-link]").getAttribute("data-link");

const focusIn = (page: Page): Promise<string | null> =>
	page.locator('[data-focused="true"]').getAttribute("data-tile");

const countIs = (page: Page, tile: string, n: number) =>
	until(`${tile} shows ${n}`, async () => ((await number(page, tile)) === n ? true : undefined));

const linkIs = (page: Page, is: string) =>
	until(`link is ${is}`, async () => ((await linkIn(page)) === is ? true : undefined));

const focusIs = (page: Page, tile: string) =>
	until(`focus on ${tile}`, async () => ((await focusIn(page)) === tile ? true : undefined));

const plus = (page: Page, tile: string) => page.locator(`[data-tile="${tile}"] .plus`).click();

/** When a tile's count changed and when a click landed, by the page's clock: one per browser. */
const watchCount = (page: Page, tile: string) =>
	page.evaluate((id) => {
		const el = document.querySelector(`[data-tile="${id}"] [data-count]`);
		if (el === null) throw new Error("no count");
		const seen: Record<string, number> = {};
		new MutationObserver(() => {
			seen[el.textContent ?? ""] = Date.now();
		}).observe(el, {childList: true, characterData: true, subtree: true});
		document.addEventListener("click", () => Reflect.set(window, "clicked", Date.now()), true);
		Reflect.set(window, "seen", seen);
	}, tile);

const seenAt = (page: Page, n: number) =>
	page.evaluate((key) => {
		const seen = Reflect.get(window, "seen");
		return seen[key] as number | undefined;
	}, String(n));

const clickedAt = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "clicked") as number | undefined);

/** A page's address with a made-up Host: what a site that rebinds its name to here would send. */
const statusWithHost = (port: number, host: string): Promise<number> =>
	new Promise((done, fail) => {
		const asked = request({host: "127.0.0.1", port, path: "/", headers: {host}}, (answer) => {
			answer.resume();
			done(answer.statusCode ?? 0);
		});
		asked.on("error", fail);
		asked.end();
	});

/** A plain JSON-RPC peer, for what a window does not show: the ledger's numbers and refusals. */
const probe = async (port: number) => {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/peer/probe-${Date.now()}`, {
		headers: {origin: `http://127.0.0.1:${port}`},
	} as never);
	const waiting = new Map<string, (value: {result?: unknown; error?: unknown}) => void>();
	socket.onmessage = (event) => {
		if (event.data === "pong") return;
		const frame = JSON.parse(String(event.data));
		if (frame.id !== undefined) waiting.get(frame.id)?.(frame);
	};
	await new Promise((done, fail) => {
		socket.onopen = done;
		socket.onerror = fail;
	});
	let n = 0;
	const call = (method: string, params: unknown) =>
		new Promise<{result?: unknown; error?: unknown}>((done) => {
			const id = method === "initialize" ? "hello" : `p-${++n}`;
			waiting.set(id, done);
			socket.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		});
	const hello = await call("initialize", {versions: [1], has: [], ping: "30s"});
	check(hello.error === undefined, "the probe's hello is answered");
	return {call, close: () => socket.close()};
};

type Entry = {
	readonly stream: string;
	readonly pos: number;
	readonly rev: number;
	readonly by: string;
	readonly kind: string;
	readonly body: {readonly hash?: string};
};

const shot = async (page: Page, name: string, run: number): Promise<void> => {
	if (SHOTS === undefined || run !== 1) return;
	await page.screenshot({path: join(SHOTS, `${name}.png`)});
};

const oneRun = async (browser: Browser, run: number) => {
	const port = await freePort();
	const data = mkdtempSync(join(tmpdir(), "fabrika-next-e2e-"));
	let {dev, ups} = startDev(port, data);
	const url = `http://127.0.0.1:${port}/?ping=1s`;
	const context = await browser.newContext({viewport: {width: 1280, height: 800}});
	const stopped: number[] = [];
	const report: Record<string, number> = {};
	try {
		const first = await until("the brain is up", async () => ups[0]);
		report.first_boot_ms = first.ms;

		// Step 1: two tiles, in a window.
		const a = await context.newPage();
		const errors: string[] = [];
		a.on("pageerror", (e) => errors.push(e.message));
		const frames: string[] = [];
		a.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
		await a.goto(url);
		await linkIs(a, "online");
		await countIs(a, "t1", 0);
		await countIs(a, "t2", 0);

		// Step 3 comes early so step 2 can be measured in both windows.
		const b = await context.newPage();
		await b.goto(url);
		await linkIs(b, "online");
		await countIs(b, "t1", 0);
		await focusIs(b, "t1");
		await shot(a, "wide", run);

		// Liveness: a text pong comes back, with no JSON (T6).
		await until("a text pong", async () => (frames.includes("pong") ? true : undefined));

		// Step 2: click, and it lands in both windows.
		await watchCount(a, "t1");
		await watchCount(b, "t1");
		const clickA: number[] = [];
		const clickB: number[] = [];
		for (let i = 1; i <= CLICKS; i++) {
			await plus(a, "t1");
			await countIs(a, "t1", i);
			await countIs(b, "t1", i);
			const at = (await clickedAt(a)) ?? 0;
			const atA = await seenAt(a, i);
			const atB = await seenAt(b, i);
			check(atA !== undefined && atB !== undefined, `count ${i} was seen changing`);
			clickA.push((atA ?? 0) - at);
			clickB.push((atB ?? 0) - at);
		}
		report.click_to_count_a_ms = median(clickA);
		report.click_to_count_b_ms = median(clickB);
		report.click_to_count_max_ms = Math.max(...clickA, ...clickB);

		// The second tile counts on its own, and its focus moves in both windows.
		await plus(b, "t2");
		await countIs(a, "t2", 1);
		await countIs(b, "t2", 1);
		await focusIs(a, "t2");
		await focusIs(b, "t2");
		await a.locator('[data-tile="t1"]').click({position: {x: 20, y: 10}});
		await focusIs(a, "t1");
		await focusIs(b, "t1");

		// The ledger: rev and pos as D3 says, and the code that ran recorded.
		const peer = await probe(port);
		const read = async (stream: string) => {
			const answer = await peer.call("ledger.read", {stream, after: 0});
			return (answer.result ?? []) as readonly Entry[];
		};
		const inbox = await read("counter:1/inbox");
		check(inbox.length === CLICKS, `the inbox holds ${CLICKS} letters, has ${inbox.length}`);
		check(
			inbox.every((e, i) => e.pos === i + 1),
			"pos counts 1, 2, 3 inside a stream",
		);
		check(
			inbox.every((e, i) => i === 0 || e.rev > (inbox[i - 1]?.rev ?? 0)),
			"rev grows across the project",
		);
		check(
			inbox.every((e) => e.by.startsWith("w-")),
			"a letter says which window sent it",
		);
		const started = await read("counter:1");
		check(
			started[0]?.kind === "started" && (started[0].body.hash?.length ?? 0) === 64,
			"the log says which code ran",
		);
		const rang = await peer.call("ledger.wait", {stream: "counter:1/inbox", after: 0});
		check(typeof rang.result === "number", "wait answers at once when there is news");
		const nothing = await peer.call("window.msg", {
			pid: "counter:1",
			id: "bad-1",
			m: {type: "nonsense"},
			said: "now",
		});
		check(nothing.error !== undefined, "a Msg the program refuses gets an error");
		check((await read("counter:1/inbox")).length === CLICKS, "a refused Msg leaves no line");
		// The same letter twice, as a resend after a lost answer would be: one line (T7).
		const letter = {pid: "counter:2", id: "again-1", m: {type: "plus", saw: 0}, said: "now"};
		const once = await peer.call("window.msg", letter);
		const twice = await peer.call("window.msg", letter);
		check(
			JSON.stringify(once.result) === JSON.stringify(twice.result),
			"a resend gets the same place",
		);
		await countIs(a, "t2", 2);
		check((await read("counter:2/inbox")).length === 2, "a resend is saved once");
		peer.close();

		// A site that points its name at this address gets nothing (T3).
		check((await statusWithHost(port, "elsewhere.example")) === 421, "a strange Host is refused");

		// A website gets no socket here (T3).
		const refused = await new Promise<boolean>((done) => {
			const socket = new WebSocket(`ws://127.0.0.1:${port}/peer/evil`, {
				headers: {origin: "https://elsewhere.example"},
			} as never);
			socket.onopen = () => done(false);
			socket.onerror = () => done(true);
		});
		check(refused, "a dial from another origin is refused");

		// Step 4: one window goes narrow. Only it folds, and the layout stays in percent.
		const layoutBefore = await a.locator("[data-layout]").getAttribute("data-layout");
		const boxA = await a.locator('[data-tile="t1"]').boundingBox();
		await b.setViewportSize({width: 420, height: 800});
		await until("b folds", async () =>
			(await b.locator('[data-tile="t2"]').getAttribute("data-folded")) === "true"
				? true
				: undefined,
		);
		check(
			(await b.locator('[data-tile="t1"]').getAttribute("data-folded")) === "false",
			"the focused tile stays open",
		);
		check(
			(await a.locator('[data-tile="t2"]').getAttribute("data-folded")) === "false",
			"the wide window does not fold",
		);
		const boxAfter = await a.locator('[data-tile="t1"]').boundingBox();
		check(
			boxA?.width === boxAfter?.width && boxA?.height === boxAfter?.height,
			"the wide window's tile did not move",
		);
		check(
			(await b.locator("[data-layout]").getAttribute("data-layout")) === layoutBefore,
			"the layout is the same percents in both windows",
		);
		const widthB = (await b.locator('[data-tile="t2"]').boundingBox())?.width ?? 0;
		check(widthB === 36, `the folded tile is a strip, is ${widthB}`);
		await shot(b, "narrow", run);

		// The folded strip still shows its count, and a click unfolds it, in that window only.
		check((await countIn(b, "t2")) === "2", "a folded tile still shows its count");
		await b.locator('[data-tile="t2"]').click();
		await focusIs(b, "t2");
		await focusIs(a, "t2");
		await until("the fold swaps", async () =>
			(await b.locator('[data-tile="t1"]').getAttribute("data-folded")) === "true"
				? true
				: undefined,
		);
		check(
			(await a.locator('[data-tile="t1"]').getAttribute("data-folded")) === "false",
			"focus moving does not fold the wide window",
		);
		await a.locator('[data-tile="t1"]').click({position: {x: 20, y: 10}});
		await focusIs(b, "t1");
		await b.setViewportSize({width: 1280, height: 800});

		// Step 5a: kill workerd, and hold the restart so the lost link can be seen.
		const hold = dev.pid;
		check(hold !== undefined, "the dev command has a pid");
		const up = ups[ups.length - 1];
		check(up !== undefined, "a brain is up");
		process.kill(hold ?? 0, "SIGSTOP");
		stopped.push(hold ?? 0);
		process.kill(up?.workerd ?? 0, "SIGKILL");
		await linkIs(a, "waiting").catch(() => linkIs(a, "dialing"));
		await until("both windows show the lost link", async () =>
			(await linkIn(a)) !== "online" && (await linkIn(b)) !== "online" ? true : undefined,
		);
		// A press while lost waits in the outbox.
		await plus(a, "t1");
		await until("the press waits", async () =>
			(await a.locator("[data-waiting]").count()) === 1 ? true : undefined,
		);
		check((await number(a, "t1")) === CLICKS, "the count holds while lost");
		await shot(a, "lost", run);
		process.kill(hold ?? 0, "SIGCONT");
		stopped.pop();
		const held = Date.now();
		await until("a new brain", async () => (ups.length >= 2 ? true : undefined));
		await linkIs(a, "online");
		await linkIs(b, "online");
		report.held_back_ms = Date.now() - held;
		await countIs(a, "t1", CLICKS + 1);
		await countIs(b, "t1", CLICKS + 1);
		await countIs(a, "t2", 2);
		check(
			(await a.locator("[data-waiting]").count()) === 0,
			"nothing waits after the link comes back",
		);
		await shot(a, "recovery", run);

		// Step 5b: kill workerd with no hold. The dev command restarts it.
		const secondUp = ups[ups.length - 1];
		const killedWorkerd = Date.now();
		process.kill(secondUp?.workerd ?? 0, "SIGKILL");
		await until("lost", async () => ((await linkIn(a)) !== "online" ? true : undefined));
		report.notice_ms = Date.now() - killedWorkerd;
		await linkIs(a, "online");
		await linkIs(b, "online");
		report.reconnect_after_workerd_kill_ms = Date.now() - killedWorkerd;
		await countIs(a, "t1", CLICKS + 1);
		await countIs(b, "t1", CLICKS + 1);

		// Step 5c: kill the Node process that holds Miniflare. Its workerd goes with its group.
		const thirdUp = await until("the third brain", async () => ups[2]);
		const killedNode = Date.now();
		process.kill(thirdUp.node, "SIGKILL");
		await until("the fourth brain", async () => ups[3]);
		await linkIs(a, "online");
		await linkIs(b, "online");
		report.reconnect_after_node_kill_ms = Date.now() - killedNode;
		await until("the old workerd is gone", async () =>
			isAlive(thirdUp.workerd) ? undefined : true,
		);
		report.restart_ms = thirdUp.ms;
		await plus(a, "t1");
		await countIs(a, "t1", CLICKS + 2);
		await countIs(b, "t1", CLICKS + 2);
		await focusIs(b, "t1");

		// Each letter saved exactly once, through all of it.
		const after = await probe(port);
		const answer = await after.call("ledger.read", {stream: "counter:1/inbox", after: 0});
		const lines = (answer.result ?? []) as readonly Entry[];
		check(lines.length === CLICKS + 2, `every press once, has ${lines.length}`);
		after.close();

		// A brain that hangs instead of dying: only the missing pong can tell (T6).
		const fourth = await until("the fourth brain", async () => ups[3]);
		const hung = Date.now();
		process.kill(fourth.workerd, "SIGSTOP");
		stopped.push(fourth.workerd);
		await until("the windows notice the silence", async () =>
			(await linkIn(a)) !== "online" ? true : undefined,
		);
		report.hang_noticed_ms = Date.now() - hung;
		process.kill(fourth.workerd, "SIGCONT");
		stopped.pop();
		await linkIs(a, "online");
		await linkIs(b, "online");
		await countIs(a, "t1", CLICKS + 2);

		// The whole command stops and starts again on the same folder: the counts are on disk.
		await stopDev(dev);
		await until("stopping the command leaves no workerd and no brain", async () =>
			!isAlive(fourth.workerd) && !isAlive(fourth.node) ? true : undefined,
		);
		({dev, ups} = startDev(port, data));
		await until("the brain is back", async () => ups[0]);
		await linkIs(a, "online");
		await countIs(a, "t1", CLICKS + 2);
		await countIs(a, "t2", 2);
		await a.reload();
		await linkIs(a, "online");
		await countIs(a, "t1", CLICKS + 2);

		check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
		return report;
	} finally {
		for (const pid of stopped) process.kill(pid, "SIGCONT");
		await context.close();
		await stopDev(dev);
		// Only the newest one: an older pid may by now belong to someone else's process.
		const last = ups[ups.length - 1];
		if (last !== undefined && isAlive(last.workerd)) process.kill(last.workerd, "SIGKILL");
		if (last !== undefined && isAlive(last.node)) process.kill(last.node, "SIGKILL");
		rmSync(data, {recursive: true, force: true});
	}
};

if (SHOTS !== undefined) mkdirSync(SHOTS, {recursive: true});
const browser = await chromium.launch({headless: true});
const results: Record<string, number>[] = [];
let failed = 0;
try {
	for (let run = 1; run <= RUNS; run++) {
		const started = Date.now();
		try {
			const report = await oneRun(browser, run);
			results.push(report);
			process.stdout.write(
				`run ${run}: pass in ${Date.now() - started} ms ${JSON.stringify(report)}\n`,
			);
		} catch (error) {
			failed += 1;
			process.stdout.write(`run ${run}: FAIL ${String(error)}\n`);
		}
	}
} finally {
	await browser.close();
}
process.stdout.write(`passed ${results.length} of ${RUNS}\n`);
const keys = Object.keys(results[0] ?? {});
for (const key of keys) {
	const values = results.flatMap((r) => (r[key] === undefined ? [] : [r[key]]));
	process.stdout.write(`${key}: median ${median(values)}, max ${Math.max(...values)}\n`);
}
process.exitCode = failed === 0 ? 0 : 1;
