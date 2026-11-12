import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as RunId from "./runid.ts";

// Today's tooling. Pure: names in, an id out.
const options = { seed: 119120, numRuns: 300 };

const lane = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,10}$/);
const step = fc.constantFrom("plan", "tests", "build", "mutation", "review", "host", "judge");
const n = fc.integer({ min: 1, max: 40 });
const parts = fc.record({ lane, step, n });

/** A file an older run left: its own lane and step, or another's, with any of a run's suffixes. */
const left = (run: fc.Arbitrary<RunId.Parts>) =>
  fc.tuple(run, fc.constantFrom(...RunId.FILES)).map(([p, suffix]) => `${RunId.make(p)}${suffix}`);

describe("a lane's run id is lane + step + n, today's tooling", () => {
  it("vector: the settled sweep item's example", () => {
    expect(RunId.make({ lane: "p39s1", step: "tests", n: 2 })).toBe("p39s1-tests2");
    expect(RunId.parse("p39s1-tests2")).toEqual({ lane: "p39s1", step: "tests", n: 2 });
  });

  // Plants: let the lane stop at its first dash; let n take a leading 0.
  it("property: an id reads back as the parts it was made from", () => {
    fc.assert(
      fc.property(parts, (p) => {
        expect(RunId.parse(RunId.make(p))).toEqual(p);
      }),
      options,
    );
  });

  // Plants: drop the suffix list's longest-first order; read `-plan.md` as a run's `.md`.
  it("property: every file a run leaves names that run", () => {
    fc.assert(
      fc.property(parts, fc.constantFrom(...RunId.FILES), (p, suffix) => {
        expect(RunId.owner(`${RunId.make(p)}${suffix}`)).toEqual(p);
      }),
      options,
    );
  });

  it("format: a lane's own files and the chain's briefs are no run's files", () => {
    for (const name of [
      "p39s1-rows.jsonl",
      "p39s1-PLAN.md",
      "p39s1-chain3-build-brief.md",
      "p39s1-tests0.md",
      "state",
    ]) {
      expect(RunId.owner(name)).toBeNull();
    }
  });

  // Plants: n from the count of names (the state file's entries); the lowest free n, filling a
  // gap; count another lane's or another step's files. p39s1, 2026-11-11: two launches counted
  // the state file and both took p39s1-tests2.
  it("property: the next id is one past the highest n its lane and step hold, over any names", () => {
    const names = fc.array(fc.oneof(left(parts), left(fc.record({ lane: fc.constant("p39s1"), step, n }))), {
      maxLength: 30,
    });
    fc.assert(
      fc.property(step, names, (s, taken) => {
        const id = RunId.next("p39s1", s, taken);
        const held = taken.flatMap((name) => {
          const p = RunId.owner(name);
          return p !== null && p.lane === "p39s1" && p.step === s ? [p.n] : [];
        });
        expect(id).toBe(RunId.make({ lane: "p39s1", step: s, n: Math.max(0, ...held) + 1 }));
      }),
      options,
    );
  });

  it("property: the next id never names a file that exists, and a restart over its files never reuses it", () => {
    fc.assert(
      fc.property(lane, step, fc.array(left(parts), { maxLength: 30 }), (l, s, taken) => {
        const id = RunId.next(l, s, taken);

        for (const suffix of RunId.FILES) {
          expect(taken).not.toContain(`${id}${suffix}`);
        }

        // The run made its prompt and died; the restart takes a new id.
        expect(RunId.next(l, s, [...taken, `${id}-prompt.md`])).not.toBe(id);
      }),
      options,
    );
  });
});
