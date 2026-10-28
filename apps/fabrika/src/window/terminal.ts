import {Effect} from "effect";
import {FitAddon, Ghostty, Terminal} from "ghostty-web";
import wasm from "ghostty-web/ghostty-vt.wasm";
import type {TileId} from "../desk/layout/index.ts";
import {readToTerminal} from "../messages.ts";

// A tile's terminal: a terminal, and nothing more. ghostty-web draws it: Ghostty's terminal,
// built to WebAssembly, on a canvas. It sends the keys pressed and its size on its tile's port,
// and draws the bytes it is sent, as a terminal emulator does with a pty. The line editor and tsh
// are in the host process (tsh.ts, one per tile).
//
//   const term = terminalFor(ghostty, "t1");
//   term.attach(slot);      // drawn in the tile's slot; moved, not made again, as the layout changes
//   term.focus();           // its keys go to t1's tsh
//   term.dispose();         // the tile closed: its port goes
//
// It lives outside React on purpose: a split moves a tile into a new stack, and React would make
// the tile's element again, and with it a fresh terminal. The element is made once here, and the
// desk's page moves it into whichever slot the tile has now.
//
// The setup started from the draft terminal program in pull request 61 (`programs/terminal`,
// its `use-terminal.ts`): the terminal's options, fit on open, then follow the element's size,
// and the screen read back as text after each write, since Ghostty 0.4 declares `onRender` and
// never fires it. The WebAssembly is compiled from the bytes in this page's own script, not
// fetched (`Ghostty.load` fetches a data: url, which this page's policy refuses), once, and
// every tile's terminal shares it.

/** The app's own colors (window.css): a tile's surface (`--n-2`), and its second ink (`--n-11`). */
const THEME = {background: "#101113", foreground: "#bababc", cursor: "#bababc"};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Rows of the screen read back as text: the newest, as the draft's terminal reads them. */
const MIRRORED = 200;

/** Ghostty's terminal, compiled from the bytes bundled with this script. */
export const loadGhostty = Effect.tryPromise({
	try: async () => {
		let memory: WebAssembly.Memory | null = null;
		const {instance} = await WebAssembly.instantiate(wasm, {
			env: {
				// Ghostty's own log: a text in its memory, at `at`, `length` bytes long.
				log: (at: number, length: number) => {
					if (memory !== null)
						console.log(
							"[ghostty-vt]",
							new TextDecoder().decode(new Uint8Array(memory.buffer, at, length)),
						);
				},
			},
		});
		const exported = instance.exports.memory;
		if (exported instanceof WebAssembly.Memory) memory = exported;
		return new Ghostty(instance);
	},
	catch: (cause) => new Error("the terminals could not start their screen", {cause}),
});

/** A width or height the main process takes: between 2 and 1000 cells (messages.ts). */
const cells = (n: number) => Math.min(1000, Math.max(2, Math.floor(n)));

export interface TileTerminal {
	/** Draw it in `slot`: the first time, the terminal opens there; after, it moves there. */
	readonly attach: (slot: HTMLElement) => void;
	/** Keys go to it. */
	readonly focus: () => void;
	/** The tile closed: the terminal goes, and so does its port. */
	readonly dispose: () => void;
}

export const terminalFor = (ghostty: Ghostty, tile: TileId): TileTerminal => {
	const port = `tile:${tile}`;
	const element = document.createElement("div");
	element.className = "term";
	const screen = document.createElement("div");
	screen.className = "screen";
	// The screen as text: the canvas is blank to a screen reader, and to a test. A named region,
	// so a screen reader can go to it. Not a live region: it is written whole after each write,
	// and a live one would read it all out again each time.
	const text = document.createElement("section");
	text.className = "screen-text";
	text.setAttribute("aria-label", `${tile} screen`);
	element.append(screen, text);

	const term = new Terminal({
		ghostty,
		fontSize: 13,
		fontFamily: FONT,
		// The cursor stays still, everywhere: no blink, and no redraw twice a second for it. Only an
		// option turns blinking on in ghostty-web 0.4.0; a program's escape codes cannot.
		cursorBlink: false,
		scrollback: 1000,
		theme: THEME,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	let opened = false;

	/**
	 * The screen as text. It ends on the cursor's row, blank or not, as that is where the next
	 * text goes. Ghostty 0.4's `baseY` is always 0, so the screen's first row is found from the
	 * buffer's length.
	 */
	const mirror = () => {
		const buffer = term.buffer.active;
		const end = Math.min(buffer.length, buffer.length - term.rows + buffer.cursorY + 1);
		const rows: string[] = [];
		for (let y = Math.max(0, end - MIRRORED); y < end; y += 1)
			rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
		text.textContent = rows.join("\n");
	};
	/**
	 * Read the screen back once a frame at most, not after each write: a tile printing 2,000 lines
	 * read 200 rows back 2,000 times, and held the whole page for seconds (experiment 141).
	 */
	let mirroring = false;
	const mirrorSoon = () => {
		if (mirroring) return;
		mirroring = true;
		requestAnimationFrame(() => {
			mirroring = false;
			mirror();
		});
	};
	const size = (cols: number, rows: number) =>
		window.fabrika.send(port, {type: "size", cols: cells(cols), rows: cells(rows)});

	return {
		attach: (slot) => {
			if (element.parentElement !== slot) slot.append(element);
			if (opened) return fit.fit();
			opened = true;
			term.open(screen);
			fit.fit();
			fit.observeResize();
			term.onData((data) => window.fabrika.send(port, {type: "keys", data}));
			term.onResize(({cols, rows}) => size(cols, rows));
			size(term.cols, term.rows);
			// Heard only once it is open: the bytes that came before wait in the preload, in order.
			window.fabrika.onMessage(port, (raw) => {
				const read = readToTerminal(raw);
				if (read.kind === "read") term.write(read.msg.data, mirrorSoon);
				else console.warn(`fabrika: refused a message for ${tile}: ${read.why}`);
			});
		},
		focus: () => term.focus(),
		dispose: () => {
			window.fabrika.forget(port);
			term.dispose();
			element.remove();
		},
	};
};
