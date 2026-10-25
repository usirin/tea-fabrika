import {Effect} from "effect";
import {FitAddon, Ghostty, Terminal} from "ghostty-web";
import wasm from "ghostty-web/ghostty-vt.wasm";
import {readToTerminal} from "../messages.ts";

// The terminal window: a terminal, and nothing more. ghostty-web draws it: Ghostty's terminal,
// built to WebAssembly, on a canvas. It sends the keys pressed and its size, and draws the bytes
// it is sent, as a terminal emulator does with a pty. The line editor and tsh are in the main
// process (host.ts). No React: there is nothing here to hold state for.
//
// The setup started from the draft terminal program in pull request 61 (`programs/terminal`,
// its `use-terminal.ts`): the terminal's options, fit on open, then follow the window's size,
// and the screen read back as text after each write, since Ghostty 0.4 declares `onRender` and
// never fires it. What is new here: the WebAssembly is compiled from the bytes in this page's own
// script, not fetched (`Ghostty.load` fetches a data: url, which this page's policy refuses), and
// there is no React hook around it.

/** The app's own colors (window.css). */
const THEME = {background: "#16181d", foreground: "#d8dce4", cursor: "#3b82f6"};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Rows of the screen read back as text: the newest, as the draft's terminal reads them. */
const MIRRORED = 200;

/** Ghostty's terminal, compiled from the bytes bundled with this script. */
const ghostty = Effect.tryPromise({
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
	catch: (cause) => new Error("the terminal could not start its screen", {cause}),
});

/** A width or height the main process takes: between 2 and 1000 cells (messages.ts). */
const cells = (n: number) => Math.min(1000, Math.max(2, Math.floor(n)));

const boot = Effect.gen(function* () {
	const element = document.getElementById("screen");
	const text = document.getElementById("screen-text");
	if (element === null || text === null) return yield* Effect.die("the page has no screen");
	const term = new Terminal({
		ghostty: yield* ghostty,
		fontSize: 14,
		fontFamily: FONT,
		cursorBlink: true,
		scrollback: 1000,
		theme: THEME,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(element);
	fit.fit();
	fit.observeResize();
	/**
	 * The screen as text, for a screen reader and a test: the canvas is blank to both. It ends on
	 * the cursor's row, blank or not, as that is where the next text goes. Ghostty 0.4's `baseY`
	 * is always 0, so the screen's first row is found from the buffer's length.
	 */
	const mirror = () => {
		const buffer = term.buffer.active;
		const end = Math.min(buffer.length, buffer.length - term.rows + buffer.cursorY + 1);
		const rows: string[] = [];
		for (let y = Math.max(0, end - MIRRORED); y < end; y += 1)
			rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
		text.textContent = rows.join("\n");
	};
	const size = (cols: number, rows: number) =>
		window.fabrika.send({type: "size", cols: cells(cols), rows: cells(rows)});
	term.onData((data) => window.fabrika.send({type: "keys", data}));
	term.onResize(({cols, rows}) => size(cols, rows));
	size(term.cols, term.rows);
	window.fabrika.onMessage((raw) => {
		const read = readToTerminal(raw);
		if (read.kind === "read") term.write(read.msg.data, mirror);
		else console.warn(`fabrika: refused a message from the app: ${read.why}`);
	});
	term.focus();
});

Effect.runFork(
	boot.pipe(
		Effect.catchCause((cause) =>
			Effect.sync(() => {
				const text = document.getElementById("screen-text");
				if (text === null) return;
				text.setAttribute("role", "alert");
				text.textContent = `the terminal could not start: ${String(cause)}`;
			}),
		),
	),
);
