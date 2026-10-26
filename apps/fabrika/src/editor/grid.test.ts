import {describe, expect, it} from "vitest";
import {gridOf} from "./grid.ts";

// The test grid itself: the few things a terminal does that the line editor's tests lean on.

describe("the test grid", () => {
	it("clears from the cursor to the end of the row on CSI K, and leaves the cursor there", () => {
		expect(gridOf("tsh$ seq 3\r\x1b[5C\x1b[K", 80)).toEqual({
			rows: ["tsh$"],
			cursor: {row: 0, col: 5},
		});
	});

	it("leaves the other rows alone on CSI K", () => {
		expect(gridOf("one\r\ntwo\r\nthree\x1b[1A\r\x1b[K", 80).rows).toEqual(["one", "", "three"]);
	});

	it("clears to the end of the screen on CSI J", () => {
		expect(gridOf("one\r\ntwo\r\nthree\x1b[1A\r\x1b[J", 80).rows).toEqual(["one", ""]);
	});

	it("clears every row, scrollback too, and homes the cursor on ESC c", () => {
		expect(gridOf("one\r\ntwo\r\n\x1bctsh$ ", 80, 1)).toEqual({
			rows: ["tsh$"],
			cursor: {row: 0, col: 5},
		});
	});

	it("writes a CSI sequence it does not know out, so a test sees it", () => {
		expect(gridOf("a\x1b[2Kb\x1b[31mc", 80).rows).toEqual(["a^[[2Kb^[[31mc"]);
	});
});
