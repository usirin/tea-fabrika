// The one bridge between the window and the main process, as the window sees it: two names on
// `window.fabrika`, and nothing else of Electron or Node. The preload (preload.ts) puts them
// there; main.ts hands the preload its end of the MessagePort.
//
//   window.fabrika.send({type: "msg", pane: "p1", to: "tsh:p1", msg: {type: "line", value: "seq --to 3"}});
//   window.fabrika.onView((m) => draw(m));   // m is not read yet: the window reads it (readToPage)

/** The IPC channel the window asks for its port on, and main answers on. Nothing else goes over IPC. */
export const PORT_CHANNEL = "fabrika:port";

export interface Bridge {
	/** Send a message to the main process. It is read there, and refused if it does not read. */
	readonly send: (m: unknown) => void;
	/** Hear each message from the main process, from now on. Read it before using it. */
	readonly onView: (listener: (m: unknown) => void) => void;
}

declare global {
	interface Window {
		readonly fabrika: Bridge;
	}
}
