// Probe for experiment 188: can an artifact run in today's app shape?
// A desk page under the app's own CSP, plus frame-src for one artifact scheme. The artifact
// scheme serves one static shell page; the desk loads it in <iframe sandbox="allow-scripts">
// and posts the agent's HTML in. Prints one JSON line of answers, then quits.
//
// Run it with the app's own Electron, from the repo root, after `pnpm install`:
//   E=$(ls -d node_modules/.pnpm/electron@45.2.1*/node_modules/electron/dist)
//   "$E/Electron.app/Contents/MacOS/Electron" experiments/188-artifacts
// The answers of the run on 2026-11-01 are in experiments/results/188-artifacts.json.
import {app, BrowserWindow, protocol} from "electron";

const DESK_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src fabrika-artifact:";
const SHELL_CSP =
	"default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

console.log("stage: main loaded");
setTimeout(() => {
	console.log(JSON.stringify({hardTimeout: true}));
	app.exit(2);
}, 15000);

protocol.registerSchemesAsPrivileged([
	{scheme: "fabrika", privileges: {standard: true, secure: true}},
	{scheme: "fabrika-artifact", privileges: {standard: true, secure: true}},
]);

const desk = `<!doctype html><meta charset=utf-8><title>desk</title>
<body><script src="desk.js" defer></script></body>`;

const deskJs = `
const out = {};
const done = () => { if (out.keysInFrame !== undefined && out.srcdocRan !== undefined && out.frame) console.log("PROBE " + JSON.stringify(out)); };
window.__out = out; window.__done = done;
// The desk's key reader, as hold.ts: keydown in the capture phase.
out.keysSeenByDesk = 0;
window.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "b") out.keysSeenByDesk++; }, true);
window.addEventListener("message", (e) => {
  const f = document.getElementById("a");
  if (e.source !== f.contentWindow) return;
  if (e.data && e.data.type === "ready") f.contentWindow.postMessage({type: "page", html: PAGE}, "*");
  if (e.data && e.data.type === "result") { out.frame = e.data.result; out.originSeen = e.origin; done(); }
  if (e.data && e.data.type === "key") out.keysForwarded = (out.keysForwarded || 0) + 1;
});
const PAGE = \`<!doctype html><title>An agent's page</title><p id=p>static</p>
<script>
const r = {};
r.inlineRan = true;
try { r.parentDocument = !!parent.document.body; } catch (e) { r.parentDocument = "blocked"; }
try { localStorage.setItem("x", "1"); r.localStorage = "works"; } catch (e) { r.localStorage = "throws"; }
try { r.fabrikaBridge = typeof window.fabrika; } catch (e) { r.fabrikaBridge = "throws"; }
try { top.location.href = "https://example.com/"; r.topNavigation = "allowed?"; } catch (e) { r.topNavigation = "blocked"; }
r.origin = String(location.origin);
const v = [];
document.addEventListener("securitypolicyviolation", (e) => v.push(e.violatedDirective + " " + e.blockedURI));
fetch("https://example.com/").then(() => { r.fetch = "allowed"; }, () => { r.fetch = "blocked"; });
const s = document.createElement("script"); s.src = "https://evil.example/x.js"; document.head.append(s);
// The shell forwards Ctrl-B to the desk, so the desk's prefix still works inside a frame.
window.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "b") parent.postMessage({type: "key", key: "ctrl+b"}, "*"); }, true);
setTimeout(() => { r.violations = v; parent.postMessage({type: "result", result: r}, "*"); }, 800);
<\\/script>\`;
const f = document.createElement("iframe");
f.id = "a"; f.title = "An agent's page"; f.setAttribute("sandbox", "allow-scripts");
f.src = "fabrika-artifact://shell/"; f.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px;border:0";
document.body.append(f);
// Control: the same kind of page as srcdoc, which inherits this page's policy (HTML 7.1.7).
const g = document.createElement("iframe");
g.setAttribute("sandbox", "allow-scripts");
g.srcdoc = "<script>parent.postMessage({type:'srcdoc'}, '*')<\\/script>";
out.srcdocRan = false;
window.addEventListener("message", (e) => { if (e.data && e.data.type === "srcdoc") out.srcdocRan = true; });
document.body.append(g);
`;

// The shell: wait for one page, then write it in. Its own policy (SHELL_CSP) is what the page gets.
const shell = `<!doctype html><meta charset=utf-8><script>
addEventListener("message", (e) => {
  if (e.source !== parent || !e.data || e.data.type !== "page") return;
  document.open(); document.write(e.data.html); document.close();
});
parent.postMessage({type: "ready"}, "*");
</script>`;

const answer = (body, type, csp) =>
	new Response(body, {headers: {"content-type": type, "content-security-policy": csp}});

app.whenReady().then(async () => {
	protocol.handle("fabrika", (req) => {
		const path = new URL(req.url).pathname;
		if (path === "/desk.js") return answer(deskJs, "text/javascript", DESK_CSP);
		return answer(desk, "text/html", DESK_CSP);
	});
	protocol.handle("fabrika-artifact", () => answer(shell, "text/html", SHELL_CSP));
	const win = new BrowserWindow({
		show: true,
		x: 0,
		y: 0,
		width: 500,
		height: 400,
		opacity: 0,
		webPreferences: {sandbox: true, contextIsolation: true},
	});
	win.webContents.on("console-message", (e) => {
		const line = e.message ?? "";
		if (!line.startsWith("PROBE ")) console.log(`renderer: ${line.slice(0, 200)}`);
		if (line.startsWith("PROBE ")) {
			console.log(line.slice(6));
			app.quit();
		}
	});
	win.webContents.on("will-navigate", (e) => e.preventDefault());
	await win.loadURL("fabrika://app/desk.html");
	await new Promise((r) => setTimeout(r, 1500));
	// Focus inside the frame, then a real Ctrl-B, as a person would press it.
	const frames = win.webContents.mainFrame.frames;
	const artifact = frames.find((f) => f.url.startsWith("fabrika-artifact:"));
	win.webContents.sendInputEvent({
		type: "mouseDown",
		x: 100,
		y: 100,
		button: "left",
		clickCount: 1,
	});
	win.webContents.sendInputEvent({type: "mouseUp", x: 100, y: 100, button: "left", clickCount: 1});
	await new Promise((r) => setTimeout(r, 300));
	const before = artifact ? await artifact.executeJavaScript("document.hasFocus()") : "no frame";
	console.log(`stage: frame has focus before the key: ${before}`);
	win.webContents.sendInputEvent({type: "keyDown", keyCode: "b", modifiers: ["control"]});
	win.webContents.sendInputEvent({type: "keyUp", keyCode: "b", modifiers: ["control"]});
	await new Promise((r) => setTimeout(r, 400));
	await win.webContents.executeJavaScript(
		"window.__out.keysInFrame = true; window.__out.focusInFrame = document.activeElement && document.activeElement.id; window.__done(); 1",
	);
	setTimeout(() => {
		console.log(JSON.stringify({timeout: true}));
		app.quit();
	}, 4000);
});
