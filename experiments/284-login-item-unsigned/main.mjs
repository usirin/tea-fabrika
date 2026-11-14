// Experiment 284: can a build with no real code signature register itself as a macOS login item?
// An Electron main file with no window. It prints one JSON line per reading and quits.
//
//   EXP_MODE=cycle  read, turn on, read, read again after a wait, turn off, read   (the default)
//   EXP_MODE=on     read, turn on, read, read again after a wait, and leave it on
//   EXP_MODE=read   read only: what a fresh process sees
//   EXP_MODE=off    read, turn off, read
//
// EXP_SHAPE only labels the lines. Run it on a CI runner, never on a person's Mac.
import { app } from "electron";

const mode = process.env.EXP_MODE ?? "cycle";
const shape = process.env.EXP_SHAPE ?? "unnamed";
const WAIT_MS = 1500;

const print = (step, fields) => {
  process.stdout.write(`${JSON.stringify({ exp: 284, shape, mode, step, ...fields })}\n`);
};

const read = (step) => {
  try {
    print(step, { settings: app.getLoginItemSettings() });
  } catch (error) {
    print(step, { error: String(error) });
  }
};

const set = (step, openAtLogin) => {
  try {
    app.setLoginItemSettings({ openAtLogin });
    print(step, { threw: false });
  } catch (error) {
    print(step, { threw: true, error: String(error) });
  }
};

const wait = () => new Promise((resolve) => setTimeout(resolve, WAIT_MS));

const run = async () => {
  print("start", {
    execPath: process.execPath.replace(process.env.HOME ?? "\u0000", "~"),
    packaged: app.isPackaged,
    name: app.getName(),
    electron: process.versions.electron,
    arch: process.arch,
  });
  read("before");

  if (mode === "cycle" || mode === "on") {
    set("set-on", true);
    read("after-on");
    await wait();
    read("after-on-waited");
  }

  if (mode === "cycle" || mode === "off") {
    set("set-off", false);
    read("after-off");
  }
};

app.dock?.hide();

app
  .whenReady()
  .then(run)
  .catch((error) => print("failed", { error: String(error) }))
  .finally(() => app.exit(0));
