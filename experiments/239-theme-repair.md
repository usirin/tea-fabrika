# 239: measuring the theme repair cap

Today's app, ticket 343, PR 1. Seed 119120. All 21 global names are now mapped.
Measurement reached the shared checker, but its built-in fallback stops three
real themes. The cap and its pair remain unmeasured.

## Mapping by decision 0009

`fixtures/themes/laws.ts` owns the independent mapping oracle. Experiment 239
uses it for the five kept real sources and the explicitly invented unreadable
case. The latter uses background, foreground and palette `#777777`, with the
same derivation rules, and cannot set the cap. All six mapped files pass the
complete 21-color decoder. The source bytes and licenses are unchanged.

The four new gray places come from the generated `tokens.css`, compositing each
built-in token over its own surface before taking OKLCH lightness:

```text
pos(token) = (L(token over surface) - L(surface)) / (L(text-primary) - L(surface))
```

`pinned:` tests7 stopped because these mappings had no rule. T13 now pins the
computed places beside the note's six published places, to catch a changed
alpha or compositing rule. Only expected values are typed in; the oracle always
computes the four new places.

| Place | Dark | Light |
|---|---:|---:|
| desk, now surface-sunken | -0.026 | 0.012 |
| raised, now surface-raised | 0.045 | 0 |
| hover, now surface-hover | 0.096 | 0.059 |
| edge, now border-faint | 0.136 | 0.091 |
| old mixed focus, comparison only | 0.403 | 0.467 |
| faint, now text-faint | 0.766 | 0.656 |
| surface-selected, computed | 0.17295817324214394 | 0.11967235459686824 |
| border, computed | 0.21810051303876932 | 0.15049232381844008 |
| border-strong, computed | 0.2865445053882994 | 0.1926589848544969 |
| wire, computed | 0.4034163775428278 | 0.2712446035531011 |

Scrim uses the theme's derived surface-sunken and only the built-in scrim's
alpha. Turn-fill-hover uses the source blue's hue and chroma plus the built-in
lightness difference. If it leaves sRGB, only chroma is lowered until it fits.
Focus keeps the look's built-in slate a9. It no longer uses the old mixed place.
The generated CSS hash is recorded, so rebuilding a built-in cannot silently
change the calibration inputs.

## Measurement on 2026-11-09

Commands, with `TYPESAFE_API_KEY` unset and no provider calls:

```sh
node experiments/239-theme-repair.ts --map
node experiments/239-theme-repair.ts --output runs/themes-tests9-repair.json
```

The second command exits 1 after saving the incomplete report. It checks the
mapped bytes against the oracle, then gives the checker the whole lightness
interval. Text must meet WCAG 4.5 and APCA magnitude 60; non-text must meet WCAG
3 and APCA magnitude 15. Substitutions and final failures are retained even in
the uncapped pass. A pair with no feasible lightness move cannot set the cap.

| Input | Uncapped outcome |
|---|---|
| Nord | Stops at `no color: turn-fg` during built-in fallback. |
| Solarized Light | Stops at `no color: turn-fg` during built-in fallback. |
| Catppuccin Mocha | Completes: 14 moved-pair rows, 2 substitutions, 12 remaining failing pairs. |
| Dracula | Stops at `no color: turn-fg` during built-in fallback. |
| Catppuccin Latte | Completes: 22 moved-pair rows, 3 substitutions, 0 remaining failing pairs. |
| Invented unreadable case | Stops at `no color: text-faint` during built-in fallback. Never sets the cap. |

The complete inputs contain `turn-fg` and `text-faint`. The failure is in the
built-in fallback lookup: `themes.ts` and `theme-colors.ts` still expose the old
15-name map, with `on-turn` and `faint`. These are builder-owned files. The two
completed reports do not establish a cap for all five real sources.

`fixtures/themes/calibration.json` keeps both complete reports, their sorted
finite moves, all four errors, mapped hashes, generated-CSS hash, pair list,
policy, and the attempted algorithm version `1`. `tokens/repair.toml` records
the same block and points to that report. Neither file assigns a shipping cap,
a cap-setting pair, or a calibrated repair version. No number was invented.

After build provides complete built-in values, tests must regenerate the mapped
files if the generated values changed, rerun all six inputs, and review the
results. The largest finite minimal move from the five real themes then sets
the first cap. The invented case is checked with that cap afterward. T13 compares
the cap, its pair, version, hashes, uncapped moves, capped reports and invented
report against the actual checker. Its `format:` reason is that calibration must
use these five real source files. T26 remains PR 3 work.

No screenshots, visual cap review, VoiceOver or Electron run were performed.
Provider fees were $0. This report does not accept a cap.

References: [themes note](../docs/direction/themes.md),
[decision 0009](../.decisions/0009-imported-themes-derive-their-grays.md),
[CSS Color 4 conversions](https://www.w3.org/TR/css-color-4/#color-conversion-code),
[apca-w3 0.1.9 equations](https://github.com/Myndex/apca-w3/blob/master/src/apca-w3.js).
