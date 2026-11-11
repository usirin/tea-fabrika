import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";

// The token build's laws (design foundations, PR 2, properties 9 to 14, 16 and 19). Each color
// token is one TOML file in tokens/color/, in the keys the owner decided on 2026-11-07:
//
//   # tokens/color/text-faint.toml
//   type = "text"                 # background | text | icon | border
//   tier = "global"               # primitive | global | shared | component
//   owner = "design"
//   description = "every quieter word"
//   on = ["surface", "surface-raised"]
//   floor = 4.5
//
//   [colors]
//   dark = "slate.a11"
//   light = "slate.a11"
//
// A token that points at another says `[colors] extends = "<token>"` instead of dark and light.
//
// The build is run as `pnpm tokens` runs it, as a program, never imported:
//
//   node src/build/tokens.ts                     # write the generated files and regions
//   node src/build/tokens.ts --check             # exit 1 on a bad file, a missed floor, or drift
//   node src/build/tokens.ts --check --root <d>  # the same, for a package copied to <d>
//
// `--root` names a folder laid out as this package is (tokens/, src/tokens.css,
// src/theme-colors.ts, src/token-names.json), so a law can plant a bug in a copy. An error names
// the file and the field; it is printed, on stdout or stderr.
//
// tokens/parts.toml names each owner: `[tile] stylesheets = [...]` for a part, `[design]
// anywhere = true` for the package's own. tokens/manti.toml sets each --manti-* from one of our
// custom properties by name, `"--manti-bg" = "--surface-sunken"`, or to a plain value with its
// reason, `"--manti-panel-blur" = { value = "none", why = "..." }`. schema.ts says it in full.

const PACKAGE = join(import.meta.dirname, "..", "..");
const SCRIPT = join(import.meta.dirname, "tokens.ts");
const COLOR = join(PACKAGE, "tokens", "color");

/**
 * Every color token tokens.css defines today, one file each, by group. Nothing is renamed. The
 * ask desk adds surface-card, slate 3 (docs/direction/ask-desk.md).
 */
const TOKENS = [
  ...["surface-sunken", "surface", "surface-raised", "surface-card", "surface-hover"],
  "surface-selected",
  ...["border-faint", "border", "border-strong", "wire", "focus"],
  ...["text-primary", "text-faint"],
  ...["turn-text", "turn-fill", "turn-fill-hover", "turn-fg"],
  ...["done", "running", "stuck", "closed"],
  "scrim",
  ...["tile-edge", "tile-edge-on", "tile-edge-hover", "tile-edge-loud"],
  ...["tile-text", "tile-text-on", "tile-wash", "tile-wash-on"],
];

/** The tokens that point at another, and what each points at: tokens.css's var() today. */
const EXTENDS: Record<string, string> = {
  closed: "text-faint",
  "tile-edge": "border-faint",
  "tile-edge-on": "focus",
  "tile-edge-hover": "border-strong",
  "tile-edge-loud": "text-faint",
  "tile-text": "text-faint",
  "tile-text-on": "text-primary",
  "tile-wash-on": "surface-hover",
};

/** The type of each token with values of its own: surface and fill are background, line is border. */
const TYPES: Record<string, string> = {
  ...Object.fromEntries(
    ["surface-sunken", "surface", "surface-raised", "surface-card", "surface-hover", "surface-selected"].map((t) => [
      t,
      "background",
    ]),
  ),
  ...Object.fromEntries(["border-faint", "border", "border-strong", "wire", "focus"].map((t) => [t, "border"])),
  ...Object.fromEntries(
    ["text-primary", "text-faint", "turn-text", "turn-fg", "done", "running", "stuck"].map((t) => [t, "text"]),
  ),
  "turn-fill": "background",
  "turn-fill-hover": "background",
  scrim: "background",
  "tile-wash": "background",
};

type Table = Record<string, unknown>;

const isTable = (x: unknown): x is Table => typeof x === "object" && x !== null && !Array.isArray(x);

const tableIn = (t: Table, key: string): Table => {
  const inner = t[key];

  if (!isTable(inner)) {
    throw new Error(`no [${key}] table`);
  }

  return inner;
};

const toml = async () => await import("smol-toml");

