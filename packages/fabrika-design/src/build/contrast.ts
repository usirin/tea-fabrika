// The contrast checker the token floors are judged by (design foundations, PR 2). WCAG 2.2's
// contrast ratio, with an alpha color drawn over its backdrop first and rounded to 8 bits a
// channel, as the page draws it and as rules.py does.
//
//   ratio("#ffffff", "#000000")    // 21
//   over("#dfebfd6d", "#111113")   // "#696e77": slate a9 dark, drawn over the dark ground
//   ratio("#dfebfd6d", "#111113")  // 3.68
//
// Colors are lowercase `#rrggbb` or `#rrggbbaa`. A backdrop is solid.

type Rgba = readonly [number, number, number, number];

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

const rgbaOf = (value: string): Rgba => {
  if (!HEX.test(value)) {
    throw new Error(`not a #rrggbb or #rrggbbaa color: ${value}`);
  }

  const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
  return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

const channel = (c: number) =>
  Math.round(c * 255)
    .toString(16)
    .padStart(2, "0");

/** A color drawn over a solid backdrop, as `#rrggbb`. A solid color comes back as it is. */
export const over = (top: string, bottom: string): string => {
  const [r, g, b, a] = rgbaOf(top);
  const [R, G, B, A] = rgbaOf(bottom);

  if (A !== 1) {
    throw new Error(`a backdrop is solid: ${bottom}`);
  }

  const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
  return `#${[mix(r, R), mix(g, G), mix(b, B)].map(channel).join("")}`;
};

/** An sRGB channel, gamma taken off. */
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.2's relative luminance of a solid color. */
const luminance = (color: string) => {
  const [r, g, b] = rgbaOf(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** WCAG 2.2's contrast ratio of a color drawn on a solid backdrop, unrounded, 1 to 21. */
export const ratio = (fg: string, bg: string): number => {
  const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
