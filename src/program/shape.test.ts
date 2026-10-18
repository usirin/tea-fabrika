import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {fit, input, output, type StandardShape} from "./shape.ts";

// Fit is exact and reads only the shape. A shape only checks, and says why not.

/** A pull request at one head. The patterns make a shape that types alone cannot tell apart. */
const PR = Schema.Struct({
	pr: Schema.String.check(Schema.isPattern(/^#\d+$/)),
	head: Schema.String.check(Schema.isPattern(/^[0-9a-f]{7}$/)),
});
/** What a ship says about one pull request, cut down. */
const Outcome = Schema.Struct({
	pr: Schema.String,
	kind: Schema.Literals(["done", "send", "stuck"]),
	why: Schema.Literals(["landed", "conflicts", "ejected", "enqueue_failed"]),
});

// One program's output, and the inputs of others it could be wired to.
const handoff = output(PR, "The next pull request to ship.");
const hand = input(PR, "A pull request to put in the merge queue.");
const announced = output(Outcome, "Every outcome, for anyone who listens.");
const heard = input(Outcome, "An outcome to write down.");

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
	it("an output fits the input of the same shape", () => {
		expect(fit(handoff, hand)).toBe("fits");
		expect(fit(announced, heard)).toBe("fits");
		expect(fit(announced, hand)).toBe("does_not_fit");
	});

	it("more fields does not fit, and fewer does not either", () => {
		const more = output(
			Schema.Struct({...PR.fields, base: Schema.String}),
			"A pull request and its base.",
		);
		expect(fit(more, hand)).toBe("does_not_fit");
		const fewer = output(Schema.Struct({pr: PR.fields.pr}), "Only the number.");
		expect(fit(fewer, hand)).toBe("does_not_fit");
	});

	it("a looser field does not fit: any string where the input names its words", () => {
		const loose = output(
			Schema.Struct({pr: Schema.String, kind: Schema.String, why: Schema.String}),
			"An outcome, loosely.",
		);
		expect(fit(loose, heard)).toBe("does_not_fit");
	});

	it("a check the JSON Schema leaves out is a check fit cannot see (effect 4.0.0 drops `isPattern`)", () => {
		const unpatterned = output(
			Schema.Struct({pr: Schema.String, head: Schema.String}),
			"Any two strings.",
		);
		expect(fit(unpatterned, hand)).toBe("fits");
		expect(hand.shape.check({pr: "seven", head: "x"})).toBe(false);
	});

	it("descriptions never change fit, on the declaration or inside the schema", () => {
		const said = output(PR.annotate({description: "Said another way", title: "PR"}), "Worded.");
		expect(fit(said, hand)).toBe("fits");
	});

	it("an input that is a union takes each of its members, and only them (experiment 75c)", () => {
		const either = input(Schema.Union([PR.fields.pr, PR]), "A bare number, or one at a head.");
		expect(fit(handoff, either)).toBe("fits");
		expect(fit(output(PR.fields.pr, "A bare number."), either)).toBe("fits");
		expect(fit(announced, either)).toBe("does_not_fit");
		// The other way round is not a fit: an output that may send either does not fit an input that takes one.
		expect(fit(output(Schema.Union([PR.fields.pr, PR]), "Either."), hand)).toBe("does_not_fit");
	});

	it("a shape with no JSON Schema answers cannot_tell", () => {
		const loose = output(anyString, "A string, checked by hand.");
		expect(fit(loose, input(anyString, "A string."))).toBe("cannot_tell");
		expect(fit(loose, heard)).toBe("cannot_tell");
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
		expect(() => output(PR, "")).toThrow(/description/);
	});
});

describe("why a value does not fit", () => {
	it("says it in the schema's words, with where it is", () => {
		expect(hand.shape.problem({pr: "#7", head: "abc1234"})).toBeUndefined();
		expect(hand.shape.problem({pr: 7, head: "abc1234"})).toMatch(/string[\s\S]*\["pr"\]/);
		expect(hand.shape.problem({pr: "#7", head: "abc1234", base: "main"})).toMatch(/base/);
	});

	it("a Standard Schema's own messages, and a plain reason when it throws", () => {
		expect(input(anyString, "x").shape.problem(7)).toBe("not a string");
		const throws: StandardShape<string> = {
			"~standard": {
				version: 1,
				vendor: "by-hand",
				validate: () => {
					throw new Error("boom");
				},
			},
		};
		expect(input(throws, "x").shape.problem("a")).toBe("the check threw");
	});
});
