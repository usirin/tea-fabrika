import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

// A terminal shows one cursor, the one ghostty-web draws. It makes its element contenteditable,
// so the browser drew a text caret of its own at the element's top left corner, in every tsh
// tile. No layout runs here, so this reads the stylesheet.

const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8").replace(
	/\/\*[\s\S]*?\*\//g,
	"",
);

describe("a terminal's caret", () => {
	it("is ghostty-web's alone: the browser's is transparent on the screen", () => {
		const screen = CSS.match(/(?:^|\})\s*\.screen\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(screen).toMatch(/caret-color:\s*transparent/);
	});
});
