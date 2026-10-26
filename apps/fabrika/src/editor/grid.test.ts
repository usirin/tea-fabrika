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

	it("gives a wide character two cells, and puts one that does not fit on the next row", () => {
		expect(gridOf("漢字", 3)).toEqual({rows: ["漢", "字"], cursor: {row: 1, col: 2}});
	});

	it("gives an accent no cell: it joins the letter before it", () => {
		expect(gridOf("éx", 80)).toEqual({rows: ["éx"], cursor: {row: 0, col: 2}});
	});

	it("writes a CSI sequence it does not know out, so a test sees it", () => {
		expect(gridOf("a\x1b[2Kb\x1b[31mc", 80).rows).toEqual(["a^[[2Kb^[[31mc"]);
	});
});
