// Experiment 234: P19's first step, the unsigned crash spike (docs/plan, P19's plan "First
// executable step"). P12's real local stage runs under the app's own Electron binary with
// ELECTRON_RUN_AS_NODE=1, bundled to JavaScript first, as a launchd job from a short temp home under
// a fresh `dev.fabrika.spike.<hex>` label. The driver checks the plan's eight-point pass bar:
//
//   1. one Electron window and one admitted Chromium window show the same real counter
//   2. SIGKILL the launchd-managed brain parent
//   3. launchd starts one replacement, the same address returns, both windows reconnect
//   4. every acknowledged letter stays once; one held while disconnected lands once
//   5. the replacement leaves no old workerd or Alchemy child group behind
//   6. kill Electron instead: the brain stays alive and Chromium keeps working
//   7. reopen Electron: it finds that service and starts no second brain
//   8. a clean stop removes the label and all its children, and does not restart
//
// It also measures four healthy starts and the stop-confirmation delay, the readings the plan
// sets ThrottleInterval and the poll schedule from. It writes
// experiments/results/234-electron-brain-restart.json; the write-up is the lead's.
//
//   nice -n 19 node experiments/234-electron-brain-restart.ts [--throttle <s>]
//
// Needs P12's `next/apps/fabrika/dev.ts` (its flags as P12's own tests pass them) and `grant.ts`,
// and P18's client page with a counter at `[data-testid=counter-count]`. macOS only. One Electron
// app at a time. No network beyond loopback, no model, $0. A `finally` boots the label out, kills
// what is left and deletes the temp home; the result says what cleanup found. Machine paths and
// signing identities stay out of the result.
import {execFileSync, spawnSync} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {join, resolve} from "node:path";
import {build} from "esbuild";
import type {Browser, ElectronApplication, Page} from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const APP = join(ROOT, "next/apps/fabrika");
const fromApp = createRequire(join(APP, "package.json"));
const electronPath: string = fromApp("electron");
const {_electron, chromium} = fromApp("playwright") as typeof import("playwright");

