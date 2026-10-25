import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {layerSqliteSync} from "@kampus/fabrika/sqlite";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {Cause, Effect, FileSystem, Layer, Path, Queue} from "effect";
import {
	app,
	BrowserWindow,
	type IpcMainEvent,
	ipcMain,
	MessageChannelMain,
	type MessagePortMain,
	protocol,
	session,
} from "electron";
import {isPortName, PORT_CHANNEL} from "./bridge.ts";
import {fileHistory, sharedHistory} from "./editor/history.ts";
import {answer, DESK, isDesk, isOurs, SCHEME} from "./files.ts";
import type {Screen} from "./host.ts";
import {type FromDesk, readFromDesk, type ToDesk} from "./messages.ts";
import {startTiles} from "./tiles.ts";

// The Electron edge: the main process. Electron and Node are named here and in preload.ts, and
// nowhere else; the tiles (tiles.ts), each tile's host (host.ts), the line editor (editor/), the
// desk (desk/), the messages and the files the protocol serves are plain Effect and tested with
// no Electron. What this file does, by Electron's security checklist
// (https://www.electronjs.org/docs/latest/tutorial/security):
//
//   one copy        `requestSingleInstanceLock`; a second start brings the window forward, or makes
//                   one if there is none, and quits
//   one window      the desk: every tile and every program's view is drawn in it. Sandboxed,
//                   context isolation, no Node, and a preload that gives only send, onMessage
//                   and forget. At most one at a time; everything here follows the current one
//   own files       over the app's own scheme (`protocol.handle`, files.ts): no `file://`, no remote site
//   no way out      navigation, redirects, new windows, webviews and permission requests are refused,
//                   for every web contents the app makes
//   a port each     a MessageChannelMain for the desk, one per tile and one per run (bridge.ts). A
//                   hello is answered only from the window's own top frame, on the desk page of our
//                   own files, and a port goes only to that page. A message on a tile's port is
//                   for that tile's tsh alone; on a run's port, for that run alone.
//
// Closing and quitting follow the platform's own rules, never this app's:
//
//   close button    closes the window only. On macOS the app stays in the dock, and every tsh and
//                   program runs on in this process. On Windows and Linux, closing every window
//                   quits, as Electron's own pattern does (`window-all-closed`)
//   dock icon       `activate`: a new window, on the same desk with the live runs. It loads as a
//                   reloaded page does: hello, `start` with the desk kept, then `replay`
//   last tile       closing it closes the window, as closing the last tab does in Terminal. It
//                   does not quit. The next window opens on one fresh tile with a fresh tsh
//   Cmd-Q           Electron's default app menu, kept for it, quits the app. Only then does the
//                   tiles' scope close: every tsh and program stops, and their jobs stay for
//                   `attach` at the next start
//
// Until the host moves out to a process of its own (the direction note's later decision), it
// lives here, in the main process: jobs outlive a closed window, but not Cmd-Q.
//
// The app's home is Electron's userData folder: FABRIKA_HOME, when set, or Electron's own folder.
// A test sets it, to run on a fresh one. In it:
//
//   desk.json            the desk's tiles, kept on each change, for the next start
//   storage/tiles/<t>/   tile <t>'s tsh: its job table and its jobs, as the terminal tsh keeps them
//   history              the line editor's history, one for every tile
//   ledger.sqlite        the ledger
//
// The one-copy lock is in the same home: one app per home, so one tsh writes each tile's table.
//
// The ledger is on one node:sqlite connection in this thread (`layerSqliteSync`): the bundle has
// no worker file beside it. Its alarm looks for due jobs once a second, not every 25 ms, as
// nothing here sets one yet. It closes with the main scope.

/** The bundle's folder: main.mjs, preload.cjs and the page's own files, side by side. */
const DIST = import.meta.dirname;

const home = process.env.FABRIKA_HOME;
if (home !== undefined && home !== "") app.setPath("userData", home);
// Before `ready`, as Electron asks: a standard, secure scheme, so the page's own files have
// an origin of their own and run as on https.
protocol.registerSchemesAsPrivileged([
	{scheme: SCHEME, privileges: {standard: true, secure: true}},
]);

