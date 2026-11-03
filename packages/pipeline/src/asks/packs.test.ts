import {defineProgram, input, output} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {misfit, type Pack, settingsOf} from "./packs.ts";

// A pack names the wires it wants by the names of the core's outputs and
// inputs, and its settings are found by its package name. Each name is looked
// up as the table's own key, so a name every object has (`constructor`,
// `toString`, `__proto__`) is refused or left out like any other name, and
// never read as something else.

const NAMES = ["constructor", "toString", "__proto__"];

const numbers = (name: string) =>
	defineProgram({
		name,
		description: "Takes numbers and says numbers.",
		inputs: {n: input(Schema.Int, "A number.")},
		outputs: {n: output(Schema.Int, "A number.")},
		main: () => Effect.void,
	});
const core = numbers("core");
/** A pack with these wires. `misfit` never starts it, so it makes no services. */
const packOf = (
	listens: Readonly<Record<string, string>>,
	answers: Readonly<Record<string, string>>,
): Pack => ({
	program: numbers("pack"),
	listens,
	answers,
	layer: () => Effect.fail("not started here"),
});

describe("misfit, on a name every object has", () => {
	it.each(NAMES)("refuses a wire named %s that neither side has, in words", (name) => {
		expect(misfit(core, packOf({[name]: "n"}, {}))).toBe(`the core has no output ${name}`);
		expect(misfit(core, packOf({n: name}, {}))).toBe(`the pack has no input ${name}`);
		expect(misfit(core, packOf({}, {[name]: "n"}))).toBe(`the pack has no output ${name}`);
		expect(misfit(core, packOf({}, {n: name}))).toBe(`the core has no input ${name}`);
	});

	it("passes a pack whose wires fit", () => {
		expect(misfit(core, packOf({n: "n"}, {n: "n"}))).toBeNull();
	});
});

describe("a pack's own settings", () => {
	it("are its table, or {} when there is none", () => {
		expect(settingsOf({"@acme/desk": {pages: "p"}}, "@acme/desk")).toEqual({pages: "p"});
		expect(settingsOf({}, "@acme/desk")).toEqual({});
	});

	it.each(NAMES)("are {} for a pack named %s with no table", (name) => {
		expect(settingsOf({}, name)).toEqual({});
	});

	it("are the table written under a name every object has", () => {
		expect(settingsOf(JSON.parse('{"__proto__": {"pages": "p"}}'), "__proto__")).toEqual({
			pages: "p",
		});
	});
});
