// P19's stand-in brain, for the e2e laws CI runs (plan "Tests before implementation": "CI runs the
// same lifecycle sequence with the stand-in service"). It is not P12: it serves a plain page at
// `/electron` and a `/health` answer on the fixed loopback port, and starts one child of its own so
// a stop can be seen to take the whole group. The laptop-only laws run P12's real brain instead.
//
//   ELECTRON_RUN_AS_NODE=1 <electron> p19-brain.js --port <n>
//
// It writes `<FABRIKA_HOME>/p19-brain.json` with its pid and its child's, and on SIGTERM stops the
// child and exits 0, a clean exit launchd does not restart.
import {spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {join} from "node:path";

const home = process.env["FABRIKA_HOME"];
if (home === undefined || home === "") throw new Error("p19 brain: FABRIKA_HOME is required");
const at = process.argv.indexOf("--port");
const port = Number(process.argv[at + 1]);
if (at < 0 || !Number.isInteger(port)) throw new Error("p19 brain: --port <n> is required");

const child = spawn("sleep", ["3600"], {stdio: "ignore"});
const page = `<!doctype html><html><head><meta charset="utf-8"><title>p19 stand-in brain</title></head>
<body><main id="p19">stand-in brain</main><iframe id="child" srcdoc="<p>child frame</p>"></iframe></body></html>`;

const server = createServer((request, response) => {
	if (request.url === "/electron") {
		response.writeHead(200, {"content-type": "text/html; charset=utf-8"});
		response.end(page);
	} else if (request.url === "/health") {
		response.writeHead(200, {"content-type": "application/json"});
		response.end(JSON.stringify({pid: process.pid, child: child.pid, port, home}));
	} else {
		response.writeHead(404);
		response.end();
	}
});
server.on("error", (error) => {
	process.stderr.write(`p19 brain: ${error.message}\n`);
	process.exit(3);
});
server.listen(port, "127.0.0.1", () => {
	writeFileSync(join(home, "p19-brain.json"), JSON.stringify({pid: process.pid, child: child.pid, port}));
});
process.on("SIGTERM", () => {
	child.kill("SIGTERM");
	server.close(() => process.exit(0));
});
