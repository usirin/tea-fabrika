import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

// One box scrolls in a tile: a program's view, the frame's one child. Two nested boxes that both
// scroll drew two scrollbars side by side in the ticket's tile, and squeezed the tracker's
// timeline to a sliver with a bar of its own. No layout runs here, so this reads the stylesheet:
// the frame clips, and the rule for its child is the only one in a tile that lets anything
// scroll. Over the desk, the window's frame opens a list or the palette; each scrolls once, the
// palette by its list alone.

const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8");

/** Each innermost rule of a stylesheet: its selector and its declarations, comments gone. */
const rulesOf = (css: string) =>
	[...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
		([, selector = "", body = ""]) => ({
			selector: selector.trim().replace(/\s+/g, " "),
			says: new Map(
				body
					.split(";")
					.map((d) => d.split(":").map((s) => s.trim()))
					.filter((d): d is [string, string] => d.length === 2 && d[0] !== ""),
			),
		}),
	);

/** The selectors whose rule lets a box scroll, on either axis. */
const scrollersOf = (css: string) =>
	rulesOf(css)
		.filter((r) =>
			[...r.says].some(([k, v]) => k.startsWith("overflow") && /\b(auto|scroll)\b/.test(v)),
		)
		.map((r) => r.selector);

describe("a tile's scroll", () => {
	it("is the view's alone: the frame clips, and only the frame's lists over the desk scroll too", () => {
		expect(scrollersOf(CSS)).toEqual(["main.program > *", ".over", ".palette ul"]);
		const frame = rulesOf(CSS).filter((r) => r.selector === "main.program");
		expect(frame.map((r) => r.says.get("overflow"))).toEqual(["clip"]);
		const palette = rulesOf(CSS).filter((r) => r.selector === ".palette");
		expect(palette.map((r) => r.says.get("overflow"))).toEqual(["clip"]);
	});

	it("catches a box that scrolls inside a view, on either axis, in a query too", () => {
		expect(scrollersOf(`${CSS}\n.tracker-timeline { flex: 1; overflow: auto; }`)).toContain(
			".tracker-timeline",
		);
		expect(
			scrollersOf(`${CSS}\n@container main (max-width: 9px) { .x { overflow-x: scroll } }`),
		).toContain(".x");
		expect(scrollersOf(`${CSS}\n.y { overflow-y: hidden; }`)).not.toContain(".y");
	});
});