const readToken = async (dir: string, token: string): Promise<Table> => {
  const { parse } = await toml();
  return parse(readFileSync(join(dir, "tokens", "color", `${token}.toml`), "utf8"));
};

// ---- running the build on a copy ---------------------------------------------------------------

const copies: string[] = [];

afterAll(() => {
  for (const dir of copies) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A copy of the package's token files and generated files, to plant a bug in. */
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "fab-tokens-"));
  copies.push(dir);
  cpSync(join(PACKAGE, "tokens"), join(dir, "tokens"), { recursive: true });
  mkdirSync(join(dir, "src"));

  for (const file of ["tokens.css", "theme-colors.ts", "token-names.json"]) {
    cpSync(join(PACKAGE, "src", file), join(dir, "src", file));
  }

  return dir;
};

const run = (...args: readonly string[]) => {
  const out = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE, encoding: "utf8" });
  return { code: out.status, said: `${out.stdout}${out.stderr}` };
};

const check = (dir: string) => run("--check", "--root", dir);

/** Change one token file in a copy: read its TOML, change the table, write it back. */
const edit = async (dir: string, token: string, change: (t: Table) => void) => {
  const { parse, stringify } = await toml();
  const path = join(dir, "tokens", "color", `${token}.toml`);
  const t = parse(readFileSync(path, "utf8"));
  change(t);
  writeFileSync(path, stringify(t));
};

/** The copy's tokens.css, with one line put in the hand-written part, before `--fs-body`. */
const writeByHand = (dir: string, line: string) => {
  const path = join(dir, "src", "tokens.css");
  const css = readFileSync(path, "utf8");

  if (!css.includes("\t--fs-body:")) {
    throw new Error("no --fs-body in tokens.css");
  }

  writeFileSync(path, css.replace("\t--fs-body:", `\t${line}\n\t--fs-body:`));
};

// ---- the files themselves ----------------------------------------------------------------------

describe("one TOML file per color token, flat in tokens/color/", () => {
  // format: the committed tokens/color/*.toml file names are the public token names, exactly.
  it("format: holds exactly today's 30 color tokens, under today's names", () => {
    const files = readdirSync(COLOR).sort();
    expect(files).toEqual(TOKENS.map((t) => `${t}.toml`).sort());
  });

  it("puts manti.toml and parts.toml beside the color folder, and nothing else", () => {
    expect(readdirSync(join(PACKAGE, "tokens")).sort()).toEqual(["color", "manti.toml", "parts.toml"]);
  });

  it("names the tile's stylesheet as the one place the tile's tokens may appear", async () => {
    const { parse } = await toml();
    const parts = parse(readFileSync(join(PACKAGE, "tokens", "parts.toml"), "utf8"));
    expect(tableIn(parts, "tile")["stylesheets"]).toEqual(["apps/fabrika/src/window/window.css"]);
  });

  it("names the design's own tokens as readable anywhere", async () => {
    const { parse } = await toml();
    const parts = parse(readFileSync(join(PACKAGE, "tokens", "parts.toml"), "utf8"));
    expect({
      names: Object.keys(parts).sort(),
      anywhere: tableIn(parts, "design")["anywhere"],
    }).toEqual({
      names: ["design", "tile"],
      anywhere: true,
    });
  });
});

