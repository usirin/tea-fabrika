import {expect, it} from "vitest";
import {clamp} from "./clamp.ts";

// The planted weak test: a number inside, a number below, and nothing above.

it("keeps a number inside", () => {
	expect(clamp(5, 0, 10)).toBe(5);
});

it("lifts a number below", () => {
	expect(clamp(-3, 0, 10)).toBe(0);
});

it("refuses a low above the high", () => {
	expect(() => clamp(1, 10, 0)).toThrow();
});
