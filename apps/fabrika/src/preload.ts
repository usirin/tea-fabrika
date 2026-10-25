import {contextBridge, ipcRenderer} from "electron";
import {type Bridge, PORT_CHANNEL} from "./bridge.ts";

// The preload: Electron at its thinnest edge, in each window's sandbox. It asks main for its end
// of the MessagePort and gives the page `send` and `onMessage`, and nothing else: no
// ipcRenderer, no port, no Node (Electron's security checklist, "do not expose Electron APIs").
//
// Both names are there from the first instant, so the page never finds `window.fabrika`
// missing. What the page sends before the port arrives waits here, in order, and goes once it
// does. What main sends before the page listens waits too, and goes to the first listener, in
// order: the terminal's screen is a stream of bytes, and a byte lost is a screen drawn wrong.

let port: MessagePort | null = null;
const waiting: unknown[] = [];
const heard: unknown[] = [];
const listeners: ((m: unknown) => void)[] = [];

ipcRenderer.once(PORT_CHANNEL, (event) => {
	const [given] = event.ports;
	if (given === undefined) return;
	port = given;
	given.onmessage = (e: MessageEvent) => {
		if (listeners.length === 0) heard.push(e.data);
		for (const listener of listeners) listener(e.data);
	};
	for (const m of waiting.splice(0)) given.postMessage(m);
});
ipcRenderer.send(PORT_CHANNEL);

const bridge: Bridge = {
	send: (m) => {
		if (port === null) waiting.push(m);
		else port.postMessage(m);
	},
	onMessage: (listener) => {
		listeners.push(listener);
		if (listeners.length === 1) for (const m of heard.splice(0)) listener(m);
	},
};
contextBridge.exposeInMainWorld("fabrika", bridge);
