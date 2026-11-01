import fc from "fast-check";
import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

// Law: a slug is never longer than 80 characters, and never ends on a hyphen.
it("a slug stays within its limit", () => {
	fc.assert(
		fc.property(fc.string({maxLength: 300}), (title) => {
			const slug = slugify(title);
			expect(slug.length).toBeLessThanOrEqual(80);
			expect(slug.endsWith("-")).toBe(false);
		}),
		{seed: 1},
	);
});
