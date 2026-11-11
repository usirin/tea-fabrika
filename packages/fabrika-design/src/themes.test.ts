import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// The design package's laws (docs/direction/fabrika-design-package.md, decided 2026-11-02): the
// built-in `fabrika` and `fabrika-light` themes (docs/direction/themes.md, decided 2026-11-01),
// Radix 3.0.0, gray slate, accent indigo, and the one stylesheet of tokens, tokens.css, with Manti's
// --manti-* tokens set from them (docs/direction/ui-on-manti.md). Every value below is a Radix
// step, read from experiments/177-themes/schemes/radix-colors-3.0.0.json, and named beside it; the
// bends color principles records are named where they stand. Laws 1 to 14 and 16 of the P31 plan;
// law 15 is in themes.frame.test.ts. The laws about the app's own rules stay in the app
// (apps/fabrika/src/window/colors.test.ts): a package does not read its app.
// Ask desk's decided look (docs/direction/ask-desk.md:203,212) adds a slate 3 card in both looks.
// Color principles' step 3 is a component background; the card joins the contrast checks below.
//
// tokens.css is read, not drawn. A token's value in a look is found as the browser finds it:
// follow var() to the token it names, and take light-dark()'s first color in the light look and
// its second in the dark one. Contrast is WCAG 2.2's ratio, computed from the values, with an
// alpha color drawn over its background first and rounded to 8 bits a channel, as rules.py does.

const TOKENS_CSS = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const THEMES_TS = readFileSync(join(import.meta.dirname, "themes.ts"), "utf8");
const INDEX_TS = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");

const RADIX: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "experiments", "177-themes", "schemes", "radix-colors-3.0.0.json"),
    "utf8",
  ),
);

type Look = "dark" | "light";
const LOOKS: readonly Look[] = ["dark", "light"];

// ---- the note's values -------------------------------------------------------------------------

/** The note's `[colors]` for `fabrika`, as written there. */
const DARK = {
  desk: "#0c0d0e", // not a step: nothing in slate is darker than 1
  ground: "#111113", // slate 1
  raised: "#18191b", // slate 2
  card: "#212225", // slate 3
  hover: "#ddeaf814", // slate a3
  edge: "#d3edf81d", // slate a4
  focus: "#dfebfd6d", // slate a9: a8 reads 2.82 on a selected row
  text: "#edeef0", // slate 12
  faint: "#f1f7feb5", // slate a11
  "turn-fill": "#3e63dd", // indigo 9
  "on-turn": "#ffffff", // Radix's rule for text on step 9
  "turn-text": "#9eb1ff", // indigo 11
  done: "#71d083", // grass 11
  running: "#ffca16", // amber 11
  stuck: "#ff9592", // red 11
  closed: "#f1f7feb5", // slate a11: no hue, the word says closed
};

/**
 * `fabrika-light`: the same pick, look light, with amber 12 for running and slate a9 for focus.
 * The owner approved three more on 2026-11-01 (the design review), so each state word reads 4.5:1
 * on a hovered and a selected row too: grass 12, red 12 and indigo a11.
 */
const LIGHT = {
  desk: "#f9f9fb", // slate 2
  ground: "#fcfcfd", // slate 1
  raised: "#fcfcfd", // slate 1
  card: "#f0f0f3", // slate 3
  hover: "#0000330f", // slate a3
  edge: "#00002d17", // slate a4
  focus: "#00051d74", // slate a9: a8 reads 1.90
  text: "#1c2024", // slate 12
  faint: "#0007149f", // slate a11
  "turn-fill": "#3e63dd", // indigo 9
  "on-turn": "#ffffff",
  "turn-text": "#002bb7c5", // indigo a11: indigo 11 reads 4.47 on a selected row
  done: "#203c25", // grass 12: grass 11 reads 4.34 on a hovered row
  running: "#4f3422", // amber 12: amber 11 reads 4.38
  stuck: "#641723", // red 12: red 11 reads 4.46 on a hovered row
  closed: "#0007149f", // slate a11
};

