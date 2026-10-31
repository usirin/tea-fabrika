import fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {Split} from "./desk.ts";
import {fold, STRIP} from "./fold.ts";

const tile = (id: string) => ({id, shows: `counter:${id}`, keep: "failed" as const});

const row: Split = {
	dir: "row",
	parts: [
		{percent: 50, inner: tile("t1")},
		{percent: 50, inner: tile("t2")},
	],
};

const openIds = (layout: Split, w: number, h: number, focus: string) =>
	fold(layout, {w, h}, focus)
		.filter((p) => !p.folded)
		.map((p) => p.id);

describe("fold", () => {
	it("keeps the percents when everything fits", () => {
		expect(fold(row, {w: 1280, h: 800}, "t1")).toEqual([
			{id: "t1", shows: "counter:t1", x: 0, y: 0, w: 640, h: 800, folded: false},
			{id: "t2", shows: "counter:t2", x: 640, y: 0, w: 640, h: 800, folded: false},
		]);
	});

	it("folds the tile without focus when the window is narrow", () => {
		expect(fold(row, {w: 420, h: 800}, "t1")).toEqual([
			{id: "t1", shows: "counter:t1", x: 0, y: 0, w: 420 - STRIP, h: 800, folded: false},
			{id: "t2", shows: "counter:t2", x: 420 - STRIP, y: 0, w: STRIP, h: 800, folded: true},
		]);
		expect(openIds(row, 420, 800, "t2")).toEqual(["t2"]);
	});

	it("never folds the tile focus is on, however small the window", () => {
		expect(openIds(row, 100, 800, "t2")).toEqual(["t2"]);
	});

	it("follows the percents, not half and half", () => {
		const wide: Split = {
			dir: "row",
			parts: [
				{percent: 80, inner: tile("a")},
				{percent: 20, inner: tile("b")},
			],
		};
		// b's 20% of 800 is under its least, though 800 would fit two tiles split evenly.
		expect(openIds(wide, 800, 600, "a")).toEqual(["a"]);
	});

	it("folds a column by its height", () => {
		const column: Split = {
			dir: "column",
			parts: [
				{percent: 50, inner: tile("a")},
				{percent: 50, inner: tile("b")},
			],
		};
		expect(openIds(column, 800, 800, "a")).toEqual(["a", "b"]);
		const narrow = fold(column, {w: 800, h: 200}, "a");
		expect(narrow.map((p) => p.folded)).toEqual([false, true]);
		expect(narrow[1]?.h).toBe(STRIP);
	});

	it("folds a nested split whole, and keeps the part holding the focus", () => {
		const nested: Split = {
			dir: "row",
			parts: [
				{percent: 50, inner: tile("a")},
				{
					percent: 50,
					inner: {
						dir: "column",
						parts: [
							{percent: 50, inner: tile("b")},
							{percent: 50, inner: tile("c")},
						],
					},
				},
			],
		};
		expect(openIds(nested, 420, 800, "a")).toEqual(["a"]);
		expect(openIds(nested, 420, 800, "c").sort()).toEqual(["b", "c"]);
	});

	it("covers the window, with no tile lost, at any size", () => {
		fc.assert(
			fc.property(
				fc.integer({min: 50, max: 3000}),
				fc.integer({min: 50, max: 2000}),
				fc.constantFrom("t1", "t2"),
				(w, h, focus) => {
					const placed = fold(row, {w, h}, focus);
					expect(placed.map((p) => p.id)).toEqual(["t1", "t2"]);
					expect(placed.reduce((sum, p) => sum + p.w, 0)).toBeCloseTo(w);
					expect(placed.find((p) => p.id === focus)?.folded).toBe(false);
				},
			),
		);
	});

	it("does not change the layout it was given", () => {
		const before = JSON.stringify(row);
		fold(row, {w: 300, h: 300}, "t1");
		expect(JSON.stringify(row)).toBe(before);
	});
});