describe("each file says the owner's decided keys", () => {
  it.each(TOKENS)("%s has a tier and an owner, and none of the old words", async (token) => {
    const t = await readToken(PACKAGE, token);
    expect({
      tier: ["primitive", "global", "shared", "component"].includes(String(t["tier"])),
      owner: typeof t["owner"] === "string" && t["owner"] !== "",
      old: ["job", "says", "same", "dark", "light", "group"].filter((key) => key in t),
    }).toEqual({ tier: true, owner: true, old: [] });
  });

  it.each(Object.entries(TYPES))("%s is a %s, says what it is for, and has both looks", async (token, type) => {
    const colors = tableIn(await readToken(PACKAGE, token), "colors");
    const t = await readToken(PACKAGE, token);
    expect({
      type: t["type"],
      description: typeof t["description"] === "string" && t["description"] !== "",
      looks: ["dark", "light"].filter((look) => look in colors),
    }).toEqual({ type, description: true, looks: ["dark", "light"] });
  });

  it.each(Object.entries(EXTENDS))("%s extends %s", async (token, target) => {
    const colors = tableIn(await readToken(PACKAGE, token), "colors");
    expect(colors).toEqual({ extends: target });
  });

  it.each(TOKENS.filter((t) => t.startsWith("tile-")))("%s is owned by the tile", async (token) => {
    expect((await readToken(PACKAGE, token))["owner"]).toBe("tile");
  });

  it("gives every other token to the design", async () => {
    const others = await Promise.all(
      TOKENS.filter((t) => !t.startsWith("tile-")).map(async (t) => [t, await readToken(PACKAGE, t)] as const),
    );
    expect(others.filter(([, t]) => t["owner"] !== "design").map(([name]) => name)).toEqual([]);
  });

  // Q13, decided: a border no fact rides on says so, and focus holds its 3:1 floor.
  it("lets the three resting borders carry nothing, and holds focus to 3:1", async () => {
    const read = async (token: string) => {
      const t = await readToken(PACKAGE, token);
      return { carries: t["carries"], floor: t["floor"] };
    };
    expect({
      "border-faint": (await read("border-faint")).carries,
      border: (await read("border")).carries,
      "border-strong": (await read("border-strong")).carries,
      focus: (await read("focus")).floor,
    }).toEqual({
      "border-faint": "nothing",
      border: "nothing",
      "border-strong": "nothing",
      focus: 3,
    });
  });

  it("keeps the 4.28 exception on white over the hovered turn fill, with its ticket", async () => {
    const except = (await readToken(PACKAGE, "turn-fg"))["except"];
    expect(except).toEqual([
      expect.objectContaining({ on: "turn-fill-hover", look: "dark", ratio: 4.28, ticket: 153 }),
    ]);
  });
});

// ---- the generated files -----------------------------------------------------------------------

const TOKENS_CSS = () => readFileSync(join(PACKAGE, "src", "tokens.css"), "utf8");

/** The first :root block's body. */
const rootOf = (css: string) => {
  const at = css.indexOf(":root {");
  const end = css.indexOf("\n}", at);

  if (at < 0 || end < 0) {
    throw new Error("no :root in tokens.css");
  }

  return css.slice(at, end);
};

/** The text between a region's opening comment and its closing one. */
const regionOf = (css: string, name: "colors" | "manti") => {
  const open = new RegExp(`/\\*\\s*@generated ${name}\\b[^*]*\\*/`, "g");
  const close = new RegExp(`/\\*\\s*@end generated ${name}\\s*\\*/`, "g");
  const opens = [...css.matchAll(open)];
  const closes = [...css.matchAll(close)];

  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(`${name}: ${opens.length} openings and ${closes.length} closings`);
  }

  const from = (opens[0]?.index ?? 0) + (opens[0]?.[0].length ?? 0);
  return css.slice(from, closes[0]?.index ?? 0);
};

const declarationsIn = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, name = "", value = ""]) => [name, value.trim().replace(/\s+/g, " ")] as const,
  );

