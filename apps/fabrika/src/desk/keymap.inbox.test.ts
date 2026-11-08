import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {decodeKeys} from "./keymap.ts";

describe("today's inbox live keys", () => {
	it("I17: the personal keys file rebinds and unbinds the program's declared Open all", () => {
		const rebound = decodeKeys('program.inbox.open = "shift+i"', true);
		expect(Result.isSuccess(rebound), "I17: keys still know only hard-coded program commands").toBe(
			true,
		);
		if (Result.isFailure(rebound)) throw new Error(rebound.failure.why);
		expect(rebound.success.rows).toContainEqual(
			expect.objectContaining({
				does: "program.inbox.open",
				keys: [expect.objectContaining({key: "I"})],
			}),
		);
		const unbound = decodeKeys("program.inbox.open = []", true);
		expect(Result.isSuccess(unbound)).toBe(true);
		if (Result.isFailure(unbound)) throw new Error(unbound.failure.why);
		expect(unbound.success.rows).toContainEqual(
			expect.objectContaining({does: "program.inbox.open", keys: []}),
		);
	});
});
