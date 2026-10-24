import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
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
import {answer, isOurs, SCHEME, START} from "./files.ts";
import {type Host, startHost} from "./host.ts";

// The Electron edge: the main process. Electron and Node are named here and in preload.ts, and
// nowhere else; the host (host.ts), the pane (pane.ts), the messages and the files the protocol
// serves are plain Effect and tested with no Electron. What this file does, by Electron's
// security checklist (https://www.electronjs.org/docs/latest/tutorial/security):
//
//   one copy        `requestSingleInstanceLock`; a second start brings the first window forward and quits
//   one window      sandboxed, context isolation, no Node, and a preload that gives only send and onView
//   own files       over the app's own scheme (`protocol.handle`, files.ts): no `file://`, no remote site
//   no way out      navigation, redirects, new windows, webviews and permission requests are refused
//   one port        a MessageChannelMain; one end goes to the window, and only to a sender that is our
//                   window's own top frame, on our own url. Every message on that port is from it.
//   quit            the window closed: tsh and every program stop with the host's scope, then the app quits
//
// FABRIKA_HOME, when set, is where the app keeps its files instead of Electron's own folder, so
// a test runs on a fresh one. Nothing is kept there yet (host.ts: storage is memory only).

/** The bundle's folder: main.mjs, preload.cjs and the window's own files, side by side. */
const DIST = import.meta.dirname;

const home = process.env.FABRIKA_HOME;
if (home !== undefined && home !== "") app.setPath("userData", home);
// Before `ready`, as Electron asks: a standard, secure scheme, so the window's own files have
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

/** The sender is our window's own top frame, showing our own files: nothing else gets a port. */
const fromOurWindow = (window: BrowserWindow, event: IpcMainEvent) => {
	const frame = event.senderFrame;
	return (
		event.sender === window.webContents &&
		frame !== null &&
		frame.parent === null &&
		isOurs(frame.url)
	);
};

/** Hand the window its end of a fresh port each time it asks: once per page load. */
const connect = (window: BrowserWindow, host: Host) => {
	let current: MessagePortMain | null = null;
	ipcMain.on(PORT_CHANNEL, (event) => {
		if (!fromOurWindow(window, event)) {
			console.warn(
				`fabrika: refused a port to ${event.senderFrame?.url ?? "a frame that is gone"}`,
			);
			return;
		}
		// The page was loaded again: its old port goes, and the host shows the new one.
		current?.close();
		const {port1, port2} = new MessageChannelMain();
		port1.on("message", (message) => {
			const heard = host.heard(message.data);
			if (heard.kind === "refused")
				console.warn(`fabrika: refused a message from the window: ${heard.why}`);
		});
		port1.start();
		current = port1;
		host.show((m) => port1.postMessage(m));
		event.sender.postMessage(PORT_CHANNEL, null, [port2]);
	});
};

const open = Effect.gen(function* () {
	const path = yield* Path.Path;
	// Asked for by our own window's page only: the scheme is registered for nothing else.
	const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
	protocol.handle(SCHEME, (request) => Effect.runPromiseWith(files)(answer(DIST, request.url)));
	const window = new BrowserWindow({
		width: 960,
		height: 640,
		title: "fabrika",
		backgroundColor: "#16181d",
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			preload: path.join(DIST, "preload.cjs"),
		},
	});
	app.on("second-instance", () => {
		if (window.isMinimized()) window.restore();
		window.focus();
	});
	return window;
});

const main = Effect.gen(function* () {
	yield* Effect.tryPromise({
		try: () => app.whenReady(),
		catch: (cause) => new Error("Electron did not get ready", {cause}),
	});
	guard();
	const host = yield* startHost;
	const window = yield* open;
	connect(window, host);
	yield* Effect.tryPromise({
		try: () => window.loadURL(START),
		catch: (cause) => new Error(`the window could not load ${START}`, {cause}),
	});
	// Until the window closes: then the host's scope closes, and tsh and its programs stop.
	yield* Effect.callback<void>((resume) => {
		window.once("closed", () => resume(Effect.void));
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
				onSuccess: () => app.quit(),
			}),
		),
	);
