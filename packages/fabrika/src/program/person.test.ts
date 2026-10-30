import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {output} from "./shape.ts";

// A table view a terminal cannot draw is refused when its output is declared, not when it prints.

const Row = Schema.Struct({n: Schema.Int, title: Schema.String});
const n = {header: "#", cell: (r: typeof Row.Type) => String(r.n)} as const;
const title = {header: "Title", cell: (r: typeof Row.Type) => r.title} as const;

describe("an output's table view", () => {
	it("is kept as declared when a terminal can draw it", () => {
		const row = output(Row, "A row.", {
			person: {table: {title: "Rows", columns: [n, title], cut: "Title"}},
		});
		expect(row.person).toMatchObject({table: {title: "Rows", cut: "Title"}});
	});

	it("cuts one of its own columns, or it does not type", () => {
		const declare = () =>
			// @ts-expect-error: "Name" is no header of the table.
			output(Row, "A row.", {person: {table: {title: "Rows", columns: [n], cut: "Name"}}});
		expect(declare).toThrow("a table cuts one of its columns, not Name");
	});

	it.each([
		["no title", {title: " ", columns: [n, title], cut: "Title"}, "a table needs a title"],
		[
			"a header that is empty",
			{title: "Rows", columns: [n, {...title, header: ""}], cut: "#"},
			"needs a header",
		],
		["a header twice", {title: "Rows", columns: [title, title], cut: "Title"}, "each its own"],
	] as const)("is refused with %s", (_, table, why) => {
		expect(() => output(Row, "A row.", {person: {table}})).toThrow(why);
	});
});
