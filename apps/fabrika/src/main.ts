import {run} from "@demlik/tea/effect";
import {backoffDelay, defaultRng} from "@demlik/tea/retry-backoff";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Cause, Effect, Exit, type FileSystem, Layer, Path, Scope, Stream} from "effect";
import {ChildProcess, type ChildProcessSpawner} from "effect/process";
import {
	app,
	BrowserWindow,
	type IpcMainEvent,
	ipcMain,
	MessageChannelMain,
	type MessagePortMain,
	protocol,
	session,
	shell,
} from "electron";
import {attach, NoHello, NoHost, restart} from "./attach.ts";
import {isPortName, PORT_CHANNEL} from "./bridge.ts";
import {answer, DESK, isDesk, isOurs, SCHEME} from "./files.ts";
import {NotStopped} from "./host/stop.ts";
import {type Launch, launchOf, QUIET_SWITCHES} from "./launch.ts";
import type {Down, Up} from "./link.ts";
import {type LinkNow, readToApp, type ToPage} from "./messages.ts";
import {Browser, NotOpened, openOutside} from "./outside.ts";
import {noteOf, POLICY, reconnectMachine, type Tried} from "./reconnect.ts";
import {Unattached, type Wire} from "./wire.ts";

// The Electron edge: the main process. It runs nothing of fabrika's own: every tile's tsh, every
// program, the desk, the jobs and the ledger are in the host, a process of its own
// (host/main.ts), as tmux's server is. This process is a client of it, and a thin relay between
// the host's socket and the window's ports. Electron and Node are named here and in preload.ts,
// and nowhere else in the app's own process.
//
//   start           connect to the host on <home>/host/sock (attach.ts). None answers: start one,
//                   detached, wait for its socket, then connect. A socket left by a crash: the
//                   same, and the new host removes it
//   hello           both sides say which version of the link they speak (link.ts). Another
//                   version: the app does not attach, names both versions in its window, and
//                   leaves that host running with its jobs. The host's hello names its build too:
//                   another build, and the app attaches, with a banner, "the host runs older code"
//   restart         either way, the window offers "Stop the old host and start this one". A yes
//                   stops that host by its pid, waits for it to exit, and attaches, which starts
//                   one of this build (attach.ts, `restart`). Its running jobs stop; their saved
//                   lists stay, and each comes back with `attach %n`
//   the page        it loads and says hello: the host is told `page`, and sends the desk, its
//                   Ctrl-B table, and a port for every tile's terminal and every run shown
//   a port          what the page sends on one goes to the host as {type: "on", port, m}; what
//                   the host sends for one goes to the page. Read by the host, not here
//   the link drops  the reconnect machine (reconnect.ts) waits a moment and attaches again, the
//                   same way as at the start, so a host that was killed is started again. The
//                   window says so calmly; after five minutes it stops and offers Try again
//
// What this file does, by Electron's security checklist
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
//   links           a link's new window is refused too. Its URL goes to the person's own browser
//                   (`shell.openExternal`) when it is http or https and the desk page asked;
//                   any other scheme is refused (outside.ts)
//   a port each     a MessageChannelMain for the desk, one per tile and one per run (bridge.ts). A
//                   hello is answered only from the window's own top frame, on the desk page of our
//                   own files, and a port goes only to that page. A message on a tile's port is
//                   for that tile's tsh alone; on a run's port, for that run alone. Only a plain
//                   JSON value goes on to the host
//
// Closing and quitting follow the platform's own rules, never this app's:
//
//   close button    closes the window only. The host is told `away`, and every tsh and program
//                   runs on there. On macOS the app stays in the dock; on Windows and Linux,
//                   closing every window quits the app, as Electron's own pattern does
//   dock icon       `activate`: a new window, on the same desk with the live runs
//   last tile       closing it closes the window, as closing the last tab does in Terminal. It
//                   does not quit. The next window opens on one fresh tile with a fresh tsh
//   Cmd-Q           Electron's default app menu, kept for it, quits the app, and only the app: the
//                   host runs on, with every tile's tsh and every job. The next start attaches to
//                   it and draws the same desk
//
// The app's home is Electron's userData folder: FABRIKA_HOME, when set, or Electron's own folder.
// A test sets it, to run on a fresh one. The host is started on the same home, by name, always.
//
// A start on a home of its own is quiet (launch.ts): an agent or a test. On macOS it is an
// accessory app, with no Dock icon, never the active app. Its window is shown without focus,
// drawn while hidden and covered, and never focused, not even by the dock-activate path.
// FABRIKA_FOREGROUND=1 shows it as the owner's. DOM focus inside the page is not OS focus: a
// tile's terminal still takes keys sent over the DevTools protocol.
//
// The host is the app's own Electron binary run as Node (`ELECTRON_RUN_AS_NODE=1`, host/main.ts
// says why), with no stdin, stdout or stderr, and let go (`unref`): quitting the app leaves it.

