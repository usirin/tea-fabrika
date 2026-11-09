// p43's pure half. Waiting.make({rows,most,ttl}); knock/leave/expire return a new Waiting.
// Access prunes; duplicate client ids do not count twice. Persistence is owned by door.test.ts.
// Plants: code per tab; increment on every knock; no expiry/cap; newest-first eviction.
import {describe, expect, it} from "@effect/vitest";
import {Option, Schema} from "effect";
import * as fc from "fast-check";
import * as T from "./index.ts";

const state = () => T.Waiting.make({rows: [], most: 3, ttl: 600_000});
const knock = (
	s: ReturnType<typeof state>,
	key: string,
	client: string,
	at: number,
	code: string = "1234",
) =>
	T.Waiting.knock(s, {
		key,
		client,
		label: "Browser",
		where: "test",
		has: ["verify", "seal"],
		as: "window",
		code,
		pass: null,
		at,
	});
describe("P10 waiting rows", () => {
	it("p43: one checked key, two tabs, one stable code until expiry", () => {
		const first = knock(state(), "k", "tab1", 0);
		const second = knock(first, "k", "tab2", 1, "9999");
		const duplicate = knock(second, "k", "tab2", 2, "8888");
		expect(first.rows[0]?.tabs).toBe(1);
		expect(duplicate.rows).toHaveLength(1);
		expect(duplicate.rows[0]).toMatchObject({
			key: "k",
			tabs: 2,
			code: "1234",
			until: 600_000,
			has: ["verify", "seal"],
			pass: null,
		});
		const left = T.Waiting.leave(duplicate, {key: "k", client: "tab1"});
		expect(left.rows[0]?.tabs).toBe(1);
		expect(T.Waiting.leave(left, {key: "k", client: "tab2"}).rows).toEqual([]);
	});
	it("p43: expiry boundary and access pruning do not renew an old code", () => {
		const first = knock(state(), "a", "tab1", 0);
		expect(T.Waiting.expire(first, 599_999).rows).toHaveLength(1);
		expect(T.Waiting.expire(first, 600_000).rows).toEqual([]);
		const next = knock(first, "a", "tab2", 600_000, "5678");
		expect(next.rows[0]).toMatchObject({code: "5678", tabs: 1, until: 1_200_000});
	});
	it("p43: the cap evicts the oldest key, never another tab's newer code", () => {
		let s = knock(state(), "a", "a1", 0);
		s = knock(s, "b", "b1", 1);
		s = knock(s, "c", "c1", 2);
		s = knock(s, "d", "d1", 3);
		expect(s.rows.map((r) => r.key)).toEqual(["b", "c", "d"]);
	});
	it("p43: arbitrary duplicate knocks have exactly the distinct live tab count", () => {
		fc.assert(
			fc.property(fc.array(fc.integer({min: 0, max: 5}), {minLength: 1, maxLength: 40}), (tabs) => {
				let s = state();
				for (const tab of tabs) s = knock(s, "a", `t${tab}`, 0);
				expect(s.rows).toHaveLength(1);
				expect(s.rows[0]?.tabs).toBe(new Set(tabs).size);
			}),
			{seed: 119120, numRuns: 100},
		);
	});
	// The cap is an Int of at least 1. A cap below 1 is refused by make and by decode. Any cap
	// n >= 1 keeps exactly the newest n rows after knocks from more than n keys. Plants: drop the
	// >= 1 check; drop the cap's slice.
	it("p43: a cap below 1 is refused, and any cap n keeps the newest n rows", () => {
		fc.assert(
			fc.property(fc.integer({min: -5, max: 8}), fc.integer({min: 1, max: 6}), (most, extra) => {
				const raw = {rows: [], most, ttl: 600_000};
				if (most < 1) {
					expect(() => T.Waiting.make(raw)).toThrow();
					expect(Schema.decodeUnknownOption(T.Waiting)(raw)).toEqual(Option.none());
					return;
				}
				const keys = Array.from({length: most + extra}, (_, i) => `k${i}`);
				const s = keys.reduce((w, k, i) => knock(w, k, `${k}-tab`, i), T.Waiting.make(raw));
				expect(s.rows.map((r) => r.key)).toEqual(keys.slice(-most));
			}),
			// pinned: a cap of 0. Before PR 516 the cap was any Int, and slice(-0) kept every row, so
			// 0 capped nothing.
			{seed: 119120, endOnFailure: true, numRuns: 100, examples: [[0, 3]]},
		);
	});
});