const arg = (name: string, fallback: string) => {
	const at = process.argv.indexOf(name);
	return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const throttle = Number(arg("--throttle", "5"));
const label = `dev.fabrika.spike.${randomBytes(4).toString("hex")}`;
const domain = `gui/${process.getuid?.() ?? 0}`;
const home = mkdtempSync("/tmp/fh.");
const port = 41_000 + Math.floor(Math.random() * 4000);
const url = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const now = () => performance.now();

const result: Record<string, unknown> = {
	at: new Date().toISOString(),
	electron: (fromApp("electron/package.json") as {version: string}).version,
	macOS: execFileSync("sw_vers", ["-productVersion"], {encoding: "utf8"}).trim(),
	label: "dev.fabrika.spike.<random>",
	throttle,
	bar: {} as Record<string, boolean | string>,
	readings: {} as Record<string, unknown>,
};
const bar = result["bar"] as Record<string, boolean | string>;
const readings = result["readings"] as Record<string, unknown>;

const signature = (): string => {
	const bundle = electronPath.replace(/\/Contents\/MacOS\/Electron$/, "");
	const {stderr} = spawnSync("codesign", ["-dv", bundle], {encoding: "utf8"});
	return /Signature=adhoc/.test(stderr)
		? "adhoc"
		: /Authority=/.test(stderr)
			? "signed"
			: "unsigned";
};
const printed = () => {
	const out = spawnSync("launchctl", ["print", `${domain}/${label}`], {encoding: "utf8"});
	return {code: out.status ?? -1, pid: Number(/\bpid = (\d+)/.exec(out.stdout ?? "")?.[1] ?? 0)};
};
const alive = (pid: number) => pid > 0 && spawnSync("kill", ["-0", String(pid)]).status === 0;
const tree = (root: number): Array<number> => {
	const rows = execFileSync("ps", ["-axo", "pid=,ppid="], {encoding: "utf8"})
		.split("\n")
		.flatMap((r) => {
			const m = /^\s*(\d+)\s+(\d+)/.exec(r);
			return m ? [{pid: Number(m[1]), parent: Number(m[2])}] : [];
		});
	const pids = new Set([root]);
	for (let n = 0; n < rows.length; n++)
		for (const r of rows) if (pids.has(r.parent)) pids.add(r.pid);
	return [...pids];
};
const waitFor = async (check: () => boolean | Promise<boolean>, ms: number) => {
	const start = now();
	while (now() - start < ms) {
		if (await check()) return now() - start;
		await sleep(50);
	}
	return null;
};
const answers = async () => {
	try {
		return (await fetch(`${url}/`)).status < 500;
	} catch {
		return false;
	}
};
const count = async (page: Page) =>
	Number((await page.getByTestId("counter-count").textContent())?.trim());

/** P12's entry bundled to one JavaScript file, since Electron's Node may not run our TypeScript. */
const bundle = async () => {
	const out = join(home, "brain.js");
	await build({
		entryPoints: [join(APP, "dev.ts")],
		outfile: out,
		bundle: true,
		platform: "node",
		format: "esm",
		nodePaths: [join(APP, "node_modules")],
		logLevel: "silent",
	});
	return {out, hash: createHash("sha256").update(readFileSync(out)).digest("hex")};
};

const plist = (entry: string, person: string, founder: string, window: string) => {
	const esc = (s: string) =>
		s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	const args = [
		electronPath,
		entry,
		"--port",
		String(port),
		"--name",
		"spike-234",
		"--person",
		person,
		"--founder",
		founder,
		"--window",
		window,
	];
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Label</key><string>${esc(label)}</string>
	<key>ProgramArguments</key><array>${args.map((a) => `<string>${esc(a)}</string>`).join("")}</array>
	<key>EnvironmentVariables</key><dict>
		<key>ELECTRON_RUN_AS_NODE</key><string>1</string>
		<key>FABRIKA_HOME</key><string>${esc(home)}</string>
		<key>DO_NOT_TRACK</key><string>1</string>
		<key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
	<key>ThrottleInterval</key><integer>${throttle}</integer>
	<key>AbandonProcessGroup</key><false/>
	<key>StandardOutPath</key><string>${esc(join(home, "brain.out"))}</string>
	<key>StandardErrorPath</key><string>${esc(join(home, "brain.err"))}</string>
</dict></plist>
`;
};

/** A throwaway Electron main that opens one window on the brain's page, nothing more. */
const electronApp = () => {
	const dir = join(home, "electron-app");
	execFileSync("mkdir", ["-p", dir]);
	writeFileSync(join(dir, "package.json"), JSON.stringify({name: "spike-234", main: "main.cjs"}));
	writeFileSync(
		join(dir, "main.cjs"),
		`const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(home, "userData"))});
