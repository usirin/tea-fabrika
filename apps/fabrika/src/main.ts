import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {Cause, Effect, type FileSystem, Layer, Path} from "effect";
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
import {PORT_CHANNEL} from "./bridge.ts";
import {fileHistory} from "./editor/history.ts";
import {answer, isOurs, type Page, PROGRAM, pageOf, SCHEME, TERMINAL} from "./files.ts";
import {type Screen, startHost, type Windows} from "./host.ts";

// The Electron edge: the main process. Electron and Node are named here and in preload.ts, and
// nowhere else; the host (host.ts), the line editor (editor/), the messages and the files the
// protocol serves are plain Effect and tested with no Electron. What this file does, by
// Electron's security checklist (https://www.electronjs.org/docs/latest/tutorial/security):
//
//   one copy        `requestSingleInstanceLock`; a second start brings the terminal forward and quits
//   windows         the terminal, and one per run of a program with a window. Every one is made
//                   by `windowFor`: sandboxed, context isolation, no Node, and a preload that gives
//                   only send and onMessage
//   own files       over the app's own scheme (`protocol.handle`, files.ts): no `file://`, no remote site
//   no way out      navigation, redirects, new windows, webviews and permission requests are refused,
//                   for every web contents the app makes
//   one port each   a MessageChannelMain per window; one end goes to the window, and only to a sender
//                   that is that window's own top frame, on that window's own page of our own files.
//                   Every message on it is from that window, for its screen alone.
//   quit            the terminal closed, or tsh ended: tsh and every program stop with the host's
//                   scope, their windows close, and the app quits. Jobs stay for `attach` next time.
//
// The app's home is Electron's userData folder: FABRIKA_HOME, when set, or Electron's own folder.
// A test sets it, to run on a fresh one. tsh keeps its job table and its jobs in `storage` there,
// and the line editor its history in `history`, as the terminal tsh keeps them in its own home,
// so they are there at the next start. The one-copy lock is in the same home: one app per home,
// so one tsh writes its table.

/** The bundle's folder: main.mjs, preload.cjs and the windows' own files, side by side. */
const DIST = import.meta.dirname;

const home = process.env.FABRIKA_HOME;
if (home !== undefined && home !== "") app.setPath("userData", home);
// Before `ready`, as Electron asks: a standard, secure scheme, so the windows' own files have
// an origin of their own and run as on https.
protocol.registerSchemesAsPrivileged([
	{scheme: SCHEME, privileges: {standard: true, secure: true}},
]);

/** The app is quitting: a window closed now is closed by the quit, not by the person. */
let quitting = false;
app.on("before-quit", () => {
	quitting = true;
});

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

/** A window the app made, the page it shows, and the screen its port is for. */
interface Shown {
	readonly window: BrowserWindow;
	readonly page: Page;
	readonly screen: Screen<unknown>;
	/** Its port now: a page loaded again gets a fresh one, and this one goes. */
	port: MessagePortMain | null;
}

/** Each window the app made, by its web contents' id. A port is asked for by one of these, or by nobody. */
const shown = new Map<number, Shown>();

/** The sender is the window's own top frame, showing the window's own page of our files: nothing else gets a port. */
const fromItsPage = (to: Shown, event: IpcMainEvent) => {
	const frame = event.senderFrame;
	return (
		event.sender === to.window.webContents &&
		frame !== null &&
		frame.parent === null &&
		isOurs(frame.url) &&
		pageOf(frame.url) === to.page
	);
};

/** Hand a window its end of a fresh port each time it asks: once per page load. */
const connect = () =>
	ipcMain.on(PORT_CHANNEL, (event) => {
		const to = shown.get(event.sender.id);
		if (to === undefined || !fromItsPage(to, event)) {
			console.warn(
				`fabrika: refused a port to ${event.senderFrame?.url ?? "a frame that is gone"}`,
			);
			return;
		}
		// The page was loaded again: its old port goes, and the screen is shown on the new one.
		to.port?.close();
		const {port1, port2} = new MessageChannelMain();
		port1.on("message", (message) => {
			const heard = to.screen.heard(message.data);
			if (heard.kind === "refused")
				console.warn(`fabrika: refused a message from the ${to.page} window: ${heard.why}`);
		});
		port1.start();
		to.port = port1;
		to.screen.show((m) => port1.postMessage(m));
		event.sender.postMessage(PORT_CHANNEL, null, [port2]);
	});

/** A window's size and title. */
interface Frame {
	readonly width: number;
	readonly height: number;
	readonly title: string;
}

/** A window of the app, on one of its two pages: every one is made here, with the same safe settings. */
const windowFor = (preload: string, page: Page, screen: Screen<unknown>, frame: Frame) => {
	const window = new BrowserWindow({
		...frame,
		backgroundColor: "#16181d",
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			preload,
		},
	});
	const id = window.webContents.id;
	shown.set(id, {window, page, screen, port: null});
	window.once("closed", () => {
		shown.get(id)?.port?.close();
		shown.delete(id);
	});
	const url = page === "terminal" ? TERMINAL : PROGRAM;
	window
		.loadURL(url)
		.catch((cause) => console.error(`fabrika: the window could not load ${url}`, cause));
	return window;
};

/** The program windows, by run: one opens as a run of a program with a window starts, and closes at its end. */
const programWindows = (preload: string): Windows => {
	const byRun = new Map<string, BrowserWindow>();
	return {
		open: (run, program, screen) => {
			const window = windowFor(preload, "program", screen, {
				width: 520,
				height: 420,
				title: program,
			});
			byRun.set(run, window);
			window.once("closed", () => {
				byRun.delete(run);
				// Closed by the person: the run's inputs close (host.ts). Closed by the quit: the job stays.
				if (!quitting) screen.closed();
			});
		},
		close: (run) => byRun.get(run)?.close(),
	};
};

const main = Effect.gen(function* () {
	yield* Effect.tryPromise({
		try: () => app.whenReady(),
		catch: (cause) => new Error("Electron did not get ready", {cause}),
	});
	guard();
	connect();
	const path = yield* Path.Path;
	// Asked for by our own windows' pages only: the scheme is registered for nothing else.
	const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
	protocol.handle(SCHEME, (request) => Effect.runPromiseWith(files)(answer(DIST, request.url)));
	const at = (name: string) => path.join(app.getPath("userData"), name);
	const preload = path.join(DIST, "preload.cjs");
	const host = yield* startHost({
		jobs: fileStorage(at("storage")),
		history: yield* fileHistory(at("history")),
		windows: programWindows(preload),
	});
	const terminal = windowFor(preload, "terminal", host.terminal, {
		width: 960,
		height: 640,
		title: "fabrika",
	});
	app.on("second-instance", () => {
		if (terminal.isMinimized()) terminal.restore();
		terminal.focus();
	});
	// Until the terminal closes, or tsh ends: then the host's scope closes, and tsh and its programs stop.
	const closed = Effect.callback<void>((resume) => {
		terminal.once("closed", () => resume(Effect.void));
	});
	yield* Effect.raceFirst(closed, host.ended);
	quitting = true;
	if (!terminal.isDestroyed()) terminal.close();
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
				onSuccess: () => app.quit(),
			}),
		),
	);
