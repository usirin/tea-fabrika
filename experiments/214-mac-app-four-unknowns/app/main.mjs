import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
// Experiment 214's throwaway Electron main. It opens no window. It does one job, picked by
// SPIKE_MODE, prints one `SPIKE {json}` line and quits (launchd-start stays up, to be killed).
//
//   launchd-start  write <home>/brain.plist, `launchctl bootstrap gui/<uid>` it, wait for a beat
//   launchd-stop   `launchctl print` the label, `launchctl bootout` it, delete the plist
//   seal           safeStorage.encryptStringAsync a dummy value into <home>/userData/sealed.bin
//   open           safeStorage.decryptStringAsync that file back
//   touchid        systemPreferences.canPromptTouchID(), nothing more
//   idle           nothing: the runner drives it through Playwright
//
// SPIKE_HOME is a temp folder the runner made. userData lives inside it, never the real one.
// SPIKE_REAL_KEYCHAIN=1 drops the `--use-mock-keychain` switch Playwright adds.
import {app, safeStorage, systemPreferences} from "electron";

const home = process.env.SPIKE_HOME;
if (!home) throw new Error("SPIKE_HOME is required");
const mode = process.env.SPIKE_MODE ?? "idle";
const label = process.env.SPIKE_LABEL ?? "";
const here = dirname(fileURLToPath(import.meta.url));

app.setPath("userData", join(home, "userData"));
if (process.env.SPIKE_REAL_KEYCHAIN === "1") app.commandLine.removeSwitch("use-mock-keychain");

const report = (fields) => process.stdout.write(`SPIKE ${JSON.stringify({mode, ...fields})}\n`);
const domain = `gui/${process.getuid?.() ?? 0}`;
const plistPath = join(home, "brain.plist");
const beatPath = join(home, "beat.json");
const sealedPath = join(home, "userData", "sealed.bin");
const dummy = "experiment 214 dummy value";

const launchctl = (...args) => {
	try {
		return {code: 0, out: execFileSync("launchctl", args, {encoding: "utf8", stdio: "pipe"})};
	} catch (error) {
		return {code: error.status ?? -1, out: String(error.stderr ?? "").trim()};
	}
};

const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${process.execPath}</string>
		<string>${join(here, "brain.mjs")}</string>
		<string>${beatPath}</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict>
	<key>RunAtLoad</key><true/>
	<key>StandardOutPath</key><string>${join(home, "brain.out")}</string>
	<key>StandardErrorPath</key><string>${join(home, "brain.err")}</string>
</dict>
</plist>
`;

const waitFor = async (check, ms) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
};

const pidOf = (printed) => Number(/\bpid = (\d+)/.exec(printed)?.[1] ?? 0);
const stateOf = (printed) => /\bstate = (\w+)/.exec(printed)?.[1] ?? "none";

const jobs = {
	"launchd-start": async () => {
		writeFileSync(plistPath, plist());
		const started = Date.now();
		const boot = launchctl("bootstrap", domain, plistPath);
		const beat = await waitFor(() => existsSync(beatPath), 5000);
		const printed = launchctl("print", `${domain}/${label}`);
		report({
			bootstrap: boot.code,
			bootstrapError: boot.code === 0 ? "" : boot.out,
			beat,
			ms: Date.now() - started,
			state: stateOf(printed.out),
			pid: pidOf(printed.out),
		});
		// Stay up: the runner kills this process to stand in for an app crash.
	},
	"launchd-stop": async () => {
		const before = launchctl("print", `${domain}/${label}`);
		const out = launchctl("bootout", `${domain}/${label}`);
		rmSync(plistPath, {force: true});
		const after = launchctl("print", `${domain}/${label}`);
		report({
			stateBefore: stateOf(before.out),
			pidBefore: pidOf(before.out),
			bootout: out.code,
			bootoutError: out.code === 0 ? "" : out.out,
			printAfter: after.code,
			plistLeft: existsSync(plistPath),
		});
		app.quit();
	},
	seal: async () => {
		const started = Date.now();
		const available = await safeStorage.isAsyncEncryptionAvailable();
		const sealed = await safeStorage.encryptStringAsync(dummy);
		mkdirSync(dirname(sealedPath), {recursive: true});
		writeFileSync(sealedPath, sealed);
		report({available, bytes: sealed.length, ms: Date.now() - started});
		app.quit();
	},
	open: async () => {
		const started = Date.now();
		const opened = await safeStorage.decryptStringAsync(readFileSync(sealedPath));
		report({
			match: opened.result === dummy,
			shouldReEncrypt: opened.shouldReEncrypt,
			ms: Date.now() - started,
		});
		app.quit();
	},
	touchid: async () => {
		report({canPromptTouchID: systemPreferences.canPromptTouchID()});
		app.quit();
	},
	idle: async () => {},
};

const job = jobs[mode];
if (!job) throw new Error(`unknown SPIKE_MODE ${mode}`);
app.on("window-all-closed", () => {});
app.whenReady().then(() =>
	job().catch((error) => {
		report({error: String(error?.message ?? error)});
		app.quit();
	}),
);