app.on("window-all-closed", () => {});
app.whenReady().then(() => new BrowserWindow({webPreferences: {sandbox: true, contextIsolation: true}}).loadURL(${JSON.stringify(url)}));
`,
	);
	return dir;
};

/** Admit a waiting page through P12's grant path, by the code it shows. */
const admit = async (page: Page) => {
	await page.waitForFunction(
		() => /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(document.body.innerText),
		undefined,
		{timeout: 30_000},
	);
	const code = /[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(await page.innerText("body"))?.[0] ?? "";
	execFileSync(process.execPath, [join(APP, "grant.ts"), code], {
		env: {...process.env, FABRIKA_HOME: home},
		stdio: "pipe",
	});
	await page.getByTestId("counter-count").waitFor({timeout: 30_000});
};

let browser: Browser | undefined;
let electron: ElectronApplication | undefined;
try {
	result["signature"] = signature();
	const {out, hash} = await bundle();
	readings["brainHash"] = hash;
	readings["nodeInElectron"] = execFileSync(electronPath, ["-p", "process.versions.node"], {
		env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
		encoding: "utf8",
	}).trim();
	execFileSync("ssh-keygen", [
		"-q",
		"-t",
		"ed25519",
		"-N",
		"",
		"-f",
		join(home, "person"),
		"-C",
		"",
	]);
	const founder = readFileSync(join(home, "person.pub"), "utf8").trim();
	const person = "person_01m6v5270hf3c8x2q7w9z4k5mn";
	const window = randomBytes(32).toString("base64url");
	const plistPath = join(home, "brain.plist");
	writeFileSync(plistPath, plist(out, person, founder, window));

	// Four healthy starts, each bootstrap to first answer, and the stop-confirmation delay after each.
	const starts: Array<number | null> = [];
	const stops: Array<number | null> = [];
	for (let i = 0; i < 4; i++) {
		const t = now();
		execFileSync("launchctl", ["bootstrap", domain, plistPath]);
		const ready = await waitFor(answers, 120_000);
		starts.push(ready === null ? null : now() - t);
		const s = now();
		spawnSync("launchctl", ["bootout", `${domain}/${label}`]);
		const gone = await waitFor(() => printed().code === 113, 30_000);
		stops.push(gone === null ? null : now() - s);
	}
	readings["startsMs"] = starts;
	readings["stopConfirmMs"] = stops;

	execFileSync("launchctl", ["bootstrap", domain, plistPath]);
	await waitFor(answers, 120_000);
	const first = printed().pid;
	readings["firstPid"] = "recorded";

	browser = await chromium.launch();
	const tab = await browser.newPage();
	await tab.goto(url);
	await admit(tab);
	electron = await _electron.launch({
		executablePath: electronPath,
		args: [electronApp()],
		env: {PATH: process.env["PATH"] ?? ""},
	});
	const win = await electron.firstWindow();
	await admit(win);
	await tab.getByRole("button", {name: /inc|\+/i}).click();
	bar["1 same counter in both"] =
		(await waitFor(
			async () => (await count(win)) === (await count(tab)) && (await count(tab)) === 1,
			15_000,
		)) !== null;

	const family = tree(first);
	const killedAt = now();
	process.kill(first, "SIGKILL");
	bar["2 brain parent SIGKILLed"] = true;
	await win
		.getByRole("button", {name: /inc|\+/i})
		.click()
		.catch(() => undefined);
	const back = await waitFor(() => printed().pid > 0 && printed().pid !== first, 120_000);
	const second = printed().pid;
	readings["replacementMs"] = back;
	const reconnect = await waitFor(
		async () =>
			(await count(win).catch(() => -1)) === 2 && (await count(tab).catch(() => -1)) === 2,
		120_000,
	);
	readings["recoveryMs"] = reconnect === null ? null : now() - killedAt;
	await sleep(Math.max(2000, throttle * 1000 + 1000));
	bar["3 one replacement, same address, both back"] =
		back !== null && reconnect !== null && printed().pid === second;
	bar["4 acknowledged once, held one lands once"] =
		(await count(tab)) === 2 && (await count(win)) === 2;
	bar["5 no old child group left"] =
		family.filter((pid) => pid !== first && alive(pid)).length === 0;

	const electronPid = electron.process().pid ?? 0;
	process.kill(electronPid, "SIGKILL");
	electron = undefined;
	await sleep(1500);
	await tab.reload();
	bar["6 Electron killed, brain and Chromium fine"] =
		printed().pid === second &&
		(await waitFor(async () => (await count(tab).catch(() => -1)) === 2, 30_000)) !== null;

	electron = await _electron.launch({
		executablePath: electronPath,
		args: [electronApp()],
		env: {PATH: process.env["PATH"] ?? ""},
	});
	const again = await electron.firstWindow();
	bar["7 reopen finds the same service"] =
		(await waitFor(async () => (await count(again).catch(() => -1)) === 2, 30_000)) !== null &&
		printed().pid === second;

	const group = tree(second);
	const stopAt = now();
	spawnSync("launchctl", ["bootout", `${domain}/${label}`]);
	const gone = await waitFor(() => printed().code === 113, 30_000);
	readings["finalStopConfirmMs"] = gone === null ? null : now() - stopAt;
	await sleep(Math.max(2000, throttle * 1000 + 1000));
	bar["8 clean stop: no label, no children, no restart"] =
		printed().code === 113 && group.filter(alive).length === 0;
} catch (error) {
	result["error"] =
		error instanceof Error ? error.message.replaceAll(home, "<home>") : String(error);
} finally {
	await electron?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	spawnSync("launchctl", ["bootout", `${domain}/${label}`]);
	result["cleanup"] = {labelAbsent: printed().code === 113};
	rmSync(home, {recursive: true, force: true});
	writeFileSync(
		join(ROOT, "experiments/results/234-electron-brain-restart.json"),
		`${JSON.stringify(result, null, "\t")}\n`,
	);
	process.stdout.write(`${JSON.stringify(result["bar"], null, 2)}\n`);
}
