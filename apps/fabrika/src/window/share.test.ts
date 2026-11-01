import {describe, expect, it} from "vitest";
import {share} from "./share.ts";

const desk = () => ({
	tiles: [
		{id: "t1", shows: {kind: "tsh", run: null}, folded: false},
		{id: "t2", shows: {kind: "tsh", run: {id: "r", program: "map"}}, folded: false},
	],
	focused: "t1",
});

describe("share", () => {
	it("answers the old value when nothing changed", () => {
		const old = desk();
		expect(share(old, desk())).toBe(old);
	});

	it("keeps each object that did not change, and only those", () => {
		const old = desk();
		const next = desk();
		next.focused = "t2";
		next.tiles[1] = {...next.tiles[1], folded: true} as (typeof next.tiles)[1];
		const got = share(old, next);
		expect(got).toEqual(next);
		expect(got).not.toBe(old);
		expect(got.tiles[0]).toBe(old.tiles[0]);
		expect(got.tiles[1]).not.toBe(old.tiles[1]);
		expect(got.tiles[1]?.shows).toBe(old.tiles[1]?.shows);
	});

	it("sees a key gone, a key added, and a key set to undefined", () => {
		const old: Record<string, unknown> = {a: 1, b: 2};
		expect(share(old, {a: 1})).toEqual({a: 1});
		expect(share(old, {a: 1, b: 2, c: 3})).toEqual({a: 1, b: 2, c: 3});
		expect(share({a: undefined}, {b: undefined})).toEqual({b: undefined});
	});

	it("sees a list that shrank or grew", () => {
		expect(share([1, 2], [1])).toEqual([1]);
		expect(share([1], [1, 2])).toEqual([1, 2]);
	});

	it("takes the new value across a change of kind", () => {
		expect(share([1], {0: 1})).toEqual({0: 1});
		expect(share(null, {a: 1})).toEqual({a: 1});
		expect(share({a: 1}, null)).toBe(null);
		const when = new Date(0);
		expect(share(new Date(0), when)).toBe(when);
	});
});
