// Experiment 284's driver: builds one shape of the app, runs main.mjs in it, and prints what macOS
// says. One shape per call, so one failing shape does not hide the others.
//
//   node experiments/284-login-item-unsigned/run.mjs <bare|bundle|adhoc|stripped>
//
//   bare      Electron's own binary runs main.mjs (how `electron .` starts an app today)
//   bundle    a copy of Electron.app with our bundle id and main.mjs inside; our edits break
//             the signature Electron shipped with, and nothing signs it again
//   adhoc     the same bundle, then `codesign -s - --force --deep`
//   stripped  the same bundle, then `codesign --remove-signature`: no signature at all
//
// It registers a login item, so it runs on a CI runner only, never on a person's Mac.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHAPES = ["bare", "bundle", "adhoc", "stripped"];
const shape = process.argv[2];

if (!SHAPES.includes(shape)) {
  console.error(`usage: run.mjs <${SHAPES.join("|")}>`);
  process.exit(2);
}

if (process.env.CI !== "true") {
  console.error("run.mjs registers a login item: it runs on a CI runner only");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const home = process.env.HOME ?? "";
const tidy = (text) => text.replaceAll(home, "~");

/** Runs one command with a time limit and prints its exit code and output. */
const sh = (label, command, args, options = {}) => {
  const done = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, ...options });
  const out = tidy(`${done.stdout ?? ""}`).trimEnd();
  const err = tidy(`${done.stderr ?? ""}`).trimEnd();
  console.log(`--- ${label}: exit=${done.status} signal=${done.signal ?? "none"}`);

  if (options.quiet !== true && out !== "") {
    console.log(out);
  }

  if (options.quiet !== true && err !== "") {
    console.log(`[stderr] ${err}`);
  }

  return { status: done.status, out, err };
};

// Electron's binary, as today's app resolves it. The package downloads it on first ask.
const electron = createRequire(join(root, "apps/fabrika/package.json"))("electron");
const electronApp = resolve(electron, "../../..");

const bundleId = shape === "bare" ? "com.github.Electron" : `dev.fabrika.exp284.${shape}`;

const makeBundle = () => {
  const app = join(mkdtempSync(join(tmpdir(), "exp284-")), `FabrikaExp284${shape}.app`);
  // Symlinks kept as they are: the frameworks inside are full of them.
  cpSync(electronApp, app, { recursive: true, verbatimSymlinks: true });
  const plist = join(app, "Contents/Info.plist");
  sh("plist id", "plutil", ["-replace", "CFBundleIdentifier", "-string", bundleId, plist]);
  sh("plist name", "plutil", ["-replace", "CFBundleName", "-string", `FabrikaExp284${shape}`, plist]);
  const inside = join(app, "Contents/Resources/app");
  mkdirSync(inside, { recursive: true });
  writeFileSync(join(inside, "package.json"), JSON.stringify({ name: `fabrika-exp284-${shape}`, main: "main.mjs" }));
  writeFileSync(join(inside, "main.mjs"), readFileSync(join(here, "main.mjs")));

  if (shape === "adhoc") {
    sh("codesign ad hoc", "codesign", ["-s", "-", "--force", "--deep", app]);
  }

  if (shape === "stripped") {
    sh("codesign remove", "codesign", ["--remove-signature", "--deep", app]);
  }

  return app;
};

const app = shape === "bare" ? electronApp : makeBundle();
const binary = join(app, "Contents/MacOS/Electron");
const appArgs = shape === "bare" ? [join(here, "main.mjs")] : [];

const runApp = (mode) =>
  sh(`app ${mode}`, binary, appArgs, { env: { ...process.env, EXP_MODE: mode, EXP_SHAPE: shape } });

/** `sfltool dumpbtm` lists every background item macOS knows; keep only the records about us. */
const btm = (label) => {
  const dump = sh(`sfltool dumpbtm (${label})`, "sudo", ["-n", "sfltool", "dumpbtm"], { quiet: true });
  const records = dump.out.split(/\n(?=\s*#\d+:)/);
  const ours = records.filter((record) => /exp284|electron/i.test(record));
  console.log(`btm records: ${records.length} in all, ${ours.length} about this app`);

  for (const record of ours) {
    console.log(record.trimEnd());
  }

  if (dump.status !== 0) {
    console.log(`[stderr] ${dump.err.split("\n").slice(0, 5).join("\n")}`);
  }
};

/** What the system's own services logged about the request, in the last few minutes. */
const systemLog = () => {
  const predicate =
    'process == "smd" OR process == "backgroundtaskmanagementd" OR subsystem == "com.apple.backgroundtaskmanagement"';
  const log = sh("log show", "log", ["show", "--last", "3m", "--style", "compact", "--predicate", predicate], {
    quiet: true,
    timeout: 120_000,
  });
  const lines = log.out.split("\n").filter((line) => /exp284|electron|SMAppService|login ?item/i.test(line));
  console.log(`log lines: ${lines.length} match; the last 30:`);

  for (const line of lines.slice(-30)) {
    console.log(line.slice(0, 400));
  }
};

console.log(`=== shape ${shape}: bundle id ${bundleId}, app ${tidy(app)}`);
sh("sw_vers", "sw_vers", []);
sh("uname -m", "uname", ["-m"]);
sh("id -u", "id", ["-u"]);
sh("launchctl managername", "launchctl", ["managername"]);
sh("codesign -dv", "codesign", ["-dv", "--verbose=2", app]);
sh("codesign --verify", "codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
sh("spctl", "spctl", ["-a", "-vv", app]);

runApp("cycle");
runApp("on");
btm("while on");
runApp("read");

if (shape !== "bare") {
  // The same read, started the way Finder starts an app, in case that changes the answer.
  const out = join(tmpdir(), `exp284-${shape}-open.out`);
  writeFileSync(out, "");
  const opened = ["-W", "-n", "-g", app, "--stdout", out, "--stderr", out];
  sh("open -W (read)", "open", [...opened, "--env", "EXP_MODE=read", "--env", `EXP_SHAPE=${shape}`]);
  console.log(tidy(readFileSync(out, "utf8")).trimEnd());
}

runApp("off");
runApp("read");
btm("after off");
systemLog();
