import { Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Beat from "./Beat.ts";

// Today's lead tooling: the beat is pure, so these laws step it by hand on fixed clocks.
const options = { seed: 119120, numRuns: 300 };
const T0 = Date.parse("2026-11-10T19:00:00.000Z");
const phase = fc.constantFrom(...Beat.PHASES);
const ms = (max: number) => fc.integer({ min: 0, max });
const at = (offset: number) => new Date(T0 + offset);

describe("Beat.enter and Beat.tick", () => {
  it("keeps `since` within one phase and restarts it on a new phase", () => {
    fc.assert(
      fc.property(phase, phase, ms(3_600_000), ms(3_600_000), (a, b, d1, d2) => {
        const first = Beat.enter(null, a, at(d1));
        const second = Beat.enter(first, b, at(d1 + d2));
        expect(second.at).toBe(at(d1 + d2).toISOString());
        expect(second.since).toBe(a === b ? first.since : second.at);
      }),
      options,
    );
  });

  it("moves `at` and keeps the last agent output when the log is gone", () => {
    fc.assert(
      fc.property(phase, ms(3_600_000), ms(3_600_000), (p, d1, d2) => {
        const heard = Beat.tick(Beat.enter(null, p, at(0)), at(d1), at(d1));
        const later = Beat.tick(heard, at(d1 + d2), null);
        expect(later.at).toBe(at(d1 + d2).toISOString());
        expect(later.agentAt).toBe(at(d1).toISOString());
      }),
      options,
    );
  });

  it("round-trips through its schema", () => {
    fc.assert(
      fc.property(phase, ms(3_600_000), fc.boolean(), (p, d, heard) => {
        const beat = Beat.tick(Beat.enter(null, p, at(0)), at(d), heard ? at(d) : null);
        const encoded = Schema.encodeSync(Beat.Beat)(beat);
        expect(Schema.decodeUnknownSync(Beat.Beat)(encoded)).toEqual(beat);
      }),
      options,
    );
  });
});

describe("Beat.says", () => {
  it("calls any lane stuck once its beat is quiet past the limit, whatever the phase", () => {
    fc.assert(
      fc.property(phase, ms(Beat.QUIET), fc.integer({ min: 1, max: 86_400_000 }), (p, d, over) => {
        const beat = Beat.enter(null, p, at(0));
        const said = Beat.says(beat, at(Beat.QUIET + over + d), Beat.QUIET);
        expect(said.stuck).toBe(true);
        expect(said.text).toContain("no beat for");
      }),
      options,
    );
  });

  it("calls an agent turn stuck when the agent wrote nothing past the limit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400_000 }), (over) => {
        const now = at(Beat.QUIET + over);
        const beat = Beat.tick(Beat.enter(null, "agent", at(0)), now, null);
        const said = Beat.says(beat, now, Beat.QUIET);
        expect(said).toEqual({ stuck: true, text: expect.stringContaining("no agent output for") });
      }),
      options,
    );
  });

  it("never calls a fresh beat stuck outside an agent turn", () => {
    fc.assert(
      fc.property(
        phase.filter((p) => p !== "agent"),
        fc.integer({ min: 0, max: 86_400_000 }),
        (p, d) => {
          const now = at(d);
          const beat = Beat.tick(Beat.enter(null, p, at(0)), now, null);
          expect(Beat.says(beat, now, Beat.QUIET).stuck).toBe(false);
        },
      ),
      options,
    );
  });

  it("scenario: the 2026-11-10 hung cleanup reads as stuck, in words", () => {
    // Two lanes read "chain step running for 01:50" while each hung in cleanup with no agent.
    const beat = Beat.enter(null, "cleanup", at(0));
    expect(Beat.says(beat, at(110 * 60_000))).toEqual({
      stuck: true,
      text: "cleanup for 1h50m, no beat for 1h50m: stuck",
    });
  });

  it("scenario: an agent at work says how long since it last wrote", () => {
    const now = at(12 * 60_000);
    const beat = Beat.tick(Beat.enter(null, "agent", at(0)), now, at(11 * 60_000 + 30_000));
    const text = "agent for 12m, last agent output 30s ago";
    expect(Beat.says(beat, now)).toEqual({ stuck: false, text });
  });
});

describe("Beat.spoken", () => {
  it("format: hours and minutes, minutes, or seconds", () => {
    const spans = [30_000, 12 * 60_000, 110 * 60_000].map(Beat.spoken);
    expect(spans).toEqual(["30s", "12m", "1h50m"]);
  });
});
