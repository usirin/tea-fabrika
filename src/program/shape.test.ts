import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {announced, handoff, log, operator, PR, ship} from "./example.ts";
import {listing, output} from "./program.ts";
import {fit, input, type StandardShape} from "./shape.ts";

// Fit is exact and reads only the shape. Listing is the program's man page.

/** A Standard Schema from outside Effect: it checks, and carries no JSON Schema. */
const anyString: StandardShape<string> = {
	"~standard": {
		version: 1,
		vendor: "by-hand",
		validate: (value) =>
			typeof value === "string" ? {value} : {issues: [{message: "not a string"}]},
	},
};

describe("fit", () => {
	it("an output fits the input it is wired to: ship's announcements to the log, the operator's handoff to ship", () => {
		expect(fit(announced, log.inputs.heard)).toBe("fits");
		expect(fit(handoff, ship.inputs.hand)).toBe("fits");
		expect(fit(announced, operator.inputs.outcome)).toBe("fits");
	});

	it("more fields does not fit, and fewer does not either", () => {
		const more = output(
			"probe_more",
			Schema.Struct({...PR.fields, base: Schema.String}),
			"A pull request and its base.",
		);
		expect(fit(more, ship.inputs.hand)).toBe("does_not_fit");
		const fewer = output("probe_fewer", Schema.Struct({pr: PR.fields.pr}), "Only the number.");
		expect(fit(fewer, ship.inputs.hand)).toBe("does_not_fit");
	});

	it("a looser field does not fit: any string where the input names its words", () => {
		const loose = output(
			"probe_loose",
			Schema.Struct({pr: Schema.String, kind: Schema.String, why: Schema.String}),
			"An outcome, loosely.",
		);
		expect(fit(loose, log.inputs.heard)).toBe("does_not_fit");
	});

	it("a check the JSON Schema leaves out is a check fit cannot see (effect 4.0.0 drops `isPattern`)", () => {
		const unpatterned = output(
			"probe_unpatterned",
			Schema.Struct({pr: Schema.String, head: Schema.String}),
			"Any two strings.",
		);
		expect(fit(unpatterned, ship.inputs.hand)).toBe("fits");
		expect(ship.inputs.hand.shape.check({pr: "seven", head: "x"})).toBe(false);
	});

	it("descriptions never change fit, on the declaration or inside the schema", () => {
		const said = output(
			"probe_said",
			PR.annotate({description: "Said another way", title: "PR"}),
			"Worded differently.",
		);
		expect(fit(said, ship.inputs.hand)).toBe("fits");
	});

	it("a shape with no JSON Schema answers cannot_tell", () => {
		const loose = output("probe_standard", anyString, "A string, checked by hand.");
		expect(fit(loose, input(anyString, "A string."))).toBe("cannot_tell");
		expect(fit(loose, log.inputs.heard)).toBe("cannot_tell");
	});
});

describe("a shape only checks", () => {
	it("a schema that converts to another type does not compile, and is refused when made", () => {
		// @ts-expect-error: its two sides differ (string in, number out)
		expect(() => input(Schema.Struct({n: Schema.FiniteFromString}), "A number.")).toThrow(
			/only checks/,
		);
	});

	it("a schema that converts within one type compiles, and is refused when made", () => {
		expect(() => input(Schema.Struct({name: Schema.Trim}), "A name.")).toThrow(/only checks/);
	});

	it("a check passes the value on as it came: a Standard Schema's output is never used", () => {
		const shouting: StandardShape<string> = {
			"~standard": {
				version: 1,
				vendor: "by-hand",
				validate: (value) =>
					typeof value === "string" ? {value: value.toUpperCase()} : {issues: [{message: "no"}]},
			},
		};
		const said = input(shouting, "Anything.");
		expect(said.shape.check("quiet")).toBe(true);
	});

	it("a check that throws or does not answer now is a no", () => {
		const throws: StandardShape<string> = {
			"~standard": {
				version: 1,
				vendor: "by-hand",
				validate: () => {
					throw new Error("boom");
				},
			},
		};
		const later: StandardShape<string> = {
			"~standard": {
				version: 1,
				vendor: "by-hand",
				validate: async (value) => ({value: `${value}`}),
			},
		};
		expect(input(throws, "x").shape.check("a")).toBe(false);
		expect(input(later, "x").shape.check("a")).toBe(false);
	});

	it("an input or output with a blank description is refused", () => {
		expect(() => input(PR, "  ")).toThrow(/description/);
		expect(() => output("probe_blank", PR, "")).toThrow(/description/);
	});
});

describe("listing", () => {
	it("names each input and output, its direction, its description and its JSON Schema", () => {
		const lines = listing(ship);
		expect(lines.map(({name, direction}) => ({name, direction}))).toEqual([
			{name: "hand", direction: "input"},
			{name: "ship_announced", direction: "output"},
		]);
		expect(lines[0]?.description).toMatch(/merge queue/);
		expect(lines[0]?.schema).toMatchObject({
			type: "object",
			required: ["pr", "head"],
			additionalProperties: false,
		});
		expect(listing(log)).toHaveLength(1);
	});
});
