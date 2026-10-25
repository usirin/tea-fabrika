import {FitAddon} from "@xterm/addon-fit";
import {Terminal} from "@xterm/xterm";
import {FONT, FONT_SIZE, listeners, type Mount, SCROLLBACK, THEME} from "./term.ts";

// xterm.js 6.0.0, in three variants: its default DOM renderer; "webgl", its WebGL addon (VS
// Code's default); and "sr", the DOM renderer with its screen reader mode on, which keeps a
// second copy of the rows for assistive technology. Its stylesheet, xterm.css, is linked by the
// page, copied beside it.

export const mount: Mount = async (slot, variant) => {
	const term = new Terminal({
		screenReaderMode: variant === "sr",
		fontSize: FONT_SIZE,
		fontFamily: FONT,
		cursorBlink: true,
		cursorInactiveStyle: "outline",
		scrollback: SCROLLBACK,
		theme: THEME,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(slot);
	if (variant === "webgl") {
		const {WebglAddon} = await import("@xterm/addon-webgl");
		term.loadAddon(new WebglAddon());
	}
	fit.fit();
	const drawn = listeners();
	term.onRender(() => drawn.fire());
	return {
		write: (d) => term.write(d),
		onData: (f) => {
			term.onData(f);
		},
		focus: () => term.focus(),
		rows: () => {
			const buffer = term.buffer.active;
			const out: string[] = [];
			for (let y = 0; y < term.rows; y += 1)
				out.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "");
			return out;
		},
		onDrawn: drawn.add,
		drawn: "its onRender event",
	};
};
