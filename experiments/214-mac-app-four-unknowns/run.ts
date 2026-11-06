// Experiment 214: T8's four unknowns, on a throwaway Electron app (./app), never the real one.
//
//   nice -n 19 node experiments/214-mac-app-four-unknowns/run.ts
//
// 1. launchd: the app writes a plist into a temp home and bootstraps it as a user agent under
//    a random `dev.fabrika.spike.<hex>` label; the runner kills the app (a crash), checks the
//    agent lives on, starts the app again to boot it out and delete the plist.
// 2. safeStorage's async API under Playwright's `_electron.launch`, temp userData, two launches.
// 3. The real Keychain, outside Playwright: seal once, open twice, each a fresh launch with a
//    30-second limit. A call that blocks is the only sign of a prompt we can see from here.
// 4. `systemPreferences.canPromptTouchID()`. `promptTouchID` is never called.
//
// One Electron app at a time. A `finally` boots the label out, deletes the plist, kills what is
// left and deletes only the Keychain items this run made. macOS only. No network, no model, $0.
// Writes experiments/results/214-mac-app-four-unknowns.json.
import {type ChildProcess, execFileSync, spawn, spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "app");
const fromApp = createRequire(join(here, "../../apps/fabrika/package.json"));
const electronPath: string = fromApp("electron");
const {_electron} = fromApp("playwright") as typeof import("playwright");

const label = `dev.fabrika.spike.${randomBytes(4).toString("hex")}`;
const domain = `gui/${process.getuid?.() ?? 0}`;
const home = mkdtempSync(join(tmpdir(), "s214-"));
const appName = "fabrika-spike-214";
// The names Electron could give its Safe Storage item. Only one made by this run is deleted.
const itemNames = [`${appName} Safe Storage`, "Electron Safe Storage"];
const limitMs = 30_000;

type Report = Record<string, unknown>;
const results: Record<string, unknown> = {
	electron: (fromApp("electron/package.json") as {version: string}).version,
	macOS: execFileSync("sw_vers", ["-productVersion"], {encoding: "utf8"}).trim(),
	signature: codesignOf(),
	label: "dev.fabrika.spike.<random>",
	at: new Date().toISOString(),
};
const live = new Set<ChildProcess>();

function codesignOf(): string {
	const bundle = electronPath.replace(/\/Contents\/MacOS\/Electron$/, "");
	// codesign writes its answer to stderr.
	const {stderr} = spawnSync("codesign", ["-dv", bundle], {encoding: "utf8"});
	return /Signature=(\S+)/.exec(stderr)?.[1] ?? "unsigned";
}

function itemExists(name: string): boolean {
	try {
		execFileSync("security", ["find-generic-password", "-s", name], {stdio: "ignore"});
		return true;
	} catch {
		return false;
	}
}

function printed(): {code: number; state: string; pid: number} {
	try {
		const out = execFileSync("launchctl", ["print", `${domain}/${label}`], {
			encoding: "utf8",
			stdio: "pipe",
		});
		return {
			code: 0,
			state: /\bstate = (\w+)/.exec(out)?.[1] ?? "none",
			pid: Number(/\bpid = (\d+)/.exec(out)?.[1] ?? 0),
		};
	} catch (error) {
		return {code: (error as {status?: number}).status ?? -1, state: "none", pid: 0};
	}
}

function alive(pid: number): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const beat = (): number => {
	try {
		return (JSON.parse(readFileSync(join(home, "beat.json"), "utf8")) as {beat: number}).beat;
	} catch {
		return 0;
	}
};

// Start the app plainly (no Playwright, so none of its switches) and wait for its SPIKE line.
function plain(
	mode: string,
	extra: Record<string, string> = {},
): Promise<{report?: Report; blocked: boolean; ms: number; child: ChildProcess}> {
	const started = Date.now();
	const child = spawn(electronPath, [appDir], {
		env: {...process.env, SPIKE_HOME: home, SPIKE_MODE: mode, SPIKE_LABEL: label, ...extra},
		stdio: ["ignore", "pipe", "pipe"],
	});
	live.add(child);
	child.on("exit", () => live.delete(child));
	return new Promise((resolve) => {
		let buffer = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({blocked: true, ms: Date.now() - started, child});
		}, limitMs);
		child.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const line = buffer.split("\n").find((l) => l.startsWith("SPIKE "));
			if (!line) return;
			clearTimeout(timer);
			resolve({
				report: JSON.parse(line.slice(6)) as Report,
				blocked: false,
				ms: Date.now() - started,
				child,
			});
		});
	});
}

const exited = (child: ChildProcess) =>
	child.exitCode !== null || child.signalCode !== null
		? Promise.resolve()
		: new Promise<void>((resolve) => child.once("exit", () => resolve()));

async function launchd(): Promise<Report> {
	const start = await plain("launchd-start");
	const brainPid = Number(start.report?.pid ?? 0);
	start.child.kill("SIGKILL");
	await exited(start.child);
	const beatAfterKill = beat();
	await sleep(1500);
	const survived = {beatAdvanced: beat() > beatAfterKill, ...printed()};
	const stop = await plain("launchd-stop");
	await exited(stop.child);
	await sleep(500);
	return {
		start: start.report ?? {blocked: start.blocked},
		afterAppKilled: survived,
		stop: stop.report ?? {blocked: stop.blocked},
		brainAliveAfterStop: alive(brainPid),
		printAfterStop: printed().code,
		plistLeft: existsSync(join(home, "brain.plist")),
	};
}

