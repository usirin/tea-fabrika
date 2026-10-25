import {FONT, FONT_SIZE, listeners, type Mount} from "./term.ts";

// The control: no terminal library at all. Each tile is a plain <pre> that bytes are appended to,
// with no cursor and no escape codes understood. What an idle Electron page with N tiles costs
// before any library is added.

export const mount: Mount = async (slot) => {
	const pre = document.createElement("pre");
	pre.style.margin = "0";
	pre.style.fontFamily = FONT;
	pre.style.fontSize = `${FONT_SIZE}px`;
	pre.style.color = "#d8dce4";
	slot.append(pre);
	const drawn = listeners();
	return {
		write: (d) => {
			pre.textContent += d.replaceAll("\r", "");
		},
		onData: () => {},
		focus: () => {},
		rows: () => (pre.textContent ?? "").split("\n"),
		onDrawn: drawn.add,
		drawn: "none: the control draws nothing of its own",
	};
};