/** The note's `[terminal]`, both looks. The palette is in ANSI order, 0 to 15. */
const TERMINALS = {
  dark: {
    foreground: "#edeef0", // slate 12
    background: "#111113", // slate 1
    cursor: "#edeef0", // slate 12
    selection: "#d9edfe25", // slate a5
    // slate 3; red, grass, amber, blue 9, purple 11, cyan 9; slate 12, slate 11; the six at 11; slate 12
    palette: [
      "#212225",
      "#e5484d",
      "#46a758",
      "#ffc53d",
      "#0090ff",
      "#d19dff",
      "#00a2c7",
      "#edeef0",
      "#b0b4ba",
      "#ff9592",
      "#71d083",
      "#ffca16",
      "#70b8ff",
      "#d19dff",
      "#4ccce6",
      "#edeef0",
    ],
  },
  light: {
    foreground: "#1c2024", // slate 12
    background: "#fcfcfd", // slate 1
    cursor: "#1c2024", // slate 12
    selection: "#0009321f", // slate a5
    // slate 12; red, grass 11, amber 12, blue, purple, cyan 11; slate 8, slate 11;
    // red, grass 11, amber 12, blue 11, purple 9, cyan 11; slate 7
    palette: [
      "#1c2024",
      "#ce2c31",
      "#2a7e3b",
      "#4f3422",
      "#0d74ce",
      "#8145b5",
      "#107d98",
      "#b9bbc6",
      "#60646c",
      "#ce2c31",
      "#2a7e3b",
      "#4f3422",
      "#0d74ce",
      "#8e4ec6",
      "#107d98",
      "#cdced6",
    ],
  },
} as const;

/** Palette colors the built-ins mean as fills, not text: black in dark, the two whites in light. */
const FILLS: Record<Look, ReadonlySet<number>> = { dark: new Set([0]), light: new Set([7, 15]) };

/** The steps the note does not name, in both looks, each by the job Radix gives it. */
const SELECTED = { dark: "#d9edfe25", light: "#0009321f" }; // slate a5: selected
const BORDER = { dark: "#d6ebfd30", light: "#00002f26" }; // slate a6: a part that is not interactive
const BORDER_STRONG = { dark: "#d9edff40", light: "#00062e32" }; // slate a7: an interactive part
const WIRE = { dark: "#d9edff5d", light: "#00083046" }; // slate a8: a strong line
const TURN_HOVER = { dark: "#5472e4", light: "#3358d4" }; // indigo 10: the solid fill's hover
const WASH = { dark: "#d8f4f609", light: "#00005506" }; // slate a2: a tile's title bar at rest

/** Both looks of one of the note's colors. */
const both = (name: keyof typeof DARK) => ({ dark: DARK[name], light: LIGHT[name] });

/**
 * Each color token tokens.css defines, and its value in each look: the P31 plan's tables, one row
 * each. The package names two text steps only, so --text-muted and --text-secondary are not here
 * (they stay in the app). --scrim and --manti-overlay are held by their own law below, since the
 * owner picks that step by eye (principle 8).
 */
const TOKENS: Record<string, Record<Look, string>> = {
  "--surface-sunken": both("desk"),
  "--surface": both("ground"),
  "--surface-raised": both("raised"),
  "--surface-card": both("card"),
  "--surface-hover": both("hover"),
  "--surface-selected": SELECTED,
  "--border-faint": both("edge"),
  "--border": BORDER,
  "--border-strong": BORDER_STRONG,
  "--wire": WIRE,
  "--focus": both("focus"),
  "--text-primary": both("text"),
  "--text-faint": both("faint"),
  "--turn-text": both("turn-text"),
  "--turn-fill": both("turn-fill"),
  "--turn-fill-hover": TURN_HOVER,
  "--turn-fg": both("on-turn"),
  "--done": both("done"),
  "--running": both("running"),
  "--stuck": both("stuck"),
  "--closed": both("closed"),
  // A tile's own names (tile guidelines): each points at a theme token, so a brought theme
  // repaints a tile.
  "--tile-edge": both("edge"),
  "--tile-edge-on": both("focus"),
  "--tile-edge-hover": BORDER_STRONG,
  "--tile-edge-loud": both("faint"),
  "--tile-text": both("faint"),
  "--tile-text-on": both("text"),
  "--tile-wash": WASH,
  "--tile-wash-on": both("hover"),
  // Manti's tokens, set from ours (ui-on-manti, section 3).
  "--manti-bg": both("desk"),
  "--manti-bg-subtle": both("ground"),
  "--manti-surface": both("ground"),
  "--manti-surface-raised": both("raised"),
  "--manti-surface-sunken": both("desk"),
  "--manti-border": BORDER,
  "--manti-border-strong": BORDER_STRONG,
  "--manti-text": both("text"),
  "--manti-text-muted": both("faint"),
  "--manti-text-subtle": both("faint"),
  "--manti-link": both("text"), // the accent says your turn and nothing else (flag 4)
  "--manti-fill-subtle": both("hover"),
  "--manti-fill": both("hover"),
  "--manti-fill-strong": SELECTED,
  "--manti-focus-ring": both("focus"),
  "--manti-selection-bg": { dark: TERMINALS.dark.selection, light: TERMINALS.light.selection },
  "--manti-selection-text": both("text"),
  "--manti-accent-fill": both("turn-fill"),
  "--manti-text-on-accent": both("on-turn"),
  "--manti-danger-text": both("stuck"),
  "--manti-danger-icon": both("stuck"),
  "--manti-danger-border": both("stuck"),
  "--manti-warning-text": both("running"),
  "--manti-panel-tint": both("raised"),
  "--manti-panel-tint-strong": both("raised"),
  "--manti-panel-tint-pressed": both("hover"),
  "--manti-panel-border": BORDER,
};

