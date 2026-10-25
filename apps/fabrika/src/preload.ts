import {contextBridge, ipcRenderer} from "electron";
import {type Bridge, isPortName, PORT_CHANNEL} from "./bridge.ts";

// The preload: Electron at its thinnest edge, in the window's sandbox. It says hello to main, is
// handed a MessagePort for each thing the page talks to, by name (bridge.ts), and gives the page
// `send`, `onMessage` and `forget`, and nothing else: no ipcRenderer, no port, no Node (Electron's
// security checklist, "do not expose Electron APIs").
//
// The names are there from the first instant, so the page never finds `window.fabrika` missing.
// What the page sends on a port before it arrives waits here, in order, and goes once it does.
// What main sends before the page listens waits too, and goes to the listener, in order: a
// terminal's screen is a stream of bytes, and a byte lost is a screen drawn wrong.

/** One named port, and what waits on either side of it. */
interface Line {
	port: MessagePort | null;
	readonly waiting: unknown[];
	readonly heard: unknown[];
	listener: ((m: unknown) => void) | null;
}

const lines = new Map<string, Line>();

const lineOf = (name: string): Line => {
	const known = lines.get(name);
	if (known !== undefined) return known;
	const line: Line = {port: null, waiting: [], heard: [], listener: null};
	lines.set(name, line);
	return line;
};

ipcRenderer.on(PORT_CHANNEL, (event, name: unknown) => {
	const [given] = event.ports;
	if (given === undefined || !isPortName(name)) return;
	const line = lineOf(name);
	// A port handed again for a name, after the page was loaded again: the old one goes.
	line.port?.close();
	line.port = given;
	given.onmessage = (e: MessageEvent) => {
		if (line.listener === null) line.heard.push(e.data);
		else line.listener(e.data);
	};
	for (const m of line.waiting.splice(0)) given.postMessage(m);
});
ipcRenderer.send(PORT_CHANNEL);

const bridge: Bridge = {
	send: (to, m) => {
		if (!isPortName(to)) return;
		const line = lineOf(to);
		if (line.port === null) line.waiting.push(m);
		else line.port.postMessage(m);
	},
	onMessage: (from, listener) => {
		if (!isPortName(from)) return;
		const line = lineOf(from);
		line.listener = listener;
		for (const m of line.heard.splice(0)) listener(m);
	},
	forget: (name) => {
		lines.get(name)?.port?.close();
		lines.delete(name);
	},
};
contextBridge.exposeInMainWorld("fabrika", bridge);
