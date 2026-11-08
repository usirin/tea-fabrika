import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {decodeKeys} from "../desk/keymap.ts";
import {menuKey, stopsOf, type Section} from "./pop.ts";

const sections: readonly Section[] = [
	{
		id: "items",
		title: null,
		fold: false,
		rows: [
			{id: "a", icon: "ask", title: "Alpha", sub: "", side: null, second: null},
			{id: "b", icon: "ask", title: "Beta", sub: "", side: null, second: null},
		],
	},
];

describe("today's declared menu shortcuts", () => {
	it("P3: rebinding custom menu movement removes old j while keeping native arrows", () => {
		const stops = stopsOf(sections, new Set());
		const read = decodeKeys('menu.next = "x"', true);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		const keys = read.success;
		expect(menuKey(stops, "a", {key: "j"}, {keys})).toBeNull();
		expect(menuKey(stops, "a", {key: "x"}, {keys})).toEqual({do: "move", to: "b"});
		expect(menuKey(stops, "a", {key: "ArrowDown"}, {keys})).toEqual({do: "move", to: "b"});
	});
});