/**
 * Radix's black alpha scale, blackA1 to blackA12, as Radix writes it
 * (https://github.com/radix-ui/colors/blob/main/src/blackA.ts). It is not in the saved scales, so
 * it is held here. tokens.css writes a step as 8-digit hex, its alpha rounded to 8 bits.
 */
const BLACK_A = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map(
  (a) =>
    `#000000${Math.round(a * 255)
      .toString(16)
      .padStart(2, "0")}`,
);

/** The bends that are no Radix step, each with its reason (color principles, principle 5). */
const BENDS: Record<string, string> = {
  "#0c0d0e": "the dark desk: nothing in slate is darker than 1",
  "#ffffff": "on-turn: Radix's rule for text on step 9",
};

// ---- Radix's steps -----------------------------------------------------------------------------

/** One Radix scale in one key (light, dark, lightA, darkA): twelve hex colors, step 1 first. */
const stepsOf = (color: string, key: string): readonly string[] => {
  const scales = typeof RADIX === "object" && RADIX !== null && "scales" in RADIX ? RADIX.scales : undefined;
  const scale =
    typeof scales === "object" && scales !== null
      ? Object.entries(scales).find(([name]) => name === color)?.[1]
      : undefined;
  const steps =
    typeof scale === "object" && scale !== null ? Object.entries(scale).find(([name]) => name === key)?.[1] : undefined;

  if (!Array.isArray(steps) || steps.length !== 12) {
    throw new Error(`no ${color} ${key} in Radix`);
  }

  return steps.map((s) => String(s).toLowerCase());
};

const KEYS = ["light", "dark", "lightA", "darkA"];
/** The scales the themes use, solid and alpha, both looks. */
const SCALES = ["slate", "indigo", "grass", "amber", "red", "blue", "purple", "cyan"];
const RADIX_STEPS = new Set(SCALES.flatMap((color) => KEYS.flatMap((key) => stepsOf(color, key))));
const INDIGO = new Set(KEYS.flatMap((key) => stepsOf("indigo", key)));

// ---- reading the stylesheet --------------------------------------------------------------------

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Each innermost rule of a stylesheet: its selector and its declarations. */
const rulesOf = (css: string) =>
  [...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim().replace(/\s+/g, " "),
    says: new Map(
      body
        .split(";")
        .map((d) => {
          const at = d.indexOf(":");
          return [
            d.slice(0, at).trim(),
            d
              .slice(at + 1)
              .trim()
              .replace(/\s+/g, " "),
          ] as const;
        })
        .filter(([name]) => name !== ""),
    ),
  }));

const RULES = rulesOf(TOKENS_CSS);

/** tokens.css's :root. */
const ROOT = new Map(RULES.filter((r) => r.selector === ":root").flatMap((r) => [...r.says]));

/** A value's parts split at its top-level commas: `light-dark(a, b)` gives a and b. */
const argsOf = (inner: string) => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;

  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "(") {
      depth += 1;
    }

    if (inner[i] === ")") {
      depth -= 1;
    }

    if (inner[i] === "," && depth === 0) {
      parts.push(inner.slice(from, i).trim());
      from = i + 1;
    }
  }

  parts.push(inner.slice(from).trim());
  return parts;
};

/** `#abc` and `#ABCDEF80` as the note writes them: lowercase, two digits a channel. */
const hexOf = (value: string) => {
  const digits = value.slice(1).toLowerCase();
  return digits.length === 3 || digits.length === 4 ? `#${[...digits].map((d) => d + d).join("")}` : `#${digits}`;
};

/** A value in a look: var() followed, light-dark() picked. Anything else comes back as written. */
const valueIn = (value: string, look: Look, seen: readonly string[] = []): string => {
  const v = value.trim();
  const named = /^var\((--[\w-]+)\)$/.exec(v);

  if (named?.[1] !== undefined) {
    return tokenIn(named[1], look, seen);
  }

  const pair = /^light-dark\((.*)\)$/.exec(v);

  if (pair?.[1] !== undefined) {
    const [light = "", dark = ""] = argsOf(pair[1]);
    return valueIn(look === "light" ? light : dark, look, seen);
  }

  if (/^#[0-9a-f]{3,8}$/i.test(v)) {
    return hexOf(v);
  }

  return v;
};

