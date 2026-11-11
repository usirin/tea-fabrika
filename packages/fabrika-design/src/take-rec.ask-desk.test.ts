import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ratio } from "./build/contrast.ts";
import { dark, light } from "./theme-colors.ts";

// Ticket 102, ask desk PR 1, plan property 23 and its 2026-11-09 amendment: text reads 4.5:1
// (WCAG 1.4.3, color-principles). In the light look the primary Take rec goes pale with the evidence
// or the note open. This law computes Take rec's label against its own background from the real
// token values, in every ask-box state and both looks, with `ratio` from build/contrast.ts.
//
// What Take rec is drawn with (programs/tracker/src/ask-window.tsx, the toolbar's Button): Manti's
// primary solid, `--manti-accent-fill` = turn-fill, label `--manti-text-on-accent` = on-turn, and
// Manti's own state mixes in oklab (`--variant-solid-hover`, `--variant-solid-active`). Those
// are read from the installed, patched Manti CSS (`@manti-ui/styles/index.css`, the
// `[data-variant=primary]` rule) and resolved with the real tokens, never copied here
// (patches/@manti-ui__styles@0.13.0.patch turns the light side toward black: light hover and press
// read 4.10:1 and 3.37:1 with Manti's mix toward white). While a note is open Take rec is the
// outline variant: label = the rule's `--variant-text` on the raised surface.
//
// The saving state (busy: every action disabled, Manti draws the button at opacity .5) is not
// covered: WCAG 1.4.3 exempts inactive user interface components, so the 4.5:1 law holds only while
// Take rec is enabled (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, "Incidental").
//
// Properties, not a list: for any look and any ask-box state, the pair reads 4.5. The pairs are
// generated over looks x states; the plant is a paler fill, which must fail the same check.

type Look = "light" | "dark";
const LOOKS = { light, dark } as const;

// The ask-box states a shot captures; each lists which Take rec draw it puts the button in.
const STATES = [
  "rest",
  "shown rec",
  "evidence open",
  "note open",
  "pick: yes",
  "pick: no",
  "pick: other",
  "hovered",
  "pressed",
  "failed save",
] as const;

type State = (typeof STATES)[number];

// oklab mixing, as CSS `color-mix(in oklab, a p%, b)`.
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const toLab = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as const;
};

const fromLab = ([L, a, b]: readonly [number, number, number]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, gam(c))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

const mix = (a: string, percent: number, b: string) => {
  const [A, B] = [toLab(a), toLab(b)];
  const p = percent / 100;
  return fromLab([0, 1, 2].map((i) => A[i]! * p + B[i]! * (1 - p)) as [number, number, number]);
};

const manti = createRequire(new URL("../../../apps/fabrika/package.json", import.meta.url));
const mantiCss = readFileSync(manti.resolve("@manti-ui/styles/index.css"), "utf8");

/** The text between the matching parens that open at `from`, and the index after the close. */
const group = (text: string, from: number): [string, number] => {
  let depth = 0;

  for (let i = from; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    }

    if (text[i] === ")" && --depth === 0) {
      return [text.slice(from + 1, i), i + 1];
    }
  }

  throw new Error(`unbalanced parens in ${text.slice(from, from + 60)}`);
};

const splitTop = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    }

    if (text[i] === ")") {
      depth--;
    }

    if (text[i] === "," && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }

  return [...parts, text.slice(from).trim()];
};

