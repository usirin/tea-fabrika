# 239: measuring the theme repair cap

Today's app, ticket 343, PR 1. Status: input preparation complete; measurement blocked.

The approved plan requires the cap to be the largest finite minimal OKLCH lightness
move needed by five real schemes at WCAG 4.5 and APCA magnitude 60. Non-text uses
WCAG 3 and APCA magnitude 15. The invented unreadable case never enlarges the cap.

`239-theme-repair.ts --map` prepared all five mapped TOML files and the invented
case. It reads YAML 2.9.1, keeps the original bytes and hashes, preserves Base24
bright roles, and uses the themes note's stated OKLCH ladder fractions. A mapping
outside sRGB stops rather than clipping channels. The current fifteen file keys
follow the note; the plan's token rename is still a gate before shipping format 1.

`node experiments/239-theme-repair.ts` cannot measure yet. Today's checker now
exports `measure`, `passes` and `check`, including signed APCA and repair over all
listed backgrounds. The generated `theme-contract.ts` is still missing. The
builder owns that file, the final global names, and their pairs and floors. The
script was run again and stopped at that missing import, before any measurement.
`fixtures/themes/calibration.json` and `tokens/repair.toml` explicitly record
`unmeasured`. No cap, expected repair count or repair version has been filled in.
Historical WCAG-only counts are not expected results.

Once those exports exist, the script first runs with the full lightness interval
available, sorts every required move, selects the maximum from the five real
schemes, then checks the same inputs with that cap. It writes raw reports under
`runs/` or the path given by `--output`. The test writer must review the report,
add the invented case's fallback report, and replace `unmeasured` with a measured
status, cap and repair version in `tokens/repair.toml` plus
`fixtures/themes/calibration.json`. The builder cannot bless those results.

The tests additionally compare against independent WCAG and signed SAPC equations
and search all 256 representable neutral grays for a smaller valid move. Those
checks do not use the production arithmetic as their expected answer.

No screenshot or visual cap review ran. No Electron app started. No provider calls
ran, so provider fees were $0. This is not an accepted cap measurement.

References: [themes note](../docs/direction/themes.md),
[CSS Color 4 conversions](https://www.w3.org/TR/css-color-4/#color-conversion-code),
[apca-w3 0.1.9 equations](https://github.com/Myndex/apca-w3/blob/master/src/apca-w3.js).
