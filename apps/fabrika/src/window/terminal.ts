import {fabrika, fabrikaLight, terminalTheme} from "@kampus/fabrika-design";
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
					if (memory !== null) {
						console.log(
							"[ghostty-vt]",
							new TextDecoder().decode(new Uint8Array(memory.buffer, at, length)),
						);
					}
				},
			},
		});
		const exported = instance.exports.memory;

		if (exported instanceof WebAssembly.Memory) {
			memory = exported;
		}

		return new Ghostty(instance);
	},
	catch: (cause) => new Error("the terminals could not start their screen", {cause}),
});

/** How often a job's status is said again, at most: the terminal draws it each second. */
const STATUS_EVERY = 3000;
/** The lines the replies' region keeps: a screen reader reads back what came lately. */
const SAID_KEPT = 50;

/**
 * Say the newest value at most once every `ms`: the first at once, then the newest after a wait,
 * as a throttle with a trailing call does. `null` (the job is over) is said at once.
 */
const sayingEvery = (ms: number, say: (now: string | null) => void) => {
	let last = 0;
	let waiting: ReturnType<typeof setTimeout> | null = null;
	let newest: string | null = null;
	const stop = () => {
		if (waiting !== null) {
			clearTimeout(waiting);
		}

		waiting = null;
	};
	const to = (now: string | null) => {
		newest = now;
		const since = Date.now() - last;

		if (now === null || since >= ms) {
			stop();
			last = Date.now();
			say(now);
			return;
		}

		if (waiting !== null) {
			return;
		}

		waiting = setTimeout(() => {
			waiting = null;
			last = Date.now();
			say(newest);
		}, ms - since);
	};
	return Object.assign(to, {stop});
};

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
	// What a job says while it works, and the lines worth saying out loud, such as an agent's reply
	// and what it asks: live regions, out of sight as the screen's text is (WCAG 4.1.3). Each has a
	// class of its own, since `screen-text` names the screen alone, which a test reads as the tile's
	// screen. The status is said at most once every few seconds, so a screen reader is not read a
	// clock.
	const status = document.createElement("div");
	status.className = "job-status";
	status.setAttribute("role", "status");
	status.setAttribute("aria-label", `${tile} job status`);
	const said = document.createElement("div");
	said.className = "job-replies";
	said.setAttribute("role", "log");
	said.setAttribute("aria-label", `${tile} replies`);
	element.append(screen, text, status, said);
	const statusTo = sayingEvery(STATUS_EVERY, (now) => {
		status.textContent = now ?? "";
	});
	const sayLine = (line: string) => {
		const p = document.createElement("p");
		p.textContent = line;
		said.append(p);

		while (said.childElementCount > SAID_KEPT) {
			said.firstElementChild?.remove();
		}
	};

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

		while (keptLength > KEPT && kept.length > 1) {
			keptLength -= kept.shift()?.length ?? 0;
		}
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

		for (let y = Math.max(0, end - MIRRORED); y < end; y += 1) {
			rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
		}

		text.textContent = rows.join("\n");
	};
	/**
	 * Read the screen back once a frame at most, not after each write: a tile printing 2,000 lines
	 * read 200 rows back 2,000 times, and held the whole page for seconds (experiment 141).
	 */
	let mirroring = false;
	const mirrorSoon = () => {
		if (mirroring) {
			return;
		}

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
	 * Its wasm terminal is reset first, after the fit, below the terminal, so what is written stays
	 * only what was kept. Every tile's terminal lives in one Ghostty, and ghostty-web 0.4's wasm
	 * does not clear the memory it hands out again: a terminal made after another was freed starts
	 * with the freed one's rows, and a look change frees and makes one per tile. Without the reset,
	 * a tile showed another's `tsh$ tracker` line and broken symbols (terminal.replay.test.ts).
	 *
	 * It comes after the fit. Moved before it, "starts blank when a tile opens after another
	 * closed" in terminal.replay.test.ts fails with " sh$ tracker" on the first row: that test reads
	 * the screen as 0.4's renderer does (update, then getViewport) between the steps, and with those
	 * reads the fit's resize takes up the freed terminal's rows again. Runs on the bare wasm, without
	 * them, come out clean either way. The ghostty-web patch's constructor runs before the fit, so it
	 * is the same failing order. The public `term.write` is not used, because terminal.test.ts checks
	 * the replayed bytes exactly, and a reset there would show up as an extra write.
	 */
	const open = () => {
		term.open(screen);
		fit.fit();
		term.wasmTerm?.write(FULL_RESET);

		for (const bytes of kept) {
			term.write(bytes);
		}

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
	 * ghostty-web 0.4's open() calls focus(), which also queues a second focus. Suppress that
	 * call for an unfocused tile so neither focus can steal a key between timer turns. Restore
	 * the method even if opening fails: later clicks must still be able to focus the tile.
	 */
	const remake = () => {
		const old = term;
		const active: unknown = document.activeElement;
		const focused = [old.textarea, old.element].some((at) => at !== undefined && at === active);
		({term, fit} = make());
		old.dispose();

		if (!opened) {
			return;
		}

		const focus = term.focus;

		if (!focused) {
			term.focus = () => {};
		}

		try {
			open();
		} finally {
			term.focus = focus;
		}

		if (focused) {
			term.focus();
			return;
		}

		const remade = term;
		const nowhere = active === null || active === document.body;
		const back = () => {
			if (nowhere) {
				const held = document.activeElement;

				for (const at of [remade.textarea, remade.element]) {
					if (at !== undefined && at === held) {
						at.blur();
					}
				}
			} else if (
				typeof active === "object" &&
				active !== null &&
				"focus" in active &&
				typeof active.focus === "function"
			) {
				active.focus();
			}
		};
		back();
		// A focus queued before the remake can still be waiting from the old terminal.
		setTimeout(back, 0);
	};
	const look = window.matchMedia(LIGHT);
	look.addEventListener("change", remake);

	return {
		attach: (slot) => {
			if (element.parentElement !== slot) {
				slot.append(element);
			}

			if (opened) {
				return fit.fit();
			}

			opened = true;
			open();
			// Heard only once it is open: the bytes that came before wait in the preload, in order.
			window.fabrika.onMessage(port, (raw) => {
				const read = readToTerminal(raw);

				if (read.kind === "refused") {
					console.warn(`fabrika: refused a message for ${tile}: ${read.why}`);
					return;
				}

				const {msg} = read;

				if (msg.type === "status") {
					statusTo(msg.text);
				} else if (msg.type === "said") {
					sayLine(msg.text);
				} else {
					keep(msg.data);
					term.write(msg.data, mirrorSoon);
				}
			});
		},
		focus: () => term.focus(),
		dispose: () => {
			look.removeEventListener("change", remake);
			statusTo.stop();
			window.fabrika.forget(port);
			term.dispose();
			element.remove();
		},
	};
};
