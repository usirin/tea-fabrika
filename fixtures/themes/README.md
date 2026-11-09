# Theme laws for today's app

Ticket 343, PR 1. `laws.ts` contains generated inputs and independent color math.
All generated checks use seed 119120. The original five schemes under `source/`
are byte-for-byte copies from experiment 177. The two license files there belong
with them. They are public theme inputs, never settings from a machine.

`settings.toml` is the corrected combined settings example.
`settings-conflict.toml` keeps the old, invalid key/table spelling for refusal.

The global file keys currently follow the fifteen names in the themes note.
The plan requires the token rename before format 1 ships. These tests must move
with that rename; they do not approve publishing the old names as another format.

The shared checker now provides WCAG, signed APCA and lightness-only repair.
Calibration is still blocked on the generated `theme-contract.ts` pairs and the
final global token names. `calibration.json` and `tokens/repair.toml` say
`unmeasured`; neither contains a guessed cap, repair count or repair version.
Experiment 239 records the missing inputs and the required visual review.
