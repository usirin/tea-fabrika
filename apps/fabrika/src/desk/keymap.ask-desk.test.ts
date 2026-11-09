import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {decodeKeys, programCommandOn} from "./keymap.ts";

// P14. Today's program-scoped commands, shared by ticket, tracker and the old asks menu.
const command: (
	keys: unknown,
	scope: string,
	key: string,
	state: {focused: boolean; typing: boolean; prefix: boolean; platform: boolean},
) => unknown = programCommandOn;
describe("ask desk P14: scoped and configurable keys", () => {
	it("bare letters stay refused globally and work only inside the focused ask", () => {
		expect(Result.isFailure(decodeKeys('tezgah.zoom = "y"', true))).toBe(true);
		const keys = decodeKeys("", true);
		if (Result.isFailure(keys)) throw new Error(keys.failure.why);
		const focus = {focused: true, typing: false, prefix: false, platform: false};
		expect(command(keys.success, "ask", "y", focus)).toEqual({type: "do", value: {_tag: "rec"}});
		for (const state of [
			{...focus, focused: false},
			{...focus, typing: true},
			{...focus, prefix: true},
			{...focus, platform: true},
		])
			expect(command(keys.success, "ask", "y", state)).toBeUndefined();
	});
	// docs/direction/ask-desk.md, A3 (line 319, traced at line 52): `y` takes the rec. The default
	// lives in ASK_COMMANDS (packages/pipeline/src/tickets/ask.ts); the table is keymap.ts's.
	it("vector: with no keys file, the default rec key is y, and only y", () => {
		const keys = decodeKeys("", true);
		if (Result.isFailure(keys)) throw new Error(keys.failure.why);
		const rec = keys.success.programs?.find((r) => r.does === "program.ask.rec");
		expect(rec?.keys).toEqual([{_tag: "alone", key: "y"}]);
		expect(rec?.source).toBe("default");
	});
	it("rebinds and unbinds the same command table used by the buttons", () => {
		const keys = decodeKeys('program.ask.rec = "r"\nprogram.ask.not = []', true);
		if (Result.isFailure(keys)) throw new Error(keys.failure.why);
		const focus = {focused: true, typing: false, prefix: false, platform: false};
		expect(command(keys.success, "ask", "r", focus)).toEqual({type: "do", value: {_tag: "rec"}});
		expect(command(keys.success, "ask", "y", focus)).toBeUndefined();
		expect(command(keys.success, "ask", "n", focus)).toBeUndefined();
	});
});
