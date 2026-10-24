// Node edge: this check owns a disposable host process, a native shell and real browsers.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {WebSocket} from "ws";

const directory = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.FABRIKA_GUI_CHECK_PORT ?? 5201);
const origin = `http://127.0.0.1:${port}`;
const data = await mkdtemp(join(tmpdir(), "fabrika-gui-check-"));
const evidence = resolve(directory, "../../runs/gui-check");
await mkdir(evidence, {recursive: true});
const report = {cases: [], pageErrors: [], node: process.version};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, name, timeout = 20000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check().catch(() => false);
		if (result) return result;
		await sleep(80);
	}
	throw Error(`Timed out: ${name}`);
};
const health = () => fetch(`${origin}/health`).then((response) => response.json());
const pass = (name, result = {}) => {
	report.cases.push({name, ...result});
	console.log(`PASS ${name}`);
};
let child;
let browser;
let log = "";
const boot = () => {
	child = spawn(process.execPath, ["src/main.ts"], {
		cwd: directory,
		env: {...process.env, FABRIKA_GUI_PORT: String(port), FABRIKA_GUI_DATA: data},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (data) => {
		log = (log + data).slice(-65536);
	});
	child.stderr.on("data", (data) => {
		log = (log + data).slice(-65536);
	});
	return until(async () => {
		const value = await health();
		return value.pid === child.pid ? value : false;
	}, "owned test host starts");
};
const denied = (token, requestOrigin = origin) =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(`${origin.replace("http", "ws")}/ws?token=${token}`, {
			headers: {Origin: requestOrigin},
		});
		const timer = setTimeout(() => {
			socket.terminate();
			reject(Error("Upgrade refusal timed out"));
		}, 5000);
		socket.on("error", () => {});
		socket.on("unexpected-response", (_request, response) => {
			clearTimeout(timer);
			response.resume();
			assert.equal(response.statusCode, 403);
			resolve(403);
		});
		socket.on("open", () => {
			clearTimeout(timer);
			socket.close();
			reject(Error("Invalid upgrade accepted"));
		});
	});

