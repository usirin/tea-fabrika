// The one bridge between a window and the main process, as the window sees it: two names on
// `window.fabrika`, and nothing else of Electron or Node. The preload (preload.ts) puts them
// there; main.ts hands the preload its end of the MessagePort. Both kinds of window, the
// terminal and a program's, have the same two.
//
//   window.fabrika.send({type: "keys", data: "cou\t"});
//   window.fabrika.onMessage((m) => draw(m));   // m is not read yet: the window reads it (messages.ts)

/** The IPC channel a window asks for its port on, and main answers on. Nothing else goes over IPC. */
export const PORT_CHANNEL = "fabrika:port";

export interface Bridge {
	/** Send a message to the main process. It is read there, and refused if it does not read. */
	readonly send: (m: unknown) => void;
	/**
	 * Hear each message from the main process, in order. What came before the first listener is
	 * handed to it first: the terminal's bytes are a stream, and none may be lost. Read each before
	 * using it.
	 */
	readonly onMessage: (listener: (m: unknown) => void) => void;
}

declare global {
	interface Window {
		readonly fabrika: Bridge;
	}
}
