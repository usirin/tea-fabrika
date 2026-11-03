import {SEVEN_BODY} from "@tea-fabrika/tracker/seven";
import {describe, expect, it} from "vitest";
import {paragraphsOf} from "./window.tsx";

// A body's paragraphs, keyed by where each starts, so two alike still get keys of their own.

describe("paragraphsOf", () => {
	it("splits on a blank line and keys each paragraph by its place in the body", () => {
		const ps = paragraphsOf(SEVEN_BODY);
		expect(ps.map((p) => p.text.slice(0, 10))).toEqual(["Every line", "Done when "]);
		expect(ps.map((p) => SEVEN_BODY.slice(p.at, p.at + 10))).toEqual(["Every line", "Done when "]);
	});

	it("gives two paragraphs alike two keys, and drops blank ones", () => {
		expect(paragraphsOf("\n\nSame.\n  \nSame.")).toEqual([
			{at: 2, text: "Same."},
			{at: 11, text: "Same."},
		]);
	});
});
