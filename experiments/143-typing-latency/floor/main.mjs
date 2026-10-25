// Experiment 143's floor: the least an Electron page can do for a key. One window, one canvas, no
// bridge to another process, no terminal: a key press draws its line in the next frame. The page
// keeps the same timing rows as the app's probes, so the same script measures it.
//
//   node experiments/143-typing-latency.ts run    with VARIANTS=floor CONDITIONS=idle-fresh

import {join} from "node:path";
import {app, BrowserWindow} from "electron";

// The run's temp home, never the user data folder every unnamed Electron app shares.
app.setPath("userData", join(process.env.FABRIKA_HOME, "floor"));
globalThis.__x143 = {rows: [], tile: "t1"};

// As the app copies' probes do: features off, joined to any list already there.
if (process.env.X143_FEATURES_OFF) {
	const had = app.commandLine.getSwitchValue("disable-features");
	app.commandLine.appendSwitch(
		"disable-features",
		[had, process.env.X143_FEATURES_OFF].filter(Boolean).join(","),
	);
}

// Never the active app: no Dock icon, and the window is shown inactive.
const quiet = () => {
	if (process.platform === "darwin") app.setActivationPolicy("accessory");
};
quiet();

app.whenReady().then(() => {
	quiet();
	const window = new BrowserWindow({
		width: 1200,
		height: 760,
		backgroundColor: "#16181d",
		show: false,
		paintWhenInitiallyHidden: true,
		webPreferences: {sandbox: true, contextIsolation: true, backgroundThrottling: false},
	});
	window.once("ready-to-show", () => window.showInactive());
	window.loadFile(join(import.meta.dirname, "index.html"));
});
app.on("window-all-closed", () => app.quit());
