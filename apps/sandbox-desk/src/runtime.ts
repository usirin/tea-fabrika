// Node edge: the container gateway stays alive while the program host is stopped for backup.
import {type ChildProcess, execFile, spawn} from "node:child_process";
import {timingSafeEqual} from "node:crypto";
import {appendFile, mkdir} from "node:fs/promises";
import {createServer, type IncomingMessage, request as proxyRequest} from "node:http";
import type {Duplex} from "node:stream";
import {promisify} from "node:util";

const secret = process.env.FABRIKA_GATEWAY_KEY ?? "";
const origin = new URL(process.env.FABRIKA_ORIGIN ?? "");
if (!/^[a-f0-9]{64}$/.test(secret ?? "") || origin.protocol !== "https:")
	throw Error("Configure the private gateway and HTTPS origin.");
const path = "/fabrika/";
const call = promisify(execFile);
let host: ChildProcess | null = null;
let sockets = new Set<Duplex>();
let serial: Promise<unknown> = Promise.resolve();
const locked = <T>(work: () => Promise<T>) => {
	const result = serial.then(work);
	serial = result.catch(() => undefined);
	return result;
};
const authorized = (request: IncomingMessage) => {
	const got = Buffer.from(request.headers["x-fabrika-gateway"] ?? "");
	const want = Buffer.from(secret);
	return got.length === want.length && timingSafeEqual(got, want);
};
const health = () =>
	new Promise<unknown>((resolve, reject) => {
		// Node 26 fetch ignores a supplied Host header. This trusted proxy must preserve it.
		const request = proxyRequest(
			{
				host: "127.0.0.1",
				port: 5200,
				path: `${path}health`,
				headers: {host: origin.host},
				timeout: 2000,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					body += chunk;
				});
				response.on("end", () => {
					if (response.statusCode !== 200) {
						reject(Error("Host not ready"));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (cause) {
						reject(cause);
					}
				});
				response.on("error", reject);
			},
		);
		request.on("timeout", () => request.destroy(Error("Host readiness timed out")));
		request.on("error", reject);
		request.end();
	});
async function open() {
	if (host?.exitCode === null) return health();
	await mkdir("/desk/home", {recursive: true});
	await mkdir("/desk/work", {recursive: true});
	await mkdir("/desk/state", {recursive: true});
	// The shell gets its owner's home, never the controller's gateway key or Access assertion.
	const {FABRIKA_GATEWAY_KEY: _key, ...env} = process.env;
	const child = spawn(process.execPath, ["/opt/fabrika/app/src/main.mjs"], {
		cwd: "/opt/fabrika/app",
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...env,
			HOME: "/desk/home",
			FABRIKA_GUI_PORT: "5200",
			FABRIKA_GUI_BIND: "127.0.0.1",
			FABRIKA_GUI_ORIGIN: origin.origin,
			FABRIKA_GUI_PATH: path,
			FABRIKA_GUI_PLACE: "sandbox",
			FABRIKA_GUI_DATA: "/desk/state",
			FABRIKA_GUI_CWD: "/desk/work",
			TERM: "xterm-256color",
		},
	});
	host = child;
	for (const stream of [child.stdout, child.stderr])
		stream?.on("data", (data) => {
			void appendFile("/tmp/fabrika-host.log", data).catch(() => undefined);
		});
	child.once("error", (error) => console.error("Host start failed:", error.message));
	child.once("exit", (code, signal) =>
		console.log(JSON.stringify({event: "host_stopped", code, signal})),
	);
	for (let attempt = 0; attempt < 120; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw Error("Fabrika host exited. Inspect container host log.");
		const state = await health().catch(() => null);
		if (state) return state;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw Error("Fabrika host did not become ready.");
}
async function quiet() {
	for (const socket of sockets) socket.destroy();
	sockets = new Set();
	// node-pty children have their own sessions. Stop descendants too before reading /desk.
	const {stdout} = await call("ps", ["-e", "-o", "pid=,ppid="]);
	const rows = stdout
		.trim()
		.split("\n")
		.map((line) => line.trim().split(/\s+/).map(Number));
	const owned = new Set(host?.pid ? [host.pid] : []);
	for (let changed = true; changed; ) {
		changed = false;
		for (const [pid, parent] of rows)
			if (pid !== undefined && parent !== undefined && owned.has(parent) && !owned.has(pid)) {
				owned.add(pid);
				changed = true;
			}
	}
	for (const pid of [...owned].reverse()) {
		try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
		}
	}
	for (let i = 0; i < 30 && host?.exitCode === null && host?.signalCode === null; i++)
		await new Promise((resolve) => setTimeout(resolve, 100));
	for (const pid of owned) {
		try {
			process.kill(pid, "SIGKILL");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
		}
	}
	host = null;
	return {quiet: true};
}
const headers = (request: IncomingMessage) => {
	return {
		...Object.fromEntries(
			Object.entries(request.headers).filter(([name]) => name !== "x-fabrika-gateway"),
		),
		host: origin.host,
	};
};
const server = createServer((request, response) => {
	void (async () => {
		response.setHeader("cache-control", "no-store");
		if (!authorized(request)) {
			response.writeHead(403).end("Access required");
			return;
		}
		if (request.url === "/__host/status" && request.method === "GET") {
			const state = await health().catch(() => null);
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({running: host?.exitCode === null, clients: sockets.size, state}),
			);
			return;
		}
		if (
			["/__host/open", "/__host/quiet"].includes(request.url ?? "") &&
			request.method === "POST"
		) {
			const state = await locked(request.url?.endsWith("open") ? open : quiet);
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(state));
			return;
		}
		if (!host || !request.url?.startsWith(path)) {
			response.writeHead(503).end("Desk is not open");
			return;
		}
		const proxy = proxyRequest(
			{
				host: "127.0.0.1",
				port: 5200,
				path: request.url,
				method: request.method,
				headers: headers(request),
			},
			(upstream) => {
				response.writeHead(upstream.statusCode ?? 502, upstream.headers);
				upstream.pipe(response);
			},
		);
		proxy.on("error", () => {
			if (!response.headersSent) response.writeHead(502);
			response.end("Host unavailable");
		});
		request.pipe(proxy);
	})().catch((error) => {
		console.error("Gateway failed:", error.message);
		if (!response.headersSent) response.writeHead(500);
		response.end("Gateway failed");
	});
});
server.on("upgrade", (request, socket, head) => {
	if (!authorized(request) || !host || !request.url?.startsWith(`${path}ws?`)) {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		return;
	}
	const proxy = proxyRequest({
		host: "127.0.0.1",
		port: 5200,
		path: request.url,
		headers: headers(request),
	});
	proxy.on("upgrade", (response, upstream, upstreamHead) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
			upstream.destroy();
		});
		upstream.on("close", () => socket.destroy());
		socket.on("error", () => upstream.destroy());
		upstream.on("error", () => socket.destroy());
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
				.map(([key, value]) => `${key}: ${value}\r\n`)
				.join("")}\r\n`,
		);
		if (upstreamHead.length) socket.write(upstreamHead);
		if (head.length) upstream.write(head);
		socket.pipe(upstream).pipe(socket);
	});
	proxy.on("response", (response) => {
		socket.end(`HTTP/1.1 ${response.statusCode} Forbidden\r\nConnection: close\r\n\r\n`);
		response.resume();
	});
	proxy.on("error", () => socket.destroy());
	proxy.end();
});
server.listen(3000, "0.0.0.0", () =>
	console.log(JSON.stringify({ready: true, service: "fabrika-gateway"})),
);