async function keychain(): Promise<Report> {
	const runs: Report[] = [];
	for (const mode of ["seal", "open", "open"]) {
		const run = await plain(mode);
		await exited(run.child);
		runs.push({mode, blocked: run.blocked, launchMs: run.ms, ...run.report});
		if (run.blocked) break;
	}
	return {runs, items: Object.fromEntries(itemNames.map((n) => [n, itemExists(n)]))};
}

// Launch the app through Playwright, as a test would, and run each step in its main process.
// `fresh` makes a temp home of its own; otherwise it uses the plain runs' home and their file.
async function underPlaywright(
	steps: ReadonlyArray<"seal" | "open">,
	options: {realKeychain: boolean; fresh: boolean},
): Promise<Report> {
	const userHome = options.fresh ? mkdtempSync(join(tmpdir(), "s214pw-")) : home;
	const env = {
		...process.env,
		SPIKE_HOME: userHome,
		SPIKE_MODE: "idle",
		...(options.realKeychain ? {SPIKE_REAL_KEYCHAIN: "1"} : {}),
	} as Record<string, string>;
	const launches: Report[] = [];
	try {
		for (const step of steps) {
			const started = Date.now();
			const electronApp = await _electron.launch({
				executablePath: electronPath,
				args: [appDir],
				env,
				timeout: limitMs,
			});
			try {
				const pathOf = join(userHome, "userData", "sealed.bin");
				const answer = await Promise.race([
					electronApp.evaluate(
						async ({app, safeStorage}, {step, pathOf}) => {
							const fs = process.getBuiltinModule("node:fs");
							const t = Date.now();
							if (step === "seal") {
								const available = await safeStorage.isAsyncEncryptionAvailable();
								const sealed = await safeStorage.encryptStringAsync("experiment 214 dummy value");
								fs.mkdirSync(app.getPath("userData"), {recursive: true});
								fs.writeFileSync(pathOf, sealed);
								return {available, bytes: sealed.length, ms: Date.now() - t};
							}
							try {
								const opened = await safeStorage.decryptStringAsync(fs.readFileSync(pathOf));
								return {
									match: opened.result === "experiment 214 dummy value",
									shouldReEncrypt: opened.shouldReEncrypt,
									ms: Date.now() - t,
								};
							} catch (error) {
								return {match: false, error: String(error).slice(0, 200), ms: Date.now() - t};
							}
						},
						{step, pathOf},
					),
					sleep(limitMs).then(() => ({blocked: true})),
				]);
				launches.push({step, launchMs: Date.now() - started, ...answer});
			} finally {
				await electronApp.close();
			}
			launches.push({itemsAfter: Object.fromEntries(itemNames.map((n) => [n, itemExists(n)]))});
		}
	} catch (error) {
		launches.push({error: String((error as Error).message ?? error).slice(0, 300)});
	} finally {
		if (options.fresh) rmSync(userHome, {recursive: true, force: true});
	}
	return {...options, launches};
}

const itemsBefore = Object.fromEntries(itemNames.map((n) => [n, itemExists(n)]));
try {
	if (process.platform !== "darwin") throw new Error("macOS only");
	results.launchd = await launchd();
	const touch = await plain("touchid");
	await exited(touch.child);
	results.touchID = touch.report ?? {blocked: touch.blocked};
	// Playwright first, while no Safe Storage item exists, to see whether it makes one.
	results.playwright = await underPlaywright(["seal", "open"], {realKeychain: false, fresh: true});
	results.keychain = await keychain();
	// Can a Playwright launch open what a plain launch sealed with the real Keychain?
	results.playwrightOpensPlain = await underPlaywright(["open"], {
		realKeychain: false,
		fresh: false,
	});
	results.playwrightReal = await underPlaywright(["seal", "open"], {
		realKeychain: true,
		fresh: true,
	});
} catch (error) {
	results.error = String((error as Error).message ?? error);
} finally {
	for (const child of live) child.kill("SIGKILL");
	try {
		execFileSync("launchctl", ["bootout", `${domain}/${label}`], {stdio: "ignore"});
	} catch {
		// Already gone, which is the expected case.
	}
	rmSync(join(home, "brain.plist"), {force: true});
	const deleted: Record<string, string> = {};
	for (const name of itemNames) {
		if (itemsBefore[name] || !itemExists(name)) continue;
		try {
			execFileSync("security", ["delete-generic-password", "-s", name], {
				stdio: "ignore",
				timeout: 10_000,
			});
			deleted[name] = itemExists(name) ? "still there" : "deleted";
		} catch {
			deleted[name] = "delete failed";
		}
	}
	results.cleanup = {
		labelLoaded: printed().code === 0,
		plistLeft: existsSync(join(home, "brain.plist")),
		itemsDeleted: deleted,
		itemsLeft: itemNames.filter((n) => !itemsBefore[n] && itemExists(n)),
	};
	rmSync(home, {recursive: true, force: true});
}

const out = join(here, "../results/214-mac-app-four-unknowns.json");
writeFileSync(out, `${JSON.stringify(results, null, "\t")}\n`);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
process.exit(0);
