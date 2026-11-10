import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fabrika, fabrikaLight } from "../themes.ts";
import { over, ratio } from "./contrast.ts";

// The contrast checker the token floors are judged by (design foundations, PR 2, property 15). It
// is exam: the floors are only as good as the checker. What it must give:
//
//   ratio("#ffffff", "#000000")    // 21: WCAG 2.2's contrast ratio, unrounded
//   ratio("#dfebfd6d", "#111113")  // 3.68: an alpha color is drawn over its backdrop first
//   over("#dfebfd6d", "#111113")   // "#696e77": drawn, rounded to 8 bits a channel, as rules.py does
//
// `fg` may carry alpha; `bg` is solid. Colors are lowercase `#rrggbb` or `#rrggbbaa`.
//
// The reference below is a second implementation, the same math themes.test.ts uses, so the two
// must agree: a bug in one shows as a disagreement.

type Rgba = readonly [number, number, number, number];

const rgbaOf = (value: string): Rgba => {
  const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
  return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

const hexFrom = ([r, g, b]: Rgba) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const referenceOver = (top: string, bottom: string) => {
  const [r, g, b, a] = rgbaOf(top);
  const [R, G, B] = rgbaOf(bottom);
  const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
  return hexFrom([mix(r, R), mix(g, G), mix(b, B), 1]);
};

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const referenceRatio = (fg: string, bg: string) => {
  const ink = rgbaOf(referenceOver(fg, bg));
  const [hi, lo] = [luminance(ink), luminance(rgbaOf(bg))].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const solid = fc.stringMatching(/^[0-9a-f]{6}$/).map((digits) => `#${digits}`);
const translucent = fc.stringMatching(/^[0-9a-f]{8}$/).map((digits) => `#${digits}`);
const anyColor = fc.oneof(solid, translucent);
const RUNS = { seed: 119120, numRuns: 300 };

describe("the contrast checker's fixed points", () => {
  it("gives 21 for white on black, either way round", () => {
    expect(ratio("#ffffff", "#000000")).toBeCloseTo(21, 12);
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 12);
  });

  it("gives 1 for any solid color on itself", () => {
    fc.assert(
      fc.property(solid, (c) => {
        expect(ratio(c, c)).toBeCloseTo(1, 12);
      }),
      RUNS,
    );
  });
});

describe("a color in any other form is refused", () => {
  it.each([
    ["#abc", "#000000"],
    ["#ABCDEF", "#000000"],
    ["#ffffff", "#00000"],
    ["ffffff", "#000000"],
  ])("throws on %s over %s", (fg, bg) => {
    expect(() => ratio(fg, bg)).toThrow(/not a #rrggbb or #rrggbbaa color/);
  });
});

describe("the ratio's shape, for any colors", () => {
  it("is the same both ways round for two solid colors", () => {
    fc.assert(
      fc.property(solid, solid, (a, b) => {
        expect(ratio(a, b)).toBeCloseTo(ratio(b, a), 12);
      }),
      RUNS,
    );
  });

  it("is always between 1 and 21, alpha or not", () => {
    fc.assert(
      fc.property(anyColor, solid, (fg, bg) => {
        const r = ratio(fg, bg);
        expect(r >= 1 && r <= 21).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("the luminance weights are WCAG's, red 0.2126, green 0.7152, blue 0.0722", () => {
  it("reads pure red, green and blue on black as 5.25, 15.30 and 2.44", () => {
    expect(["#ff0000", "#00ff00", "#0000ff"].map((c) => ratio(c, "#000000").toFixed(2))).toEqual([
      "5.25",
      "15.30",
      "2.44",
    ]);
  });
});

describe("an alpha color is drawn over its backdrop, rounded to 8 bits a channel", () => {
  it("draws dark focus, slate a9, over the dark ground as #696e77", () => {
    expect(over("#dfebfd6d", "#111113")).toBe("#696e77");
  });

  it("leaves a solid color as it is, whatever is under it", () => {
    fc.assert(
      fc.property(solid, solid, (top, bottom) => {
        expect(over(top, bottom)).toBe(top);
      }),
      RUNS,
    );
  });

  it("draws any alpha color as the reference does, to the 8-bit channel", () => {
    fc.assert(
      fc.property(translucent, solid, (top, bottom) => {
        expect(over(top, bottom)).toBe(referenceOver(top, bottom));
      }),
      RUNS,
    );
  });

  it("reads an alpha color by what it draws, not by its own channels", () => {
    // Slate a9 dark is a near-white at alpha 0.43: read as solid it would be about 15:1.
    expect(ratio("#dfebfd6d", "#111113").toFixed(2)).toBe("3.68");
  });
});

describe("the repo's printed values", () => {
  const selectedDark = referenceOver("#d9edfe25", "#111113"); // slate a5 over slate 1, dark

  it("gives 4.28 for white on indigo 10, the hovered turn fill in dark (ticket 153)", () => {
    expect(ratio("#ffffff", "#5472e4").toFixed(2)).toBe("4.28");
  });

  it("gives 2.82 for slate a8 on a dark selected row, why focus is a9", () => {
    expect(ratio("#d9edff5d", selectedDark).toFixed(2)).toBe("2.82");
  });

  it("gives 3.32 for focus, slate a9, on a dark selected row: the worst pair the plan traces", () => {
    expect(ratio("#dfebfd6d", selectedDark).toFixed(2)).toBe("3.32");
  });
});

describe("it agrees with the second implementation", () => {
  it("on any color over any solid backdrop", () => {
    fc.assert(
      fc.property(anyColor, solid, (fg, bg) => {
        expect(ratio(fg, bg)).toBeCloseTo(referenceRatio(fg, bg), 9);
      }),
      RUNS,
    );
  });

  it("on every theme color over each solid page of its look, and over a hovered row", () => {
    const pairs = [fabrika.colors, fabrikaLight.colors].flatMap((colors) => {
      const pages = [colors.desk, colors.ground, colors.raised];
      const backdrops = [...pages, ...pages.map((page) => referenceOver(colors.hover, page))];
      return Object.values(colors).flatMap((fg) => backdrops.map((bg) => [fg, bg] as const));
    });
    expect(pairs.length).toBeGreaterThan(100);
    const apart = pairs.filter(([fg, bg]) => Math.abs(ratio(fg, bg) - referenceRatio(fg, bg)) > 1e-9);
    expect(apart).toEqual([]);
  });
});
