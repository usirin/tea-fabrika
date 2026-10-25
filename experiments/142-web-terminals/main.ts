import {readFile} from "node:fs/promises";
import {join, normalize} from "node:path";
import {app, BrowserWindow, protocol, session} from "electron";

// Experiment 142's Electron main: one window, as safe as the app's own (apps/fabrika/src/main.ts):
// sandboxed, no Node in the page, no preload, every permission refused. It serves the built page
// on its own scheme, with the Content Security Policy the experiment asks for, and counts the
// bytes it serves, so the script can read how much each library's page loads.
//
//   BENCH_DIR=<built page> BENCH_CSP=<policy> BENCH_URL=bench://h/page.html?lib=xterm&n=4 electron main.cjs

const dir = process.env.BENCH_DIR ?? "";
const csp = process.env.BENCH_CSP ?? "";
const url = process.env.BENCH_URL ?? "";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".wasm": "application/wasm",
};

/** Bytes served, by path: read by the script through `app.evaluate`. */
const served = new Map<string, number>();
Object.assign(globalThis, {served});

// The app's scheme is standard and secure. `supportFetchAPI` is added here because wterm's core
// fetches its WebAssembly, and a custom scheme refuses fetch without it.
protocol.registerSchemesAsPrivileged([
	{scheme: "bench", privileges: {standard: true, secure: true, supportFetchAPI: true}},
]);

app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler((_c, _p, decide) => decide(false));
	session.defaultSession.setPermissionCheckHandler(() => false);
	protocol.handle("bench", async (request) => {
		const path = normalize(new URL(request.url).pathname);
		const type = TYPES[path.slice(path.lastIndexOf("."))];
		if (path.includes("..") || type === undefined) return new Response("no", {status: 404});
		const body = await readFile(join(dir, path)).catch(() => null);
		if (body === null) return new Response("no", {status: 404});
		served.set(path, body.byteLength);
		return new Response(body, {headers: {"content-type": type, "content-security-policy": csp}});
	});
	const window = new BrowserWindow({
		width: Number(process.env.BENCH_W ?? "1200"),
		height: Number(process.env.BENCH_H ?? "760"),
		useContentSize: true,
		backgroundColor: "#16181d",
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
	window.webContents.on("will-navigate", (e) => e.preventDefault());
	void window.loadURL(url);
});
