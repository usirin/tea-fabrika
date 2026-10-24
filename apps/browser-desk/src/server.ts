// Node edge: local HTTP and WebSocket upgrades serve the browser; program work stays in Effect.
import {randomBytes, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
import {
	cast,
	getState,
	Ledger,
	memoryStorage,
	type RunOf,
	serve,
	start,
	tell,
	whereis,
} from "@kampus/fabrika";
import {layerSqlite} from "@kampus/fabrika/sqlite";
import {terminal} from "@tea-fabrika/terminal";
import {ZERO as TERMINAL_ZERO, view as terminalView} from "@tea-fabrika/terminal/view";
import {Effect, Exit, Schema} from "effect";
import {WebSocket, WebSocketServer} from "ws";
import {program as counter} from "./counter/program.ts";
import {ZERO as COUNTER_ZERO, State as CounterState, view as counterView} from "./counter/view.ts";
import {program as desk, State, view, ZERO} from "./desk.ts";
import {decode, type Snapshot, ToPage, type Window} from "./protocol.ts";
import {openTerminalPipe} from "./terminal-pipe.ts";
import {ZERO as PIPE_ZERO} from "./terminal-pipe-view.ts";
import {openTsh} from "./tsh.ts";

class LocalFailed extends Schema.TaggedError<LocalFailed>()("LocalFailed", {why: Schema.String}) {}
const failed = (cause: unknown) => new LocalFailed({why: String(cause)});
const attempt = <A>(work: () => Promise<A>) => Effect.tryPromise({try: work, catch: failed});
const deskName = "gui:desk";
const counterName = (id: string) => `gui:counter:${id}`;

export const server = (options: {
	port: number;
	bind: "127.0.0.1" | "0.0.0.0";
	origin: string;
	path: string;
	place: "local" | "sandbox";
	database: string;
	cwd: string;
	env: Record<string, string>;
}) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const {origin, path} = options;
		const host = new URL(origin).host;
		const token = randomBytes(24).toString("hex");
		const html = (yield* attempt(() => readFile(new URL("../index.html", import.meta.url), "utf8")))
			.replace('href="./client.css"', `href="${path}client.css"`)
			.replace('src="./client.js"', `src="${path}client.js"`);
		const js = yield* attempt(() => readFile(new URL("../dist/client.js", import.meta.url)));
		const css = yield* attempt(() => readFile(new URL("../dist/client.css", import.meta.url)));
		const names = new Set<string>();
		const terminals = new Map<string, RunOf<ReturnType<typeof terminal>>>();
		const shells = new Map<string, Effect.Success<ReturnType<typeof openTsh>>>();
		const pipes = new Map<string, Effect.Success<ReturnType<typeof openTerminalPipe>>>();
		const restarting = new Set<string>();
		const failures = new Map<string, string>();
		const holder = `gui:${randomUUID()}`;
		const register = (name: string, tag: string) =>
			Effect.gen(function* () {
				const registered = yield* whereis(name);
				if (!registered.registered) yield* ledger.register(name, tag);
			});
		yield* register(deskName, "desk");
		yield* serve({name: deskName, holder, program: desk, ttlMs: 3000, renewEveryMs: 500});
		const savedDesk = getState(deskName, State).pipe(Effect.map((saved) => saved.state ?? ZERO));
		if ((yield* savedDesk).panes.length === 0)
			yield* cast(
				deskName,
				"first-pane",
				{id: "first-pane", message: {type: "open", kind: "tsh", pane: "main"}},
				"gui",
			);
		const reconcile = Effect.gen(function* () {
			for (const id of restarting) {
				const previous = pipes.get(id);
				if (previous) yield* previous.stop;
				pipes.delete(id);
				names.delete(`pipe:${id}`);
				restarting.delete(id);
			}
			const state = yield* savedDesk;
			for (const pane of state.panes) {
				if (!shells.has(pane.id)) {
					const shell = yield* openTsh(pane.id, (kind) =>
						cast(
							deskName,
							randomUUID(),
							{id: randomUUID(), message: {type: "display", pane: pane.id, kind}},
							"tsh",
						).pipe(Effect.asVoid, Effect.orDie, Effect.provideService(Ledger, ledger)),
					);
					shells.set(pane.id, shell);
				}
				for (const kind of pane.started) {
					const key = `${kind}:${pane.id}`;
					if (names.has(key)) continue;
					names.add(key);
					if (kind === "counter") {
						const name = counterName(pane.id);
						yield* register(name, "counter");
						yield* serve({name, holder, program: counter, ttlMs: 3000, renewEveryMs: 500});
					} else if (kind === "terminal") {
						const program = terminal({cwd: options.cwd, shell: "/bin/bash", env: options.env});
						const started = yield* start(program, {}, {}, {id: pane.id, storage: memoryStorage()});
						if (started.kind === "bad_shape") {
							failures.set(pane.id, "Terminal could not start.");
							continue;
						}
						terminals.set(pane.id, started.run);
						yield* Effect.gen(function* () {
							const ended = yield* started.run.ended;
							if (ended.kind === "failed")
								failures.set(pane.id, "Shell failed. Open a new Terminal.");
						}).pipe(Effect.forkScoped);
					} else if (kind === "pipe")
						pipes.set(
							pane.id,
							yield* openTerminalPipe(pane.id, {cwd: options.cwd, env: options.env}),
						);
				}
			}
		});
		const snapshot = Effect.gen(function* () {
			const state = yield* savedDesk;
			const windows: Window[] = [];
			for (const pane of state.panes.filter((pane) => pane.open)) {
				if (pane.kind === "counter") {
					const saved = yield* getState(counterName(pane.id), CounterState);
					windows.push({
						kind: "counter",
						id: pane.id,
						data: counterView(saved.state ?? COUNTER_ZERO),
					});
				} else if (pane.kind === "terminal")
					windows.push({
						kind: "terminal",
						id: pane.id,
						data: terminalView(terminals.get(pane.id)?.machines.session.state() ?? TERMINAL_ZERO),
					});
				else if (pane.kind === "pipe")
					windows.push({kind: "pipe", id: pane.id, data: pipes.get(pane.id)?.view() ?? PIPE_ZERO});
				else
					windows.push({
						kind: "tsh",
						id: pane.id,
						data: shells.get(pane.id)?.view() ?? {lines: [], ready: false},
					});
			}
			return {type: "state", desk: view(state), windows, pid: process.pid} satisfies Snapshot;
		});
		const run = <A, E>(work: Effect.Effect<A, E, Ledger>) =>
			Effect.runPromise(work.pipe(Effect.provideService(Ledger, ledger)));
		const encode = Schema.encodeSync(Schema.fromJsonString(ToPage));
		const sockets = new WebSocketServer({noServer: true, maxPayload: 32 * 1024});
		const http = createServer((request, response) => {
			void (async () => {
				response.setHeader("Cache-Control", "no-store");
				response.setHeader("X-Content-Type-Options", "nosniff");
				const url = new URL(request.url ?? "/", origin);
				if (request.headers.host !== host || request.method !== "GET") {
					response.writeHead(403).end();
					return;
				}
				if (url.pathname === path) {
					response.setHeader("Content-Type", "text/html; charset=utf-8");
					response.end(html);
					return;
				}
				if (url.pathname === `${path}client.js`) {
					response.setHeader("Content-Type", "text/javascript; charset=utf-8");
					response.end(js);
					return;
				}
				if (url.pathname === `${path}client.css`) {
					response.setHeader("Content-Type", "text/css; charset=utf-8");
					response.end(css);
					return;
				}
				response.setHeader("Content-Type", "application/json");
				if (url.pathname === `${path}session`) {
					if (request.headers.origin && request.headers.origin !== origin) {
						response.writeHead(403).end();
						return;
					}
					response.end(JSON.stringify({token, place: options.place}));
					return;
				}
				if (url.pathname === `${path}health`) {
					const state = await run(savedDesk);
					const counters = [];
					for (const pane of state.panes.filter((pane) => pane.started.includes("counter"))) {
						const saved = await run(getState(counterName(pane.id), CounterState));
						counters.push({id: pane.id, ...counterView(saved.state ?? COUNTER_ZERO)});
					}
					response.end(
						JSON.stringify({
							pid: process.pid,
							clients: sockets.clients.size,
							counters,
							panes: state.panes,
							terminals: [...terminals].map(([id, run]) => ({
								id,
								pid: run.machines.session.state()?.pid,
								phase: run.machines.session.state()?.phase,
							})),
							failures: [...failures],
						}),
					);
					return;
				}
				response.writeHead(404).end();
			})().catch((cause) => {
				console.error("HTTP failed:", String(cause));
				if (!response.headersSent) response.writeHead(500);
				response.end("Local server failed");
			});
		});
		http.on("upgrade", (request, socket, head) => {
			const url = new URL(request.url ?? "/", origin);
			if (
				request.headers.origin !== origin ||
				request.headers.host !== host ||
				url.pathname !== `${path}ws` ||
				url.searchParams.get("token") !== token
			) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				return;
			}
			sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
		});
		const refuse = (socket: WebSocket, why: string) => {
			if (socket.readyState === WebSocket.OPEN) socket.send(encode({type: "refused", why}));
		};
		sockets.on("connection", (socket) => {
			socket.on("error", (cause) => console.error("Socket failed:", cause.message));
			void run(snapshot)
				.then((frame) => {
					if (socket.readyState === WebSocket.OPEN) socket.send(encode(frame));
				})
				.catch((cause) => refuse(socket, String(cause)));
			let pending = Promise.resolve();
			socket.on("message", (raw) => {
				pending = pending
					.then(async () => {
						const parsed = Effect.runSyncExit(Effect.try(() => decode(String(raw))));
						if (Exit.isFailure(parsed)) {
							refuse(socket, "Message does not match the program schema.");
							return;
						}
						const event = parsed.value;
						const state = await run(savedDesk);
						if (event.type === "desk") {
							if (
								event.message.type !== "open" &&
								!state.panes.some((pane) => pane.id === event.message.pane)
							) {
								refuse(socket, "That program does not exist.");
								return;
							}
							const result = await run(
								cast(deskName, event.id, {id: event.id, message: event.message}, "gui"),
							);
							if (result.how !== "sent") refuse(socket, `Desk refused: ${result.how}`);
							return;
						}
						const pane = state.panes.find((pane) => pane.id === event.pane);
						if (pane === undefined || !pane.open || pane.kind !== event.type) {
							refuse(socket, "That window is unavailable or belongs to another program.");
							return;
						}
						if (event.type === "counter") {
							const result = await run(
								cast(counterName(pane.id), event.id, {id: event.id, action: event.message}, "gui"),
							);
							if (result.how !== "sent") refuse(socket, `Counter refused: ${result.how}`);
						} else if (event.type === "tsh") {
							const shell = shells.get(pane.id);
							if (shell === undefined) {
								refuse(socket, "tsh is not ready.");
								return;
							}
							if (event.message.type === "line") shell.line(event.message.line);
							const result =
								event.message.type === "line"
									? await Effect.runPromise(tell(shell.run, "line", event.message.line))
									: await Effect.runPromise(tell(shell.run, "signal", "interrupt"));
							if (result !== "queued") refuse(socket, `tsh refused: ${result}`);
						} else if (event.type === "pipe") {
							const demo = pipes.get(pane.id);
							if (!demo) {
								refuse(socket, "The pipe is still starting.");
								return;
							}
							if (event.message.type === "restart") {
								restarting.add(pane.id);
								return;
							}
							const result = await Effect.runPromise(
								event.message.type === "link"
									? demo.enable(event.message.enabled)
									: demo.send(event.message.side, event.message.message),
							);
							if (result !== "queued") refuse(socket, `Pipe refused: ${result}`);
						} else {
							const terminal = terminals.get(pane.id);
							if (
								terminal === undefined ||
								terminal.machines.session.state()?.phase !== "running"
							) {
								refuse(socket, failures.get(pane.id) ?? "The shell is not running.");
								return;
							}
							const result = await Effect.runPromise(tell(terminal, "action", event.message));
							if (result !== "queued") refuse(socket, `Terminal refused: ${result}`);
						}
					})
					.catch((cause) => refuse(socket, `Delivery failed: ${String(cause)}`));
			});
		});
		yield* Effect.acquireRelease(
			attempt(
				() =>
					new Promise<void>((resolve, reject) => {
						http.once("error", reject);
						http.listen(options.port, options.bind, resolve);
					}),
			),
			() =>
				attempt(async () => {
					for (const socket of sockets.clients) socket.terminate();
					sockets.close();
					await new Promise<void>((resolve) => http.close(() => resolve()));
				}).pipe(Effect.orDie),
		);
		console.log(JSON.stringify({ready: true, url: origin, pid: process.pid}));
		let previous = "";
		for (;;) {
			yield* reconcile;
			const frame = yield* snapshot;
			const encoded = encode(frame);
			if (encoded !== previous) {
				previous = encoded;
				for (const socket of sockets.clients)
					if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
			}
			for (const [id, why] of failures)
				if (frame.desk.panes.some((pane) => pane.id === id && pane.open))
					for (const socket of sockets.clients) refuse(socket, why);
			yield* Effect.sleep("100 millis");
		}
	}).pipe(
		Effect.scoped,
		Effect.provide(layerSqlite({path: resolve(options.database), tickMs: 25, pollMs: 100})),
	);
