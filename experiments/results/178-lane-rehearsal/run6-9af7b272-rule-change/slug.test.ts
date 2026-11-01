import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

it("makes a slug", () => {
	expect(slugify("Çay Şeker")).toBe("cay-seker");
	expect(slugify("!!!")).toBe("");
});

it.each([41, 79, 80, 81, 300])(
	"retains up to 80 characters from a normalized slug of length %i",
	(length) => {
		expect(slugify("  " + "É".repeat(length) + "!!!")).toBe(
			"e".repeat(Math.min(length, 80)),
		);
	},
);

it("removes a hyphen exposed at the 80-character cutoff", () => {
	expect(slugify("É".repeat(79) + "   next")).toBe("e".repeat(79));
});

it("preserves separators inside the 80-character limit", () => {
	expect(slugify("a".repeat(78) + " next")).toBe("a".repeat(78) + "-n");
});
