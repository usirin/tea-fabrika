import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { beat, LATE, line } from "./heartbeat.ts";

// Today's lead tooling.
const options = { seed: 119120, numRuns: 300 };

const now = fc.integer({ min: 1.7e12, max: 1.9e12 });
const age = fc.integer({ min: -LATE, max: 3 * LATE });

describe("the mutation heartbeat, today's tooling", () => {
  it("is late exactly when some merge since the last passing run is more than two hours old", () => {
    fc.assert(
      fc.property(now, fc.option(age), fc.array(age, { maxLength: 8 }), (t, pass, ages) => {
        const merges = ages.map((a) => t - a);
        const b = beat(t, pass === null ? null : t - pass, merges);
        expect(b._tag).toBe(ages.some((a) => a > LATE) ? "late" : "ok");
        expect(b.merges).toBe(merges.length);

        if (b._tag === "late") {
          expect(b.oldest).toBe(Math.min(...merges));
        }
      }),
      options,
    );
  });

  it("no merge is never late, however old the last passing run is, or with none", () => {
    fc.assert(
      fc.property(now, fc.option(fc.integer({ min: 0, max: 1e10 })), (t, pass) => {
        expect(beat(t, pass === null ? null : t - pass, [])._tag).toBe("ok");
      }),
      options,
    );
  });

  // vector: the edge, a merge exactly two hours old is not late, one ms more is.
  it("vector: two hours is on time and two hours and one ms is late", () => {
    const t = 1_794_386_862_934;
    expect(beat(t, null, [t - LATE])._tag).toBe("ok");
    expect(beat(t, null, [t - LATE - 1])._tag).toBe("late");
  });

  // format: the line a red heartbeat run shows, from 2026-11-11's real gap (last pass 05:40:24Z).
  it("format: the late and ok lines", () => {
    const pass = Date.parse("2026-11-11T05:40:24Z");
    const t = Date.parse("2026-11-11T08:51:00Z");
    const oldest = Date.parse("2026-11-11T05:45:38Z");
    expect(line(t, beat(t, pass, [oldest, t - 60_000]))).toBe(
      "mutation heartbeat: late: 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago",
    );
    expect(line(t, beat(t, null, []))).toBe("mutation heartbeat: ok: 0 merges since the last passing run (none)");
  });
});
