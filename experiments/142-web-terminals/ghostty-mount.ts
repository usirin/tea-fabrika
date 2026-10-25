import wasm from "ghostty-web/ghostty-vt.wasm";
import {FONT, FONT_SIZE, listeners, type Mount, SCROLLBACK, THEME} from "./term.ts";

// ghostty-web 0.4.0, set up as the app sets it up: the WebAssembly compiled from the bytes in the
// page's own script, once, shared by every terminal. Variant "steady" turns cursor blink off, to
// see whether blink alone is what keeps it busy. The library comes in as an argument, so the
// same setup mounts the published build (ghostty-web.ts) and the patched one
// (ghostty-web-patched.ts), and neither page loads the other's code.

type Lib = typeof import("ghostty-web");

/** Time spent inside render calls, every terminal together: read as `bench.renderTime`. */
export const renderTime = {ms: 0, calls: 0};
Object.assign(globalThis, {renderTime});

export const mountWith = ({FitAddon, Ghostty, Terminal}: Lib): Mount => {
	let shared: Promise<InstanceType<Lib["Ghostty"]>> | null = null;
	const ghostty = () => {
		shared ??= WebAssembly.instantiate(wasm, {env: {log: () => {}}}).then(
			({instance}) => new Ghostty(instance),
		);
		return shared;
	};
	return (slot, variant) => mountOne(ghostty, Terminal, FitAddon, slot, variant);
};

const mountOne = async (
	ghostty: () => Promise<InstanceType<Lib["Ghostty"]>>,
	Terminal: Lib["Terminal"],
	FitAddon: Lib["FitAddon"],
	slot: HTMLElement,
	variant: string,
) => {
	const term = new Terminal({
		ghostty: await ghostty(),
		fontSize: FONT_SIZE,
		fontFamily: FONT,
		cursorBlink: variant !== "steady",
		scrollback: SCROLLBACK,
		theme: THEME,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(slot);
	fit.fit();
	// ghostty-web declares onRender and never fires it: the hook is its renderer's render call,
	// which its loop makes on every animation frame.
	const drawn = listeners();
	const renderer = term.renderer;
	if (renderer !== undefined) {
		const render = renderer.render.bind(renderer);
		renderer.render = (...a) => {
			const t0 = performance.now();
			render(...a);
			renderTime.ms += performance.now() - t0;
			renderTime.calls += 1;
			drawn.fire();
		};
	}
	return {
		write: (data) => term.write(data),
		onData: (f) => {
			term.onData(f);
		},
		focus: () => term.focus(),
		rows: () => {
			const buffer = term.buffer.active;
			const top = buffer.length - term.rows;
			const out: string[] = [];
			for (let y = 0; y < term.rows; y += 1)
				out.push(buffer.getLine(top + y)?.translateToString(true) ?? "");
			return out;
		},
		onDrawn: drawn.add,
		drawn: "its renderer's render(), wrapped",
	};
};