/** The bundle's folder: main.mjs, host.mjs, preload.cjs and the page's own files, side by side. */
const DIST = import.meta.dirname;

const launch = launchOf(process.env);
if (launch.kind !== "owner") app.setPath("userData", launch.home);
// Before `ready`, so no Dock icon shows even for a moment, and Chromium starts with the switches.
if (launch.kind === "quiet") {
	if (process.platform === "darwin") app.setActivationPolicy("accessory");
	for (const name of QUIET_SWITCHES) app.commandLine.appendSwitch(name);
}
// Before `ready`, as Electron asks: a standard, secure scheme, so the page's own files have
// an origin of their own and run as on https.
protocol.registerSchemesAsPrivileged([
	{scheme: SCHEME, privileges: {standard: true, secure: true}},
]);

/** The person's own browser: Electron hands the URL to the system, which opens its default one. */
const browser = Browser.of({
	open: (url) =>
		Effect.tryPromise({
			try: () => shell.openExternal(url),
			catch: (cause) => new NotOpened({url, why: String(cause)}),
		}),
});

/**
 * Refuse every way out of the app's own files, for every web contents it ever makes. A link's new
 * window is refused like any other, and its URL goes to the person's own browser, or is refused.
 */
const guard = () => {
	app.on("web-contents-created", (_event, contents) => {
		contents.on("will-navigate", (e) => e.preventDefault());
		contents.on("will-redirect", (e) => e.preventDefault());
		contents.on("will-attach-webview", (e) => e.preventDefault());
		contents.setWindowOpenHandler(({url}) => {
			Effect.runFork(
				openOutside({url, from: contents.getURL()}).pipe(
					Effect.provideService(Browser, browser),
					Effect.match({
						onFailure: (e) => console.warn(`fabrika: the browser did not open ${e.url}: ${e.why}`),
						onSuccess: (out) => {
							if (out.kind === "refused")
								console.warn(`fabrika: refused to open ${url}: ${out.why}`);
						},
					}),
				),
			);
			return {action: "deny"};
		});
	});
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) =>
		decide(false),
	);
	session.defaultSession.setPermissionCheckHandler(() => false);
};

/**
 * The one window, with the same safe settings the app's windows always had. Quiet, it is made
 * hidden and drawn anyway, then shown without taking focus.
 */
const deskWindow = (preload: string, launch: Launch) => {
	const quiet = launch.kind === "quiet";
	const window = new BrowserWindow({
		width: 1200,
		height: 760,
		title: "fabrika",
		backgroundColor: "#16181d",
		show: !quiet,
		paintWhenInitiallyHidden: true,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			backgroundThrottling: !quiet,
			preload,
		},
	});
	if (quiet) window.showInactive();
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

/** How deep a page's message may nest: deeper is refused, as no message of the app's is. */
const DEEPEST = 32;

/**
 * Is `v` a plain JSON value: what goes on the host's socket as one line. A port carries far more
 * (a Map, a cycle, a BigInt), and one of those must not end the link for every tile.
 */
const plain = (v: unknown, depth = 0): boolean => {
	if (depth > DEEPEST) return false;
	if (v === null || typeof v === "string" || typeof v === "boolean") return true;
	if (typeof v === "number") return Number.isFinite(v);
	if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
	if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return false;
	return Object.values(v).every((x) => plain(x, depth + 1));
};

/**
 * The ports handed to the page of the window there is now, by name: one per name, and a new one
 * closes the old. With no window, there is no port, and what would go on one is dropped: the
 * next window's page is shown everything again by the host.
 */
const portsFor = (current: () => BrowserWindow | null) => {
	const ports = new Map<string, MessagePortMain>();
	/** A fresh port named `name`: the page gets one end, and `heard` hears what comes on the other. */
	const push = (name: string, heard: (raw: unknown) => void) => {
		const window = current();
		if (
			!isPortName(name) ||
			window === null ||
			window.isDestroyed() ||
			!isDesk(window.webContents.getURL())
		)
			return;
		ports.get(name)?.close();
		const {port1, port2} = new MessageChannelMain();
		port1.on("message", (message) => heard(message.data));
		port1.start();
		ports.set(name, port1);
		window.webContents.postMessage(PORT_CHANNEL, name, [port2]);
	};
	const post = (name: string, m: unknown) => ports.get(name)?.postMessage(m);
	const gone = (name: string) => {
		ports.get(name)?.close();
		ports.delete(name);
	};
	/** The page was loaded again, or its window closed: every port it had is dead. */
	const reset = () => {
		for (const port of ports.values()) port.close();
		ports.clear();
	};
	return {push, post, gone, reset};
};

