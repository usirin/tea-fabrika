import { Effect } from "effect";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import * as Layer from "./layer.ts";

import { lane, YES, TIMED_OUT, stoppedLine } from "./lane-harness.ts";

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  loadavg: () => [7.3, 0, 0],
}));

it("L6: stopped line preserves the limit, quiet time, load and CPUs", () => {
  // Today's lane. Plant: put within in quiet's place.
  fc.assert(
    fc.property(
      fc.record({
        within: fc.integer({ min: 1, max: 50 }),
        quiet: fc.double({ min: 0, max: 50, noNaN: true }),
        load: fc.double({ min: 0, max: 10000, noNaN: true }),
        cpus: fc.integer({ min: 1, max: 1024 }),
      }),
      (stopped) => {
        const match = /^stopped after (\d+) s; last line (\d+\.\d) s before; load (\d+\.\d) on (\d+) CPUs$/.exec(
          stoppedLine(stopped),
        );
        expect(match).not.toBeNull();
        expect(match!.slice(1).map(Number)).toEqual([
          stopped.within,
          Number(stopped.quiet.toFixed(1)),
          Number(stopped.load.toFixed(1)),
          stopped.cpus,
        ]);
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("scenario: L7 a real lane's timeout ends with the stopped line then TIMED_OUT", async () => {
  // Real git and the real lane, stopped at one second; L6 covers the values.
  // Plant: append only TIMED_OUT, as the old harness does.
  const ran = await lane({ picks: YES, within: 1 });
  expect(ran.lines.at(-1)).toBe(TIMED_OUT);
  expect(ran.lines.at(-2)).toMatch(/^stopped after 1 s; last line \d+\.\d s before; load \d+\.\d on \d+ CPUs$/);
});

it("scenario: scripted lane lines determine the stopped quiet time and load", async () => {
  // Script the public runner so line delivery cannot race the real one-second timeout.
  // Only the diagnostic clock is controlled; Effect's timeout keeps its live scheduler.
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const runner = vi.spyOn(Layer, "runLane").mockImplementation((_n, say) =>
    Effect.gen(function* () {
      clock.mockReturnValue(4000);
      yield* say("scripted lane line");
      clock.mockReturnValue(9000);
      return yield* Effect.never;
    }),
  );

  try {
    const ran = await lane({ picks: YES, within: 1 });
    expect(ran.lines).toContain("scripted lane line");
    expect(ran.lines.at(-2)).toMatch(/^stopped after 1 s; last line 5\.0 s before; load 7\.3 on \d+ CPUs$/);
    expect(ran.lines.at(-1)).toBe(TIMED_OUT);
  } finally {
    runner.mockRestore();
    clock.mockRestore();
  }
});