/** Refuse every way out of the app's own files, for every web contents it ever makes. */
const guard = () => {
	app.on("web-contents-created", (_event, contents) => {
		contents.on("will-navigate", (e) => e.preventDefault());
		contents.on("will-redirect", (e) => e.preventDefault());
		contents.on("will-attach-webview", (e) => e.preventDefault());
		contents.setWindowOpenHandler(() => ({action: "deny"}));
	});
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) =>
		decide(false),
	);
	session.defaultSession.setPermissionCheckHandler(() => false);
};

/** The one window, with the same safe settings the app's windows always had. */
const deskWindow = (preload: string) => {
	const window = new BrowserWindow({
		width: 1200,
		height: 760,
		title: "fabrika",
		backgroundColor: "#16181d",
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			preload,
		},
	});
	window
		.loadURL(DESK)
		.catch((cause) => console.error(`fabrika: the window could not load ${DESK}`, cause));
	return window;
};

/** The sender is the window's own top frame, showing the desk page of our files: nothing else is answered. */
const fromItsPage = (window: BrowserWindow, event: IpcMainEvent) => {
	const frame = event.senderFrame;
	return (
		event.sender === window.webContents &&
		frame !== null &&
		frame.parent === null &&
		isOurs(frame.url) &&
		isDesk(frame.url)
	);
};

/**
 * The ports handed to the page of the window there is now, by name: one per name, and a new one
 * closes the old. With no window, there is no port, and what would go on one is dropped: the next
 * window's page is told again (`replay`).
 */
const portsFor = (current: () => BrowserWindow | null) => {
	const ports = new Map<string, MessagePortMain>();
	/** A fresh port named `name`: the page gets one end, and `heard` hears what comes on the other. */
	const push = (name: string, heard: (raw: unknown) => void): MessagePortMain | null => {
		const window = current();
		if (
			!isPortName(name) ||
			window === null ||
			window.isDestroyed() ||
			!isDesk(window.webContents.getURL())
		)
			return null;
		ports.get(name)?.close();
		const {port1, port2} = new MessageChannelMain();
		port1.on("message", (message) => heard(message.data));
		port1.start();
		ports.set(name, port1);
		window.webContents.postMessage(PORT_CHANNEL, name, [port2]);
		return port1;
	};
	/** A port for one screen: what it hears goes to it, what it shows goes to the page. */
	const show = <To>(name: string, screen: Screen<To>) => {
		const port = push(name, (raw) => {
			const heard = screen.heard(raw);
			if (heard.kind === "refused")
				console.warn(`fabrika: refused a message on ${name}: ${heard.why}`);
		});
		// Only while it is still the port of that name: a page closed or loaded again took it away.
		if (port !== null)
			screen.show((m) => {
				if (ports.get(name) === port) port.postMessage(m);
			});
	};
	const gone = (name: string) => {
		ports.get(name)?.close();
		ports.delete(name);
	};
	/** The page was loaded again, or its window closed: every port it had is dead. */
	const reset = () => {
		for (const port of ports.values()) port.close();
		ports.clear();
	};
	const tell = (m: ToDesk) => ports.get("desk")?.postMessage(m);
	return {push, show, gone, reset, tell};
};