/** What one try to attach came to, from why it failed, in words for the window. */
const triedOf = (e: unknown): Tried => {
	if (e instanceof NoHost) return {kind: "lost", why: `The host did not start: ${e.why}.`};
	if (e instanceof NoHello)
		return {kind: "lost", why: `The host did not answer: it said no hello within ${e.within}.`};
	if (e instanceof NotStopped) return {kind: "lost", why: `The old host did not stop: ${e.why}.`};
	if (!(e instanceof Unattached))
		return {kind: "lost", why: `The host could not be started: ${String(e)}.`};
	if (e.why.kind === "version") return {kind: "version", theirs: e.why.theirs, ours: e.why.ours};
	return {kind: "lost", why: `The host did not answer: ${e.why.what}.`};
};

/** The link that is up now, and the scope it lives in: closed once the link ends. */
type Held = {readonly wire: Wire<Up>; readonly scope: Scope.Closeable};

/** Is what the window shows now the same as what it was told last? Each is plain data. */
const same = (a: LinkNow | null, b: LinkNow | null) => JSON.stringify(a) === JSON.stringify(b);

const main = Effect.gen(function* () {
	yield* Effect.tryPromise({
		try: () => app.whenReady(),
		catch: (cause) => new Error("Electron did not get ready", {cause}),
	});
	guard();
	const path = yield* Path.Path;
	// Asked for by our own page only: the scheme is registered for nothing else.
	const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
	protocol.handle(SCHEME, (request) => Effect.runPromiseWith(files)(answer(DIST, request.url)));
	const home = app.getPath("userData");

	const scope = yield* Effect.scope;
	const clock = yield* Effect.clockWith(Effect.succeed);

	/** The desk's window now, or none: closed, and on macOS the app runs on in the dock. */
	let current: BrowserWindow | null = null;
	/** The current window's page said hello, and is to be shown the desk once the link is up. */
	let paged = false;
	/** The link while it is up. Down, the reconnect machine (reconnect.ts) says what is done. */
	let held: Held | null = null;
	/** What the window was told of the link last. */
	let said: LinkNow | null = null;
	const ports = portsFor(() => current);

	const toHost = (m: Up) => held?.wire.send(m);
	/** What a port's page sends goes to the host, under the port's name. */
	const onTo = (name: string) => (raw: unknown) => {
		if (plain(raw)) toHost({type: "on", port: name, m: raw});
		else console.warn(`fabrika: refused a message on ${name} that is no plain JSON`);
	};
	/** A port whose messages go to the host, under its name. */
	const relay = (name: string) => ports.push(name, onTo(name));
	const toPage = (m: ToPage) => ports.post("desk", m);
	const fromHost = (m: Down) => {
		switch (m.type) {
			case "hello":
				return;
			// The desk's port is this process's own: it is made on the page's hello, for `down` too.
			case "port":
				if (m.port !== "desk") relay(m.port);
				return;
			case "to":
				return ports.post(m.port, m.m);
			case "gone":
				return ports.gone(m.port);
			case "close":
				return current?.close();
		}
	};
	/** Start the host on this home: the app's own binary as Node, detached, and let go. */
	const startHost = Effect.gen(function* () {
		const handle = yield* ChildProcess.make(process.execPath, [path.join(DIST, "host.mjs")], {
			env: {ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: home},
			extendEnv: true,
			detached: true,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		// Let go for good: the app never takes it back, so its way to take it back is dropped.
		yield* handle.unref.pipe(Effect.asVoid);
		return handle.exitCode;
	});
	/**
	 * One try to attach, in a scope of its own that lives as long as the link: reach the host, or
	 * start one the same way the app's start does, so the kept desk comes back.
	 */
	const starting = yield* Effect.context<
		ChildProcessSpawner.ChildProcessSpawner | Path.Path | FileSystem.FileSystem
	>();
	const tryWith = (how: typeof attach | typeof restart) =>
		Effect.gen(function* () {
			const link = yield* Scope.fork(scope);
			const exit = yield* how({home, deliver: fromHost, start: startHost}).pipe(
				Scope.provide(link),
				Effect.provideContext(starting),
				Effect.exit,
			);
			if (Exit.isFailure(exit)) {
				yield* Scope.close(link, exit);
				return triedOf(Cause.squash(exit.cause));
			}
			held = {wire: exit.value.wire, scope: link};
			if (paged) exit.value.wire.send({type: "page"});
			return exit.value.found satisfies Tried;
		});
	const tryAttach = tryWith(attach);
	/** The person said yes to the restart: this app lets go of the old host's link first. */
	const tryRestart = Effect.gen(function* () {
		const link = held;
		held = null;
		if (link !== null) yield* Scope.close(link.scope, Exit.void);
		return yield* tryWith(restart);
	});
	/** The link that is up, until it ends: then its scope closes, and the machine is told why. */
	const watch = Effect.gen(function* () {
		const link = held;
		const why = link === null ? "it was not there" : yield* link.wire.ended;
		if (held === link) held = null;
		if (link !== null) yield* Scope.close(link.scope, Exit.void);
		return {
			type: "ended",
			why: `The link to the host ended: ${why}.`,
			at: clock.currentTimeMillisUnsafe(),
		} as const;
	});
	const reconnect = yield* run(reconnectMachine, {
		interpret: {
			attach: () => tryAttach,
			restart: () => tryRestart,
			jitter: (c) => Effect.sync(() => backoffDelay(c.attempt, POLICY, defaultRng)),
		},
		subscribe: {link: () => Stream.fromEffect(watch)},
		clock: () => clock.currentTimeMillisUnsafe(),
	});
	// The window hears of the link only when what it would say changes: not on every wait.
	reconnect.observe((_, s) => {
		const note = noteOf(s);
		if (same(note, said)) return;
		said = note;
		if (note !== null) toPage({type: "link", now: note});
	});
	/** The desk's port: Try again and the restart are the app's own, and the rest goes on to the host. */
	const deskPort = () => {
		const toDesk = onTo("desk");
		ports.push("desk", (raw) => {
			const own = readToApp(raw);
			if (own.kind === "read")
				Effect.runFork(reconnect.dispatch({type: own.msg.type}).pipe(Effect.ignore));
			else toDesk(raw);
		});
	};

	/**
	 * The window there is, brought forward, or a new one: its page says hello as it loads. Quiet,
	 * the window there is is only shown, never focused.
	 */
	const showWindow = () => {
		if (current !== null) {
			if (launch.kind === "quiet") return current.showInactive();
			if (current.isMinimized()) current.restore();
			current.focus();
			return;
		}
		const made = deskWindow(path.join(DIST, "preload.cjs"), launch);
		current = made;
		made.once("closed", () => {
			if (current !== made) return;
			current = null;
			paged = false;
			ports.reset();
			// Nothing stops: the host only stops showing this page anything.
			toHost({type: "away"});
		});
	};

	ipcMain.on(PORT_CHANNEL, (event) => {
		if (current === null || !fromItsPage(current, event)) {
			console.warn(
				`fabrika: refused a hello from ${event.senderFrame?.url ?? "a frame that is gone"}`,
			);
			return;
		}
		// A hello is a page load: the ports of the page before are dead, and it is shown everything again.
		ports.reset();
		paged = true;
		deskPort();
		// What the window shows of the link first, so a banner is there before the desk comes.
		if (said !== null) toPage({type: "link", now: said});
		if (held !== null) held.wire.send({type: "page"});
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
	// closes and the link with it. The host runs on.
	yield* Effect.callback<void>((resume) => {
		const asked = (event: {preventDefault: () => void}) => {
			event.preventDefault();
			resume(Effect.void);
		};
		app.once("before-quit", asked);
		return Effect.sync(() => app.off("before-quit", asked));
	});
}).pipe(
	Effect.scoped,
	Effect.provide(
		NodeChildProcessSpawner.layer.pipe(
			Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
		),
	),
);

if (!app.requestSingleInstanceLock()) app.quit();
else
	Effect.runFork(
		main.pipe(
			Effect.matchCause({
				onFailure: (cause) => {
					console.error(Cause.pretty(cause));
					app.exit(1);
				},
				// Asked once already: this time nothing holds the quit back. Not from inside the
				// `before-quit` that asked: the scope can close in the same turn, and a quit asked
				// within that event is undone when the event's own preventDefault returns. The
				// windows then close as if no quit was asked, and the app runs on. On the next turn.
				onSuccess: () => {
					setImmediate(() => app.quit());
				},
			}),
		),
	);
