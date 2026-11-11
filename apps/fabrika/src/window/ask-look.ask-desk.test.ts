import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's version. Round 4 of the ask desk's tests, from the shots' fix list (askdesk-review.md,
// S2, S10) and review 6: what window.css decides for the shared ask view, read as the browser's
// cascade reads it. Manti's own stylesheet sits in @layer, so any rule of window.css that matches
// a Manti button beats it, whatever its specificity: that is how `.view button` turned Take rec
// into plain text in a ticket, and the plain `button` rule turned it into a filled box in the asks
// menu. A small cascade below: top-level rules only (no @media), descendant and child combinators,
// classes, ids, attributes and the focus pseudo-classes. A selector it cannot read never matches.
// How a thing looks in the end is still the shots' job.

const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8");

// ---- elements: one chain from the root to the element, each with what selectors read

type El = {
  readonly tag: string;
  readonly id?: string;
  readonly classes?: readonly string[];
  readonly attrs?: Readonly<Record<string, string>>;
  readonly focus?: boolean;
  readonly focusVisible?: boolean;
  readonly empty?: boolean;
};

type Chain = readonly El[];

// ---- the stylesheet's top-level rules

type Decl = { readonly name: string; readonly value: string; readonly important: boolean };
type Rule = { readonly selectors: readonly string[]; readonly decls: readonly Decl[] };

const rulesOf = (css: string): readonly Rule[] => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf("{", i);

    if (open < 0) {
      break;
    }

    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;

    for (; j < text.length && depth > 0; j++) {
      if (text[j] === "{") {
        depth++;
      }

      if (text[j] === "}") {
        depth--;
      }
    }

    const body = text.slice(open + 1, j - 1);
    i = j;

    if (prelude.startsWith("@") || body.includes("{")) {
      continue;
    }

    const decls = body
      .split(";")
      .map((d) => {
        const at = d.indexOf(":");
        const raw = d.slice(at + 1).trim();
        return {
          name: d.slice(0, at).trim(),
          value: raw.replace(/\s*!important$/, "").replace(/\s+/g, " "),
          important: /!important$/.test(raw),
        };
      })
      .filter((d) => d.name !== "" && !d.name.startsWith("--"));
    rules.push({ selectors: splitTop(prelude, ","), decls });
  }

  return rules;
};

/** Split at `by` where no bracket or paren is open. */
const splitTop = (text: string, by: string): readonly string[] => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;

  for (let k = 0; k < text.length; k++) {
    const c = text[k];

    if (c === "(" || c === "[") {
      depth++;
    }

    if (c === ")" || c === "]") {
      depth--;
    }

    if (c === by && depth === 0) {
      out.push(text.slice(from, k).trim());
      from = k + 1;
    }
  }

  out.push(text.slice(from).trim());
  return out.filter((s) => s !== "");
};

// ---- selectors

