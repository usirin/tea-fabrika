import {contextBridge, ipcRenderer} from "electron";
import {type Bridge, PORT_CHANNEL} from "./bridge.ts";

// The preload: Electron at its thinnest edge, in the window's sandbox. It asks main for its end
// of the MessagePort and gives the page `send` and `onView`, and nothing else: no ipcRenderer,
// no port, no Node (Electron's security checklist, "do not expose Electron APIs").
//
// Both names are there from the first instant, so the page never finds `window.fabrika`
// missing. What the page sends before the port arrives waits here, in order, and goes once it
// does. A view is the whole pane, so a listener added late is handed the newest one at once.

let port: MessagePort | null = null;
const waiting: unknown[] = [];
const listeners: ((m: unknown) => void)[] = [];
let newest: {readonly m: unknown} | null = null;

ipcRenderer.once(PORT_CHANNEL, (event) => {
	const [given] = event.ports;
	if (given === undefined) return;
	port = given;
	given.onmessage = (e: MessageEvent) => {
		newest = {m: e.data};
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
	onView: (listener) => {
		listeners.push(listener);
		if (newest !== null) listener(newest.m);
	},
};
contextBridge.exposeInMainWorld("fabrika", bridge);
