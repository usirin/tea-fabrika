import { Schema } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { Settings } from "./settings.ts";

it("local settings accept exactly the integer ports from 1 through 65535", () => {
  const settings = {
    name: "local",
    person: "person",
    founder: "public",
    window: null,
    build: "a",
    rateLimit: { limit: 100_000, window: 60_000 },
    limits: {
      recordBytes: 1_000_000_000,
      writes: 13_760,
      storage: "1000000000 B",
      recovery: {
        project: { writes: 160, bytes: "74080 B", letter: { writes: 10, bytes: "5469 B" } },
        process: { writes: 290, bytes: "207410 B", letter: { writes: 50, bytes: "18790 B" } },
      },
    },
  };
  const firstPort: [number] = [1];
  const lastPort: [number] = [65535];
  const belowRange: [number] = [0];
  const aboveRange: [number] = [65536];
  fc.assert(
    fc.property(fc.oneof(fc.integer({ min: 1, max: 65535 }), fc.integer(), fc.double()), (port) => {
      const valid = Number.isInteger(port) && port >= 1 && port <= 65535;
      expect(Schema.is(Settings)({ ...settings, port })).toBe(valid);

      if (valid) {
        expect(Schema.decodeUnknownSync(Settings)({ ...settings, port }).port).toBe(port);
      }
    }),
    { seed: 119120, examples: [firstPort, lastPort, belowRange, aboveRange] },
  );
});
