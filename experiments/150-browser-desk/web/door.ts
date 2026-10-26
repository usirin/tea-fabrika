import {createServer} from "node:http";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Effect, FileSystem, Layer, Path} from "effect";
import {HttpServer, HttpServerRequest, HttpServerResponse} from "effect/http";
import type {Socket} from "effect/socket";
import {CSP, DESK_CSP} from "../files.ts";
import {pathsOf} from "../host/socket.ts";
import {MAX_LINE} from "../wire.ts";

// Experiment 150: the door. A tiny local relay in front of the host's socket file, for a page
// in a plain browser tab. The host is not changed at all: it keeps only its socket file, mode
// 0600, and sees each tab as one more app attached. The door reads nothing of the link; it pipes
// bytes both ways, one Unix socket connection per WebSocket.
//
//   FABRIKA_HOME=<home> X150_PORT=0 node dist/door.mjs
//   // listens on 127.0.0.1 only; writes <home>/web/url, mode 0600:
//   //   http://127.0.0.1:52341/?token=<64 hex>
//   GET /?token=<t>        the token right: a cookie for this door, and on to /desk.html
//   GET /desk.html ...     the page's own files, with the cookie only
//   GET /link              WebSocket: the cookie, our Origin and our Host, or 403. Then the bytes
//                          go to <home>/host/sock and back, unread
//
// Its guards, each against one way in:
//
//   Host       exactly one of ours (127.0.0.1:<port>, or one the run names), on every request:
//              a page on a rebound name (DNS rebinding) is refused before anything is served
//   Origin     exactly one of ours, on /link: a page of another origin (cross-site WebSocket
//              hijacking) is refused, even one on 127.0.0.1 with another port, which a cookie
//              does not tell apart
//   cookie     made from the one-time token in the url the door wrote, HttpOnly, SameSite=Strict:
//              a program on the laptop that does not have the url has no way in
//
// Node at its thinnest edge, said here: `node:http`'s server, which Effect's NodeHttpServer wraps,
// and `process.env`. The token comes from the platform's crypto.getRandomValues.

const home = process.env.FABRIKA_HOME ?? "";
const wanted = Number(process.env.X150_PORT ?? "0");
/** Other host:port names this door answers to, as a run's delay proxy (comma-separated). */
const also = (process.env.X150_HOSTS ?? "").split(",").filter((h) => h !== "");
/**
 * The guards on, for the experiment's safety run to take one away at a time and show what it
 * was holding. All three unless the run says otherwise.
 */
const guards = new Set((process.env.X150_GUARDS ?? "host,origin,cookie").split(","));

/** What the door serves, by path: the app's own page bundle, and the bridge in front of it. */
const FILES: Record<string, {readonly file: string; readonly type: string; readonly csp: string}> =
	{
		"/desk.html": {
			// The app's desk.html, with bridge.js before desk.js.
			file: "web.html",
			type: "text/html; charset=utf-8",
			// The app's page policy, and the one connection the page needs: back to its own origin.
			csp: `${DESK_CSP}; connect-src 'self'`,
		},
		"/desk.js": {file: "desk.js", type: "text/javascript; charset=utf-8", csp: CSP},
		"/bridge.js": {file: "bridge.js", type: "text/javascript; charset=utf-8", csp: CSP},
		"/window.css": {file: "window.css", type: "text/css; charset=utf-8", csp: CSP},
	};

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const secret = () => hex(crypto.getRandomValues(new Uint8Array(32)));

/** The same length and the same bytes, without stopping at the first that differs. */
const same = (a: string, b: string) => {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
};

const refuse = (why: string) =>
	Effect.logWarning(`fabrika door: refused: ${why}`).pipe(
		Effect.as(HttpServerResponse.text(`refused: ${why}\n`, {status: 403})),
	);

/** Every batch read off `from`, written to `into` as it came, until `from` ends. */
const forward = (from: Socket.Socket, into: Socket.Writer) =>
	from.reader.pipe(
		Effect.flatMap((reader) => reader.pull.pipe(Effect.flatMap(into.writeAll), Effect.forever)),
	);

