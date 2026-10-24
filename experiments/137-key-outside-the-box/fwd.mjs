// Experiment 137, inside a Docker box that has no network: the way to the relay.
//
//   node fwd.mjs <port> <relay socket> <program> ...args
//
// The container runs with `--network none`, so it has its own loopback and nothing else. The
// relay's unix socket is mounted in. This listens on the container's own 127.0.0.1:<port>, pipes
// each connection to the socket, and then starts the program with its stdio. The program is told
// the relay is at http://127.0.0.1:<port>. When the program ends, so does this.
//
// Plain JavaScript with no imports beyond Node's own: the image has node, not this repo.

import {spawn} from "node:child_process";
import {connect, createServer} from "node:net";

const [port, socket, command, ...args] = process.argv.slice(2);

const server = createServer((inside) => {
	const relay = connect(socket);
	const end = () => {
		inside.destroy();
		relay.destroy();
	};
	inside.on("error", end);
	relay.on("error", end);
	inside.pipe(relay).pipe(inside);
});

server.listen(Number(port), "127.0.0.1", () => {
	const child = spawn(command, args, {stdio: "inherit"});
	for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
	child.on("exit", (code) => {
		server.close();
		process.exit(code ?? 1);
	});
});