try {
	await boot();
	browser = await chromium.launch({headless: true});
	let context = await browser.newContext({
		viewport: {width: 1280, height: 800},
		permissions: ["clipboard-read", "clipboard-write"],
	});
	let page = await context.newPage();
	const watch = () => page.on("pageerror", (error) => report.pageErrors.push(error.message));
	watch();
	await page.goto(origin);
	const pane = (id) => page.locator(`[data-pane="${id}"]`);
	await pane("main").getByRole("textbox", {name: "tsh command"}).waitFor();
	assert.equal(await pane("main").getAttribute("data-kind"), "tsh");
	const line = async (id, text) => {
		const input = pane(id).getByRole("textbox", {name: "tsh command"});
		await input.fill(text);
		await input.press("Enter");
	};
	await line("main", "seq --to 3 | double");
	await until(
		async () =>
			(await pane("main").locator(".tsh-output").innerText()).includes(
				"double 2\ndouble 4\ndouble 6",
			),
		"real tsh pipe",
	);
	pass("New desk starts real tsh and runs its typed pipe");
	await line("main", "counter");
	await pane("main").locator("[data-count]").waitFor();
	await pane("main").getByRole("button", {name: "Add 1", exact: true}).click();
	await until(
		async () => (await pane("main").locator("[data-count]").innerText()) === "1",
		"saved counter action",
	);
	pass("counter replaces tsh in the same pane and accepts an action");
	await page.getByRole("button", {name: "New pane", exact: true}).click();
	const terminalId = await until(
		async () => (await health()).panes.find((pane) => pane.id !== "main")?.id,
		"second pane",
	);
	await line(terminalId, "terminal");
	const term = () => pane(terminalId);
	const input = () => term().locator(".terminal-screen textarea");
	await input().waitFor();
	await until(
		async () => term().getByRole("button", {name: "Ctrl+C", exact: true}).isEnabled(),
		"native shell is ready",
	);
	const command = async (text) => {
		await input().focus();
		await input().pressSequentially(text);
		await input().press("Enter");
	};
	const text = () => term().getByRole("log", {name: "Terminal output"}).textContent();
	await command("printf '%s_%s\\n' GUI TYPED");
	await until(async () => (await text()).includes("GUI_TYPED"), "native shell input");
	const shellPid = await term().locator("[data-shell-pid]").getAttribute("data-shell-pid");
	const shellSession = await term().locator("[data-session]").getAttribute("data-session");
	await page.evaluate(() => navigator.clipboard.writeText("printf '%s_%s\\n' GUI PASTED"));
	await input().focus();
	await page.keyboard.press("ControlOrMeta+V");
	await page.keyboard.press("Enter");
	await until(async () => (await text()).includes("GUI_PASTED"), "browser paste");
	pass("Native terminal accepts keyboard input and browser paste");
	await command("cat");
	await input().press("Control+c");
	await command("printf '%s_%s\\n' GUI INTERRUPTED");
	await until(async () => (await text()).includes("GUI_INTERRUPTED"), "usable shell after Ctrl-C");
	await command("read -rsn1 gui_key; printf 'ESC_%d\\n' \"'$gui_key\"");
	await input().press("Escape");
	await until(async () => (await text()).includes("ESC_27"), "single Escape");
	pass("Ctrl-C returns to the shell and one Escape reaches native input");
	await term().getByRole("button", {name: "Back to tsh", exact: true}).click();
	await line(terminalId, "terminal");
	await term().locator("[data-shell-pid]").waitFor();
	assert.equal(await term().locator("[data-shell-pid]").getAttribute("data-shell-pid"), shellPid);
	await until(async () => (await text()).includes("GUI_PASTED"), "same terminal scrollback");
	pass("Returning through tsh keeps the same terminal process and output");
	await command("sleep 2; printf '%s_%s\\n' GUI BACKGROUND");
	await pane("main").getByRole("button", {name: "Run 5 steps", exact: true}).click();
	await until(
		async () => (await health()).counters.find((counter) => counter.id === "main")?.running,
		"running counter",
	);
	await pane("main")
		.getByRole("button", {name: /^Close .* window$/})
		.click();
	await page.close();
	await browser.close();
	browser = null;
	await until(async () => (await health()).clients === 0, "all viewers gone");
	const advanced = await until(async () => {
		const value = await health();
		return value.clients === 0 && value.counters[0]?.count > 1 ? value.counters[0].count : false;
	}, "headless progress");
	await until(async () => (await health()).counters[0]?.count === 6, "headless job finish");
	pass("Hidden counter advances and finishes while every browser is closed", {
		countObservedWithoutViewer: advanced,
	});
	browser = await chromium.launch({headless: true});
	context = await browser.newContext({viewport: {width: 1280, height: 800}});
	page = await context.newPage();
	watch();
	await page.goto(origin);
	await until(
		async () => (await page.locator("[data-connection]").innerText()) === "Connected",
		"fresh browser",
	);
	assert.equal(await pane("main").count(), 0);
	await page.getByRole("navigation", {name: "Your panes"}).getByRole("button").first().click();
	await pane("main").locator("[data-count]").waitFor();
	assert.equal(await pane("main").locator("[data-count]").innerText(), "6");
	assert.equal(await term().locator("[data-shell-pid]").getAttribute("data-shell-pid"), shellPid);
	await until(async () => (await text()).includes("GUI_BACKGROUND"), "shell ran without a viewer");
	await page.reload();
	await until(
		async () => (await pane("main").locator("[data-count]").innerText()) === "6",
		"refresh state",
	);
	pass("Fresh attach and reload preserve saved count, hidden panes and live shell");
	await page.screenshot({path: join(evidence, "desktop.png"), fullPage: true});
	await page.setViewportSize({width: 320, height: 820});
	const layout = await page.evaluate(() => ({
		width: innerWidth,
		content: document.documentElement.scrollWidth,
	}));
	assert.equal(layout.width, layout.content);
	await page.screenshot({path: join(evidence, "mobile.png"), fullPage: true});
	pass("320px layout has no horizontal overflow");
	await page.setViewportSize({width: 1280, height: 800});
	const oldToken = await fetch(`${origin}/session`).then((response) => response.json());
	await pane("main").getByRole("button", {name: "Run 5 steps", exact: true}).click();
	await until(async () => {
		const count = (await health()).counters[0]?.count;
		return count > 6 && count < 11;
	}, "partial job");
	// Leave the pane on tsh before the crash: recovery must remember the hidden counter too.
	await pane("main").getByRole("button", {name: "Back to tsh", exact: true}).click();
	await pane("main").getByRole("textbox", {name: "tsh command"}).waitFor();
	child.kill("SIGKILL");
	await new Promise((resolve) => child.once("exit", resolve));
	await boot();
	await until(async () => (await health()).counters[0]?.count === 11, "resumed hidden job");
	await until(
		async () => (await page.locator("[data-connection]").innerText()) === "Connected",
		"automatic reconnect",
	);
	await line("main", "counter");
	await pane("main").locator("[data-count]").waitFor();
	await until(
		async () => (await pane("main").locator("[data-count]").innerText()) === "11",
		"restored original target",
	);
	assert.notEqual(
		await term().locator("[data-shell-pid]").getAttribute("data-shell-pid"),
		shellPid,
	);
	assert.notEqual(
		await term().locator("[data-session]").getAttribute("data-session"),
		shellSession,
	);
	await until(
		async () => !(await text()).includes("GUI_BACKGROUND"),
		"replacement shell clears the previous screen",
	);
	await command("printf '%s_%s\\n' GUI REPLACED");
	await until(
		async () => (await text()).includes("GUI_REPLACED"),
		"replacement shell accepts input",
	);
	pass(
		"Node crash resumes hidden work to its original target; browser reconnects and terminal gets a new shell",
	);
	const session = await fetch(`${origin}/session`).then((response) => response.json());
	await denied("");
	await denied(oldToken.token);
	await denied(session.token, "https://foreign.example");
	const refused = await new Promise((resolve, reject) => {
		const ws = new WebSocket(`${origin.replace("http", "ws")}/ws?token=${session.token}`, {
			headers: {Origin: origin},
		});
		let count = 0;
		ws.on("error", reject);
		ws.on("open", () => {
			ws.send("invalid json");
			ws.send(
				JSON.stringify({type: "counter", pane: "main", id: "bad-action", message: {type: "reset"}}),
			);
			ws.send(
				JSON.stringify({
					type: "counter",
					pane: terminalId,
					id: "wrong-pane",
					message: {type: "add"},
				}),
			);
		});
		ws.on("message", (raw) => {
			if (JSON.parse(String(raw)).type === "refused" && ++count === 3) {
				ws.close();
				resolve(count);
			}
		});
	});
	assert.equal(refused, 3);
	assert.equal((await health()).counters[0].count, 11);
	pass("Origin, startup token, malformed input, unknown action and wrong program are refused");
	await page.getByRole("button", {name: /^Open terminal pipe/}).click();
	const demo = () => page.locator('[data-kind="pipe"]');
	const sender = () => demo().getByRole("region", {name: "Sender terminal", exact: true});
	const receiver = () => demo().getByRole("region", {name: "Receiver terminal", exact: true});
	const sentText = () => sender().getByRole("log", {name: "Terminal output"}).textContent();
	const receivedText = () => receiver().getByRole("log", {name: "Terminal output"}).textContent();
	const traffic = () => demo().getByRole("log", {name: "Pipe traffic log"}).textContent();
	const sessionIds = async () => ({
		from: await sender().locator("[data-session]").getAttribute("data-session"),
		to: await receiver().locator("[data-session]").getAttribute("data-session"),
	});
	const sendLine = async (line) => {
		const input = sender().locator(".terminal-screen textarea");
		await input.pressSequentially(line);
		await input.press("Enter");
	};
	await until(
		async () => demo().getByRole("button", {name: "Pause connection"}).isEnabled(),
		"native pipe starts",
	);
	const pipeSessions = await sessionIds();
	await sendLine("hello from one terminal");
	await until(
		async () => (await receivedText()).includes("HELLO FROM ONE TERMINAL"),
		"native terminal to terminal output",
	);
	assert.ok((await sentText()).includes("hello from one terminal"));
	assert.ok((await traffic()).includes("queued"));
	assert.ok(
		(await demo().getByRole("region", {name: "Current port values"}).textContent()).includes(
			"HELLO FROM ONE TERMINAL",
		),
	);
	assert.equal(await demo().locator(".pipe-wire").count(), 1);
	assert.equal(await demo().locator(".pipe-packet").count(), 1);
	pass(
		"Two native terminals exchange text through Fabrika with real port values and a traffic-driven wire",
	);
	await demo().getByRole("button", {name: "Pause connection"}).click();
	await demo().getByRole("button", {name: "Resume connection"}).waitFor();
	await sendLine("skip this line");
	await until(async () => (await traffic()).includes("discarded"), "paused traffic is visible");
	assert.equal((await receivedText()).includes("SKIP THIS LINE"), false);
	await demo().getByRole("button", {name: "Resume connection"}).click();
	await demo().getByRole("button", {name: "Pause connection"}).waitFor();
	await sendLine("back online");
	await until(async () => (await receivedText()).includes("BACK ONLINE"), "resumed terminal pipe");
	assert.equal((await receivedText()).includes("SKIP THIS LINE"), false);
	assert.deepEqual(await sessionIds(), pipeSessions);
	pass(
		"Pausing records discarded text; resuming forwards new text without restarting either process",
	);
	await page.getByRole("button", {name: "Disconnect", exact: true}).click();
	await page.getByRole("button", {name: "Reconnect", exact: true}).waitFor();
	await until(
		async () => !(await demo().getByRole("button", {name: "Pause connection"}).isEnabled()),
		"disconnected pipe rejects input",
	);
	await page.getByRole("button", {name: "Reconnect", exact: true}).click();
	await until(
		async () => demo().getByRole("button", {name: "Pause connection"}).isEnabled(),
		"pipe view reconnects",
	);
	const pipePane = await demo().getAttribute("data-pane");
	await demo()
		.getByRole("button", {name: /^Close .* window$/})
		.click();
	await page
		.getByRole("navigation", {name: "Your panes"})
		.getByRole("button", {name: /Terminal pipe/})
		.click();
	await until(async () => demo().getAttribute("data-pane"), "pipe view reopens");
	assert.equal(await demo().getAttribute("data-pane"), pipePane);
	assert.deepEqual(await sessionIds(), pipeSessions);
	await page.reload();
	await until(
		async () => (await receivedText()).includes("BACK ONLINE"),
		"pipe replay after reload",
	);
	assert.deepEqual(await sessionIds(), pipeSessions);
	pass(
		"Disconnect, close/reopen and page reload retain the same terminal processes and connection",
	);
	await demo().getByRole("button", {name: "Restart demo"}).click();
	await until(
		async () => (await sessionIds()).from !== pipeSessions.from,
		"pipe restarts new native sessions",
	);
	await until(
		async () => !(await receivedText()).includes("BACK ONLINE"),
		"restarted receiver clears old screen",
	);
	await demo().getByRole("button", {name: "Send hello bro ↵"}).click();
	await until(async () => (await receivedText()).includes("HELLO BRO"), "sample uses native stdin");
	await demo().scrollIntoViewIfNeeded();
	await page.screenshot({path: join(evidence, "pipe-desktop.png"), fullPage: true});
	await page.emulateMedia({reducedMotion: "reduce"});
	assert.equal(
		await demo()
			.locator(".pipe-packet")
			.evaluate((node) => getComputedStyle(node).display),
		"none",
	);
	await page.setViewportSize({width: 320, height: 820});
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
	await page.screenshot({path: join(evidence, "pipe-mobile.png"), fullPage: true});
	pass(
		"Restart replaces sessions and clears old output; reduced motion and 320px layout keep real traffic readable",
	);
	assert.deepEqual(report.pageErrors, []);
	await page.screenshot({path: join(evidence, "recovered.png"), fullPage: true});
} catch (error) {
	report.failure = String(error);
	throw error;
} finally {
	await browser?.close();
	if (child && child.exitCode === null) {
		child.kill("SIGTERM");
		await new Promise((resolve) => child.once("exit", resolve));
	}
	await writeFile(join(evidence, "cases.json"), `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(join(evidence, "host.log"), log);
}