/** One custom property of Manti's primary variant, for a look and a fill, resolved to a hex. */
const primary = (css: string, name: string, look: Look): string => {
  const start = css.indexOf("[data-variant=primary]{--variant-solid:");

  if (start < 0) {
    throw new Error("no [data-variant=primary] rule in Manti's CSS");
  }

  const body = css.slice(start, css.indexOf("}", start));
  const decl = new RegExp(`[{;]--${name}:`).exec(body);

  if (decl === null) {
    throw new Error(`primary has no --${name}`);
  }

  const at = decl.index + decl[0].length;
  let end = at;

  for (let depth = 0; end < body.length; end++) {
    if (body[end] === "(") {
      depth++;
    }

    if (body[end] === ")") {
      depth--;
    }

    if (body[end] === ";" && depth === 0) {
      break;
    }
  }

  const fill = LOOKS[look]["turn-fill"];
  const resolve = (value: string): string => {
    const v = value.trim();

    if (v.startsWith("light-dark(")) {
      const [inner] = group(v, v.indexOf("("));
      const [lightSide, darkSide] = splitTop(inner);
      return resolve(look === "light" ? lightSide! : darkSide!);
    }

    if (v.startsWith("color-mix(")) {
      const [inner] = group(v, v.indexOf("("));
      const [space, one, two] = splitTop(inner);

      if (space !== "in oklab") {
        throw new Error(`color-mix in ${space}`);
      }

      const [color, pct] = one!.split(/\s+(?=[\d.]+%$)/) as [string, string];
      return mix(resolve(color), Number.parseFloat(pct), resolve(two!));
    }

    if (v === "var(--variant-solid)" || v === "var(--manti-accent-fill)") {
      return fill;
    }

    if (v === "white") {
      return "#ffffff";
    }

    if (v === "black") {
      return "#000000";
    }

    if (/^#[0-9a-f]{6}$/i.test(v)) {
      return v;
    }

    throw new Error(`cannot resolve ${v}`);
  };
  return resolve(body.slice(at, end));
};

/** Take rec's label and background in a state and a look: what the page draws, from the tokens. */
const takeRec = (look: Look, state: State, css = mantiCss): { fg: string; bg: string } => {
  const t = LOOKS[look];

  switch (state) {
    case "note open": // the outline variant: the one indigo is the note's Send
      return { fg: primary(css, "variant-text", look), bg: t.raised };
    case "hovered":
      return { fg: t["on-turn"], bg: primary(css, "variant-solid-hover", look) };
    case "pressed":
      return { fg: t["on-turn"], bg: primary(css, "variant-solid-active", look) };
    default:
      return { fg: t["on-turn"], bg: t["turn-fill"] };
  }
};

describe("law 23: Take rec's label reads 4.5:1 on its own background", () => {
  it("in every ask-box state, in both looks, from the real tokens", () => {
    fc.assert(
      fc.property(fc.constantFrom<Look>("light", "dark"), fc.constantFrom(...STATES), (look, state) => {
        const { fg, bg } = takeRec(look, state);
        const got = ratio(fg, bg);
        expect(got, `${state}, ${look}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }),
      { numRuns: 200 },
    );
  });

  it("plant: a fill lightened 40% or more toward white under the white label is caught by the same ratio", () => {
    fc.assert(
      fc.property(fc.constantFrom<Look>("light", "dark"), fc.integer({ min: 40, max: 60 }), (look, pale) => {
        const t = LOOKS[look];
        const bg = mix(t["turn-fill"], 100 - pale, "#ffffff");
        expect(ratio(t["on-turn"], bg)).toBeLessThan(4.5);
      }),
    );
  });

  // plant: Manti's own unpatched light mix, toward white (hover 88%, press 78%), read through the
  // same resolver and the same ratio.
  it("plant: Manti's unpatched light mix toward white under the label is caught by the same ratio", () => {
    const unpatched = mantiCss
      .replaceAll(
        "88%, black),color-mix(in oklab, var(--variant-solid) 88%, black)",
        "88%, white),color-mix(in oklab, var(--variant-solid) 88%, black)",
      )
      .replaceAll(
        "78%, black),color-mix(in oklab, var(--variant-solid) 78%, black)",
        "78%, white),color-mix(in oklab, var(--variant-solid) 78%, black)",
      );
    expect(unpatched).not.toBe(mantiCss);
    fc.assert(
      fc.property(fc.constantFrom<State>("hovered", "pressed"), (state) => {
        const { fg, bg } = takeRec("light", state, unpatched);
        expect(ratio(fg, bg), `${state}: ${fg} on ${bg}`).toBeLessThan(4.5);
      }),
    );
  });
});
