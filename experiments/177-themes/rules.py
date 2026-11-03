"""The rules of docs/direction/themes.md, run on the files this experiment kept.

    python3 -I experiments/177-themes/rules.py

Reads `schemes/` beside this file and nothing else: no network, no key, $0, about 40 seconds
on a laptop (most of it the 300 picks).
Prints JSON with every number the note uses. Plain Python 3, standard library only.
"""

import json
import math
import os
import re

SCHEMES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schemes")
RADIX = json.load(open(f"{SCHEMES}/radix-colors-3.0.0.json"))["scales"]
GRAYS = {"gray", "mauve", "slate", "sage", "olive", "sand"}
ACCENTS = sorted(k for k in RADIX if k not in GRAYS)
PIPES = ["sky", "pink", "teal", "violet", "lime", "plum"]  # docs/direction/pipe-colors.md
STATES = {"done": "grass", "running": "amber", "stuck": "red"}

# ---- color math -------------------------------------------------------------------------


def rgba(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def hexof(r, g, b):
    return "#" + "".join(f"{round(min(1, max(0, x)) * 255):02x}" for x in (r, g, b))


def over(top, bottom):
    """An alpha color composited over a solid one, as the page draws it."""
    r, g, b, a = rgba(top)
    R, G, B, _ = rgba(bottom)
    return hexof(r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a))


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def unlin(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def lum(h):
    r, g, b, _ = rgba(h)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def oklch(h):
    r, g, b, _ = rgba(h)
    r, g, b = lin(r), lin(g), lin(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(A, B), math.atan2(B, A)


def fromlch(L, C, H):
    A, B = C * math.cos(H), C * math.sin(H)
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return hexof(*(unlin(max(0, x)) for x in (r, g, b)))


def mix(a, b, t):
    """The study's mix: OKLCH, the short way round the hue."""
    La, Ca, Ha = oklch(a)
    Lb, Cb, Hb = oklch(b)
    turn = math.atan2(math.sin(Hb - Ha), math.cos(Hb - Ha))
    return fromlch(min(1, max(0, La + (Lb - La) * t)), max(0, Ca + (Cb - Ca) * t), Ha + turn * t)


def hue_deg(h):
    return math.degrees(oklch(h)[2]) % 360


def hue_gap(a, b):
    d = abs(hue_deg(a) - hue_deg(b)) % 360
    return min(d, 360 - d)


# ---- Radix ------------------------------------------------------------------------------


def step(scale, look, n, alpha=False):
    return RADIX[scale][look + ("A" if alpha else "")][n - 1]


def pick(gray, accent, look):
    """A Radix pick as the picker first makes it, before repair: every value a step, but the dark desk."""
    g = lambda n, a=False: (gray, n, a)
    c = lambda s, n: (s, n, False)
    colors = {
        "desk": "#0c0d0e" if look == "dark" else g(2),
        "ground": g(1),
        "raised": g(2) if look == "dark" else g(1),
        "hover": g(3, True),
        "edge": g(4, True),
        "focus": g(8, True),
        "text": g(12),
        "faint": g(11, True),
        "turn": c(accent, 9),
        "on-turn": "#ffffff",
        "turn-text": c(accent, 11),
        "done": c("grass", 11),
        "running": c("amber", 11),
        "stuck": c("red", 11),
        "closed": g(11, True),
    }
    # The terminal. Black (0) in dark, and the two whites (7, 15) in light, sit near the background
    # on purpose: programs paint fills with them. Every other color reads 4.5:1 as text.
    if look == "dark":
        pal = [g(3), c("red", 9), c("grass", 9), c("amber", 9), c("blue", 9), c("purple", 11), c("cyan", 9), g(12), g(11), c("red", 11), c("grass", 11), c("amber", 11), c("blue", 11), c("purple", 11), c("cyan", 11), g(12)]
    else:
        pal = [g(12), c("red", 11), c("grass", 11), c("amber", 12), c("blue", 11), c("purple", 11), c("cyan", 11), g(8), g(11), c("red", 11), c("grass", 11), c("amber", 12), c("blue", 11), c("purple", 9), c("cyan", 11), g(7)]
    return {"look": look, "radix": True, "colors": colors, "palette": pal, "fg": g(12), "bg": g(1), "cursor": g(12)}


def val(x, look):
    """A color as a hex: a Radix step (scale, n, alpha) or a plain hex."""
    if isinstance(x, tuple):
        s, n, a = x
        return step(s, look, n, a)
    return x


# ---- mapping a shared file --------------------------------------------------------------

def builtin(look):
    """`fabrika` and `fabrika-light` as they ship: the slate and indigo pick, with the steps repair
    would take already written in (light: amber 12 for running, slate a9 for focus)."""
    t = pick("slate", "indigo", look)
    if look == "light":
        t["colors"]["running"] = ("amber", 12, False)
        t["colors"]["focus"] = ("slate", 9, True)
    return t


DEFAULT = {"dark": builtin("dark"), "light": builtin("light")}
FILL = {"dark": {0}, "light": {7, 15}}  # palette colors meant as fills in the built-ins


def fractions(look):
    """Where each gray role sits between the default's ground (0) and its text (1), in OKLCH L."""
    d = DEFAULT[look]
    ground = val(d["colors"]["ground"], look)
    text = val(d["colors"]["text"], look)
    L0, L1 = oklch(ground)[0], oklch(text)[0]
    out = {}
    for role in ["desk", "raised", "hover", "edge", "focus", "faint"]:
        v = over(val(d["colors"][role], look), ground)
        out[role] = (oklch(v)[0] - L0) / (L1 - L0)
    return out


def read_tinted(path):
    text = open(path).read()
    base = {k.lower(): "#" + v.lower() for k, v in re.findall(r"(base[0-9A-Fa-f]{2}):\s*\"?#?([0-9A-Fa-f]{6})", text)}
    look = "light" if re.search(r'variant:\s*"?light', text) else "dark"
    bright = lambda k, plain: base.get(k, base[plain])
    pal = [base["base00"], base["base08"], base["base0b"], base["base0a"], base["base0d"], base["base0e"], base["base0c"], base["base05"], base["base03"], bright("base12", "base08"), bright("base14", "base0b"), bright("base13", "base0a"), bright("base16", "base0d"), bright("base17", "base0e"), bright("base15", "base0c"), base["base07"]]
    return {"look": look, "bg": base["base00"], "fg": base["base05"], "blue": base["base0d"], "green": base["base0b"], "yellow": base["base0a"], "red": base["base08"], "palette": pal, "cursor": base["base05"]}


def read_ghostty(path, look):
    text = open(path).read()
    pal = {int(i): "#" + h.lower() for i, h in re.findall(r"^palette\s*=\s*(\d+)=#?([0-9a-fA-F]{6})", text, re.M)}
    keys = {k: "#" + h.lower() for k, h in re.findall(r"^([a-z-]+)\s*=\s*#?([0-9a-fA-F]{6})\s*$", text, re.M)}
    p = [pal[i] for i in range(16)]
    return {"look": look, "bg": keys["background"], "fg": keys["foreground"], "blue": p[4], "green": p[2], "yellow": p[3], "red": p[1], "palette": p, "cursor": keys.get("cursor-color", keys["foreground"])}


def mapped(f):
    """A shared file to the note's names: grays from its background and foreground, states from its hues."""
    look = f["look"]
    fr = fractions(look)
    bg, fg = f["bg"], f["fg"]
    colors = {"ground": bg, "text": fg}
    for role, t in fr.items():
        colors[role] = mix(bg, fg, t)
    colors["turn"] = f["blue"]
    colors["turn-text"] = f["blue"]
    colors["on-turn"] = "#ffffff" if contrast("#ffffff", f["blue"]) >= contrast("#000000", f["blue"]) else "#000000"
    colors["done"], colors["running"], colors["stuck"] = f["green"], f["yellow"], f["red"]
    colors["closed"] = colors["faint"]
    return {"look": look, "radix": False, "colors": colors, "palette": list(f["palette"]), "fg": fg, "bg": bg, "cursor": f["cursor"]}


# ---- the checks and repair --------------------------------------------------------------

TEXT = ["text", "faint", "turn-text", "done", "running", "stuck", "closed"]  # 4.5:1 on desk, ground, raised


def lightness_move(color, bg, least):
    """The spike's move: lightness only, away from the background first, then black or white."""
    if contrast(color, bg) >= least:
        return color
    L, C, H = oklch(color)
    away = -1 if oklch(bg)[0] > 0.6 else 1
    for way in (away, -away):
        l = L
        while 0 <= l <= 1:
            tried = fromlch(l, C, H)
            if contrast(tried, bg) >= least:
                return tried
            l += way * 0.005
    return "#000000" if contrast("#000000", bg) > contrast("#ffffff", bg) else "#ffffff"


def worst(color, bgs):
    return min(contrast(over(color, b), b) for b in bgs)


def repair(theme):
    look = theme["look"]
    c = dict(theme["colors"])
    v = lambda r: val(c[r], look)
    moved, bends, report = [], [], {}
    bgs = lambda: [v("desk"), v("ground"), v("raised")]

    def fix(role, against, least):
        before = worst(v(role), against())
        report[role] = round(before, 2)
        names = {v("desk"): "desk", v("ground"): "ground", v("raised"): "raised"}
        report[role + "@"] = names.get(min(against(), key=lambda b: contrast(over(v(role), b), b)), "?")
        if before >= least:
            return
        was = v(role)
        x = c[role]
        if theme["radix"] and isinstance(x, tuple):
            s, n, a = x
            while n < 12 and worst(step(s, look, n, a), against()) < least:
                n += 1
            if worst(step(s, look, n, a), against()) >= least:
                c[role] = (s, n, a)
                moved.append({"role": role, "was": f"{s} {'a' if a else ''}{x[1]}", "now": f"{s} {'a' if a else ''}{n}", "before": round(before, 2), "after": round(worst(v(role), against()), 2)})
                return
        # a shared file, or a Radix step that ran out: lightness only, against the worst background
        cur = was if len(was.lstrip("#")) == 6 else over(was, against()[0])
        for _ in range(4):
            bad = min(against(), key=lambda b: contrast(cur, b))
            cur = lightness_move(cur, bad, least)
        c[role] = cur
        rec = {"role": role, "was": was, "now": cur, "before": round(before, 2), "after": round(worst(cur, against()), 2)}
        moved.append(rec)
        if theme["radix"]:
            bends.append(rec)

    for role in TEXT:
        fix(role, bgs, 4.5)
    fix("focus", lambda: [v("ground")], 3.0)  # 1.4.11: a needed state; drawn inside the tile
    fix("turn", lambda: [v("ground")], 3.0)  # the fill says "your turn"
    # on-turn: text on the fill. White or the dark gray, whichever reads; then move it.
    report["on-turn"] = round(contrast(v("on-turn"), v("turn")), 2)
    if contrast(v("on-turn"), v("turn")) < 4.5:
        was = v("on-turn")
        for cand in ["#ffffff", step("slate", "dark", 1)]:
            if contrast(cand, v("turn")) >= 4.5:
                c["on-turn"] = cand
                break
        else:
            c["on-turn"] = lightness_move(was, v("turn"), 4.5)
        moved.append({"role": "on-turn", "was": was, "now": v("on-turn"), "before": report["on-turn"], "after": round(contrast(v("on-turn"), v("turn")), 2)})
    edge = round(contrast(over(v("edge"), v("ground")), v("ground")), 2)

    # The terminal. The palette is never changed. Contrast is kept per cell when it is drawn, as
    # Ghostty's minimum-contrast does in its cell shader: each cell's text moves against that cell's
    # own background, and backgrounds never move. Every pair of the default colors and the 16 is a
    # cell some program can draw.
    bg = val(theme["bg"], look)
    fg = val(theme["fg"], look)
    pal = [val(p, look) for p in theme["palette"]]
    on_bg = [i for i, p in enumerate(pal) if contrast(p, bg) < 4.5]
    under3 = sum(contrast(p, bg) < 3 for p in pal)
    fgs = [("fg", fg)] + [(i, p) for i, p in enumerate(pal)]
    bgs_t = [("bg", bg)] + [(i, p) for i, p in enumerate(pal)]
    pairs = [(f, b) for f in fgs for b in bgs_t if f[0] != b[0]]
    under_pairs = [(f, b) for f, b in pairs if contrast(f[1], b[1]) < 4.5]
    after_pairs = [contrast(lightness_move(f[1], b[1], 4.5), b[1]) for f, b in under_pairs]
    cursor = round(contrast(val(theme["cursor"], look), bg), 2)
    cur_fixed = lightness_move(val(theme["cursor"], look), bg, 3.0)
    if cur_fixed != val(theme["cursor"], look):
        moved.append({"role": "cursor", "was": val(theme["cursor"], look), "now": cur_fixed, "before": cursor, "after": round(contrast(cur_fixed, bg), 2)})
    after_text = {r: round(worst(v(r), bgs()), 2) for r in TEXT}
    return {
        "look": look,
        "before": report,
        "moved": moved,
        "bends": bends,
        "edge_on_ground": edge,
        "after": {**after_text, "focus": round(worst(v("focus"), [v("ground")]), 2), "turn": round(contrast(v("turn"), v("ground")), 2), "on-turn": round(contrast(v("on-turn"), v("turn")), 2)},
        "colors": {r: v(r) for r in c},
        "steps": {r: (f"{x[0]} {'a' if x[2] else ''}{x[1]}" if isinstance(x, tuple) else "custom") for r, x in c.items()},
        "terminal": {
            "palette_changed": 0,
            "on_background_under_4_5": on_bg,
            "on_background_under_3": under3,
            "on_background_min_of_the_rest": round(min((contrast(p, bg) for i, p in enumerate(pal) if i not in on_bg), default=0), 2),
            "cells": len(pairs),
            "cells_under_4_5": len(under_pairs),
            "cells_under_4_5_after_per_cell": sum(x < 4.5 for x in after_pairs),
            "cursor": cursor,
            "cursor_after": round(contrast(cur_fixed, bg), 2),
        },
    }


# ---- run it -----------------------------------------------------------------------------

out = {}
for name, look in [("fabrika", "dark"), ("fabrika-light", "light")]:
    out[name] = repair(DEFAULT[look])
    out[name]["fills"] = sorted(FILL[look])

files = {
    "nord": read_tinted(f"{SCHEMES}/base16-nord.yaml"),
    "solarized-light": read_tinted(f"{SCHEMES}/base16-solarized-light.yaml"),
    "mocha": read_tinted(f"{SCHEMES}/base24-catppuccin-mocha.yaml"),
    "dracula": read_ghostty(f"{SCHEMES}/ghostty-Dracula", "dark"),
    "latte": read_ghostty(f"{SCHEMES}/ghostty-Catppuccin_Latte", "light"),
    "unreadable": {"look": "dark", "bg": "#808080", "fg": "#858585", "blue": "#858585", "green": "#858585", "yellow": "#858585", "red": "#858585", "palette": ["#858585"] * 16, "cursor": "#858585"},
}
for name, f in files.items():
    out[name] = repair(mapped(f))
out["fractions"] = {look: {k: round(v, 3) for k, v in fractions(look).items()} for look in ("dark", "light")}

# every gray and accent pick, both looks: does stepping up the scale always pass, with no bend?
picks = {"total": 0, "pass_on_steps": 0, "needed_steps": 0, "bends": []}
for gray in sorted(GRAYS):
    for accent in ACCENTS:
        for look in ("dark", "light"):
            t = pick(gray, accent, look)
            r = repair(t)
            picks["total"] += 1
            if not r["bends"]:
                picks["pass_on_steps"] += 1
            else:
                picks["bends"].append(f"{gray}/{accent}/{look}: " + ", ".join(m["role"] for m in r["bends"]))
            if r["moved"]:
                picks["needed_steps"] += 1
            for m in r["moved"]:
                key = f"{look} {m['role']}"
                picks.setdefault("moves", {})[key] = picks.setdefault("moves", {}).get(key, 0) + 1
out["picks"] = picks

# accents: clear of the state hues by 25 degrees (the study's measure, on step 9), and not a pipe color
acc = {}
for a in ACCENTS:
    s9 = step(a, "dark", 9)
    gaps = {k: round(hue_gap(s9, step(sc, "dark", 9))) for k, sc in STATES.items()}
    acc[a] = {"near_state": min(gaps.values()) < 25, "pipe": a in PIPES, "nearest_pipe_deg": min((round(hue_gap(s9, step(p, "dark", 9))), p) for p in PIPES if p != a)}
out["accents"] = {
    "clear_of_states": [a for a, x in acc.items() if not x["near_state"]],
    "clear_and_not_a_pipe": [a for a, x in acc.items() if not x["near_state"] and not x["pipe"]],
    "near_state_count": sum(x["near_state"] for x in acc.values()),
    "detail": acc,
}
print(json.dumps(out, indent=1))
