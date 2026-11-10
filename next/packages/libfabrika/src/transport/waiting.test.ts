// p43's pure half. Waiting.make({rows,most,ttl}); knock/leave/expire return a new Waiting.
// Access prunes; duplicate client ids do not count twice. Persistence is owned by door.test.ts.
// Plants: code per tab; increment on every knock; no expiry/cap; newest-first eviction.
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import * as T from "./index.ts";

const state = (ttl = 600_000, most = 3) => T.Waiting.make({ rows: [], most, ttl });
const runs = { seed: 119120, numRuns: 100 };

const knock = (s: ReturnType<typeof state>, key: string, client: string, at: number, code: string = "1234") =>
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
    // Plant: append duplicate clients without a Set. The two-tab match must fail.
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string(),
          clients: fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 2 }),
          codes: fc.tuple(fc.string(), fc.string(), fc.string()),
          at: fc.nat({ max: 1_000_000_000 }),
          ttl: fc.integer({ min: 3, max: 1_000_000 }),
        }),
        ({ key, clients: [one = "", two = ""], codes: [code, secondCode, thirdCode], at, ttl }) => {
          const first = knock(state(ttl), key, one, at, code);
          const second = knock(first, key, two, at + 1, secondCode);
          const duplicate = knock(second, key, two, at + 2, thirdCode);
          expect(first.rows[0]?.tabs).toBe(1);
          expect(duplicate.rows).toHaveLength(1);
          expect(duplicate.rows[0]).toMatchObject({
            key,
            tabs: 2,
            code,
            until: at + ttl,
            has: ["verify", "seal"],
            pass: null,
          });
          const left = T.Waiting.leave(duplicate, { key, client: one });
          expect(left.rows[0]?.tabs).toBe(1);
          expect(T.Waiting.leave(left, { key, client: two }).rows).toEqual([]);
        },
      ),
      {
        ...runs,
        examples: [
          [
            {
              key: "k",
              clients: ["tab1", "tab2"],
              codes: ["1234", "9999", "8888"],
              at: 0,
              ttl: 600_000,
            },
          ],
        ],
      },
    );
  });
  it("p43: expiry boundary and access pruning do not renew an old code", () => {
    // Plant: keep rows whose until equals at. The empty rows assertion must fail.
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        fc.string(),
        fc.string(),
        fc.nat({ max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (key, one, two, code, replacement, at, ttl) => {
          const first = knock(state(ttl), key, one, at, code);
          expect(T.Waiting.expire(first, at + ttl - 1).rows).toHaveLength(1);
          expect(T.Waiting.expire(first, at + ttl).rows).toEqual([]);
          const next = knock(first, key, two, at + ttl, replacement);
          expect(next.rows[0]).toMatchObject({ code: replacement, tabs: 1, until: at + 2 * ttl });
        },
      ),
      { ...runs, examples: [["a", "tab1", "tab2", "1234", "5678", 0, 600_000]] },
    );
  });
  it("p43: the cap evicts the oldest key, never another tab's newer code", () => {
    // Plant: keep the oldest rows with slice(0, most). The remaining-key equality must fail.
    fc.assert(
      fc.property(fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 20 }), (keys) => {
        let s = state(600_000, keys.length - 1);

        for (const [at, key] of keys.entries()) {
          s = knock(s, key, `${key}1`, at);
        }

        expect(s.rows.map((r) => r.key)).toEqual(keys.slice(1));
      }),
      { ...runs, examples: [[["a", "b", "c", "d"]]] },
    );
  });
  it("p43: arbitrary duplicate knocks have exactly the distinct live tab count", () => {
    // Plant: append duplicate clients without a Set. The distinct-count equality must fail.
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 40 }), (tabs) => {
        let s = state();

        for (const tab of tabs) {
          s = knock(s, "a", `t${tab}`, 0);
        }

        expect(s.rows).toHaveLength(1);
        expect(s.rows[0]?.tabs).toBe(new Set(tabs).size);
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
  // The cap is an Int of at least 1. A cap below 1 is refused by make and by decode. Any cap
  // n >= 1 keeps exactly the newest n rows after knocks from more than n keys. Plants: drop the
  // >= 1 check; drop the cap's slice.
  it("p43: a cap below 1 is refused, and any cap n keeps the newest n rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 8 }), fc.integer({ min: 1, max: 6 }), (most, extra) => {
        const raw = { rows: [], most, ttl: 600_000 };

        if (most < 1) {
          expect(() => T.Waiting.make(raw)).toThrow();
          expect(Schema.decodeUnknownOption(T.Waiting)(raw)).toEqual(Option.none());
          return;
        }

        const keys = Array.from({ length: most + extra }, (_, i) => `k${i}`);
        const s = keys.reduce((w, k, i) => knock(w, k, `${k}-tab`, i), T.Waiting.make(raw));
        expect(s.rows.map((r) => r.key)).toEqual(keys.slice(-most));
      }),
      // pinned: a cap of 0. Before PR 516 the cap was any Int, and slice(-0) kept every row, so
      // 0 capped nothing.
      { seed: 119120, endOnFailure: true, numRuns: 100, examples: [[0, 3]] },
    );
  });
});
