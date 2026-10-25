import {Cause, Effect} from "effect";
import {Socket} from "effect/socket";
import {type Bridge, isPortName} from "../bridge.ts";
import type {Down, Up} from "../link.ts";
import type {ToPage} from "../messages.ts";
import {appWire, type Unattached, type Wire} from "../wire.ts";

// Experiment 150: the page's `window.fabrika` in a plain browser tab, with no Electron. It is
// the app's side of the link (link.ts, wire.ts), run in the page itself, over one WebSocket to
// the door (web/door.ts), which pipes the bytes to the host's socket file unread. The port names
// do the multiplexing, as they already do on the link: one socket, every port.
//
//   page loads         ws://<the door>/link, the cookie the door set goes with it
//   hello {version: 1} the same handshake machine as the app's (link.ts), so a host of another
//                      version is refused here too
//   page               the host shows it everything: the desk, the Ctrl-B table, a port per tile
//   send("tile:t1", m)        {type: "on", port: "tile:t1", m}, once the host handed that port
//   onMessage("tile:t1", f)   each {type: "to", port: "tile:t1", m} goes to f, in order
//   forget("tile:t1")         the line goes; what comes for it after is dropped
//
// It keeps the preload's rules (preload.ts): the names are there from the first instant; what
// the page sends on a port before the host handed it waits, in order; what comes before the page
// listens waits too. The desk's port is open as soon as the link is up, as main.ts makes it on
// the page's hello. Only a plain JSON value goes on, as main.ts checks (`plain`). Effect's own
// `Socket.makeWebSocket` with the browser's WebSocket (`Socket.layerWebSocketConstructorGlobal`)
// is all `@effect/platform-browser`'s `BrowserSocket.layerWebSocket` wraps, so that package is
// not needed.

interface Line {
	/** The host handed this port, and has not taken it away. */
	open: boolean;
	readonly waiting: unknown[];
	readonly heard: unknown[];
	listener: ((m: unknown) => void) | null;
}

const lines = new Map<string, Line>();
const lineOf = (name: string): Line => {
	const known = lines.get(name);
	if (known !== undefined) return known;
	const line: Line = {open: false, waiting: [], heard: [], listener: null};
	lines.set(name, line);
	return line;
};

const DEEPEST = 32;
/** Is `v` a plain JSON value: what goes on the link as one line (main.ts says why). */
const plain = (v: unknown, depth = 0): boolean => {
	if (depth > DEEPEST) return false;
	if (v === null || typeof v === "string" || typeof v === "boolean") return true;
	if (typeof v === "number") return Number.isFinite(v);
	if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
	if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return false;
	return Object.values(v).every((x) => plain(x, depth + 1));
};

let wire: Wire<Up> | null = null;

const hand = (name: string, m: unknown) => {
	const line = lineOf(name);
	if (line.listener === null) line.heard.push(m);
	else line.listener(m);
};
const open = (name: string) => {
	const line = lineOf(name);
	line.open = true;
	if (wire === null) return;
	for (const m of line.waiting.splice(0)) wire.send({type: "on", port: name, m});
};

const fromHost = (m: Down) => {
	switch (m.type) {
		case "hello":
			return;
		case "port":
			// The desk's port is the page's own, open once the link is up.
			if (m.port !== "desk") open(m.port);
			return;
		case "to":
			return hand(m.port, m.m);
		case "gone":
			lineOf(m.port).open = false;
			return;
		case "close":
			// The last tile closed. A tab cannot close itself, so the page loads again, and the
			// host shows it the fresh desk, as the next window shows it in the app.
			return location.reload();
	}
};

const down = (why: string) => {
	wire = null;
	for (const line of lines.values()) line.open = false;
	const m: ToPage = {type: "down", why};
	hand("desk", m);
};

const bridge: Bridge = {
	send: (to, m) => {
		if (!isPortName(to)) return;
		if (!plain(m)) return console.warn(`fabrika: refused a message on ${to} that is no plain JSON`);
		const line = lineOf(to);
		if (line.open && wire !== null) wire.send({type: "on", port: to, m});
		else line.waiting.push(m);
	},
	onMessage: (from, listener) => {
		if (!isPortName(from)) return;
		const line = lineOf(from);
		line.listener = listener;
		for (const m of line.heard.splice(0)) listener(m);
	},
	forget: (name) => {
		lines.delete(name);
	},
};
Object.defineProperty(window, "fabrika", {value: Object.freeze(bridge), enumerable: true});

/** The door's link, on the page's own origin: ws, or wss when the page came over https. */
const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/link`;

/** Why the page did not attach, in the words main.ts uses (`sayWhy`). */
const sayWhy = (e: Unattached): string =>
	e.why.kind === "version"
		? `The host that runs speaks version ${e.why.theirs} of the link, and this page speaks ${e.why.ours}. The page did not attach. That host runs on, with its jobs.`
		: `The host did not answer: ${e.why.what}.`;

const attach = Effect.gen(function* () {
	const socket = yield* Socket.makeWebSocket(url, {openTimeout: "5 seconds"});
	const w = yield* appWire(socket, fromHost);
	yield* w.up.pipe(Effect.catchTag("Unattached", (e) => Effect.die(sayWhy(e))));
	wire = w;
	open("desk");
	w.send({type: "page"});
	return yield* w.ended;
}).pipe(
	Effect.matchCause({
		onSuccess: (why) => down(`The link to the host ended: ${why}.`),
		onFailure: (cause) => {
			const said = Cause.squash(cause);
			down(typeof said === "string" ? said : `The host did not answer: ${String(said)}.`);
		},
	}),
	Effect.scoped,
	Effect.provide(Socket.layerWebSocketConstructorGlobal),
);

Effect.runFork(attach);