const main = Effect.gen(function* () {
	yield* Effect.tryPromise({
		try: () => app.whenReady(),
		catch: (cause) => new Error("Electron did not get ready", {cause}),
	});
	guard();
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	// Asked for by our own page only: the scheme is registered for nothing else.
	const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
	protocol.handle(SCHEME, (request) => Effect.runPromiseWith(files)(answer(DIST, request.url)));
	const at = (...names: string[]) => path.join(app.getPath("userData"), ...names);
	const ledger = yield* Layer.build(layerSqliteSync({path: at("ledger.sqlite"), tickMs: 1000}));

	/** The desk's window now, or none: closed, and on macOS the app runs on in the dock. */
	let current: BrowserWindow | null = null;
	const ports = portsFor(() => current);
	/** The window there is, brought forward, or a new one: its page asks for the desk as it loads. */
	const showWindow = () => {
		if (current !== null) {
			if (current.isMinimized()) current.restore();
			current.focus();
			return;
		}
		const made = deskWindow(path.join(DIST, "preload.cjs"));
		current = made;
		made.once("closed", () => {
			if (current === made) current = null;
			ports.reset();
		});
	};
	const tiles = yield* startTiles({
		history: yield* sharedHistory(yield* fileHistory(at("history"))),
		place: (tile) => ({
			jobs: fileStorage(at("storage", "tiles", tile)),
			drop: fs.remove(at("storage", "tiles", tile), {recursive: true}).pipe(Effect.ignore),
		}),
		edge: {
			tell: ports.tell,
			terminal: (tile, screen) => ports.show(`tile:${tile}`, screen),
			view: (run, screen) => ports.show(`run:${run}`, screen),
			gone: ports.gone,
		},
	}).pipe(Effect.provideContext(ledger));

	/** The desk kept from before, as written: the page reads it (desk.ts, `restore`). */
	const kept = fs.readFileString(at("desk.json")).pipe(
		Effect.flatMap((text) => Effect.try(() => JSON.parse(text))),
		Effect.orElseSucceed((): unknown => null),
	);
	// What the desk asks, in the order it asked: an open is done before the close after it.
	const asks = yield* Queue.unbounded<FromDesk>();
	const answerOne = (m: FromDesk) => {
		switch (m.type) {
			case "open":
				return tiles.open(m.tile);
			case "close":
				return tiles.close(m.tile);
			case "stop":
				return tiles.stop(m.tile);
			case "save":
				return fs
					.writeFileString(at("desk.json"), JSON.stringify(m.desk))
					.pipe(
						Effect.catch((e) => Effect.logError(`fabrika: could not keep the desk: ${e.message}`)),
					);
			case "empty":
				// The last tile closed: its window closes, and the next one begins on one fresh tile.
				return fs
					.remove(at("desk.json"))
					.pipe(Effect.ignore, Effect.andThen(Effect.sync(() => current?.close())));
		}
	};
	yield* Queue.take(asks).pipe(Effect.flatMap(answerOne), Effect.forever, Effect.forkScoped);

	const services = yield* Effect.context<never>();
	ipcMain.on(PORT_CHANNEL, (event) => {
		if (current === null || !fromItsPage(current, event)) {
			console.warn(
				`fabrika: refused a hello from ${event.senderFrame?.url ?? "a frame that is gone"}`,
			);
			return;
		}
		// A hello is a page load: the ports of the page before are dead, and the desk starts again.
		ports.reset();
		ports.push("desk", (raw) => {
			const read = readFromDesk(raw);
			if (read.kind === "read") Queue.offerUnsafe(asks, read.msg);
			else console.warn(`fabrika: refused a message from the desk: ${read.why}`);
		});
		Effect.runForkWith(services)(
			kept.pipe(
				Effect.flatMap((saved) =>
					Effect.sync(() => ports.tell({type: "start", saved})).pipe(Effect.andThen(tiles.replay)),
				),
			),
		);
	});
	app.on("second-instance", showWindow);
	// The dock icon, on macOS: the window there is, or a new one on the same desk.
	app.on("activate", showWindow);
	// Electron's own pattern: on macOS the app stays with no window; elsewhere it quits.
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	showWindow();
	// Until the app is asked to quit: Cmd-Q, or the last window closed off macOS. Then the scope
	// closes, and every tile's tsh stops with it.
	yield* Effect.callback<void>((resume) => {
		const asked = (event: {preventDefault: () => void}) => {
			event.preventDefault();
			resume(Effect.void);
		};
		app.once("before-quit", asked);
		return Effect.sync(() => app.off("before-quit", asked));
	});
}).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath)));

if (!app.requestSingleInstanceLock()) app.quit();
else
	Effect.runFork(
		main.pipe(
			Effect.matchCause({
				onFailure: (cause) => {
					console.error(Cause.pretty(cause));
					app.exit(1);
				},
				// Asked once already: this time nothing holds the quit back.
				onSuccess: () => app.quit(),
			}),
		),
	);
