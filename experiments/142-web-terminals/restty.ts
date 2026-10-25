import font from "bench-font";
import {parseGhosttyTheme} from "restty";
import {Terminal} from "restty/xterm";
import {FONT_SIZE, listeners, type Mount, THEME} from "./term.ts";

// restty 0.3.0 through its xterm-style wrapper. It shapes text itself, so it needs a font file's
// bytes: by default it fetches fonts from a CDN, which this page refuses. The script bundles the
// machine's own monospace font as "bench-font" (never committed). restty has no public way to read
// its screen back as text or to hear that it drew, so it gets the idle, memory and fit checks
// only.

export const mount: Mount = async (slot) => {
	const term = new Terminal({
		terminal: {
			fontSize: FONT_SIZE,
			fonts: [{data: font, name: "bench mono"}],
			renderer: "auto",
			showResizeOverlay: false,
			theme: parseGhosttyTheme(
				`background = ${THEME.background}\nforeground = ${THEME.foreground}\ncursor-color = ${THEME.cursor}\n`,
			),
		},
	});
	term.open(slot);
	const drawn = listeners();
	return {
		write: (d) => term.write(d),
		onData: (f) => {
			term.onData(f);
		},
		focus: () => term.focus(),
		rows: () => [],
		onDrawn: drawn.add,
		drawn: "none: restty has no hook",
	};
};