type Spec = readonly [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const more = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const NONE: Spec = [0, 0, 0];
type Simple = { readonly matches: (chain: Chain, at: number) => boolean; readonly spec: Spec };
type Part = { readonly simples: readonly Simple[]; readonly combinator: " " | ">" | "+" | "~" };

const SIMPLE = /^(\*|[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]|::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?)/;

const compound = (text: string): readonly Simple[] | null => {
  const simples: Simple[] = [];
  let rest = text;

  while (rest !== "") {
    const m = SIMPLE.exec(rest);

    if (m === null) {
      return null;
    }

    const s = simpleOf(m[0]);

    if (s === null) {
      return null;
    }

    simples.push(s);
    rest = rest.slice(m[0].length);
  }

  return simples;
};

const simpleOf = (token: string): Simple | null => {
  const el = (chain: Chain, at: number): El => chain[at] as El;

  if (token === "*") {
    return { matches: () => true, spec: NONE };
  }

  if (token.startsWith("::")) {
    return null;
  }

  if (token.startsWith(".")) {
    return {
      matches: (c, at) => (el(c, at).classes ?? []).includes(token.slice(1)),
      spec: [0, 1, 0],
    };
  }

  if (token.startsWith("#")) {
    return { matches: (c, at) => el(c, at).id === token.slice(1), spec: [1, 0, 0] };
  }

  if (token.startsWith("[")) {
    const m = /^\[([\w-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]$/.exec(token);

    if (m === null) {
      return null;
    }

    const [, name = "", op, want = ""] = m;
    return {
      matches: (c, at) => {
        const has = el(c, at).attrs?.[name];

        if (has === undefined) {
          return false;
        }

        if (op === undefined) {
          return true;
        }

        if (op === "=") {
          return has === want;
        }

        if (op === "~=") {
          return has.split(/\s+/).includes(want);
        }

        return false;
      },
      spec: [0, 1, 0],
    };
  }

  if (token.startsWith(":")) {
    const m = /^:([\w-]+)(?:\((.*)\))?$/.exec(token);

    if (m === null) {
      return null;
    }

    const [, name = "", arg] = m;

    if (name === "focus") {
      return { matches: (c, at) => el(c, at).focus === true, spec: [0, 1, 0] };
    }

    if (name === "focus-visible") {
      return { matches: (c, at) => el(c, at).focusVisible === true, spec: [0, 1, 0] };
    }

    if (name === "focus-within") {
      return {
        matches: (c, at) => c.slice(at).some((e) => e.focus === true),
        spec: [0, 1, 0],
      };
    }

    if (name === "empty") {
      return { matches: (c, at) => el(c, at).empty === true, spec: [0, 1, 0] };
    }

    if (name === "root") {
      return { matches: (_c, at) => at === 0, spec: [0, 1, 0] };
    }

    if ((name === "not" || name === "is" || name === "where") && arg !== undefined) {
      const list = splitTop(arg, ",").map(selectorOf);

      if (list.some((s) => s === null)) {
        return null;
      }

      const read = list as readonly Selector[];
      const spec = name === "where" ? NONE : read.reduce<Spec>((a, s) => (more(s.spec, a) > 0 ? s.spec : a), NONE);
      const any = (c: Chain, at: number) => read.some((s) => s.matches(c.slice(0, at + 1)));
      return { matches: name === "not" ? (c, at) => !any(c, at) : any, spec };
    }

    // Hover, active, disabled and the rest: the element in these checks is in none of them.
    return { matches: () => false, spec: [0, 1, 0] };
  }

  return { matches: (c, at) => el(c, at).tag === token.toLowerCase(), spec: [0, 0, 1] };
};

type Selector = { readonly matches: (chain: Chain) => boolean; readonly spec: Spec };

const selectorOf = (text: string): Selector | null => {
  const tokens = text
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .trim()
    .split(/\s+/);
  const parts: Part[] = [];
  let combinator: Part["combinator"] = " ";

  for (const token of tokens) {
    if (token === ">" || token === "+" || token === "~") {
      combinator = token;
      continue;
    }

    const simples = compound(token);

    if (simples === null) {
      return null;
    }

    parts.push({ simples, combinator });
    combinator = " ";
  }

  if (parts.length === 0) {
    return null;
  }

  const spec = parts.flatMap((p) => p.simples).reduce<Spec>((a, s) => add(a, s.spec), NONE);
  const fits = (part: Part, chain: Chain, at: number) => part.simples.every((s) => s.matches(chain, at));
  const from = (chain: Chain, k: number, at: number): boolean => {
    const part = parts[k] as Part;

    if (!fits(part, chain, at)) {
      return false;
    }

    if (k === 0) {
      return true;
    }

    if (part.combinator === ">") {
      return at > 0 && from(chain, k - 1, at - 1);
    }

    if (part.combinator === " ") {
      for (let up = at - 1; up >= 0; up--) {
        if (from(chain, k - 1, up)) {
          return true;
        }
      }
    }

    return false;
  };
  return { matches: (chain) => from(chain, parts.length - 1, chain.length - 1), spec };
};

// ---- the cascade, for one group of properties

const RULES = rulesOf(CSS);

const READ = RULES.map((rule, order) => ({
  order,
  decls: rule.decls,
  selectors: rule.selectors.map(selectorOf).filter((s): s is Selector => s !== null),
}));

/** The winning declaration of window.css among `names` for the element at the chain's end. */
const winner = (chain: Chain, names: RegExp): Decl | null => {
  let best: { decl: Decl; spec: Spec; order: number; at: number } | null = null;

  for (const rule of READ) {
    const hit = rule.selectors.filter((s) => s.matches(chain));

    if (hit.length === 0) {
      continue;
    }

    const spec = hit.reduce<Spec>((a, s) => (more(s.spec, a) > 0 ? s.spec : a), NONE);
    rule.decls.forEach((decl, at) => {
      if (!names.test(decl.name)) {
        return;
      }

      const wins =
        best === null ||
        (decl.important && !best.decl.important) ||
        (decl.important === best.decl.important &&
          (more(spec, best.spec) > 0 ||
            (more(spec, best.spec) === 0 && (rule.order > best.order || (rule.order === best.order && at > best.at)))));

      if (wins) {
        best = { decl, spec, order: rule.order, at };
      }
    });
  }

  return best === null ? null : (best as { decl: Decl }).decl;
};

// ---- the places the shared ask view is drawn

const ROOT: Chain = [{ tag: "html" }, { tag: "body" }];

const CARD: El = {
  tag: "section",
  classes: ["ask-view"],
  attrs: {
    "aria-label": "ask: Do you approve plan version 2?",
    tabindex: "-1",
    "aria-busy": "false",
  },
};

const PLACES: Readonly<Record<string, Chain>> = {
  ticket: [
    ...ROOT,
    { tag: "main", classes: ["program"] },
    { tag: "div", classes: ["view", "ticket-view"] },
    { tag: "div", classes: ["tkv"] },
    { tag: "div", classes: ["tk-main"] },
    { tag: "div", classes: ["tk-col"] },
  ],
  tracker: [
    ...ROOT,
    { tag: "main", classes: ["program"] },
    { tag: "section", classes: ["tracker"], attrs: { "aria-label": "tracker" } },
    { tag: "div", classes: ["tracker-column"] },
  ],
  menu: [
    ...ROOT,
    {
      tag: "div",
      id: "pop-asks",
      classes: ["pop", "panel"],
      attrs: { role: "dialog", "aria-label": "Asks", tabindex: "-1", "data-over": "" },
    },
    { tag: "div", attrs: { role: "grid", "aria-label": "Waiting asks", tabindex: "0" } },
    { tag: "div", classes: ["asks-row"], attrs: { role: "row", "aria-selected": "true" } },
    { tag: "div", attrs: { role: "gridcell" } },
  ],
};

const manti = (variant: string, more: Record<string, string> = {}): El => ({
  tag: "button",
  attrs: {
    type: "button",
    "data-variant": variant,
    "data-size": "sm",
    "data-scope": "button",
    "data-part": "root",
    ...more,
  },
});

const BUTTONS: Readonly<Record<string, readonly El[]>> = {
  "Take rec": [{ tag: "div", classes: ["ask-toolbar"], attrs: { role: "toolbar" } }, manti("primary")],
  "Not the rec": [{ tag: "div", classes: ["ask-toolbar"], attrs: { role: "toolbar" } }, manti("tertiary")],
  "Needed me": [{ tag: "div", classes: ["ask-marks"] }, manti("tertiary", { "aria-pressed": "true" })],
  "Every pick's row": [{ tag: "div", classes: ["ask-picks"] }, manti("tertiary")],
};

const LOOK = {
  background: /^background(-color|-image)?$/,
  padding: /^padding(-(inline|block|top|right|bottom|left)(-(start|end))?)?$/,
  border: /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-(width|style|color))?$/,
  color: /^color$/,
  corners: /radius$/,
};

const stylesHold = (check: (state: { focus: boolean; focusVisible: boolean }) => void) =>
  fc.assert(
    fc.property(
      fc.record({ focus: fc.boolean(), focusVisible: fc.boolean() }).filter((s) => !s.focusVisible || s.focus),
      check,
    ),
    { seed: 119120 },
  );

describe("shot S2: one button look for the ask's actions, in the menu and in a window", () => {
  const pairs = ["ticket", "tracker"].flatMap((place) =>
    Object.keys(BUTTONS).map((button) => [button, place] as const),
  );
  it.each(pairs)("%s gets the same rules in the %s as in the asks menu", (button, place) => {
    stylesHold((state) => {
      const under = BUTTONS[button] as readonly El[];
      const there = [...(PLACES[place] as Chain), { ...CARD, ...state }, ...under];
      const menu = [...(PLACES.menu as Chain), { ...CARD, ...state }, ...under];

      for (const [what, names] of Object.entries(LOOK)) {
        expect(winner(there, names)?.value ?? "Manti's", `${what} of ${button}`).toBe(
          winner(menu, names)?.value ?? "Manti's",
        );
      }
    });
  });
  // Only Take rec is indigo (the plan's "What the person sees"): Manti's primary fill, or the
  // app's own name for indigo 9 (`--key`), never stripped and never the gray of a plain button.
  it.each(Object.keys(PLACES))("Take rec keeps its indigo fill in the %s", (place) => {
    stylesHold((state) => {
      const chain = [...(PLACES[place] as Chain), { ...CARD, ...state }, ...(BUTTONS["Take rec"] as readonly El[])];
      const fill = winner(chain, LOOK.background)?.value ?? "Manti's";
      expect(fill).toMatch(/^Manti's$|indigo|--key\b|--accent/);
    });
  });
});

const CORNERS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;

describe("shot S10: the card keeps its 8px corners, focused or not", () => {
  it.each(Object.keys(PLACES))("in the %s", (place) => {
    stylesHold((generated) => {
      const chain = PLACES[place] as Chain;

      // pinned: shot S10's square card on focus; the three fixed states run beside the generated one.
      for (const state of [{}, { focus: true }, { focus: true, focusVisible: true }, generated]) {
        const radius = winner([...chain, { ...CARD, ...state }], CORNERS)?.value;
        expect(["var(--r-lg)", "8px"], `${JSON.stringify(state)}: ${radius}`).toContain(radius);
      }
    });
  });
});

describe("ask desk review 6: no rule hides an empty status region", () => {
  const STATUS: El = {
    tag: "p",
    attrs: { role: "status", "aria-live": "polite" },
    empty: true,
  };
  it.each(Object.keys(PLACES))("in the %s, in the ask view or beside it", (place) => {
    stylesHold((state) => {
      const chain = PLACES[place] as Chain;

      for (const where of [
        [...chain, { ...STATUS, ...state }],
        [...chain, CARD, { ...STATUS, ...state }],
      ]) {
        expect(winner(where, /^display$/)?.value).not.toBe("none");
      }
    });
  });
});

describe("the cascade above reads window.css as a browser does", () => {
  // pinned: round 4, shot S2's .view-button-fill bug. This reproduces the old selector clash.
  it("pinned: reads the rules it needs, and a plain view button loses its fill to `.view button`", () => {
    expect(READ.length).toBeGreaterThan(100);
    const plain = [...(PLACES.ticket as Chain), { tag: "button" }];
    expect(winner(plain, LOOK.background)?.value).toBe("none");
    expect(winner([...ROOT, { tag: "button" }], LOOK.background)?.value).toBe("var(--line)");
  });
});
