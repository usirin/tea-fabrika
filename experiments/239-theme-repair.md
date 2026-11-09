# 239: measuring the theme repair cap

Today's app, ticket 343, PR 1. Seed 119120. Repair version `1` has a measured
cap of **0.1705827986227786** in OKLCH lightness. Solarized Light sets it with
`text-faint` on `surface-selected/surface-raised`. Visual acceptance is pending.

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
pnpm exec node experiments/239-theme-repair.ts --map
pnpm exec node experiments/239-theme-repair.ts --output runs/themes-tests10-repair.json
```

Both commands exit 0. The script checks mapped bytes against the oracle, decodes
them through the product decoder, and gives the shared checker the whole
lightness interval before applying a cap. Text must meet WCAG 4.5 and APCA
magnitude 60; non-text must meet WCAG 3 and APCA magnitude 15. The largest finite
minimal move from the five real sources sets the cap. A token with no feasible
move cannot set it. The invented case is checked afterward and cannot enlarge it.

| Input | Moved pairs | Moved tokens | Substitutions | Final failed pairs |
|---|---:|---:|---:|---:|
| Nord | 26 | 4 | 3 | 7 |
| Solarized Light | 23 | 4 | 4 | 2 |
| Catppuccin Mocha | 14 | 2 | 2 | 0 |
| Dracula | 4 | 2 | 4 | 4 |
| Catppuccin Latte | 22 | 4 | 3 | 0 |
| Invented unreadable case | 0 | 0 | 10 | 60 |

The real themes have the same counts before and after applying the measured cap.
The 89 moved-pair rows are sorted by their measured move in `calibration.json`.
The cap-setting repair changes `#879e96` to `#566b64` on drawn background
`#e6e6d2`. WCAG rises from 2.256924311674268 to 4.511247442356628; signed APCA
rises from 39.10771089509601 to 62.97441476324208. The lightness move is
0.1705827986227786. These are measured values, without rounding before comparison.

Nord's remaining failures are five focus pairs and two turn-label pairs.
Solarized Light retains two turn-label failures. Dracula retains two focus and
two turn-label failures. Those backgrounds cannot move under this policy, and
the required built-in substitutions do not fix those pairs. The report keeps
every failure rather than calling those themes repaired successfully.

`calibration.json` records version `1`, the cap and its pair, source metadata,
mapped hashes, generated-CSS hash, pair list, policy, all five uncapped reports,
the capped reports, and the invented result. It also records final 8-bit drawn
foregrounds before and after repair on every required background. `repair.toml`
pins the measured version, cap and pair. T13 compares all these reports against
the real checker; generated T11 cases exercise caps just below, at and above
this measured move. T26 remains PR 3 work.

Run calibration through `pnpm exec node`, as Vitest does. The shell's Node 26 and
pnpm's Node 22 produced different last decimal bits. The first complete attempt
also bypassed the decoder and kept file-shaped source tables instead of the
decoded tagged source. Exact T13 report comparison caught both test-side bugs.
The script now measures decoded themes on the same runtime as the tests. No
comparison tolerance or product math changed to hide them.

## Earlier incomplete attempt

The tests9 run could not finish Nord, Solarized Light or Dracula because the
built-in fallback lacked `turn-fg`; the invented case lacked `text-faint`.
Mocha finished with 14 moved-pair rows, 2 substitutions and 12 final failures;
Latte finished with 22, 3 and 0. No cap was assigned from those partial results.
Build6 supplied all 21 fallback names. Its dark hover step changed to indigo 9,
so this run regenerated the four dark mapped files and their hashes. The six
note places and four computed gray places did not change. Original source and
license bytes remain unchanged.

## What this cannot tell us

The number is measured, but fixture screenshots and visual acceptance remain
pending. No Electron, VoiceOver or four-terminal timing run was performed here.
Five real sources do not establish that this cap suits every imported theme.
Some backgrounds still make the required floors impossible under this policy.
Calibration used no model calls or network. Provider fees were $0.

References: [themes note](../docs/direction/themes.md),
[decision 0009](../.decisions/0009-imported-themes-derive-their-grays.md),
[CSS Color 4 conversions](https://www.w3.org/TR/css-color-4/#color-conversion-code),
[apca-w3 0.1.9 equations](https://github.com/Myndex/apca-w3/blob/master/src/apca-w3.js).