describe("tokens.css keeps one :root, with two marked regions the build writes", () => {
  it("opens and closes each region once, colors before manti, both inside the first :root", () => {
    const css = TOKENS_CSS();
    const root = rootOf(css);
    const at = (s: string) => root.indexOf(s);
    const marks = [
      at("@generated colors"),
      at("@end generated colors"),
      at("@generated manti"),
      at("@end generated manti"),
    ];
    expect({
      inside: marks.every((m) => m > 0),
      ordered: marks.every((m, i) => i === 0 || m > (marks[i - 1] ?? 0)),
      colors: css.split("@generated colors").length - 1,
      manti: css.split("@generated manti").length - 1,
    }).toEqual({ inside: true, ordered: true, colors: 1, manti: 1 });
  });

  // format: the generated CSS region writes each public custom-property name exactly once.
  it("format: writes the 30 color tokens in the colors region, and no color outside it", () => {
    const css = TOKENS_CSS();
    const colors = declarationsIn(regionOf(css, "colors"));
    const rest = rootOf(css).replace(regionOf(css, "colors"), "").replace(regionOf(css, "manti"), "");
    expect({
      names: colors.map(([name]) => name).sort(),
      colorsLeft: declarationsIn(rest)
        .filter(([, value]) => /#[0-9a-f]{3,8}\b|light-dark\(/i.test(value))
        .map(([name]) => name),
    }).toEqual({ names: TOKENS.map((t) => `--${t}`).sort(), colorsLeft: [] });
  });

  it("writes each value in one form: light-dark() of two values, or one plain value", () => {
    const loose = declarationsIn(regionOf(TOKENS_CSS(), "colors")).filter(([, value]) => {
      const pair = /^light-dark\((#[0-9a-f]{6,8}), (#[0-9a-f]{6,8})\)$/.exec(value);

      if (pair !== null) {
        return pair[1] === pair[2];
      }

      return !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value) && !/^var\(--[\w-]+\)$/.test(value);
    });
    expect(loose).toEqual([]);
  });

  it("writes a token that extends another as var() of it", () => {
    const values = new Map(declarationsIn(regionOf(TOKENS_CSS(), "colors")));
    expect(Object.fromEntries(Object.keys(EXTENDS).map((t) => [t, values.get(`--${t}`)]))).toEqual(
      Object.fromEntries(Object.entries(EXTENDS).map(([t, target]) => [t, `var(--${target})`])),
    );
  });

  it("writes every --manti-* of the :root in the manti region, and only those", () => {
    const css = TOKENS_CSS();
    const manti = declarationsIn(regionOf(css, "manti")).map(([name]) => name);
    const inRoot = declarationsIn(rootOf(css))
      .map(([name]) => name)
      .filter((name) => name.startsWith("--manti-"));
    expect({ every: manti.every((n) => n.startsWith("--manti-")), names: manti.sort() }).toEqual({
      every: true,
      names: inRoot.sort(),
    });
  });
});

describe("theme-colors.ts is generated, and themes.ts reads it", () => {
  it("exports the dark and light colors, and nothing else", async () => {
    const generated = await import("../theme-colors.ts");
    expect(Object.keys(generated).sort()).toEqual(["dark", "light"]);
  });

  // format: the generated module's exact sixteen-field records are what both theme files read.
  it("format: gives the themes their sixteen colors, both looks", async () => {
    const { dark, light } = await import("../theme-colors.ts");
    const { fabrika, fabrikaLight } = await import("../themes.ts");
    expect({ dark, light }).toEqual({ dark: fabrika.colors, light: fabrikaLight.colors });
    expect(Object.keys(dark)).toHaveLength(16);
  });
});

describe("token-names.json lists what the stylelint rules read", () => {
  const names = () => {
    const json: unknown = JSON.parse(readFileSync(join(PACKAGE, "src", "token-names.json"), "utf8"));

    if (!isTable(json)) {
      throw new Error("token-names.json is no object");
    }

    return json;
  };

  it("lists every custom property tokens.css defines, once, with its owner", () => {
    const tokens = names()["tokens"];
    const listed = Array.isArray(tokens) ? tokens.filter(isTable) : [];
    const defined = [...new Set(declarationsIn(TOKENS_CSS()).map(([name]) => name))].sort();
    expect({
      names: listed.map((t) => t["name"]).sort(),
      tile: listed
        .filter((t) => t["owner"] === "tile")
        .map((t) => t["name"])
        .sort(),
    }).toEqual({
      names: defined,
      tile: TOKENS.filter((t) => t.startsWith("tile-"))
        .map((t) => `--${t}`)
        .sort(),
    });
  });

  // Only a part with stylesheets limits where its tokens appear; the design's are read anywhere.
  it("gives the parts as parts.toml names them", () => {
    expect(names()["parts"]).toEqual({ tile: ["apps/fabrika/src/window/window.css"] });
  });

  // Rule 3 reads this list, never a pattern: every Radix 3.0.0 scale and step, in each spelling a
  // stylesheet could use (Radix's own CSS writes --slate-9 and --slate-a9; its JS writes slateA9).
  it("lists every Radix scale's steps in each spelling, read from @radix-ui/colors", async () => {
    const radix: Table = await import("@radix-ui/colors");
    const scales = [...new Set(Object.keys(radix).map((k) => k.replace(/(Dark)?(P3)?A?$/, "")))];
    const n = Array.from({ length: 12 }, (_, i) => i + 1);
    const want = scales.flatMap((s) =>
      ["black", "white"].includes(s)
        ? n.flatMap((i) => [`--${s}-a${i}`, `--${s}A${i}`])
        : n.flatMap((i) => [`--${s}-${i}`, `--${s}-a${i}`, `--${s}A${i}`]),
    );
    const steps = names()["steps"];
    const listed = new Set(Array.isArray(steps) ? steps : []);
    expect({
      scales: ["slate", "indigo", "grass", "amber", "red", "black", "white"].filter((s) => !scales.includes(s)),
      missing: want.filter((step) => !listed.has(step)),
    }).toEqual({ scales: [], missing: [] });
  });

  it("names no token of ours as a step", () => {
    const steps = names()["steps"];
    const listed = new Set(Array.isArray(steps) ? steps : []);
    expect(declarationsIn(TOKENS_CSS()).filter(([name]) => listed.has(name))).toEqual([]);
  });
});

// ---- the build as a program --------------------------------------------------------------------

describe("the build checks the package as it stands", () => {
  it("passes --check on the package: every file decodes, every floor holds, nothing drifted", () => {
    expect(run("--check")).toEqual({ code: 0, said: expect.any(String) });
  });

  it("passes --check on an untouched copy, so a planted bug below fails for its own reason", () => {
    expect(check(copy()).code).toBe(0);
  });
});

/** Set one look of a token file's colors. */
const look =
  (key: "dark" | "light" | "extends", value: unknown) =>
  (t: Table): void => {
    tableIn(t, "colors")[key] = value;
  };

const without =
  (...keys: readonly string[]) =>
  (t: Table): void => {
    for (const key of keys) {
      delete t[key];
    }
  };

const with_ =
  (key: string, value: unknown) =>
  (t: Table): void => {
    t[key] = value;
  };

/** A planted bug: what it is, the token file it is in, the change, and the field its error names. */
const BAD: readonly (readonly [string, string, (t: Table) => void, RegExp])[] = [
  ["a step past 12", "text-faint", look("dark", "slate.13"), /dark/],
  ["a misspelled scale", "text-faint", look("dark", "slaet.a11"), /dark/],
  ["a text token with no floor", "text-faint", without("floor"), /floor/],
  ["a floor that is no WCAG number", "text-faint", with_("floor", 4), /floor/],
  ["a hex with no bend", "surface-sunken", look("dark", { hex: "#0c0d0e" }), /bend/],
  ["an unknown key", "text-faint", with_("colour", "red"), /colour/],
  ["a type outside the closed set", "text-faint", with_("type", "fill"), /type/],
  ["a tier outside the four", "text-faint", with_("tier", "semantic"), /tier/],
  ["a token that extends itself", "closed", look("extends", "closed"), /extends/],
  ["an extends that names no token", "closed", look("extends", "txet-faint"), /extends/],
  ["an on that names no token", "text-faint", with_("on", ["surface", "srface"]), /\bon\b/],
  ["an owner parts.toml does not name", "tile-edge-on", with_("owner", "tlie"), /owner/],
  ["focus with no floor", "focus", without("floor"), /floor|carries/],
  ["a border with no floor and no carries", "border-strong", without("floor", "carries"), /floor|carries/],
  ["a translucent value with no backdrop", "surface-hover", without("on"), /\bon\b/],
  ["text-faint dark at slate a10, under its floor", "text-faint", look("dark", "slate.a10"), /floor/],
  [
    "an exception at a ratio it does not have",
    "turn-fg",
    with_("except", [{ on: "turn-fill-hover", look: "dark", ratio: 4.27, ticket: 153, why: "kept" }]),
    /ratio/,
  ],
  [
    "an exception with no ticket",
    "turn-fg",
    with_("except", [{ on: "turn-fill-hover", look: "dark", ratio: 4.28, why: "kept" }]),
    /ticket/,
  ],
  ["the 4.28 pair with no exception", "turn-fg", without("except"), /floor/],
  ["a background that says it carries nothing", "turn-fill", with_("carries", "nothing"), /carries/],
];

// The build is run in write mode here, so a drift between the copy's generated files and its TOML
// cannot be what fails it: only the planted bug can.
describe("a bad token file fails the build, naming its file and field", () => {
  it.each(BAD)("%s (in %s.toml)", async (_what, token, change, field) => {
    const dir = copy();
    await edit(dir, token, change);
    const { code, said } = run("--root", dir);
    expect({ code, file: said.includes(`${token}.toml`), field: field.test(said) }).toEqual({
      code: 1,
      file: true,
      field: true,
    });
  });

  it("fails on a cycle of two: tile-text extends tile-text-on, which extends tile-text", async () => {
    const dir = copy();
    await edit(dir, "tile-text", look("extends", "tile-text-on"));
    await edit(dir, "tile-text-on", look("extends", "tile-text"));
    const { code, said } = run("--root", dir);
    expect({ code, named: /tile-text(-on)?\.toml/.test(said) }).toEqual({ code: 1, named: true });
  });

  it("fails for any text token whose dark step is a low alpha, under 4.5:1", async () => {
    const token = fc.constantFrom("text-faint", "text-primary");
    const step = fc.integer({ min: 1, max: 7 }).map((i) => `slate.a${i}`);
    await fc.assert(
      fc.asyncProperty(token, step, async (name, value) => {
        const dir = copy();
        await edit(dir, name, look("dark", value));
        const { code, said } = run("--root", dir);
        expect({ code, file: said.includes(`${name}.toml`) }).toEqual({ code: 1, file: true });
      }),
      { seed: 119120, numRuns: 5 },
    );
  });
});

describe("a floor fails the build; an aim only prints", () => {
  // text-faint reads 5.87 on the light ground: over its 4.5 floor, under 7.
  it("prints an aim of 7 that text-faint misses in light, and passes", async () => {
    const dir = copy();
    await edit(dir, "text-faint", with_("aim", 7));
    const { code, said } = run("--root", dir);
    expect({ code, named: said.includes("text-faint") }).toEqual({ code: 0, named: true });
  });

  it("fails on a floor of 7 that text-faint misses in light", async () => {
    const dir = copy();
    await edit(dir, "text-faint", with_("floor", 7));
    const { code, said } = run("--root", dir);
    expect({ code, file: said.includes("text-faint.toml") }).toEqual({ code: 1, file: true });
  });
});

// In write mode too: a name written twice would also drift token-names.json, which is not the law.
// No decided note gives a background a floor, so none is required (turn-fill keeps law 7's 3:1).
describe("a background token needs no floor", () => {
  it("passes with turn-fill's on and floor taken out", async () => {
    const dir = copy();
    await edit(dir, "turn-fill", without("on", "floor"));
    expect(run("--root", dir).code).toBe(0);
  });
});

describe("manti.toml sets Manti's tokens from ours", () => {
  const plantManti = (line: string) => (dir: string) => {
    const path = join(dir, "tokens", "manti.toml");
    writeFileSync(path, `${line}\n${readFileSync(path, "utf8")}`);
  };

  it("fails on a token of ours written again in manti.toml, naming it", () => {
    const dir = copy();
    plantManti('"--surface" = "--surface-raised"')(dir);
    const { code, said } = run("--root", dir);
    expect({ code, file: said.includes("manti.toml"), named: said.includes("--surface") }).toEqual({
      code: 1,
      file: true,
      named: true,
    });
  });

  it("fails on a --manti-* written again in another case", () => {
    const dir = copy();
    plantManti('"--manti-BG" = "--surface"')(dir);
    const { code, said } = run("--root", dir);
    expect({ code, file: said.includes("manti.toml") }).toEqual({ code: 1, file: true });
  });

  it("fails on a hex as a plain value", () => {
    const dir = copy();
    plantManti('"--manti-shadow" = { value = "#000000", why = "a shadow" }')(dir);
    const { code, said } = run("--root", dir);
    expect({
      code,
      file: said.includes("manti.toml"),
      named: said.includes("--manti-shadow"),
    }).toEqual({ code: 1, file: true, named: true });
  });

  it("fails on a name that is none of ours", () => {
    const dir = copy();
    plantManti('"--manti-ring" = "--fokus"')(dir);
    const { code, said } = run("--root", dir);
    expect({ code, named: said.includes("--fokus") }).toEqual({ code: 1, named: true });
  });
});

describe("a token name appears once, case folded", () => {
  it("fails on a TOML token written again by hand in tokens.css", () => {
    const dir = copy();
    writeByHand(dir, "--surface: 1px;");
    const { code, said } = run("--root", dir);
    expect({ code, named: said.includes("--surface") }).toEqual({ code: 1, named: true });
  });

  it("fails on a TOML token written again in another case in tokens.css", () => {
    const dir = copy();
    writeByHand(dir, "--Focus: 2px;");
    const { code, said } = run("--root", dir);
    expect({ code, named: /--focus/i.test(said) }).toEqual({ code: 1, named: true });
  });

  // macOS's file system folds case, so two such files cannot exist side by side there; CI's can.
  const folds = (() => {
    const probe = mkdtempSync(join(tmpdir(), "fab-case-"));
    writeFileSync(join(probe, "a"), "");
    const folded = existsSync(join(probe, "A"));
    rmSync(probe, { recursive: true, force: true });
    return folded;
  })();

  it.skipIf(folds)("fails on Focus.toml beside focus.toml", () => {
    const dir = copy();
    cpSync(join(dir, "tokens", "color", "focus.toml"), join(dir, "tokens", "color", "Focus.toml"));
    const { code, said } = run("--root", dir);
    expect({ code, named: said.includes("Focus.toml") }).toEqual({ code: 1, named: true });
  });
});

describe("the generated files equal what the TOML gives", () => {
  const editCss = (dir: string) => {
    const path = join(dir, "src", "tokens.css");
    const css = readFileSync(path, "utf8");
    const edited = css.replace(/(\t--surface: )[^;]+;/, "$1light-dark(#ffffff, #000000);");

    if (edited === css) {
      throw new Error("no --surface line to edit");
    }

    writeFileSync(path, edited);
  };

  it("fails --check on --surface edited by hand in tokens.css, naming it", () => {
    const dir = copy();
    editCss(dir);
    const { code, said } = check(dir);
    expect({ code, named: said.includes("--surface") }).toEqual({ code: 1, named: true });
  });

  it("fails --check on a theme color edited by hand in theme-colors.ts", () => {
    const dir = copy();
    const path = join(dir, "src", "theme-colors.ts");
    const ts = readFileSync(path, "utf8");
    const edited = ts.replace("#dfebfd6d", "#d9edff5d");

    if (edited === ts) {
      throw new Error("no dark focus in theme-colors.ts");
    }

    writeFileSync(path, edited);
    expect(check(dir).code).toBe(1);
  });

  it("fails --check on a token-names.json with a name taken out", () => {
    const dir = copy();
    const path = join(dir, "src", "token-names.json");
    const json = readFileSync(path, "utf8");
    const edited = json.replace(/"--tile-edge-on"/, '"--tile-edge-of"');

    if (edited === json) {
      throw new Error("no --tile-edge-on in token-names.json");
    }

    writeFileSync(path, edited);
    expect(check(dir).code).toBe(1);
  });

  it("fails --check on a step changed in a TOML file, until the build writes it", async () => {
    const dir = copy();
    await edit(dir, "surface-raised", look("light", "slate.2"));
    const before = check(dir).code;
    const written = run("--root", dir).code;
    expect({ before, written, after: check(dir).code }).toEqual({ before: 1, written: 0, after: 0 });
  });

  it("writes back a hand edit, leaving the hand-written part as it was", () => {
    const dir = copy();
    const path = join(dir, "src", "tokens.css");
    editCss(dir);
    writeByHand(dir, "--extra-room: 2px;");
    const handBefore = readFileSync(path, "utf8").includes("--extra-room: 2px;");
    const written = run("--root", dir).code;
    const after = readFileSync(path, "utf8");
    expect({
      handBefore,
      written,
      kept: after.includes("--extra-room: 2px;"),
      same: after.replace("\t--extra-room: 2px;\n", ""),
    }).toEqual({ handBefore: true, written: 0, kept: true, same: TOKENS_CSS() });
  });
});

describe("the build's edges", () => {
  it("draws white alpha, as black alpha, the same in both looks", async () => {
    const dir = copy();
    await edit(dir, "scrim", look("dark", "white.a8"));
    const code = run("--root", dir).code;
    const line = readFileSync(join(dir, "src", "tokens.css"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("\t--scrim:"));
    expect({ code, line }).toEqual({
      code: 0,
      line: expect.stringMatching(/^\t--scrim: light-dark\(#000000[0-9a-f]{2}, #ffffff[0-9a-f]{2}\);/),
    });
  });

  it("writes an icon token under the owner's icons", async () => {
    const dir = copy();
    await edit(dir, "focus", with_("type", "icon"));
    const code = run("--root", dir).code;
    const css = readFileSync(join(dir, "src", "tokens.css"), "utf8");
    expect({ code, heading: css.includes("\t/* The design's icons. */\n\t--focus:") }).toEqual({
      code: 0,
      heading: true,
    });
  });

  it("fails --check on a file in tokens/color that is not a .toml, naming it", () => {
    const dir = copy();
    writeFileSync(join(dir, "tokens", "color", "notes.txt"), 'type = "text"\n');
    const { code, said } = check(dir);
    expect({ code, named: said.includes("notes.txt: name: a token file is <token>.toml") }).toEqual({
      code: 1,
      named: true,
    });
  });

  it("stops clean on a parts.toml that does not decode, with no stack trace", () => {
    const dir = copy();
    writeFileSync(join(dir, "tokens", "parts.toml"), '[tile]\ndescription = ""\n');
    const { code, said } = check(dir);
    expect({ code, file: said.includes("parts.toml"), trace: /\n\s+at |Error:/.test(said) }).toEqual({
      code: 1,
      file: true,
      trace: false,
    });
  });

  const cssOf = (dir: string) => join(dir, "src", "tokens.css");
  const OPEN = "/* @generated colors from tokens/color by pnpm tokens: edit the TOML, never this */";
  const CLOSE = "/* @end generated colors */";

  it("fails --check on a region whose closing comment comes before its opening one", () => {
    const dir = copy();
    const css = readFileSync(cssOf(dir), "utf8");

    if (!css.includes(OPEN) || !css.includes(CLOSE)) {
      throw new Error("no colors region");
    }

    writeFileSync(cssOf(dir), css.replace(OPEN, "@@open@@").replace(CLOSE, OPEN).replace("@@open@@", CLOSE));
    const { code, said } = check(dir);
    expect({ code, said: said.includes("@generated colors: closes before it opens") }).toEqual({
      code: 1,
      said: true,
    });
  });

  it("checks clean with the manti region written before the colors region", () => {
    const dir = copy();
    const css = readFileSync(cssOf(dir), "utf8");
    const block = (name: string) => {
      const from = css.indexOf(`/* @generated ${name}`);
      const end = `/* @end generated ${name} */`;
      const to = css.indexOf(end) + end.length;

      if (from < 0 || to < end.length) {
        throw new Error(`no ${name} region`);
      }

      return { from, to, text: css.slice(from, to) };
    };
    const [colors, manti] = [block("colors"), block("manti")];
    const swapped =
      css.slice(0, colors.from) + manti.text + css.slice(colors.to, manti.from) + colors.text + css.slice(manti.to);
    writeFileSync(cssOf(dir), swapped);
    expect(check(dir)).toEqual({ code: 0, said: expect.any(String) });
  });

  it("names a value edited by hand with no space after its colon", () => {
    const dir = copy();
    const css = readFileSync(cssOf(dir), "utf8");
    const edited = css.replace(/\t--focus: [^;]+;/, "\t--focus:#ffffff;");

    if (edited === css) {
      throw new Error("no --focus line to edit");
    }

    writeFileSync(cssOf(dir), edited);
    const { code, said } = check(dir);
    expect({ code, named: said.includes("--focus is not what the TOML gives") }).toEqual({
      code: 1,
      named: true,
    });
  });

  // Spacing alone is no changed value: the file differs, and no token is named as wrong.
  it("calls a spacing-only edit a difference, not a changed value", () => {
    const dir = copy();
    const css = readFileSync(cssOf(dir), "utf8");
    const edited = css.replace(/\t--focus: /, "\t--focus:");

    if (edited === css) {
      throw new Error("no --focus line to edit");
    }

    writeFileSync(cssOf(dir), edited);
    const { code, said } = check(dir);
    expect({
      code,
      differs: said.includes("tokens.css: differs from what the TOML gives"),
      named: said.includes("--focus is not"),
    }).toEqual({ code: 1, differs: true, named: false });
  });
});