const tokenIn = (name: string, look: Look, seen: readonly string[] = []): string => {
  if (seen.includes(name)) {
    throw new Error(`var() loop: ${[...seen, name].join(" -> ")}`);
  }

  const value = ROOT.get(name);

  if (value === undefined) {
    return `(no ${name} in tokens.css)`;
  }

  return valueIn(value, look, [...seen, name]);
};

/** Every token a value passes through on its way to a color. */
const chainOf = (value: string, seen: readonly string[] = []): readonly string[] =>
  [...value.matchAll(/var\((--[\w-]+)/g)].flatMap(([, name = ""]) =>
    seen.includes(name) ? [name] : [name, ...chainOf(ROOT.get(name) ?? "", [...seen, name])],
  );

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

// ---- WCAG contrast -----------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

const rgbaOf = (value: string): Rgba => {
  if (!HEX.test(value)) {
    throw new Error(`not a color this test computes: ${value}`);
  }

  const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
  return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

/** An alpha color drawn over a solid one, rounded to 8 bits a channel, as the page draws it. */
const over = (top: string, bottom: string): Rgba => {
  const [r, g, b, a] = rgbaOf(top);
  const [R, G, B] = rgbaOf(bottom);
  const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
  return [mix(r, R), mix(g, G), mix(b, B), 1];
};

/** An sRGB channel, gamma taken off. */
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const luminance = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const hexFrom = ([r, g, b]: Rgba) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** WCAG 2.2's contrast ratio of a color drawn on a solid background. */
const ratio = (fg: string, bg: string) => {
  const ground = rgbaOf(bg);
  const ink = over(fg, hexFrom(ground));
  const [hi, lo] = [luminance(ink), luminance(ground)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Each pair under its bar, as `fg on bg 2.95 < 3`. Empty when every pair reads. */
const under = (pairs: readonly (readonly [string, string, string, number])[]) =>
  pairs.flatMap(([name, fg, bg, bar]) => {
    const r = ratio(fg, bg);
    return r < bar ? [`${name} ${r.toFixed(2)} < ${bar}`] : [];
  });

/** A row token drawn over a page token, in a look. */
const rowOver = (row: string, page: string, look: Look) => hexFrom(over(tokenIn(row, look), tokenIn(page, look)));

/** Pages and cards, and a hovered and a selected row over the ground and over raised. */
const backgroundsIn = (look: Look): readonly (readonly [string, string])[] => [
  ...["--surface-sunken", "--surface", "--surface-raised", "--surface-card"].map(
    (page) => [page, tokenIn(page, look)] as const,
  ),
  ...["--surface-hover", "--surface-selected"].flatMap((row) =>
    ["--surface", "--surface-raised"].map((page) => [`${row} over ${page}`, rowOver(row, page, look)] as const),
  ),
];

// ---- law 1: the themes are the note's ----------------------------------------------------------

describe("law 1: the themes module holds the note's values", () => {
  it("fabrika is the note's dark pick", async () => {
    const { fabrika } = await import("./themes.ts");
    expect({ name: fabrika.name, look: fabrika.look }).toEqual({ name: "fabrika", look: "dark" });
    expect(fabrika.colors).toEqual(DARK);
    expect(fabrika.terminal).toEqual(TERMINALS.dark);
  });

  it("fabrika-light is the same pick, look light", async () => {
    const { fabrikaLight } = await import("./themes.ts");
    expect({ name: fabrikaLight.name, look: fabrikaLight.look }).toEqual({
      name: "fabrika-light",
      look: "light",
    });
    expect(fabrikaLight.colors).toEqual(LIGHT);
    expect(fabrikaLight.terminal).toEqual(TERMINALS.light);
  });
});

// ---- laws 2 and 3: each token is its value, and the page follows the look ----------------------

describe("law 2: each token in tokens.css is its value, in both looks", () => {
  it.each(LOOKS)("every listed token takes its Radix value, %s", (look) => {
    const got = Object.fromEntries(Object.keys(TOKENS).map((name) => [name, tokenIn(name, look)]));
    const want = Object.fromEntries(Object.entries(TOKENS).map(([name, v]) => [name, v[look]]));
    expect(got).toEqual(want);
  });

  it("defines no color token the list does not hold", () => {
    const held = new Set([...Object.keys(TOKENS), "--scrim", "--manti-overlay"]);
    const colors = [...ROOT.keys()].filter((name) => LOOKS.some((look) => HEX.test(tokenIn(name, look))));
    expect(colors.filter((name) => !held.has(name))).toEqual([]);
  });

  // Design language call 4 (decided 2026-11-07): focus is one gray token everywhere, so every ring
  // and every focused edge draws one value. A second focus token with a value of its own (the old
  // --tile-focus, slate a8 in dark) would be a second look for the same fact.
  it("holds one focus value: every focus color token is --focus, or names it by var()", () => {
    const focus = [...ROOT].filter(
      ([name]) => /focus/.test(name) && LOOKS.some((look) => HEX.test(tokenIn(name, look))),
    );
    expect({
      defined: focus.map(([name]) => name).sort(),
      own: focus.filter(([name, value]) => name !== "--focus" && value !== "var(--focus)"),
    }).toEqual({ defined: ["--focus", "--manti-focus-ring"], own: [] });
  });

  // The owner, 2026-11-06: the Cmd-K palette has no dim, as Linear's and other apps' have none. The
  // token stays for a real dialog, which keeps a dim, and Manti's overlay is set from it so none
  // of Manti's own palette shows. Its step is the owner's pick by eye (principle 8): Radix Themes'
  // overlay (blackA6 light, blackA8 dark), or a lighter step near Linear's dialog dim (about 26%
  // black; blackA5 is the nearest). So this law holds it to Radix's black alpha scale, not to one step.
  it.each(LOOKS)("--scrim is a step of Radix's black alpha scale, and Manti's overlay is it, %s", (look) => {
    expect({
      scrim: BLACK_A.includes(tokenIn("--scrim", look)),
      overlay: ROOT.get("--manti-overlay"),
    }).toEqual({ scrim: true, overlay: "var(--scrim)" });
  });
});

describe("law 3: the page follows the system's look", () => {
  it("says color-scheme: light dark, so light-dark() picks", () => {
    expect(ROOT.get("color-scheme")).toBe("light dark");
  });
});

// ---- law 4: every value is a Radix step --------------------------------------------------------

/** Code with its comments gone: `/* *\/` blocks, and `//` to the line's end but not in a URL. */
const codeOf = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Each color written as `#` and 3, 4, 6 or 8 hex digits, as the note writes it. */
const hexesIn = (code: string) => [...codeOf(code).matchAll(/#[0-9a-f]{3,8}\b/gi)].map(([m]) => hexOf(m));

describe("law 4: every color is a Radix step, or a named bend (principle 5)", () => {
  it("tokens.css writes no color that is not a Radix 3.0.0 step, blackA, or a named bend", () => {
    const css = hexesIn(TOKENS_CSS);
    expect(css.length).toBeGreaterThan(0);
    expect(css.filter((hex) => !RADIX_STEPS.has(hex) && !BLACK_A.includes(hex) && !(hex in BENDS))).toEqual([]);
  });

  it("themes.ts writes no color that is not a Radix 3.0.0 step or a named bend", () => {
    const ts = hexesIn(THEMES_TS);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts.filter((hex) => !RADIX_STEPS.has(hex) && !(hex in BENDS))).toEqual([]);
  });

  it("tokens.css writes no oklch(), rgb() or hsl() color, only steps as hex", () => {
    expect(uncommented(TOKENS_CSS).match(/\b(oklch|oklab|rgba?|hsla?|color)\(/g) ?? []).toEqual([]);
  });

  // The bend list in themes.ts's header names each bend: the dark desk, white on the turn, the
  // resting edge, and focus. Focus is one token (design language call 4, 2026-11-07), slate a9 in
  // both looks, so its two bends are one line that names both looks.
  it("themes.ts's header lists four bends, focus at a9 in both looks among them", () => {
    const header = /^(\/\/.*\n)+/.exec(THEMES_TS)?.[0] ?? "";
    const bends = header.split("\n").filter((line) => line.startsWith("// - "));
    expect({
      four: /\bfour bends\b/i.test(header),
      bends: bends.length,
      focus: bends.filter(
        (line) => /\bfocus\b/i.test(line) && /\ba9\b/.test(line) && /\bdark\b/i.test(line) && /\blight\b/i.test(line),
      ).length,
    }).toEqual({ four: true, bends: 4, focus: 1 });
  });
});

// ---- laws 5 to 7: text and lines read ----------------------------------------------------------

describe("law 5: text and state words read 4.5:1 where they sit (WCAG 1.4.3)", () => {
  const TEXT = ["--text-primary", "--text-faint", "--turn-text", "--done", "--running", "--stuck", "--closed"];

  it.each(LOOKS)(
    "on the desk, the ground, raised, cards, and hovered and selected rows over the ground and raised, %s",
    (look) => {
      const pairs = TEXT.flatMap((fg) =>
        backgroundsIn(look).map(([where, bg]) => [`${fg} on ${where}`, tokenIn(fg, look), bg, 4.5] as const),
      );
      fc.assert(
        fc.property(fc.constantFrom(...pairs), (pair) => {
          expect(under([pair])).toEqual([]);
        }),
        { seed: 119120 },
      );
      expect(under(pairs)).toEqual([]);
    },
  );
});

describe("law 6: white reads on the turn fill", () => {
  it("on-turn reads 4.5:1 on the turn fill, at rest in both looks and hovered in light", () => {
    expect(
      under([
        ...LOOKS.map(
          (look) =>
            [
              `--turn-fg on --turn-fill, ${look}`,
              tokenIn("--turn-fg", look),
              tokenIn("--turn-fill", look),
              4.5,
            ] as const,
        ),
        [
          "--turn-fg on --turn-fill-hover, light",
          tokenIn("--turn-fg", "light"),
          tokenIn("--turn-fill-hover", "light"),
          4.5,
        ],
      ]),
    ).toEqual([]);
  });

  // Known exception, decided 2026-11-01: the hovered fill keeps Radix's indigo 10, and white on
  // it reads 4.28 in dark, under 4.5:1 (tracker ticket 153). Any change to the pair shows here.
  it("on-turn on the hovered turn fill, dark, is indigo 10 at exactly 4.28:1", () => {
    const fill = tokenIn("--turn-fill-hover", "dark");
    expect(fill).toBe("#5472e4");
    expect(ratio(tokenIn("--turn-fg", "dark"), fill).toFixed(2)).toBe("4.28");
  });
});

describe("law 7: the lines a person must see read 3:1 (WCAG 1.4.11)", () => {
  it.each(LOOKS)("the turn fill, and focus: every ring and the focused tile's edge, %s", (look) => {
    const ground = tokenIn("--surface", look);
    const ring = tokenIn("--focus", look);
    const pairs = [
      ["--turn-fill on --surface", tokenIn("--turn-fill", look), ground, 3],
      ...["--surface-sunken", "--surface", "--surface-raised", "--surface-card"].map(
        (bg) => [`--focus on ${bg}`, ring, tokenIn(bg, look), 3] as const,
      ),
      ...["--surface-sunken", "--surface", "--surface-raised"].map(
        (page) => [`--focus on a hovered row on ${page}`, ring, rowOver("--surface-hover", page, look), 3] as const,
      ),
      ...["--surface", "--surface-raised"].map(
        (page) => [`--focus on a selected row on ${page}`, ring, rowOver("--surface-selected", page, look), 3] as const,
      ),
    ] as const;
    fc.assert(
      fc.property(fc.constantFrom(...pairs), (pair) => {
        expect(under([pair])).toEqual([]);
      }),
      { seed: 119120 },
    );
    expect(under(pairs)).toEqual([]);
  });

  // The focus bend's reason (flag 3): in dark the ring is slate a9, a solid step used as a line,
  // since slate a8, Radix's step for focus rings, reads under 3:1 on a selected row.
  it("in dark, slate a8 as the ring would read 2.82 on a selected row, so the ring is a9", () => {
    const darkA = stepsOf("slate", "darkA");
    expect({
      a8: ratio(darkA[7] ?? "", rowOver("--surface-selected", "--surface", "dark")).toFixed(2),
      ring: tokenIn("--focus", "dark") === darkA[8],
    }).toEqual({ a8: "2.82", ring: true });
  });
});

// ---- laws 8 to 11: the package's own names -----------------------------------------------------

describe("law 8: two text steps, under one name each", () => {
  it("defines exactly --text-primary and --text-faint", () => {
    const text = [...ROOT.keys()].filter((name) => name.startsWith("--text-")).sort();
    expect(text).toEqual(["--text-faint", "--text-primary"]);
  });

  it("names no --text-muted or --text-secondary anywhere", () => {
    expect(uncommented(TOKENS_CSS).match(/--text-(muted|secondary)\b/g) ?? []).toEqual([]);
  });
});

/** The tokens that are lines or fills, never text (color principles). */
const LINES_AND_FILLS = [
  "--border-faint",
  "--border",
  "--border-strong",
  "--wire",
  "--focus",
  "--turn-fill",
  "--turn-fill-hover",
  "--tile-edge",
  "--tile-edge-on",
  "--tile-edge-hover",
  "--tile-edge-loud",
];

describe("law 9: a line or a fill is never text", () => {
  const MANTI_TEXT = [
    "--manti-text",
    "--manti-text-muted",
    "--manti-text-subtle",
    "--manti-link",
    "--manti-danger-text",
    "--manti-warning-text",
    "--manti-selection-text",
    "--manti-text-on-accent",
  ];

  it("finds Manti's text tokens in tokens.css", () => {
    expect(MANTI_TEXT.filter((name) => !ROOT.has(name))).toEqual([]);
  });

  it("no Manti text token and no color: points at a line or a fill", () => {
    const texts = [
      ...MANTI_TEXT.map((name) => [name, ROOT.get(name) ?? ""] as const),
      ...RULES.flatMap((r) => {
        const color = r.says.get("color");
        return color === undefined ? [] : [[`${r.selector} { color }`, color] as const];
      }),
    ];
    const bad = texts.flatMap(([what, value]) =>
      chainOf(value)
        .filter((name) => LINES_AND_FILLS.includes(name))
        .map((name) => `${what} -> ${name}`),
    );
    expect(bad).toEqual([]);
  });
});

describe("law 10: the accent says your turn and nothing else", () => {
  it.each(LOOKS)("the tokens that are an indigo step are the turn's four, %s", (look) => {
    const indigo = [...ROOT.keys()].filter((name) => INDIGO.has(tokenIn(name, look))).sort();
    expect(indigo).toEqual(["--manti-accent-fill", "--turn-fill", "--turn-fill-hover", "--turn-text"]);
  });
});

describe("law 11: the package stands alone", () => {
  /** Manti tokens set to a plain value, not one of ours: the value, and why. Only shrinks. */
  const PLAIN: Record<string, readonly [value: string, why: string]> = {
    "--manti-focus-ring-width": ["2px", "the ring's width, as ours is (1.4.11)"],
    "--manti-focus-ring-offset": ["2px", "the ring's gap, as ours is"],
    "--manti-panel-blur": ["none", "popovers are opaque, no glass (popovers.md)"],
    "--manti-control-height-sm": ["28px", "ui-on-manti records it as the one raw value"],
    "--manti-kbd-padding-y": ["0", "a keycap's height is set, so no padding (popovers.md)"],
    "--manti-kbd-border-width": ["1px", "a keycap's edge (popovers.md)"],
  };
  const MANTI = RULES.flatMap((r) => [...r.says].filter(([name]) => name.startsWith("--manti-")));

  it("every var() names a token tokens.css defines", () => {
    const defined = new Set(RULES.flatMap((r) => [...r.says.keys()]));
    const used = [...uncommented(TOKENS_CSS).matchAll(/var\((--[\w-]+)/g)].map(([, n = ""]) => n);
    expect([...new Set(used.filter((name) => !defined.has(name)))]).toEqual([]);
  });

  it("every Manti token is one of ours by var(), but the named plain values", () => {
    const loose = MANTI.filter(([name, value]) => !/^var\(--[\w-]+\)$/.test(value) && !Object.hasOwn(PLAIN, name)).map(
      ([name, value]) => `${name}: ${value}`,
    );
    expect(loose).toEqual([]);
  });

  it("each plain one is set to its named value, so the list only shrinks", () => {
    const set = new Map(MANTI);
    expect(Object.fromEntries(Object.keys(PLAIN).map((name) => [name, set.get(name)]))).toEqual(
      Object.fromEntries(Object.entries(PLAIN).map(([name, [value]]) => [name, value])),
    );
  });

  // A keycap: our size and border, in the UI's own sans, as Linear's are (popovers.md). Its text
  // is the look's low step, under its one name.
  it("draws a keycap's text in --text-faint", () => {
    const kbd = RULES.find((r) => r.selector === '[data-scope="kbd"][data-part="root"]');
    expect(kbd?.says.get("color")).toBe("var(--text-faint)");
  });
});

// ---- law 12: the type scale is px --------------------------------------------------------------

describe("law 12: the type scale is px, and Manti's sizes are ours", () => {
  it("each --fs-* is the px its name says", () => {
    expect(Object.fromEntries([...ROOT].filter(([name]) => name.startsWith("--fs-")))).toEqual({
      "--fs-title": "22px",
      "--fs-head": "15px",
      "--fs-body": "13px",
      "--fs-prose": "14px",
      "--fs-small": "12px",
      "--fs-micro": "11px",
    });
  });

  it("sets each of Manti's text sizes from our scale", () => {
    const sizes = Object.fromEntries([...ROOT].filter(([name]) => /^--manti-text-(xs|sm|base|lg|\d?xl)$/.test(name)));
    expect(sizes).toEqual({
      "--manti-text-xs": "var(--fs-micro)",
      "--manti-text-sm": "var(--fs-small)",
      "--manti-text-base": "var(--fs-body)",
      "--manti-text-lg": "var(--fs-prose)",
      "--manti-text-xl": "var(--fs-head)",
      "--manti-text-2xl": "var(--fs-title)",
    });
  });

  it("names no rem, so the root's size moves nothing on its own (ticket 108)", () => {
    expect(uncommented(TOKENS_CSS).match(/\d\s*rem\b/g) ?? []).toEqual([]);
  });
});

// ---- law 13: the top level runs anywhere -------------------------------------------------------

/** Each module a file names: `from "x"`, `import "x"` or `import("x")`. */
const modulesIn = (ts: string) =>
  [...codeOf(ts).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)].map(
    ([, from, bare]) => from ?? bare,
  );

describe("law 13: the top level imports nothing and runs anywhere", () => {
  it("index.ts exports the themes and nothing else", async () => {
    const top = await import("./index.ts");
    expect(Object.keys(top).sort()).toEqual(["fabrika", "fabrikaLight", "followLook", "frameColor", "terminalTheme"]);
  });

  // Design foundations PR 2: the sixteen colors come from the generated theme-colors.ts, which
  // the token build writes from tokens/color/*.toml. It is read here, not at the top, so the laws
  // above still run when it is missing.
  it("index.ts names only themes.ts, themes.ts only theme-colors.ts, which imports nothing", () => {
    const generated = readFileSync(join(import.meta.dirname, "theme-colors.ts"), "utf8");
    expect({
      index: [...new Set(modulesIn(INDEX_TS))],
      themes: modulesIn(THEMES_TS),
      generated: modulesIn(generated),
    }).toEqual({ index: ["./themes.ts"], themes: ["./theme-colors.ts"], generated: [] });
  });

  // code-graph's impure globals: the process, a clock, randomness, timers, the network, files.
  it("uses no process, clock, randomness, timer or network", () => {
    const impure =
      /\b(process|Date|performance|crypto|fetch|setTimeout|setInterval|require|globalThis)\b|Math\.random/g;
    const words = (ts: string) =>
      codeOf(ts)
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
        .match(impure) ?? [];
    const generated = readFileSync(join(import.meta.dirname, "theme-colors.ts"), "utf8");
    expect({ index: words(INDEX_TS), themes: words(THEMES_TS), generated: words(generated) }).toEqual({
      index: [],
      themes: [],
      generated: [],
    });
  });
});

// ---- laws 14 and 16: the terminal --------------------------------------------------------------

describe("law 14: the terminal reads", () => {
  it.each(LOOKS)("text 4.5:1, cursor 3:1, fills aside, %s", async (look) => {
    const { fabrika, fabrikaLight } = await import("./themes.ts");
    const t = (look === "dark" ? fabrika : fabrikaLight).terminal;
    expect(
      under([
        ["foreground", t.foreground, t.background, 4.5],
        ["cursor", t.cursor, t.background, 3],
        ...t.palette.flatMap((c, i) => (FILLS[look].has(i) ? [] : [[`palette ${i}`, c, t.background, 4.5] as const])),
      ]),
    ).toEqual([]);
  });
});

/** ghostty-web's `ITheme` names for the palette, in ANSI order. */
const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

const ANSI_NAMES = [...ANSI, ...ANSI.map((n) => `bright${n.slice(0, 1).toUpperCase()}${n.slice(1)}`)];

describe("law 16: the terminal's names keep ANSI order", () => {
  it("gives the built-ins' colors by ghostty-web's names", async () => {
    const { fabrika, fabrikaLight, terminalTheme } = await import("./themes.ts");
    const named = (t: (typeof TERMINALS)[Look]) => ({
      foreground: t.foreground,
      background: t.background,
      cursor: t.cursor,
      selectionBackground: t.selection,
      ...Object.fromEntries(ANSI_NAMES.map((n, i) => [n, t.palette[i]])),
    });
    expect(terminalTheme(fabrika)).toEqual(named(TERMINALS.dark));
    expect(terminalTheme(fabrikaLight)).toEqual(named(TERMINALS.light));
  });

  it("for any sixteen colors: black to white are 0 to 7, the brights 8 to 15, the rest passed through", async () => {
    const { fabrika, terminalTheme } = await import("./themes.ts");
    const hex = fc.stringMatching(/^[0-9a-f]{6}$/).map((digits): `#${string}` => `#${digits}`);
    fc.assert(
      fc.property(
        fc.tuple(hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex, hex),
        fc.tuple(hex, hex, hex, hex),
        (palette, [foreground, background, cursor, selection]) => {
          const theme = {
            ...fabrika,
            terminal: { foreground, background, cursor, selection, palette },
          };
          expect(terminalTheme(theme)).toEqual({
            foreground,
            background,
            cursor,
            selectionBackground: selection,
            ...Object.fromEntries(ANSI_NAMES.map((n, i) => [n, palette[i]])),
          });
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });
});
