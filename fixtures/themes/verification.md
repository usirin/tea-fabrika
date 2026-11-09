# T343 tests handoff

Today's app only. This work is the first test packet for PR 1, not approval of
all PR 1 laws. Product code and generated outputs have not changed.

## Written checks

- T1/T2: generated complete themes, missing/extra/malformed fields, palette size,
  exclusive sources and repair destinations, including the cursor.
- T3/T4: settings defaults, floors and diagnostics, corrected top-level TOML,
  and rejection of the former key/table conflict through the product decoder.
- T5/T6: independent WCAG and signed APCA equations, composited layers, both
  polarities, independent floors and unrounded comparisons.
- T7: current built-in text pairs under both floors, including row backgrounds.
  The exhaustive 300-pick assertion belongs to the following picker work.
- T8: scale choices decode at build time. Faintest-candidate selection remains.
- T9/T10/T11/T12: deterministic repair, unchanged inputs/backgrounds/palette,
  lightness-only moves, independent neutral-color search, impossible pairs,
  generated cap boundaries, per-token fallback and unchanged `off` values.
- T13: exact source/license and mapped-input hashes, required measured cap/version,
  and equality of the checker output with reviewed reports, including the invented case.
- T14: generated real file operation orders and independent keybindings.
- T18: the actual Ghostty renderer must pass drawn colors to its callback after
  inverse, selection and faint processing. This defines the still-missing callback.
- T19/T24: generated replay/reset/attach/focus/switch/dispose orders. A DSR request
  is answered by the fake terminal, so replaying a response is observable.
- T22: CSS text roles through aliases, raw TS/TSX view colors, and Radix import plants.
- T23: closed global names and refusal of component color keys at compile time.
- T25: generated decoder refusals and settings failures, checking diagnostics and
  logs for invented values and their encoded forms. Other outputs still need coverage.

## Previous run

The design run had 95 existing checks passing, 13 new checks failing, and two
suites unable to collect because `theme.ts` and `theme-settings.ts` do not exist.
The new checker tests cannot execute their predicates until `measure`, `passes`
and `check` exist. Those are missing implementation, not observed math failures.

Actual behavior failures: current built-in text pairs fail APCA, the token decoder
rejects scale choices, the renderer does not call the correction callback, and
settings failure logs violate T25. T13 refuses to accept an unmeasured cap.
The two byte/hash format checks pass.

All 16 terminal tests pass. Three isolated copies of the real terminal code were
changed, one bug each: ignore RIS, listen before replay, and keep a disposed
listener. Each made the generated T19/T24 law fail with seed 119120. No live
product file was changed for these runs.

All 46 CSS lint tests pass. The raw-color/Radix plant passes its expected refusal
checks. The scan of current views found zero new raw-color hits; the three
shipped stylesheets produced zero text-role hits and zero CSS blocking results.
The T14 OS watcher run hit sandbox `EMFILE`; it is neither a product red nor green.

`pnpm format` ran first. `pnpm lint` ran once and found test-side issues, which
were corrected. Targeted oxlint and CSS checks then passed. The dead-export check
passed without changing its ledger. One `pnpm typecheck` ran. It reported missing
product modules/exports and test-side errors; the latter were corrected without
repeating the full typecheck. No full suite or Electron run was started.

## Restored run under the fixed plan

Restored the saved patch without redoing its laws. Moved the saved experiment to 239
and updated its references. All 41 changed files are exact `tests` entries in
the corrected plan. Product code, generated outputs and the lockfile are unchanged.

The final narrow checks have 229 passing checks and 19 failed checks across ten
files, plus two suites that cannot collect. The failures divide as follows:

- Four product behavior reds: T7 built-in APCA, T8 scale decoding, T18 renderer
  callback, and T25 settings logs. All use seed 119120.
- Ten checker checks cannot reach their predicates because `measure`, `passes`
  and `check` do not exist. T1/T2/T3/T4 and the decoder portion of T25 cannot
  collect because `theme.ts` and `theme-settings.ts` do not exist. These are
  missing product APIs, not observed failures of the color math or decoder rules.
- T13 still refuses the missing measured cap and report. No number was guessed.
- The one isolated T14 retry timed out after 60 seconds. No EMFILE appeared in
  this run. Three older watch checks also waited unsuccessfully for file changes.
  These four watch results remain unresolved, not proved product failures.
  The previous run's EMFILE remains recorded above. No limit was raised.

The 65 lint-plant checks and 46 CSS lint checks pass. Added the new raw-color
rule to the existing rule-coverage list; its actual planted source was already
present in the saved patch. All 16 terminal checks pass, including T19/T24.
The two T13 byte/hash checks pass.

`pnpm format` ran first. `pnpm lint` ran once: oxlint and formatting passed, then
the package-import check refused four design test imports of
`fixtures/themes/laws.ts`. A named fixture package needs its own
`fixtures/themes/package.json`, which is absent from the plan's files table.
No import check was bypassed and no allowance was added. Lint stopped there;
its later checks were not reached. The passing CSS tests are a separate run.

One `pnpm typecheck` ran at the end. It stopped in the design package on missing
product exports `measure`, `passes`, `check` and missing modules `theme.ts`,
`theme-settings.ts`, `theme-contract.ts`. A secondary `false`/`true` error came
from the missing Theme type becoming open. Replaced that redundant assertion
with a required-global-values assertion and kept the component-name refusal.
No second typecheck ran. Other package checks were canceled when this one failed.

Experiment 239 ran once without `--map`; the missing generated
`theme-contract.ts` stopped calibration before a report was written. The plan
also omits the future `fixtures/themes/calibration.json` from its exact files
table. Both that reviewed report and a named helper package need tests ownership
before the next tests run can complete them. No model calls or network were used.

## Still required from tests

The shared checker must exist before experiment 239 can measure the cap. Run it,
review the real-theme results and screenshots, pin `repair.toml` and the full
calibration report, and verify the future API tests against real implementations.
The output signatures used by these tests follow the plan's sketches; they have
not been proved against an implementation.

PR 1 also still needs the Ghostty patch, host theme-load/check no-write laws,
theme-file watch flows, startup/cache/forced-colors/frame/subscription laws,
T21 real-window scenarios and the remaining T25 outputs, including spans and URLs.
The final global token rename is still a shipping gate, as the plan says. This
packet uses the note's fifteen file names and does not authorize another format.

PR 2/3 picker/save/import laws have not started. The lead owns experiment/field
index updates. Calibration used no model calls or network and incurred $0 in
provider fees. The box's requested `../bin/stepcommit.sh` wrapper is absent;
the repo's step-commit script supplies its documented `--commit-only` route.

The previous run's commit was refused with `not_owner`: the saved plan used
placeholder experiment names and a fixture glob. The lead expanded the table to
the individual fixture files and experiment 239. This run restores that saved
work and checks it under the corrected plan without changing product code.
