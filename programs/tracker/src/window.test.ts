import {describe, expect, it} from "vitest";
import {whenOf} from "./window.tsx";

// When a fact was written, as the window says it: short today, longer the further back it is.

describe("when", () => {
	const now = new Date(2026, 9, 25, 16, 30).getTime();
	it("is the time today, yesterday and the time, the day this year, and the year before that", () => {
		expect(
			[
				new Date(2026, 9, 25, 9, 5),
				new Date(2026, 9, 24, 23, 59),
				new Date(2026, 2, 3, 12, 0),
				new Date(2025, 11, 31, 8, 0),
			].map((d) => whenOf(d.getTime(), now)),
		).toEqual(["09:05", "yesterday 23:59", "3 Mar 12:00", "31 Dec 2025 08:00"]);
	});
});
