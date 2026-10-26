// A stand-in for a tea-fabrika host on this laptop, the process the `Fabrika.Host` resource
// (host.ts) starts. The real host process does not exist yet: today the host lives in the app's
// main process (apps/fabrika/README.md), and the GUI note says it will run apart, as the tmux
// server does, with the app attached over a socket file. This stand-in does the parts a resource
// has to manage, and nothing else:
//
//   - a home folder, given as its one argument, holding `config.json`, `host.pid` and `host.sock`;
//   - a Unix socket in that home: a client writes one line, the host answers one JSON line with
//     its pid, its config and when it started;
//   - SIGHUP reads `config.json` again (an update in place: same pid), as nginx and sshd do;
//   - SIGTERM closes the socket, removes the socket and pid files, and exits 0.
//
// Node at the edge, on purpose: node:net for the socket and node:fs for three small files. It
// imports nothing from the experiment, so it starts in about 50 ms and holds no second copy of
// Effect.
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {join} from "node:path";

const home = process.argv[2];
if (home === undefined) {
	process.stderr.write("usage: host-process.ts <home>\n");
	process.exit(2);
}
const socket = join(home, "host.sock");
const pidFile = join(home, "host.pid");
const startedAt = Date.now();

const readConfig = (): unknown => JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
let config = readConfig();
let reloads = 0;

const server = createServer((conn) => {
	conn.once("data", () => {
		conn.end(`${JSON.stringify({pid: process.pid, config, startedAt, reloads})}\n`);
	});
});

process.on("SIGHUP", () => {
	config = readConfig();
	reloads += 1;
});
process.on("SIGTERM", () => {
	server.close(() => {
		rmSync(pidFile, {force: true});
		process.exit(0);
	});
});

rmSync(socket, {force: true});
server.listen(socket, () => {
	writeFileSync(pidFile, `${process.pid}\n`);
});
