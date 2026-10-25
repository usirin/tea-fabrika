import {WTerm} from "@wterm/dom";
import {GhosttyCore} from "@wterm/ghostty";
import {FONT, FONT_SIZE, listeners, type Mount, THEME} from "./term.ts";

// wterm 0.5.5 with its libghostty core: rows in the DOM, styled by its own stylesheet
// (page.html links @wterm/dom's terminal.css, copied beside the page). The core is fetched from
// the page's own files: GhosttyCore.load takes a URL and nothing else in its public API.
// Each terminal has its own core; the compiled module is shared (wterm's own cache).

export const mount: Mount = async (slot) => {
	slot.style.setProperty("--term-bg", THEME.background);
	slot.style.setProperty("--term-fg", THEME.foreground);
	slot.style.setProperty("--term-cursor", THEME.cursor);
	slot.style.setProperty("--term-font-family", FONT);
	slot.style.setProperty("--term-font-size", `${FONT_SIZE}px`);
	slot.style.setProperty("--term-row-height", "16px");
	// The slot's own padding is the tile's (page.css); wterm's card look is dropped.
	slot.style.padding = "0";
	slot.style.borderRadius = "0";
	slot.style.boxShadow = "none";
	const core = await GhosttyCore.load({
		wasmPath: "ghostty-vt.wasm",
		// About 1,000 rows at this width: Ghostty counts history in bytes, not rows.
		scrollbackLimit: 1_000_000,
		foregroundColor: THEME.foreground,
		backgroundColor: THEME.background,
	});
	const data = listeners<[string]>();
	const term = new WTerm(slot, {core, cursorBlink: true, onData: (d) => data.fire(d)});
	await term.init();
	// wterm draws by writing its rows' DOM: a change to them is the draw.
	const drawn = listeners();
	new MutationObserver(() => drawn.fire()).observe(slot, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	const grid = () => slot.querySelector(".term-grid");
	return {
		write: (d) => term.write(d),
		onData: data.add,
		focus: () => term.focus(),
		rows: () =>
			[...(grid()?.querySelectorAll(":scope > .term-row") ?? [])].map((r) =>
				(r.textContent ?? "").trimEnd(),
			),
		onDrawn: drawn.add,
		drawn: "a change to its rows in the DOM (MutationObserver)",
	};
};
