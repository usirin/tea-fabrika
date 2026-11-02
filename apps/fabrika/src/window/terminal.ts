import {Effect} from "effect";
import {FitAddon, Ghostty, Terminal} from "ghostty-web";
import wasm from "ghostty-web/ghostty-vt.wasm";
import type {TileId} from "../desk/layout/index.ts";
import {readToTerminal} from "../messages.ts";
import {fabrika, fabrikaLight, terminalTheme} from "../themes.ts";

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
// It lives outside React on purpose: a split moves a tile into a new container, and React would make
// the tile's element again, and with it a fresh terminal. The element is made once here, and the
// desk's page moves it into whichever slot the tile has now.
//
// The setup started from the draft terminal program in pull request 61 (`programs/terminal`,
// its `use-terminal.ts`): the terminal's options, fit on open, then follow the element's size,
// and the screen read back as text after each write, since Ghostty 0.4 declares `onRender` and
// never fires it. The WebAssembly is compiled from the bytes in this page's own script, not
// fetched (`Ghostty.load` fetches a data: url, which this page's policy refuses), once, and
// every tile's terminal shares it.

const LIGHT = "(prefers-color-scheme: light)";
/**
 * The built-in theme for the system's look, as the window's stylesheet picks it with light-dark().
 * Read when a terminal is made: ghostty-web 0.4 cannot change a terminal's colors once it is open.
 */
const themeNow = () => terminalTheme(window.matchMedia(LIGHT).matches ? fabrikaLight : fabrika);
/**
 * The most bytes a tile keeps to write again when its look changes, as experiment 177's spike kept
 * (1 MiB a tile). A full reset (RIS) drops what came before it.
 */
const KEPT = 1024 * 1024;
const FULL_RESET = "\x1bc";
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

	const make = () => {
		const made = new Terminal({
			ghostty,
			fontSize: 13,
			fontFamily: FONT,
			// The cursor stays still, everywhere: no blink, and no redraw twice a second for it. Only an
			// option turns blinking on in ghostty-web 0.4.0; a program's escape codes cannot.
			cursorBlink: false,
			scrollback: 1000,
			theme: themeNow(),
		});
		const fit = new FitAddon();
		made.loadAddon(fit);
		return {term: made, fit};
	};
	let {term, fit} = make();
	let opened = false;

	/**
	 * The bytes drawn so far, the newest KEPT of them, from the last full reset on: what a terminal
	 * made again in a new look is written again, so it shows what it showed.
	 */
	let kept: string[] = [];
	let keptLength = 0;
	const keep = (bytes: string) => {
		const reset = bytes.lastIndexOf(FULL_RESET);
		if (reset >= 0) {
			kept = [];
			keptLength = 0;
		}
		const part = reset >= 0 ? bytes.slice(reset) : bytes;
		kept.push(part);
		keptLength += part.length;
		while (keptLength > KEPT && kept.length > 1) keptLength -= kept.shift()?.length ?? 0;
	};

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

	/**
	 * Open the terminal in its screen, write what was kept, then send its keys and its size on the
	 * tile's port. The kept bytes are written before the terminal is heard: answers to old
	 * questions in them (where is the cursor?) must not reach tsh again, and ghostty-web answers as
	 * it writes.
	 *
	 * Its wasm terminal is reset first, below the terminal, so what is written stays only what was
	 * kept. Every tile's terminal lives in one Ghostty, and ghostty-web 0.4's wasm does not clear
	 * the memory it hands out again: a terminal made after another was freed starts with the freed
	 * one's rows, and a look change frees and makes one per tile. Without the reset, a tile showed
	 * another's `tsh$ tracker` line and broken symbols (terminal.replay.test.ts).
	 */
	const open = () => {
		term.open(screen);
		fit.fit();
		term.wasmTerm?.write(FULL_RESET);
		for (const bytes of kept) term.write(bytes);
		fit.observeResize();
		term.onData((data) => window.fabrika.send(port, {type: "keys", data}));
		term.onResize(({cols, rows}) => size(cols, rows));
		size(term.cols, term.rows);
		mirrorSoon();
	};

	/**
	 * The system's look changed. ghostty-web 0.4 does not draw a theme set after open(), so the
	 * terminal is made again in the new one and opened with what it showed (themes.md, live
	 * switching). Keys go to it as they went to the old one.
	 *
	 * Focus stays where it was. ghostty-web 0.4's open() focuses the terminal, at once and again
	 * after a zero timeout, and a look change remakes every tile's terminal, so the last one would
	 * take focus from the tile or the input a person is in. A remake that had focus keeps it;
	 * otherwise focus goes back where it was, at once and after open()'s own timeout, and where
	 * nothing had focus, the remade terminal lets go of it, so keys typed next reach no tile
	 * nobody picked (terminal.focus.test.ts). A pnpm patch
	 * that stops open() focusing would be cleaner, but every first open then needs its own focus(),
	 * and the tests model 0.4's open() as it is.
	 */
	const remake = () => {
		const old = term;
		const active: unknown = document.activeElement;
		const focused = [old.textarea, old.element].some((at) => at !== undefined && at === active);
		({term, fit} = make());
		old.dispose();
		if (!opened) return;
		open();
		if (focused) return term.focus();
		const remade = term;
		const nowhere = active === null || active === document.body;
		const back = () => {
			if (nowhere) {
				const held = document.activeElement;
				for (const at of [remade.textarea, remade.element])
					if (at !== undefined && at === held) at.blur();
			} else if (
				typeof active === "object" &&
				active !== null &&
				"focus" in active &&
				typeof active.focus === "function"
			)
				active.focus();
		};
		back();
		setTimeout(back, 0);
	};
	const look = window.matchMedia(LIGHT);
	look.addEventListener("change", remake);

	return {
		attach: (slot) => {
			if (element.parentElement !== slot) slot.append(element);
			if (opened) return fit.fit();
			opened = true;
			open();
			// Heard only once it is open: the bytes that came before wait in the preload, in order.
			window.fabrika.onMessage(port, (raw) => {
				const read = readToTerminal(raw);
				if (read.kind === "read") {
					keep(read.msg.data);
					term.write(read.msg.data, mirrorSoon);
				} else console.warn(`fabrika: refused a message for ${tile}: ${read.why}`);
			});
		},
		focus: () => term.focus(),
		dispose: () => {
			look.removeEventListener("change", remake);
			window.fabrika.forget(port);
			term.dispose();
			element.remove();
		},
	};
};
