// The one bridge between the window and the main process, as the page sees it: three names on
// `window.fabrika`, and nothing else of Electron or Node. The preload (preload.ts) puts them
// there; main.ts hands the preload one MessagePort for each thing the page talks to, by name:
//
//   "desk"              the desk's Msgs and Cmds (messages.ts, ToDesk and FromDesk)
//   "tile:t1"           tile t1's terminal: keys and size out, bytes in
//   "run:counter:1a2b"  one run's view: its msgs out, its view's data in
//
// A port is one tile's or one run's, so a message on it can only be for that tile or that run.
//
//   window.fabrika.send("tile:t1", {type: "keys", data: "cou\t"});
//   window.fabrika.onMessage("tile:t1", (m) => draw(m));   // m is not read yet: the page reads it
//   window.fabrika.forget("tile:t1");                      // the tile closed: its port goes

/** The IPC channel the page says hello on, and main hands each port on. Nothing else goes over IPC. */
export const PORT_CHANNEL = "fabrika:port";

/** A port's name: the desk's, a tile's, or a run's. Nothing else is handed a port. */
export const isPortName = (name: unknown): name is string =>
	typeof name === "string" &&
	(name === "desk" ||
		/^tile:t[0-9]{1,9}$/.test(name) ||
		/^run:[A-Za-z0-9_-]{1,64}:[0-9a-f]{1,16}$/.test(name));

export interface Bridge {
	/** Send a message on the port named `to`. It is read in main, and refused if it does not read. */
	readonly send: (to: string, m: unknown) => void;
	/**
	 * Hear each message on the port named `from`, in order, with this listener alone. What came
	 * before is handed to it first: a terminal's bytes are a stream, and none may be lost. Read
	 * each before using it.
	 */
	readonly onMessage: (from: string, listener: (m: unknown) => void) => void;
	/** Done with the port named `name`: it closes, and what waited on it goes. */
	readonly forget: (name: string) => void;
}

declare global {
	interface Window {
		readonly fabrika: Bridge;
	}
}
