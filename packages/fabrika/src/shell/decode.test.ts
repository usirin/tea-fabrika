import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {shapeOf} from "../program/shape.ts";
import {readValue} from "./decode.ts";

// A word on a line read as a value of a program's own shape. These cases were
// in the pipeline's tsh/check.test.ts until experiment 114; they name no
// program of the pipeline's, so they came here with the shell.

describe("values", () => {
	const of = shapeOf;

	it("are read as text first, then as JSON, and the shape decides", () => {
		expect(readValue(of(Schema.String), "2")).toEqual({kind: "value", value: "2"});
		expect(readValue(of(Schema.Int), "2")).toEqual({kind: "value", value: 2});
		expect(readValue(of(Schema.Struct({id: Schema.String})), '{"id":"a"}')).toEqual({
			kind: "value",
			value: {id: "a"},
		});
		expect(readValue(of(Schema.Boolean), "true")).toEqual({kind: "value", value: true});
	});

	it("that fit neither way are refused in the schema's words, with a guess among its choices", () => {
		const r = readValue(of(Schema.Literals(["low", "medium", "high"])), "meduim");
		expect(r).toMatchObject({kind: "refused", didYouMean: "medium"});
		expect(readValue(of(Schema.Int), "x").kind).toBe("refused");
	});
});
