import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { childrenOf } from "./ticket.ts";
import { counted, OverCap } from "./work.test-support.ts";

// The counter the "linear, not squared" laws stand on (ticket 649). Today's version. A dead counter
// would pass them with 0 < 2 x 0, and a wrapper left in place would miscount and slow every later
// test in the file, so both are laws here, as PR 803's `scripts/effect-arbitrary.test.ts` has them
// for its own counter.

const RUN = "r-long";
const STEP = "1".repeat(16);

/** A record of one step span and `n` spans straight under it. */
const stepOf = (n: number): JobTrace => {
  const at = (id: string, parent: string | null, name: string, tags: Span["tags"]): Span => ({
    span: id,
    parent,
    name,
    service: "pipeline",
    start: 0,
    end: 1,
    status: "ok",
    tags,
    events: [],
    by: "agent:lane",
  });
  const spans: Span[] = [at(STEP, null, "run a step", { [LANE.run]: RUN })];

  for (let i = 0; i < n; i++) {
    spans.push(at((16 + i).toString(16).padStart(16, "0"), STEP, "turn", {}));
  }

  return { trace: "d4".repeat(16), job: null, runs: [], spans, steps: [], opened: [] };
};

const runs = { seed: 119120, numRuns: 6 };

// Plant L2: wrap `String.raw` in place of the iterators' `next`, leaving the counter blind to them.
describe("the counter is live (L2)", () => {
  it("counting childrenOf on n children gives at least one unit per span in the record and per span under the step", () => {
    fc.assert(
      fc.property(fc.integer({ min: 250, max: 2_000 }), (n) => {
        const record = stepOf(n);
        const { value, work } = counted(() => childrenOf(record, RUN, 0, 1), Infinity);
        expect(value.length).toBe(n);
        // The index's pass over the record, then the walk over the step's children.
        expect(work, `${work} units for ${record.spans.length} spans, ${n} under the step`).toBeGreaterThanOrEqual(
          record.spans.length + n,
        );
      }),
      runs,
    );
  });
});

const TARGETS: readonly (readonly [string, object])[] = [
  ["Array", Array],
  ["Array.prototype", Array.prototype],
  ["%ArrayIteratorPrototype%", Object.getPrototypeOf([][Symbol.iterator]())],
  ["%MapIteratorPrototype%", Object.getPrototypeOf(new Map()[Symbol.iterator]())],
  ["%SetIteratorPrototype%", Object.getPrototypeOf(new Set()[Symbol.iterator]())],
];

/** Every own property of the built-ins `counted` may wrap, by name, as it stands now. */
const methods = (): ReadonlyMap<string, unknown> =>
  new Map(
    TARGETS.flatMap(([name, target]) =>
      Reflect.ownKeys(target).map((key) => [`${name}.${String(key)}`, Reflect.get(target, key)] as const),
    ),
  );

/** The names whose value is not the same as before. */
const changed = (before: ReadonlyMap<string, unknown>): readonly string[] =>
  [...methods()].filter(([name, value]) => before.get(name) !== value).map(([name]) => name);

// Plant L3: drop the restore of `Array.prototype.concat`.
// scenario: the three ways `f` can leave `counted`; each must put every wrapped method back.
describe("every wrapped method is put back (L3)", () => {
  it("scenario: when f returns", () => {
    const before = methods();
    expect(counted(() => [1, 2, 3].concat([4]).length, Infinity).value).toBe(4);
    expect(changed(before)).toEqual([]);
  });

  it("scenario: when f throws", () => {
    const before = methods();
    expect(() =>
      counted(() => {
        throw new Error("planted failure");
      }, Infinity),
    ).toThrow("planted failure");
    expect(changed(before)).toEqual([]);
  });

  it("scenario: when f passes the cap", () => {
    const before = methods();
    let caught: unknown = null;

    try {
      counted(() => [...Array.from({ length: 100 }, (_, i) => i)].concat([0]), 10);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(OverCap);
    expect(caught).toMatchObject({ cap: 10 });
    expect(changed(before)).toEqual([]);
  });
});