/** The bytes of one tab, to the host's socket and back, until either side ends. */
const pipe = (ws: Socket.Socket, sock: string) =>
	Effect.gen(function* () {
		const unix = yield* NodeSocket.makeNet({path: sock});
		const toUnix = yield* unix.writer;
		const toWs = yield* ws.writer;
		return yield* Effect.raceFirst(forward(ws, toUnix), forward(unix, toWs));
	}).pipe(Effect.scoped, Effect.ignore);

/** The door: serves until the process is stopped. */
export const door = Effect.gen(function* () {
	if (home === "") return yield* Effect.die("fabrika door: FABRIKA_HOME is not set");
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const paths = yield* pathsOf(home);
	const dist = import.meta.dirname;
	const server = yield* HttpServer.HttpServer;
	const address = server.address;
	if (address._tag !== "InetAddressV4") return yield* Effect.die("fabrika door: not on 127.0.0.1");
	const port = address.port;

	const token = secret();
	const session = secret();
	const cookie = `fabrika_${port}`;
	const hosts = new Set([`127.0.0.1:${port}`, ...also]);
	const origins = new Set([...hosts].map((h) => `http://${h}`));

	const app = Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const host = request.headers.host ?? "";
		if (guards.has("host") && !hosts.has(host))
			return yield* refuse(`a foreign Host header (${host.slice(0, 80)})`);
		const url = new URL(request.url, "http://door.invalid");

		if (url.pathname === "/" && url.searchParams.has("token")) {
			if (!same(url.searchParams.get("token") ?? "", token)) return yield* refuse("a wrong token");
			// Into a cookie and out of the url, as Jupyter does: the token is not left in history.
			return HttpServerResponse.redirect("/desk.html", {
				status: 303,
				headers: {
					"set-cookie": `${cookie}=${session}; HttpOnly; SameSite=Strict; Path=/`,
					"cache-control": "no-store",
				},
			});
		}
		if (guards.has("cookie") && !same(request.cookies[cookie] ?? "", session))
			return yield* refuse("no session cookie");

		if (url.pathname === "/link") {
			const origin = request.headers.origin ?? "";
			if (guards.has("origin") && !origins.has(origin))
				return yield* refuse(`a foreign Origin (${origin.slice(0, 80)})`);
			const ws = yield* request.upgrade;
			yield* pipe(ws, paths.sock);
			return HttpServerResponse.empty();
		}

		const file = request.method === "GET" ? FILES[url.pathname] : undefined;
		if (file === undefined) return HttpServerResponse.text("not found\n", {status: 404});
		const bytes = yield* fs.readFile(path.join(dist, file.file));
		return HttpServerResponse.uint8Array(bytes, {
			contentType: file.type,
			headers: {
				"content-security-policy": file.csp,
				"x-content-type-options": "nosniff",
				"cache-control": "no-store",
			},
		});
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logError(`fabrika door: ${String(cause).split("\n")[0]}`).pipe(
				Effect.as(HttpServerResponse.text("error\n", {status: 500})),
			),
		),
	);

	const web = path.join(home, "web");
	yield* fs.makeDirectory(web, {recursive: true, mode: 0o700});
	yield* fs.writeFileString(path.join(web, "url"), `http://127.0.0.1:${port}/?token=${token}\n`, {
		mode: 0o600,
	});
	yield* fs.writeFileString(path.join(web, "pid"), `${process.pid}\n`, {mode: 0o600});
	yield* Effect.addFinalizer(() =>
		Effect.all([fs.remove(path.join(web, "url")), fs.remove(path.join(web, "pid"))], {
			mode: "result",
			concurrency: "unbounded",
		}),
	);
	yield* Effect.logInfo(`fabrika door: listening on 127.0.0.1:${port}`);
	yield* HttpServer.serveEffect()(app);
	return yield* Effect.never;
});

NodeRuntime.runMain(
	door.pipe(
		Effect.scoped,
		Effect.provide(
			Layer.mergeAll(
				NodeHttpServer.layer(() => createServer(), {
					host: "127.0.0.1",
					port: wanted,
					websocket: {maxPayload: MAX_LINE + 1024},
				}),
				NodeFileSystem.layer,
				NodePath.layer,
			),
		),
	),
);
